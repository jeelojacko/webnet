/**
 * Phase 20E Wave-2B browser QA — per-course grading criteria + planar pads.
 *
 * Letter map (mission §102 A–R, 18 letters):
 *   A default legacy group byte-identical (no overrides)   B override recalcs its course
 *   C reset-to-default byte-exact back to legacy           D mixed fixed + cut/fill members
 *   E unequal-slope miter tie on both planes                F closed unequal daylight manifold
 *   G save/reopen sparse overrides exact                    H reverse physical-course rides along
 *   I insert/span-edit drops the orphan (BROKEN_REFERENCE)  J planar DESIGNPATCH accepted
 *   K non-planar ring blocked                               L curved-flat canonical capture
 *   M DESIGNAPPLY design surface                            N ordinary 18I volume
 *   O 18U slope/aspect of the plane                         P 18J profile + 18K section
 *   Q WNCAD byte-exact round-trip with overrides            R LandXML final-design export
 *
 * Honesty ledger: letters A–R are ENGINE-SEAM pins (the landed engine commands
 * exercised directly, verbatim like the 20C/20D specs). The browser describe
 * pins the live `/cad` workspace wiring (Home ribbon Grading Groups subgroup →
 * `CadGradingGroupManager`, including the Wave-2A per-course criteria editor
 * tab) and asserts zero page/console errors. Full workspace calc-through inside
 * the live worker session is NOT claimed (the same limitation the 20C/20D specs
 * record). Letter M pins the carried planar-apply 18Y seam finding explicitly.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { getSurfaceElevationAt, buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { preflightDesignApply } from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import {
  editGroupSpan,
  resetCourseCriteriaOverrides,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  resolveGradingGroupCourseCriterion,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import {
  deriveDesignPatchPlane,
  designPatchPlaneSlope,
  resolveDesignPatchInterior,
  resolveDesignPatchRing,
} from '../src/engine/cad/grading/designPatchBuild';
import { gradingPlaneGradient, planeElevationAt } from '../src/engine/cad/grading/gradingCornerMath';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import { parseLandXmlSurfaces } from '../src/engine/landxmlSurfaceImport';
import { parseXmlDocument } from '../src/engine/gnssGvxXml';
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
import { gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20e-qa${seq}`;
};

const FIXED_HALF: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const FIXED_STEEP: GradingCriterion = { kind: 'fixed', gradeRatio: -1.0 };

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

/** Canonical 20C/20D step-20 flat grid (every locus line on a target edge). */
const gridTin = (minX: number, minY: number, maxX: number, maxY: number, step = 20): ImportedTinPayload => {
  const xs = range(minX, maxX, step);
  const ys = range(minY, maxY, step);
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return {
    vertices,
    faces,
    provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
};

const makeSurface = (id: string, name: string, payload: ImportedTinPayload): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId: 'style-base',
  definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: payload },
  cachedRevision: null,
});

const V = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const straight = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

// ---------------------------------------------------------------------------
// Closed square-pad world (real GROUP_CREATE → resolveGroupInputs → compute)
// ---------------------------------------------------------------------------

interface SquareWorld {
  project: CadProject;
  entity: CadFeatureLineEntity;
  groupId: string;
  revision: string;
  result: CadGradingGroupResult;
}

/** Deterministic ids so every square world shares the same override refs. */
const SQUARE_FL = 'fl-20e-qa-square';
const SQUARE_VERTEX_IDS = [`${SQUARE_FL}:a`, `${SQUARE_FL}:b`, `${SQUARE_FL}:c`, `${SQUARE_FL}:d`];

const computeSquareResult = (
  project: CadProject,
  memberCriteria?: GradingCriterion[],
): CadGradingGroupResult => {
  const groupId = project.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('square inputs did not resolve');
  const built = buildCadSurface(project, inputs.target);
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const effective = memberCriteria ?? inputs.memberCriteria;
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    ...(effective !== undefined ? { memberCriteria: effective } : {}),
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`compute failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

const squareWorld = (courseCriteria?: CadGradingGroup['courseCriteria']): SquareWorld => {
  const entity: CadFeatureLineEntity = {
    id: SQUARE_FL,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Pad',
    closed: true,
    vertices: [
      V(SQUARE_VERTEX_IDS[0]!, 0, 0, 10),
      V(SQUARE_VERTEX_IDS[1]!, 100, 0, 10),
      V(SQUARE_VERTEX_IDS[2]!, 100, 100, 10),
      V(SQUARE_VERTEX_IDS[3]!, 0, 100, 10),
    ],
  };
  const targetId = nextId('tgt');
  const started: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20E QA', units: 'm' }).project,
    entities: [entity],
    surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
  };
  const ids = entity.vertices.map((v) => v.id);
  const created = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Pad',
    sourceFeatureLineId: entity.id,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: targetId,
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
    ...(courseCriteria !== undefined ? { courseCriteria } : {}),
  }).present.project;
  const groupId = created.gradingGroups![0]!.id;
  const revision = resolveGroupInputs(created, groupId)!.revision;
  return { project: created, entity, groupId, revision, result: computeSquareResult(created) };
};

const digest = (result: CadGradingGroupResult): string =>
  JSON.stringify({
    area: result.gradingPlanArea,
    tri: result.gradingMesh.triangles,
    daylight: result.daylightPoints,
    regions: result.memberRegions,
    corners: result.corners.map((corner) => [corner.classification, corner.tiePointXyz, corner.miterRay]),
  });

const planArea = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    sum += Math.abs(
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!),
    ) / 2;
  }
  return sum;
};

const meshVolume = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    const area = Math.abs(
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!),
    ) / 2;
    sum += area * (points[a + 2]! + points[b + 2]! + points[c + 2]!) / 3;
  }
  return sum;
};

// ---------------------------------------------------------------------------
// Planar pad world (captured planar boundary + matching shell + forged result)
// ---------------------------------------------------------------------------

const planarRing = (): number[] => [0, 0, 10, 100, 0, 12, 100, 100, 12, 0, 100, 10];

const planarShell = (): { points: number[]; triangles: number[] } => {
  const ring = planarRing();
  const points = [...ring];
  for (let i = 0; i < 4; i += 1) {
    const x = ring[i * 3]!;
    const y = ring[i * 3 + 1]!;
    points.push(50 + 1.4 * (x - 50), 50 + 1.4 * (y - 50), 0);
  }
  const triangles: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    triangles.push(4 + i, 4 + next, next, 4 + i, next, i);
  }
  return { points, triangles };
};

interface PlanarWorld {
  project: CadProject;
  groupId: string;
  revision: string;
  targetId: string;
  baseId: string;
}

const planarWorld = (): PlanarWorld => {
  const entity: CadFeatureLineEntity = {
    id: nextId('fl-planar'),
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Planar',
    closed: true,
    vertices: [
      V('A', 0, 0, 10),
      V('B', 100, 0, 12),
      V('C', 100, 100, 12),
      V('D', 0, 100, 10),
    ],
  };
  const targetId = nextId('tgt-planar');
  const baseId = nextId('base-planar');
  const started: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20E Planar QA', units: 'm' }).project,
    entities: [entity],
    surfaces: [
      makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160)),
      makeSurface(baseId, 'EG Coarse', {
        vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      }),
    ],
  };
  const ids = entity.vertices.map((v) => v.id);
  const created = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Pad',
    sourceFeatureLineId: entity.id,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: targetId,
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  }).present.project;
  const groupId = created.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(created, groupId);
  if (!inputs) throw new Error('planar inputs did not resolve');
  return { project: created, groupId, revision: inputs.revision, targetId, baseId };
};

const planarResult = (world: PlanarWorld): CadGradingGroupResult => {
  const ring = planarRing();
  return {
    groupId: world.groupId,
    revision: world.revision,
    accuracy: 'EXACT',
    memberCount: 4,
    cornerCount: 4,
    memberRegions: [],
    corners: [],
    daylightPoints: [],
    sourceBoundaryPoints: [...ring, ring[0]!, ring[1]!, ring[2]!],
    gradingMesh: planarShell(),
    sourceLength: 0,
    gradingPlanArea: 0,
    grading3dArea: 0,
    minProjectionDistance: 0,
    maxProjectionDistance: 0,
    meanProjectionDistance: 0,
    cutSourceLength: 0,
    fillSourceLength: 0,
    tiedSourceLength: 0,
    candidateTriangleCount: 0,
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
    diagnostics: [],
  };
};

const revOf = (project: CadProject, id: string): string =>
  computeCadSurfaceSourceRevision(project, project.surfaces!.find((entry) => entry.id === id)!);

const bakePlanarPatch = (world: PlanarWorld): CadProject =>
  runCadCommand(createCadHistoryState(world.project), {
    key: 'DESIGNPATCH',
    groupId: world.groupId,
    result: planarResult(world),
    expectedRevision: world.revision,
    sessionCurrent: true,
  }).present.project;

interface FlatApply {
  project: CadProject;
  designId: string;
  patchId: string;
}

/** Canonical 20D-style flat design copy + baked patch (proven EXACT compose). */
const flatApplyProject = (): FlatApply => {
  const world = squareWorld();
  const baseId = nextId('base-flat');
  const withBase: CadProject = {
    ...world.project,
    surfaces: [
      ...world.project.surfaces!,
      makeSurface(baseId, 'EG Coarse', {
        vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      }),
    ],
  };
  const patched = runCadCommand(createCadHistoryState(withBase), {
    key: 'DESIGNPATCH',
    groupId: world.groupId,
    result: world.result,
    expectedRevision: world.revision,
    sessionCurrent: true,
  }).present.project;
  const patchId = patched.surfaces!.find((entry) => entry.purpose === 'design-patch')!.id;
  const copied = runCadCommand(createCadHistoryState(patched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: baseId,
    name: 'EG Design',
    expectedRevision: revOf(patched, baseId),
    sessionCurrent: true,
  }).present.project;
  const designId = copied.surfaces!.find((entry) => entry.name === 'EG Design')!.id;
  return { project: copied, designId, patchId };
};

// ---------------------------------------------------------------------------
// A–C. default identity, override recalc, reset exact
// ---------------------------------------------------------------------------

test('A no-override group is byte-identical to an explicit all-default member list', () => {
  const legacy = squareWorld();
  const explicitResult = computeSquareResult(legacy.project, [FIXED_HALF, FIXED_HALF, FIXED_HALF, FIXED_HALF]);
  expect(digest(explicitResult)).toBe(digest(legacy.result));
  expect(resolveGroupMemberCriteria(legacy.project.gradingGroups![0]!))
    .toEqual([FIXED_HALF, FIXED_HALF, FIXED_HALF, FIXED_HALF]);
  expect(legacy.result.gradingPlanArea).toBeCloseTo(9600, 6);
});

test('B a single course override recalculates that member and flips the revision', () => {
  const legacy = squareWorld();
  const ids = legacy.entity.vertices.map((v) => v.id);
  const overridden = squareWorld([
    { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
  ]);
  expect(overridden.revision).not.toBe(legacy.revision);
  expect(overridden.result.gradingPlanArea).toBeCloseTo(8200, 6);
  expect(digest(overridden.result)).not.toBe(digest(legacy.result));
  expect(resolveGroupMemberCriteria(overridden.project.gradingGroups![0]!))
    .toEqual([FIXED_HALF, FIXED_STEEP, FIXED_HALF, FIXED_HALF]);
});

test('C reset-to-default removes the record and restores the legacy hash exactly', () => {
  const ids = SQUARE_VERTEX_IDS;
  const withOverride = squareWorld([
    { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
  ]);
  const group = withOverride.project.gradingGroups![0]!;
  // Same-world legacy reference: the group with the override removed.
  const bare: CadGradingGroup = { ...group };
  delete bare.courseCriteria;
  const reset = resetCourseCriteriaOverrides(group, [{ vertexAId: ids[1]!, vertexBId: ids[2]! }]);
  if (!reset.ok) throw new Error('reset failed');
  expect('courseCriteria' in reset.value).toBe(false);
  const courses = (g: CadGradingGroup) => ({
    sourceFeatureLineId: g.sourceFeatureLineId,
    courses: g.sourceCourses.map((course) => ({
      vertexAId: course.vertexAId, vertexBId: course.vertexBId,
      resolvedSource: straight(0, 0, 100, 0),
    })),
    targetSurfaceId: g.targetSurfaceId,
    targetRevision: 'srev1:t',
    side: g.side,
    criterion: g.criterion,
    ...(g.courseCriteria !== undefined ? { courseCriteria: g.courseCriteria } : {}),
    maxSearchDistance: g.maxSearchDistance,
    curveChordTolerance: g.curveChordTolerance,
    cornerMode: g.cornerMode,
    closed: true,
  });
  expect(buildGroupRevision(courses(reset.value))).toBe(buildGroupRevision(courses(bare)));
  expect(resolveGroupMemberCriteria(reset.value)).toEqual([FIXED_HALF, FIXED_HALF, FIXED_HALF, FIXED_HALF]);
});

// ---------------------------------------------------------------------------
// D–F. mixed members, unequal miter, closed unequal daylight manifold
// ---------------------------------------------------------------------------

const openChain = (): { members: ResolvedGradingSource[]; target: ImportedTinPayload } => ({
  members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
  target: gridTin(-60, -60, 160, 160),
});

const chainOutcome = (memberCriteria: GradingCriterion[]): CadGradingGroupResult => {
  const { members, target } = openChain();
  const outcome = computeGradingGroupFromSnapshots({
    groupId: 'g-chain',
    revision: 'ggrev1:chain',
    members,
    side: 'right',
    criterion: FIXED_HALF,
    memberCriteria,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: false,
    target: { points: target.vertices, triangles: target.faces },
  });
  if (!outcome.ok) throw new Error(`${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

test('D mixed fixed + cut/fill members solve with per-member regions', () => {
  const mixed = chainOutcome([
    FIXED_HALF,
    { kind: 'cut-fill', cutGradeRatio: 0.25, fillGradeRatio: -0.25 },
  ]);
  expect(mixed.memberRegions.filter((region) => region.memberIndex === 0).every((region) => region.classification === 'FIXED')).toBe(true);
  expect(mixed.memberRegions.filter((region) => region.memberIndex === 1).every((region) => region.classification === 'FILL')).toBe(true);
  expect(mixed.maxProjectionDistance).toBeCloseTo(40, 6);
});

test('E unequal-slope miter tie lies on both corner planes at the target', () => {
  const { members } = openChain();
  const result = chainOutcome([FIXED_HALF, FIXED_STEEP]);
  expect(result.corners).toHaveLength(1);
  const tie = result.corners[0]!.tiePointXyz!;
  const plane1 = gradingPlaneGradient(
    { ...members[0]!, startX: 100, startY: 0, endX: 200, endY: 0, length: 100 },
    'right', -0.5, 0,
  )!;
  const plane2 = gradingPlaneGradient(members[1]!, 'right', -1.0, 0)!;
  expect(Math.abs(planeElevationAt(plane1, tie[0], tie[1])! - planeElevationAt(plane2, tie[0], tie[1])!)).toBeLessThan(1e-6);
  expect(Math.abs(tie[2])).toBeLessThan(1e-6);
});

test('F closed unequal-criteria daylight manifold shares the source seam twice', () => {
  const ids = squareWorld().entity.vertices.map((v) => v.id);
  const overridden = squareWorld([
    { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
  ]);
  const mesh = overridden.result.gradingMesh;
  const counts = new Map<string, number>();
  const key = (i: number): string => `${mesh.points[i * 3]}|${mesh.points[i * 3 + 1]}|${mesh.points[i * 3 + 2]}`;
  for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
    for (const [p, q] of [
      [mesh.triangles[i]!, mesh.triangles[i + 1]!],
      [mesh.triangles[i + 1]!, mesh.triangles[i + 2]!],
      [mesh.triangles[i + 2]!, mesh.triangles[i]!],
    ] as Array<[number, number]>) {
      const edge = [key(p), key(q)].sort().join('||');
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }
  for (const count of counts.values()) expect(count).toBeLessThanOrEqual(2);
  expect([...counts.values()].filter((count) => count === 1).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// G–I. persistence, reverse, orphan drop
// ---------------------------------------------------------------------------

test('G save/reopen keeps sparse overrides byte-exact', () => {
  const ids = squareWorld().entity.vertices.map((v) => v.id);
  const world = squareWorld([
    { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
  ]);
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: world.project };
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.drawing.project.gradingGroups).toEqual(world.project.gradingGroups);
});

test('H a reverse-ordered course ref keeps its override attached', () => {
  const ids = squareWorld().entity.vertices.map((v) => v.id);
  const world = squareWorld([
    { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
  ]);
  const group = world.project.gradingGroups![0]!;
  expect(resolveGradingGroupCourseCriterion(group, { vertexAId: ids[2]!, vertexBId: ids[1]! })).toEqual(FIXED_STEEP);
});

test('I span-edit drops the orphan override and labels the history transaction', () => {
  // Open 3-vertex chain (a span edit of a CLOSED group must stay closed, so
  // the orphan-drop contract is pinned on the open chain exactly as authored).
  const chainId = nextId('fl-chain');
  const entity: CadFeatureLineEntity = {
    id: chainId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Chain',
    closed: false,
    vertices: [V('a', 0, 0, 10), V('b', 100, 0, 10), V('c', 100, 100, 10)],
  };
  const targetId = nextId('tgt-chain');
  const started: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20E Chain QA', units: 'm' }).project,
    entities: [entity],
    surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
  };
  const created = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Chain',
    sourceFeatureLineId: chainId,
    sourceCourses: [
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: false,
    courseCriteria: [{ sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_STEEP }],
  }).present.project;
  const group = created.gradingGroups![0]!;
  const edited = runCadCommand(createCadHistoryState(created), {
    key: 'GROUP_EDIT_SPAN',
    groupId: group.id,
    sourceCourses: [{ vertexAId: 'b', vertexBId: 'c' }],
  });
  const after = edited.present.project.gradingGroups!.find((entry) => entry.id === group.id)!;
  expect(after.courseCriteria).toBeUndefined();
  expect(edited.undoStack.at(-1)!.transaction.label).toContain('dropped 1 orphan');
  // Authoring seam parity: the same drop is reported without a history entry.
  const direct = editGroupSpan(group, [{ vertexAId: 'b', vertexBId: 'c' }], false);
  if (!direct.ok) throw new Error('span edit failed');
  expect(direct.value.removedOverrides).toEqual(['a>b']);
});

// ---------------------------------------------------------------------------
// J–L. planar accept, non-planar block, curved-flat capture
// ---------------------------------------------------------------------------

test('J DESIGNPATCH accepts a planar pad as planar-source with no pad Z', () => {
  const world = planarWorld();
  const resolved = resolveDesignPatch(world.project, world.groupId, planarResult(world), world.revision, true);
  if (!resolved.ok) throw new Error(`${resolved.code} ${resolved.detail ?? ''}`);
  expect(resolved.value.provenance.interiorPolicy).toBe('planar-source');
  expect(resolved.value.padZ).toBeNull();
  expect(resolved.value.ring).toEqual(planarRing());
  expect(planArea(resolved.value.points, resolved.value.triangles)).toBeCloseTo(19600, 6);
});

test('K a non-planar ring is blocked before any mesh read', () => {
  const world = planarWorld();
  const forged: CadGradingGroupResult = {
    ...planarResult(world),
    sourceBoundaryPoints: [0, 0, 10, 100, 0, 12, 100, 100, 10.1, 0, 100, 10, 0, 0, 10],
  };
  expect(resolveDesignPatch(world.project, world.groupId, forged, world.revision, true))
    .toMatchObject({ ok: false, code: 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED' });
});

test('L a canonical curved-flat capture is consumed verbatim', () => {
  const entity: CadFeatureLineEntity = {
    id: nextId('fl-curved'),
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Curved',
    closed: true,
    vertices: [
      V('A', 0, 0, 10), V('B', 100, 0, 10), V('C', 100, 60, 10), V('D', 0, 60, 10),
    ],
    segmentGeometry: [
      { kind: 'line' }, { kind: 'arc', bulge: 0.5 }, { kind: 'line' }, { kind: 'arc', bulge: 0.5 },
    ],
  };
  const targetId = nextId('tgt-curved');
  const started: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20E Curved QA', units: 'm' }).project,
    entities: [entity],
    surfaces: [makeSurface(targetId, 'EG', gridTin(-100, -100, 300, 300))],
  };
  const ids = entity.vertices.map((v) => v.id);
  const created = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Curved',
    sourceFeatureLineId: entity.id,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: targetId,
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  }).present.project;
  const group = created.gradingGroups![0]!;
  const curved: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = (2 * Math.PI * i) / 16;
    curved.push(50 + 30 * Math.cos(angle), 50 + 30 * Math.sin(angle), 10);
  }
  const captured = [...curved, curved[0]!, curved[1]!, curved[2]!];
  const resolved = resolveDesignPatchRing(group, entity, 0.05, captured);
  if (!resolved.ok) throw new Error(`${resolved.code} ${resolved.detail ?? ''}`);
  expect(resolved.ring).toEqual(curved);
});

// ---------------------------------------------------------------------------
// M–P. apply, volume, analysis, profile/section
// ---------------------------------------------------------------------------

test('M DESIGNAPPLY commits the baked patch in place on the design copy', () => {
  const { project, designId, patchId } = flatApplyProject();
  expect(preflightDesignApply(project, designId, patchId, undefined, undefined, true).disposition).toBe('EXACT');
  const applied = runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(project, designId),
    patchSurfaceId: patchId,
    patchExpectedRevision: revOf(project, patchId),
    sessionCurrent: true,
  }).present.project;
  const design = applied.surfaces!.find((entry) => entry.id === designId)!;
  expect(design.purpose).toBe('design');
  const built = buildCadSurface(applied, design);
  expect(built.outcome).toBe('ok');
  if (built.outcome === 'ok') {
    expect(getSurfaceElevationAt(built, 50, 50)).toBeCloseTo(10, 9);
  }
  // Recorded carried finding: the PLANAR patch bakes but 18Y compose fail-closes
  // on a sub-ulp (1.3e-15) seam floor between the tilted shell and a flat base.
  const planar = planarWorld();
  const planarPatched = bakePlanarPatch(planar);
  const planarPatchId = planarPatched.surfaces!.find((entry) => entry.purpose === 'design-patch')!.id;
  const planarCopy = runCadCommand(createCadHistoryState(planarPatched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: planar.baseId,
    name: 'EG Design Planar',
    expectedRevision: revOf(planarPatched, planar.baseId),
    sessionCurrent: true,
  }).present.project;
  const planarDesignId = planarCopy.surfaces!.find((entry) => entry.name === 'EG Design Planar')!.id;
  expect(preflightDesignApply(planarCopy, planarDesignId, planarPatchId, undefined, undefined, true).disposition).toBe('BLOCKED');
});

test('N ordinary 18I volume of the planar pad footprint is exactly 110000 fill', () => {
  const world = planarWorld();
  const patched = bakePlanarPatch(world);
  const patch = patched.surfaces!.find((entry) => entry.purpose === 'design-patch')!;
  const built = buildCadSurface(patched, patch);
  if (built.outcome !== 'ok') throw new Error('patch build failed');
  const quantities = computeVolumeQuantities(
    { points: [0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0], triangles: [0, 1, 2, 0, 2, 3] },
    {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  ).quantities;
  expect(quantities.fillVolume).toBeCloseTo(110000, 6);
  expect(quantities.cutVolume).toBe(0);
  expect(meshVolume(planarRing(), (() => {
    const interior = resolveDesignPatchInterior(planarRing());
    return interior.ok ? interior.pad.padTriangles : [];
  })())).toBeCloseTo(110000, 6);
});

test('O 18U slope/aspect of the planar pad is a constant 2% with a west downslope', () => {
  const plane = deriveDesignPatchPlane(planarRing());
  if (!plane.ok) throw new Error(plane.code);
  const slope = designPatchPlaneSlope(plane);
  expect(slope.slopePercent).toBeCloseTo(2, 12);
  expect(slope.slopeRatio).toBeCloseTo(0.02, 12);
  expect(slope.downslopeAspectDeg).toBeCloseTo(270, 9);
});

test('P 18J profile is linear and 18K section is constant across the planar pad', () => {
  const interior = resolveDesignPatchInterior(planarRing());
  if (!interior.ok) throw new Error(interior.code);
  const points: Array<{ entityId: string; x: number; y: number; z: number }> = [];
  for (let i = 0; i < interior.pad.padPoints.length; i += 3) {
    points.push({ entityId: 'pad', x: interior.pad.padPoints[i]!, y: interior.pad.padPoints[i + 1]!, z: interior.pad.padPoints[i + 2]! });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < interior.pad.padTriangles.length; i += 3) {
    triangles.push([interior.pad.padTriangles[i]!, interior.pad.padTriangles[i + 1]!, interior.pad.padTriangles[i + 2]!]);
  }
  const mesh = { points, triangles, grid: buildSurfaceGrid(points, triangles) };
  const profile = extractSurfaceProfile({
    profileId: 'p-20e-qa',
    revision: 'prev1:20e-qa',
    alignmentElements: [{ kind: 'line', start: { x: 0, y: 50 }, end: { x: 100, y: 50 } }],
    startStation: 0,
    mesh,
  });
  for (const sample of profile.segments.flatMap((segment) => segment.samples)) {
    expect(sample.elevation).toBeCloseTo(10 + 0.02 * sample.rawChainage, 9);
  }
  const section = extractSampleLine({
    mesh,
    center: { x: 50, y: 50 },
    direction: { x: 0, y: 1 },
    leftWidth: 50,
    rightWidth: 50,
    rawStation: 50,
    lineId: 'sec-20e-qa',
  });
  if (!section.ok) throw new Error(section.code);
  for (const sample of section.section.segments.flatMap((segment) => segment.samples)) {
    expect(sample.elevation).toBeCloseTo(11, 9);
  }
});

// ---------------------------------------------------------------------------
// Q–R. WNCAD round-trip and LandXML export
// ---------------------------------------------------------------------------

test('Q WNCAD round-trips sparse overrides field-exact with results absent', () => {
  const ids = SQUARE_VERTEX_IDS;
  const world = squareWorld();
  const group = world.project.gradingGroups![0]!;
  // Author two sparse overrides without recomputing (persistence-only letter).
  const first = setCourseCriteriaOverrides(group, [{ vertexAId: ids[1]!, vertexBId: ids[2]! }], FIXED_STEEP);
  if (!first.ok) throw new Error('set failed');
  const second = setCourseCriteriaOverrides(first.value, [{ vertexAId: ids[3]!, vertexBId: ids[0]! }], { kind: 'fixed', gradeRatio: -0.75 });
  if (!second.ok) throw new Error('set failed');
  const project: CadProject = { ...world.project, gradingGroups: [second.value] };
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
  const once = serializeCadDrawingFile(drawing);
  const parsed = parseCadDrawingFile(once);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.drawing.project.gradingGroups).toEqual(project.gradingGroups);
  const twice = serializeCadDrawingFile({ ...drawing, project: parsed.drawing.project });
  const reparsed = parseCadDrawingFile(twice);
  expect(reparsed.ok).toBe(true);
  if (!reparsed.ok) return;
  expect(reparsed.drawing.project.gradingGroups).toEqual(project.gradingGroups);
  expect(twice).not.toContain('daylightPoints');
  // Second-pass serialization is the stable canonical WNCAD form.
  expect(serializeCadDrawingFile({ ...drawing, project: reparsed.drawing.project })).toBe(twice);
});

test('R the final applied design exports to LandXML and reimports by name', () => {
  const { project, designId, patchId } = flatApplyProject();
  const appliedProject = runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(project, designId),
    patchSurfaceId: patchId,
    patchExpectedRevision: revOf(project, patchId),
    sessionCurrent: true,
  }).present.project;
  const cache = createCadSurfaceCache(`20e-qa-r-${designId}`);
  for (const surface of appliedProject.surfaces ?? []) {
    const built = buildCadSurface(appliedProject, surface);
    if (built.outcome === 'ok') {
      cache.set(surface.id, revOf(appliedProject, surface.id), {
        revision: revOf(appliedProject, surface.id),
        points: built.points,
        triangles: built.triangles,
        stats: built.stats,
        grid: built.grid,
        adjacency: built.adjacency,
        edgeKinds: built.edgeKinds,
      });
    }
  }
  const xml = buildLandXmlProjectExportWithResult(
    appliedProject,
    { units: 'm', projectName: '20e-qa' },
    { surfaceCache: cache },
  );
  expect(xml.exportedEntityIds).toContain(designId);
  expect(xml.output).toContain('EG Design');
  const reimported = parseLandXmlSurfaces(parseXmlDocument(xml.output), 1, '20e-qa.xml');
  const roundTripped = reimported.find((entry) => entry.name === 'EG Design');
  expect(roundTripped).toBeDefined();
  expect(['IMPORTABLE', 'WARNING']).toContain(roundTripped!.disposition);
});

// ---------------------------------------------------------------------------
// Browser smoke: /cad boots + advanced grading fixtures open cleanly.
// ---------------------------------------------------------------------------

test.describe('browser smoke', () => {
  test('the /cad app boots with zero page/console errors', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    expect(errors).toEqual([]);
  });

  test('a drawing with a sparse-override grading group opens and the criteria editor renders', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = squareWorld().entity.vertices.map((v) => v.id);
    const world = squareWorld([
      { sourceCourse: { vertexAId: ids[1]!, vertexBId: ids[2]! }, criterion: FIXED_STEEP },
    ]);
    const data = serializeCadDrawingFile({
      ...createBlankCadDrawingDocument({ name: 'qa-20e', units: 'm' }),
      project: world.project,
    });
    const file = path.join(os.tmpdir(), `webnet-grading-advanced-20e-${Date.now()}.wncad`);
    fs.writeFileSync(file, data, 'utf8');
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);
      await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
      const manager = page.locator('[data-cad-grading-group-table]');
      await expect(manager).toBeVisible({ timeout: 15000 });
      await expect(manager).toContainText('Pad');
      // Wave-2A per-course criteria editor tab.
      await page.locator('[data-cad-grading-group-criteria-open]').first().click();
      const criteria = page.locator('[data-cad-grading-group-criteria]');
      await expect(criteria).toBeVisible({ timeout: 15000 });
      await expect(criteria).toContainText('Overrides: 1');
      await expect(page.locator('[data-cad-grading-group-criteria-row]')).toHaveCount(4);
      await expect(criteria).toContainText('Override');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
});
