/**
 * Phase 18G production-path surface performance probe (measurement only).
 *
 * Splits the production rebuild cost at 100 / 1k / 10k / 50k (+ 100k
 * attempt) into: request-construction (buildSurfaceBuildRequest) /
 * worker-build (buildSurfaceMeshFromRequest, the exact fn the worker runs)
 * / transfer (structuredClone of the worker payload) / cache-ingest
 * (applySurfaceBuildSuccess) / display-prep (triangles + boundary path D).
 * Also reports mesh memory by representation (vertices / triangles /
 * adjacency / edge flags / grid index / display paths / transfer bytes)
 * and the display-edge generation split behind the compact-edge-list
 * recommendation. Browser production-path numbers (first-frame included)
 * come from scripts/phase18gSurfaceBrowserPerf.ts; this Node bench is the
 * supplemental engine baseline.
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when a build is not ok.
 *
 * Usage: `npx tsx scripts/phase18gSurfacePerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { buildSurfaceMeshFromRequest } from '../src/workers/surfaceWorkerHandler';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
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
const SCALES = QUICK ? [100, 1000] : [100, 1000, 10000, 50000, 100000];
const RUNS = QUICK ? 3 : 5;

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
  project.surfaces = [surface];
  return { project, surface };
};

let failed = false;
console.log('scale\trequestMs\tworkerMs\ttransferMs\tingestMs\tedgesMs\ttotalMs\ttris\tverts');
for (const scale of SCALES) {
  const { project, surface } = buildGridProject(scale);
  // Warm-up + reference result through the sync engine (parity anchor).
  let reference;
  try {
    reference = buildCadSurface(project, surface);
  } catch (error) {
    console.log(`${scale}\tBUILD FAILED: ${error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : error}`);
    continue;
  }
  if (reference.outcome !== 'ok') {
    console.error(`scale ${scale}: sync build ${reference.outcome} (${reference.reasonCodes.join(',')})`);
    failed = true;
    break;
  }
  const revision = reference.revision;
  const requestTimes: number[] = [];
  const workerTimes: number[] = [];
  const transferTimes: number[] = [];
  const ingestTimes: number[] = [];
  const edgeTimes: number[] = [];
  let transferBytes = 0;
  let lastMesh = reference;
  for (let run = 0; run < RUNS; run += 1) {
    let start = performance.now();
    const request = buildSurfaceBuildRequest(project, surface.id, revision);
    if (!request) {
      console.error(`scale ${scale}: no request`);
      failed = true;
      break;
    }
    requestTimes.push(performance.now() - start);
    start = performance.now();
    const mesh = buildSurfaceMeshFromRequest(request);
    workerTimes.push(performance.now() - start);
    if (mesh.outcome !== 'ok' || mesh.triangles.length !== reference.triangles.length) {
      console.error(`scale ${scale}: worker mismatch (${mesh.outcome}, ${mesh.triangles.length} vs ${reference.triangles.length} tris)`);
      failed = true;
      break;
    }
    start = performance.now();
    const payload = structuredClone({
      points: mesh.points,
      triangles: mesh.triangles,
      stats: mesh.stats,
      grid: mesh.grid,
      adjacency: mesh.adjacency,
      edgeKinds: mesh.edgeKinds,
    });
    transferTimes.push(performance.now() - start);
    transferBytes = JSON.stringify(payload).length;
    lastMesh = { ...reference, points: mesh.points, triangles: mesh.triangles, stats: mesh.stats };
    start = performance.now();
    const cache = createCadSurfaceCache('perf');
    applySurfaceBuildSuccess(project, cache, surface.id, revision, {
      outcome: mesh.outcome,
      points: mesh.points,
      triangles: mesh.triangles,
      stats: mesh.stats,
      grid: mesh.grid,
      adjacency: mesh.adjacency,
      edgeKinds: mesh.edgeKinds,
    });
    ingestTimes.push(performance.now() - start);
    start = performance.now();
    const displayMesh = {
      revision,
      points: mesh.points,
      triangles: mesh.triangles,
      stats: mesh.stats,
      grid: mesh.grid,
      adjacency: mesh.adjacency,
      edgeKinds: mesh.edgeKinds,
    };
    surfaceTrianglesPathD(displayMesh);
    surfaceBoundaryPathD(displayMesh);
    edgeTimes.push(performance.now() - start);
  }
  if (failed) break;
  const total = median(requestTimes) + median(workerTimes) + median(transferTimes)
    + median(ingestTimes) + median(edgeTimes);
  console.log(
    `${scale}\t${median(requestTimes).toFixed(1)}\t${median(workerTimes).toFixed(1)}`
    + `\t${median(transferTimes).toFixed(1)}\t${median(ingestTimes).toFixed(1)}`
    + `\t${median(edgeTimes).toFixed(1)}\t${total.toFixed(1)}`
    + `\t${reference.stats.triangleCount}\t${reference.points.length} (xfer ${kb(transferBytes)})`,
  );
  // Memory by representation (JSON-byte accounting on the final mesh).
  const { points, triangles } = lastMesh;
  const full = buildCadSurface(project, surface);
  const gridCells = full.grid.cells.size;
  let gridEntries = 0;
  for (const list of full.grid.cells.values()) gridEntries += list.length;
  console.log(
    `  mem: points ${kb(JSON.stringify(points).length)} | tris ${kb(JSON.stringify(triangles).length)}`
    + ` | adjacency ${kb(JSON.stringify(full.adjacency).length)} | edgeKinds ${kb(JSON.stringify(full.edgeKinds).length)}`
    + ` | grid ${gridCells} cells/${gridEntries} refs ${kb(JSON.stringify([...full.grid.cells]).length)}`
    + ` | heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB`,
  );
}
if (failed) process.exit(1);
