/**
 * Phase 20K.1 Wave C2 — Surface internal chord-seam assembly tests.
 *
 * Standalone Surface arcs + curved Surface group members stitch internal
 * chord joints through the shared Surface-corner authority
 * (`solveSurfaceCorner`: active-grade planes, miter seam, outward ray +
 * extent, nearest valid outward root, sector-path build/trim). GAP splices
 * Q-to-tie sector paths between chord runs; OVERLAP paired-trims both runs
 * to the miter line first; wedges emit repeated-V pairs. Fail-closed
 * throughout (B2 gate stays as defense-in-depth); arc×arc hybrid stays
 * blocked (§23).
 */
import { describe, expect, it } from 'vitest';

import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  DIST,
  ELEV,
  FIXED,
  REL,
  flatTin,
  roundedSquareMembers,
} from '../scripts/phase20kHybridArcPairGroups';

const SEARCH = 100;
const CUTFILL = (cut: number, fill: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: cut, fillGradeRatio: fill });

const straight = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): ResolvedGradingSource => ({
  startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});

const runStandalone = (
  source: ResolvedGradingSource, criterion: GradingCriterion, tol = 0.1,
) => computeGradingFromSnapshots({
  gradingId: 'c2', revision: 'r', source, side: 'right',
  criterion, maxSearchDistance: SEARCH, curveChordTolerance: tol,
  target: flatTin(0),
});

const worstDiff = (a: number[], b: number[]): number => {
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  }
  return worst;
};

describe('phase20k1 Surface/Distance equivalence on the level arc', () => {
  // Source Z=10, flat Z=0, Fixed g=-0.5 vs Distance D=20: same grading
  // planes per chord, so plan area is bitwise identical and ties agree;
  // tessellation differs honestly (Surface runs follow TIN structure,
  // analytic runs stay endpoint-only), as do region labels.
  it('matches geometry and topology modulo honest tessellation/diagnostics', () => {
    const src = roundedSquareMembers(10)[0]!.source;
    const fx = runStandalone(src, FIXED(-0.5));
    const di = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: DIST(-0.5, 20), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
    });
    expect(fx.ok).toBe(true);
    expect(di.ok).toBe(true);
    if (!fx.ok || !di.ok) return;
    expect(fx.result.gradingPlanArea).toBe(di.result.gradingPlanArea);
    expect(fx.result.gradingPlanArea).toBeCloseTo(2082.880954009, 9);
    expect(Math.abs(fx.result.grading3dArea - di.result.grading3dArea)).toBeLessThan(1e-9);
    expect(fx.result.daylightPoints.length).toBe(di.result.daylightPoints.length);
    expect(worstDiff(fx.result.daylightPoints, di.result.daylightPoints)).toBeLessThan(1e-9);
    expect(fx.result.minProjectionDistance).toBe(di.result.minProjectionDistance);
    expect(fx.result.maxProjectionDistance).toBe(di.result.maxProjectionDistance);
    // Honest differences: tessellation + region semantics only.
    expect(fx.result.gradingMesh.points.length).toBeGreaterThan(0);
    expect(di.result.gradingMesh.points.length).toBeGreaterThan(0);
    expect(fx.result.diagnostics).toEqual([]);
    expect(di.result.diagnostics).toEqual([]);
  });

  it('Cut/Fill active −0.5 control is bitwise identical to Fixed', () => {
    // Flat target below source ⇒ FILL active everywhere ⇒ same planes
    // (fill −0.5; the cut grade never engages).
    const src = roundedSquareMembers(10)[0]!.source;
    const fx = runStandalone(src, FIXED(-0.5));
    const cf = runStandalone(src, CUTFILL(-2, -0.5));
    expect(fx.ok).toBe(true);
    expect(cf.ok).toBe(true);
    if (!fx.ok || !cf.ok) return;
    expect(cf.result.gradingMesh.points).toEqual(fx.result.gradingMesh.points);
    expect(cf.result.gradingMesh.triangles).toEqual(fx.result.gradingMesh.triangles);
    expect(cf.result.gradingPlanArea).toBe(fx.result.gradingPlanArea);
    // Honest semantic difference: region labels follow the active family.
    expect(cf.result.regions.map((r) => r.classification)).toContain('FILL');
    expect(fx.result.regions.map((r) => r.classification)).not.toContain('FILL');
  });
});

describe('phase20k1 sloped-source Surface arc', () => {
  // Sloped arcs are chord-gate-limited on both paths (the strict per-chord
  // daylight agreement trips where the slope phase meets the tin diagonal,
  // and the analytic assembly fails closed too) — pre-existing boundaries
  // C2 does not move. Where the chord solves pass, the Surface seams
  // assemble to a valid strip.
  it('assembles a valid strip where chord solves pass (10 → 10.5)', () => {
    const base = roundedSquareMembers(10)[0]!.source;
    const src: ResolvedGradingSource = { ...base, startZ: 10, endZ: 10.5 };
    const fx = runStandalone(src, FIXED(-0.5));
    expect(fx.ok).toBe(true);
    if (!fx.ok) return;
    expect(fx.result.gradingMesh.points.length / 3).toBe(39);
    expect(fx.result.gradingMesh.triangles.length / 3).toBe(37);
    expect(fx.result.gradingPlanArea).toBeCloseTo(2136.7448211272645, 9);
    expect(fx.result.minProjectionDistance).toBeCloseTo(20, 9);
  });

  it('steeper phases: 10 → 11 solves, 10 → 12 fails closed on interior overlap', () => {
    // The C2 chord agreement heals steeper slopes while the strip stays
    // fold-free (39pts/37tris). At 10 → 12 a strip sliver folds over its
    // neighbor (same-side shared edge), so the interior-overlap rule
    // fails it closed with the existing PINCH detail — never CURRENT.
    const base = roundedSquareMembers(10)[0]!.source;
    const fx = runStandalone({ ...base, startZ: 10, endZ: 11 }, FIXED(-0.5));
    expect(fx.ok).toBe(true);
    if (!fx.ok) return;
    expect(fx.result.gradingMesh.points.length / 3).toBe(39);
    expect(fx.result.gradingMesh.triangles.length / 3).toBe(37);
    expect(fx.result.gradingPlanArea).toBeCloseTo(2190.7018168390186, 9);
    const folded = runStandalone({ ...base, startZ: 10, endZ: 12 }, FIXED(-0.5));
    expect(folded.ok).toBe(false);
    if (folded.ok) return;
    expect(folded.detail).toContain('overlapping-connected-faces');
  });
});

describe('phase20k1 closed rounded squares (§21 oracles)', () => {
  const members = () => roundedSquareMembers(10).map((m) => m.source);
  const runSquare = (memberCriteria: GradingCriterion[], target?: never) =>
    computeGradingGroupFromSnapshots({
      groupId: 'sq', revision: 'r', members: members(), side: 'right',
      criterion: memberCriteria[0]!, memberCriteria, maxSearchDistance: SEARCH,
      curveChordTolerance: 0.1, closed: true, ...(target === undefined ? {} : { target }),
    });

  it('all-Distance and mixed-analytic are unchanged by C2 (before/after)', () => {
    // C1→C2 before/after: 128pts/128tris/plan 9452.124826335, 4 GAP ties.
    for (const criteria of [
      [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)],
      [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
    ]) {
      const out = runSquare(criteria);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.gradingMesh.points.length / 3).toBe(128);
      expect(out.result.gradingMesh.triangles.length / 3).toBe(128);
      expect(out.result.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
      expect(out.result.corners).toHaveLength(4);
      for (const c of out.result.corners) expect(c.classification).toBe('GAP');
    }
  });

  it('all-Distance vs mixed-analytic meshes are bitwise identical', () => {
    const e = runSquare([DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)]);
    const f = runSquare([DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)]);
    expect(e.ok && f.ok).toBe(true);
    if (!e.ok || !f.ok) return;
    expect(f.result.gradingMesh.points).toEqual(e.result.gradingMesh.points);
    expect(f.result.gradingMesh.triangles).toEqual(e.result.gradingMesh.triangles);
  });

  it('all-Surface square resolves: 4 ties, 1 component, simple rings', () => {
    const out = runSquare(
      [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)], flatTin(0) as never,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.gradingMesh.points.length / 3).toBe(156);
    expect(r.gradingMesh.triangles.length / 3).toBe(156);
    expect(r.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
    expect(r.corners).toHaveLength(4);
    for (const c of r.corners) {
      expect(c.classification).toBe('GAP');
      expect(c.tiePointXyz).toHaveLength(3);
    }
    // Shared-index topology: 1 edge-component, incidence ≤ 2, 2 loops.
    const tris = r.gradingMesh.triangles;
    const incidence = new Map<string, number>();
    const adj = new Map<number, number[]>();
    for (let f = 0; f + 2 < tris.length; f += 3) {
      const t = [tris[f]!, tris[f + 1]!, tris[f + 2]!];
      for (let e = 0; e < 3; e += 1) {
        const a = t[e]!;
        const b = t[(e + 1) % 3]!;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        incidence.set(key, (incidence.get(key) ?? 0) + 1);
      }
    }
    for (const count of incidence.values()) expect(count).toBeLessThanOrEqual(2);
    let boundary = 0;
    for (const [key, count] of incidence) {
      if (count !== 1) continue;
      boundary += 1;
      const [a, b] = key.split('|').map(Number) as [number, number];
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    expect(boundary).toBe(156);
    let loops = 0;
    const seen = new Set<number>();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      loops += 1;
      const stack = [start];
      while (stack.length > 0) {
        const v = stack.pop()!;
        if (seen.has(v)) continue;
        seen.add(v);
        for (const n of adj.get(v) ?? []) if (!seen.has(n)) stack.push(n);
      }
    }
    expect(loops).toBe(2);
  });
});

describe('phase20k1 one-arc hybrid regression G (§22)', () => {
  it('internal seams valid, external tie exact, arc×arc still blocked', () => {
    const arc0 = roundedSquareMembers(10)[0]!.source;
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g', revision: 'r',
      members: [arc0, straight(100, 0, 10, 100, 100, 10)],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), DIST(-0.5, 20)],
      maxSearchDistance: SEARCH, curveChordTolerance: 0.1, closed: false,
      target: flatTin(0),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingMesh.points.length / 3).toBe(43);
    expect(out.result.gradingMesh.triangles.length / 3).toBe(41);
    expect(out.result.corners).toHaveLength(1);
    expect(out.result.corners[0]!.classification).toBe('GAP');
    const tie = out.result.corners[0]!.tiePointXyz!;
    expect(tie[0]).toBe(120);
    expect(tie[2]).toBe(0);
    // §23: hybrid arc×arc stays blocked — Surface arc meets analytic arc.
    const arcPair = computeGradingGroupFromSnapshots({
      groupId: 'g2', revision: 'r',
      members: [arc0, roundedSquareMembers(10)[1]!.source],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), DIST(-0.5, 20)],
      maxSearchDistance: SEARCH, curveChordTolerance: 0.1, closed: false,
      target: flatTin(0),
    });
    expect(arcPair.ok).toBe(false);
    if (arcPair.ok) return;
    expect(arcPair.code).toBe('CORNER_NO_SOLUTION');
    expect(arcPair.detail).toContain('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
  });
});

/* ------------------------------------------------------------------ */
/* Part 2 — target/root pathologies, tolerance ladder, large coords,   */
/* tied semantics. Assembly level uses planar targets (the engine's     */
/* contract — curved targets fail closed honestly at the chord span    */
/* envelope, pre-existing); root-policy units probe solveMiterTie       */
/* directly through the shared authority.                              */
/* ------------------------------------------------------------------ */

import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { solveStraightChord } from '../src/engine/cad/grading/solveStraightChord';
import { buildTargetQuery, candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import {
  assembleSurfaceChain,
  digestSeamMesh,
  type SurfaceSeamChord,
} from '../src/engine/cad/grading/gradingChordSeam';
import { cornerPlane } from '../src/engine/cad/grading/gradingGroupSurfaceCorners';
import { solveMiterTie } from '../src/engine/cad/grading/gradingGroupSectors';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';

const gridTin = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[], anti = false,
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      if (!anti) triangles.push(a, b, c, a, c, d);
      else triangles.push(a, b, d, b, c, d);
    }
  }
  return { points, triangles };
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

describe('phase20k1 Surface target pathologies (assembly level)', () => {
  const src = roundedSquareMembers(10)[0]!.source;

  it('tilted plane below source solves; alt triangulation is bitwise identical', () => {
    const xs = range(-100, 200, 20);
    const ys = range(-120, 100, 20);
    const fn = (x: number): number => 0.125 * x - 16;
    const runOn = (tin: GradingTargetMeshSnapshot) =>
      computeGradingFromSnapshots({
        gradingId: 'c2', revision: 'r', source: src, side: 'right',
        criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
        target: tin,
      });
    const rMain = runOn(gridTin(fn, xs, ys));
    const rAnti = runOn(gridTin(fn, xs, ys, true));
    expect(rMain.ok && rAnti.ok).toBe(true);
    if (!rMain.ok || !rAnti.ok) return;
    expect(rMain.result.gradingPlanArea).toBeCloseTo(4283.56959554946, 9);
    // Same continuum, different diagonals: identical counts and areas,
    // vertices agree to triangulation rounding (≤1 ulp observed).
    expect(rAnti.result.gradingMesh.points.length).toBe(rMain.result.gradingMesh.points.length);
    expect(rAnti.result.gradingMesh.triangles.length).toBe(rMain.result.gradingMesh.triangles.length);
    expect(worstDiff(rAnti.result.gradingMesh.points, rMain.result.gradingMesh.points)).toBeLessThan(1e-12);
    expect(rAnti.result.gradingPlanArea).toBe(rMain.result.gradingPlanArea);
  });

  it('tie landing exactly on a target vertex still ties exactly', () => {
    // Joint-1 tie of the flat run sits at (9.41110639630196,-21.966466085319045);
    // fanning the two flat triangles around a vertex placed exactly there
    // keeps the plan to 12 digits.
    const vtin: GradingTargetMeshSnapshot = {
      points: [
        -450, -450, 0, 450, -450, 0, 450, 450, 0, -450, 450, 0,
        9.41110639630196, -21.966466085319045, 0,
      ],
      triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    };
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: vtin,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingPlanArea).toBeCloseTo(2082.8809540094, 9);
  });

  it('target hole fails closed at the seam tie (never CURRENT)', () => {
    const hole = gridTin(() => 0, range(-100, 200, 10), range(-120, 100, 10));
    const kept: number[] = [];
    for (let f = 0; f + 2 < hole.triangles.length; f += 3) {
      const vs = [hole.triangles[f]!, hole.triangles[f + 1]!, hole.triangles[f + 2]!];
      const cx = vs.reduce((s, v) => s + hole.points[v * 3]!, 0) / 3;
      const cy = vs.reduce((s, v) => s + hole.points[v * 3 + 1]!, 0) / 3;
      if (Math.hypot(cx - 9.4, cy + 21.9) > 8) kept.push(...vs);
    }
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: { points: hole.points, triangles: kept },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('NO_SOLUTION');
    expect(out.detail).toContain('GRADING_CORNER_TIE');
  });

  it('target void fails closed (never CURRENT)', () => {
    const tiny = gridTin(() => 0, range(-5, 105, 10), range(-10, 10, 10));
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: tiny,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('NO_SOLUTION');
  });
});

describe('phase20k1 miter-root pathologies (shared authority units)', () => {
  const flat: GradingTargetMeshSnapshot = {
    points: [-500, -500, 0, 500, -500, 0, 500, 500, 0, -500, 500, 0],
    triangles: [0, 1, 2, 0, 2, 3],
  };

  it('one root ties exactly; empty candidates fail closed (no root)', () => {
    const query = buildTargetQuery(flat)!;
    const cand = candidateTriangles(flat, [
      { x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 },
    ])!;
    const plane = cornerPlane(0, 0, 10, { nx: 1, ny: 0 }, 'right', -0.5, 0)!;
    const one = solveMiterTie(flat, cand, query, plane, 0, 0, 0, -1, 100);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.t).toBe(20);
    expect([one.x, one.y, one.z]).toEqual([0, -20, 0]);
    expect(one.rootCount).toBe(1);
    const none = solveMiterTie(flat, [], query, plane, 0, 0, 0, -1, 100);
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.code).toBe('CORNER_NO_SOLUTION');
  });

  it('multi-root keeps the nearest outward root (later roots never preferred)', () => {
    // Faceted sawtooth (period 4, amplitude 3, exact planar faces): the
    // descending plane crosses every tooth face — many valid outward roots.
    const tri = (y: number): number => {
      const u = ((y / 2) % 2 + 2) % 2;
      return 3 * (1 - Math.abs(u - 1));
    };
    const saw = gridTin((_x, y) => tri(y), range(-40, 140, 1), range(-80, 40, 1));
    const query = buildTargetQuery(saw)!;
    const vx = 12.390964869099555;
    const vy = -2.183420507895761;
    const cand = candidateTriangles(saw, [
      { x: vx - 40, y: vy - 60 }, { x: vx + 40, y: vy - 60 },
      { x: vx + 40, y: vy + 40 }, { x: vx - 40, y: vy + 40 },
    ])!;
    const tIn = { nx: 0.9848273313701935, ny: 0.17353710665521355 };
    const plane = cornerPlane(vx, vy, 10, tIn, 'right', -0.5, 0)!;
    const mx = -0.1489466737857485;
    const my = -0.98884522973424;
    const solved = solveMiterTie(saw, cand, query, plane, vx, vy, mx, my, 100);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.rootCount).toBeGreaterThanOrEqual(3);
    // Independent march oracle: first sign-change interval along the ray,
    // plus a later one (the later matching root that must NOT win).
    const n = gradingSideNormal(tIn.nx, tIn.ny, 'right')!;
    const gx = -0.5 * n.nx;
    const gy = -0.5 * n.ny;
    const diff = (t: number): number | null => {
      const x = vx + mx * t;
      const y = vy + my * t;
      const zt = query.elevationAt(x, y);
      if (zt === null) return null;
      return 10 + gx * (x - vx) + gy * (y - vy) - zt;
    };
    const crossings: Array<[number, number]> = [];
    let prevT = 0;
    let prevD: number | null = diff(0);
    for (let t = 0.25; t <= 60; t += 0.25) {
      const d = diff(t);
      if (d === null || prevD === null) {
        prevT = t;
        prevD = d;
        continue;
      }
      if ((prevD > 0) !== (d > 0)) crossings.push([prevT, t]);
      prevT = t;
      prevD = d;
    }
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    expect(solved.t).toBeGreaterThanOrEqual(crossings[0]![0] - 0.26);
    expect(solved.t).toBeLessThanOrEqual(crossings[0]![1] + 0.26);
    // The later matching root starts strictly after the tie: nearest wins.
    expect(crossings[1]![0]).toBeGreaterThan(solved.t);
  });

  it('overlapping sheets fail closed at the branch gate', () => {
    // Two coincident sheets (z=0 and z=5): the root fits one sheet while
    // the query resolves the other — CORNER_BRANCH_DISCONTINUITY.
    const pts = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5];
    const sheets: GradingTargetMeshSnapshot = { points: pts, triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] };
    const query = buildTargetQuery(sheets)!;
    expect(query.elevationAt(5, 5)).toBe(0);
    const plane = cornerPlane(5, -5, 10, { nx: 1, ny: 0 }, 'left', -0.5, 0)!;
    const branched = solveMiterTie(sheets, [0, 1, 2, 3], query, plane, 5, -5, 0, 1, 100);
    expect(branched.ok).toBe(false);
    if (branched.ok) return;
    expect(branched.code).toBe('CORNER_BRANCH_DISCONTINUITY');
  });

  it('ties exactly on a triangle edge and vertex resolve', () => {
    // Straight-out ray along −y (t=(1,0), right side): the tie is
    // (0,−20,0) by symmetry; the target puts a vertex / diagonal edge
    // exactly there.
    const plane = cornerPlane(0, 0, 10, { nx: 1, ny: 0 }, 'right', -0.5, 0)!;
    const n = gradingSideNormal(1, 0, 'right')!;
    const queryFor = (tin: GradingTargetMeshSnapshot) => buildTargetQuery(tin)!;
    const vertexTin: GradingTargetMeshSnapshot = {
      points: [-10, -30, 0, 10, -30, 0, 0, -20, 0, -10, -10, 0, 10, -10, 0],
      triangles: [0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3],
    };
    const qv = queryFor(vertexTin);
    const hitV = solveMiterTie(vertexTin, [0, 1, 2, 3], qv, plane, 0, 0, n.nx, n.ny, 100);
    expect(hitV.ok).toBe(true);
    if (!hitV.ok) return;
    expect(hitV.x).toBeCloseTo(0, 6);
    expect(hitV.y).toBeCloseTo(-20, 6);
    // Diagonal edge (−10,−10)–(10,−30) through the tie, crossed transversely.
    const edgeTin: GradingTargetMeshSnapshot = {
      points: [-10, -10, 0, 10, -10, 0, 10, -30, 0, -10, -30, 0],
      triangles: [0, 2, 1, 0, 3, 2],
    };
    const qe = queryFor(edgeTin);
    const hitE = solveMiterTie(edgeTin, [0, 1], qe, plane, 0, 0, n.nx, n.ny, 100);
    expect(hitE.ok).toBe(true);
    if (!hitE.ok) return;
    expect(hitE.x).toBeCloseTo(0, 6);
    expect(hitE.y).toBeCloseTo(-20, 6);
  });
});

describe('phase20k1 tolerance ladder 30 → 0.001 (subdivisions, convergence, digest)', () => {
  const src = roundedSquareMembers(10)[0]!.source;
  const ladder = [30, 8, 1, 0.1, 0.01, 0.001];
  const expectedSubdiv = [1, 1, 3, 8, 23, 71];
  const expectedPlans = [
    2000.0, 2000.0, 2065.06061821341, 2082.8809540094, 2089.55167171054, 2091.91623683646,
  ];

  it('every positive width passes with converging area and no NaN', () => {
    const plans: number[] = [];
    ladder.forEach((tol, i) => {
      const lin = linearizeGradingArc(
        src.arc!.centerX, src.arc!.centerY, src.arc!.radius,
        src.arc!.startAngle, src.arc!.endAngle, src.arc!.sweepCCW,
        src.startZ, src.endZ, tol,
      )!;
      expect(lin.subdivisions).toBe(expectedSubdiv[i]);
      // Sagitta policy holds at every rung.
      const sweep = Math.abs(src.arc!.endAngle - src.arc!.startAngle);
      const chord = 2 * src.arc!.radius * Math.sin(sweep / (2 * lin.subdivisions));
      const sagitta = src.arc!.radius - Math.sqrt(src.arc!.radius ** 2 - (chord / 2) ** 2);
      expect(sagitta).toBeLessThanOrEqual(tol * (1 + 1e-9));
      const out = computeGradingFromSnapshots({
        gradingId: 'c2', revision: 'r', source: src, side: 'right',
        criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: tol,
        target: flatTin(0),
      });
      expect(out.ok, `tol ${tol}`).toBe(true);
      if (!out.ok) return;
      const mesh = out.result.gradingMesh;
      expect(mesh.points.some((v) => !Number.isFinite(v))).toBe(false);
      expect(out.result.gradingPlanArea).toBeCloseTo(expectedPlans[i]!, 9);
      expect(out.result.minProjectionDistance).toBeCloseTo(20, 9);
      expect(out.result.maxProjectionDistance).toBeGreaterThanOrEqual(20);
      plans.push(out.result.gradingPlanArea);
    });
    // Monotone convergence, shrinking steps (no oscillation).
    for (let i = 1; i < plans.length; i += 1) {
      expect(plans[i]).toBeGreaterThanOrEqual(plans[i - 1]!);
    }
    const steps = plans.slice(1).map((p, i) => p - plans[i]!);
    for (let i = 1; i < steps.length; i += 1) {
      if (steps[i - 1]! > 0) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
  });

  it('seam counts follow subdivisions; digests are deterministic', () => {
    // Direct assembly: outward arc resolves one GAP tie per internal joint.
    const buildCarries = (tol: number): { carries: SurfaceSeamChord[]; tin: GradingTargetMeshSnapshot; query: NonNullable<ReturnType<typeof buildTargetQuery>> } => {
      const tin = flatTin(0);
      const query = buildTargetQuery(tin)!;
      const lin = linearizeGradingArc(
        src.arc!.centerX, src.arc!.centerY, src.arc!.radius,
        src.arc!.startAngle, src.arc!.endAngle, src.arc!.sweepCCW,
        src.startZ, src.endZ, tol,
      )!;
      const carries: SurfaceSeamChord[] = [];
      for (let k = 0; k < lin.subdivisions; k += 1) {
        const p0 = lin.points[k]!;
        const p1 = lin.points[k + 1]!;
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const chord = {
          startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
          startZ: p0.z, endZ: p1.z, length: len, reoriented: false, isArc: false,
        };
        const solved = solveStraightChord({
          source: chord, side: 'right', criterion: FIXED(-0.5),
          maxSearchDistance: SEARCH, target: tin, query, stationBase: 0, stationScale: 1,
        });
        if (!solved.ok) throw new Error('chord failed');
        const t = { nx: (p1.x - p0.x) / len, ny: (p1.y - p0.y) / len };
        carries.push({
          t, n: gradingSideNormal(t.nx, t.ny, 'right')!, gs: 0, chord, solve: solved.solve,
        });
      }
      return { carries, tin, query };
    };
    const seamKinds = (tol: number): string => {
      const { carries, tin, query } = buildCarries(tol);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of carries) {
        minX = Math.min(minX, c.chord.startX, c.chord.endX);
        minY = Math.min(minY, c.chord.startY, c.chord.endY);
        maxX = Math.max(maxX, c.chord.startX, c.chord.endX);
        maxY = Math.max(maxY, c.chord.startY, c.chord.endY);
      }
      const candidates = candidateTriangles(tin, [
        { x: minX - SEARCH, y: minY - SEARCH }, { x: maxX + SEARCH, y: minY - SEARCH },
        { x: maxX + SEARCH, y: maxY + SEARCH }, { x: minX - SEARCH, y: maxY + SEARCH },
      ])!;
      const asm = assembleSurfaceChain(carries, {
        side: 'right', criterion: FIXED(-0.5), maxSearchDistance: SEARCH,
        target: tin, candidates, query,
      });
      if (!asm.ok) throw new Error('assembly failed: ' + asm.detail);
      return asm.value.ties.map((t) => t.kind).join(',');
    };
    expect(seamKinds(0.1)).toBe('GAP,GAP,GAP,GAP,GAP,GAP,GAP');
    // Inward (concave-side) arc resolves OVERLAP trims instead.
    const overlap = (() => {
      const tin = flatTin(0);
      const query = buildTargetQuery(tin)!;
      const lin = linearizeGradingArc(0, 0, 50, 0, Math.PI / 2, true, 10, 10, 0.05)!;
      const carries: SurfaceSeamChord[] = [];
      for (let k = 0; k < lin.subdivisions; k += 1) {
        const p0 = lin.points[k]!;
        const p1 = lin.points[k + 1]!;
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const chord = {
          startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
          startZ: p0.z, endZ: p1.z, length: len, reoriented: false, isArc: false,
        };
        const solved = solveStraightChord({
          source: chord, side: 'left', criterion: FIXED(-0.5),
          maxSearchDistance: 1000, target: tin, query, stationBase: 0, stationScale: 1,
        });
        if (!solved.ok) throw new Error('chord failed');
        const t = { nx: (p1.x - p0.x) / len, ny: (p1.y - p0.y) / len };
        carries.push({
          t, n: gradingSideNormal(t.nx, t.ny, 'left')!, gs: 0, chord, solve: solved.solve,
        });
      }
      const asm = assembleSurfaceChain(carries, {
        side: 'left', criterion: FIXED(-0.5), maxSearchDistance: 1000,
        target: tin, candidates: [0, 1], query,
      });
      if (!asm.ok) throw new Error('assembly failed: ' + asm.detail);
      return asm.value.ties;
    })();
    expect(overlap.length).toBe(17);
    for (const tie of overlap) expect(tie.kind).toBe('OVERLAP');
    // Digest determinism: same tolerance twice ⇒ same digest.
    const digestOf = (tol: number): string => {
      const out = computeGradingFromSnapshots({
        gradingId: 'c2', revision: 'r', source: src, side: 'right',
        criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: tol,
        target: flatTin(0),
      });
      if (!out.ok) throw new Error('digest run failed');
      return digestSeamMesh(out.result.gradingMesh.points, out.result.gradingMesh.triangles);
    };
    expect(digestOf(0.1)).toBe(digestOf(0.1));
    expect(digestOf(0.1)).toBe('b6bdc245');
  });

  it('excessive subdivision fails closed (never hangs the worker)', () => {
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 1e-7,
      target: flatTin(0),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ARC_TOO_FINE');
  });
});

describe('phase20k1 large-coordinate matrix (translation invariance)', () => {
  it('holds geometry to 1e-9 relative with no NaN and no zeroDelta change', () => {
    const base = roundedSquareMembers(10)[0]!.source;
    const before = zeroDelta(100, 100);
    const baseOut = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: base, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: flatTin(0),
    });
    expect(baseOut.ok).toBe(true);
    if (!baseOut.ok) return;
    const basePlan = baseOut.result.gradingPlanArea;
    for (const [ox, oy] of [[5e5, 5e6], [2e6, 7e6], [2e7, 7e7], [1e8, 3e8]] as const) {
      const moved: ResolvedGradingSource = {
        ...base,
        startX: base.startX + ox, startY: base.startY + oy,
        endX: base.endX + ox, endY: base.endY + oy,
        arc: base.arc ? { ...base.arc, centerX: base.arc.centerX + ox, centerY: base.arc.centerY + oy } : undefined,
      };
      const tin: GradingTargetMeshSnapshot = {
        points: [-450 + ox, -450 + oy, 0, 450 + ox, -450 + oy, 0, 450 + ox, 450 + oy, 0, -450 + ox, 450 + oy, 0],
        triangles: [0, 1, 2, 0, 2, 3],
      };
      const out = computeGradingFromSnapshots({
        gradingId: 'c2', revision: 'r', source: moved, side: 'right',
        criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
        target: tin,
      });
      expect(out.ok, `offset ${ox},${oy}`).toBe(true);
      if (!out.ok) continue;
      expect(out.result.gradingMesh.points.some((v) => !Number.isFinite(v))).toBe(false);
      expect(Math.abs(out.result.gradingPlanArea - basePlan) / basePlan).toBeLessThan(1e-9);
    }
    expect(zeroDelta(100, 100)).toBe(before);
  });
});

describe('phase20k1 tied semantics on curved Surface arcs', () => {
  const src = roundedSquareMembers(10)[0]!.source;

  it('fully tied arc reports ALREADY_TIED with an empty mesh', () => {
    const tied = { ...src, startZ: 0, endZ: 0 };
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: tied, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: flatTin(0),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingMesh.triangles).toHaveLength(0);
    expect(out.result.diagnostics.map((d) => d.code)).toContain('ALREADY_TIED');
  });

  it('CUT→TIED→FILL across one arc: separated regions, complete partition', () => {
    // Single tilted plane crossing source level at x=50: FILL west, CUT
    // east, tied stations at the crossing; no crease (one plane).
    const cross = gridTin((x) => 10 + 0.1 * (x - 50), range(-100, 200, 10), range(-60, 60, 10));
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: src, side: 'right',
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -2 },
      maxSearchDistance: SEARCH, curveChordTolerance: 0.1, target: cross,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const kinds = new Set(out.result.regions.map((r) => r.classification));
    expect(kinds.has('CUT')).toBe(true);
    expect(kinds.has('FILL')).toBe(true);
    // Source-length partition is complete (tied line is measure-zero).
    const total = out.result.cutSourceLength + out.result.fillSourceLength + out.result.tiedSourceLength;
    expect(total).toBeCloseTo(src.length, 6);
    expect(out.result.cutSourceLength).toBeCloseTo(out.result.fillSourceLength, 0);
  });

  it('zero-width steep drop fails closed on interior overlap', () => {
    // The steep drop onto the far tin folds a strip sliver over its
    // neighbor (same-side shared edge, macroscopic offset), so the
    // interior-overlap rule fails it closed — never CURRENT. Tie-exactness
    // coverage lives on fold-free strips (the GAP-fan and ladder tests).
    const sloped = { ...src, startZ: 10, endZ: 0 };
    const tin: GradingTargetMeshSnapshot = {
      points: [-450, -450, 0, 450, -450, 0, 450, 450, 0, -450, 450, 0],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const out = computeGradingFromSnapshots({
      gradingId: 'c2', revision: 'r', source: sloped, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: SEARCH, curveChordTolerance: 0.1,
      target: tin,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.detail).toContain('overlapping-connected-faces');
  });
});
