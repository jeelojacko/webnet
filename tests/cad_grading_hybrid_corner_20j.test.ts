/**
 * Phase 20J Wave B — hybrid surface↔analytic corner proof (production engine).
 *
 * Every case runs through `computeGradingGroupFromSnapshots` (no manual
 * corner assembly): a two-member open group joins one surface member with
 * one analytic member at a single joint, and the joint must resolve to the
 * exact common tie the 20I study core predicted — or fail closed with a
 * named GRADING_SURFACE_ANALYTIC_* detail.
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  groupTerminationMode,
  groupTerminationRequiresTarget,
} from '../src/engine/cad/grading/gradingGroupTermination';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const M = (
  sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/** Spun-quad flat TIN (same builder as the 20I oracles). */
const flatTin = (z: number, half = 200): GradingTargetMeshSnapshot => {
  const a = (10 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

const SIN = M(-60, 0, 100, 0, 0, 100);
const AOUT = M(0, 0, 100, 0, 60, 100);
const AIN = M(0, -60, 100, 0, 0, 100);
const SOUT = M(0, 0, 100, -60, 0, 100);

interface PrimaryOpts {
  surfaceCriterion?: GradingCriterion;
  analyticCriterion?: GradingCriterion;
  target?: GradingTargetMeshSnapshot;
  reverse?: boolean;
  maxSearchDistance?: number;
}

const solvePrimary = (opts: PrimaryOpts = {}): ReturnType<typeof computeGradingGroupFromSnapshots> => {
  const members = opts.reverse ? [AIN, SOUT] : [SIN, AOUT];
  return computeGradingGroupFromSnapshots({
    groupId: 'h20j', revision: 'r', members,
    side: 'right',
    criterion: opts.surfaceCriterion ?? FIXED(-0.5),
    memberCriteria: [
      opts.reverse
        ? (opts.analyticCriterion ?? REL(-0.25, -10))
        : (opts.surfaceCriterion ?? FIXED(-0.5)),
      opts.reverse
        ? (opts.surfaceCriterion ?? FIXED(-0.5))
        : (opts.analyticCriterion ?? REL(-0.25, -10)),
    ],
    maxSearchDistance: opts.maxSearchDistance ?? 100,
    curveChordTolerance: 0.01, closed: false,
    target: opts.target ?? flatTin(90),
  });
};

const expectOk = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const expectFail = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): { code: string; cornerIndex?: number; detail?: string } => {
  if (out.ok) throw new Error('expected failure, got ok');
  return out;
};

describe('phase20j primary hybrid tie', () => {
  it('ties exactly at (40,-20,90) with √2000 extent, Qs (0,-20,90), Qa (40,0,90)', () => {
    const r = expectOk(solvePrimary());
    expect(r.corners).toHaveLength(1);
    const corner = r.corners[0]!;
    expect(corner.classification).toBe('GAP');
    expect(corner.tiePointXyz).toEqual([40, -20, 90]);
    expect(corner.miterExtent).toBe(44.721359549995796);
    expect(corner.miterExtent).toBeCloseTo(Math.sqrt(2000), 12);
    expect(corner.daylightPoints).toEqual([0, -20, 90, 40, -20, 90, 40, 0, 90]);
    expect(r.memberRegions.map((m) => m.classification)).toEqual(['FIXED', 'FIXED']);
  });

  it('corner fan carries plan 800 and 3D 859.5241580617239 over the member strips', () => {
    const r = expectOk(solvePrimary());
    // Closed-form strip areas: 60×20 surface rectangle + 60×40 analytic
    // rectangle; the corner wedge is the remainder of the merged shell.
    expect(r.gradingPlanArea).toBeCloseTo(4400, 9);
    expect(r.gradingPlanArea - 3600).toBeCloseTo(800, 9);
    const strips3d = 60 * Math.hypot(20, 10) + 60 * Math.hypot(40, 10);
    expect(r.grading3dArea - strips3d).toBeCloseTo(859.5241580617239, 9);
  });

  it.each([
    ['distance', DIST(-0.25, 40)],
    ['elevation', ELEV(-0.25, 90)],
    ['relative', REL(-0.25, -10)],
  ])('%s terminates at the same tie', (_name, criterion) => {
    const r = expectOk(solvePrimary({ analyticCriterion: criterion }));
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
    expect(r.corners[0]!.miterExtent).toBeCloseTo(Math.sqrt(2000), 12);
  });

  it('reverses exactly to (40,20,90) with mirrored Qs/Qa', () => {
    const r = expectOk(solvePrimary({ reverse: true }));
    expect(r.corners[0]!.classification).toBe('GAP');
    expect(r.corners[0]!.tiePointXyz).toEqual([40, 20, 90]);
    // Incoming→outgoing: analytic Qa, tie, then surface Qs.
    expect(r.corners[0]!.daylightPoints).toEqual([40, 0, 90, 40, 20, 90, 0, 20, 90]);
  });

  it('upward mirror (+grades, target 110) ties at (40,-20,110)', () => {
    const r = expectOk(solvePrimary({
      surfaceCriterion: FIXED(0.5),
      analyticCriterion: REL(0.25, 10),
      target: flatTin(110),
    }));
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 110]);
  });
});

describe('phase20j cut/fill branches', () => {
  it('CUT exact (target above source) ties at (40,-20,110)', () => {
    const r = expectOk(solvePrimary({
      surfaceCriterion: CUTFILL(0.5, -0.5),
      analyticCriterion: REL(0.25, 10),
      target: flatTin(110),
    }));
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 110]);
  });

  it('FILL exact (target below source) ties at (40,-20,90)', () => {
    const r = expectOk(solvePrimary({
      surfaceCriterion: CUTFILL(0.5, -0.5),
      target: flatTin(90),
    }));
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
  });

  it('tied-at-V fails closed (no zero-extent corner)', () => {
    const failed = expectFail(solvePrimary({ target: flatTin(100) }));
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  });

  it('void target fails the member closed before any corner fallback', () => {
    const failed = expectFail(solvePrimary({ target: flatTin(90, 1) }));
    expect(failed.code).toBe('MEMBER_NO_SOLUTION');
  });
});

describe('phase20j hybrid mismatches', () => {
  it('target z=92 splits the ties (TRANSITION_REQUIRED, no mesh)', () => {
    const failed = expectFail(solvePrimary({ target: flatTin(92) }));
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.cornerIndex).toBe(0);
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  });

  it('analytic Δ=-12 reports the same transition from the other side', () => {
    const failed = expectFail(solvePrimary({ analyticCriterion: REL(-0.25, -12) }));
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  });

  it('analytic D=24 reports the same transition', () => {
    const failed = expectFail(solvePrimary({ analyticCriterion: DIST(-0.25, 24) }));
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  });
});

describe('phase20j root policy + member failure + thin target', () => {
  // Flat-90 strip cover (both member strips solve normally) + three
  // disjoint same-plane patches (z=100+0.5y) along the seam ray: surface
  // roots inside each patch; the analytic tie holds the far root. The
  // near patch sits off-strip past the cover edge (no plan overlap, so the
  // member query stays single-valued); the flat cover adds no ray roots
  // (plane meets flat-90 only on the y=-20 line, past the cover's +x edge).
  const patchTin: GradingTargetMeshSnapshot = {
    points: [
      -70, -30, 90, 10, -30, 90, 10, 10, 90,
      -70, -30, 90, 10, 10, 90, -70, 10, 90,
      11, -5.5, 97.25, 13, -8, 96, 15, -5.5, 97.25,
      16, -12, 94, 24, -12, 94, 20, -7, 96.5,
      38, -23, 88.5, 46, -19, 90.5, 36, -19, 90.5,
    ],
    triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  };

  it('later-root analytic match is ROOT_POLICY (nearest root kept, never re-picked)', () => {
    const failed = expectFail(solvePrimary({ target: patchTin }));
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_ROOT_POLICY');
  });

  it('member failure fails the group with no corner fallback', () => {
    const failed = expectFail(solvePrimary({ maxSearchDistance: 5 }));
    expect(failed.code).toBe('MEMBER_NO_SOLUTION');
  });

  it('disconnected thin target (strips covered, wedge void) is CORNER_TARGET_GAP', () => {
    const thin: GradingTargetMeshSnapshot = {
      points: [
        -70, -30, 90, 10, -30, 90, 10, 10, 90,
        -70, -30, 90, 10, 10, 90, -70, 10, 90,
        -10, -10, 90, 50, -10, 90, 50, 70, 90,
        -10, -10, 90, 50, 70, 90, -10, 70, 90,
      ],
      triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    };
    const failed = expectFail(solvePrimary({ target: thin }));
    expect(failed.code).toBe('CORNER_TARGET_GAP');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TARGET_GAP');
  });
});

describe('phase20j large coordinates + arcs + determinism + mode', () => {
  const OX = 2_000_000;
  const OY = 7_000_000;

  it('translates exactly: E2M/N7M tie and areas match within 1e-6', () => {
    const local = expectOk(solvePrimary());
    const shifted = (m: ResolvedGradingSource): ResolvedGradingSource => ({
      ...m,
      startX: m.startX + OX, endX: m.endX + OX,
      startY: m.startY + OY, endY: m.endY + OY,
    });
    const target = flatTin(90);
    const moved: GradingTargetMeshSnapshot = {
      points: target.points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? OX : OY))),
      triangles: [...target.triangles],
    };
    const out = computeGradingGroupFromSnapshots({
      groupId: 'h20j', revision: 'r',
      members: [shifted(SIN), shifted(AOUT)],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false,
      target: moved,
    });
    const far = expectOk(out);
    const tie = far.corners[0]!.tiePointXyz!;
    expect(Math.abs(tie[0] - (40 + OX))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(tie[1] - (-20 + OY))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(tie[2] - 90)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(far.gradingPlanArea - local.gradingPlanArea)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(far.grading3dArea - local.grading3dArea)).toBeLessThanOrEqual(1e-6);
  });

  it('one-arc hybrid joint fails closed at the 20K.1 seam gate', () => {
    const arc: ResolvedGradingSource = {
      startX: 40, startY: 40, endX: 0, endY: 0, startZ: 100, endZ: 100,
      length: 40 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: {
        centerX: 40, centerY: 0, radius: 40,
        startAngle: Math.PI / 2, endAngle: Math.PI, sweepCCW: true,
      },
    };
    const out = computeGradingGroupFromSnapshots({
      groupId: 'h20j', revision: 'r',
      members: [arc, M(0, 0, 100, 60, 0, 100)],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.001, closed: false,
      target: flatTin(90),
    });
    // 20K.1 Wave B2: the faceted arc strip + GAP patch meet at the tie
    // without edge-stitching (2 shared-index components), so the revision
    // fails closed with the stable gate diagnostic — never CURRENT.
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('GROUP_NON_MANIFOLD');
    expect(out.detail).toBe('GRADING_GROUP_ARC_SEAM_PINCH: component count 2 != expected 1');
  });

  it('arc×arc hybrid joint is blocked with ARC_PAIR_UNSUPPORTED', () => {
    const arcIn: ResolvedGradingSource = {
      startX: 40, startY: 40, endX: 0, endY: 0, startZ: 100, endZ: 100,
      length: 40 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: {
        centerX: 40, centerY: 0, radius: 40,
        startAngle: Math.PI / 2, endAngle: Math.PI, sweepCCW: true,
      },
    };
    const arcOut: ResolvedGradingSource = {
      startX: 0, startY: 0, endX: -40, endY: -40, startZ: 100, endZ: 100,
      length: 40 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: {
        centerX: 0, centerY: -40, radius: 40,
        startAngle: Math.PI / 2, endAngle: Math.PI, sweepCCW: true,
      },
    };
    const out = computeGradingGroupFromSnapshots({
      groupId: 'h20j', revision: 'r',
      members: [arcIn, arcOut],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.05, closed: false,
      target: flatTin(90),
    });
    const failed = expectFail(out);
    expect(failed.code).toBe('CORNER_NO_SOLUTION');
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
  });

  it('is deterministic across runs', () => {
    const a = expectOk(solvePrimary());
    const b = expectOk(solvePrimary());
    const digest = (r: CadGradingGroupResult): string =>
      [...r.gradingMesh.points, ...r.gradingMesh.triangles, ...r.daylightPoints].join(',');
    expect(digest(b)).toBe(digest(a));
    expect(JSON.stringify(b.corners)).toBe(JSON.stringify(a.corners));
  });

  it('derives the termination mode from effective criteria (single authority)', () => {
    expect(groupTerminationMode(FIXED(-0.5), [FIXED(-0.5), FIXED(-0.5)])).toBe('surface');
    expect(groupTerminationMode(DIST(-0.5, 20), [DIST(-0.5, 20), ELEV(-0.5, 90)])).toBe('analytic');
    expect(groupTerminationMode(FIXED(-0.5), [FIXED(-0.5), REL(-0.25, -10)])).toBe('hybrid');
    expect(groupTerminationRequiresTarget(FIXED(-0.5), [FIXED(-0.5), REL(-0.25, -10)])).toBe(true);
    expect(groupTerminationRequiresTarget(DIST(-0.5, 20), [DIST(-0.5, 20)])).toBe(false);
  });
});
