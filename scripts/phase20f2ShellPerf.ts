/**
 * Phase 20F.2 §25 — shell equality perf evidence.
 *
 * MEASUREMENT ONLY. Exercises the REAL `createCadShellLink().publish()`
 * path (whose `snapshotsEqual` gained 5 JSON-compared subtrees: f2f,
 * surveyTable, parcel, grading, gradingGroups) on a representative synthetic
 * session snapshot. Every figure is an actual run; nothing is extrapolated
 * and no timing gate exists.
 *
 * Matrix:
 *  1. JSON bytes per subtree (all 14 compared subtrees; the 5 new ones
 *     flagged) — shows where the compare cost lives.
 *  2. per-subtree JSON.stringify medians — the dominant op inside equality.
 *  3. publish() medians: same-ref fast path / deep-equal clone (full
 *     compare, notify suppressed) / single-subtree change (full compare +
 *     notify) for each of the 5 new subtrees + the heaviest old ones.
 *  4. repeated semantic-equality + publish attempts (200 deep-equal
 *     publishes) — the steady-state shell cost.
 *
 * Usage: `npx tsx scripts/phase20f2ShellPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';

const QUICK = process.argv.includes('--quick');

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const repMedian = (count: number, fn: () => void): number => {
  const runs: number[] = [];
  for (let i = 0; i < count; i += 1) runs.push(timed(fn).ms);
  return median(runs);
};

const numbers = (count: number, scale: number): number[] =>
  Array.from({ length: count }, (_, index) => (index * scale) % 1000);

// A grading CURRENT result embeds full meshes — the heavy part of the
// grading subtrees in production (CadGradingRow.currentResult).
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

// Representative session: a loaded drawing (300 survey points, 3 surfaces,
// 8 gradings with 4 CURRENT results, 3 groups with 2 results, 40 parcels,
// 150-row survey table, mid-size profiles/sections/F2F).
const makeSnapshot = (): Record<string, unknown> => ({
  drawingId: 'perf-drawing',
  drawingName: 'Perf Drawing',
  units: 'm',
  entityCount: 412,
  selectionCount: 0,
  selectedEntityIds: [],
  selectionPreview: [],
  layers: [
    { id: 'l1', name: 'Points', color: '#ffffff', visible: true, locked: false, frozen: false, printable: true, lineTypeId: 'continuous', description: '', transparency: 0, lineweightMm: 0.25 },
    { id: 'l2', name: 'Parcels', color: '#ff0000', visible: true, locked: false, frozen: false, printable: true, lineTypeId: 'continuous', description: '', transparency: 0, lineweightMm: 0.25 },
  ],
  layerEntityCounts: { l1: 312, l2: 100 },
  currentLayerId: 'l1',
  lineTypes: [{ id: 'continuous' }],
  sheets: [{ id: 's1', name: 'A-101' }],
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

const SUBTREES = ['survey', 'surface', 'volume', 'analysis', 'profile', 'section', 'blocks', 'annotation', 'f2f', 'surveyTable', 'parcel', 'grading', 'gradingGroups', 'featureLine'] as const;
const NEW_SUBTREES: ReadonlySet<string> = new Set(['f2f', 'surveyTable', 'parcel', 'grading', 'gradingGroups']);

const main = (): void => {
  console.log('# Phase 20F.2 shell-equality performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  const base = makeSnapshot();
  const asSnapshot = (value: Record<string, unknown>): never => value as never;

  // 1 + 2. bytes + stringify cost per subtree.
  console.log('\n## 1–2. Compared-subtree sizes and stringify cost\n');
  console.log('| subtree | new in 20F.2 | JSON bytes | stringify ms (median) |');
  console.log('|---|:---:|---:|---:|');
  const stringifyReps = QUICK ? 15 : 40;
  let newBytes = 0;
  let totalBytes = 0;
  let newMs = 0;
  let totalMs = 0;
  for (const key of SUBTREES) {
    const bytes = Buffer.byteLength(JSON.stringify(base[key]), 'utf8');
    const ms = repMedian(stringifyReps, () => {
      JSON.stringify(base[key]);
    });
    totalBytes += bytes;
    totalMs += ms;
    const isNew = NEW_SUBTREES.has(key);
    if (isNew) {
      newBytes += bytes;
      newMs += ms;
    }
    console.log(`| ${key} | ${isNew ? 'yes' : 'no'} | ${bytes} | ${ms.toFixed(3)} |`);
  }
  console.log(`\n- total compared JSON: ${totalBytes} bytes; new-5 share: ${newBytes} bytes (${((newBytes / totalBytes) * 100).toFixed(1)}%)`);
  console.log(`- summed stringify medians: ${totalMs.toFixed(3)} ms; new-5 share: ${newMs.toFixed(3)} ms (${((newMs / totalMs) * 100).toFixed(1)}%)`);

  // 3. publish() medians through the real link.
  console.log('\n## 3. publish() cost through the real shell link\n');
  const link = createCadShellLink();
  let notifications = 0;
  link.subscribe(() => {
    notifications += 1;
  });
  const first = structuredClone(base);
  link.publish(asSnapshot(first));
  const publishReps = QUICK ? 30 : 100;
  const sameRefMs = repMedian(publishReps, () => {
    link.publish(asSnapshot(first));
  });
  const equalCloneMs = repMedian(publishReps, () => {
    link.publish(asSnapshot(structuredClone(base)));
  });
  console.log(`| path | publish ms (median) | notified |`);
  console.log(`|---|---:|---|`);
  console.log(`| same ref (fast path) | ${sameRefMs.toFixed(4)} | no |`);
  console.log(`| deep-equal clone (full compare, suppressed) | ${equalCloneMs.toFixed(4)} | no |`);
  const changedKeys = ['grading', 'gradingGroups', 'parcel', 'surveyTable', 'f2f', 'profile', 'surface'];
  for (const key of changedKeys) {
    const before = notifications;
    const mutated = structuredClone(base);
    (mutated[key] as Record<string, unknown>).__perfTouch = 1;
    const ms = repMedian(publishReps, () => {
      // Fresh clone per rep so every publish actually compares + notifies.
      const attempt = structuredClone(mutated);
      (attempt[key] as Record<string, unknown>).__perfTouch = Math.random();
      link.publish(asSnapshot(attempt));
    });
    const fired = notifications - before > 0 ? 'yes' : 'no';
    console.log(`| change in ${key} (compare + notify)${NEW_SUBTREES.has(key) ? ' [new]' : ''} | ${ms.toFixed(4)} | ${fired} |`);
  }

  // 4. repeated semantic-equality + publish attempts.
  console.log('\n## 4. Repeated semantic-equality + publish attempts\n');
  // Re-baseline on the clean snapshot: §3 leaves a touched snapshot stored,
  // so the first clean publish notifies once (harness artifact, not product).
  link.publish(asSnapshot(structuredClone(base)));
  const attempts = QUICK ? 50 : 200;
  const beforeAttempts = notifications;
  const start = performance.now();
  for (let i = 0; i < attempts; i += 1) {
    link.publish(asSnapshot(structuredClone(base)));
  }
  const wallMs = performance.now() - start;
  console.log(`- ${attempts} deep-equal publishes (compare each, notify never): ${wallMs.toFixed(1)} ms total, ${(wallMs / attempts).toFixed(4)} ms/attempt`);
  console.log(`- notifications fired during §4: ${notifications - beforeAttempts} (expected 0)`);
  console.log('\nDONE (exit 0)');
};

main();
