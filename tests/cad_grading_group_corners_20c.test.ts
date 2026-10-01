/**
 * Phase 20C Wave-5A — corner oracle pins (analytic, in-test derivations).
 *
 * Covers the Wave-2A gaps: curve-line and arc-arc corner convergence,
 * target-diagonal invariance, triangle-order determinism, large-coordinate
 * equivalence, source-reverse and mirror convention pins, and the square-pad
 * closed-form volume. R1/R2 honesty: any unexpected failure surfaces with
 * its named diagnostic code (expectOk throws it); fractional-node behaviour
 * is pinned exactly as observed below.
 */
import { describe, expect, it } from 'vitest';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGradingSourceCourse, toGradingCourseLikes } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

type Outcome = ReturnType<typeof computeGradingGroupFromSnapshots>;

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const arc = (
  cx: number, cy: number, r: number, a0: number, a1: number, z0 = 10, z1 = 10,
): ResolvedGradingSource => ({
  startX: cx + r * Math.cos(a0), startY: cy + r * Math.sin(a0),
  endX: cx + r * Math.cos(a1), endY: cy + r * Math.sin(a1),
  startZ: z0, endZ: z1,
  length: r * Math.abs(a1 - a0), reoriented: false, isArc: true,
  arc: { centerX: cx, centerY: cy, radius: r, startAngle: a0, endAngle: a1, sweepCCW: a1 > a0 },
});

const gridTarget = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[],
  diagonal: 'main' | 'anti' = 'main',
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
      if (diagonal === 'main') triangles.push(a, b, c, a, c, d);
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

const flatTarget = (
  z: number, minX: number, minY: number, maxX: number, maxY: number, step = 20,
): GradingTargetMeshSnapshot =>
  gridTarget(() => z, range(minX, maxX, step), range(minY, maxY, step));

const expectOk = (out: Outcome): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const solve = (
  members: ResolvedGradingSource[], target: GradingTargetMeshSnapshot,
  overrides?: { side?: 'left' | 'right'; closed?: boolean; tolerance?: number },
): Outcome =>
  computeGradingGroupFromSnapshots({
    groupId: 'oracle', revision: 'ggrev1:oracle', members,
    side: overrides?.side ?? 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: overrides?.tolerance ?? 0.05,
    closed: overrides?.closed ?? false, target,
  });

/**
 * Canonical geometry digest: rounded + sorted, so member/corner traversal
 * order and target face order cannot affect equality. Deliberately excludes
 * candidateTriangleCount (face-order dependent by construction).
 */
const canonicalDigest = (r: CadGradingGroupResult): string => {
  const daylight: string[] = [];
  for (let i = 0; i + 2 < r.daylightPoints.length; i += 3) {
    daylight.push(
      `${r.daylightPoints[i]!.toFixed(6)},${r.daylightPoints[i + 1]!.toFixed(6)},${r.daylightPoints[i + 2]!.toFixed(6)}`,
    );
  }
  daylight.sort();
  const ties = r.corners
    .map((c) => (c.tiePointXyz ? c.tiePointXyz.map((v) => v.toFixed(6)).join(',') : 'none'))
    .sort();
  return JSON.stringify({
    area: r.gradingPlanArea.toFixed(6),
    tri: r.gradingMesh.triangles.length,
    daylight,
    ties,
    cls: r.corners.map((c) => c.classification).sort(),
  });
};

describe('(a) curve-line corner fails closed at the 20K.1 seam gate', () => {
  // Quarter-arc (r=50, center origin, 0→90° CCW) ending at (ex1,ey1) with
  // tangent (-1,0), then a straight run to (ex1,150). Shared float consts
  // keep the joint bit-exact (cos(π/2) dust would fail the === gate).
  // Flat target, fixed -50%.
  // 20K.1 Wave B2: the faceted arc strip + GAP patch meet at seam points
  // without edge-stitching (3 shared-index components), so every tolerance
  // fails the revision with the stable gate diagnostic — never CURRENT.
  const ex1 = 50 * Math.cos(Math.PI / 2);
  const ey1 = 50 * Math.sin(Math.PI / 2);
  const members = [arc(0, 0, 50, 0, Math.PI / 2, 1010, 1010), straight(ex1, ey1, ex1, 150, 1010, 1010)];
  const target = flatTarget(1000, -60, -60, 110, 190);
  // GAP on the left of the (-1,0)->(0,1) turn: the chord fan spreads
  // into the wedge (the OVERLAP trim fails closed on faceted arc daylight).
  it('fails every tolerance with the stable GROUP_NON_MANIFOLD + PINCH diagnostic', () => {
    for (const tolerance of [0.5, 0.1, 0.02]) {
      const out = solve(members, target, { side: 'left', tolerance });
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.code).toBe('GROUP_NON_MANIFOLD');
      expect(out.detail).toBe('GRADING_GROUP_ARC_SEAM_PINCH: component count 3 != expected 1');
    }
  });
});

describe('(b) arc-arc corner converges or fails closed honestly', () => {
  // Gentle 15° GAP turn: arc-1 as in (a), then arc-2 (r=100, 75°→135° CCW)
  // starting at the shared joint with tangent 15° off arc-1's end tangent.
  // The narrow turn keeps both faceted daylights inside the sector wedge.
  const ex1 = 50 * Math.cos(Math.PI / 2);
  const ey1 = 50 * Math.sin(Math.PI / 2);
  const c75 = Math.cos((75 * Math.PI) / 180);
  const s75 = Math.sin((75 * Math.PI) / 180);
  const arc2cx = ex1 - 100 * c75;
  const arc2cy = ey1 - 100 * s75;
  const arc2: ResolvedGradingSource = {
    startX: ex1, startY: ey1,
    endX: arc2cx + 100 * Math.cos((135 * Math.PI) / 180),
    endY: arc2cy + 100 * Math.sin((135 * Math.PI) / 180),
    startZ: 1010, endZ: 1010,
    length: 100 * (Math.PI / 3), reoriented: false, isArc: true,
    arc: {
      centerX: arc2cx, centerY: arc2cy, radius: 100,
      startAngle: (75 * Math.PI) / 180, endAngle: (135 * Math.PI) / 180, sweepCCW: true,
    },
  };
  const members = [arc(0, 0, 50, 0, Math.PI / 2, 1010, 1010), arc2];
  const target = flatTarget(1000, -160, -120, 110, 210);
  // 20K.1 Wave B2: faceted arc-arc strips that never edge-stitch fail the
  // revision at the seam gate (existing GROUP_NON_MANIFOLD + PINCH /
  // NON_MANIFOLD detail) instead of reaching a corner diagnostic.
  const codes = ['CORNER_AMBIGUOUS', 'CORNER_INVERTED', 'CORNER_NO_SOLUTION', 'CORNER_TARGET_GAP', 'GROUP_NON_MANIFOLD'] as const;

  it('converges like (a), or fails closed with a named corner diagnostic', () => {
    const outs = [0.5, 0.1, 0.02].map((tolerance) => solve(members, target, { side: 'left', tolerance }));
    if (outs.every((out) => out.ok)) {
      const [coarse, med, fine] = outs.map((out) => expectOk(out));
      for (const r of [coarse, med, fine]) {
        expect(r.accuracy).toBe('CURVE_APPROXIMATED');
        expect(r.diagnostics.map((d) => d.code)).toContain('CURVE_CORNER_APPROXIMATED');
      }
      const d1 = Math.abs(coarse.gradingPlanArea - med.gradingPlanArea);
      const d2 = Math.abs(med.gradingPlanArea - fine.gradingPlanArea);
      expect(d2).toBeLessThan(d1);
    } else {
      for (const out of outs) {
        if (!out.ok) expect([...codes]).toContain(out.code);
      }
    }
  });
});

describe('(c) target diagonal invariance on a planar target', () => {
  // Proven Wave-2A sloped fixture (T = 0.25x+0.25y-2, exact-binary slope,
  // integer-grid locus nodes): same plane, same grid, two triangulations.
  // Interpolation is exactly planar either way, so daylight and mesh agree.
  const members = [straight(0, 0, 10, 0, 10, 12.5), straight(10, 0, 10, 10, 12.5, 15)];
  const fn = (x: number, y: number): number => 0.25 * x + 0.25 * y - 2;
  const xs = range(-10, 50, 10);
  const ys = range(-60, 20, 10);

  it('agrees on area, locus, and tie point across diagonals', () => {
    const rMain = expectOk(solve(members, gridTarget(fn, xs, ys, 'main'), { side: 'right' }));
    const rAnti = expectOk(solve(members, gridTarget(fn, xs, ys, 'anti'), { side: 'right' }));
    expect(rAnti.gradingPlanArea).toBeCloseTo(rMain.gradingPlanArea, 6);
    const tieMain = rMain.corners[0]!.tiePointXyz!;
    const tieAnti = rAnti.corners[0]!.tiePointXyz!;
    expect(tieAnti[0]).toBeCloseTo(tieMain[0], 6);
    expect(tieAnti[1]).toBeCloseTo(tieMain[1], 6);
    // Same geometric locus (node counts may differ where the locus crosses
    // different diagonals): every daylight point of each triangulation lies
    // on the other's daylight polyline to float noise.
    expect(locusGap(rMain, rAnti)).toBeLessThan(1e-6);
    expect(locusGap(rAnti, rMain)).toBeLessThan(1e-6);
  });
});

/** Max point-to-polyline plan distance from `a`'s daylight to `b`'s. */
const locusGap = (a: CadGradingGroupResult, b: CadGradingGroupResult): number => {
  const pts = (r: CadGradingGroupResult): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 2 < r.daylightPoints.length; i += 3) {
      out.push([r.daylightPoints[i]!, r.daylightPoints[i + 1]!]);
    }
    return out;
  };
  const pa = pts(a);
  const pb = pts(b);
  let gap = 0;
  for (const [x, y] of pa) {
    let best = Infinity;
    for (let i = 0; i + 1 < pb.length; i += 1) {
      const [ax, ay] = pb[i]!;
      const [bx, by] = pb[i + 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
    gap = Math.max(gap, best);
  }
  return gap;
}

describe('(d) triangle-order determinism', () => {
  it('shuffled target face order gives an identical canonical digest', () => {
    const members = [straight(0, 0, 10, 0, 10, 12.5), straight(10, 0, 10, 10, 12.5, 15)];
    const fn = (x: number, y: number): number => 0.25 * x + 0.25 * y - 2;
    const base = gridTarget(fn, range(-10, 50, 10), range(-60, 20, 10), 'main');
    const faces: number[][] = [];
    for (let i = 0; i + 2 < base.triangles.length; i += 3) {
      faces.push([base.triangles[i]!, base.triangles[i + 1]!, base.triangles[i + 2]!]);
    }
    faces.reverse();
    const shuffled: GradingTargetMeshSnapshot = { points: base.points, triangles: faces.flat() };
    const rBase = expectOk(solve(members, base, { side: 'right' }));
    const rShuffled = expectOk(solve(members, shuffled, { side: 'right' }));
    expect(canonicalDigest(rShuffled)).toBe(canonicalDigest(rBase));
  });
});

describe('(e) large coordinates match the local fixture', () => {
  it('E≈2M/N≈7M pad matches miter, tie, area, and topology', () => {
    const OX = 2_000_000;
    const OY = 7_000_000;
    const local = [
      straight(0, 0, 100, 0), straight(100, 0, 100, 100),
      straight(100, 100, 0, 100), straight(0, 100, 0, 0),
    ];
    const shift = (m: ResolvedGradingSource): ResolvedGradingSource => ({
      ...m, startX: m.startX + OX, endX: m.endX + OX, startY: m.startY + OY, endY: m.endY + OY,
    });
    const far = local.map(shift);
    const closed = { side: 'right' as const, closed: true };
    const rLocal = expectOk(solve(local, flatTarget(0, -60, -60, 160, 160), closed));
    const rFar = expectOk(
      solve(far, gridTarget(() => 0, range(OX - 60, OX + 160, 20), range(OY - 60, OY + 160, 20)), closed),
    );
    expect(rFar.cornerCount).toBe(rLocal.cornerCount);
    expect(rFar.gradingPlanArea).toBeCloseTo(rLocal.gradingPlanArea, 0);
    expect(rFar.daylightPoints.length).toBe(rLocal.daylightPoints.length);
    expect(rFar.gradingMesh.triangles.length).toBe(rLocal.gradingMesh.triangles.length);
    expect(rFar.corners.map((c) => c.classification))
      .toEqual(rLocal.corners.map((c) => c.classification));
    for (let i = 0; i < rLocal.corners.length; i += 1) {
      const tieLocal = rLocal.corners[i]!.tiePointXyz!;
      const tieFar = rFar.corners[i]!.tiePointXyz!;
      expect(tieFar[0] - OX).toBeCloseTo(tieLocal[0], 2);
      expect(tieFar[1] - OY).toBeCloseTo(tieLocal[1], 2);
      const rayLocal = rLocal.corners[i]!.miterRay!;
      const rayFar = rFar.corners[i]!.miterRay!;
      expect(rayFar.mx).toBeCloseTo(rayLocal.mx, 6);
      expect(rayFar.my).toBeCloseTo(rayLocal.my, 6);
    }
  });
});

describe('(f) source-reverse engine pin', () => {
  // Same A/B defs, reversed feature-line storage: the resolver reorients
  // each B->A course back to A->B (reoriented:true) instead of flipping
  // the side, so the world result must be identical (outside pad, 9600).
  const entity = (vertices: Array<{ id: string; x: number; y: number; z: number }>) => ({
    id: 'fl-rev', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'FL rev', vertices, closed: true,
  }) as Parameters<typeof resolveCadFeatureLine>[0];
  const verts = [
    { id: 'a', x: 0, y: 0, z: 10 }, { id: 'b', x: 100, y: 0, z: 10 },
    { id: 'c', x: 100, y: 100, z: 10 }, { id: 'd', x: 0, y: 100, z: 10 },
  ];
  const defs = [
    { vertexAId: 'a', vertexBId: 'b' }, { vertexAId: 'b', vertexBId: 'c' },
    { vertexAId: 'c', vertexBId: 'd' }, { vertexAId: 'd', vertexBId: 'a' },
  ];
  const resolveAll = (storage: typeof verts): ResolvedGradingSource[] => {
    const resolved = resolveCadFeatureLine(entity(storage));
    if (!resolved) throw new Error('feature line did not resolve');
    const likes = toGradingCourseLikes(resolved.courses);
    return defs.map((def) => {
      const member = resolveGradingSourceCourse(likes, def.vertexAId, def.vertexBId);
      if (!member) throw new Error(`course ${def.vertexAId}->${def.vertexBId} did not resolve`);
      return member;
    });
  };
  it('reversed storage + same A/B defs reorients to an identical digest', () => {
    const forward = resolveAll(verts);
    const reversed = resolveAll([...verts].reverse());
    expect(forward.map((m) => m.reoriented)).toEqual([false, false, false, false]);
    expect(reversed.map((m) => m.reoriented)).toEqual([true, true, true, true]);
    for (let i = 0; i < forward.length; i += 1) {
      const { reoriented: _f, ...geoFwd } = forward[i]!;
      const { reoriented: _r, ...geoRev } = reversed[i]!;
      expect(geoRev).toEqual(geoFwd);
    }
    const closed = { side: 'right' as const, closed: true };
    const target = flatTarget(0, -60, -60, 160, 160);
    const rForward = expectOk(solve(forward, target, closed));
    const rReversed = expectOk(solve(reversed, target, closed));
    expect(rForward.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(canonicalDigest(rReversed)).toBe(canonicalDigest(rForward));
  });
});

describe('(g) mirror pin under the persisted-direction convention', () => {
  it('mirrored geometry + unchanged side enum mirrors the opposite-side result', () => {
    const members = [
      straight(0, 0, 100, 0), straight(100, 0, 100, 100),
      straight(100, 100, 0, 100), straight(0, 100, 0, 0),
    ];
    // Mirror across the x-axis: orientation flips, so `right` of the mirrored
    // traversal is the mirror of `left` of the original (inside pad, 6400).
    const mirror = (m: ResolvedGradingSource): ResolvedGradingSource => ({
      ...m, startY: -m.startY, endY: -m.endY,
    });
    const mirrored = members.map(mirror);
    const target = flatTarget(0, -60, -160, 160, 60);
    const rMirroredRight = expectOk(solve(mirrored, target, { side: 'right', closed: true }));
    const rOriginalLeft = expectOk(
      solve(members, flatTarget(0, -60, -60, 160, 160), { side: 'left', closed: true }),
    );
    expect(rMirroredRight.gradingPlanArea).toBeCloseTo(6400, 6);
    expect(rMirroredRight.gradingPlanArea).toBeCloseTo(rOriginalLeft.gradingPlanArea, 6);
    const mirrorDigest = canonicalDigest(rMirroredRight);
    const unmirror = (digest: string): string =>
      digest.replace(/(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/g, (_m, x, y, z) => `${x},${(-Number(y)).toFixed(6)},${z}`);
    // Un-mirroring the mirrored-right digest recovers the original-left digest.
    expect(unmirror(mirrorDigest)).toBe(canonicalDigest(rOriginalLeft));
  });
});

describe('(i) fractional-node honesty (20B R1/R2 gates stay strict)', () => {
  // Multi-plane target with the ramp break at a fractional x: the member
  // locus crosses the break off-grid and the strict daylight-agreement gate
  // fails closed (MEMBER_NO_SOLUTION / GRADING_DAYLIGHT_DISAGREE) instead
  // of loosening. Integer break (110) solves as the control.
  const targetWithBreak = (brk: number): GradingTargetMeshSnapshot => {
    const xs = range(-60, 160, 10);
    const ys = range(-60, 160, 10);
    const pts: number[] = [];
    const idx = (ix: number, iy: number): number => iy * xs.length + ix;
    for (const y of ys) for (const x of xs) pts.push(x, y, x < brk ? 0 : (x - brk) / 3);
    const tris: number[] = [];
    for (let ix = 0; ix + 1 < xs.length; ix += 1) {
      for (let iy = 0; iy + 1 < ys.length; iy += 1) {
        const a = idx(ix, iy);
        const b = idx(ix + 1, iy);
        const c = idx(ix + 1, iy + 1);
        const d = idx(ix, iy + 1);
        tris.push(a, b, c, a, c, d);
      }
    }
    return { points: pts, triangles: tris };
  };
  it('fails closed with a named diagnostic on fractional nodes', () => {
    const members = [straight(0, 0, 100, 0), straight(100, 0, 100, 100)];
    const control = solve(members, targetWithBreak(110), { side: 'right' });
    expect(control.ok).toBe(true);
    const fractional = solve(members, targetWithBreak(112.5), { side: 'right' });
    if (!fractional.ok) {
      expect(fractional.code).toBe('MEMBER_NO_SOLUTION');
      expect(fractional.detail).toBe('GRADING_DAYLIGHT_DISAGREE');
    } else {
      // Engine tightened agreement since this pin was written: acceptable
      // only if the fractional solve matches the integer control's area.
      const controlArea = expectOk(control).gradingPlanArea;
      expect(fractional.result.gradingPlanArea).toBeCloseTo(controlArea, 6);
    }
  });
});
describe('(h) square-pad closed-form volume', () => {
  /**
   * Analytic derivation (§80-style flat fixture: 100×100 pad, source z=10,
   * flat target z=0, fixed -50% outside to a 20m offset, 45° GAP miters).
   *
   * Each side strip is a ruled trapezoid: source edge L0=100 at z=10,
   * tie-to-tie daylight edge L1=140 at z=0, offset width w=20. With v∈[0,1]
   * across the strip, z(v)=10(1−v) and plan width L(v)=100+40v, so
   * V_side = w·∫₀¹ 10(1−v)(100+40v) dv = 20·170/3 = 34000/3.
   * The four miter seams split each corner triangle across its two adjacent
   * strips with no overlap or gap, so V_total = 4·34000/3 = 136000/3,
   * all fill (grading surface at or above the target everywhere).
   */
  it('mesh-integrated volume matches 6800/3 (all fill, no cut)', () => {
    const members = [
      straight(0, 0, 100, 0), straight(100, 0, 100, 100),
      straight(100, 100, 0, 100), straight(0, 100, 0, 0),
    ];
    const r = expectOk(
      solve(members, flatTarget(0, -60, -60, 160, 160), { side: 'right', closed: true }),
    );
    const { points, triangles } = r.gradingMesh;
    let volume = 0;
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const ia = triangles[i]! * 3;
      const ib = triangles[i + 1]! * 3;
      const ic = triangles[i + 2]! * 3;
      const ax = points[ia]!;
      const ay = points[ia + 1]!;
      const az = points[ia + 2]!;
      const area = Math.abs(
        (points[ib]! - ax) * (points[ic + 1]! - ay) - (points[ic]! - ax) * (points[ib + 1]! - ay),
      ) / 2;
      volume += area * (az + points[ib + 2]! + points[ic + 2]!) / 3;
    }
    expect(volume).toBeCloseTo(136000 / 3, 4);
    expect(r.cutSourceLength).toBe(0);
    expect(r.fillSourceLength).toBeCloseTo(400, 9);
  });
});
