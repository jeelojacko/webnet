/**
 * Phase 18K sample-line / cross-section performance probe (measurement only).
 *
 * Deterministic synthetic grid TINs (mulberry32, fixed seeds — no unfixed
 * randomness): planar z = 100 + 0.1x + 0.05y plus jitter; two surfaces share
 * the XY footprint (base and design, zOffset differs) so cut/fill overlays
 * exist. Grid index is built with buildSurfaceGrid (the exact fn the surface
 * builder uses). Sample lines run perpendicular to a straight alignment that
 * spans the grid; each line is fully covered (coveredWidth > 0).
 *
 * Cost split mirrors what the production path does:
 *   prepMs   = request assembly incl. toSectionMesh flat-array conversion
 *              (the exact fn SurfaceSectionService.requestInternal runs)
 *   cloneMs  = structuredClone(request) — the worker structured-clone proxy
 *   workerMs = one batched `sections` op through createSurfaceWorkerHandler
 *              with the DEFAULT engine extractor (real tangent/frame/walk)
 *   resultMs = structuredClone(results) — result-transfer proxy
 *   ingestMs = applySectionExtractionSuccess + cache.get per pair
 *
 * Batching proof: one request with N lines + the mesh once vs N requests
 * each carrying the same mesh once. The batch transfer cost is O(mesh); the
 * per-line loop is O(mesh x N). Numbers reported, never gated.
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when a fixture/extract throws or the result
 * is non-deterministic between runs.
 *
 * Usage: `npx tsx scripts/phase18kSectionPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { computeCadSampleLineRevision } from '../src/engine/cad/cadSectionRevision';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import { applySectionExtractionSuccess } from '../src/engine/cad/sectionCache';
import {
  buildSampleLineDisplayLayers,
  buildSectionViewDisplayLayers,
} from '../src/engine/cad/cadSectionView';
import type { CadSurfaceSectionResult } from '../src/engine/cad/cadSectionTypes';
import type {
  CadAlignmentElement,
  CadProject,
  CadSampleLine,
  CadSampleLineGroup,
  CadSectionView,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import {
  createSurfaceWorkerHandler,
  type SurfaceSectionsLineInput,
  type SurfaceSectionsRequest,
  type SurfaceSectionsSourceMesh,
} from '../src/workers/surfaceWorkerHandler';

const QUICK = process.argv.includes('--quick');
const RUNS = QUICK ? 1 : 3;
const BUDGET_MS = QUICK ? 30000 : 120000;

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

interface GridTin {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: ReturnType<typeof buildSurfaceGrid>;
  flatPoints: number[];
  flatTriangles: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  triCount: number;
}

/** Deterministic grid TIN with ~target triangle count; zOffset varies surface. */
const buildGridTin = (targetTris: number, zSeed: number, zOffset: number): GridTin => {
  const cells = Math.max(1, Math.ceil(targetTris / 2));
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const rand = mulberry32(zSeed);
  const jitter: number[] = [];
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) jitter.push(rand() * 2);
  }
  const at = (i: number, j: number): number => i * (rows + 1) + j;
  const points: Array<{ x: number; y: number; z: number }> = [];
  const sourcePoints: Array<{ entityId: string; x: number; y: number; z: number }> = [];
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) {
      const x = i * 10;
      const y = j * 10;
      const z = 100 + i * 0.5 + j * 0.3 + jitter[at(i, j)]! + zOffset;
      points.push({ x, y, z });
      sourcePoints.push({ entityId: `p${at(i, j)}`, x, y, z });
    }
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      triangles.push([a, b, c]);
      triangles.push([a, c, d]);
    }
  }
  const flatPoints: number[] = [];
  for (const p of points) flatPoints.push(p.x, p.y, p.z);
  const flatTriangles: number[] = [];
  for (const t of triangles) flatTriangles.push(t[0], t[1], t[2]);
  return {
    points,
    triangles,
    grid: buildSurfaceGrid(sourcePoints, triangles),
    flatPoints,
    flatTriangles,
    minX: 0,
    minY: 0,
    maxX: cols * 10,
    maxY: rows * 10,
    triCount: triangles.length,
  };
};

const centerYOf = (tin: GridTin): number => (tin.minY + tin.maxY) / 2;

const straightAlignment = (tin: GridTin): CadAlignmentElement[] => [
  {
    kind: 'line',
    start: { x: tin.minX, y: centerYOf(tin) },
    end: { x: tin.maxX, y: centerYOf(tin) },
  },
];

const alignmentLength = (tin: GridTin): number => tin.maxX - tin.minX;

/** `count` sample lines evenly spaced along the alignment, fully crossing the grid. */
const makeLines = (tin: GridTin, count: number): CadSampleLine[] => {
  const length = alignmentLength(tin);
  const width = (tin.maxY / 2) * 0.9;
  const lines: CadSampleLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      id: `line-${index}`,
      rawStation: ((index + 1) / (count + 1)) * length,
      leftWidth: width,
      rightWidth: width,
      skewDeg: index % 2 === 0 ? 0 : 15,
    });
  }
  return lines;
};

/** The exact flat-array conversion SurfaceSectionService.toSectionMesh runs. */
const toSourceMesh = (
  surfaceId: string,
  tin: GridTin,
  surfaceRevision: string,
): SurfaceSectionsSourceMesh => {
  const flatPoints: number[] = [];
  for (const point of tin.points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of tin.triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return {
    surfaceId,
    surfaceRevision,
    mesh: { points: flatPoints, triangles: flatTriangles, grid: tin.grid },
  };
};

const toLineInput = (line: CadSampleLine, revision: string): SurfaceSectionsLineInput => ({
  lineId: line.id,
  lineRevision: revision,
  rawStation: line.rawStation,
  leftWidth: line.leftWidth,
  rightWidth: line.rightWidth,
  skewDeg: line.skewDeg,
});

let requestCounter = 0;

const buildRequest = (
  groupId: string,
  sources: SurfaceSectionsSourceMesh[],
  lines: SurfaceSectionsLineInput[],
  elements: CadAlignmentElement[],
): SurfaceSectionsRequest => ({
  groupId,
  groupRevision: 'secg1:perf',
  drawingId: 'drawing-perf',
  alignmentElements: elements,
  startStation: 0,
  sources,
  lines,
});

const runSectionsWorker = (
  request: SurfaceSectionsRequest,
): Promise<{ ms: number; results: CadSurfaceSectionResult[] }> => {
  let resolvePosted: (_results: CadSurfaceSectionResult[]) => void = () => {};
  const posted = new Promise<CadSurfaceSectionResult[]>((resolve) => { resolvePosted = resolve; });
  const handler = createSurfaceWorkerHandler({
    loadBuilder: () => Promise.reject(new Error('unused')),
    postMessage: (message) => {
      if (message.type === 'sections-success') resolvePosted(message.results);
    },
    defer: (callback) => callback(),
  });
  const start = performance.now();
  requestCounter += 1;
  handler.handleMessage({ type: 'sections', requestId: `perf-${requestCounter}`, request });
  return posted.then((results) => ({ ms: performance.now() - start, results }));
};

const countSamples = (results: CadSurfaceSectionResult[]): number => {
  let samples = 0;
  for (const result of results) {
    for (const segment of result.segments) samples += segment.samples.length;
  }
  return samples;
};

interface ScaleCase {
  tris: number;
  lines: number;
}

const SCALES: ScaleCase[] = (() => {
  const tris = QUICK ? [1000, 10000] : [1000, 10000, 50000, 100000];
  const lines = QUICK ? [10, 100] : [10, 100, 500];
  const out: ScaleCase[] = [];
  for (const t of tris) for (const l of lines) out.push({ tris: t, lines: l });
  return out;
})();

let failed = false;

/**
 * One matrix cell: 3 runs of prep/clone/worker/result/ingest. Fixture build
 * is outside the timed runs (per-scale). Results must be deterministic.
 */
const runScale = async (scale: ScaleCase): Promise<void> => {
  const started = performance.now();
  let base: GridTin;
  let design: GridTin;
  try {
    base = buildGridTin(scale.tris, 0x18c1, 0);
    design = buildGridTin(scale.tris, 0x18c2, 1);
  } catch (error) {
    console.log(`${scale.tris}/${scale.lines}\tFIXTURE FAILED: ${error instanceof Error ? error.message : error}`);
    return;
  }
  const elements = straightAlignment(base);
  const lines = makeLines(base, scale.lines);
  const prepTimes: number[] = [];
  const cloneTimes: number[] = [];
  const workerTimes: number[] = [];
  const resultTimes: number[] = [];
  const ingestTimes: number[] = [];
  const cache = createCadSectionCache('perf');
  let firstJson = '';
  let firstResults: CadSurfaceSectionResult[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    if (performance.now() - started > BUDGET_MS) break;
    let start = performance.now();
    const sources = [
      toSourceMesh('surf-base', base, 'srev1:perf-base'),
      toSourceMesh('surf-design', design, 'srev1:perf-design'),
    ];
    const lineInputs = lines.map((line) => toLineInput(line, `secl1:${line.id}`));
    const request = buildRequest(`grp-${scale.tris}-${scale.lines}`, sources, lineInputs, elements);
    prepTimes.push(performance.now() - start);
    start = performance.now();
    const cloned = structuredClone(request);
    cloneTimes.push(performance.now() - start);
    const worker = await runSectionsWorker(cloned);
    workerTimes.push(worker.ms);
    start = performance.now();
    structuredClone(worker.results);
    resultTimes.push(performance.now() - start);
    start = performance.now();
    for (const result of worker.results) {
      const applied = applySectionExtractionSuccess(cache, result.lineId, result.surfaceId, {
        currentRevision: result.revision,
        result,
      });
      if (!applied) {
        console.error(`${scale.tris}/${scale.lines}: CACHE APPLY REJECTED`);
        failed = true;
        return;
      }
      cache.get(result.lineId, result.surfaceId, result.revision);
    }
    ingestTimes.push(performance.now() - start);
    const json = JSON.stringify(worker.results);
    if (run === 0) {
      firstJson = json;
      firstResults = worker.results;
    } else if (json !== firstJson) {
      console.error(`${scale.tris}/${scale.lines}: NON-DETERMINISTIC worker result between runs`);
      failed = true;
      return;
    }
  }
  if (prepTimes.length === 0) {
    console.log(`${scale.tris}/${scale.lines}\tTIME BUDGET EXCEEDED before first run — skipped`);
    return;
  }
  const pairCount = scale.lines * 2;
  if (firstResults.length !== pairCount) {
    console.error(`${scale.tris}/${scale.lines}: expected ${pairCount} results, got ${firstResults.length}`);
    failed = true;
    return;
  }
  const coveredMin = firstResults.reduce((min, r) => Math.min(min, r.coveredWidth), Infinity);
  console.log(
    `${scale.tris}/${scale.lines}\t${base.triCount}\t${median(prepTimes).toFixed(1)}\t`
    + `${median(cloneTimes).toFixed(1)}\t${median(workerTimes).toFixed(1)}\t`
    + `${median(resultTimes).toFixed(1)}\t${median(ingestTimes).toFixed(2)}\t`
    + `${pairCount}\t${countSamples(firstResults)}\t${coveredMin.toFixed(1)}\t`
    + `${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}`,
  );
};

console.log('# Phase 18K section performance — group extraction matrix');
console.log(`# runs=${RUNS} budget=${BUDGET_MS}ms per scale; medians; ms unless noted`);
console.log('case\ttris\tprepMs\tcloneMs\tworkerMs\tresultMs\tingestMs\tpairs\tsamples\tcoveredMin\theapMiB');
for (const scale of SCALES) {
  await runScale(scale);
  if (failed) break;
}

/** Batch vs per-line: the GO batching gate. Transfer cost must be O(mesh). */
const runBatchingProof = async (): Promise<void> => {
  const scale = QUICK ? { tris: 10000, lines: 50 } : { tris: 50000, lines: 100 };
  const base = buildGridTin(scale.tris, 0x18c1, 0);
  const design = buildGridTin(scale.tris, 0x18c2, 1);
  const elements = straightAlignment(base);
  const lines = makeLines(base, scale.lines);
  const batchSource = [
    toSourceMesh('surf-base', base, 'srev1:perf-base'),
    toSourceMesh('surf-design', design, 'srev1:perf-design'),
  ];
  const batchRequest = buildRequest('grp-batch', batchSource, lines.map((line) => toLineInput(line, `secl1:${line.id}`)), elements);
  const batchCloneStart = performance.now();
  const batchCloned = structuredClone(batchRequest);
  const batchCloneMs = performance.now() - batchCloneStart;
  const batch = await runSectionsWorker(batchCloned);
  // Per-line: N requests, each re-carrying the SAME mesh once (no batching).
  const perLineCloneTimes: number[] = [];
  let perLineWorkerMs = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const sources = [
      toSourceMesh('surf-base', base, 'srev1:perf-base'),
      toSourceMesh('surf-design', design, 'srev1:perf-design'),
    ];
    const request = buildRequest(`grp-line-${index}`, sources, [toLineInput(lines[index]!, `secl1:${lines[index]!.id}`)], elements);
    const cloneStart = performance.now();
    const cloned = structuredClone(request);
    perLineCloneTimes.push(performance.now() - cloneStart);
    const worker = await runSectionsWorker(cloned);
    perLineWorkerMs += worker.ms;
    if (worker.results.length !== 2) {
      console.error('batching proof: per-line worker returned unexpected result count');
      failed = true;
      return;
    }
  }
  const perLineCloneMs = perLineCloneTimes.reduce((sum, value) => sum + value, 0);
  console.log('');
  console.log('# Batching proof (mesh not recopied per line)');
  console.log(`# scale tris=${base.triCount} lines=${lines.length} sources=2`);
  console.log('path\tcloneMs\tworkerMs\trequests\tmeshCopies');
  console.log(
    `batched\t${batchCloneMs.toFixed(1)}\t${batch.ms.toFixed(1)}\t1\t2`
    + `\t(${batch.results.length} results)`,
  );
  console.log(
    `per-line\t${perLineCloneMs.toFixed(1)}\t${perLineWorkerMs.toFixed(1)}\t${lines.length}`
    + `\t${lines.length * 2}`,
  );
  const cloneRatio = batchCloneMs > 0 ? perLineCloneMs / batchCloneMs : Infinity;
  const workerRatio = batch.ms > 0 ? perLineWorkerMs / batch.ms : Infinity;
  console.log(`# clone ratio per-line/batched = ${cloneRatio.toFixed(1)}x; worker ratio = ${workerRatio.toFixed(1)}x`);
  if (batch.results.length !== lines.length * 2) {
    console.error('batching proof: batched result count mismatch');
    failed = true;
  }
};

/** Multi-surface: 100 lines x 2 vs x 3 sources, one mesh per source per batch. */
const runMultiSurface = async (): Promise<void> => {
  const scale = QUICK ? { tris: 10000, lines: 50 } : { tris: 50000, lines: 100 };
  const tins = [
    buildGridTin(scale.tris, 0x18c1, 0),
    buildGridTin(scale.tris, 0x18c2, 1),
    buildGridTin(scale.tris, 0x18c3, 2),
  ];
  const elements = straightAlignment(tins[0]!);
  const lines = makeLines(tins[0]!, scale.lines);
  const lineInputs = lines.map((line) => toLineInput(line, `secl1:${line.id}`));
  console.log('');
  console.log('# Multi-surface batch (100 lines; one mesh per source per request)');
  console.log('surfaces	tris	cloneMs	workerMs	msPerPair	results	meshCopies');
  for (const surfaceCount of [2, 3]) {
    const sources = tins.slice(0, surfaceCount).map((tin, index) =>
      toSourceMesh(`surf-${index}`, tin, `srev1:perf-${index}`),
    );
    const request = buildRequest('grp-multi', sources, lineInputs, elements);
    const cloneStart = performance.now();
    const cloned = structuredClone(request);
    const cloneMs = performance.now() - cloneStart;
    const worker = await runSectionsWorker(cloned);
    const expected = scale.lines * surfaceCount;
    if (worker.results.length !== expected) {
      console.error(`multi-surface: expected ${expected} results, got ${worker.results.length}`);
      failed = true;
      return;
    }
    console.log(
      `${surfaceCount}\t${tins[0]!.triCount}\t${cloneMs.toFixed(1)}\t${worker.ms.toFixed(1)}`
      + `\t${(worker.ms / expected).toFixed(2)}\t${worker.results.length}\t${surfaceCount}`,
    );
  }
};

/** Section-view prep: N aggregated views (grid + paths + bounded labels). */
const runViewPrep = async (): Promise<void> => {
  const tin = buildGridTin(10000, 0x18c1, 0);
  const elements = straightAlignment(tin);
  const lines = makeLines(tin, 100);
  const surfaces: CadSurface[] = [
    { id: 'surf-base', name: 'Existing', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
    { id: 'surf-design', name: 'Design', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
  ];
  const group: CadSampleLineGroup = {
    id: 'grp-view',
    name: 'Corridor',
    alignmentEntityId: 'align-perf',
    surfaceSources: [
      { surfaceId: 'surf-base', sectionStyleId: 'section-style-existing' },
      { surfaceId: 'surf-design', sectionStyleId: 'section-style-proposed' },
    ],
    sampleLines: lines,
    areaComparison: { baseSurfaceId: 'surf-base', comparisonSurfaceId: 'surf-design' },
  };
  const views: CadSectionView[] = lines.map((line, index) => ({
    id: `view-${index}`,
    name: `Section ${index}`,
    sampleLineGroupId: 'grp-view',
    sampleLineId: line.id,
    sourceSurfaceIds: ['surf-base', 'surf-design'],
    insertionX: 0,
    insertionY: 0,
    horizontalScale: 1,
    verticalExaggeration: 1,
    datumMode: 'auto',
    offsetGridInterval: 10,
    elevationGridInterval: 1,
    showCutFill: true,
    styleId: 'section-style-existing',
    layerId: 'general',
  }));
  const drawing = createBlankCadDrawingDocument({ name: 'Section Perf', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      { id: 'align-perf', type: 'alignment', layerId: 'general', visible: true, locked: false, name: 'Perf CL', elements, startStation: 0 },
    ],
    surfaces,
    sampleLineGroups: [group],
    sectionViews: views,
  };
  // Real content revisions so currentSectionResult (view prep) resolves the
  // cache entries the worker just produced.
  const alignmentView = { id: 'align-perf', elements, startStation: 0 };
  const baseRevision = computeCadSurfaceSourceRevision(project, surfaces[0]!);
  const designRevision = computeCadSurfaceSourceRevision(project, surfaces[1]!);
  const sources = [
    toSourceMesh('surf-base', tin, baseRevision),
    toSourceMesh('surf-design', tin, designRevision),
  ];
  const lineInputs = lines.map((line) =>
    toLineInput(line, computeCadSampleLineRevision(line, alignmentView, 'align-perf')),
  );
  const request = buildRequest('grp-view', sources, lineInputs, elements);
  const worker = await runSectionsWorker(structuredClone(request));
  const cache = createCadSectionCache('perf-view');
  for (const result of worker.results) {
    applySectionExtractionSuccess(cache, result.lineId, result.surfaceId, {
      currentRevision: result.revision,
      result,
    });
  }
  console.log('');
  console.log('# Section-view prep (aggregated grid + paths + bounded labels)');
  console.log('views\tms\tmsPerView\tlayers\ttracePaths\toffsetTicks\televLabels\tlabelsTruncated');
  for (const count of [10, 50, 100]) {
    const times: number[] = [];
    let layerSummary: ReturnType<typeof buildSectionViewDisplayLayers> = [];
    for (let run = 0; run < RUNS; run += 1) {
      const scoped = { ...project, sectionViews: views.slice(0, count) };
      const start = performance.now();
      layerSummary = buildSectionViewDisplayLayers(scoped, cache);
      times.push(performance.now() - start);
    }
    const tracePaths = layerSummary.reduce((sum, layer) => sum + layer.tracePaths.length, 0);
    const ticks = layerSummary.reduce((sum, layer) => sum + layer.offsetTicks.length, 0);
    const elevLabels = layerSummary.reduce((sum, layer) => sum + layer.elevationLabels.length, 0);
    const truncated = layerSummary.some((layer) => layer.labelsTruncated);
    if (layerSummary.length !== count) {
      console.error(`view prep: expected ${count} layers, got ${layerSummary.length}`);
      failed = true;
    }
    console.log(
      `${count}\t${median(times).toFixed(2)}\t${(median(times) / count).toFixed(3)}`
      + `\t${layerSummary.length}\t${tracePaths}\t${ticks}\t${elevLabels}\t${truncated}`,
    );
  }
};

/** Plan display: 500 sample lines aggregated + label bounding (default cap 200). */
const runPlanDisplay = (): void => {
  const tin = buildGridTin(10000, 0x18c1, 0);
  const elements = straightAlignment(tin);
  const lines = makeLines(tin, 500);
  const group: CadSampleLineGroup = {
    id: 'grp-plan',
    name: 'Corridor 500',
    alignmentEntityId: 'align-perf',
    surfaceSources: [],
    sampleLines: lines,
  };
  const drawing = createBlankCadDrawingDocument({ name: 'Plan Perf', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      { id: 'align-perf', type: 'alignment', layerId: 'general', visible: true, locked: false, name: 'Perf CL', elements, startStation: 0 },
    ],
    surfaces: [],
    sampleLineGroups: [group],
  };
  console.log('');
  console.log('# Plan display (500 sample lines aggregate + label bounding)');
  console.log('maxLabels\tms\tlines\tlabelsShown\tlabelsTruncated\tbounds');
  for (const maxLabels of [200, 500, 0]) {
    const times: number[] = [];
    let layers: ReturnType<typeof buildSampleLineDisplayLayers> = [];
    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now();
      layers = buildSampleLineDisplayLayers(project, { maxLabels });
      times.push(performance.now() - start);
    }
    const totalLines = layers.reduce((sum, layer) => sum + layer.lines.length, 0);
    const shown = layers.reduce((sum, layer) => sum + layer.lines.filter((line) => line.labelShown).length, 0);
    const truncated = layers.some((layer) => layer.labelsTruncated);
    const hasBounds = layers.every((layer) => layer.bounds != null);
    console.log(`${maxLabels}\t${median(times).toFixed(2)}\t${totalLines}\t${shown}\t${truncated}\t${hasBounds}`);
  }
};

await runBatchingProof();
if (!failed) await runMultiSurface();
if (!failed) await runViewPrep();
if (!failed) runPlanDisplay();

if (failed) process.exit(1);
