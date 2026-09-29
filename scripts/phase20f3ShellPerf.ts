/**
 * Phase 20F.3 §25 — shell equality perf evidence.
 *
 * MEASUREMENT ONLY. Exercises the REAL `createCadShellLink().publish()` path
 * and the exhaustive comparator contract
 * (`src/cad-app/shell/cadShellSnapshotEqual.ts`).
 *
 * Every timed region contains ONLY `link.publish(prebuiltState)`:
 * fixtures, `structuredClone`, and deep-equality baselines are constructed
 * before timing and excluded from the numbers. Alternating prebuilt states
 * forces a real comparison on each rep (no same-reference accident) and makes
 * notify counts meaningful.
 *
 * Matrix:
 *  1. JSON bytes per top-level key, grouped by comparator partition
 *     (scalar / structured / JSON subtree) — where compare cost lives.
 *  2. publish() medians: same-ref fast path, semantic-equal suppression
 *     (unique graphs, equal content), and single-key change compare+notify.
 *  3. nested-gap changes added in 20F.3 (preview.type, layers.role,
 *     lineTypes name/dash, sheet dims/margins/viewport/title-block/object) —
 *     each must notify; notify count proves the gate observes it.
 *  4. deepened sheet compare impact (more viewports/objects) and 200 repeated
 *     equal publishes (prebuilt, no clone) for steady-state cost.
 *
 * Usage: `npx tsx scripts/phase20f3ShellPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  SNAPSHOT_JSON_SUBTREE_KEYS,
  SNAPSHOT_SCALAR_KEYS,
  SNAPSHOT_STRUCTURED_KEYS,
} from '../src/cad-app/shell/cadShellSnapshotEqual';

const QUICK = process.argv.includes('--quick');

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const numbers = (count: number, scale: number): number[] =>
  Array.from({ length: count }, (_, index) => (index * scale) % 1000);

const gradingResult = (verts: number, tris: number): unknown => ({
  gradingId: 'g',
  revision: 'grev1:perf',
  accuracy: 'EXACT',
  regions: [{ kind: 'FIXED', area: 123.4 }],
  daylightPoints: numbers(verts * 3, 0.37),
  gradingMesh: { points: numbers(verts * 3, 1.13), triangles: numbers(tris * 3, 1) },
  sourceLength: 100,
  gradingPlanArea: 2000,
  grading3dArea: 2010,
  minProjectionDistance: 19.8,
  maxProjectionDistance: 20.2,
  meanProjectionDistance: 20,
  cutSourceLength: 0,
  fillSourceLength: 0,
  tiedSourceLength: 0,
  candidateTriangleCount: 0,
  intersectionSegmentCount: 0,
  multipleSolutionCount: 0,
  diagnostics: [],
});

const gradingRow = (id: string, withResult: boolean): unknown => ({
  id,
  name: id,
  definition: {
    id, name: id, sourceFeatureLineId: 'fl-1',
    sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
    side: 'right', criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
    maxSearchDistance: 20, curveChordTolerance: 0.1,
  },
  source: { startX: 0, startY: 5, endX: 10, endY: 5, startZ: 0, endZ: 0, length: 10, reoriented: false, isArc: false },
  sourceFeatureLineId: 'fl-1',
  sourceName: 'Ridge',
  method: 'distance',
  analytic: true,
  targetSurfaceId: '',
  targetName: '—',
  boundaryLabel: 'Grading Limit',
  lengthUnit: 'm',
  areaUnit: 'm²',
  cutFillApplicable: false,
  side: 'right',
  criterionText: '-2% to 20m',
  status: withResult ? 'CURRENT' : 'UNBUILT',
  statusText: withResult ? 'Current' : 'Unbuilt',
  diagnostic: null,
  stale: false,
  revision: 'grev1:perf',
  maxSearchDistance: 20,
  curveChordTolerance: 0.1,
  accuracy: withResult ? 'EXACT' : null,
  accuracyText: withResult ? 'Exact' : '—',
  metrics: withResult
    ? { minProjectionDistance: 19.8, maxProjectionDistance: 20.2, meanProjectionDistance: 20, gradingPlanArea: 2000, grading3dArea: 2010, triangleCount: 400, multipleSolutionCount: 0, sourceLength: 100 }
    : null,
  currentResult: withResult ? gradingResult(600, 400) : null,
  calculable: !withResult,
  exportable: withResult,
  stationSpan: [0, 10],
});

const groupRow = (id: string, withResult: boolean): unknown => ({
  id,
  name: id,
  definition: {
    id, name: id, sourceFeatureLineId: 'fl-1',
    sourceCourses: [{ vertexAId: 'vA', vertexBId: 'vB' }, { vertexAId: 'vB', vertexBId: 'vC' }],
    side: 'right', criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
    maxSearchDistance: 20, curveChordTolerance: 0.1, cornerMode: 'miter',
  },
  sourceFeatureLineId: 'fl-1',
  sourceName: 'Ridge',
  method: 'distance',
  analytic: true,
  targetSurfaceId: '',
  targetName: '—',
  boundaryLabel: 'Grading Limit',
  lengthUnit: 'm',
  areaUnit: 'm²',
  side: 'right',
  courseCount: 2,
  closed: false,
  criterionText: '-2% to 20m',
  overrideCount: 0,
  status: withResult ? 'CURRENT' : 'UNBUILT',
  statusText: withResult ? 'Current' : 'Unbuilt',
  diagnostic: null,
  stale: false,
  revision: 'ggrev1:perf',
  maxSearchDistance: 20,
  curveChordTolerance: 0.1,
  accuracy: withResult ? 'EXACT' : null,
  accuracyText: withResult ? 'Exact' : '—',
  curveCornerApproximated: false,
  metrics: withResult
    ? { minProjectionDistance: 19.8, maxProjectionDistance: 20.2, gradingPlanArea: 4000, triangleCount: 800 }
    : null,
  cornerSummary: [],
  currentResult: withResult ? gradingResult(1200, 800) : null,
  calculable: !withResult,
  exportable: withResult,
  memberSources: null,
});

const makeSheet = (index: number, viewports: number, objects: number): unknown => ({
  id: `sheet-${index}`,
  name: `A-10${index}`,
  widthMm: 841,
  heightMm: 594,
  orientation: index % 2 === 0 ? 'landscape' : 'portrait',
  margins: { topMm: 10, bottomMm: 10, leftMm: 12, rightMm: 12 },
  viewports: Array.from({ length: viewports }, (_, v) => ({
    id: `vp-${index}-${v}`,
    name: `Viewport ${v}`,
    modelCenterX: v * 100,
    modelCenterY: v * 50,
    scaleDenominator: 100 + v,
    paperXmm: 20 + v,
    paperYmm: 20 + v,
    paperWidthMm: 400,
    paperHeightMm: 250,
    rotationDeg: 0,
  })),
  titleBlockId: 'tb-1',
  titleBlockFields: { DRAWN_BY: 'A', CHECKED_BY: 'C' },
  sheetObjects: Array.from({ length: objects }, (_, o) => ({
    id: `so-${index}-${o}`,
    kind: o % 2 === 0 ? 'north-arrow' : 'scale-bar',
    layerId: 'l1',
    paperXmm: 10 + o,
    paperYmm: 10 + o,
    viewportId: `vp-${index}-0`,
    sizeMm: 10,
  })),
});

// Representative session: a loaded drawing (300 survey points, 3 surfaces,
// 8 gradings with 4 CURRENT results, 3 groups with 2 results, 40 parcels,
// 150-row survey table, mid-size profiles/sections/F2F, 4 sheets x 4 viewports).
const makeSnapshot = (): Record<string, unknown> => ({
  drawingId: 'perf-drawing',
  drawingName: 'Perf Drawing',
  units: 'm',
  entityCount: 412,
  selectionCount: 1,
  selectedEntityIds: ['e1'],
  selectionPreview: [{ id: 'e1', type: 'survey-point', label: 'P1' }],
  layers: [
    { id: 'l1', name: 'Points', color: '#ffffff', visible: true, locked: false, frozen: false, printable: true, lineTypeId: 'continuous', defaultStyleId: 'st-p', description: 'Primary', transparency: 0, lineweightMm: 0.25, role: 'points' },
    { id: 'l2', name: 'Parcels', color: '#ff0000', visible: true, locked: false, frozen: false, printable: true, lineTypeId: 'continuous', defaultStyleId: 'st-parcel', description: '', transparency: 0, lineweightMm: 0.25, role: 'parcels' },
  ],
  layerEntityCounts: { l1: 312, l2: 100 },
  currentLayerId: 'l1',
  lineTypes: [
    { id: 'continuous', name: 'Continuous', dashPattern: [] },
    { id: 'dashed', name: 'Dashed', dashPattern: [4, 2] },
  ],
  sheets: [makeSheet(1, 4, 3), makeSheet(2, 4, 3), makeSheet(3, 4, 3), makeSheet(4, 4, 3)],
  properties: { kind: 'none' },
  activeCommandKey: null,
  commandPrompt: 'Idle.',
  commandInputValue: '',
  canUndo: true,
  canRedo: false,
  historyDepth: 12,
  redoDepth: 0,
  snapPreferences: { endpoint: true, midpoint: false },
  snapStatusText: 'SNAP: endpoint',
  stationCount: 300,
  dependencyStatus: 'MANUAL_ONLY',
  availableCommands: ['LINE', 'GRADETODISTANCE', 'GRADINGCALC'],
  survey: {
    points: Array.from({ length: 300 }, (_, i) => ({ id: `pt-${i}`, x: i * 1.7, y: i * 0.9, z: 100 + (i % 7), code: 'EG' })),
    observations: Array.from({ length: 120 }, (_, i) => ({ id: `ob-${i}`, kind: 'distance', value: 10 + i * 0.01 })),
  },
  surface: {
    surfaces: Array.from({ length: 3 }, (_, i) => ({ id: `srf-${i}`, name: `S${i}`, status: 'CURRENT', vertices: 4000, triangles: 7000, buildPath: 'worker' })),
    selectedSurfaceId: 'srf-0',
  },
  volume: { volumes: [{ id: 'v-1', status: 'CURRENT', quantities: { cut: 120, fill: 40 } }], selectedVolumeId: 'v-1' },
  analysis: { maps: [], analyses: [], legends: [] },
  profile: {
    profiles: Array.from({ length: 4 }, (_, i) => ({ id: `p-${i}`, samples: numbers(500 * 2, 0.5 + i), status: 'CURRENT' })),
    views: [], alignments: [], selectedProfileId: 'p-0', selectedViewId: null, styles: [],
  },
  section: {
    groups: Array.from({ length: 2 }, (_, i) => ({ id: `sg-${i}`, lines: [{ id: `sl-${i}`, samples: numbers(300 * 2, 0.25 + i) }] })),
    views: [], alignments: [], selectedGroupId: 'sg-0', selectedLineId: 'sl-0', selectedViewId: null, styles: [],
  },
  blocks: { blocks: [{ id: 'b-1', entities: 12 }], symbols: [] },
  annotation: { styles: [], entries: Array.from({ length: 60 }, (_, i) => ({ id: `an-${i}`, text: `Note ${i}` })) },
  f2f: {
    sets: Array.from({ length: 6 }, (_, i) => ({
      id: `f2f-${i}`,
      lines: Array.from({ length: 40 }, (_, j) => ({ id: `l-${j}`, code: `P${j % 9}`, points: numbers(8, 0.1 * (i + 1)) })),
    })),
  },
  surveyTable: {
    tables: [{
      id: 'st-1',
      rows: Array.from({ length: 150 }, (_, i) => ({ id: `r-${i}`, station: `1+${i}`, easting: 2000000 + i, northing: 7000000 + i, elevation: 100 + (i % 5) * 0.1, code: 'EG', notes: '' })),
    }],
  },
  parcel: {
    parcels: Array.from({ length: 40 }, (_, i) => ({
      id: `parcel-${i}`, designation: `Lot ${i + 1}`, parcelName: `Parcel ${i + 1}`, areaSquareMeters: 600 + i,
      perimeterMeters: 100 + i, courseCount: 4, lineCount: 4, status: 'OK',
    })),
    schedule: { rows: Array.from({ length: 40 }, (_, i) => ({ parcelId: `parcel-${i}`, area: 600 + i })) },
    selectedParcelId: null,
    selectedParcel: null,
  },
  grading: { gradings: Array.from({ length: 8 }, (_, i) => gradingRow(`g-${i}`, i % 2 === 0)), selectedGradingId: 'g-0' },
  gradingGroups: { groups: [groupRow('gg-0', true), groupRow('gg-1', true), groupRow('gg-2', false)], selectedGroupId: 'gg-0' },
  featureLine: {
    featureLines: [{ id: 'fl-1', name: 'Ridge', courses: [{ index: 0, kind: 'line' }, { index: 1, kind: 'line' }] }],
    selectedFeatureLine: null,
  },
});

const asSnapshot = (value: unknown): never => value as never;

const clone = <T>(value: T): T => structuredClone(value);

/** Publish medians over prebuilt alternating states; fixtures/clones excluded. */
const measure = (
  states: unknown[],
  reps: number,
): { medianMs: number; notifications: number } => {
  const link = createCadShellLink();
  let notifications = 0;
  link.subscribe(() => {
    notifications += 1;
  });
  link.publish(asSnapshot(states[0]));
  const baseline = notifications;
  const runs: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    const next = states[(r + 1) % states.length];
    const start = performance.now();
    link.publish(asSnapshot(next));
    runs.push(performance.now() - start);
  }
  return { medianMs: median(runs), notifications: notifications - baseline };
};

const changedVariants = (base: Record<string, unknown>, key: string): unknown[] => {
  const a = clone(base);
  const b = clone(base);
  (a[key] as Record<string, unknown>).__perfMarker = 'A';
  (b[key] as Record<string, unknown>).__perfMarker = 'B';
  return [a, b];
};

const nestedVariants = (
  base: Record<string, unknown>,
  mutate: (_snapshot: Record<string, unknown>, _marker: number) => void,
): unknown[] => {
  const a = clone(base);
  const b = clone(base);
  mutate(a, 0);
  mutate(b, 1);
  return [a, b];
};

const main = (): void => {
  console.log('# Phase 20F.3 shell-equality performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);

  // Fixtures are built ONCE, before any timing.
  const base = makeSnapshot();

  // 1. bytes per top-level key, grouped by comparator partition.
  console.log('\n## 1. Compared payload by comparator partition\n');
  console.log('| partition | keys | JSON bytes |');
  console.log('|---|---:|---:|');
  const partitionBytes = (keys: readonly string[]): number =>
    keys.reduce((sum, key) => sum + Buffer.byteLength(JSON.stringify(base[key]), 'utf8'), 0);
  const scalarBytes = partitionBytes(SNAPSHOT_SCALAR_KEYS);
  const structuredBytes = partitionBytes(SNAPSHOT_STRUCTURED_KEYS);
  const jsonBytes = partitionBytes(SNAPSHOT_JSON_SUBTREE_KEYS);
  console.log(`| scalar | ${SNAPSHOT_SCALAR_KEYS.length} | ${scalarBytes} |`);
  console.log(`| structured (preview/layers/lineTypes/sheets/properties) | ${SNAPSHOT_STRUCTURED_KEYS.length} | ${structuredBytes} |`);
  console.log(`| JSON subtrees | ${SNAPSHOT_JSON_SUBTREE_KEYS.length} | ${jsonBytes} |`);
  console.log(`| **total** | ${SNAPSHOT_SCALAR_KEYS.length + SNAPSHOT_STRUCTURED_KEYS.length + SNAPSHOT_JSON_SUBTREE_KEYS.length} | ${scalarBytes + structuredBytes + jsonBytes} |`);

  console.log('\n### Per JSON subtree\n');
  console.log('| subtree | JSON bytes |');
  console.log('|---|---:|');
  for (const key of SNAPSHOT_JSON_SUBTREE_KEYS) {
    console.log(`| ${key} | ${Buffer.byteLength(JSON.stringify(base[key]), 'utf8')} |`);
  }
  console.log('\n### Per structured key\n');
  console.log('| key | JSON bytes |');
  console.log('|---|---:|');
  for (const key of SNAPSHOT_STRUCTURED_KEYS) {
    console.log(`| ${key} | ${Buffer.byteLength(JSON.stringify(base[key]), 'utf8')} |`);
  }

  // 2. publish() medians.
  const reps = QUICK ? 40 : 120;
  console.log('\n## 2. publish() through the real shell link (fixtures prebuilt)\n');
  console.log('| path | publish ms (median) | notifications during loop | expected |');
  console.log('|---|---:|---:|---|');

  const equalStates = [clone(base), clone(base)];
  const sameRef = measure([clone(base)], reps);
  const equal = measure(equalStates, reps);
  console.log(`| same ref (fast path) | ${sameRef.medianMs.toFixed(4)} | ${sameRef.notifications} | 0 |`);
  console.log(`| semantic-equal (unique graphs, suppressed) | ${equal.medianMs.toFixed(4)} | ${equal.notifications} | 0 |`);

  const changedKeys = ['grading', 'gradingGroups', 'f2f', 'parcel', 'surveyTable', 'profile', 'survey', 'surface'] as const;
  for (const key of changedKeys) {
    const result = measure(changedVariants(base, key), reps);
    console.log(`| change in ${key} (compare + notify) | ${result.medianMs.toFixed(4)} | ${result.notifications} | ${reps} |`);
  }

  // 3. nested-gap changes added in 20F.3.
  console.log('\n## 3. Nested-gap changes (20F.3)\n');
  console.log('| nested field changed | publish ms (median) | notifications during loop | expected |');
  console.log('|---|---:|---:|---|');
  const nestedCases: Array<[string, (_snapshot: Record<string, unknown>, _marker: number) => void]> = [
    ['selectionPreview.type', (s, m) => { (s.selectionPreview as Array<{ type: string }>)[0]!.type = m === 0 ? 'survey-point' : 'line'; }],
    ['layers[].role', (s, m) => { (s.layers as Array<{ role: string }>)[0]!.role = m === 0 ? 'points' : 'parcels'; }],
    ['layers[].color', (s, m) => { (s.layers as Array<{ color: string }>)[0]!.color = m === 0 ? '#ffffff' : '#000000'; }],
    ['lineTypes name', (s, m) => { (s.lineTypes as Array<{ name: string }>)[0]!.name = m === 0 ? 'Continuous' : 'Dashed'; }],
    ['lineTypes dashPattern', (s, m) => { (s.lineTypes as Array<{ dashPattern: number[] }>)[0]!.dashPattern = m === 0 ? [] : [4, 2]; }],
    ['sheets widthMm', (s, m) => { (s.sheets as Array<{ widthMm: number }>)[0]!.widthMm = m === 0 ? 841 : 900; }],
    ['sheets margins', (s, m) => { (s.sheets as Array<{ margins: { leftMm: number } }>)[0]!.margins.leftMm = m === 0 ? 12 : 20; }],
    ['sheets viewport', (s, m) => { (s.sheets as Array<{ viewports: Array<{ scaleDenominator: number }> }>)[0]!.viewports[0]!.scaleDenominator = m === 0 ? 100 : 200; }],
    ['sheets titleBlockFields', (s, m) => { (s.sheets as Array<{ titleBlockFields: Record<string, string> }>)[0]!.titleBlockFields['DRAWN_BY'] = m === 0 ? 'A' : 'B'; }],
    ['sheets sheetObjects', (s, m) => { (s.sheets as Array<{ sheetObjects: Array<{ paperXmm: number }> }>)[0]!.sheetObjects[0]!.paperXmm = m === 0 ? 10 : 25; }],
  ];
  for (const [label, mutate] of nestedCases) {
    const result = measure(nestedVariants(base, mutate), reps);
    console.log(`| ${label} | ${result.medianMs.toFixed(4)} | ${result.notifications} | ${reps} |`);
  }

  // 4. deepened sheet compare + repeated equal publishes.
  console.log('\n## 4. Deepened sheet compare impact + steady state\n');
  console.log('| sheet shape | publish ms change case (median) |');
  console.log('|---|---:|');
  for (const [sheetsCount, viewports, objects] of [[4, 4, 3], [8, 8, 6], [16, 16, 12]] as const) {
    const deep = makeSnapshot();
    deep.sheets = Array.from({ length: sheetsCount }, (_, i) => makeSheet(i + 1, viewports, objects));
    const result = measure(nestedVariants(deep, (s, m) => {
      (s.sheets as Array<{ viewports: Array<{ scaleDenominator: number }> }>)[0]!.viewports[0]!.scaleDenominator = m === 0 ? 100 : 200;
    }), reps);
    console.log(`| ${sheetsCount} sheets x ${viewports} viewports x ${objects} objects | ${result.medianMs.toFixed(4)} |`);
  }

  const attempts = QUICK ? 50 : 200;
  const attemptsStates = [clone(base), clone(base)];
  const link = createCadShellLink();
  let notifications = 0;
  link.subscribe(() => {
    notifications += 1;
  });
  link.publish(asSnapshot(attemptsStates[0]));
  const baseline = notifications;
  const start = performance.now();
  for (let i = 0; i < attempts; i += 1) {
    link.publish(asSnapshot(attemptsStates[i % attemptsStates.length]));
  }
  const wallMs = performance.now() - start;
  console.log(`\n- ${attempts} semantic-equal publishes (prebuilt, no clone): ${wallMs.toFixed(1)} ms total, ${(wallMs / attempts).toFixed(4)} ms/attempt`);
  console.log(`- notifications fired: ${notifications - baseline} (expected 0)`);
  console.log('\nDONE (exit 0)');
};

main();
