/**
 * Phase 20J Wave B — hybrid grading groups (production engine proof).
 *
 * Open two-course oracle, closed 100×100 square with mixed surface+analytic
 * criteria, Distance-24 mismatch, OVERLAP group with an independent
 * no-interior-overlap audit, and determinism — all through
 * `computeGradingGroupFromSnapshots`.
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { groupTerminationMode } from '../src/engine/cad/grading/gradingGroupTermination';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
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

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

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

const flatGrid = (z: number, min: number, max: number, step = 20): GradingTargetMeshSnapshot =>
  gridTarget(() => z, range(min, max, step), range(min, max, step));

const expectOk = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const digest = (r: CadGradingGroupResult): string =>
  [...r.gradingMesh.points, ...r.gradingMesh.triangles, ...r.daylightPoints].join(',');

/** Independent audit: no two shell triangles overlap in plan interior. */
const assertNoInteriorOverlap = (r: CadGradingGroupResult): void => {
  const pts = (i: number): [number, number] => [r.gradingMesh.points[i * 3]!, r.gradingMesh.points[i * 3 + 1]!];
  const tris: Array<[[number, number], [number, number], [number, number]]> = [];
  for (let f = 0; f + 2 < r.gradingMesh.triangles.length; f += 3) {
    tris.push([pts(r.gradingMesh.triangles[f]!), pts(r.gradingMesh.triangles[f + 1]!), pts(r.gradingMesh.triangles[f + 2]!)]);
  }
  const clip = (poly: Array<[number, number]>, ax: number, ay: number, bx: number, by: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    const inside = (px: number, py: number): boolean =>
      (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= -1e-12;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const pIn = inside(p[0], p[1]);
      const qIn = inside(q[0], q[1]);
      if (pIn) out.push(p);
      if (pIn !== qIn) {
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const denom = (bx - ax) * dy - (by - ay) * dx;
        const t = denom === 0 ? 0 : ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)) / denom;
        out.push([p[0] - dx * t, p[1] - dy * t]);
      }
    }
    return out;
  };
  const area = (poly: Array<[number, number]>): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      s += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(s) / 2;
  };
  for (let i = 0; i < tris.length; i += 1) {
    for (let j = i + 1; j < tris.length; j += 1) {
      let poly: Array<[number, number]> = [...tris[i]!];
      const q = tris[j]!;
      for (let e = 0; e < 3; e += 1) {
        const a = q[e]!;
        const b = q[(e + 1) % 3]!;
        poly = clip(poly, a[0], a[1], b[0], b[1]);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) expect(area(poly)).toBeLessThanOrEqual(1e-9);
    }
  }
};

describe('phase20j open two-course hybrid oracle', () => {
  const members = [M(-60, 0, 100, 0, 0, 100), M(0, 0, 100, 0, 60, 100)];
  const solve = (): ReturnType<typeof computeGradingGroupFromSnapshots> =>
    computeGradingGroupFromSnapshots({
      groupId: 'open', revision: 'r', members,
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false,
      target: flatGrid(90, -100, 100),
    });

  it('solves hybrid with the exact tie, extent, Qs/Qa, and CURRENT-capable shell', () => {
    const r = expectOk(solve());
    expect(groupTerminationMode(FIXED(-0.5), [FIXED(-0.5), REL(-0.25, -10)])).toBe('hybrid');
    expect(r.memberCount).toBe(2);
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.classification).toBe('GAP');
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
    expect(r.corners[0]!.miterExtent).toBeCloseTo(Math.sqrt(2000), 9);
    expect(r.corners[0]!.daylightPoints).toEqual([0, -20, 90, 40, -20, 90, 40, 0, 90]);
    expect(r.daylightPoints).toEqual([-60, -20, 90, 0, -20, 90, 40, -20, 90, 40, 0, 90, 40, 60, 90]);
    expect(r.gradingMesh.triangles.length / 3).toBeGreaterThan(0);
    expect(r.gradingPlanArea).toBeCloseTo(4400, 9);
    expect(r.candidateTriangleCount).toBeGreaterThan(0);
    // Pinned honest counts on this grid fixture: member chord solves plus
    // the single hybrid corner segment (no sector locus on either side).
    expect(r.intersectionSegmentCount).toBe(6);
    expect(r.multipleSolutionCount).toBe(4);
    expect(r.accuracy).toBe('EXACT');
  });

  it('is deterministic and has no interior overlap', () => {
    const a = expectOk(solve());
    const b = expectOk(solve());
    expect(digest(b)).toBe(digest(a));
    assertNoInteriorOverlap(a);
  });
});

describe('phase20j closed hybrid square', () => {
  const SQM = [
    M(0, 0, 10, 100, 0, 10), M(100, 0, 10, 100, 100, 10),
    M(100, 100, 10, 0, 100, 10), M(0, 100, 10, 0, 0, 10),
  ];
  const CRIT: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];
  const TIES: Array<[number, number, number]> = [
    [120, -20, 0], [120, 120, 0], [-20, 120, 0], [-20, -20, 0],
  ];
  const target = flatGrid(0, -60, 160);
  const base = {
    groupId: 'sq', revision: 'r', members: SQM, side: 'right' as const,
    maxSearchDistance: 100, curveChordTolerance: 0.01, closed: true,
  };
  const solveHybrid = (): ReturnType<typeof computeGradingGroupFromSnapshots> =>
    computeGradingGroupFromSnapshots({
      ...base, criterion: FIXED(-0.5), memberCriteria: CRIT, target,
    });

  it('closes the shell: 4 GAP ties, 20√2 extents, ring area 9600, bounds -20..120', () => {
    const r = expectOk(solveHybrid());
    expect(r.corners).toHaveLength(4);
    r.corners.forEach((corner, j) => {
      expect(corner.classification).toBe('GAP');
      expect(corner.tiePointXyz).toEqual(TIES[j]);
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    });
    expect(r.gradingPlanArea).toBeCloseTo(9600, 9);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < r.gradingMesh.points.length; i += 3) {
      xs.push(r.gradingMesh.points[i]!);
      ys.push(r.gradingMesh.points[i + 1]!);
    }
    expect(Math.min(...xs)).toBe(-20);
    expect(Math.max(...xs)).toBe(120);
    expect(Math.min(...ys)).toBe(-20);
    expect(Math.max(...ys)).toBe(120);
    // Closed daylight ring (first/last deduped by the engine).
    expect(r.daylightPoints.length).toBeGreaterThan(0);
    expect(r.daylightPoints.length % 3).toBe(0);
    assertNoInteriorOverlap(r);
  });

  it('matches the all-Surface, all-Distance, and mixed-analytic controls', () => {
    const hybrid = expectOk(solveHybrid());
    const surface = expectOk(computeGradingGroupFromSnapshots({ ...base, criterion: FIXED(-0.5), target }));
    const distance = expectOk(computeGradingGroupFromSnapshots({ ...base, criterion: DIST(-0.5, 20) }));
    const mixed = expectOk(computeGradingGroupFromSnapshots({
      ...base,
      criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
    }));
    const ties = (r: CadGradingGroupResult): number[] =>
      r.corners.flatMap((c) => c.tiePointXyz ?? []);
    const extents = (r: CadGradingGroupResult): Array<number | undefined> =>
      r.corners.map((c) => c.miterExtent);
    for (const control of [distance, mixed]) {
      expect(ties(control)).toEqual(ties(hybrid));
      expect(extents(control)).toEqual(extents(hybrid));
      expect(control.gradingPlanArea).toBeCloseTo(hybrid.gradingPlanArea, 9);
      expect(control.grading3dArea).toBeCloseTo(hybrid.grading3dArea, 9);
      expect(control.minProjectionDistance).toBe(hybrid.minProjectionDistance);
      expect(control.maxProjectionDistance).toBe(hybrid.maxProjectionDistance);
      expect(control.meanProjectionDistance).toBe(hybrid.meanProjectionDistance);
      expect(control.gradingMesh.points).toEqual(hybrid.gradingMesh.points);
      expect(control.gradingMesh.triangles).toEqual(hybrid.gradingMesh.triangles);
      expect(digest(control)).toBe(digest(hybrid));
    }
    // All-surface control: identical shell, ties, areas, stats, and digest.
    // Its corner `miterExtent` keeps the pre-existing surface-path
    // search-bound (tMax) semantics while hybrid reports the tie distance
    // (analytic semantics), so extents and sector-segment counts are the
    // only honest differences.
    expect(ties(surface)).toEqual(ties(hybrid));
    expect(surface.gradingPlanArea).toBeCloseTo(hybrid.gradingPlanArea, 9);
    expect(surface.grading3dArea).toBeCloseTo(hybrid.grading3dArea, 9);
    expect(surface.minProjectionDistance).toBe(hybrid.minProjectionDistance);
    expect(surface.maxProjectionDistance).toBe(hybrid.maxProjectionDistance);
    expect(surface.meanProjectionDistance).toBe(hybrid.meanProjectionDistance);
    expect(surface.gradingMesh.points).toEqual(hybrid.gradingMesh.points);
    expect(surface.gradingMesh.triangles).toEqual(hybrid.gradingMesh.triangles);
    expect(digest(surface)).toBe(digest(hybrid));
    for (const corner of surface.corners) {
      expect(corner.miterExtent).toBeCloseTo(100 / (Math.SQRT1_2), 9);
    }
  });

  it('Distance-24 mismatch fails closed with TRANSITION_REQUIRED and no partial mesh', () => {
    const out = computeGradingGroupFromSnapshots({
      ...base,
      criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), DIST(-0.5, 24), ELEV(-0.5, 0), REL(-0.5, -10)],
      target,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected failure');
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.cornerIndex).toBe(0);
    expect(out.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  });

  it('is deterministic across runs', () => {
    expect(digest(expectOk(solveHybrid()))).toBe(digest(expectOk(solveHybrid())));
  });
});

describe('phase20j hybrid overlap group', () => {
  // Inside turn on the right side: +x incoming, −y outgoing.
  const members = [M(0, 0, 100, 60, 0, 100), M(60, 0, 100, 60, -60, 100)];
  const solve = (): ReturnType<typeof computeGradingGroupFromSnapshots> =>
    computeGradingGroupFromSnapshots({
      groupId: 'ov', revision: 'r', members,
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
      maxSearchDistance: 100, curveChordTolerance: 0.01, closed: false,
      target: flatGrid(90, -100, 100),
    });

  it('trims to the exact tie (20,-20,90) with no interior overlap', () => {
    const r = expectOk(solve());
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.classification).toBe('OVERLAP');
    expect(r.corners[0]!.tiePointXyz).toEqual([20, -20, 90]);
    expect(r.corners[0]!.miterExtent).toBeCloseTo(Math.sqrt(2000), 9);
    // The tie is retained exactly once on the corner run; the joined
    // boundary passes through it within zeroDelta (the shared join treats
    // the 4e-15 seam neighbours as the same vertex).
    const run = r.corners[0]!.daylightPoints!;
    let runHits = 0;
    for (let i = 0; i + 2 < run.length; i += 3) {
      if (run[i] === 20 && run[i + 1] === -20 && run[i + 2] === 90) runHits += 1;
    }
    expect(runHits).toBe(1);
    const flat = r.daylightPoints;
    let near = Infinity;
    for (let i = 0; i + 2 < flat.length; i += 3) {
      near = Math.min(near, Math.hypot(flat[i]! - 20, flat[i + 1]! + 20, flat[i + 2]! - 90));
    }
    expect(near).toBeLessThanOrEqual(1e-12);
    assertNoInteriorOverlap(r);
  });

  it('is deterministic across runs', () => {
    expect(digest(expectOk(solve()))).toBe(digest(expectOk(solve())));
  });
});
