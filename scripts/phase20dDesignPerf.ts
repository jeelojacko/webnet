/**
 * Phase 20D Wave-3B — design-surface workflow performance evidence (measurement only).
 *
 * Three measured sections, ACTUAL runs, no extrapolation, no production change:
 *
 *  §101 PATCH BUILD — closed flat square pads subdivided to 4/20/100/1000
 *       source courses.
 *       (a) REAL pipeline: `GROUP_CREATE` -> `computeGradingGroupFromSnapshots`
 *           -> `resolveDesignPatch` (the build `DESIGNPATCH` commits). Sizes
 *           that cannot calc/agree under the 20C gates are RECORDED, not hidden.
 *       (b) PURE STAGES on a synthetic matching two-boundary annulus (the
 *           20D Wave-1B build harness): source-ring derivation, ring
 *           validation/verify, interior triangulation (`earClip`), pad/grading
 *           merge, and a V8 sampling-profiler self-time split of the merge into
 *           canonicalization + stock payload validation + manifold checks.
 *           This gives the stage scaling curve up to 1000 courses even where
 *           the real group shell does not retain every source-boundary edge.
 *
 *  §102 APPLY — `DESIGNAPPLY` against a synthetic Design Surface (explicit TIN)
 *       at ~10k/50k/100k triangles. Cases A small / B medium / C large patch,
 *       D two sequential disjoint patches, E two overlapping patches. Each cell
 *       records the direct `composeSurfaceMeshes` core (the exact call
 *       `DESIGNAPPLY` makes), the pure `preflightDesignApply` end-to-end, and
 *       the `runCadCommand(DESIGNAPPLY)` commit path where run.
 *       NOTE (honesty): patch meshes are synthetic aligned explicit-TIN islands,
 *       not the output of the 20C grading pipeline. Running the full
 *       group-calc + DESIGNPATCH build at 100k would itself be the dominant
 *       cost, so apply cost is measured with the composition core the command
 *       calls on a Design Surface of the stated size.
 *
 *  §103 MULTI-PATCH — cumulative sequential `DESIGNAPPLY` commits on one ~100k
 *       Design Surface, 1/5/20 fine patches, reporting per-apply ms and result
 *       verts/tris growth (no decimation anywhere).
 *
 *  §104 verdict: whether any measured bottleneck justifies reopening 18Z.
 *
 * Usage:
 *   npx tsx scripts/phase20dDesignPerf.ts            # full
 *   npx tsx scripts/phase20dDesignPerf.ts --quick    # smoke (small sizes)
 */
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import * as os from 'node:os';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { preflightDesignApply } from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  buildPadInterior,
  checkFlatRing,
  deriveSourceRing,
  mergePadWithGrading,
  validateSourceRing,
  verifyRingAgainstMesh,
} from '../src/engine/cad/grading/designPatchBuild';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { composeSurfaceMeshes, type ComposeSourceMesh } from '../src/engine/cad/surfaceCompose';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const now = (): number => performance.now();

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const fmt = (value: number): string =>
  value >= 1000 ? value.toFixed(0) : value >= 100 ? value.toFixed(1) : value.toFixed(2);

const timeMed = <T>(fn: () => T, reps: number): { ms: number; result: T } => {
  fn(); // warm-up (JIT + first-call allocation) never enters the median
  const samples: number[] = [];
  let result!: T;
  for (let i = 0; i < reps; i += 1) {
    const start = now();
    result = fn();
    samples.push(now() - start);
  }
  return { ms: median(samples), result };
};
const repsFor = (size: number): number => (QUICK ? 2 : size >= 100000 ? 1 : size >= 50000 ? 2 : 3);

// ---------------------------------------------------------------------------
// Shared synthetic explicit-TIN grids (aligned lattice, flat z=0)
// ---------------------------------------------------------------------------

interface GridPayload { vertices: number[]; faces: number[] }

const alignedGrid = (ox: number, oy: number, side: number, cell: number): GridPayload => {
  const vertices: number[] = [];
  for (let i = 0; i <= side; i += 1) for (let j = 0; j <= side; j += 1) vertices.push(ox + i * cell, oy + j * cell, 0);
  const idx = (i: number, j: number): number => i * (side + 1) + j;
  const faces: number[] = [];
  for (let i = 0; i < side; i += 1) for (let j = 0; j < side; j += 1) {
    const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
    faces.push(a, b, c, a, c, d);
  }
  return { vertices, faces };
};

const tinPayload = (grid: GridPayload): ImportedTinPayload => ({
  ...grid,
  provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
});

const explicitSurface = (id: string, name: string, purpose: CadSurface['purpose'], grid: GridPayload): CadSurface => ({
  id, name, layerId: 'general', styleId: 'style-base', purpose, cachedRevision: null,
  definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: tinPayload(grid) },
});

const composeMesh = (id: string, grid: GridPayload, revision: string): ComposeSourceMesh => ({
  surfaceId: id, surfaceName: id, revision,
  points: Array.from({ length: grid.vertices.length / 3 }, (_, i) => ({ x: grid.vertices[i * 3]!, y: grid.vertices[i * 3 + 1]!, z: grid.vertices[i * 3 + 2]! })),
  triangles: Array.from({ length: grid.faces.length / 3 }, (_, i) => [grid.faces[i * 3]!, grid.faces[i * 3 + 1]!, grid.faces[i * 3 + 2]!] as [number, number, number]),
});

const gridFromTin = (payload: ImportedTinPayload): GridPayload => ({ vertices: payload.vertices, faces: payload.faces });

// ---------------------------------------------------------------------------
// §101 PATCH BUILD
// ---------------------------------------------------------------------------

/** Square pad 0..100 @z=10, `k` line courses per edge (courses = 4k). */
const squareFeatureLine = (k: number, z = 10): CadFeatureLineEntity => {
  const corners: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const vertices: Array<{ id: string; x: number; y: number; z: number }> = [];
  for (let e = 0; e < 4; e += 1) {
    const a = corners[e]!;
    const b = corners[(e + 1) % 4]!;
    for (let i = 0; i < k; i += 1) vertices.push({ id: `v${vertices.length}`, x: a[0] + (b[0] - a[0]) * (i / k), y: a[1] + (b[1] - a[1]) * (i / k), z });
  }
  return { id: 'fl', type: 'feature-line', layerId: 'general', visible: true, locked: false, closed: true, vertices, segmentGeometry: vertices.map(() => ({ kind: 'line' as const })), name: 'Pad', description: '' };
};

const flattenGridTin = (min: number, max: number, step: number): ImportedTinPayload => {
  const xs: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) xs.push(v);
  const vertices: number[] = [];
  for (const y of xs) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) for (let iy = 0; iy + 1 < xs.length; iy += 1) {
    const a = idx(ix, iy), b = idx(ix + 1, iy), c = idx(ix + 1, iy + 1), d = idx(ix, iy + 1);
    faces.push(a, b, c, a, c, d);
  }
  return { vertices, faces, provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' } };
};

const twoTri = (): GridPayload => ({
  vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
  faces: [0, 1, 2, 0, 2, 3],
});

interface PadFixture {
  project: CadProject;
  groupId: string;
  inputs: NonNullable<ReturnType<typeof resolveGroupInputs>>;
  entity: CadFeatureLineEntity;
  result: Extract<ReturnType<typeof computeGradingGroupFromSnapshots>, { ok: true }>['result'];
  groupMs: number;
}

const buildPadFixture = (k: number): PadFixture => {
  const drawing = createBlankCadDrawingDocument({ name: 'phase20d perf', units: 'm' });
  const entity = squareFeatureLine(k);
  const project: CadProject = {
    ...drawing.project,
    entities: [entity],
    surfaces: [
      explicitSurface('tgt', 'EG', undefined, { vertices: [], faces: [] }),
      explicitSurface('coarse', 'EG Coarse', undefined, twoTri()),
    ],
  };
  project.surfaces![0] = { ...project.surfaces![0]!, definition: { ...project.surfaces![0]!.definition, importedTin: flattenGridTin(-60, 160, 20) } };
  const courses = entity.vertices.map((v, i) => ({ vertexAId: v.id, vertexBId: entity.vertices[(i + 1) % entity.vertices.length]!.id }));
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE', name: 'Pad', sourceFeatureLineId: 'fl', sourceCourses: courses,
    targetSurfaceId: 'tgt', side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
  });
  const withGroup = state.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId)!;
  const built = buildCadSurface(withGroup, inputs.target);
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const solved = timeMed(() => computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision, members: inputs.memberSources, side: inputs.group.side,
    criterion: inputs.group.criterion, maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    target: { points: built.points.flatMap((p) => [p.x, p.y, p.z]), triangles: built.triangles.flatMap((t) => [...t]) },
  }), 3);
  if (!solved.result.ok) throw new Error(`group compute failed: ${solved.result.code} ${solved.result.detail ?? ''}`);
  return { project: withGroup, groupId, inputs, entity, result: solved.result.result, groupMs: solved.ms };
};

interface RealPatchRow {
  courses: number;
  groupMs: number;
  shellVerts: number;
  shellTris: number;
  ringVerts: number;
  outcome: string;
  mismatchEdges: number;
  mergedVerts: number;
  mergedTris: number;
  stage: Record<string, number>;
}

/** Count source-ring edges absent from the grading mesh edge set (real-path diagnosis). */
const ringMeshGaps = (ring: readonly number[], mesh: { points: number[]; triangles: number[] }): number => {
  const mk = (i: number): string => `${mesh.points[i * 3]}|${mesh.points[i * 3 + 1]}|${mesh.points[i * 3 + 2]}`;
  const edges = new Set<string>();
  for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
    const a = mk(mesh.triangles[i]!), b = mk(mesh.triangles[i + 1]!), c = mk(mesh.triangles[i + 2]!);
    edges.add([a, b].sort().join('||')); edges.add([b, c].sort().join('||')); edges.add([c, a].sort().join('||'));
  }
  const rk = (i: number): string => `${ring[i * 3]}|${ring[i * 3 + 1]}|${ring[i * 3 + 2]}`;
  const n = ring.length / 3;
  let missing = 0;
  for (let i = 0; i < n; i += 1) if (!edges.has([rk(i), rk((i + 1) % n)].sort().join('||'))) missing += 1;
  return missing;
};

/** Real pipeline build attempt: returns a row even when the ring/mesh gate blocks. */
const runRealPatchBuild = (fx: PadFixture): RealPatchRow => {
  const tol = fx.inputs.group.curveChordTolerance;
  const ringStat = timeMed(() => deriveSourceRing(fx.inputs.group, fx.entity, tol), 5);
  const base: RealPatchRow = {
    courses: fx.entity.vertices.length, groupMs: fx.groupMs,
    shellVerts: fx.result.gradingMesh.points.length / 3, shellTris: fx.result.gradingMesh.triangles.length / 3,
    ringVerts: ringStat.result.ok ? ringStat.result.ring.length / 3 : 0,
    outcome: 'INTERNAL', mismatchEdges: 0, mergedVerts: 0, mergedTris: 0, stage: {},
  };
  if (ringStat.result.ok) base.mismatchEdges = ringMeshGaps(ringStat.result.ring, fx.result.gradingMesh);
  const ringOut = timeMed(() => resolveDesignPatch(fx.project, fx.groupId, fx.result, fx.inputs.revision, true), 3);
  if (ringOut.result.ok) {
    base.outcome = ringOut.result.value.provenance.accuracy;
    base.mergedVerts = ringOut.result.value.points.length / 3;
    base.mergedTris = ringOut.result.value.triangles.length / 3;
    base.stage = { total: ringOut.ms, sourceRing: ringStat.ms };
    return base;
  }
  base.outcome = `${ringOut.result.code}`;
  base.stage = { total: ringOut.ms, sourceRing: ringStat.ms };
  return base;
};

/**
 * Matching two-boundary annulus for a closed CCW polygonal ring: inner boundary
 * is the exact source ring at its Z, outer boundary is the ring offset outward
 * by `offset` at `outerZ`. Mirrors the 20D Wave-1B build harness.
 */
const matchingAnnulus = (ring: readonly number[], offset: number, outerZ: number): { points: number[]; triangles: number[] } => {
  const n = ring.length / 3;
  const nx: number[] = new Array(n).fill(0);
  const ny: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = ring[j * 3]! - ring[i * 3]!;
    const dy = ring[j * 3 + 1]! - ring[i * 3 + 1]!;
    const len = Math.hypot(dx, dy) || 1;
    nx[i] += dy / len; ny[i] += -dx / len; // right normal = outward for a CCW ring
    nx[j] += dy / len; ny[j] += -dx / len;
  }
  const points: number[] = [];
  for (let i = 0; i < n; i += 1) points.push(ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!);
  for (let i = 0; i < n; i += 1) {
    const len = Math.hypot(nx[i]!, ny[i]!) || 1;
    points.push(ring[i * 3]! + (nx[i]! / len) * offset, ring[i * 3 + 1]! + (ny[i]! / len) * offset, outerZ);
  }
  const triangles: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    triangles.push(n + i, n + j, j, n + i, j, i);
  }
  return { points, triangles };
};

interface SyntheticStageRow {
  courses: number;
  ringVerts: number;
  shellVerts: number;
  shellTris: number;
  padTris: number;
  mergedVerts: number;
  mergedTris: number;
  stage: Record<string, number>;
  profiled: Partial<Record<string, number>>;
  error?: string;
}

/** One monolithic pure-stage build (used for the V8 profiler attribution). */
const syntheticBuildOnce = (fx: PadFixture): boolean => {
  const tol = fx.inputs.group.curveChordTolerance;
  const ring = deriveSourceRing(fx.inputs.group, fx.entity, tol);
  if (!ring.ok) return false;
  const flat = checkFlatRing(ring.ring);
  if (!flat.ok) return false;
  const shell = matchingAnnulus(ring.ring, 20, 0);
  if (!verifyRingAgainstMesh(ring.ring, shell).ok) return false;
  const pad = buildPadInterior(ring.ring, flat.padZ);
  if (!pad.ok) return false;
  return mergePadWithGrading(pad.padPoints, pad.padTriangles, shell).ok;
};

const runSyntheticStages = (fx: PadFixture, profile: Partial<Record<string, number>>): SyntheticStageRow => {
  const tol = fx.inputs.group.curveChordTolerance;
  const ringOut = timeMed(() => deriveSourceRing(fx.inputs.group, fx.entity, tol), 5);
  if (!ringOut.result.ok) return { courses: fx.entity.vertices.length, ringVerts: 0, shellVerts: 0, shellTris: 0, padTris: 0, mergedVerts: 0, mergedTris: 0, stage: {}, profiled: profile, error: ringOut.result.code };
  const ring = ringOut.result.ring;
  const checks = timeMed(() => {
    const shell = matchingAnnulus(ring, 20, 0);
    return { valid: validateSourceRing(ring), flat: checkFlatRing(ring), verified: verifyRingAgainstMesh(ring, shell), shell };
  }, 5);
  const valid = checks.result.valid;
  const flat = checks.result.flat;
  const verified = checks.result.verified;
  if (!valid.ok || !flat.ok || !verified.ok) {
    const code = !valid.ok ? valid.code : !flat.ok ? flat.code : 'DESIGN_PATCH_RING_MESH_MISMATCH';
    return { courses: fx.entity.vertices.length, ringVerts: ring.length / 3, shellVerts: checks.result.shell.points.length / 3, shellTris: checks.result.shell.triangles.length / 3, padTris: 0, mergedVerts: 0, mergedTris: 0, stage: {}, profiled: profile, error: code };
  }
  const shell = checks.result.shell;
  const padOut = timeMed(() => buildPadInterior(ring, flat.padZ), 5);
  if (!padOut.result.ok) return { courses: fx.entity.vertices.length, ringVerts: ring.length / 3, shellVerts: shell.points.length / 3, shellTris: shell.triangles.length / 3, padTris: 0, mergedVerts: 0, mergedTris: 0, stage: {}, profiled: profile, error: padOut.result.code };
  const pad = padOut.result;
  const mergeOut = timeMed(() => mergePadWithGrading(pad.padPoints, pad.padTriangles, shell), 3);
  if (!mergeOut.result.ok) return { courses: fx.entity.vertices.length, ringVerts: ring.length / 3, shellVerts: shell.points.length / 3, shellTris: shell.triangles.length / 3, padTris: pad.padTriangles.length / 3, mergedVerts: 0, mergedTris: 0, stage: {}, profiled: profile, error: mergeOut.result.code };
  const totalOut = timeMed(() => syntheticBuildOnce(fx), 3);
  return {
    courses: fx.entity.vertices.length,
    ringVerts: ring.length / 3,
    shellVerts: shell.points.length / 3,
    shellTris: shell.triangles.length / 3,
    padTris: pad.padTriangles.length / 3,
    mergedVerts: mergeOut.result.points.length / 3,
    mergedTris: mergeOut.result.triangles.length / 3,
    stage: { sourceRing: ringOut.ms, ringValidate: checks.ms, interiorTriangulation: padOut.ms, merge: mergeOut.ms, total: totalOut.ms },
    profiled: profile,
  };
};

// ---------------------------------------------------------------------------
// Design-patch stage profiler (V8 sampling; self-time by module + function)
// ---------------------------------------------------------------------------

type StageProfile = Partial<Record<string, number>>;

const patchStageForFrame = (url: string): string => {
  const base = url.split('/').pop() ?? '';
  if (base === 'designPatchRing.ts') return 'sourceRing';
  if (base === 'cadSurfaceEditAddLine.ts') return 'interiorTriangulation';
  if (base === 'cadExplicitBake.ts') return 'canonicalization';
  if (base === 'cadImportedTin.ts') return 'validation';
  if (base === 'designPatchBuild.ts') return 'merge';
  if (base === 'cadTransactionsDesignPatchCommands.ts') return 'engineGlue';
  return 'other';
};

/** Profile one synchronous call and return self-time ms per design-patch stage. */
const profileOnce = async (fn: () => void, intervalUs = 50): Promise<StageProfile> => {
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve, reject) => { session.post(method, params ?? {}, (error, result) => (error ? reject(error) : resolve(result))); });
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: intervalUs });
  await post('Profiler.start');
  fn();
  const stopped = (await post('Profiler.stop')) as { profile: { nodes: Array<{ hitCount?: number; callFrame: { functionName: string; url: string } }> } };
  session.disconnect();
  const out: StageProfile = {};
  for (const node of stopped.profile.nodes) {
    const hits = node.hitCount ?? 0;
    if (hits === 0) continue;
    const key = patchStageForFrame(node.callFrame.url);
    out[key] = (out[key] ?? 0) + (hits * intervalUs) / 1000;
  }
  return out;
};

// ---------------------------------------------------------------------------
// §102 APPLY  (DESIGNAPPLY preflight / commit)
// ---------------------------------------------------------------------------

interface ApplyCell {
  scale: number;
  caseId: string;
  patchTris: number;
  composeMs: number | null;
  preflightMs: number | null;
  commitMs: number | null;
  disposition: string;
  outputVerts: number;
  outputTris: number;
  seamLength: number;
}

const buildApplyProject = (side: number, cell: number): { project: CadProject; patchIds: Record<string, string> } => {
  const drawing = createBlankCadDrawingDocument({ name: 'apply perf', units: 'm' });
  const span = side * cell;
  const island = (frac: number, ox: number, oy: number): GridPayload => {
    const is = Math.max(2, Math.round(side * frac));
    return alignedGrid(ox * cell, oy * cell, is, cell);
  };
  const small = island(0.125, Math.floor((side - Math.round(side * 0.125)) * 0.25), Math.floor((side - Math.round(side * 0.125)) * 0.25));
  const medium = island(0.333, Math.floor((side - Math.round(side * 0.333)) / 2), Math.floor((side - Math.round(side * 0.333)) / 2));
  const large = island(0.7, Math.floor((side - Math.round(side * 0.7)) / 2), Math.floor((side - Math.round(side * 0.7)) / 2));
  const dIsland = Math.max(2, Math.round(side * 0.125));
  const d1 = alignedGrid(cell * 2, cell * 2, dIsland, cell);
  const d2 = alignedGrid(span - cell * (dIsland + 2), span - cell * (dIsland + 2), dIsland, cell);
  const eIsland = Math.max(2, Math.round(side * 0.25));
  const e1 = alignedGrid(cell * 3, cell * 3, eIsland, cell);
  const e2 = alignedGrid(cell * (3 + Math.floor(eIsland / 2)), cell * (3 + Math.floor(eIsland / 2)), eIsland, cell);
  const surfaces: CadSurface[] = [
    explicitSurface('design', 'Design', 'design', alignedGrid(0, 0, side, cell)),
    explicitSurface('pa', 'Patch A', 'design-patch', small),
    explicitSurface('pb', 'Patch B', 'design-patch', medium),
    explicitSurface('pc', 'Patch C', 'design-patch', large),
    explicitSurface('pd1', 'Patch D1', 'design-patch', d1),
    explicitSurface('pd2', 'Patch D2', 'design-patch', d2),
    explicitSurface('pe1', 'Patch E1', 'design-patch', e1),
    explicitSurface('pe2', 'Patch E2', 'design-patch', e2),
  ];
  return { project: { ...drawing.project, surfaces }, patchIds: { A: 'pa', B: 'pb', C: 'pc', D1: 'pd1', D2: 'pd2', E1: 'pe1', E2: 'pe2' } };
};

const applyProjectSurface = (project: CadProject, id: string): CadSurface =>
  project.surfaces!.find((entry) => entry.id === id)!;
const surfaceTinMetrics = (project: CadProject, id: string): { verts: number; tris: number } => {
  const payload = applyProjectSurface(project, id).definition.importedTin!;
  return { verts: payload.vertices.length / 3, tris: payload.faces.length / 3 };
};

const directCompose = (project: CadProject, targetId: string, patchId: string, reps: number): { ms: number; seamLength: number } => {
  const targetMesh = composeMesh(targetId, gridFromTin(applyProjectSurface(project, targetId).definition.importedTin!), 'trev');
  const patchMesh = composeMesh(patchId, gridFromTin(applyProjectSurface(project, patchId).definition.importedTin!), 'prev');
  const out = timeMed(() => composeSurfaceMeshes(targetMesh, patchMesh), reps);
  if (!out.result.ok) throw new Error(`compose failed: ${out.result.reason}`);
  return { ms: out.ms, seamLength: out.result.diagnostics.seamLength };
};

const preflightCell = (project: CadProject, targetId: string, patchId: string, reps: number): { ms: number; disposition: string; outputVerts: number; outputTris: number; seamLength: number } => {
  const revT = computeCadSurfaceSourceRevision(project, applyProjectSurface(project, targetId));
  const revP = computeCadSurfaceSourceRevision(project, applyProjectSurface(project, patchId));
  const out = timeMed(() => preflightDesignApply(project, targetId, patchId, revT, revP, true), reps);
  if (out.result.disposition !== 'EXACT') return { ms: out.ms, disposition: out.result.disposition, outputVerts: 0, outputTris: 0, seamLength: 0 };
  return { ms: out.ms, disposition: 'EXACT', outputVerts: out.result.outputVertexCount, outputTris: out.result.outputTriangleCount, seamLength: out.result.seamLength };
};

const commitApply = (project: CadProject, targetId: string, patchId: string): { ms: number; project: CadProject } => {
  const revT = computeCadSurfaceSourceRevision(project, applyProjectSurface(project, targetId));
  const revP = computeCadSurfaceSourceRevision(project, applyProjectSurface(project, patchId));
  const start = now();
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNAPPLY', targetSurfaceId: targetId, targetExpectedRevision: revT,
    patchSurfaceId: patchId, patchExpectedRevision: revP, sessionCurrent: true,
  });
  return { ms: now() - start, project: state.present.project };
};

const runApplySection = (): ApplyCell[] => {
  const scales = QUICK ? [10000] : [10000, 50000, 100000];
  const cell = 10;
  const rows: ApplyCell[] = [];
  for (const scale of scales) {
    const side = Math.max(8, Math.round(Math.sqrt(scale / 2)));
    const { project, patchIds } = buildApplyProject(side, cell);
    const reps = repsFor(scale);
    for (const [caseId, patchId] of [['A', patchIds.A!], ['B', patchIds.B!], ['C', patchIds.C!]] as Array<[string, string]>) {
      try {
        const composed = directCompose(project, 'design', patchId, reps);
        const pre = preflightCell(project, 'design', patchId, reps);
        const committed = commitApply(project, 'design', patchId);
        rows.push({ scale, caseId, patchTris: surfaceTinMetrics(project, patchId).tris, composeMs: composed.ms, preflightMs: pre.ms, commitMs: committed.ms, disposition: pre.disposition, outputVerts: pre.outputVerts, outputTris: pre.outputTris, seamLength: pre.seamLength });
      } catch (error) {
        rows.push({ scale, caseId, patchTris: 0, composeMs: null, preflightMs: null, commitMs: null, disposition: `FAIL ${(error as Error).message}`, outputVerts: 0, outputTris: 0, seamLength: 0 });
      }
    }
    for (const [caseId, id1, id2] of [['D (2 disjoint)', patchIds.D1!, patchIds.D2!], ['E (overlap)', patchIds.E1!, patchIds.E2!]] as Array<[string, string, string]>) {
      try {
        const first = directCompose(project, 'design', id1, reps);
        const step1 = commitApply(project, 'design', id1);
        const second = directCompose(step1.project, 'design', id2, reps);
        const step2 = commitApply(step1.project, 'design', id2);
        const metrics = surfaceTinMetrics(step2.project, 'design');
        rows.push({ scale, caseId, patchTris: surfaceTinMetrics(project, id2).tris, composeMs: first.ms + second.ms, preflightMs: null, commitMs: step1.ms + step2.ms, disposition: 'EXACT', outputVerts: metrics.verts, outputTris: metrics.tris, seamLength: first.seamLength + second.seamLength });
      } catch (error) {
        rows.push({ scale, caseId, patchTris: 0, composeMs: null, preflightMs: null, commitMs: null, disposition: `FAIL ${(error as Error).message}`, outputVerts: 0, outputTris: 0, seamLength: 0 });
      }
    }
  }
  return rows;
};

// ---------------------------------------------------------------------------
// §103 MULTI-PATCH (cumulative sequential DESIGNAPPLY)
// ---------------------------------------------------------------------------

interface MultiRow { step: number; ms: number; verts: number; tris: number }

const runMultiPatchSection = (): { steps: MultiRow[]; baseVerts: number; baseTris: number } => {
  const side = QUICK ? 71 : 224;
  const cell = 10;
  const totalPatches = QUICK ? 5 : 20;
  const drawing = createBlankCadDrawingDocument({ name: 'multi perf', units: 'm' });
  const base = alignedGrid(0, 0, side, cell);
  const surfaces: CadSurface[] = [explicitSurface('design', 'Design', 'design', base)];
  const stepCells = 10;
  for (let k = 0; k < totalPatches; k += 1) {
    const gx = 5 + stepCells * (k % 5);
    const gy = 5 + stepCells * Math.floor(k / 5);
    surfaces.push(explicitSurface(`p${k}`, `Patch ${k}`, 'design-patch', alignedGrid(gx * cell, gy * cell, 10, cell / 2)));
  }
  let project: CadProject = { ...drawing.project, surfaces };
  const steps: MultiRow[] = [];
  for (let k = 0; k < totalPatches; k += 1) {
    const committed = commitApply(project, 'design', `p${k}`);
    project = committed.project;
    const after = surfaceTinMetrics(project, 'design');
    steps.push({ step: k + 1, ms: committed.ms, verts: after.verts, tris: after.tris });
  }
  return { steps, baseVerts: base.vertices.length / 3, baseTris: base.faces.length / 3 };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const machineInfo = (): object => ({
  platform: `${os.platform()} ${os.release()}`,
  cpus: `${os.cpus().length} logical × ${os.cpus()[0]?.model ?? 'unknown'}`,
  memoryGB: Math.round(os.totalmem() / (1024 ** 3)),
  node: process.version,
  loadAvg: os.loadavg().map((v) => Number(v.toFixed(2))),
});

const printPatchSection = (real: Array<RealPatchRow | { courses: number; error: string }>, synthetic: SyntheticStageRow[]): void => {
  console.log('\n§101a PATCH BUILD — REAL pipeline (GROUP_CREATE -> group compute -> resolveDesignPatch)\n');
  console.log('| courses | group ms | shell v/t | ring v | ring-edge gaps | outcome | merged v/t | total ms |');
  console.log('|---:|---:|---|---:|---:|---|---|---:|');
  for (const row of real) {
    if ('error' in row) { console.log(`| ${row.courses} | — | — | — | — | FAIL-CLOSED | — | ${row.error} |`); continue; }
    console.log(`| ${row.courses} | ${fmt(row.groupMs)} | ${row.shellVerts}/${row.shellTris} | ${row.ringVerts} | ${row.mismatchEdges}/${row.ringVerts} | ${row.outcome} | ${row.mergedVerts}/${row.mergedTris} | ${fmt(row.stage.total ?? 0)} |`);
  }
  console.log('\n§101b PATCH BUILD — PURE STAGES on a synthetic matching annulus (median wall ms; scales where the real group shell does not agree)\n');
  console.log('| courses | ring v | shell v/t | pad tris | merged v/t | sourceRing | ringValidate | interiorTri | merge | total |');
  console.log('|---:|---:|---|---:|---|---:|---:|---:|---:|---:|');
  for (const row of synthetic) {
    if (row.error) { console.log(`| ${row.courses} | ${row.ringVerts} | ${row.shellVerts}/${row.shellTris} | — | — | — | — | — | — | ${row.error} |`); continue; }
    const s = row.stage;
    console.log(`| ${row.courses} | ${row.ringVerts} | ${row.shellVerts}/${row.shellTris} | ${row.padTris} | ${row.mergedVerts}/${row.mergedTris} | ${fmt(s.sourceRing!)} | ${fmt(s.ringValidate!)} | ${fmt(s.interiorTriangulation!)} | ${fmt(s.merge!)} | ${fmt(s.total!)} |`);
  }
  console.log('\n§101c V8 sampling self-time (ms), canonicalization/validation split out of merge:');
  console.log('| courses | sourceRing | interiorTri | merge | canonicalization | validation | engineGlue | other |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of synthetic) {
    const p = row.profiled;
    console.log(`| ${row.courses} | ${fmt(p.sourceRing ?? 0)} | ${fmt(p.interiorTriangulation ?? 0)} | ${fmt(p.merge ?? 0)} | ${fmt(p.canonicalization ?? 0)} | ${fmt(p.validation ?? 0)} | ${fmt(p.engineGlue ?? 0)} | ${fmt(p.other ?? 0)} |`);
  }
};

const printApplySection = (rows: ApplyCell[]): void => {
  console.log('\n§102 APPLY — DESIGNAPPLY composition core / preflight / commit (median wall ms; D/E = cumulative 2-step)\n');
  console.log('| target tris | case | patch tris | compose | preflight | commit | disposition | out verts/tris | seam m |');
  console.log('|---:|---|---:|---:|---:|---:|---|---|---:|');
  for (const r of rows) {
    const num = (v: number | null): string => (v == null ? '—' : fmt(v));
    console.log(`| ${r.scale.toLocaleString('en-US')} | ${r.caseId} | ${r.patchTris} | ${num(r.composeMs)} | ${num(r.preflightMs)} | ${num(r.commitMs)} | ${r.disposition} | ${r.outputVerts}/${r.outputTris} | ${r.seamLength.toFixed(0)} |`);
  }
};

const printMultiSection = (multi: { steps: MultiRow[]; baseVerts: number; baseTris: number }): void => {
  console.log(`\n§103 MULTI-PATCH — cumulative sequential DESIGNAPPLY on one design surface (base ${multi.baseVerts} verts / ${multi.baseTris} tris)\n`);
  console.log('| patch # | apply ms | result verts | result tris | Δverts | Δtris |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  let prevV = multi.baseVerts;
  let prevT = multi.baseTris;
  for (const s of multi.steps) {
    console.log(`| ${s.step} | ${fmt(s.ms)} | ${s.verts} | ${s.tris} | +${s.verts - prevV} | +${s.tris - prevT} |`);
    prevV = s.verts; prevT = s.tris;
  }
  const last = multi.steps[multi.steps.length - 1];
  if (last) console.log(`  growth to ${last.step} patches: verts +${last.verts - multi.baseVerts} (${(((last.verts / multi.baseVerts) - 1) * 100).toFixed(1)}%), tris +${last.tris - multi.baseTris} (${(((last.tris / multi.baseTris) - 1) * 100).toFixed(1)}%)`);
};

const main = async (): Promise<void> => {
  const harnessStart = now();
  console.log('Phase 20D Wave-3B design-surface performance evidence');
  console.log(`machine: ${JSON.stringify(machineInfo())}`);

  const patchSizes = QUICK ? [4, 20] : [4, 20, 100, 1000];
  const realRows: Array<RealPatchRow | { courses: number; error: string }> = [];
  const syntheticRows: SyntheticStageRow[] = [];
  for (const courses of patchSizes) {
    const k = Math.round(courses / 4);
    let fx: PadFixture | null = null;
    try {
      fx = buildPadFixture(k);
    } catch (error) {
      realRows.push({ courses, error: (error as Error).message });
      syntheticRows.push({ courses, ringVerts: 0, shellVerts: 0, shellTris: 0, padTris: 0, mergedVerts: 0, mergedTris: 0, stage: {}, profiled: {}, error: 'no real group mesh (20C gate)' });
      continue;
    }
    realRows.push(runRealPatchBuild(fx));
    const profile = await profileOnce(() => { syntheticBuildOnce(fx); });
    syntheticRows.push(runSyntheticStages(fx, profile));
  }

  const applyRows = runApplySection();
  const multi = runMultiPatchSection();

  printPatchSection(realRows, syntheticRows);
  printApplySection(applyRows);
  printMultiSection(multi);

  console.log(`\ntotal harness runtime ${((now() - harnessStart) / 1000).toFixed(1)} s`);
  console.log(`\nJSON_SUMMARY ${JSON.stringify({ quick: QUICK, machine: machineInfo(), patchReal: realRows, patchSynthetic: syntheticRows, apply: applyRows, multi })}`);
  console.log('');
};

void main();
