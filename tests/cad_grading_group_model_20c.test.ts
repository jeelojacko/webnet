/**
 * Phase 20C Wave-1B oracles: group authoring (contiguity/closed-cycle/end
 * edits), `ggrev1` determinism + appearance exclusion, status precedence,
 * group cache retention, and analytic miter corner math (plane gradient,
 * seam, ray selection, extent, turn classification, cut/fill).
 *
 * Every geometric expectation is closed-form; no sampling or tolerance
 * fitting. Zero classification flows through the shared 18I `zeroDelta`.
 */
import { describe, expect, it } from 'vitest';
import {
  addCourseToOpenEnd,
  createGroupDefinition,
  editGroupCriteria,
  reassignGroupTarget,
  removeEndCourse,
  type CreateGroupInput,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  buildGroupRevision,
  type GroupRevisionInput,
} from '../src/engine/cad/grading/gradingGroupRevision';
import { deriveGroupStatus } from '../src/engine/cad/grading/gradingGroupStatus';
import { createCadGradingGroupCache } from '../src/engine/cad/grading/gradingGroupCache';
import {
  classifyCorner,
  cutFillSideAtCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
} from '../src/engine/cad/grading/gradingCornerMath';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GradingGroupCourse,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const course = (a: string, b: string): GradingGroupCourse => ({
  vertexAId: a,
  vertexBId: b,
});

const baseInput = (overrides: Partial<CreateGroupInput> = {}): CreateGroupInput => ({
  id: 'g1',
  name: 'Pad',
  sourceFeatureLineId: 'FL1',
  sourceCourses: [course('A', 'B'), course('B', 'C')],
  targetSurfaceId: 'TS1',
  side: 'left',
  criterion: { kind: 'fixed', gradeRatio: 0.02 },
  maxSearchDistance: 10,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  ...overrides,
});

const expectGroup = (overrides: Partial<CreateGroupInput> = {}): CadGradingGroup => {
  const result = createGroupDefinition(baseInput(overrides));
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const straight = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startZ = 100,
  endZ = 100,
): ResolvedGradingSource => ({
  startX,
  startY,
  endX,
  endY,
  startZ,
  endZ,
  length: Math.hypot(endX - startX, endY - startY),
  reoriented: false,
  isArc: false,
});

const revisionInput = (
  group: CadGradingGroup,
  resolved: ResolvedGradingSource[],
  targetRevision = 'srev1:abc',
): GroupRevisionInput => ({
  sourceFeatureLineId: group.sourceFeatureLineId,
  courses: group.sourceCourses.map((c, index) => ({
    ...c,
    resolvedSource: resolved[index]!,
  })),
  targetSurfaceId: group.targetSurfaceId,
  targetRevision,
  side: group.side,
  criterion: group.criterion,
  maxSearchDistance: group.maxSearchDistance,
  curveChordTolerance: group.curveChordTolerance,
  cornerMode: group.cornerMode,
  closed: group.closed === true,
});

const resultStub = (groupId: string, revision: string): CadGradingGroupResult => ({
  groupId,
  revision,
  accuracy: 'EXACT',
  memberCount: 1,
  cornerCount: 0,
  memberRegions: [],
  corners: [],
  daylightPoints: [],
  gradingMesh: { points: [], triangles: [] },
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
});

describe('group authoring — chain shape', () => {
  it('accepts a contiguous open chain', () => {
    expect(expectGroup().sourceCourses).toHaveLength(2);
  });

  it('accepts a complete closed cycle', () => {
    const group = expectGroup({
      sourceCourses: [course('A', 'B'), course('B', 'C'), course('C', 'D'), course('D', 'A')],
      closed: true,
    });
    expect(group.closed).toBe(true);
    expect(group.sourceCourses).toHaveLength(4);
  });

  it('rejects a disconnected chain', () => {
    const result = createGroupDefinition(
      baseInput({ sourceCourses: [course('A', 'B'), course('C', 'D')] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a repeated/backtracking vertex', () => {
    const result = createGroupDefinition(
      baseInput({ sourceCourses: [course('A', 'B'), course('B', 'C'), course('C', 'B')] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a closed cycle that does not return to its first vertex', () => {
    const result = createGroupDefinition(
      baseInput({
        sourceCourses: [course('A', 'B'), course('B', 'C'), course('C', 'D')],
        closed: true,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a closed cycle with fewer than three courses', () => {
    const result = createGroupDefinition(
      baseInput({ sourceCourses: [course('A', 'B'), course('B', 'A')], closed: true }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a course with identical endpoints and bad scalars/mode', () => {
    expect(createGroupDefinition(baseInput({ sourceCourses: [course('A', 'A')] })).ok).toBe(false);
    expect(createGroupDefinition(baseInput({ maxSearchDistance: 0 })).ok).toBe(false);
    expect(createGroupDefinition(baseInput({ curveChordTolerance: 0 })).ok).toBe(false);
    expect(createGroupDefinition(baseInput({ cornerMode: 'radial' as never })).ok).toBe(false);
  });
});

describe('group authoring — end edits', () => {
  it('appends and prepends only at matching ends', () => {
    const appended = addCourseToOpenEnd(expectGroup(), course('C', 'D'));
    if (!appended.ok) throw new Error(appended.error);
    expect(appended.value.sourceCourses.map((c) => c.vertexBId)).toEqual(['B', 'C', 'D']);
    const prepended = addCourseToOpenEnd(expectGroup(), course('Z', 'A'));
    if (!prepended.ok) throw new Error(prepended.error);
    expect(prepended.value.sourceCourses.map((c) => c.vertexAId)).toEqual(['Z', 'A', 'B']);
  });

  it('rejects a disconnected or repeating extension', () => {
    expect(addCourseToOpenEnd(expectGroup(), course('X', 'Y')).ok).toBe(false);
    expect(addCourseToOpenEnd(expectGroup(), course('C', 'B')).ok).toBe(false);
  });

  it('rejects end edits on a closed group', () => {
    const closed = expectGroup({
      sourceCourses: [course('A', 'B'), course('B', 'C'), course('C', 'A')],
      closed: true,
    });
    expect(addCourseToOpenEnd(closed, course('C', 'D')).ok).toBe(false);
    expect(removeEndCourse(closed, 'last').ok).toBe(false);
  });

  it('removes only open-chain ends and never the last course', () => {
    const last = removeEndCourse(expectGroup(), 'last');
    if (!last.ok) throw new Error(last.error);
    expect(last.value.sourceCourses).toEqual([course('A', 'B')]);
    const first = removeEndCourse(expectGroup(), 'first');
    if (!first.ok) throw new Error(first.error);
    expect(first.value.sourceCourses).toEqual([course('B', 'C')]);
    expect(removeEndCourse(expectGroup({ sourceCourses: [course('A', 'B')] }), 'last').ok).toBe(
      false,
    );
  });
});

describe('group authoring — criterion/target edits', () => {
  it('edits criterion and target with validation', () => {
    const edited = editGroupCriteria(expectGroup(), { kind: 'cut-fill', cutGradeRatio: 1, fillGradeRatio: -1 });
    expect(edited.ok && edited.value.criterion.kind).toBe('cut-fill');
    expect(editGroupCriteria(expectGroup(), { kind: 'fixed', gradeRatio: NaN }).ok).toBe(false);
    const moved = reassignGroupTarget(expectGroup(), 'TS2');
    expect(moved.ok && moved.value.targetSurfaceId).toBe('TS2');
    expect(reassignGroupTarget(expectGroup(), '').ok).toBe(false);
  });
});

describe('ggrev1 group revision', () => {
  const group = expectGroup();
  const resolved = [straight(0, 0, 10, 0), straight(10, 0, 10, 10)];

  it('is deterministic for identical content', () => {
    expect(buildGroupRevision(revisionInput(group, resolved))).toBe(
      buildGroupRevision(revisionInput(group, resolved)),
    );
  });

  it('flips when oriented geometry, target revision, or shape changes', () => {
    const base = buildGroupRevision(revisionInput(group, resolved));
    const movedCourse = [straight(0, 0, 10, 0), straight(10, 0, 10, 11)];
    expect(buildGroupRevision(revisionInput(group, movedCourse))).not.toBe(base);
    expect(buildGroupRevision(revisionInput(group, resolved, 'srev1:def'))).not.toBe(base);
  });

  it('excludes appearance (name/layer/style)', () => {
    const base = buildGroupRevision(revisionInput(group, resolved));
    const renamed: CadGradingGroup = { ...group, name: 'Renamed', layerId: 'L9', styleId: 'S9' };
    expect(buildGroupRevision(revisionInput(renamed, resolved))).toBe(base);
  });
});

describe('group status precedence', () => {
  const current = {
    brokenRef: false,
    building: false,
    hasResult: true,
    sourceCurrent: true,
    needsRecalc: false,
  };

  it('follows 20B precedence', () => {
    expect(deriveGroupStatus(current)).toBe('CURRENT');
    expect(deriveGroupStatus({ ...current, needsRecalc: true })).toBe('NEEDS_RECALC');
    expect(deriveGroupStatus({ ...current, sourceCurrent: false })).toBe('SOURCE_NOT_CURRENT');
    expect(deriveGroupStatus({ ...current, hasResult: false })).toBe('UNBUILT');
    expect(deriveGroupStatus({ ...current, building: true })).toBe('BUILDING');
    expect(deriveGroupStatus({ ...current, brokenRef: true })).toBe('BROKEN_REFERENCE');
    expect(deriveGroupStatus({ ...current, brokenRef: true, building: true })).toBe('BROKEN_REFERENCE');
  });
});

describe('group result cache', () => {
  it('retains current plus one stale and evicts the oldest', () => {
    const cache = createCadGradingGroupCache('drawing-1');
    cache.set('g1', resultStub('g1', 'ggrev1:a'));
    cache.set('g1', resultStub('g1', 'ggrev1:b'));
    cache.set('g1', resultStub('g1', 'ggrev1:c'));
    expect(cache.retained('g1').map((r) => r.revision)).toEqual(['ggrev1:b', 'ggrev1:c']);
    expect(cache.get('g1', 'ggrev1:c')?.revision).toBe('ggrev1:c');
    expect(cache.get('g1', 'ggrev1:a')).toBeUndefined();
  });

  it('invalidates per group and clears, isolating drawings', () => {
    const cache = createCadGradingGroupCache('drawing-1');
    const other = createCadGradingGroupCache('drawing-2');
    cache.set('g1', resultStub('g1', 'ggrev1:a'));
    other.set('g1', resultStub('g1', 'ggrev1:a'));
    cache.invalidate('g1');
    expect(cache.get('g1', 'ggrev1:a')).toBeUndefined();
    expect(other.get('g1', 'ggrev1:a')).toBeDefined();
    cache.clear();
    expect(cache.retained('g1')).toEqual([]);
  });
});

describe('corner math — grading plane', () => {
  it('builds the world gradient gs·T + g·N anchored at the source start', () => {
    const plane = gradingPlaneGradient(straight(0, 0, 10, 0, 100), 'left', 0.02, 0.03);
    expect(plane).toMatchObject({ gx: 0.03, gy: 0.02, zAtV: 100, ax: 0, ay: 0 });
    expect(planeElevationAt(plane!, 10, 0)).toBeCloseTo(100.3, 12);
  });

  it('fails closed on non-finite input', () => {
    expect(gradingPlaneGradient(straight(0, 0, 10, 0), 'left', NaN, 0)).toBeNull();
    expect(gradingPlaneGradient(straight(5, 5, 5, 5), 'left', 0.02, 0)).toBeNull();
  });
});

describe('corner math — turn classification', () => {
  it('flips GAP/OVERLAP with the grading side for a 90° turn', () => {
    const t1 = { nx: 1, ny: 0 };
    const t2 = { nx: 0, ny: 1 };
    expect(classifyCorner(t1, t2, 'left')).toBe('OVERLAP');
    expect(classifyCorner(t1, t2, 'right')).toBe('GAP');
    const t3 = { nx: 0, ny: -1 };
    expect(classifyCorner(t1, t3, 'left')).toBe('GAP');
    expect(classifyCorner(t1, t3, 'right')).toBe('OVERLAP');
  });

  it('reports collinear joints as TANGENT and fails closed on degeneracy', () => {
    expect(classifyCorner({ nx: 1, ny: 0 }, { nx: 2, ny: 0 }, 'left')).toBe('TANGENT');
    expect(classifyCorner({ nx: 0, ny: 0 }, { nx: 1, ny: 0 }, 'left')).toBeNull();
  });
});

describe('corner math — miter seam and ray', () => {
  it('returns the 45° unit seam ((1,1)/√2) and detects coincident planes', () => {
    const seam = miterSeam({ gx: 1, gy: 0 }, { gx: 0, gy: 1 });
    expect(seam).not.toBeNull();
    if (!seam || 'coincident' in seam) throw new Error('expected a seam');
    expect(seam.mx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(seam.my).toBeCloseTo(Math.SQRT1_2, 12);
    expect(miterSeam({ gx: 0.02, gy: 0.01 }, { gx: 0.02, gy: 0.01 })).toEqual({ coincident: true });
  });

  it('selects the in-half-plane ray and rejects inverted/ambiguous cases', () => {
    const m = { mx: Math.SQRT1_2, my: Math.SQRT1_2 };
    expect(selectMiterRay(m, { nx: 1, ny: 0 }, { nx: 0, ny: 1 })).toEqual(m);
    expect(selectMiterRay({ mx: 1, my: 0 }, { nx: -1, ny: 0 }, { nx: 1, ny: 0 })).toEqual({
      inverted: true,
    });
    expect(selectMiterRay({ mx: 1, my: 0 }, { nx: 0, ny: 1 }, { nx: 0, ny: 1 })).toEqual({
      ambiguous: true,
    });
  });

  it('computes the tightest analytic extent and fails closed otherwise', () => {
    const m = { mx: Math.SQRT1_2, my: Math.SQRT1_2 };
    expect(miterExtent(m, { nx: 1, ny: 0 }, { nx: 0, ny: 1 }, 10)).toBeCloseTo(
      10 / Math.cos(Math.PI / 4),
      12,
    );
    expect(miterExtent({ mx: 1, my: 0 }, { nx: -1, ny: 0 }, { nx: 0, ny: 1 }, 10)).toBeNull();
    expect(miterExtent({ mx: 1, my: 0 }, { nx: 0, ny: 1 }, { nx: 0, ny: 1 }, 10)).toBeNull();
  });
});

describe('corner math — square pad 90° joint', () => {
  const joint = (side: 'left' | 'right') => {
    const grad1 = gradingPlaneGradient(straight(0, 0, 10, 0), side, 0.05, 0);
    const grad2 = gradingPlaneGradient(straight(10, 0, 10, 10), side, 0.05, 0);
    const n1 = gradingSideNormal(1, 0, side);
    const n2 = gradingSideNormal(0, 1, side);
    const seam = miterSeam(grad1!, grad2!);
    if (!seam || 'coincident' in seam) throw new Error('expected a seam');
    return { seam, n1: n1!, n2: n2! };
  };

  it('outside (right) turn is a valid GAP miter', () => {
    const { seam, n1, n2 } = joint('right');
    const ray = selectMiterRay(seam, n1, n2);
    if (!ray || 'ambiguous' in ray || 'inverted' in ray) throw new Error('expected a ray');
    expect(ray.mx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(ray.my).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(miterExtent(ray, n1, n2, 10)).toBeCloseTo(10 * Math.SQRT2, 12);
    expect(classifyCorner({ nx: 1, ny: 0 }, { nx: 0, ny: 1 }, 'right')).toBe('GAP');
  });

  it('inside (left) turn is a valid OVERLAP miter', () => {
    const { seam, n1, n2 } = joint('left');
    const ray = selectMiterRay(seam, n1, n2);
    if (!ray || 'ambiguous' in ray || 'inverted' in ray) throw new Error('expected a ray');
    expect(ray.mx).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(ray.my).toBeCloseTo(Math.SQRT1_2, 12);
    expect(classifyCorner({ nx: 1, ny: 0 }, { nx: 0, ny: 1 }, 'left')).toBe('OVERLAP');
  });
});

describe('corner math — cut/fill at the corner', () => {
  it('classifies CUT, FILL, and TIED with zeroDelta', () => {
    expect(cutFillSideAtCorner(101, 100)).toBe('CUT');
    expect(cutFillSideAtCorner(99, 100)).toBe('FILL');
    expect(cutFillSideAtCorner(100, 100)).toBe('TIED');
    expect(cutFillSideAtCorner(NaN, 100)).toBeNull();
  });
});
