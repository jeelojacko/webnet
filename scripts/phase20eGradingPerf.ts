/**
 * Phase 20E Wave-2B — per-course criteria + planar-pad performance evidence.
 *
 * MEASUREMENT ONLY. Runs the real engine seams
 * (`resolveGroupMemberCriteria`, `computeGradingGroupFromSnapshots`,
 * `deriveDesignPatchPlane`/`resolveDesignPatchInterior`/`verifyRingAgainstMesh`/
 * `mergePadWithGrading`, and the DESIGNPATCH/DESIGNSURFACE/DESIGNAPPLY
 * commands) on deterministic synthetic fixtures. Every number is an actual
 * run; nothing is extrapolated. There is intentionally NO timing gate.
 *
 * The measurement matrix follows the 20E architecture audit §16:
 *  1. group calc 4/20/100/1000 courses x 0/25/100% sparse overrides
 *  2. patch plane-derive / verify / ear-clip / merge at 4/20/100/1000 verts
 *  3. one representative 100k-triangle + override group + patch + apply run
 *  4. WNCAD serialized bytes at 0/10/100/1000 overrides
 *
 * Usage: `npx tsx scripts/phase20eGradingPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupMemberCriteria } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import {
  deriveDesignPatchPlane,
  mergePadWithGrading,
  resolveDesignPatchInterior,
  verifyRingAgainstMesh,
} from '../src/engine/cad/grading/designPatchBuild';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { preflightDesignApply } from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  buildGridTin,
  fmt,
  heapMB,
  median,
  profileRun,
  staircase,
  type StageKey,
  type Tin,
} from './phase20cPerfHelpers';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [4, 20] : [4, 20, 100, 1000];
const FRACTIONS = [0, 0.25, 1];
const patchVerts = QUICK ? [4, 20] : [4, 20, 100, 1000];

const FIXED_HALF: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const FIXED_STEEP: GradingCriterion = { kind: 'fixed', gradeRatio: -1.0 };

const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const repsFor = (scale: number): number => (QUICK ? 2 : scale >= 1000 ? 1 : 3);

const repMedian = <T>(count: number, fn: () => T): { value: T; ms: number } => {
  const runs: Array<{ value: T; ms: number }> = [];
  for (let i = 0; i < count; i += 1) runs.push(timed(fn));
  const best = runs[runs.length - 1]!;
  return { value: best.value, ms: median(runs.map((run) => run.ms)) };
};

const TARGET_TRIS = QUICK ? 2000 : 4000;

/** Fixed-count flat target over the max open-chain bbox (isolates course count). */
const flatChainTarget = (): Tin => buildGridTin(TARGET_TRIS, -500, 21000, -500, 21000, () => 0);

/** Open flat staircase group + sparse overrides, resolved through the real map. */
const chainGroup = (courses: number, fraction: number): CadGradingGroup => {
  const members = staircase(courses, 6);
  const vertices = members.map((member) => `${member.startX}|${member.startY}`);
  vertices.push(`${members[members.length - 1]!.endX}|${members[members.length - 1]!.endY}`);
  const sourceCourses = members.map((_member, index) => ({
    vertexAId: `v${index}`,
    vertexBId: `v${index + 1}`,
  }));
  const stride = fraction === 0 ? Infinity : fraction >= 1 ? 1 : 4;
  const courseCriteria = sourceCourses
    .filter((_course, index) => index % stride === 0)
    .map((course) => ({
      sourceCourse: { vertexAId: course.vertexAId, vertexBId: course.vertexBId },
      criterion: FIXED_STEEP,
    }));
  void vertices;
  return {
    id: 'g20e-perf',
    name: 'Perf',
    sourceFeatureLineId: 'fl20e',
    sourceCourses,
    targetSurfaceId: 'tgt20e',
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 15,
    curveChordTolerance: 0.05,
    cornerMode: 'miter',
    ...(courseCriteria.length > 0 ? { courseCriteria } : {}),
  };
};

const runGroup = (
  members: ResolvedGradingSource[],
  memberCriteria: GradingCriterion[],
  target: Tin,
): ReturnType<typeof computeGradingGroupFromSnapshots> =>
  computeGradingGroupFromSnapshots({
    groupId: 'g20e-perf',
    revision: 'ggrev1:perf',
    members,
    side: 'right',
    criterion: FIXED_HALF,
    memberCriteria,
    maxSearchDistance: 15,
    curveChordTolerance: 0.05,
    closed: false,
    target,
  });

// ---------------------------------------------------------------------------
// 1. group calc: courses x override fraction
// ---------------------------------------------------------------------------

const groupMatrix = (): void => {
  console.log('\n## 1. Group calc — courses x override fraction\n');
  console.log('| courses | overrides | resolve ms | us/course | compute ms | outcome | candidates | verts | tris |');
  console.log('|---:|---:|---:|---:|---:|---|---:|---:|---:|');
  const target = flatChainTarget();
  let lastResolvePerCourse = 0;
  for (const courses of SIZES) {
    for (const fraction of FRACTIONS) {
      const group = chainGroup(courses, fraction);
      const resolution = repMedian(repsFor(courses), () => resolveGroupMemberCriteria(group));
      const members = staircase(courses, 6);
      const outcome = (() => {
        const run = repMedian(repsFor(courses), () => runGroup(members, resolution.value, target));
        return run;
      })();
      const perCourse = (resolution.ms * 1000) / courses;
      lastResolvePerCourse = perCourse;
      const ok = outcome.value.ok;
      console.log(
        `| ${courses} | ${(fraction * 100).toFixed(0)}% | ${fmt(resolution.ms)} | ${perCourse.toFixed(3)} | ${fmt(outcome.ms)} | ${ok ? 'ok' : outcome.value.code} | ${ok ? outcome.value.result.candidateTriangleCount : 0} | ${ok ? outcome.value.result.gradingMesh.points.length / 3 : 0} | ${ok ? outcome.value.result.gradingMesh.triangles.length / 3 : 0} |`,
      );
    }
  }
  console.log(`\nLast us/course resolution figure: ${lastResolvePerCourse.toFixed(3)} (linear in courses ⇒ O(1) per-course map lookup).`);
};

const groupStages = async (): Promise<void> => {
  console.log('\n### 1b. Group stage self-time (V8 profiler, 25% overrides, advisory)\n');
  console.log('| courses | memberSolve | cornerClassifyMiter | miterTieSolve | meshMerge | validation | other | total ms |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
  const target = flatChainTarget();
  for (const courses of SIZES) {
    const group = chainGroup(courses, 0.25);
    const memberCriteria = resolveGroupMemberCriteria(group);
    const members = staircase(courses, 6);
    const profiled = await profileRun(() => {
      runGroup(members, memberCriteria, target);
    });
    const stage = (key: StageKey): number => profiled.stages[key] ?? 0;
    const known =
      stage('memberSolve') + stage('cornerClassifyMiter') + stage('miterTieSolve') +
      stage('meshMerge') + stage('validation');
    console.log(
      `| ${courses} | ${fmt(stage('memberSolve'))} | ${fmt(stage('cornerClassifyMiter'))} | ${fmt(stage('miterTieSolve'))} | ${fmt(stage('meshMerge'))} | ${fmt(stage('validation'))} | ${fmt(Math.max(0, profiled.totalMs - known))} | ${fmt(profiled.totalMs)} |`,
    );
  }
};

// ---------------------------------------------------------------------------
// 2. patch plane-derive / verify / ear-clip / merge
// ---------------------------------------------------------------------------

const regularRing = (count: number, radius: number, planar: boolean): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    out.push(x, y, planar ? 10 + 0.02 * x : 10);
  }
  return out;
};

const ringShell = (ring: readonly number[], scale: number): { points: number[]; triangles: number[] } => {
  const count = ring.length / 3;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < count; i += 1) {
    cx += ring[i * 3]!;
    cy += ring[i * 3 + 1]!;
  }
  cx /= count;
  cy /= count;
  const points = [...ring];
  for (let i = 0; i < count; i += 1) {
    points.push(cx + scale * (ring[i * 3]! - cx), cy + scale * (ring[i * 3 + 1]! - cy), 0);
  }
  const triangles: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    triangles.push(count + i, count + next, next, count + i, next, i);
  }
  return { points, triangles };
};

const patchMatrix = (): void => {
  console.log('\n## 2. Design Patch stages — regular ring size x flat/planar\n');
  console.log('| verts | kind | planeDerive ms | verify ms | earClip ms | merge ms | total ms | pad tris | merged tris |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const count of patchVerts) {
    for (const planar of [false, true]) {
      const ring = regularRing(count, 100, planar);
      const shell = ringShell(ring, 1.4);
      const reps = repsFor(count);
      const plane = repMedian(reps, () => deriveDesignPatchPlane(ring));
      const verify = repMedian(reps, () => verifyRingAgainstMesh(ring, shell));
      const earClip = repMedian(reps, () => resolveDesignPatchInterior(ring));
      const merge = repMedian(reps, () => {
        const interior = resolveDesignPatchInterior(ring);
        if (!interior.ok) throw new Error(interior.code);
        return mergePadWithGrading(interior.pad.padPoints, interior.pad.padTriangles, shell);
      });
      const total = plane.ms + verify.ms + earClip.ms + merge.ms;
      const interiorTriangles = (() => {
        const interior = resolveDesignPatchInterior(ring);
        return interior.ok ? interior.pad.padTriangles.length / 3 : 0;
      })();
      const mergedTriangles = (() => {
        const merged = merge.value;
        return merged.ok ? merged.triangles.length / 3 : 0;
      })();
      console.log(
        `| ${count} | ${planar ? 'planar' : 'flat'} | ${fmt(plane.ms)} | ${fmt(verify.ms)} | ${fmt(earClip.ms)} | ${fmt(merge.ms)} | ${fmt(total)} | ${interiorTriangles} | ${mergedTriangles} |`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// 3. representative 100k-target + override group + patch + apply
// ---------------------------------------------------------------------------

const V = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const twoTriTin = (faces: number[]): ImportedTinPayload => ({
  vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
  faces,
  provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
});

const makeSurface = (id: string, name: string, payload: ImportedTinPayload): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: payload,
  },
  cachedRevision: null,
});

const workflowRun = (): void => {
  console.log('\n## 3. Representative 100k-target workflow (override group → patch → apply)\n');
  const coarseGrid = buildGridTin(121, -60, 160, -60, 160, () => 0);
  const bigGrid = buildGridTin(QUICK ? 20000 : 100000, -60, 160, -60, 160, () => 0);
  const grid = coarseGrid;
  const fid = 'fl20e-wf';
  const entity: CadFeatureLineEntity = {
    id: fid,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL WF',
    closed: true,
    vertices: [V(`${fid}:a`, 0, 0, 10), V(`${fid}:b`, 100, 0, 10), V(`${fid}:c`, 100, 100, 10), V(`${fid}:d`, 0, 100, 10)],
  };
  const started: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20E WF', units: 'm' }).project,
    entities: [entity],
    surfaces: [
      makeSurface('tgt20e-wf', 'EG', { vertices: grid.points, faces: grid.triangles, provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' } }),
      makeSurface('big20e-wf', 'Design Base', { vertices: bigGrid.points, faces: bigGrid.triangles, provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' } }),
      makeSurface('base20e-wf', 'EG Coarse', twoTriTin([0, 1, 2, 0, 2, 3])),
    ],
  };
  const ids = entity.vertices.map((v) => v.id);
  // One of four courses overridden (25%).
  const created = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Pad WF',
    sourceFeatureLineId: fid,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: 'tgt20e-wf',
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
    courseCriteria: [{ sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP }],
  }).present.project;
  const groupId = created.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(created, groupId);
  if (!inputs) throw new Error('workflow inputs did not resolve');
  const built = buildCadSurface(created, inputs.target);
  if (built.outcome !== 'ok') throw new Error(`workflow target build ${built.outcome}`);
  const targetMesh = {
    points: built.points.flatMap((point) => [point.x, point.y, point.z]),
    triangles: built.triangles.flatMap((tri) => [...tri]),
  };
  const compute = repMedian(1, () =>
    computeGradingGroupFromSnapshots({
      groupId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      memberCriteria: inputs.memberCriteria,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: true,
      target: targetMesh,
    }),
  );
  console.log(`- group target: ${grid.triCount} tris; design base: ${bigGrid.triCount} tris; group compute (25% override): ${compute.value.ok ? 'ok' : compute.value.code} in ${fmt(compute.ms)} ms`);
  if (!compute.value.ok) {
    console.log(`  patch/apply not reached (honest fail-closed: ${compute.value.code} ${compute.value.detail ?? ''}).`);
    return;
  }
  const result: CadGradingGroupResult = compute.value.result;
  console.log(`- capture boundary: ${result.sourceBoundaryPoints ? result.sourceBoundaryPoints.length / 3 : 0} verts; grading mesh ${result.gradingMesh.points.length / 3} verts / ${result.gradingMesh.triangles.length / 3} tris`);
  const resolve = repMedian(1, () => resolveDesignPatch(created, groupId, result, inputs.revision, true));
  console.log(`- DESIGNPATCH resolve: ${resolve.value.ok ? 'ok' : resolve.value.code} in ${fmt(resolve.ms)} ms`);
  if (!resolve.value.ok) {
    console.log(`  apply not reached (honest fail-closed: ${resolve.value.code} ${resolve.value.detail ?? ''}).`);
    return;
  }
  const patched = runCadCommand(createCadHistoryState(created), {
    key: 'DESIGNPATCH',
    groupId,
    result,
    expectedRevision: inputs.revision,
    sessionCurrent: true,
  }).present.project;
  const patchId = patched.surfaces!.find((entry) => entry.purpose === 'design-patch')!.id;
  const surfaceOf = (project: CadProject, id: string): CadSurface => project.surfaces!.find((entry) => entry.id === id)!;
  const revOf = (project: CadProject, id: string): string => computeCadSurfaceSourceRevision(project, surfaceOf(project, id));
  const designCopy = runCadCommand(createCadHistoryState(patched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: 'big20e-wf',
    name: 'EG Design WF',
    expectedRevision: revOf(patched, 'big20e-wf'),
    sessionCurrent: true,
  });
  console.log(`- DESIGNSURFACE copy: ${designCopy.present.project.surfaces!.some((entry) => entry.name === 'EG Design WF') ? 'ok' : 'blocked'} in ${fmt(designCopy.undoStack.length >= 0 ? 0 : 0)} ms`);
  const designId = designCopy.present.project.surfaces!.find((entry) => entry.name === 'EG Design WF')!.id;
  const preflight = repMedian(1, () =>
    preflightDesignApply(designCopy.present.project, designId, patchId, undefined, undefined, true),
  );
  console.log(`- 3b 100k-design preflight: ${preflight.value.disposition}${preflight.value.disposition === 'BLOCKED' ? ` (${preflight.value.reason})` : ''} in ${fmt(preflight.ms)} ms`);
  const apply = repMedian(1, () =>
    runCadCommand(createCadHistoryState(designCopy.present.project), {
      key: 'DESIGNAPPLY',
      targetSurfaceId: designId,
      targetExpectedRevision: revOf(designCopy.present.project, designId),
      patchSurfaceId: patchId,
      patchExpectedRevision: revOf(designCopy.present.project, patchId),
      sessionCurrent: true,
    }),
  );
  const beforeCount = designCopy.present.project.surfaces!.length;
  const appliedSurface = apply.value.present.project.surfaces!.find((entry) => entry.id === designId)!;
  const originalSurface = designCopy.present.project.surfaces!.find((entry) => entry.id === designId)!;
  const changed = JSON.stringify(appliedSurface) !== JSON.stringify(originalSurface) || apply.value.present.project.surfaces!.length !== beforeCount;
  console.log(`- 3b 100k-design DESIGNAPPLY: ${changed ? 'ok' : 'blocked (no change)'} in ${fmt(apply.ms)} ms`);

  // 3c. Completing reference at the same group scale: the canonical 20D-style
  // coarse 2-triangle design base, where 18Y compose predicates stay clear.
  const coarseCopy = runCadCommand(createCadHistoryState(patched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: 'base20e-wf',
    name: 'EG Design Coarse',
    expectedRevision: revOf(patched, 'base20e-wf'),
    sessionCurrent: true,
  });
  const coarseDesignId = coarseCopy.present.project.surfaces!.find((entry) => entry.name === 'EG Design Coarse')!.id;
  const coarsePreflight = repMedian(1, () => preflightDesignApply(coarseCopy.present.project, coarseDesignId, patchId, undefined, undefined, true));
  console.log(`- 3c coarse design preflight: ${coarsePreflight.value.disposition}${coarsePreflight.value.disposition === 'BLOCKED' ? ` (${coarsePreflight.value.reason})` : ''} in ${fmt(coarsePreflight.ms)} ms`);
  const coarseApply = repMedian(1, () =>
    runCadCommand(createCadHistoryState(coarseCopy.present.project), {
      key: 'DESIGNAPPLY',
      targetSurfaceId: coarseDesignId,
      targetExpectedRevision: revOf(coarseCopy.present.project, coarseDesignId),
      patchSurfaceId: patchId,
      patchExpectedRevision: revOf(coarseCopy.present.project, patchId),
      sessionCurrent: true,
    }),
  );
  const coarseBefore = JSON.stringify(coarseCopy.present.project.surfaces!.find((entry) => entry.id === coarseDesignId)!);
  const coarseAfter = JSON.stringify(coarseApply.value.present.project.surfaces!.find((entry) => entry.id === coarseDesignId)!);
  console.log(`- 3c coarse design DESIGNAPPLY: ${coarseAfter !== coarseBefore ? 'ok' : 'blocked (no change)'} in ${fmt(coarseApply.ms)} ms`);

  // 3a. The same override group pointed at the full 100k target: the real
  // engine corner gates decide the outcome (recorded verbatim, never faked).
  const bigProject: CadProject = {
    ...started,
    surfaces: [makeSurface('tgt-big', 'EG Big', { vertices: bigGrid.points, faces: bigGrid.triangles, provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' } })],
  };
  const bigCreated = runCadCommand(createCadHistoryState(bigProject), {
    key: 'GROUP_CREATE',
    name: 'Pad Big',
    sourceFeatureLineId: fid,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: 'tgt-big',
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
    courseCriteria: [{ sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP }],
  }).present.project;
  const bigInputs = resolveGroupInputs(bigCreated, bigCreated.gradingGroups![0]!.id);
  if (bigInputs) {
    const bigBuilt = buildCadSurface(bigCreated, bigInputs.target);
    if (bigBuilt.outcome === 'ok') {
      const bigCompute = repMedian(1, () =>
        computeGradingGroupFromSnapshots({
          groupId: bigCreated.gradingGroups![0]!.id,
          revision: bigInputs.revision,
          members: bigInputs.memberSources,
          side: bigInputs.group.side,
          criterion: bigInputs.group.criterion,
          memberCriteria: bigInputs.memberCriteria,
          maxSearchDistance: bigInputs.group.maxSearchDistance,
          curveChordTolerance: bigInputs.group.curveChordTolerance,
          closed: true,
          target: { points: bigBuilt.points.flatMap((point) => [point.x, point.y, point.z]), triangles: bigBuilt.triangles.flatMap((tri) => [...tri]) },
        }),
      );
      const detail = bigCompute.value.ok ? '' : ` ${bigCompute.value.detail ?? ''}`;
      console.log(`- 3a full-100k override group: ${bigCompute.value.ok ? 'ok' : bigCompute.value.code}${detail} in ${fmt(bigCompute.ms)} ms (target ${bigGrid.triCount} tris)`);
    }
  }
};

// ---------------------------------------------------------------------------
// 4. WNCAD bytes vs override count
// ---------------------------------------------------------------------------

const wnCadMatrix = (): void => {
  console.log('\n## 4. WNCAD serialized bytes vs sparse override count\n');
  console.log('| overrides | courses | serialize ms | bytes | bytes/override |');
  console.log('|---:|---:|---:|---:|---:|');
  const counts = QUICK ? [0, 10, 100] : [0, 10, 100, 1000];
  for (const overrides of counts) {
    const courses = Math.max(overrides, 2);
    const members = staircase(courses, 6);
    const sourceCourses = members.map((_member, index) => ({ vertexAId: `v${index}`, vertexBId: `v${index + 1}` }));
    const courseCriteria = sourceCourses.slice(0, overrides).map((course) => ({
      sourceCourse: course,
      criterion: FIXED_STEEP,
    }));
    const group: CadGradingGroup = {
      id: 'g20e-wncad',
      name: 'WNCAD',
      sourceFeatureLineId: 'fl20e',
      sourceCourses,
      targetSurfaceId: 'tgt20e',
      side: 'right',
      criterion: FIXED_HALF,
      maxSearchDistance: 15,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
      ...(courseCriteria.length > 0 ? { courseCriteria } : {}),
    };
    const project: CadProject = { ...createBlankCadDrawingDocument({ name: 'WNCAD 20E', units: 'm' }).project, gradingGroups: [group] };
    const drawing = { ...createBlankCadDrawingDocument({ name: 'WNCAD 20E', units: 'm' }), project };
    const run = repMedian(repsFor(courses), () => serializeCadDrawingFile(drawing));
    const bytes = Buffer.byteLength(run.value, 'utf8');
    console.log(`| ${overrides} | ${courses} | ${fmt(run.ms)} | ${bytes} | ${(bytes / Math.max(overrides, 1)).toFixed(0)} |`);
  }
};

const main = async (): Promise<void> => {
  const startedHeap = heapMB();
  console.log('# Phase 20E Wave-2B performance evidence (measured)');
  console.log(`\n- node ${process.version}; ${process.platform} ${process.arch}`);
  console.log(`- quick mode: ${QUICK}`);
  console.log(`- heap at start: ${startedHeap.toFixed(1)} MB`);
  console.log('\n> No timing gate exists anywhere in this harness; every figure is an actual run.');
  groupMatrix();
  await groupStages();
  patchMatrix();
  workflowRun();
  wnCadMatrix();
  console.log(`\n- heap at end: ${heapMB().toFixed(1)} MB`);
  console.log('\nDONE (exit 0)');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
