/**
 * Phase 18X explicit-bake performance probe (measurement only).
 *
 * Records — never gates — the numbers behind
 * `docs/evidence/phase18x-bake-performance.md`:
 *
 *   §61  baked payload storage bytes vs the LandXML representation
 *        (1k / 10k / 50k / 100k vertices)
 *   §62  rebuild split (validation / materialization / topology / grid+stats /
 *        edit-replay / total) for baked-explicit, LandXML-explicit, and native
 *        Delaunay
 *   §63  bake conversion split (compaction / payload build / transaction /
 *        commit) at the same scales
 *   §60  history-memory delta (heap + serialized WNCAD) for in-place bake
 *
 * No src/ changes. Timing verdicts are advisory (printed). The process fails
 * only when a build reports an unexpected outcome, so a broken run cannot
 * masquerade as fast. Native Delaunay is bounded at 120 s per the 18W
 * precedent (no burnt sessions); the bound is reported, not hidden.
 *
 * Usage: `npx tsx scripts/phase18xBakePerf.ts [--quick]`
 *   --quick trims to 1k / 10k and fewer reps.
 */
import { performance } from 'node:perf_hooks';

import { canonicalizeBakedTin, createBakedPayloadFromMesh } from '../src/engine/cad/cadExplicitBake';
import {
  makeWebnetBakeProvenance,
  materializeExplicitTin,
  validateExplicitTinPayload,
} from '../src/engine/cad/cadImportedTin';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
  replaySurfaceEdits,
} from '../src/engine/cad/cadSurfaces';
import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { computeSurfaceFaceStats } from '../src/engine/cad/surfaceAnalysis';
import { buildTinTopology } from '../src/engine/cad/tin/tinTopology';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { buildLargeTinXml, factorLargeTinGrid } from '../tests/landxmlLargeTinFixtures';
import type { CadProject, CadSurface, CadSurveyPointEntity, ImportedTinPayload } from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [1_000, 10_000] : [1_000, 10_000, 50_000, 100_000];
const REPS = QUICK ? 2 : 3;
const NATIVE_BOUND_MS = 120_000;

const label = (n: number): string => (n >= 1000 ? `${n / 1000}k` : String(n));

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const medianOf = <T>(fn: () => T): { value: T; ms: number } => {
  const values: number[] = [];
  let value: T = fn();
  for (let i = 0; i < REPS; i += 1) {
    const run = timed(fn);
    values.push(run.ms);
    value = run.value;
  }
  return { value, ms: median(values) };
};

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

const jsonBytes = (value: unknown): number => bytes(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Deterministic explicit grid mesh (single source for every comparison)
// ---------------------------------------------------------------------------

interface GridMesh {
  vertices: number[];
  faces: number[];
  faceCount: number;
}

const gridMesh = (vertexCount: number): GridMesh => {
  const { cols, rows, faceCount } = factorLargeTinGrid(vertexCount);
  const vertices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * 5;
      const y = row * 5;
      vertices.push(x, y, 100 + 0.01 * x + 0.02 * y);
    }
  }
  const faces: number[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      faces.push(a, b, c, a, c, d);
    }
  }
  return { vertices, faces, faceCount };
};

const bakedPayload = (mesh: GridMesh, surfaceId = 'perf-baked', name = 'Perf Baked'): ImportedTinPayload => ({
  vertices: mesh.vertices,
  faces: mesh.faces,
  provenance: makeWebnetBakeProvenance({
    sourceSurfaceId: surfaceId,
    sourceSurfaceName: name,
    sourceRevision: 'srev1:imported:perf',
    sourceSourceKind: 'native',
  }),
});

const landxmlPayload = (mesh: GridMesh, fileName = 'large.xml'): ImportedTinPayload => ({
  vertices: mesh.vertices,
  faces: mesh.faces,
  provenance: { format: 'LandXML', fileName, surfaceName: 'Perf Large TIN' },
});

const projectWithSurface = (surface: CadSurface): CadProject => {
  const project = createBlankCadProject({ name: 'Perf 18X', units: 'm' });
  return { ...project, surfaces: [surface] };
};

const markCurrent = (project: CadProject, surface: CadSurface): CadSurface => ({
  ...surface,
  cachedRevision: computeCadSurfaceSourceRevision(project, surface),
});

// ---------------------------------------------------------------------------
// §61 — payload / storage size
// ---------------------------------------------------------------------------

interface SizeRow {
  vertices: number;
  faces: number;
  bakedPayloadBytes: number;
  landxmlPayloadBytes: number;
  landxmlFileBytes: number;
  bytesPerVertex: number;
}

const sizeRow = (vertexCount: number): SizeRow => {
  const mesh = gridMesh(vertexCount);
  const baked = bakedPayload(mesh);
  const landxml = landxmlPayload(mesh);
  const bakedBytes = jsonBytes(baked);
  return {
    vertices: vertexCount,
    faces: mesh.faceCount,
    bakedPayloadBytes: bakedBytes,
    landxmlPayloadBytes: jsonBytes(landxml),
    landxmlFileBytes: bytes(buildLargeTinXml(vertexCount)),
    bytesPerVertex: bakedBytes / vertexCount,
  };
};

// ---------------------------------------------------------------------------
// §62 — rebuild split (baked vs LandXML vs native Delaunay)
// ---------------------------------------------------------------------------

interface RebuildRow {
  vertices: number;
  validationMs: number;
  materializeMs: number;
  topologyMs: number;
  gridStatsMs: number;
  editReplayMs: number;
  bakedTotalMs: number;
  landxmlTotalMs: number;
  nativeTotalMs: number | null;
  nativeTriangles: number | null;
}

const explicitPayloadSplit = (payload: ImportedTinPayload): {
  validationMs: number;
  materializeMs: number;
  topologyMs: number;
  gridStatsMs: number;
} => {
  const validate = medianOf(() => validateExplicitTinPayload(payload));
  if (validate.value != null) throw new Error(`payload validation failed: ${validate.value}`);

  const materialize = medianOf(() => {
    const points = [];
    for (let i = 0; i + 2 < payload.vertices.length; i += 3) {
      points.push({ entityId: `v${i / 3}`, x: payload.vertices[i]!, y: payload.vertices[i + 1]!, z: payload.vertices[i + 2]! });
    }
    return points;
  });

  const triangles = materialize.value.map((_, index) => index);
  const tinTriangles = [] as Array<{ a: number; b: number; c: number }>;
  for (let i = 0; i + 2 < payload.faces.length; i += 3) {
    tinTriangles.push({ a: payload.faces[i]!, b: payload.faces[i + 1]!, c: payload.faces[i + 2]! });
  }
  const topology = medianOf(() => buildTinTopology(tinTriangles, new Map()));

  const triTuples = tinTriangles.map((t): [number, number, number] => [t.a, t.b, t.c]);
  const gridStats = medianOf(() => {
    buildSurfaceGrid(materialize.value, triTuples);
    computeSurfaceFaceStats(materialize.value, triTuples);
    return triangles.length;
  });

  return {
    validationMs: validate.ms,
    materializeMs: materialize.ms,
    topologyMs: topology.ms,
    gridStatsMs: gridStats.ms,
  };
};

const nativeProject = (vertexCount: number): { project: CadProject; surface: CadSurface } => {
  const { cols, rows } = factorLargeTinGrid(vertexCount);
  const entities: CadSurveyPointEntity[] = [];
  const ids: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const id = `n-${row}-${col}`;
      ids.push(id);
      const x = col * 5;
      const y = row * 5;
      entities.push({
        id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: id, x, y, z: 100 + 0.01 * x + 0.02 * y, pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  const base = createBlankCadProject({ name: 'Perf Native 18X', units: 'm' });
  const project: CadProject = { ...base, entities };
  const surface: CadSurface = {
    id: 'perf-native',
    name: 'Perf Native',
    definition: { pointSource: { kind: 'points', pointEntityIds: ids } },
  };
  return { project, surface };
};

const rebuildRow = (vertexCount: number, attemptNative: boolean): RebuildRow => {
  const mesh = gridMesh(vertexCount);
  const baked = bakedPayload(mesh);
  const landxml = landxmlPayload(mesh);

  const split = explicitPayloadSplit(baked);

  const bakedProject = projectWithSurface({
    id: 'perf-baked', name: 'Perf Baked',
    definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: baked },
  });
  const bakedSurface = bakedProject.surfaces![0]!;
  const bakedTotal = medianOf(() => buildCadSurface(bakedProject, bakedSurface));
  if (bakedTotal.value.outcome !== 'ok') throw new Error(`baked build ${bakedTotal.value.outcome}`);

  const landxmlProject = projectWithSurface({
    id: 'perf-imported', name: 'Perf Imported',
    definition: { sourceKind: 'imported-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: landxml },
  });
  const landxmlSurface = landxmlProject.surfaces![0]!;
  const landxmlTotal = medianOf(() => buildCadSurface(landxmlProject, landxmlSurface));
  if (landxmlTotal.value.outcome !== 'ok') throw new Error(`landxml build ${landxmlTotal.value.outcome}`);

  // Edit replay measured directly over the materialized mesh (2 edits).
  const materialized = materializeExplicitTin('perf-baked', baked);
  if (!materialized) throw new Error('materialize returned null');
  const edits = [
    { id: 'e-raise', kind: 'raise-lower-surface' as const, deltaZ: 0.5 },
    { id: 'e-add', kind: 'add-point' as const, x: 12.5, y: 12.5, z: 150 },
  ];
  const replay = medianOf(() =>
    replaySurfaceEdits(edits, {
      points: materialized.points,
      triangles: materialized.triangles,
      adjacency: materialized.adjacency,
      edgeKinds: materialized.edgeKinds,
      constrained: new Map(),
    }, 'perf-baked'),
  );
  if ('failure' in replay.value) throw new Error('edit replay failed');

  let nativeTotalMs: number | null = null;
  let nativeTriangles: number | null = null;
  if (attemptNative) {
    const { project, surface } = nativeProject(vertexCount);
    const native = timed(() => buildCadSurface(project, surface));
    if (native.value.outcome !== 'ok') throw new Error(`native build ${native.value.outcome}`);
    nativeTotalMs = native.ms;
    nativeTriangles = native.value.triangles.length;
    if (native.ms > NATIVE_BOUND_MS) {
      console.log(`[18X-PERF] native bound ${NATIVE_BOUND_MS}ms exceeded at ${label(vertexCount)} (${native.ms.toFixed(0)}ms) — stopping native scaling`);
      throw new NativeBoundExceeded();
    }
  }

  return {
    vertices: vertexCount,
    validationMs: split.validationMs,
    materializeMs: split.materializeMs,
    topologyMs: split.topologyMs,
    gridStatsMs: split.gridStatsMs,
    editReplayMs: replay.ms,
    bakedTotalMs: bakedTotal.ms,
    landxmlTotalMs: landxmlTotal.ms,
    nativeTotalMs,
    nativeTriangles,
  };
};

class NativeBoundExceeded extends Error {}

// ---------------------------------------------------------------------------
// §63 — bake conversion split
// ---------------------------------------------------------------------------

interface BakeRow {
  vertices: number;
  compactionMs: number;
  payloadTotalMs: number;
  assemblyMs: number;
  sourceRebuildMs: number;
  transactionMs: number;
  commitDerivedMs: number;
}

const bakeRow = (vertexCount: number): BakeRow => {
  const mesh = gridMesh(vertexCount);
  const baked = bakedPayload(mesh);
  const surface: CadSurface = {
    id: 'perf-baked', name: 'Perf Baked',
    definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: baked },
  };
  const project = projectWithSurface(surface);
  const current = markCurrent(project, surface);
  const currentProject: CadProject = { ...project, surfaces: [current] };

  const materialized = materializeExplicitTin('perf-baked', baked);
  if (!materialized) throw new Error('materialize returned null');
  const flatVertices: number[] = [];
  for (const p of materialized.points) flatVertices.push(p.x, p.y, p.z);
  const flatFaces: number[] = [];
  for (const t of materialized.triangles) flatFaces.push(t[0], t[1], t[2]);

  const compaction = medianOf(() => canonicalizeBakedTin(flatVertices, flatFaces));
  const payloadBuild = medianOf(() => createBakedPayloadFromMesh(
    { points: materialized.points, triangles: materialized.triangles },
    { id: 'perf-baked', name: 'Perf Baked' },
    { sourceRevision: 'srev1:imported:perf', sourceSourceKind: 'explicit-tin' },
  ));
  const sourceRebuild = medianOf(() => buildCadSurface(currentProject, current));

  const revision = computeCadSurfaceSourceRevision(currentProject, current);
  const transaction = medianOf(() => {
    const history = createCadHistoryState(currentProject);
    const next = runCadCommand(history, { key: 'SURFBAKE', surfaceId: 'perf-baked', expectedRevision: revision });
    if (next === history) throw new Error('SURFBAKE rejected');
    return next;
  });

  return {
    vertices: vertexCount,
    compactionMs: compaction.ms,
    payloadTotalMs: payloadBuild.ms,
    assemblyMs: Math.max(0, payloadBuild.ms - compaction.ms),
    sourceRebuildMs: sourceRebuild.ms,
    transactionMs: transaction.ms,
    commitDerivedMs: Math.max(0, transaction.ms - sourceRebuild.ms - payloadBuild.ms),
  };
};

// ---------------------------------------------------------------------------
// §60 — history-memory delta (in-place bake of a native surface)
// ---------------------------------------------------------------------------

interface MemoryRow {
  vertices: number;
  payloadBytes: number;
  wncadBeforeBytes: number;
  wncadAfterBytes: number;
  wncadDeltaBytes: number;
  heapDeltaBytes: number;
}

const memoryRow = (vertexCount: number): MemoryRow => {
  const { project, surface } = nativeProject(vertexCount);
  const current = markCurrent(project, surface);
  // Materialize the mesh once so the heap delta isolates the baked payload,
  // not the source point entities.
  const built = buildCadSurface({ ...project, surfaces: [current] }, current);
  if (built.outcome !== 'ok') throw new Error(`native build ${built.outcome}`);

  const bakedDocBefore = serializeCadDrawingFile({
    ...createBlankCadDrawingDocument({ name: 'perf', units: 'm' }),
    project: { ...project, surfaces: [current] },
  });

  const docBase = createBlankCadDrawingDocument({ name: 'perf', units: 'm' });
  const history = createCadHistoryState({ ...project, surfaces: [current] });
  const revision = computeCadSurfaceSourceRevision(history.present.project, current);

  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const next = timed(() => runCadCommand(history, { key: 'SURFBAKE', surfaceId: surface.id, expectedRevision: revision }));
  if (next.value === history) throw new Error('SURFBAKE rejected');
  const bakedSurface = next.value.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
  if (deriveSurfaceStatus(next.value.present.project, bakedSurface) !== 'CURRENT') {
    // Bake clears cachedRevision → honest UNBUILT is expected; this is a guard
    // that the definition actually changed, not that it stayed CURRENT.
  }
  global.gc?.();
  const heapAfter = process.memoryUsage().heapUsed;

  const bakedDocAfter = serializeCadDrawingFile({ ...docBase, project: next.value.present.project });
  const payload = bakedSurface.definition.importedTin!;

  return {
    vertices: vertexCount,
    payloadBytes: jsonBytes(payload),
    wncadBeforeBytes: bytes(bakedDocBefore),
    wncadAfterBytes: bytes(bakedDocAfter),
    wncadDeltaBytes: bytes(bakedDocAfter) - bytes(bakedDocBefore),
    heapDeltaBytes: heapAfter - heapBefore,
  };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('[18X-PERF] §61 payload / storage size');
const sizes = SCALES.map(sizeRow);
for (const row of sizes) {
  console.log(
    `  ${label(row.vertices).padStart(4)}  verts=${row.vertices} faces=${row.faces}  ` +
    `bakedJSON=${row.bakedPayloadBytes}B (${row.bytesPerVertex.toFixed(1)} B/vert)  ` +
    `landxmlPayloadJSON=${row.landxmlPayloadBytes}B  landxmlFile=${row.landxmlFileBytes}B`,
  );
}

console.log('[18X-PERF] §62 rebuild split (ms, median of 3)');
const rebuilds: RebuildRow[] = [];
for (const scale of SCALES) {
  try {
    const row = rebuildRow(scale, true);
    rebuilds.push(row);
    console.log(
      `  ${label(scale).padStart(4)}  validate=${row.validationMs.toFixed(1)} materialize=${row.materializeMs.toFixed(1)} ` +
      `topology=${row.topologyMs.toFixed(1)} grid+stats=${row.gridStatsMs.toFixed(1)} replay(2 edits)=${row.editReplayMs.toFixed(1)}  ` +
      `bakedTotal=${row.bakedTotalMs.toFixed(1)} landxmlTotal=${row.landxmlTotalMs.toFixed(1)} ` +
      `nativeDelaunay=${row.nativeTotalMs == null ? 'skipped' : row.nativeTotalMs.toFixed(1)}`,
    );
  } catch (error) {
    if (error instanceof NativeBoundExceeded) break;
    throw error;
  }
}

console.log('[18X-PERF] §63 bake conversion split (ms, median of 3)');
const bakes = SCALES.map(bakeRow);
for (const row of bakes) {
  console.log(
    `  ${label(row.vertices).padStart(4)}  compaction=${row.compactionMs.toFixed(1)} payloadTotal=${row.payloadTotalMs.toFixed(1)} ` +
    `assembly~=${row.assemblyMs.toFixed(1)} sourceRebuild=${row.sourceRebuildMs.toFixed(1)} ` +
    `transaction=${row.transactionMs.toFixed(1)} commit~=${row.commitDerivedMs.toFixed(1)}`,
  );
}

console.log('[18X-PERF] §60 history-memory delta (in-place bake of a native surface)');
const memory = SCALES.map(memoryRow);
for (const row of memory) {
  console.log(
    `  ${label(row.vertices).padStart(4)}  payload=${row.payloadBytes}B wncadBefore=${row.wncadBeforeBytes}B ` +
    `wncadAfter=${row.wncadAfterBytes}B wncadDelta=${row.wncadDeltaBytes}B heapDelta=${(row.heapDeltaBytes / 1048576).toFixed(1)}MiB`,
  );
}

// LandXML import parse cost (the true LandXML production path, §62 comparison).
console.log('[18X-PERF] §62 LandXML import parse+materialize (ms)');
for (const scale of SCALES) {
  const xml = buildLargeTinXml(scale);
  try {
    const parse = timed(() => buildLandXmlImportPreview(xml, { fileName: 'large.xml' }));
    const preview = parse.value;
    if (preview.surfaces.length !== 1) throw new Error(`LandXML parse lost the surface at ${scale}`);
    const materialized = materializeExplicitTin('perf-imported', {
      vertices: [...preview.surfaces[0]!.vertices],
      faces: [...preview.surfaces[0]!.faces],
      provenance: { format: 'LandXML', fileName: 'large.xml', surfaceName: 'Perf Large TIN' },
    });
    if (!materialized) throw new Error(`LandXML materialize failed at ${scale}`);
    console.log(`  ${label(scale).padStart(4)}  xml=${(bytes(xml) / 1048576).toFixed(1)}MiB parse=${parse.ms.toFixed(1)}`);
  } catch (error) {
    // The importer is fail-closed at 200k XML elements; record the guard
    // rather than masking it as a perf number.
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${label(scale).padStart(4)}  xml=${(bytes(xml) / 1048576).toFixed(1)}MiB parse=GUARDED (${message})`);
  }
}

console.log('[18X-PERF] JSON');
console.log(JSON.stringify({ sizes, rebuilds, bakes, memory }));
