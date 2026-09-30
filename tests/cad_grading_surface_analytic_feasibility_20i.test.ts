/**
 * Phase 20I — surface×analytic corner feasibility oracles (evidence only).
 *
 * Hand-derived expectations for the §18 primary oracle, method variants,
 * mismatches, order reversal, cut/fill branch proof, sloped geometries,
 * arc-adjacent ladders, target pathology, degenerate/failure taxonomy,
 * large-coordinate translation, perturbation ladders, the closed square,
 * and the production-freeze regression. Production is untouched: every
 * case runs through the pure study core (existing helpers only).
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import {
  intersectAnalyticPair,
  resolveSurfaceAnalyticCorner,
  type SurfaceAnalyticCornerInput,
} from '../scripts/phase20iSurfaceAnalyticCornerCore';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const M = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/** Spun-quad flat TIN (plane-invariant spin; see study runner note). */
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
const T90 = flatTin(90);

const primary = (
  surfaceCriterion: GradingCriterion = FIXED(-0.5),
  analyticCriterion: GradingCriterion = REL(-0.25, -10),
  target: GradingTargetMeshSnapshot = T90,
  buildMesh = true,
): SurfaceAnalyticCornerInput => ({
  vx: 0, vy: 0, vz: 100,
  surfaceMember: SIN, surfaceIncoming: true,
  analyticMember: AOUT, analyticIncoming: false,
  side: 'right', surfaceCriterion, analyticCriterion,
  maxSearchDistance: 100, target, buildMesh,
});

const tieOf = (t: { x: number; y: number; z: number } | null): [number, number, number] => {
  expect(t).not.toBeNull();
  return [t!.x, t!.y, t!.z];
};

describe('phase20i primary §18 oracle', () => {
  it('resolves the EXACT_COMMON_TIE at (40,-20,90) with sqrt(2000) extent', () => {
    const got = resolveSurfaceAnalyticCorner(primary());
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(got.turn).toBe('GAP');
    expect(tieOf(got.surfaceTie)).toEqual([40, -20, 90]);
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
    expect(got.extent).toBeCloseTo(Math.sqrt(2000), 12);
    expect(got.extent).toBe(44.721359549995796);
    expect(got.rootCount).toBe(1);
    expect(got.xyGap).toBe(0);
    expect(got.zGap).toBe(0);
    // Actual joint endpoints: Qs on the surface strip, Qa on the analytic line.
    expect(tieOf(got.qs)).toEqual([0, -20, 90]);
    expect(tieOf(got.qa)).toEqual([40, 0, 90]);
  });

  it('fans V→Qs→tie + V→tie→Qa with plan area 800 and hand-derived 3D areas', () => {
    const got = resolveSurfaceAnalyticCorner(primary());
    expect(got.mesh?.valid).toBe(true);
    expect(got.mesh!.triangles.length / 3).toBe(2);
    expect(got.mesh!.planArea).toBeCloseTo(800, 9);
    // Tri1 V(0,0,100),Qs(0,-20,90),tie(40,-20,90): |(0,-400,800)|/2.
    // Tri2 V,tie,Qa(40,0,90): |(200,0,800)|/2.
    const expected3d = Math.hypot(0, -400, 800) / 2 + Math.hypot(200, 0, 800) / 2;
    expect(expected3d).toBeCloseTo(859.5241580617239, 9);
    expect(got.mesh!.area3d).toBeCloseTo(expected3d, 9);
  });
});

describe('phase20i method variants', () => {
  it.each([
    ['distance', DIST(-0.25, 40)],
    ['elevation', ELEV(-0.25, 90)],
    ['relative', REL(-0.25, -10)],
  ])('%s terminates at the same tie', (_name, criterion) => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), criterion));
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
  });

  it('upward mirror (+grades, target 110) ties at (40,-20,110)', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(0.5), REL(0.25, 10), flatTin(110)));
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 110]);
  });
});

describe('phase20i mismatches', () => {
  it('target z=92 splits the ties with plan gap sqrt(80) and Z gap 2', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), flatTin(92)));
    expect(got.outcome).toBe('TRANSITION_REQUIRED');
    expect(tieOf(got.surfaceTie)).toEqual([32, -16, 92]);
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
    expect(got.xyGap).toBe(Math.sqrt(80));
    expect(got.xyGap).toBe(8.94427190999916);
    expect(got.zGap).toBe(2);
    expect(got.mesh).toBeNull();
  });

  it('analytic Δ=-12 (d=48, Z=88) reports the same gaps from the other side', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -12)));
    expect(got.outcome).toBe('TRANSITION_REQUIRED');
    expect(tieOf(got.surfaceTie)).toEqual([40, -20, 90]);
    expect(tieOf(got.analyticTie)).toEqual([48, -24, 88]);
    expect(got.xyGap).toBe(8.94427190999916);
    expect(got.zGap).toBe(2);
    expect(got.mesh).toBeNull();
  });
});

describe('phase20i order reversal', () => {
  const reversed = (target: GradingTargetMeshSnapshot = T90): SurfaceAnalyticCornerInput => ({
    vx: 0, vy: 0, vz: 100,
    surfaceMember: SOUT, surfaceIncoming: false,
    analyticMember: AIN, analyticIncoming: true,
    side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
    maxSearchDistance: 100, target, buildMesh: true,
  });

  it('mirrors the exact tie to (40,20,90) with GAP classification', () => {
    const got = resolveSurfaceAnalyticCorner(reversed());
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(got.turn).toBe('GAP');
    expect(tieOf(got.analyticTie)).toEqual([40, 20, 90]);
  });

  it('mirrors the target-92 mismatch with identical gap magnitudes', () => {
    const got = resolveSurfaceAnalyticCorner(reversed(flatTin(92)));
    expect(got.outcome).toBe('TRANSITION_REQUIRED');
    expect(got.xyGap).toBe(8.94427190999916);
    expect(got.zGap).toBe(2);
  });
});

describe('phase20i cut/fill branch proof', () => {
  it('CUT exact (target above source) ties at (40,-20,110)', () => {
    const got = resolveSurfaceAnalyticCorner(
      primary(CUTFILL(0.5, 0.25), REL(0.25, 10), flatTin(110)),
    );
    expect(got.cutFill).toBe('CUT');
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 110]);
  });

  it('FILL exact (target below source) ties at (40,-20,90)', () => {
    const got = resolveSurfaceAnalyticCorner(primary(CUTFILL(-0.25, -0.5), REL(-0.25, -10), T90));
    expect(got.cutFill).toBe('FILL');
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
  });

  it('target gap at V fails closed', () => {
    const far: GradingTargetMeshSnapshot = {
      points: [500, 500, 90, 700, 500, 90, 700, 700, 90, 500, 700, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), far));
    expect(got.outcome).toBe('SURFACE_TARGET_GAP');
  });

  it('tied-at-V records the existing TRANSITION behavior (surface tie at V)', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), flatTin(100)));
    expect(got.outcome).toBe('TRANSITION_REQUIRED');
    expect(tieOf(got.surfaceTie)).toEqual([0, 0, 100]);
  });
});

describe('phase20i sloped geometries', () => {
  it('sloped target keeps the tie under both triangulations', () => {
    const z = (x: number, y: number): number => 90 + 0.05 * (x - 40) + 0.02 * (y + 20);
    const h = 260;
    const a = (10 * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const corners: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const spun = corners.map(([x, y]) => {
      const rx = 40 + (x - 40) * c - (y + 20) * s;
      const ry = -20 + (x - 40) * s + (y + 20) * c;
      return [rx, ry, z(rx, ry)] as const;
    });
    const points = spun.flatMap(([x, y, zz]) => [x, y, zz]);
    const first = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), { points, triangles: [0, 1, 2, 0, 2, 3] }));
    const alt = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), { points, triangles: [0, 1, 3, 1, 2, 3] }));
    for (const got of [first, alt]) {
      expect(got.outcome).toBe('EXACT_COMMON_TIE');
      expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
      expect(got.mesh?.valid).toBe(true);
    }
  });

  it('sloped source (gs=0.1) stays exact at the shifted tie (40,-28,90)', () => {
    const got = resolveSurfaceAnalyticCorner({
      ...primary(), surfaceMember: M(-60, 0, 94, 0, 0, 100),
    });
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    const [x, y, zz] = tieOf(got.analyticTie);
    expect(x).toBeCloseTo(40, 9);
    expect(y).toBeCloseTo(-28, 9);
    expect(zz).toBeCloseTo(90, 9);
    expect(got.extent).toBeCloseTo(Math.hypot(40, 28), 9);
  });

  it('sloped-source mismatch proves XY alone is insufficient (Z gap 2)', () => {
    const got = resolveSurfaceAnalyticCorner({
      ...primary(FIXED(-0.5), REL(-0.25, -10), flatTin(92)),
      surfaceMember: M(-60, 0, 94, 0, 0, 100),
    });
    expect(got.outcome).toBe('TRANSITION_REQUIRED');
    expect(got.zGap).toBe(2);
    const [x, y] = tieOf(got.surfaceTie);
    expect(x).toBeCloseTo(32, 9);
    expect(y).toBeCloseTo(-22.4, 9);
  });
});

describe('phase20i arc-adjacent ladders', () => {
  const arcMember = (n: number): ResolvedGradingSource => {
    const cx = -30;
    const cy = Math.sqrt(100 * 100 - 30 * 30);
    const aA = Math.atan2(0 - cy, -60 - cx);
    const aV = Math.atan2(0 - cy, 0 - cx);
    const lo = Math.min(aA, aV);
    const hi = Math.max(aA, aV);
    const p = (k: number): [number, number] => {
      const a = lo + ((hi - lo) * k) / n;
      return [cx + 100 * Math.cos(a), cy + 100 * Math.sin(a)];
    };
    const [px, py] = p(n - 1);
    return M(px, py, 100, 0, 0, 100);
  };

  it('surface-arc ties converge monotonically with no branch jump', () => {
    const ties = [1, 4, 16].map((n) => {
      const got = resolveSurfaceAnalyticCorner({ ...primary(), surfaceMember: arcMember(n) });
      expect(got.outcome).toBe('EXACT_COMMON_TIE');
      expect(got.turn).toBe('GAP');
      return tieOf(got.analyticTie);
    });
    // Coarse (single chord) is the straight §18 tie up to arc-endpoint
    // trig residue; refinement approaches the true-arc tie from one side.
    expect(ties[0]![0]).toBeCloseTo(40, 9);
    expect(ties[0]![1]).toBeCloseTo(-20, 9);
    expect(ties[2]![1]).toBeGreaterThan(ties[1]![1]);
    expect(ties[1]![1]).toBeGreaterThan(ties[0]![1]);
    expect(ties[2]![1]).toBeCloseTo(-9.09741503818178, 6);
  });

  it('reverse (analytic-arc) ties converge from the mirrored side', () => {
    const cx = -Math.sqrt(100 * 100 - 30 * 30);
    const cy = -30;
    const aA = Math.atan2(-60 - cy, 0 - cx);
    const aV = Math.atan2(0 - cy, 0 - cx);
    const lo = Math.min(aA, aV);
    const hi = Math.max(aA, aV);
    const ties = [1, 4, 16].map((n) => {
      const a = lo + ((hi - lo) * (n - 1)) / n;
      const got = resolveSurfaceAnalyticCorner({
        vx: 0, vy: 0, vz: 100,
        surfaceMember: SOUT, surfaceIncoming: false,
        analyticMember: M(cx + 100 * Math.cos(a), cy + 100 * Math.sin(a), 100, 0, 0, 100),
        analyticIncoming: true,
        side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
        maxSearchDistance: 100, target: T90,
      });
      expect(got.outcome).toBe('EXACT_COMMON_TIE');
      return tieOf(got.analyticTie);
    });
    expect(ties[0]![0]).toBeCloseTo(40, 9);
    expect(ties[0]![1]).toBeCloseTo(20, 9);
    expect(ties[2]![0]).toBeLessThan(ties[1]![0]);
    expect(ties[1]![0]).toBeLessThan(ties[0]![0]);
  });
});

describe('phase20i target pathology', () => {
  // V-covering triangle + two disjoint same-plane patches (z=100+0.5y):
  // roots at V and inside both patches; the analytic tie holds the far root.
  const patchTin: GradingTargetMeshSnapshot = {
    points: [
      -5, 5, 102.5, 0, -5, 97.5, 5, 5, 102.5,
      16, -12, 94, 24, -12, 94, 20, -7, 96.5,
      38, -23, 88.5, 46, -19, 90.5, 36, -19, 90.5,
    ],
    triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  };

  it('later-root analytic match is ROOT_POLICY_CONFLICT, never a re-pick', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), patchTin));
    expect(got.outcome).toBe('ROOT_POLICY_CONFLICT');
    expect(got.rootCount).toBe(3);
    expect(tieOf(got.surfaceTie)).toEqual([0, 0, 100]);
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
  });

  it('single transverse triangle through the tie is one exact root', () => {
    const b = 0.1 / -0.4472135954999579;
    const cc = 90 - 20 * b;
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), {
      points: [-15, 5, b * 5 + cc, 40, -20, 90, 15, 5, b * 5 + cc],
      triangles: [0, 1, 2],
    }, false));
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(got.rootCount).toBe(1);
  });

  it('covered target with no root is SURFACE_NO_ROOT', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), flatTin(120)));
    expect(got.outcome).toBe('SURFACE_NO_ROOT');
  });

  it('degenerate (collinear) triangle fails closed', () => {
    const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), {
      points: [0, 0, 90, 10, 0, 90, 20, 0, 90],
      triangles: [0, 1, 2],
    }));
    expect(got.outcome).toBe('SURFACE_TARGET_GAP');
  });
});

describe('phase20i degenerate/failure taxonomy', () => {
  it('coincident planes are PLANE_DEGENERATE', () => {
    const got = resolveSurfaceAnalyticCorner({
      ...primary(FIXED(-0.5), DIST(-0.5, 20)),
      analyticMember: M(0, 0, 100, 60, 0, 100),
    });
    expect(got.outcome).toBe('PLANE_DEGENERATE');
  });

  it('seam-parallel analytic line is ANALYTIC_SEAM_PARALLEL', () => {
    const got = resolveSurfaceAnalyticCorner({
      ...primary(FIXED(0), DIST(-0.25, 40), flatTin(100)),
    });
    expect(got.outcome).toBe('ANALYTIC_SEAM_PARALLEL');
  });

  it('inverted/ambiguous rays (U-turn, collinear) are SIDE_REJECT', () => {
    const uturn = resolveSurfaceAnalyticCorner({
      ...primary(), analyticMember: M(0, 0, 100, -60, 0, 100),
    });
    expect(uturn.outcome).toBe('SIDE_REJECT');
    const collinear = resolveSurfaceAnalyticCorner({
      ...primary(), analyticMember: M(0, 0, 100, 60, 0, 100),
    });
    // Same-travel collinear planes differ only across the shared normal, so
    // the miter direction is perpendicular to both half-planes (ambiguous).
    expect(collinear.turn).toBe('TANGENT');
    expect(collinear.outcome).toBe('SIDE_REJECT');
  });

  it('behind-V is unreachable for side-consistent inputs (defense in depth)', () => {
    const dirs: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let total = 0;
    for (const [sx, sy] of dirs) for (const [ax, ay] of dirs) {
      for (const sIn of [true, false]) for (const aIn of [true, false]) {
        const sm = sIn ? M(-sx * 60, -sy * 60, 100, 0, 0, 100) : M(0, 0, 100, sx * 60, sy * 60, 100);
        const am = aIn ? M(-ax * 60, -ay * 60, 100, 0, 0, 100) : M(0, 0, 100, ax * 60, ay * 60, 100);
        const got = resolveSurfaceAnalyticCorner({
          vx: 0, vy: 0, vz: 100, surfaceMember: sm, surfaceIncoming: sIn,
          analyticMember: am, analyticIncoming: aIn, side: 'right',
          surfaceCriterion: FIXED(-0.5), analyticCriterion: DIST(-0.25, 40),
          maxSearchDistance: 100, target: T90,
        });
        total += 1;
        expect(got.outcome).not.toBe('ANALYTIC_TIE_BEHIND_VERTEX');
      }
    }
    expect(total).toBe(64);
  });

  it('early-root patch + far analytic tie is MAX_EXTENT_REJECT (both orders)', () => {
    const tent: GradingTargetMeshSnapshot = {
      points: [-5, 5, 105, 0, -5, 105, 5, 5, 105, 4, -4, 98.55, 8, -4, 98.55, 4, 0, 98.55],
      triangles: [0, 1, 2, 3, 4, 5],
    };
    const fwd = resolveSurfaceAnalyticCorner({ ...primary(FIXED(-0.5), REL(-0.25, -10), tent), maxSearchDistance: 20 });
    expect(fwd.outcome).toBe('MAX_EXTENT_REJECT');
    expect(tieOf(fwd.surfaceTie)).toEqual([5.800000000000012, -2.900000000000006, 98.55]);
    const rev = resolveSurfaceAnalyticCorner({
      vx: 0, vy: 0, vz: 100,
      surfaceMember: SOUT, surfaceIncoming: false,
      analyticMember: AIN, analyticIncoming: true,
      side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
      maxSearchDistance: 20,
      target: {
        points: [-5, -5, 105, 5, -5, 105, 0, 5, 105, 4, 4, 98.55, 4, 0, 98.55, 8, 4, 98.55],
        triangles: [0, 1, 2, 3, 4, 5],
      },
    });
    expect(rev.outcome).toBe('MAX_EXTENT_REJECT');
  });

  it('non-finite inputs fail closed without touching a solver', () => {
    expect(resolveSurfaceAnalyticCorner(primary({ kind: 'fixed', gradeRatio: NaN })).outcome)
      .toBe('NON_FINITE_INPUT');
    expect(resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), {
      points: [-200, -200, NaN, 200, -200, 90, 200, 200, 90, -200, 200, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    })).outcome).toBe('NON_FINITE_INPUT');
    expect(resolveSurfaceAnalyticCorner({
      ...primary(), surfaceMember: M(0, 0, 100, 0, 0, 100),
    }).outcome).toBe('PLANE_DEGENERATE');
  });
});

describe('phase20i large coordinates', () => {
  it('translates exactly with unchanged classification and topology', () => {
    const DX = 2000000;
    const DY = 7000000;
    const shift = (m: ResolvedGradingSource): ResolvedGradingSource => ({
      ...m, startX: m.startX + DX, startY: m.startY + DY, endX: m.endX + DX, endY: m.endY + DY,
    });
    const shiftTin = (t: GradingTargetMeshSnapshot): GradingTargetMeshSnapshot => ({
      points: t.points.map((v, i) => (i % 3 === 2 ? v : i % 3 === 0 ? v + DX : v + DY)),
      triangles: [...t.triangles],
    });
    const local = resolveSurfaceAnalyticCorner(primary());
    const big = resolveSurfaceAnalyticCorner({
      ...primary(), vx: DX, vy: DY,
      surfaceMember: shift(SIN), analyticMember: shift(AOUT), target: shiftTin(T90),
    });
    expect(big.outcome).toBe(local.outcome);
    expect(big.turn).toBe(local.turn);
    const [lx, ly, lz] = tieOf(local.analyticTie);
    const [bx, by, bz] = tieOf(big.analyticTie);
    const diff = Math.max(Math.abs(bx - (lx + DX)), Math.abs(by - (ly + DY)), Math.abs(bz - lz));
    expect(diff).toBeLessThanOrEqual(1e-6);
    const mismatchLocal = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), flatTin(92)));
    const mismatchBig = resolveSurfaceAnalyticCorner({
      ...primary(FIXED(-0.5), REL(-0.25, -10), shiftTin(flatTin(92))),
      vx: DX, vy: DY, surfaceMember: shift(SIN), analyticMember: shift(AOUT),
    });
    expect(mismatchBig.outcome).toBe(mismatchLocal.outcome);
    expect(mismatchBig.xyGap).toBeCloseTo(mismatchLocal.xyGap!, 9);
    expect(mismatchBig.zGap).toBe(mismatchLocal.zGap);
  });
});

describe('phase20i perturbation ladders', () => {
  const steps = [0, Number.EPSILON, 1e-12, 1e-9, 1e-6, 1e-3, 1e-1];

  it('target-elev ladder holds below zeroDelta and breaks above', () => {
    const gaps = steps.map((step) => {
      const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10), flatTin(90 + step)));
      if (step <= Number.EPSILON) expect(got.outcome).toBe('EXACT_COMMON_TIE');
      else expect(got.outcome).toBe('TRANSITION_REQUIRED');
      return got.xyGap ?? 0;
    });
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]!);
  });

  it('analytic-dz/distance/elevation ladders break above zeroDelta', () => {
    for (const step of steps) {
      const dz = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), REL(-0.25, -10 + step)));
      expect(dz.outcome).toBe(step <= Number.EPSILON ? 'EXACT_COMMON_TIE' : 'TRANSITION_REQUIRED');
      const dd = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), DIST(-0.25, 40 + step)));
      expect(dd.outcome).toBe(step <= Number.EPSILON ? 'EXACT_COMMON_TIE' : 'TRANSITION_REQUIRED');
      const ee = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5), ELEV(-0.25, 90 + step)));
      expect(ee.outcome).toBe(step <= Number.EPSILON ? 'EXACT_COMMON_TIE' : 'TRANSITION_REQUIRED');
    }
  });

  it('cross-grade ladder is structurally exact (tie slides along x=40)', () => {
    for (const step of steps) {
      const got = resolveSurfaceAnalyticCorner(primary(FIXED(-0.5 + step), REL(-0.25, -10)));
      expect(got.outcome).toBe('EXACT_COMMON_TIE');
      expect(tieOf(got.analyticTie)[0]).toBeCloseTo(40, 9);
    }
  });
});

describe('phase20i closed square and production freeze', () => {
  const sq = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource =>
    M(sx, sy, 10, ex, ey, 10);
  const SQM = [sq(0, 0, 100, 0), sq(100, 0, 100, 100), sq(100, 100, 0, 100), sq(0, 100, 0, 0)];
  const SQ_T90 = flatTin(0, 400);
  const CRIT: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];
  const TIES: Array<[number, number, number]> = [
    [120, -20, 0], [120, 120, 0], [-20, 120, 0], [-20, -20, 0],
  ];

  it('all four square corners tie exactly at 20√2 extent', () => {
    const frames = SQM.map((m) => {
      const dx = m.endX - m.startX;
      const dy = m.endY - m.startY;
      const len = Math.hypot(dx, dy);
      return { t: { nx: dx / len, ny: dy / len }, n: gradingSideNormal(dx / len, dy / len, 'right')! };
    });
    const corners: Array<{ in: number; out: number }> = [
      { in: 0, out: 1 }, { in: 1, out: 2 }, { in: 2, out: 3 }, { in: 3, out: 0 },
    ];
    corners.forEach(({ in: ii, out: oo }, j) => {
      const inSurf = ii === 0;
      const outSurf = oo === 0;
      if (inSurf || outSurf) {
        const got = resolveSurfaceAnalyticCorner({
          vx: SQM[ii]!.endX, vy: SQM[ii]!.endY, vz: 10,
          surfaceMember: inSurf ? SQM[ii]! : SQM[oo]!, surfaceIncoming: inSurf,
          analyticMember: inSurf ? SQM[oo]! : SQM[ii]!, analyticIncoming: !inSurf,
          side: 'right',
          surfaceCriterion: inSurf ? CRIT[ii]! : CRIT[oo]!,
          analyticCriterion: inSurf ? CRIT[oo]! : CRIT[ii]!,
          maxSearchDistance: 100, target: SQ_T90,
        });
        expect(got.outcome).toBe('EXACT_COMMON_TIE');
        expect(tieOf(got.analyticTie)).toEqual(TIES[j]);
        expect(got.extent).toBeCloseTo(20 * Math.SQRT2, 9);
      } else {
        const fi = frames[ii]!;
        const fo = frames[oo]!;
        const tie = intersectAnalyticPair(
          SQM[ii]!.endX, SQM[ii]!.endY, 10,
          fi.t, fi.n, 0, CRIT[ii]!, fo.t, fo.n, 0, CRIT[oo]!, 100,
        );
        expect(tie.ok).toBe(true);
        expect([tie.tie!.x, tie.tie!.y, tie.tie!.z]).toEqual(TIES[j]);
        expect(tie.extent).toBeCloseTo(20 * Math.SQRT2, 9);
      }
    });
  });

  it('one off analytic member fails both adjacent corners with no partial mesh', () => {
    const off = resolveSurfaceAnalyticCorner({
      vx: 100, vy: 0, vz: 10,
      surfaceMember: SQM[0]!, surfaceIncoming: true,
      analyticMember: SQM[1]!, analyticIncoming: false,
      side: 'right', surfaceCriterion: CRIT[0]!, analyticCriterion: DIST(-0.5, 24),
      maxSearchDistance: 100, target: SQ_T90,
    });
    expect(off.outcome).toBe('TRANSITION_REQUIRED');
    expect(off.mesh).toBeNull();
    const f1 = { t: { nx: 0, ny: 1 }, n: gradingSideNormal(0, 1, 'right')! };
    const f2 = { t: { nx: -1, ny: 0 }, n: gradingSideNormal(-1, 0, 'right')! };
    const pair = intersectAnalyticPair(
      100, 100, 10, f1.t, f1.n, 0, DIST(-0.5, 24), f2.t, f2.n, 0, ELEV(-0.5, 0), 100,
    );
    expect(pair.ok).toBe(false);
  });

  it('production controls agree on ties; hybrid groups now tie with them (20J admission)', () => {
    // Integer-grid flat target: sector paths stay single-segment, so the
    // production corner runs match the study ties exactly.
    const xs: number[] = [];
    for (let v = -60; v <= 160 + 1e-9; v += 20) xs.push(v);
    const points: number[] = [];
    const idx = (ix: number, iy: number): number => iy * xs.length + ix;
    for (const y of xs) for (const x of xs) points.push(x, y, 0);
    const triangles: number[] = [];
    for (let ix = 0; ix + 1 < xs.length; ix += 1) {
      for (let iy = 0; iy + 1 < xs.length; iy += 1) {
        const a = idx(ix, iy);
        const b = idx(ix + 1, iy);
        const c = idx(ix + 1, iy + 1);
        const d = idx(ix, iy + 1);
        triangles.push(a, b, c, a, c, d);
      }
    }
    const grid = { points, triangles };
    const base = {
      groupId: 'study', revision: 'study', members: SQM, side: 'right' as const,
      maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true,
    };
    const surface = computeGradingGroupFromSnapshots({ ...base, criterion: FIXED(-0.5), target: grid });
    const distance = computeGradingGroupFromSnapshots({ ...base, criterion: DIST(-0.5, 20) });
    const mixed = computeGradingGroupFromSnapshots({
      ...base, criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
    });
    expect(surface.ok && distance.ok && mixed.ok).toBe(true);
    if (surface.ok && distance.ok && mixed.ok) {
      const ties = (r: typeof surface): number[] =>
        r.ok ? r.result.corners.flatMap((c) => c.tiePointXyz ?? []) : [];
      expect(ties(distance)).toEqual(ties(surface));
      expect(ties(mixed)).toEqual(ties(surface));
    }
    // 20J Wave B: the old fail-closed mix now solves through the hybrid
    // exact-common-tie helper with identical ties and shell areas.
    const hybrid = computeGradingGroupFromSnapshots({
      ...base, criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.5, -10), FIXED(-0.5), FIXED(-0.5)],
      target: grid,
    });
    expect(hybrid.ok).toBe(true);
    if (hybrid.ok && surface.ok) {
      const ties = (r: typeof surface): number[] =>
        r.ok ? r.result.corners.flatMap((c) => c.tiePointXyz ?? []) : [];
      expect(ties(hybrid)).toEqual(ties(surface));
      expect(hybrid.result.gradingPlanArea).toBeCloseTo(surface.result.gradingPlanArea, 9);
      expect(hybrid.result.corners.map((c) => c.classification)).toEqual([
        'GAP', 'GAP', 'GAP', 'GAP',
      ]);
    }
  });
});

describe('phase20i joint-Z continuity (production exactXyz mirror)', () => {
  it('analytic joint Z 101 vs vz 100 fails closed with SOURCE_JOINT_MISMATCH, no mesh', () => {
    const got = resolveSurfaceAnalyticCorner({
      ...primary(), analyticMember: M(0, 0, 101, 0, 60, 101), buildMesh: true,
    });
    expect(got.outcome).toBe('SOURCE_JOINT_MISMATCH');
    expect(got.surfaceTie).toBeNull();
    expect(got.analyticTie).toBeNull();
    expect(got.mesh).toBeNull();
  });

  it('surface joint Z 101 vs vz 100 fails closed in reverse order, no mesh', () => {
    const got = resolveSurfaceAnalyticCorner({
      vx: 0, vy: 0, vz: 100,
      surfaceMember: M(0, 0, 101, -60, 0, 101), surfaceIncoming: false,
      analyticMember: AIN, analyticIncoming: true,
      side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
      maxSearchDistance: 100, target: T90, buildMesh: true,
    });
    expect(got.outcome).toBe('SOURCE_JOINT_MISMATCH');
    expect(got.mesh).toBeNull();
  });

  it('equal-Z exact joint still ties (gate admits continuous sources)', () => {
    const got = resolveSurfaceAnalyticCorner(primary());
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(tieOf(got.analyticTie)).toEqual([40, -20, 90]);
  });
});
