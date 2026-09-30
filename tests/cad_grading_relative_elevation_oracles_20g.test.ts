/**
 * Phase 20G — numerical oracles for Grade-to-Relative-Elevation.
 *
 * Round-off-independent expectations for the target-free relative-elevation
 * criterion: `limitZ(u) = Zsrc(u) + Δ`, derived horizontal distance
 * `d = Δ/g` constant along a straight or curved source, fail-closed
 * wrong-direction/over-search/zero gates, the absolute-vs-relative
 * distinction, Distance equivalence, large-coordinate stability, the
 * 100x100 closed-pad oracle, arc convergence, determinism, and sparse
 * same-family group overrides. Complements (does not duplicate)
 * `cad_grading_relative_elevation_20g` and
 * `cad_grading_group_relative_elevation_20g`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { validateGradingCriterion } from '../src/engine/cad/grading/gradingAuthoring';
import {
  canonicalCourseCriteria,
  criteriaEqual,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { validateGroupTerminationCriteria } from '../src/engine/cad/grading/gradingGroupTermination';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  CadGradingGroup,
  GradingGroupCourse,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const source = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  sz: number,
  ez: number,
): GradingComputeSource => ({
  startX: sx,
  startY: sy,
  endX: ex,
  endY: ey,
  startZ: sz,
  endZ: ez,
  length: Math.hypot(ex - sx, ey - sy),
  reoriented: false,
  isArc: false,
});

const straight = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  sz = 10,
  ez = 10,
): ResolvedGradingSource => ({
  startX: sx,
  startY: sy,
  endX: ex,
  endY: ey,
  startZ: sz,
  endZ: ez,
  length: Math.hypot(ex - sx, ey - sy),
  reoriented: false,
  isArc: false,
});

/** CCW 100x100 square at Z=10; `side: 'right'` grades outward. */
const square = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0),
  straight(100, 0, 100, 100),
  straight(100, 100, 0, 100),
  straight(0, 100, 0, 0),
];

const shoelace = (flat: number[]): number => {
  const n = flat.length / 3;
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    area += flat[i * 3]! * flat[j * 3 + 1]! - flat[j * 3]! * flat[i * 3 + 1]!;
  }
  return Math.abs(area) / 2;
};

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const solve = (
  src: GradingComputeSource,
  criterion: GradingCriterion,
  maxSearchDistance = 1000,
) => solveAnalyticGradingChord({ source: src, side: 'right', criterion, maxSearchDistance });

const REL = (gradeRatio: number, relativeElevation: number): GradingCriterion => ({
  kind: 'relative-elevation',
  gradeRatio,
  relativeElevation,
});

// ---------------------------------------------------------------------------
// A — level straight source
// ---------------------------------------------------------------------------
describe('(A) level straight source', () => {
  it('g=-0.5 Δ=-10 → d=20 at both ends, limit Z=90, area 2000, EXACT', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(-0.5, -10));
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.daylightFlat).toEqual([0, -20, 90, 100, -20, 90]);
    expect(out.solve.distances).toEqual([20, 20]);

    const computed = computeGradingFromSnapshots({
      gradingId: 'a',
      revision: 'r',
      source: source(0, 0, 100, 0, 100, 100),
      side: 'right',
      criterion: REL(-0.5, -10),
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    if (!computed.ok) throw new Error(computed.code);
    expect(computed.result.accuracy).toBe('EXACT');
    expect(computed.result.gradingPlanArea).toBeCloseTo(2000, 9);
    expect(computed.result.minProjectionDistance).toBe(20);
    expect(computed.result.maxProjectionDistance).toBe(20);
    expect(computed.result.meanProjectionDistance).toBe(20);
    expect(computed.result.regions).toEqual([
      { classification: 'FIXED', stationSpan: [0, 100] },
    ]);
    expect(computed.result.cutSourceLength).toBe(0);
    expect(computed.result.fillSourceLength).toBe(0);
    expect(computed.result.tiedSourceLength).toBe(0);
    expect(computed.result.candidateTriangleCount).toBe(0);
    expect(computed.result.intersectionSegmentCount).toBe(0);
    expect(computed.result.multipleSolutionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B — sloped straight source
// ---------------------------------------------------------------------------
describe('(B) sloped straight source', () => {
  it('limit is vertically parallel to the source: Z 90 -> 92, d stays 20', () => {
    const out = solve(source(0, 0, 100, 0, 100, 102), REL(-0.5, -10));
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.daylightFlat).toEqual([0, -20, 90, 100, -20, 92]);
    expect(out.solve.distances).toEqual([20, 20]);

    const computed = computeGradingFromSnapshots({
      gradingId: 'b',
      revision: 'r',
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion: REL(-0.5, -10),
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    if (!computed.ok) throw new Error(computed.code);
    // The limit is NOT globally level: it rides the 2% source grade.
    expect(computed.result.gradingPlanArea).toBeCloseTo(2000, 9);
    expect(computed.result.minProjectionDistance).toBe(20);
    expect(computed.result.maxProjectionDistance).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// C — Distance equivalence
// ---------------------------------------------------------------------------
describe('(C) Distance equivalence', () => {
  it('Δ=-10 with g=-0.5 is geometry-identical to D=20 with g=-0.5', () => {
    const src = source(0, 0, 100, 0, 100, 102);
    const relative = solve(src, REL(-0.5, -10));
    const distance = solve(src, { kind: 'distance', gradeRatio: -0.5, distance: 20 });
    if (!relative.ok || !distance.ok) throw new Error('equivalence solve failed');
    expect(relative.solve.daylightFlat).toEqual(distance.solve.daylightFlat);
    expect(relative.solve.distances).toEqual(distance.solve.distances);
    expect(relative.solve.nodeStations).toEqual(distance.solve.nodeStations);
    expect(relative.solve.sourcePts).toEqual(distance.solve.sourcePts);
    expect(relative.solve.regions).toEqual(distance.solve.regions);
    expect(relative.solve.diagnostics).toEqual(distance.solve.diagnostics);
    expect(relative.solve.candidateTriangleCount).toBe(distance.solve.candidateTriangleCount);
    expect(relative.solve.intersectionSegmentCount).toBe(distance.solve.intersectionSegmentCount);
    expect(relative.solve.multipleSolutionCount).toBe(distance.solve.multipleSolutionCount);

    const rel = computeGradingFromSnapshots({
      gradingId: 'c',
      revision: 'r',
      source: src,
      side: 'right',
      criterion: REL(-0.5, -10),
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    const dist = computeGradingFromSnapshots({
      gradingId: 'c',
      revision: 'r',
      source: src,
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    if (!rel.ok || !dist.ok) throw new Error('equivalence compute failed');
    // Identical mesh, points, triangles, projection stats and diagnostics.
    expect(rel.result.gradingMesh.points).toEqual(dist.result.gradingMesh.points);
    expect(rel.result.gradingMesh.triangles).toEqual(dist.result.gradingMesh.triangles);
    expect(rel.result.daylightPoints).toEqual(dist.result.daylightPoints);
    expect(rel.result.gradingPlanArea).toBe(dist.result.gradingPlanArea);
    expect(rel.result.grading3dArea).toBe(dist.result.grading3dArea);
    expect(rel.result.minProjectionDistance).toBe(dist.result.minProjectionDistance);
    expect(rel.result.maxProjectionDistance).toBe(dist.result.maxProjectionDistance);
    expect(rel.result.meanProjectionDistance).toBe(dist.result.meanProjectionDistance);
    expect(rel.result.diagnostics).toEqual(dist.result.diagnostics);
    expect(rel.result.accuracy).toBe(dist.result.accuracy);
  });
});

// ---------------------------------------------------------------------------
// D — absolute Elevation NON-equivalence
// ---------------------------------------------------------------------------
describe('(D) absolute Elevation is NOT relative Elevation', () => {
  it('sloped source: relative keeps d=20 and a sloping limit; absolute grows to d=24 on one level', () => {
    const src = source(0, 0, 100, 0, 100, 102);
    const relative = solve(src, REL(-0.5, -10));
    const absolute = solve(src, { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 });
    if (!relative.ok || !absolute.ok) throw new Error('distinction solve failed');

    // Relative: constant 20 m plan offset, limit Z = 90 -> 92.
    expect(relative.solve.distances).toEqual([20, 20]);
    expect(relative.solve.daylightFlat).toEqual([0, -20, 90, 100, -20, 92]);

    // Absolute: one fixed global elevation 90, so d varies (20 -> 24).
    expect(absolute.solve.distances).toEqual([20, 24]);
    expect(absolute.solve.daylightFlat).toEqual([0, -20, 90, 100, -24, 90]);

    expect(relative.solve.daylightFlat).not.toEqual(absolute.solve.daylightFlat);
    const relArea = computeGradingFromSnapshots({
      gradingId: 'd', revision: 'r', source: src, side: 'right',
      criterion: REL(-0.5, -10), maxSearchDistance: 1000, curveChordTolerance: 0.01,
    });
    const absArea = computeGradingFromSnapshots({
      gradingId: 'd', revision: 'r', source: src, side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 },
      maxSearchDistance: 1000, curveChordTolerance: 0.01,
    });
    if (!relArea.ok || !absArea.ok) throw new Error('distinction compute failed');
    expect(relArea.result.gradingPlanArea).toBeCloseTo(2000, 9);
    expect(absArea.result.gradingPlanArea).toBeCloseTo(2200, 9);
    expect(Math.abs(relArea.result.gradingPlanArea - absArea.result.gradingPlanArea)).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// E — wrong direction fails closed
// ---------------------------------------------------------------------------
describe('(E) wrong direction fails closed', () => {
  it('g=+0.5 with Δ=-10 gives d=-20 → NO_SOLUTION / wrong direction', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(0.5, -10));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected NO_SOLUTION');
    expect(out.code).toBe('NO_SOLUTION');
    expect(out.detail).toBe('GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION');
  });

  it('mirrored pair g=-0.5 Δ=+10 also fails closed (never averaged or negated)', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(-0.5, 10));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected NO_SOLUTION');
    expect(out.code).toBe('NO_SOLUTION');
    expect(out.detail).toBe('GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION');
  });
});

// ---------------------------------------------------------------------------
// F — upward grading is valid
// ---------------------------------------------------------------------------
describe('(F) upward grading', () => {
  it('g=+0.5 Δ=+10 → d=20, limit 10 m above the source', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(0.5, 10));
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.distances).toEqual([20, 20]);
    expect(out.solve.daylightFlat).toEqual([0, -20, 110, 100, -20, 110]);
    const computed = computeGradingFromSnapshots({
      gradingId: 'f', revision: 'r', source: source(0, 0, 100, 0, 100, 100), side: 'right',
      criterion: REL(0.5, 10), maxSearchDistance: 1000, curveChordTolerance: 0.01,
    });
    if (!computed.ok) throw new Error(computed.code);
    expect(computed.result.gradingPlanArea).toBeCloseTo(2000, 9);
    expect(computed.result.minProjectionDistance).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// G — over-search fails without clamping
// ---------------------------------------------------------------------------
describe('(G) over-search', () => {
  it('d=40 > maxSearchDistance 30 → MAX_DISTANCE_REACHED, never clamped', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(-0.5, -20), 30);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected MAX_DISTANCE_REACHED');
    expect(out.code).toBe('MAX_DISTANCE_REACHED');
    expect(out.detail).toBe('GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH');
  });

  it('exactly at the limit is accepted (no off-by-one)', () => {
    const out = solve(source(0, 0, 100, 0, 100, 100), REL(-0.5, -15), 30);
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.distances).toEqual([30, 30]);
  });
});

// ---------------------------------------------------------------------------
// H — zero / malformed inputs fail closed
// ---------------------------------------------------------------------------
describe('(H) zero and malformed criteria', () => {
  it('authoring rejects zero grade, zero Δ, non-finite values', () => {
    expect(validateGradingCriterion(REL(0, -10))).not.toBeNull();
    expect(validateGradingCriterion(REL(-0.5, 0))).not.toBeNull();
    expect(validateGradingCriterion(REL(Number.NaN, -10))).not.toBeNull();
    expect(validateGradingCriterion(REL(Number.POSITIVE_INFINITY, -10))).not.toBeNull();
    expect(validateGradingCriterion(REL(-0.5, Number.NaN))).not.toBeNull();
    expect(validateGradingCriterion(REL(-0.5, Number.POSITIVE_INFINITY))).not.toBeNull();
    expect(validateGradingCriterion(REL(-0.5, -10))).toBeNull();
    expect(validateGradingCriterion(REL(0.5, 10))).toBeNull();
  });

  it('kernel reports GRADING_BAD_CRITERION for zero/malformed input', () => {
    for (const criterion of [REL(0, -10), REL(-0.5, 0), REL(Number.NaN, -10), REL(-0.5, Number.NaN)]) {
      const out = solve(source(0, 0, 100, 0, 100, 100), criterion);
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('expected NO_SOLUTION');
      expect(out.code).toBe('NO_SOLUTION');
      expect(out.detail).toBe('GRADING_BAD_CRITERION');
    }
  });

  it('structural criterion equality is exact (no tolerance)', () => {
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.5, -10))).toBe(true);
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.5, -10.000000001))).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.500000001, -10))).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), { kind: 'distance', gradeRatio: -0.5, distance: 20 })).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 })).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), { kind: 'fixed', gradeRatio: -0.5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I — large projected coordinates
// ---------------------------------------------------------------------------
describe('(I) large coordinates', () => {
  it('E ~ 2,000,000 / N ~ 7,000,000 agrees with a local origin to < 1e-6 m', () => {
    const dx = 2_000_000;
    const dy = 7_000_000;
    const criterion = REL(-0.5, -10);
    const local = solve(source(0, 0, 100, 0, 100, 102), criterion);
    const shifted = solve(source(dx, dy, dx + 100, dy, 100, 102), criterion);
    if (!local.ok || !shifted.ok) throw new Error('large-coordinate solve failed');
    let maxDiff = 0;
    for (let i = 0; i < 6; i += 1) {
      const origin = i % 3 === 0 ? dx : i % 3 === 1 ? dy : 0;
      maxDiff = Math.max(
        maxDiff,
        Math.abs(shifted.solve.daylightFlat[i]! - origin - local.solve.daylightFlat[i]!),
      );
    }
    expect(maxDiff).toBeLessThan(1e-6);
    expect(shifted.solve.distances).toEqual(local.solve.distances);
  });
});

// ---------------------------------------------------------------------------
// J — closed 100x100 pad oracle
// ---------------------------------------------------------------------------
describe('(J) closed 100x100 Relative Elevation pad', () => {
  const solveGroup = (criterion: GradingCriterion) =>
    computeGradingGroupFromSnapshots({
      groupId: 'j',
      revision: 'r',
      members: square(),
      side: 'right',
      criterion,
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });

  it('d=20 outward: outer 140x140, mitre 20√2, areas 10000/19600/9600, limit Z=0', () => {
    const out = solveGroup(REL(-0.5, -10));
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    const r = out.result;
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(shoelace(r.sourceBoundaryPoints!)).toBeCloseTo(10000, 6);
    expect(shoelace(r.daylightPoints)).toBeCloseTo(19600, 6);

    // Outer bounding box is exactly 140 x 140.
    const xs = r.daylightPoints.filter((_, i) => i % 3 === 0);
    const ys = r.daylightPoints.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-20, 9);
    expect(Math.max(...xs)).toBeCloseTo(120, 9);
    expect(Math.min(...ys)).toBeCloseTo(-20, 9);
    expect(Math.max(...ys)).toBeCloseTo(120, 9);

    // Produced from real triangles, not only an area figure.
    expect(r.gradingMesh.points.length).toBeGreaterThan(0);
    expect(r.gradingMesh.triangles.length).toBeGreaterThan(0);

    // Four GAP corners, each with the exact analytic miter extent 20√2.
    expect(r.corners).toHaveLength(4);
    const ties = r.corners.map((c) => c.tiePointXyz!.map((v) => Math.round(v * 1e6) / 1e6));
    expect(new Set(ties.map((t) => t.join(',')))).toEqual(
      new Set(['120,-20,0', '120,120,0', '-20,120,0', '-20,-20,0']),
    );
    for (const corner of r.corners) {
      expect(corner.classification).toBe('GAP');
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    }

    // Limit Z = source Z (10) - 10 = 0 on every limit vertex.
    const zs = r.daylightPoints.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0, 9);
    expect(Math.max(...zs)).toBeCloseTo(0, 9);

    // Projection stats are honest.
    expect(r.minProjectionDistance).toBeCloseTo(20, 9);
    expect(r.maxProjectionDistance).toBeCloseTo(20, 9);
  });

  it('matches Distance 20 m and absolute Elevation 0 m on this flat source exactly', () => {
    const relative = solveGroup(REL(-0.5, -10));
    const distance = solveGroup({ kind: 'distance', gradeRatio: -0.5, distance: 20 });
    const elevation = solveGroup({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 });
    if (!relative.ok || !distance.ok || !elevation.ok) throw new Error('closed-group solve failed');
    const tiesOf = (r: typeof relative.result): string[] =>
      r.corners.map((c) => c.tiePointXyz!.join(',')).sort();
    expect(tiesOf(relative.result)).toEqual(tiesOf(distance.result));
    expect(tiesOf(relative.result)).toEqual(tiesOf(elevation.result));
    expect(digest(relative.result.daylightPoints)).toBe(digest(distance.result.daylightPoints));
    expect(digest(relative.result.gradingMesh)).toBe(digest(distance.result.gradingMesh));
    expect(digest(relative.result.gradingMesh)).toBe(digest(elevation.result.gradingMesh));
    expect(relative.result.gradingPlanArea).toBe(distance.result.gradingPlanArea);
    expect(relative.result.grading3dArea).toBe(distance.result.grading3dArea);
  });
});

// ---------------------------------------------------------------------------
// K — arc convergence
// ---------------------------------------------------------------------------
describe('(K) arc convergence', () => {
  const R = 100;
  const sweep = Math.PI / 2;
  const arcMember = (): ResolvedGradingSource => ({
    startX: R,
    startY: 0,
    endX: 0,
    endY: R,
    startZ: 10,
    endZ: 10,
    length: R * sweep,
    reoriented: false,
    isArc: true,
    arc: { centerX: 0, centerY: 0, radius: R, startAngle: 0, endAngle: sweep, sweepCCW: true },
  });

  const radialError = (flat: number[], target: number): number => {
    let max = 0;
    for (let i = 0; i < flat.length; i += 3) {
      max = Math.max(max, Math.abs(Math.hypot(flat[i]!, flat[i + 1]!) - target));
    }
    return max;
  };

  it('source stays on R=100; limit converges to R±20 with d=20 and Zlimit=Zsrc-10', () => {
    const tolerances = [1, 0.1, 0.01];
    for (const side of ['right', 'left'] as const) {
      const target = side === 'right' ? R + 20 : R - 20;
      const errors: number[] = [];
      let previousVerts = 0;
      for (const tolerance of tolerances) {
        const out = computeGradingGroupFromSnapshots({
          groupId: 'k',
          revision: 'r',
          members: [arcMember()],
          side,
          criterion: REL(-0.5, -10),
          maxSearchDistance: 50,
          curveChordTolerance: tolerance,
          closed: false,
        });
        if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
        const r = out.result;
        expect(r.accuracy).toBe('CURVE_APPROXIMATED');
        // Source discretization stays on the exact arc (no smoothing/spline).
        expect(radialError(r.sourceBoundaryPoints!, R)).toBeLessThan(1e-9);
        // Constant derived offset: no branch jumps in the projection distance.
        expect(r.minProjectionDistance).toBe(20);
        expect(r.maxProjectionDistance).toBe(20);
        // limit Z = Zsrc - Δ with a level source.
        const zs = r.daylightPoints.filter((_, i) => i % 3 === 2);
        expect(Math.min(...zs)).toBeCloseTo(0, 9);
        expect(Math.max(...zs)).toBeCloseTo(0, 9);
        const verts = r.gradingMesh.points.length / 3;
        expect(verts).toBeGreaterThan(previousVerts);
        previousVerts = verts;
        errors.push(radialError(r.daylightPoints, target));
      }
      expect(errors[1]!).toBeLessThan(errors[0]!);
      expect(errors[2]!).toBeLessThan(errors[1]!);
      expect(errors[2]!).toBeLessThan(0.01);
    }
  });

  it('subdivision count is controlled by curveChordTolerance', () => {
    const subdivisions = [1, 0.1, 0.01].map(
      (tolerance) => linearizeGradingArc(0, 0, R, 0, sweep, true, 10, 10, tolerance)!.subdivisions,
    );
    expect(subdivisions[0]!).toBeLessThan(subdivisions[1]!);
    expect(subdivisions[1]!).toBeLessThan(subdivisions[2]!);
  });
});

// ---------------------------------------------------------------------------
// L — determinism
// ---------------------------------------------------------------------------
describe('(L) determinism', () => {
  it('repeat standalone and group calculations produce identical digests', () => {
    const run = (): unknown =>
      solveAnalyticGradingChord({
        source: source(0, 0, 100, 0, 100, 102),
        side: 'right',
        criterion: REL(-0.5, -10),
        maxSearchDistance: 1000,
      });
    expect(digest(run())).toBe(digest(run()));

    const runGroup = (): unknown =>
      computeGradingGroupFromSnapshots({
        groupId: 'l',
        revision: 'r',
        members: square(),
        side: 'right',
        criterion: REL(-0.5, -10),
        maxSearchDistance: 50,
        curveChordTolerance: 0.05,
        closed: true,
      });
    expect(digest(runGroup())).toBe(digest(runGroup()));

    const runComputed = (): unknown =>
      computeGradingFromSnapshots({
        gradingId: 'l',
        revision: 'r',
        source: source(0, 0, 100, 0, 100, 102),
        side: 'right',
        criterion: REL(-0.5, -10),
        maxSearchDistance: 1000,
        curveChordTolerance: 0.01,
      });
    expect(digest(runComputed())).toBe(digest(runComputed()));
  });
});

// ---------------------------------------------------------------------------
// M — sparse same-family group overrides
// ---------------------------------------------------------------------------
describe('(M) Relative Elevation group overrides', () => {
  const courses: GradingGroupCourse[] = [
    { vertexAId: 'a', vertexBId: 'b' },
    { vertexAId: 'b', vertexBId: 'c' },
    { vertexAId: 'c', vertexBId: 'd' },
    { vertexAId: 'd', vertexBId: 'a' },
  ];

  const groupWith = (
    courseCriteria: CadGradingGroup['courseCriteria'],
  ): CadGradingGroup => ({
    id: 'm',
    name: 'm',
    sourceFeatureLineId: 'fl',
    sourceCourses: courses,
    side: 'right',
    criterion: REL(-0.5, -10),
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    cornerMode: 'miter',
    closed: true,
    ...(courseCriteria !== undefined ? { courseCriteria } : {}),
  });

  it('a same-family override is kept; an exact-equal override is dropped (sparse)', () => {
    const differing: CadGradingGroup['courseCriteria'] = [
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: REL(-0.5, -12) },
    ];
    expect(canonicalCourseCriteria(groupWith(differing))).toHaveLength(1);

    const equal: CadGradingGroup['courseCriteria'] = [
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: REL(-0.5, -10) },
    ];
    expect(canonicalCourseCriteria(groupWith(equal))).toEqual([]);
  });

  it('no default materialization: an override-free group resolves to the default only', () => {
    const bare = groupWith(undefined);
    expect(canonicalCourseCriteria(bare)).toEqual([]);
    expect(resolveGroupMemberCriteria(bare)).toEqual([REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10)]);
  });

  it('valid compatible corners: uniform per-course Relative Elevation solves 140x140', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'm',
      revision: 'r',
      members: square(),
      side: 'right',
      criterion: REL(-0.5, -10),
      memberCriteria: [REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10)],
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    expect(out.result.gradingPlanArea).toBeCloseTo(9600, 6);
    for (const corner of out.result.corners) {
      expect(corner.classification).toBe('GAP');
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    }
  });

  it('incompatible corners fail closed (differing Δ is never averaged or bridged)', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'm',
      revision: 'r',
      members: square(),
      side: 'right',
      criterion: REL(-0.5, -10),
      memberCriteria: [REL(-0.5, -10), REL(-0.5, -12), REL(-0.5, -10), REL(-0.5, -10)],
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected CORNER_NO_SOLUTION');
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });

  it('analytic mixes and surface hybrids are accepted (20J)', () => {
    // Phase 20H: Distance/Elevation/Relative Elevation mix freely in one group.
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [
      REL(-0.5, -10),
      { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 },
    ])).toBeNull();
    // Phase 20J: surface + analytic is a legal hybrid (exact-common-tie).
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [{ kind: 'fixed', gradeRatio: -0.5 }])).toBeNull();
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [REL(-0.5, -12), REL(0.5, 10)])).toBeNull();
  });
});
