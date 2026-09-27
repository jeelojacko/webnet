/**
 * Phase 20A — 3D feature-line performance probe (measurement only).
 *
 * Times the authoritative feature-line paths at 100 / 1,000 / 10,000 /
 * 100,000 vertices on a deterministic mixed line+arc chain (every 10th
 * course is a 90° minor arc; Z rises 0.05 m per vertex):
 *
 *   resolve              resolveCadFeatureLine (one pass, no quadratics)
 *   station              getFeatureLinePointAtStation x lookups
 *   elevAtStation        getFeatureLineElevationAtStation x lookups
 *   bounds               buildCadSpatialIndex over the feature line
 *                        (line courses -> segments, arcs -> extrema)
 *   gradeEdit            setFeatureLineGradeSpan (grade-all-intermediates)
 *   surfaceBreakline     collectSources for a surface whose breakline is
 *                        the feature line (default 0.001 m chord tolerance;
 *                        arcs linearize, every generated vertex rides the
 *                        exact arc with station-interpolated Z)
 *
 * No src/ behavior changes, no tier wiring. Verdicts are printed (advisory),
 * not gated; the process fails only if an operation returns null/not-ok.
 *
 * Usage: `npx tsx scripts/phase20aFeatureLinePerf.ts [--quick]`
 *   --quick trims scales to 100 / 1,000 and reduces reps (smoke check).
 */
import { performance } from 'node:perf_hooks';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  getFeatureLineElevationAtStation,
  getFeatureLinePointAtStation,
  resolveCadFeatureLine,
} from '../src/engine/cad/cadFeatureLines';
import { setFeatureLineGradeSpan } from '../src/engine/cad/cadFeatureLineEdits';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { collectSources } from '../src/engine/cad/cadSurfaceRevision';
import type {
  CadEntity,
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [100, 1000] : [100, 1000, 10000, 100000];
const RUNS = QUICK ? 3 : 5;

/** CAD-standard signed bulge for a 90° minor arc: b = tan(sweep/4). */
const ARC_BULGE = Math.tan(Math.PI / 8);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timeMedian = (runs: number, fn: () => void): number => {
  const samples: number[] = [];
  for (let run = 0; run < runs + 1; run += 1) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (run > 0) samples.push(elapsed);
  }
  return median(samples);
};

const buildChain = (vertexCount: number): CadFeatureLineEntity => {
  const vertices = Array.from({ length: vertexCount }, (_, index) => ({
    id: `feature-vertex:fl-perf:v${index}`,
    x: index * 10,
    y: index % 2 === 0 ? 5 : 0,
    z: 100 + index * 0.05,
  }));
  const segmentGeometry = Array.from({ length: vertexCount - 1 }, (_, index) =>
    index % 10 === 3 ? ({ kind: 'arc', bulge: ARC_BULGE } as const) : ({ kind: 'line' } as const),
  );
  return {
    id: 'fl-perf',
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices,
    segmentGeometry,
    name: 'Perf chain',
  };
};

const cornerPoints = (): CadSurveyPointEntity[] => [
  { id: 'perf-sw', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'SW', x: -50, y: -50, z: 100, pointClass: 'free', source: 'parsed-input' },
  { id: 'perf-se', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'SE', x: 500000, y: -50, z: 100, pointClass: 'free', source: 'parsed-input' },
  { id: 'perf-ne', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'NE', x: 500000, y: 200, z: 112, pointClass: 'free', source: 'parsed-input' },
  { id: 'perf-nw', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'NW', x: -50, y: 200, z: 112, pointClass: 'free', source: 'parsed-input' },
];

const makeProject = (entities: CadEntity[], surfaces: CadSurface[] = []): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'FL perf 20A', units: 'm' });
  return { ...drawing.project, entities, surfaces };
};

const surfaceWithBreakline = (featureLineId: string): CadSurface => ({
  id: 's-perf',
  name: 'Perf surface',
  definition: {
    pointSource: { kind: 'points', pointEntityIds: ['perf-sw', 'perf-se', 'perf-ne', 'perf-nw'] },
    breaklines: [{ id: 'bl-perf', source: { kind: 'entity', entityId: featureLineId }, type: 'standard' }],
  },
});

interface Row {
  vertices: number;
  planLength: number;
  resolve: number;
  stationTotal: number;
  stationPerLookupUs: number;
  elevTotal: number;
  elevPerLookupUs: number;
  bounds: number;
  gradeEdit: number;
  surfaceBreakline: number;
  breaklinePoints: number;
}

const measure = (vertexCount: number): Row => {
  const entity = buildChain(vertexCount);
  const project = makeProject([...cornerPoints(), entity]);
  const surface = surfaceWithBreakline(entity.id);
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) throw new Error(`resolve failed at ${vertexCount} vertices`);
  const planLength = resolved.planLength;
  const lookupCount = Math.min(vertexCount, 20000);

  const resolveMs = timeMedian(RUNS, () => {
    if (!resolveCadFeatureLine(entity)) throw new Error('resolve null');
  });

  const stationTotal = timeMedian(RUNS, () => {
    for (let i = 0; i < lookupCount; i += 1) {
      const station = (planLength * i) / lookupCount;
      if (!getFeatureLinePointAtStation(resolved, station)) throw new Error('station null');
    }
  });

  const elevTotal = timeMedian(RUNS, () => {
    for (let i = 0; i < lookupCount; i += 1) {
      const station = (planLength * i) / lookupCount;
      if (getFeatureLineElevationAtStation(resolved, station) == null) throw new Error('elev null');
    }
  });

  const boundsMs = timeMedian(RUNS, () => {
    buildCadSpatialIndex(makeProject([entity]));
  });

  const gradeEditMs = timeMedian(RUNS, () => {
    const result = setFeatureLineGradeSpan(entity, { fromStation: 0, toStation: planLength, gradeRatio: 0.02 });
    if (!result.ok) throw new Error(`grade edit failed: ${result.reason}`);
  });

  let breaklinePoints = 0;
  const surfaceMs = timeMedian(RUNS, () => {
    const collected = collectSources(project, surface);
    if (collected.breaklineError != null) throw new Error(`breakline error: ${collected.breaklineError}`);
    if (collected.breaklines.length !== 1) throw new Error('expected one breakline chain');
    breaklinePoints = collected.breaklines[0]!.length;
  });

  return {
    vertices: vertexCount,
    planLength,
    resolve: resolveMs,
    stationTotal,
    stationPerLookupUs: (stationTotal * 1000) / lookupCount,
    elevTotal,
    elevPerLookupUs: (elevTotal * 1000) / lookupCount,
    bounds: boundsMs,
    gradeEdit: gradeEditMs,
    surfaceBreakline: surfaceMs,
    breaklinePoints,
  };
};

const exponent = (from: number, to: number, fromScale: number, toScale: number): string =>
  ((Math.log(to / from) / Math.log(toScale / fromScale)) as number).toFixed(2);

const fmt = (value: number): string => value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0);

const main = (): void => {
  const rows = SCALES.map(measure);

  console.log('\nPhase 20A feature-line perf (median ms unless noted; mixed line+arc chain, arcs every 10th course)\n');
  console.log(
    '| vertices | planLen m | resolve | station /N | µs/lookup | elev /N | µs/lookup | bounds | gradeEdit | surfaceBreakline | breakline pts |',
  );
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    console.log(
      `| ${row.vertices.toLocaleString('en-US')} | ${row.planLength.toFixed(0)} | ${fmt(row.resolve)} | ${fmt(row.stationTotal)} | ${row.stationPerLookupUs.toFixed(2)} | ${fmt(row.elevTotal)} | ${row.elevPerLookupUs.toFixed(2)} | ${fmt(row.bounds)} | ${fmt(row.gradeEdit)} | ${fmt(row.surfaceBreakline)} | ${row.breaklinePoints.toLocaleString('en-US')} |`,
    );
  }

  console.log('\nScaling exponents vs previous scale (1.00 = linear, 2.00 = quadratic):');
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1]!;
    const current = rows[i]!;
    console.log(
      `  ${previous.vertices.toLocaleString('en-US')} -> ${current.vertices.toLocaleString('en-US')}: ` +
        `resolve ${exponent(previous.resolve, current.resolve, previous.vertices, current.vertices)} · ` +
        `station ${exponent(previous.stationTotal, current.stationTotal, previous.vertices, current.vertices)} · ` +
        `elev ${exponent(previous.elevTotal, current.elevTotal, previous.vertices, current.vertices)} · ` +
        `bounds ${exponent(previous.bounds, current.bounds, previous.vertices, current.vertices)} · ` +
        `gradeEdit ${exponent(previous.gradeEdit, current.gradeEdit, previous.vertices, current.vertices)} · ` +
        `surfaceBreakline ${exponent(previous.surfaceBreakline, current.surfaceBreakline, previous.vertices, current.vertices)} · ` +
        `breaklinePts ${exponent(previous.breaklinePoints, current.breaklinePoints, previous.vertices, current.vertices)}`,
    );
  }
  console.log('');
};

main();
