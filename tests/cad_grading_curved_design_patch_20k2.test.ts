/**
 * Phase 20K.2 Worker C — curved Design Patch closeout.
 *
 * A3 (RED then GREEN): the final Phase 20K.1 outward rounded square
 * (four convex arcs, chord 100, sagitta 5, R 252.5, source Z=10, tol 0.1)
 * driven through the REAL product path (closed feature-line group ->
 * GROUP_CREATE -> group compute -> GROUPEXTRACTDAYLIGHT / GROUPBAKE /
 * DESIGNPATCH). all-Distance and mixed-analytic reach CURRENT at
 * 128 pts / 128 tris, 4 GAP ties, plan 9452.124826335, pass Extract + Bake,
 * and (after the 20K.2 exact-duplicate ring collapse) pass Design Patch.
 * all-Surface reaches CURRENT at 156 pts / 156 tris and passes Extract +
 * Bake, but its Design Patch stays explicitly restricted: the Surface seam
 * resamples each shared station as `start + t*length`, so the captured ring
 * carries ulp-twin micro-edges and ear-clipping fails closed
 * (`DESIGN_PATCH_NON_SIMPLE_RING : SURFACE_EDIT_NOT_APPLICABLE`). See
 * `docs/evidence/phase20k2-curved-design-patch-cutfill.md` for the
 * root-cause write-up and the recommended next-phase fix.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { canonicalizeBakedTin } from '../src/engine/cad/cadExplicitBake';
import { validateExplicitTinPayload } from '../src/engine/cad/cadImportedTin';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import {
  DESIGN_PATCH_GROUP_NOT_CURRENT,
  DESIGN_PATCH_MERGE_FAILED,
  DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED,
  DESIGN_PATCH_NON_SIMPLE_RING,
  DESIGN_PATCH_RING_MESH_MISMATCH,
  designPatchSourceBoundaryPoints,
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { digestSeamMesh } from '../src/engine/cad/grading/gradingChordSeam';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { validateGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import { designPatchInteriorText } from '../src/cad-app/shell/cadDesignPatchInterior';

const DIST: GradingCriterion = { kind: 'distance', gradeRatio: -0.5, distance: 20 };
const ELEV: GradingCriterion = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 };
const REL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 };
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };

const Z = 10;
const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

/** Same outward rounded-square arcs as the study fixture, as bulge geometry. */
const arcGeometry = (): Array<{ kind: 'arc'; bulge: number }> => {
  const members = roundedSquareMembers(Z);
  return members.map((member, k) => {
    const arc = member.source.arc!;
    let sweep = ((((arc.endAngle - arc.startAngle) * 180) / Math.PI) % 360 + 360) % 360;
    if (!arc.sweepCCW) sweep -= 360;
    const bulge = parcelBulgeFromArcDefinition({
      from: { x: SQUARE[k]![0], y: SQUARE[k]![1] },
      to: { x: SQUARE[(k + 1) % 4]![0], y: SQUARE[(k + 1) % 4]![1] },
      center: { x: arc.centerX, y: arc.centerY },
      radius: arc.radius,
      signedSweepDeg: sweep,
    });
    if (bulge == null) throw new Error(`bulge ${k} unresolved`);
    return { kind: 'arc', bulge };
  });
};

interface ProductSquare {
  history: ReturnType<typeof createCadHistoryState>;
  project: CadProject;
  groupId: string;
  revision: string;
  result: CadGradingGroupResult;
  isSurface: boolean;
}

const isAnalytic = (criterion: GradingCriterion): boolean =>
  criterion.kind === 'distance' || criterion.kind === 'elevation' || criterion.kind === 'relative-elevation';

/** Real product world: closed rounded-square group on a flat z=0 target. */
const buildSquare = (
  criterion: GradingCriterion,
  memberCriteria: GradingCriterion[],
  dx = 0,
  dy = 0,
): ProductSquare => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.2 Design Patch', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'fl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'Rounded square', closed: true,
    vertices: SQUARE.map(([x, y], k) => ({ id: `v${k}`, x: x + dx, y: y + dy, z: Z })),
    segmentGeometry: arcGeometry(),
  };
  const tin = {
    vertices: [-600 + dx, -600 + dy, 0, 1000 + dx, -600 + dy, 0, 1000 + dx, 1000 + dy, 0, -600 + dx, 1000 + dy, 0],
    faces: [0, 1, 2, 0, 2, 3],
    provenance: { kind: 'webnet-bake' as const, sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
  const target: CadSurface = {
    id: 'tgt', name: 'EG', layerId: 'general',
    definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: tin },
    cachedRevision: null,
  };
  const project: CadProject = { ...drawing.project, entities: [entity], surfaces: [target] };
  const ids = entity.vertices.map((v) => v.id);
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE', name: 'RG', sourceFeatureLineId: 'fl',
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % 4]! })),
    targetSurfaceId: 'tgt', side: 'right', criterion, maxSearchDistance: 100,
    curveChordTolerance: 0.1, closed: true,
  });
  const withGroup = history.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId);
  if (!inputs) throw new Error('group inputs do not resolve');
  const surface = !isAnalytic(criterion);
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    memberCriteria,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    ...(surface ? { target: { points: tin.vertices, triangles: tin.faces } } : {}),
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return { history, project: withGroup, groupId, revision: inputs.revision, result: outcome.result, isSurface: surface };
};

const runPatch = (square: ProductSquare) =>
  runCadCommand(square.history, {
    key: 'DESIGNPATCH',
    groupId: square.groupId,
    result: square.result,
    expectedRevision: square.revision,
    sessionCurrent: true,
  });

const bakePayload = (result: CadGradingGroupResult) => {
  const canonical = canonicalizeBakedTin(result.gradingMesh.points, result.gradingMesh.triangles);
  return { vertices: canonical.vertices, faces: canonical.faces, provenance: { format: 'explicit', fileName: 'group', surfaceName: 'group' } };
};

// ---------------------------------------------------------------------------
// A3 — product-stage matrix
// ---------------------------------------------------------------------------

describe('20K.2 A3 curved rounded-square product stages', () => {
  it('all-Distance: CURRENT 128/128, 4 ties, plan 9452.124826335, Extract+Bake pass', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    expect(square.result.gradingMesh.points.length / 3).toBe(128);
    expect(square.result.gradingMesh.triangles.length / 3).toBe(128);
    expect(square.result.corners).toHaveLength(4);
    for (const corner of square.result.corners) expect(corner.classification).toBe('GAP');
    expect(square.result.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
    expect(validateGroupMesh(square.result.gradingMesh)).toBeNull();
    expect(validateExplicitTinPayload(bakePayload(square.result) as never)).toBeNull();
  });

  it('mixed-analytic: CURRENT 128/128, plan 9452.124826335, bitwise equal to all-Distance', () => {
    const analytic = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const mixed = buildSquare(DIST, [DIST, ELEV, REL, DIST]);
    expect(mixed.result.gradingMesh.points).toEqual(analytic.result.gradingMesh.points);
    expect(mixed.result.gradingMesh.triangles).toEqual(analytic.result.gradingMesh.triangles);
    expect(mixed.result.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
    expect(validateGroupMesh(mixed.result.gradingMesh)).toBeNull();
    expect(validateExplicitTinPayload(bakePayload(mixed.result) as never)).toBeNull();
  });

  it('all-Surface: CURRENT 156/156, Extract+Bake pass, Design Patch explicitly restricted', () => {
    const square = buildSquare(FIXED, [FIXED, FIXED, FIXED, FIXED]);
    expect(square.isSurface).toBe(true);
    expect(square.result.gradingMesh.points.length / 3).toBe(156);
    expect(square.result.gradingMesh.triangles.length / 3).toBe(156);
    expect(square.result.corners).toHaveLength(4);
    expect(square.result.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
    expect(validateGroupMesh(square.result.gradingMesh)).toBeNull();
    expect(validateExplicitTinPayload(bakePayload(square.result) as never)).toBeNull();
    // Design Patch fails closed at the interior build (Surface seam resample
    // micro-edges defeat ear-clipping). Code + exact ear-clip stage recorded.
    const dp = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
    expect(dp.ok).toBe(false);
    if (dp.ok) return;
    expect(dp.code).toBe(DESIGN_PATCH_NON_SIMPLE_RING);
    expect(dp.detail).toBe('SURFACE_EDIT_NOT_APPLICABLE');
    // Zero mutation: the blocked command returns the same history identity.
    expect(runPatch(square)).toBe(square.history);
    expect(square.history.present.project.surfaces).toHaveLength(1);
  });

  it('all-Surface restriction: truthful interior notice, command still blocked, Bake unaffected', () => {
    const square = buildSquare(FIXED, [FIXED, FIXED, FIXED, FIXED]);
    const boundary = designPatchSourceBoundaryPoints(square.project, square.groupId, square.result);
    expect(boundary.ok).toBe(true);
    if (!boundary.ok) return;
    // The captured interior IS flat (the restriction is the ring, not the pad),
    // so the inquiry badge stays truthful.
    expect(designPatchInteriorText(boundary.ring)).toContain('Flat');
    expect(resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true).ok).toBe(false);
    const baked = runCadCommand(square.history, {
      key: 'GROUPBAKE', groupId: square.groupId, result: square.result,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(baked.present.project.surfaces).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Design Patch — valid product cases
// ---------------------------------------------------------------------------

const edgeComponents = (points: readonly number[], triangles: readonly number[]): number => {
  const key = (index: number): string => `${points[index * 3]}|${points[index * 3 + 1]}|${points[index * 3 + 2]}`;
  const parent = new Map<string, string>();
  const find = (v: string): string => {
    let root = v;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = key(triangles[i]!);
    const b = key(triangles[i + 1]!);
    const c = key(triangles[i + 2]!);
    union(a, b);
    union(b, c);
  }
  return new Set([...parent.keys()].map(find)).size;
};

const boundaryComponents = (points: readonly number[], triangles: readonly number[]): number => {
  const key = (index: number): string => `${points[index * 3]}|${points[index * 3 + 1]}|${points[index * 3 + 2]}`;
  const incidence = new Map<string, number>();
  const bump = (a: string, b: string): void => {
    const edge = a < b ? `${a}||${b}` : `${b}||${a}`;
    incidence.set(edge, (incidence.get(edge) ?? 0) + 1);
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    bump(key(triangles[i]!), key(triangles[i + 1]!));
    bump(key(triangles[i + 1]!), key(triangles[i + 2]!));
    bump(key(triangles[i + 2]!), key(triangles[i]!));
  }
  const parent = new Map<string, string>();
  const find = (v: string): string => (parent.get(v) === undefined ? v : (parent.get(v) === v ? v : (parent.set(v, find(parent.get(v)!)), parent.get(v)!)));
  for (const [edge, count] of incidence) {
    if (count !== 1) continue;
    const [a, b] = edge.split('||') as [string, string];
    parent.set(find(a), find(b));
  }
  return new Set([...parent.keys()].map(find)).size;
};

describe('20K.2 Design Patch valid cases', () => {
  it('all-Distance snapshot: provenance, connected pad, exact shell retention, undo/redo', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const patched = runPatch(square);
    expect(patched.undoStack.length).toBe(square.history.undoStack.length + 1);
    const patch = patched.present.project.surfaces!.find((s) => s.purpose === 'design-patch')!;
    expect(patch).toBeDefined();
    const tin = patch.definition.importedTin!;
    expect(validateExplicitTinPayload(tin as never)).toBeNull();
    expect(tin.provenance).toMatchObject({
      kind: 'webnet-grading-design-patch',
      groupId: square.groupId,
      groupRevision: square.revision,
      accuracy: 'CURVE_APPROXIMATED',
      cornerMode: 'miter',
      includesInterior: true,
      interiorPolicy: 'flat-source',
    });
    // One connected final TIN; grading shell keeps its two boundary cycles.
    expect(edgeComponents(tin.vertices, tin.faces)).toBe(1);
    expect(boundaryComponents(square.result.gradingMesh.points, square.result.gradingMesh.triangles)).toBe(2);
    // Shell retained exactly: every shell triangle is present in the output.
    const hasTriangle = (verts: readonly number[], faces: readonly number[], a: number[], b: number[], c: number[]): boolean => {
      const set = new Set<string>();
      for (let i = 0; i + 2 < faces.length; i += 3) {
        set.add([faces[i], faces[i + 1], faces[i + 2]].map((v) => `${verts[v! * 3]}|${verts[v! * 3 + 1]}|${verts[v! * 3 + 2]}`).join('~'));
      }
      return set.has([a, b, c].map((v) => v.join('|')).join('~'));
    };
    const mesh = square.result.gradingMesh;
    for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
      const tri = (index: number): number[] =>
        [mesh.points[index * 3]!, mesh.points[index * 3 + 1]!, mesh.points[index * 3 + 2]!];
      expect(hasTriangle(tin.vertices, tin.faces, tri(mesh.triangles[i]!), tri(mesh.triangles[i + 1]!), tri(mesh.triangles[i + 2]!))).toBe(true);
    }
    // One Undo / Redo restores byte-identically.
    const undone = undoCadHistory(patched);
    expect(undone.present.project.surfaces).toHaveLength(1);
    const redone = redoCadHistory(undone);
    expect(JSON.stringify(redone.present.project)).toBe(JSON.stringify(patched.present.project));
  });

  it('is deterministic across repeated resolves (digest)', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const a = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
    const b = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(digestSeamMesh(a.value.points, a.value.triangles)).toBe(digestSeamMesh(b.value.points, b.value.triangles));
  });

  it('translated large-coordinate equivalent resolves with the same plan (1e-9 rel)', () => {
    const local = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const moved = buildSquare(DIST, [DIST, DIST, DIST, DIST], 2_000_000, 7_000_000);
    expect(moved.result.gradingPlanArea).toBeCloseTo(local.result.gradingPlanArea, 6);
    expect(Math.abs(moved.result.gradingPlanArea - local.result.gradingPlanArea) / local.result.gradingPlanArea).toBeLessThan(1e-9);
    expect(resolveDesignPatch(moved.project, moved.groupId, moved.result, moved.revision, true).ok).toBe(true);
  });

  it('save/reopen/recalculate keeps the patch valid', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const reopened: CadProject = JSON.parse(JSON.stringify(square.project)) as CadProject;
    const inputs = resolveGroupInputs(reopened, square.groupId);
    expect(inputs).not.toBeNull();
    if (!inputs) return;
    const recalculated = computeGradingGroupFromSnapshots({
      groupId: square.groupId, revision: inputs.revision, members: inputs.memberSources,
      side: inputs.group.side, criterion: inputs.group.criterion,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    });
    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok) return;
    expect(resolveDesignPatch(reopened, square.groupId, recalculated.result, inputs.revision, true).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Design Patch — fail-closed cases
// ---------------------------------------------------------------------------

describe('20K.2 Design Patch fail-closed cases', () => {
  it('rejects a stale revision and a non-CURRENT session', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    expect(resolveDesignPatch(square.project, square.groupId, square.result, 'ggrev1:stale', true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_GROUP_NOT_CURRENT });
    expect(resolveDesignPatch(square.project, square.groupId, square.result, square.revision, false))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_GROUP_NOT_CURRENT });
  });

  it('rejects a warped captured pad without averaging it onto a plane', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const warped: CadGradingGroupResult = {
      ...square.result,
      sourceBoundaryPoints: [0, 0, 10, 100, 0, 12, 100, 100, 10, 0, 100, 10],
    };
    expect(resolveDesignPatch(square.project, square.groupId, warped, square.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED });
  });

  it('rejects a tampered grading mesh with a ring/mesh mismatch', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const points = [...square.result.gradingMesh.points];
    const at = points.findIndex((_, i) => i % 3 === 2 && points[i - 2] === 0 && points[i - 1] === 0 && points[i] === Z);
    expect(at).toBeGreaterThanOrEqual(0);
    points[at] = Z + 0.25;
    const tampered: CadGradingGroupResult = { ...square.result, gradingMesh: { points, triangles: [...square.result.gradingMesh.triangles] } };
    expect(resolveDesignPatch(square.project, square.groupId, tampered, square.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_RING_MESH_MISMATCH });
  });

  it('rejects a non-annulus shell with a merge failure', () => {
    const square = buildSquare(DIST, [DIST, DIST, DIST, DIST]);
    const n = square.result.gradingMesh.points.length / 3;
    const forged: CadGradingGroupResult = {
      ...square.result,
      gradingMesh: {
        points: [...square.result.gradingMesh.points, 1000, 1000, 0, 1001, 1000, 0, 1000, 1001, 0],
        triangles: [...square.result.gradingMesh.triangles, n, n + 1, n + 2],
      },
    };
    expect(resolveDesignPatch(square.project, square.groupId, forged, square.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_MERGE_FAILED });
  });
});
