/**
 * Phase 20K — hybrid arc×arc joint feasibility oracles (evidence only).
 *
 * Production is frozen (first describe): the genuine arc×arc joint fails
 * closed through `computeGradingGroupFromSnapshots`. Every other case runs
 * through the pure study core (`resolveHybridArcPair` /
 * `studyArcPairLadder`), never through production corner assembly.
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
  arcTangentAt,
  makeArcMember,
  PRIMARY_ANALYTIC_ARC,
  PRIMARY_SURFACE_ARC,
  resolveHybridArcPair,
  studyArcPairLadder,
  type ArcPairInput,
} from '../scripts/phase20kHybridArcPairCore';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

/** Spun-quad flat TIN (same builder as the 20I/20J oracles). */
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

const primary = (
  chordTolerance: number,
  buildMesh = true,
): ArcPairInput => ({
  vx: 0, vy: 0, vz: 100,
  surfaceArc: PRIMARY_SURFACE_ARC,
  analyticArc: PRIMARY_ANALYTIC_ARC,
  side: 'right',
  surfaceCriterion: FIXED(-0.5),
  analyticCriterion: REL(-0.25, -10),
  maxSearchDistance: 100,
  target: flatTin(90),
  chordTolerance,
  buildMesh,
});

describe('phase20k production freeze (FIRST)', () => {
  it('hybrid arc×arc joint returns CORNER_NO_SOLUTION + ARC_PAIR_UNSUPPORTED, no partial result', () => {
    // Genuine arc circle params; endpoints snapped exact so the joint reaches
    // the arc×arc guard (shared-vertex identity, not fp residue, is under test).
    const arcIn: ResolvedGradingSource = {
      startX: -60, startY: 60, endX: 0, endY: 0, startZ: 100, endZ: 100,
      length: 60 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: {
        centerX: 0, centerY: 60, radius: 60,
        startAngle: Math.PI, endAngle: (3 * Math.PI) / 2, sweepCCW: true,
      },
    };
    const arcOut: ResolvedGradingSource = {
      startX: 0, startY: 0, endX: -80, endY: 80, startZ: 100, endZ: 100,
      length: 80 * (Math.PI / 2), reoriented: false, isArc: true,
      arc: {
        centerX: -80, centerY: 0, radius: 80,
        startAngle: 0, endAngle: Math.PI / 2, sweepCCW: true,
      },
    };
    const out = computeGradingGroupFromSnapshots({
      groupId: 'k20-freeze', revision: 'r',
      members: [arcIn, arcOut],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.05, closed: false,
      target: flatTin(90),
    });
    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty('result');
    if (!out.ok) {
      expect(out.code).toBe('CORNER_NO_SOLUTION');
      expect(out.detail).toBe('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
    }
  });
});

describe('phase20k primary arcs §10', () => {
  it('carries the specified circles, endpoints, and 30π/40π lengths', () => {
    const s = makeArcMember(PRIMARY_SURFACE_ARC)!;
    const a = makeArcMember(PRIMARY_ANALYTIC_ARC)!;
    expect(s.spec).toEqual({ centerX: 0, centerY: 60, radius: 60,
      startAngle: Math.PI, endAngle: (3 * Math.PI) / 2, sweepCCW: true, startZ: 100, endZ: 100 });
    expect(a.spec).toEqual({ centerX: -80, centerY: 0, radius: 80,
      startAngle: 0, endAngle: Math.PI / 2, sweepCCW: true, startZ: 100, endZ: 100 });
    expect(s.start.x).toBe(-60);
    expect(s.start.y).toBeCloseTo(60, 12);
    expect(s.end.x).toBeCloseTo(0, 12);
    expect(s.end.y).toBe(0);
    expect(s.length).toBe(30 * Math.PI);
    expect(a.start.x).toBe(0);
    expect(a.start.y).toBe(0);
    expect(a.end.x).toBeCloseTo(-80, 12);
    expect(a.end.y).toBe(80);
    expect(a.length).toBe(40 * Math.PI);
  });

  it('true joint tangents are (1,0)/(0,1) with right normals (0,-1)/(1,0)', () => {
    const ts = arcTangentAt(PRIMARY_SURFACE_ARC, true)!;
    const ta = arcTangentAt(PRIMARY_ANALYTIC_ARC, false)!;
    expect(ts.nx).toBe(1);
    expect(ts.ny).toBeCloseTo(0, 15);
    expect(ta.nx).toBeCloseTo(0, 15);
    expect(ta.ny).toBe(1);
    const ns = gradingSideNormal(ts.nx, ts.ny, 'right')!;
    const na = gradingSideNormal(ta.nx, ta.ny, 'right')!;
    expect(ns.nx).toBeCloseTo(0, 12);
    expect(ns.ny).toBe(-1);
    expect(na.nx).toBe(1);
    expect(na.ny).toBeCloseTo(0, 12);
  });
});

describe('phase20k one-chord oracle (tol=25)', () => {
  it('proves sagittas 17.573593128807147 / 23.431457505076196 → n=1 each', () => {
    const got = resolveHybridArcPair(primary(25));
    expect(got.surfaceFrame!.subdivisions).toBe(1);
    expect(got.analyticFrame!.subdivisions).toBe(1);
    expect(got.surfaceFrame!.sagitta).toBe(17.573593128807147);
    expect(got.analyticFrame!.sagitta).toBe(23.431457505076196);
    expect(got.surfaceFrame!.sagitta).toBe(60 * (1 - Math.cos(Math.PI / 4)));
    expect(got.analyticFrame!.sagitta).toBe(80 * (1 - Math.cos(Math.PI / 4)));
  });

  it('proves antiparallel chord frames → ARC_PAIR_CHORD_DEGENERATE, no tie/mesh, deterministic', () => {
    const got = resolveHybridArcPair(primary(25));
    const inv = 1 / Math.SQRT2;
    expect(got.surfaceFrame!.t.nx).toBeCloseTo(inv, 15);
    expect(got.surfaceFrame!.t.ny).toBeCloseTo(-inv, 15);
    expect(got.surfaceFrame!.n.nx).toBeCloseTo(-inv, 15);
    expect(got.surfaceFrame!.n.ny).toBeCloseTo(-inv, 15);
    expect(got.analyticFrame!.t.nx).toBeCloseTo(-inv, 15);
    expect(got.analyticFrame!.t.ny).toBeCloseTo(inv, 15);
    expect(got.analyticFrame!.n.nx).toBeCloseTo(inv, 15);
    expect(got.analyticFrame!.n.ny).toBeCloseTo(inv, 15);
    // Na = −Ns exactly: parallel-inconsistent, no seam ray exists.
    expect(got.analyticFrame!.n.nx + got.surfaceFrame!.n.nx).toBeCloseTo(0, 15);
    expect(got.analyticFrame!.n.ny + got.surfaceFrame!.n.ny).toBeCloseTo(0, 15);
    expect(got.frameDet).toBeCloseTo(0, 15);
    expect(got.outcome).toBe('ARC_PAIR_CHORD_DEGENERATE');
    expect(got.tie).toBeNull();
    expect(got.extent).toBeNull();
    expect(got.planArea).toBeNull();
    expect(got.meshValid).toBeNull();
    expect(JSON.stringify(resolveHybridArcPair(primary(25)))).toBe(JSON.stringify(got));
  });
});

describe('phase20k two-chord oracle (tol=10)', () => {
  it('proves sagittas → n=2 each with s=sin(π/8), c=cos(π/8) frames', () => {
    const got = resolveHybridArcPair(primary(10));
    expect(got.surfaceFrame!.subdivisions).toBe(2);
    expect(got.analyticFrame!.subdivisions).toBe(2);
    expect(got.surfaceFrame!.sagitta).toBe(60 * (1 - Math.cos(Math.PI / 8)));
    expect(got.surfaceFrame!.sagitta).toBe(4.567228049322796);
    expect(got.analyticFrame!.sagitta).toBe(80 * (1 - Math.cos(Math.PI / 8)));
    expect(got.analyticFrame!.sagitta).toBe(6.089637399097061);
    const s = Math.sin(Math.PI / 8);
    const c = Math.cos(Math.PI / 8);
    expect(got.surfaceFrame!.t.nx).toBeCloseTo(c, 15);
    expect(got.surfaceFrame!.t.ny).toBeCloseTo(-s, 15);
    expect(got.surfaceFrame!.n.nx).toBeCloseTo(-s, 15);
    expect(got.surfaceFrame!.n.ny).toBeCloseTo(-c, 15);
    expect(got.analyticFrame!.t.nx).toBeCloseTo(-s, 15);
    expect(got.analyticFrame!.t.ny).toBeCloseTo(c, 15);
    expect(got.analyticFrame!.n.nx).toBeCloseTo(c, 15);
    expect(got.analyticFrame!.n.ny).toBeCloseTo(s, 15);
    // det = c²−s² = √2/2: the chord-frame determinant.
    expect(got.frameDet).toBeCloseTo(Math.SQRT2 / 2, 12);
    expect(got.frameDet).toBeCloseTo(c * c - s * s, 15);
  });

  it('solves the exact tie (63.08644059797901,-47.779103303375415,90) with real GAP fan', () => {
    const got = resolveHybridArcPair(primary(10));
    expect(got.outcome).toBe('ARC_PAIR_COMMON_TIE');
    expect(got.turn).toBe('GAP');
    expect(got.tie!.x).toBe(63.08644059797901);
    expect(got.tie!.y).toBeCloseTo(-47.779103303375415, 9);
    expect(got.tie!.z).toBe(90);
    expect(got.qs!.x).toBeCloseTo(-7.653668647301796, 9);
    expect(got.qs!.y).toBeCloseTo(-18.477590650225736, 9);
    expect(got.qs!.z).toBe(90);
    expect(got.qa!.x).toBeCloseTo(36.95518130045147, 12);
    expect(got.qa!.y).toBeCloseTo(15.307337294603592, 12);
    expect(got.qa!.z).toBe(90);
    expect(got.extent).toBe(79.13748605936983);
    // Real GAP fan V→Qs→tie + V→tie→Qa: winding/topology/plane enforced in core.
    expect(got.meshValid).toBe(true);
    expect(got.planArea).toBeCloseTo(2131.3708498984765, 9);
    expect(got.area3d).toBeCloseTo(2263.7786443917175, 9);
    expect(JSON.stringify(resolveHybridArcPair(primary(10)))).toBe(JSON.stringify(got));
  });
});

describe('phase20k true-tangent reference (convergence limit only)', () => {
  it('reports Ttrue=(40,-20,90), extent √2000, plan 800, 3D 859.5241580617239', () => {
    // Closed form on true tangents T=(1,0)/(0,1), right normals (0,-1)/(1,0):
    // surface plane 100+0.5y=90 → Qs=(0,-20,90); analytic d=Δ/g=40 → Qa=(40,0,90);
    // seam ray × both planes meets at (40,-20,90).
    const tie: [number, number, number] = [40, -20, 90];
    const qs: [number, number, number] = [0, -20, 90];
    const qa: [number, number, number] = [40, 0, 90];
    expect(tie).toEqual([40, -20, 90]);
    expect(qs).toEqual([0, -20, 90]);
    expect(qa).toEqual([40, 0, 90]);
    expect(Math.hypot(40, -20)).toBe(44.721359549995796);
    expect(Math.hypot(40, -20)).toBe(Math.sqrt(2000));
    const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
      Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    expect(tri(0, 0, 0, -20, 40, -20) + tri(0, 0, 40, -20, 40, 0)).toBe(800);
    const expected3d = Math.hypot(0, -400, 800) / 2 + Math.hypot(200, 0, 800) / 2;
    expect(expected3d).toBeCloseTo(859.5241580617239, 9);
  });
});

describe('phase20k tolerance ladder §7', () => {
  const TOLS = [25, 10, 5, 2, 1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001];
  const { vx, vy, vz, ...rest } = primary(10);
  const rows = studyArcPairLadder({ vx, vy, vz, ...rest }, TOLS);

  it('covers all 11 tolerances with sagitta inside tolerance and h/2 tangent error', () => {
    expect(rows.map((r) => r.tolerance)).toEqual(TOLS);
    for (const r of rows) {
      expect(r.sagittaSurface).toBeLessThanOrEqual(r.tolerance);
      expect(r.sagittaAnalytic).toBeLessThanOrEqual(r.tolerance);
      expect(r.tangentErrorSurface).toBe((Math.PI / 2) / (2 * r.subdivisionsSurface));
      expect(r.tangentErrorAnalytic).toBe((Math.PI / 2) / (2 * r.subdivisionsAnalytic));
      expect(r.subdivisionsSurface).toBeGreaterThanOrEqual(1);
      expect(r.subdivisionsAnalytic).toBeGreaterThanOrEqual(1);
    }
  });

  it('flags one degenerate band {25}, one exact band below, no pass/fail instability', () => {
    expect(rows[0]!.outcome).toBe('ARC_PAIR_CHORD_DEGENERATE');
    expect(rows[0]!.extent).toBeNull();
    for (const r of rows.slice(1)) expect(r.outcome).toBe('ARC_PAIR_COMMON_TIE');
    // Instability = a non-tie outcome after the first exact tie: none.
    const flips = rows.slice(1).filter((r) => r.outcome !== 'ARC_PAIR_COMMON_TIE');
    expect(flips).toEqual([]);
  });

  it('converges monotonically to the true-tangent reference with bounded conditioning', () => {
    const extents = rows.slice(1).map((r) => r.extent!);
    for (let i = 1; i < extents.length; i += 1) {
      expect(extents[i]).toBeLessThan(extents[i - 1]!);
    }
    const dets = rows.slice(1).map((r) => r.frameDet!);
    for (let i = 1; i < dets.length; i += 1) {
      expect(dets[i]).toBeGreaterThan(dets[i - 1]!);
    }
    for (const r of rows.slice(1)) {
      expect(r.solveDet).toBeGreaterThan(0);
      expect(r.solveDet).toBeLessThanOrEqual(1);
      expect(r.condition).toBeCloseTo(1 / r.solveDet!, 12);
      expect(r.condition).toBeLessThan(2);
    }
    const fine = resolveHybridArcPair(primary(0.001));
    expect(fine.extent!).toBeLessThan(44.721359549995796 + 0.25);
    expect(Math.hypot(fine.tie!.x - 40, fine.tie!.y + 20)).toBeLessThan(0.5);
    expect(fine.tie!.z).toBe(90);
  });
});
