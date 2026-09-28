/**
 * Phase 20E Wave-1A — per-course criterion engine tests (resolve/compute/
 * revision/boundary/oracles).
 *
 * Direct kernel coverage for §§12, 13, 16, 19, 70-78: fixed override,
 * cut/fill override, mixed members, both-cut/both-fill same-class identity,
 * tied mixed, unequal-slope analytic miter, same-slope 20C regression pins
 * (20m offset / 20√2 tie / 140×140 daylight / 9600 area), collinear
 * different-criteria fail-closed (§76), same-plane merge (§77), reverse
 * invariance, and edge-by-edge boundary capture with no-numeric-change.
 */
import { describe, expect, it } from 'vitest';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GroupSolveInput } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  gradingPlaneGradient,
  planeElevationAt,
} from '../src/engine/cad/grading/gradingCornerMath';
import {
  canonicalCourseCriteria,
  resolveGradingGroupCourseCriterion,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GradingGroupCourse,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

type Outcome = ReturnType<typeof computeGradingGroupFromSnapshots>;

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const gridTarget = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[],
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const flatTarget = (
  z: number, minX: number, minY: number, maxX: number, maxY: number, step = 20,
): GradingTargetMeshSnapshot =>
  gridTarget(() => z, range(minX, maxX, step), range(minY, maxY, step));

const expectOk = (out: Outcome): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const FIXED_HALF: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const FIXED_STEEP: GradingCriterion = { kind: 'fixed', gradeRatio: -1.0 };

const solve = (
  members: ResolvedGradingSource[],
  target: GradingTargetMeshSnapshot,
  overrides?: {
    side?: 'left' | 'right';
    closed?: boolean;
    criterion?: GradingCriterion;
    memberCriteria?: GradingCriterion[];
  },
): Outcome =>
  computeGradingGroupFromSnapshots({
    groupId: 'g20e',
    revision: 'ggrev1:20e',
    members,
    side: overrides?.side ?? 'right',
    criterion: overrides?.criterion ?? FIXED_HALF,
    ...(overrides?.memberCriteria !== undefined ? { memberCriteria: overrides.memberCriteria } : {}),
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: overrides?.closed ?? false,
    target,
  } satisfies GroupSolveInput);

const digest = (r: CadGradingGroupResult): string => JSON.stringify({
  area: r.gradingPlanArea,
  area3d: r.grading3dArea,
  tri: r.gradingMesh.triangles,
  daylight: r.daylightPoints,
  regions: r.memberRegions,
  corners: r.corners.map((c) => [c.classification, c.tiePointXyz, c.miterRay]),
});

const squareMembers = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0), straight(100, 0, 100, 100),
  straight(100, 100, 0, 100), straight(0, 100, 0, 0),
];

const squareGroup = (courseCriteria?: CadGradingGroup['courseCriteria']): CadGradingGroup => ({
  id: 'sq',
  name: 'Square',
  sourceFeatureLineId: 'fl',
  sourceCourses: [
    { vertexAId: 'a', vertexBId: 'b' }, { vertexAId: 'b', vertexBId: 'c' },
    { vertexAId: 'c', vertexBId: 'd' }, { vertexAId: 'd', vertexBId: 'a' },
  ],
  targetSurfaceId: 'tgt',
  side: 'right',
  criterion: FIXED_HALF,
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  closed: true,
  ...(courseCriteria !== undefined ? { courseCriteria } : {}),
});

describe('20E resolver: sparse overrides', () => {
  const group = squareGroup([
    { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
  ]);

  it('override wins on its course, default elsewhere', () => {
    const courses: GradingGroupCourse[] = group.sourceCourses;
    expect(resolveGradingGroupCourseCriterion(group, courses[1]!)).toEqual(FIXED_STEEP);
    expect(resolveGradingGroupCourseCriterion(group, courses[0]!)).toEqual(FIXED_HALF);
    expect(resolveGradingGroupCourseCriterion(group, courses[3]!)).toEqual(FIXED_HALF);
  });

  it('reverse-order ref rides along (reverse invariant)', () => {
    expect(
      resolveGradingGroupCourseCriterion(group, { vertexAId: 'c', vertexBId: 'b' }),
    ).toEqual(FIXED_STEEP);
  });

  it('member criteria resolve in traversal order with one map build', () => {
    expect(resolveGroupMemberCriteria(group)).toEqual(
      [FIXED_HALF, FIXED_STEEP, FIXED_HALF, FIXED_HALF],
    );
    expect(resolveGroupMemberCriteria(squareGroup())).toEqual(
      [FIXED_HALF, FIXED_HALF, FIXED_HALF, FIXED_HALF],
    );
  });

  it('canonical form drops default-equal entries and follows traversal order', () => {
    const withDefaultCopy = squareGroup([
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
      { sourceCourse: { vertexAId: 'd', vertexBId: 'a' }, criterion: { ...FIXED_HALF } },
    ]);
    expect(canonicalCourseCriteria(withDefaultCopy)).toEqual([
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
    ]);
  });
});

describe('20E fixed override on one course', () => {
  // L: east 100m then north 100m, flat target 10m below, right side (GAP).
  const members = [straight(0, 0, 100, 0), straight(100, 0, 100, 100)];
  const target = flatTarget(0, -60, -60, 160, 160);

  it('steep override shortens only its own member strip', () => {
    const base = expectOk(solve(members, target));
    const varied = expectOk(solve(members, target, { memberCriteria: [FIXED_HALF, FIXED_STEEP] }));
    // Steeper second member: 10m drop over 10m instead of 20m.
    expect(varied.maxProjectionDistance).toBeCloseTo(20, 6);
    expect(varied.minProjectionDistance).toBeCloseTo(10, 6);
    expect(varied.gradingPlanArea).toBeLessThan(base.gradingPlanArea);
    // First member untouched: its region span matches the base run.
    expect(varied.memberRegions.filter((r) => r.memberIndex === 0))
      .toEqual(base.memberRegions.filter((r) => r.memberIndex === 0));
  });

  it('all-default memberCriteria is numerically identical to legacy input', () => {
    const legacy = expectOk(solve(members, target));
    const explicit = expectOk(
      solve(members, target, { memberCriteria: [FIXED_HALF, FIXED_HALF] }),
    );
    expect(digest(explicit)).toBe(digest(legacy));
  });
});

describe('20E cut/fill + mixed + tied members', () => {
  const members = [straight(0, 0, 100, 0), straight(100, 0, 100, 100)];

  it('cut-fill override on an all-CUT target matches the fixed cut ratio', () => {
    // Target 10m ABOVE source: CUT everywhere.
    const target = flatTarget(20, -60, -60, 160, 160);
    const cutFill: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 };
    const viaOverride = expectOk(solve(members, target, {
      criterion: FIXED_HALF,
      memberCriteria: [{ ...cutFill }, { ...cutFill }],
    }));
    const viaFixed = expectOk(solve(members, target, {
      criterion: { kind: 'fixed', gradeRatio: 0.5 },
    }));
    // Same geometry (cut-fill spans split at target grid nodes, so region
    // granularity differs by construction — compare physical quantities).
    expect(viaOverride.gradingPlanArea).toBeCloseTo(viaFixed.gradingPlanArea, 9);
    expect(viaOverride.grading3dArea).toBeCloseTo(viaFixed.grading3dArea, 9);
    expect(viaOverride.corners.map((c) => c.tiePointXyz)).toEqual(
      viaFixed.corners.map((c) => c.tiePointXyz),
    );
    expect(viaOverride.memberRegions.every((r) => r.classification === 'CUT')).toBe(true);
    expect(cutFill.kind).toBe('cut-fill');
  });

  it('both-fill same class matches the fixed fill ratio', () => {
    const target = flatTarget(0, -60, -60, 160, 160);
    const fill: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 };
    const viaOverride = expectOk(solve(members, target, { memberCriteria: [fill, fill] }));
    const viaFixed = expectOk(solve(members, target));
    expect(viaOverride.gradingPlanArea).toBeCloseTo(viaFixed.gradingPlanArea, 9);
    expect(viaOverride.grading3dArea).toBeCloseTo(viaFixed.grading3dArea, 9);
    expect(viaOverride.corners.map((c) => c.tiePointXyz)).toEqual(
      viaFixed.corners.map((c) => c.tiePointXyz),
    );
    expect(viaOverride.memberRegions.every((r) => r.classification === 'FILL')).toBe(true);
  });

  it('mixed fixed + cut-fill members solve with per-member regions', () => {
    const target = flatTarget(0, -60, -60, 160, 160);
    const mixed = expectOk(solve(members, target, {
      memberCriteria: [FIXED_HALF, { kind: 'cut-fill', cutGradeRatio: 0.25, fillGradeRatio: -0.25 }],
    }));
    expect(mixed.memberRegions.filter((r) => r.memberIndex === 0).every((r) => r.classification === 'FIXED')).toBe(true);
    expect(mixed.memberRegions.filter((r) => r.memberIndex === 1).every((r) => r.classification === 'FILL')).toBe(true);
    // Shallower second member: 40m offset dominates the max distance.
    expect(mixed.maxProjectionDistance).toBeCloseTo(40, 6);
  });

  it('tied single member reuses zero-width logic (no area, FIXED)', () => {
    const tiedTarget = flatTarget(10, -60, -60, 160, 160);
    const r = expectOk(solve([straight(0, 0, 100, 0)], tiedTarget, {
      memberCriteria: [{ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 }],
    }));
    expect(r.gradingPlanArea).toBe(0);
    expect(r.memberRegions.every((region) => region.classification === 'FIXED')).toBe(true);
  });
});

describe('20E unequal-slope analytic miter', () => {
  const members = [straight(0, 0, 100, 0), straight(100, 0, 100, 100)];
  const target = flatTarget(0, -60, -60, 160, 160);

  it('tie sits on both corner planes at the target (GAP, -0.5 vs -1.0)', () => {
    const r = expectOk(solve(members, target, { memberCriteria: [FIXED_HALF, FIXED_STEEP] }));
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.classification).toBe('GAP');
    const tie = r.corners[0]!.tiePointXyz!;
    // Rebuild both corner planes in-test from the effective criteria.
    const plane1 = gradingPlaneGradient(
      { ...members[0]!, startX: 100, startY: 0, endX: 200, endY: 0, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
      'right', -0.5, 0,
    )!;
    const plane2 = gradingPlaneGradient(
      { ...members[1]!, startX: 100, startY: 0, endX: 100, endY: 100, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
      'right', -1.0, 0,
    )!;
    const z1 = planeElevationAt(plane1, tie[0], tie[1])!;
    const z2 = planeElevationAt(plane2, tie[0], tie[1])!;
    expect(Math.abs(z1 - z2)).toBeLessThan(1e-6);
    expect(Math.abs(tie[2])).toBeLessThan(1e-6);
    // Steeper east member pulls the tie east of the symmetric (120,-20).
    const symmetric = expectOk(solve(members, target));
    expect(tie[0]).toBeLessThan(symmetric.corners[0]!.tiePointXyz![0]);
  });
});

describe('20E same-slope 20C regression (square pad)', () => {
  const members = squareMembers();
  const target = flatTarget(0, -60, -60, 160, 160);

  it('pins 20m offset, 20√2 tie, 140×140 daylight, 9600 area', () => {
    const r = expectOk(solve(members, target, { closed: true }));
    expect(r.maxProjectionDistance).toBeCloseTo(20, 6);
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
    const xs = r.daylightPoints.filter((_, i) => i % 3 === 0);
    const ys = r.daylightPoints.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-20, 6);
    expect(Math.max(...xs)).toBeCloseTo(120, 6);
    expect(Math.min(...ys)).toBeCloseTo(-20, 6);
    expect(Math.max(...ys)).toBeCloseTo(120, 6);
    for (const corner of r.corners) {
      const tie = corner.tiePointXyz!;
      const dist = Math.min(
        Math.hypot(tie[0] - 0, tie[1] - 0), Math.hypot(tie[0] - 100, tie[1] - 0),
        Math.hypot(tie[0] - 100, tie[1] - 100), Math.hypot(tie[0] - 0, tie[1] - 100),
      );
      expect(dist).toBeCloseTo(20 * Math.SQRT2, 6);
    }
  });
});

describe('20E collinear joints (§76 fail / §77 merge)', () => {
  const members = [straight(0, 0, 50, 0), straight(50, 0, 100, 0)];
  const target = flatTarget(0, -60, -60, 160, 160);

  it('collinear same-criterion merges silently (TANGENT, no patch)', () => {
    const r = expectOk(solve(members, target));
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.classification).toBe('TANGENT');
    expect(r.corners[0]!.tiePointXyz).toBeUndefined();
  });

  it('collinear different-criteria fails closed (§76)', () => {
    const out = solve(members, target, { memberCriteria: [FIXED_HALF, FIXED_STEEP] });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('CORNER_COINCIDENT_PLANES');
      expect(out.cornerIndex).toBe(0);
    }
  });

  it('collinear different-on-paper but coincident gradients still merge (§77)', () => {
    // Corner delta is FILL (target below source): cut-fill picks fill -0.5,
    // the same plane as fixed -0.5 on flat ground with zero long grade.
    const r = expectOk(solve(members, target, {
      memberCriteria: [FIXED_HALF, { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 }],
    }));
    expect(r.corners[0]!.classification).toBe('TANGENT');
    expect(r.corners[0]!.tiePointXyz).toBeUndefined();
  });
});

describe('20E sourceBoundaryPoints capture', () => {
  it('square pad boundary is edge-by-edge exact and closed', () => {
    const r = expectOk(solve(squareMembers(), flatTarget(0, -60, -60, 160, 160), { closed: true }));
    expect(r.sourceBoundaryPoints).toEqual([
      0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 10, 0, 0, 10,
    ]);
  });

  it('open chain boundary runs member starts + final end', () => {
    const r = expectOk(solve(
      [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
      flatTarget(0, -60, -60, 160, 160),
    ));
    expect(r.sourceBoundaryPoints).toEqual([0, 0, 10, 100, 0, 10, 100, 100, 10]);
  });

  it('boundary is pure observation: identical numerics with and without it', () => {
    const members = squareMembers();
    const target = flatTarget(0, -60, -60, 160, 160);
    const a = expectOk(solve(members, target, { closed: true }));
    const b = expectOk(solve(members, target, {
      closed: true,
      memberCriteria: [FIXED_HALF, FIXED_HALF, FIXED_HALF, FIXED_HALF],
    }));
    const strip = (r: CadGradingGroupResult): CadGradingGroupResult => {
      const { sourceBoundaryPoints: _dropped, ...rest } = r;
      return rest;
    };
    expect(digest(strip(b))).toBe(digest(strip(a)));
    expect(a.sourceBoundaryPoints).toBeDefined();
  });
});

describe('20E ggrev1 with sparse overrides', () => {
  const courses = (group: CadGradingGroup): Parameters<typeof buildGroupRevision>[0] => ({
    sourceFeatureLineId: group.sourceFeatureLineId,
    courses: group.sourceCourses.map((course) => ({
      vertexAId: course.vertexAId,
      vertexBId: course.vertexBId,
      resolvedSource: straight(0, 0, 100, 0),
    })),
    targetSurfaceId: group.targetSurfaceId,
    targetRevision: 'srev1:t',
    side: group.side,
    criterion: group.criterion,
    ...(group.courseCriteria !== undefined ? { courseCriteria: group.courseCriteria } : {}),
    maxSearchDistance: group.maxSearchDistance,
    curveChordTolerance: group.curveChordTolerance,
    cornerMode: group.cornerMode,
    closed: true,
  });

  it('absent/empty overrides hash byte-identical to legacy', () => {
    const legacy = buildGroupRevision(courses(squareGroup()));
    expect(buildGroupRevision(courses(squareGroup([])))).toBe(legacy);
    expect(buildGroupRevision(courses(squareGroup(undefined)))).toBe(legacy);
  });

  it('a real override flips the hash; order and default-equals do not', () => {
    const legacy = buildGroupRevision(courses(squareGroup()));
    const withOverride = buildGroupRevision(courses(squareGroup([
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
    ])));
    expect(withOverride).not.toBe(legacy);
    // Listed in reverse traversal order + a default-equal decoy: same hash.
    const reordered = buildGroupRevision(courses(squareGroup([
      { sourceCourse: { vertexAId: 'd', vertexBId: 'a' }, criterion: { ...FIXED_HALF } },
      { sourceCourse: { vertexAId: 'c', vertexBId: 'b' }, criterion: FIXED_STEEP },
    ])));
    expect(reordered).toBe(withOverride);
  });
});
