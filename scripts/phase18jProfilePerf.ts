/**
 * Phase 18J surface-profile performance probe (measurement only).
 *
 * Deterministic synthetic grid TINs (mulberry32, fixed seeds — no unfixed
 * randomness): planar z = 100 + 0.1x + 0.05y plus jitter, two triangles
 * per cell, engine grid index via buildSurfaceGrid (the exact fn the
 * surface builder uses). Splits the cost into: full extraction
 * (extractSurfaceProfile) / candidate-index query (candidateTriangles over
 * the alignment bbox) / worker round trip (createSurfaceWorkerHandler with
 * the default engine extractor, the exact path the profile worker op runs)
 * / result-cache ingest (applyProfileExtractionSuccess + get) / view path
 * gen (buildProfileViewDisplayLayers on a minimal drawing with a seeded
 * cache). Topology events + arc sample counts come from the result.
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when a compute throws or the worker
 * result differs from the direct extract.
 *
 * Usage: `npx tsx scripts/phase18jProfilePerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { buildProfileViewDisplayLayers } from '../src/engine/cad/cadProfileView';
import type { CadAlignmentElement, CadProject } from '../src/engine/cad/cadTypes';
import { applyProfileExtractionSuccess, createCadProfileCache } from '../src/engine/cad/profileCache';
import type { CadSurfaceGrid } from '../src/engine/cad/cadSurfaces';
import {
  candidateTriangles,
} from '../src/engine/cad/profiles/profileMeshLocate';
import {
  extractSurfaceProfile,
  type CadSurfaceProfileResult,
  type ProfileExtractionMesh,
} from '../src/engine/cad/profiles/profileExtraction';
import { createSurfaceWorkerHandler } from '../src/workers/surfaceWorkerHandler';

const QUICK = process.argv.includes('--quick');
const RUNS = 3;

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
  mesh: ProfileExtractionMesh;
  flatPoints: number[];
  flatTriangles: number[];
  grid: CadSurfaceGrid;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  triCount: number;
}

/** Deterministic grid TIN with ~target triangle count. */
const buildGridTin = (targetTris: number): GridTin => {
  const cells = Math.max(1, Math.ceil(targetTris / 2));
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const rand = mulberry32(0x18c1);
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const x = i * 10;
      const y = j * 10;
      points.push({ x, y, z: 100 + 0.1 * x + 0.05 * y + (rand() - 0.5) * 2 });
    }
  }
  const at = (i: number, j: number): number => j * (cols + 1) + i;
  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      triangles.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
      triangles.push([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  const grid = buildSurfaceGrid(
    points.map((p, index) => ({ entityId: `p${index}`, x: p.x, y: p.y, z: p.z })),
    triangles,
  );
  const flatPoints: number[] = [];
  for (const p of points) flatPoints.push(p.x, p.y, p.z);
  const flatTriangles: number[] = [];
  for (const t of triangles) flatTriangles.push(t[0], t[1], t[2]);
  return {
    mesh: { points, triangles, grid },
    flatPoints,
    flatTriangles,
    grid,
    minX: 0,
    minY: 0,
    maxX: cols * 10,
    maxY: rows * 10,
    triCount: triangles.length,
  };
};

const straightAlignment = (tin: GridTin): CadAlignmentElement[] => [
  { kind: 'line', start: { x: tin.minX - 20, y: (tin.minY + tin.maxY) / 2 }, end: { x: tin.maxX + 20, y: (tin.minY + tin.maxY) / 2 } },
];

const mixedAlignment = (tin: GridTin): CadAlignmentElement[] => {
  const midY = (tin.minY + tin.maxY) / 2;
  const midX = (tin.minX + tin.maxX) / 2;
  const radius = Math.max(10, (tin.maxX - tin.minX) / 8);
  return [
    { kind: 'line', start: { x: tin.minX - 20, y: midY }, end: { x: midX, y: midY } },
    { kind: 'arc', center: { x: midX, y: midY - radius }, radius, startAngleDeg: 90, endAngleDeg: -90 },
  ];
};

/** Serpentine line/arc mix with `elements` entries (arc-heavy). */
const longMixedAlignment = (tin: GridTin, elements: number): CadAlignmentElement[] => {
  const out: CadAlignmentElement[] = [];
  let x = tin.minX;
  const y = (tin.minY + tin.maxY) / 2;
  let headingUp = true;
  for (let index = 0; index < elements; index += 1) {
    if (index % 2 === 0) {
      out.push({ kind: 'line', start: { x, y: headingUp ? y : y + 20 }, end: { x: x + 10, y: headingUp ? y : y + 20 } });
      x += 10;
    } else {
      out.push({
        kind: 'arc',
        center: { x: x + 5, y: (headingUp ? y : y + 20) + (headingUp ? 5 : -5) },
        radius: 5,
        startAngleDeg: headingUp ? 180 : 0,
        endAngleDeg: headingUp ? 0 : 180,
      });
      x += 10;
      headingUp = !headingUp;
    }
  }
  return out;
};

const countEvents = (result: CadSurfaceProfileResult): { events: number; arcSamples: number; samples: number } => {
  let events = 0;
  let samples = 0;
  let arcSamples = 0;
  for (const segment of result.segments) {
    for (const sample of segment.samples) {
      samples += 1;
      if (sample.eventKind != null) events += 1;
      if ((sample.alignmentElementIndex ?? 0) > 0) arcSamples += 1;
    }
  }
  return { events, arcSamples, samples };
};

const countArcElements = (elements: CadAlignmentElement[]): number =>
  elements.filter((entry) => entry.kind === 'arc').length;

const runWorkerExtract = async (
  tin: GridTin,
  elements: CadAlignmentElement[],
  revision: string,
): Promise<{ ms: number; result: CadSurfaceProfileResult }> => {
  let resolvePosted: (_result: CadSurfaceProfileResult) => void = () => {};
  const posted = new Promise<CadSurfaceProfileResult>((resolve) => { resolvePosted = resolve; });
  const handler = createSurfaceWorkerHandler({
    loadBuilder: async () => async () => { throw new Error('unused'); },
    postMessage: (message) => {
      if (message.type === 'profile-success') resolvePosted(message.result);
    },
  });
  const start = performance.now();
  handler.handleMessage({
    type: 'profile',
    requestId: 'perf',
    request: {
      profileId: 'p-perf',
      profileRevision: revision,
      surfaceRevision: 'srev1:surf@perf',
      alignmentElements: elements.map((entry) => ({ ...entry })),
      startStation: 0,
      mesh: { points: tin.flatPoints, triangles: tin.flatTriangles, grid: tin.grid },
    },
  });
  const result = await posted;
  return { ms: performance.now() - start, result };
};

const buildViewProject = (elements: CadAlignmentElement[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Profile Perf', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      {
        id: 'align-perf',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'Perf CL',
        elements,
        startStation: 0,
      },
    ],
    surfaces: [
      {
        id: 'surf-perf',
        name: 'Perf EG',
        definition: { pointSource: { kind: 'points', pointEntityIds: [] } },
        cachedRevision: null,
      },
    ],
    surfaceProfiles: [
      { id: 'prof-perf', name: 'Perf Profile', alignmentEntityId: 'align-perf', surfaceId: 'surf-perf' },
    ],
    profileViews: [
      {
        id: 'view-perf',
        name: 'Perf View',
        alignmentEntityId: 'align-perf',
        profileIds: ['prof-perf'],
        insertionX: 0,
        insertionY: 0,
        horizontalScale: 1,
        verticalExaggeration: 1,
        datumMode: 'auto',
      },
    ],
  };
};

interface ScaleCase {
  label: string;
  tris: number;
  kind: 'straight' | 'mixed';
}

const SCALES: ScaleCase[] = QUICK
  ? [
    { label: '1k-straight', tris: 1000, kind: 'straight' },
    { label: '1k-mixed', tris: 1000, kind: 'mixed' },
    { label: '10k-mixed', tris: 10000, kind: 'mixed' },
  ]
  : [
    { label: '1k-straight', tris: 1000, kind: 'straight' },
    { label: '1k-mixed', tris: 1000, kind: 'mixed' },
    { label: '10k-straight', tris: 10000, kind: 'straight' },
    { label: '10k-mixed', tris: 10000, kind: 'mixed' },
    { label: '50k-mixed', tris: 50000, kind: 'mixed' },
    { label: '100k-mixed', tris: 100000, kind: 'mixed' },
  ];

const LONG_CASES: Array<{ label: string; elements: number }> = QUICK
  ? [{ label: 'long-100el', elements: 100 }]
  : [{ label: 'long-100el', elements: 100 }, { label: 'long-1000el', elements: 1000 }];

let failed = false;
console.log('case\textractMs\tcandMs\tworkerMs\tingestMs\tviewMs\tsamples\tevents\tarcSamples\tsegments\tcovered\tgap');

const runCase = async (label: string, tin: GridTin, elements: CadAlignmentElement[]): Promise<void> => {
  const revision = `prev1:p-perf@case-${label}`;
  const extractTimes: number[] = [];
  const candTimes: number[] = [];
  const workerTimes: number[] = [];
  const ingestTimes: number[] = [];
  const viewTimes: number[] = [];
  let first: CadSurfaceProfileResult | null = null;
  let counts = { events: 0, arcSamples: 0, samples: 0 };
  const cache = createCadProfileCache('perf');
  const project = buildViewProject(elements);
  const surface = project.surfaces![0]!;
  const alignment = project.entities[0]!;
  if (alignment.type !== 'alignment') throw new Error('perf alignment misbuilt');
  const surfaceRevision = computeCadSurfaceSourceRevision(project, surface);
  const viewRevision = computeSurfaceProfileRevision(
    { id: 'prof-perf', alignmentEntityId: 'align-perf', surfaceId: 'surf-perf' },
    { id: 'align-perf', elements, startStation: 0 },
    surfaceRevision,
  );
  for (let run = 0; run < RUNS; run += 1) {
    let start = performance.now();
    const result = extractSurfaceProfile({
      profileId: 'p-perf',
      revision,
      alignmentElements: elements,
      startStation: 0,
      mesh: tin.mesh,
    });
    extractTimes.push(performance.now() - start);
    if (run === 0) {
      first = result;
      counts = countEvents(result);
    }
    start = performance.now();
    candidateTriangles(tin.mesh, tin.minX - 25, tin.minY - 25, tin.maxX + 25, tin.maxY + 25);
    candTimes.push(performance.now() - start);
    const worker = await runWorkerExtract(tin, elements, revision);
    workerTimes.push(worker.ms);
    if (JSON.stringify(worker.result.segments) !== JSON.stringify(result.segments)) {
      console.error(`${label}: WORKER MISMATCH vs direct extract`);
      failed = true;
      return;
    }
    start = performance.now();
    const applied = applyProfileExtractionSuccess(cache, 'p-perf', { currentRevision: viewRevision, result: { ...result, revision: viewRevision } });
    cache.get('p-perf', viewRevision);
    ingestTimes.push(performance.now() - start);
    if (!applied) {
      console.error(`${label}: CACHE APPLY REJECTED`);
      failed = true;
      return;
    }
    start = performance.now();
    buildProfileViewDisplayLayers(project, cache);
    viewTimes.push(performance.now() - start);
  }
  if (!first) return;
  console.log(
    `${label}\t${median(extractTimes).toFixed(1)}\t${median(candTimes).toFixed(2)}\t`
    + `${median(workerTimes).toFixed(1)}\t${median(ingestTimes).toFixed(3)}\t${median(viewTimes).toFixed(2)}`
    + `\t${counts.samples}\t${counts.events}\t${counts.arcSamples}\t${first.segments.length}`
    + `\t${first.coveredLength.toFixed(1)}\t${first.gapLength.toFixed(1)}`
    + `\t(${tin.triCount} tris, ${elements.length} el/${countArcElements(elements)} arc, heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB)`,
  );
};

for (const scale of SCALES) {
  const started = performance.now();
  const tin = buildGridTin(scale.tris);
  const elements = scale.kind === 'straight' ? straightAlignment(tin) : mixedAlignment(tin);
  await runCase(scale.label, tin, elements);
  if (failed) break;
  if (performance.now() - started > 90000) {
    console.log(`${scale.label}\tTIME BUDGET EXCEEDED (>90s) — remaining scales skipped`);
    break;
  }
}
if (!failed) {
  const tin10k = buildGridTin(10000);
  for (const longCase of LONG_CASES) {
    await runCase(longCase.label, tin10k, longMixedAlignment(tin10k, longCase.elements));
    if (failed) break;
  }
}
if (failed) process.exit(1);
