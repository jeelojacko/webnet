/**
 * Phase 18F fix-up — multi-group surface build performance probe (measurement only).
 *
 * Builds synthetic deterministic grids (mulberry32 seed) at 100 / 1,000 /
 * 10,000 points (plus 50,000 when 10k is comfortably fast) behind TWO
 * overlapping point groups (ALL + LOW-Z half, exercising the union path),
 * and times buildCadSurface end to end (source resolution + triangulation +
 * constraints + domain filter) plus display-edge generation
 * (surfaceTrianglesPathD + surfaceBoundaryPathD).
 *
 * No src/ behavior changes, no tier wiring. Timing verdicts are advisory
 * (printed, not gated); the process fails only when a build is not ok.
 *
 * Usage: `npx tsx scripts/phase18fSurfacePerf.ts [--quick]`
 *   --quick trims scales to 100 / 1,000 and reduces reps (smoke check).
 */
import { performance } from 'node:perf_hooks';

import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  surfaceBoundaryPathD,
  surfaceTrianglesPathD,
} from '../src/engine/cad/cadSurfaceView';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [100, 1000] : [100, 1000, 10000, 50000];
const WARMUPS = QUICK ? 1 : 1;
const RUNS = QUICK ? 3 : 5;

/** Deterministic PRNG (mulberry32, fixed seed). */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const buildGridProject = (count: number): { project: CadProject; surface: CadSurface } => {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const rand = mulberry32(0x18f);
  const entities: CadSurveyPointEntity[] = [];
  let index = 0;
  for (let row = 0; row < rows && entities.length < count; row += 1) {
    for (let col = 0; col < cols && entities.length < count; col += 1) {
      index += 1;
      entities.push({
        id: `pt-${index}`,
        type: 'survey-point',
        layerId: 'points',
        visible: true,
        locked: false,
        stationId: `${col}-${row}`,
        x: col * 10 + rand() * 2,
        y: row * 10 + rand() * 2,
        z: 100 + col * 0.5 + row * 0.3 + rand(),
        pointClass: 'free',
        source: 'parsed-input',
      });
    }
  }
  const project = {
    version: 2,
    id: 'proj-perf',
    name: 'perf',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'meters',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    pointGroups: [
      { id: 'g-all', name: 'All', query: {}, priority: 0 },
      { id: 'g-low', name: 'Low', query: { elevationMax: 103 }, priority: 1 },
    ],
    entities,
    cogoComputations: [],
    bounds: null,
  } as unknown as CadProject;
  const surface: CadSurface = {
    id: 's-perf',
    name: 'perf surface',
    definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-all', 'g-low'] } },
  };
  return { project, surface };
};

let failed = false;
console.log('scale\tbuildMs(med)\tedgesMs(med)\ttriangles\tvertices');
for (const scale of SCALES) {
  const { project, surface } = buildGridProject(scale);
  for (let warm = 0; warm < WARMUPS; warm += 1) buildCadSurface(project, surface);
  const buildTimes: number[] = [];
  const edgeTimes: number[] = [];
  let triangles = 0;
  let vertices = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    const result = buildCadSurface(project, surface);
    buildTimes.push(performance.now() - start);
    if (result.outcome !== 'ok') {
      console.error(`scale ${scale}: build ${result.outcome} (${result.reasonCodes.join(',')})`);
      failed = true;
      break;
    }
    triangles = result.stats.triangleCount;
    vertices = result.points.length;
    const edgeStart = performance.now();
    surfaceTrianglesPathD({ revision: result.revision, points: result.points, triangles: result.triangles, stats: result.stats });
    surfaceBoundaryPathD({ revision: result.revision, points: result.points, triangles: result.triangles, stats: result.stats });
    edgeTimes.push(performance.now() - edgeStart);
  }
  if (!failed) {
    console.log(`${scale}\t${median(buildTimes).toFixed(1)}\t${median(edgeTimes).toFixed(1)}\t${triangles}\t${vertices}`);
  }
}
if (failed) process.exit(1);
