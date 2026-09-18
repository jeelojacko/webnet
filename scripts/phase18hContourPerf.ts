/**
 * Phase 18H contour performance evidence (measurement only).
 *
 * Reuses the 18G Node-harness style (scripts/phase18gSurfacePerf.ts):
 * deterministic grids, warm-up + measured runs, median. Per scale
 * (1k / 10k / 50k, + 100k attempt) splits contour derivation into:
 * mesh-clone (structuredClone of the worker input arrays) / extraction
 * (extractSurfaceContours, the exact fn the worker runs) / result-clone
 * (structuredClone of the contour set) / cache-ingest
 * (createCadSurfaceContourCache set) / display-prep (contourPathsToPathD
 * per kind). Also reports label placement (deriveContourLabels) + cap
 * (cullContourLabels vs SURFACE_CONTOUR_LABEL_CAP), contour memory by
 * JSON-byte accounting, and the pathological small-interval block
 * (SURFACE_CONTOUR_LEVEL_LIMIT asserted, never a hang).
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when a TIN build fails or the level
 * limit does NOT block.
 *
 * Usage: `npx tsx scripts/phase18hContourPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { createCadSurfaceContourCache } from '../src/engine/cad/surfaceContourCache';
import {
  contourPathsToPathD,
  cullContourLabels,
  deriveContourLabels,
  SURFACE_CONTOUR_LABEL_CAP,
} from '../src/engine/cad/cadSurfaceContourView';
import { computeContourLevels } from '../src/engine/cad/surfaceContours/contourLevels';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import type { CadSurfaceContourLabel } from '../src/engine/cad/cadDisplayTypes';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [1000, 10000] : [1000, 10000, 50000, 100000];
const RUNS = 3;
const FIVE_MIN_MS = 5 * 60 * 1000;

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

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

// Same deterministic grid as phase18gSurfacePerf.ts (union-path fixture
// shape not needed here — contours read one mesh; elevation range spans
// ~180 m so interval 1 m yields a realistic ~180 levels).
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
    id: 'proj-contour-perf',
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
    pointGroups: [{ id: 'g-all', name: 'All', query: {}, priority: 0 }],
    entities,
    cogoComputations: [],
    bounds: null,
  } as unknown as CadProject;
  const surface: CadSurface = {
    id: 's-perf',
    name: 'perf surface',
    definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-all'] } },
  };
  project.surfaces = [surface];
  return { project, surface };
};

const SPEC = { minorInterval: 1, majorEvery: 5, baseElevation: 0 };
const t0 = performance.now();
let failed = false;

console.log('scale\tlevels\tsegments\tpaths\textractMs\tmeshCloneMs\tresultCloneMs\tingestMs\tdisplayMs\ttotalMs\ttris');
let largest: { scale: number; minor: number; major: number } | null = null;
for (const scale of SCALES) {
  if (performance.now() - t0 > FIVE_MIN_MS) {
    console.log(`${scale}\tSKIPPED: 5-minute budget exceeded (earlier scales consumed the run budget)`);
    continue;
  }
  const { project, surface } = buildGridProject(scale);
  let tin;
  try {
    tin = buildCadSurface(project, surface);
  } catch (error) {
    console.log(`${scale}\tTIN BUILD FAILED: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    failed = true;
    break;
  }
  if (tin.outcome !== 'ok') {
    console.error(`scale ${scale}: TIN build ${tin.outcome} (${tin.reasonCodes.join(',')})`);
    failed = true;
    break;
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of tin.points) {
    if (typeof p.z === 'number' && Number.isFinite(p.z)) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  const levels = computeContourLevels(minZ, maxZ, SPEC);
  const extractTimes: number[] = [];
  const meshCloneTimes: number[] = [];
  const resultCloneTimes: number[] = [];
  const ingestTimes: number[] = [];
  const displayTimes: number[] = [];
  let segments = 0;
  let paths = 0;
  let lastSet = extractSurfaceContours({
    surfaceId: surface.id,
    surfaceRevision: tin.revision,
    styleRevision: 'crev-perf',
    points: tin.points,
    triangles: tin.triangles,
    levels,
  });
  for (let run = 0; run < RUNS; run += 1) {
    let start = performance.now();
    const meshInput = structuredClone({ points: tin.points, triangles: tin.triangles });
    meshCloneTimes.push(performance.now() - start);
    start = performance.now();
    const set = extractSurfaceContours({
      surfaceId: surface.id,
      surfaceRevision: tin.revision,
      styleRevision: 'crev-perf',
      points: meshInput.points,
      triangles: meshInput.triangles,
      levels,
    });
    extractTimes.push(performance.now() - start);
    segments = set.stats.segmentCount;
    paths = set.stats.minorPathCount + set.stats.majorPathCount;
    start = performance.now();
    const payload = structuredClone(set);
    resultCloneTimes.push(performance.now() - start);
    start = performance.now();
    const cache = createCadSurfaceContourCache('perf');
    cache.set(surface.id, payload);
    ingestTimes.push(performance.now() - start);
    start = performance.now();
    contourPathsToPathD(set.minorPaths);
    contourPathsToPathD(set.majorPaths);
    displayTimes.push(performance.now() - start);
    lastSet = set;
  }
  const total = median(meshCloneTimes) + median(extractTimes) + median(resultCloneTimes)
    + median(ingestTimes) + median(displayTimes);
  console.log(
    `${scale}\t${levels.length}\t${segments}\t${paths}`
    + `\t${median(extractTimes).toFixed(1)}\t${median(meshCloneTimes).toFixed(1)}`
    + `\t${median(resultCloneTimes).toFixed(1)}\t${median(ingestTimes).toFixed(1)}`
    + `\t${median(displayTimes).toFixed(1)}\t${total.toFixed(1)}\t${tin.stats.triangleCount}`,
  );
  console.log(
    `  mem: minorPaths ${kb(JSON.stringify(lastSet.minorPaths).length)}`
    + ` | majorPaths ${kb(JSON.stringify(lastSet.majorPaths).length)}`
    + ` | setTotal ${kb(JSON.stringify(lastSet).length)}`
    + ` | heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB`,
  );
  if (!largest || scale > largest.scale) {
    largest = { scale, minor: lastSet.minorPaths.length, major: lastSet.majorPaths.length };
  }
  if (scale === 10000) {
    // Label placement on the real 10k set (tight spacing => many labels),
    // then cap behavior on synthetic 100/500/1000-label inputs.
    const start = performance.now();
    const placed = deriveContourLabels(lastSet, { spacing: 5, precision: 1, majorOnly: false });
    const placeMs = performance.now() - start;
    const culled = cullContourLabels(placed, null);
    console.log(
      `  labels(real 10k): potential ${placed.length} in ${placeMs.toFixed(1)}ms`
      + ` -> visible ${culled.visible.length} (cap ${SURFACE_CONTOUR_LABEL_CAP}, truncated=${culled.truncated})`,
    );
    const synth = (n: number): CadSurfaceContourLabel[] =>
      Array.from({ length: n }, (_, i) => ({
        elevation: 100 + (i % 50),
        x: i,
        y: i,
        rotationDeg: 0,
        kind: 'minor' as const,
        text: '100.0',
      }));
    for (const n of [100, 500, 1000]) {
      const labels = synth(n);
      const c0 = performance.now();
      const out = cullContourLabels(labels, null);
      const cullMs = performance.now() - c0;
      console.log(
        `  labels(synth ${n}): cull ${cullMs.toFixed(2)}ms`
        + ` -> visible ${out.visible.length} (truncated=${out.truncated})`,
      );
      if (out.visible.length > SURFACE_CONTOUR_LABEL_CAP) {
        console.error(`label cap violated at n=${n}`);
        failed = true;
      }
    }
  }
}

// Pathological small-interval case: must throw the level-limit block,
// never hang or silently bump the interval.
try {
  computeContourLevels(100, 280, { minorInterval: 0.001, majorEvery: 5, baseElevation: 0 });
  console.error('LEVEL-LIMIT: NOT BLOCKED (expected ContourLevelLimitError)');
  failed = true;
} catch (error) {
  const code = (error as { code?: unknown })?.code;
  if (code === 'SURFACE_CONTOUR_LEVEL_LIMIT') {
    console.log(
      `LEVEL-LIMIT: blocked as designed (${(error as Error).message.slice(0, 100)})`,
    );
  } else {
    console.error(`LEVEL-LIMIT: wrong error (${error instanceof Error ? error.message.slice(0, 120) : error})`);
    failed = true;
  }
}

if (failed) process.exit(1);
