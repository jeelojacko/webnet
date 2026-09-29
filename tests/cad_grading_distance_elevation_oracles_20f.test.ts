/**
 * Phase 20F — numerical oracles for target-free (analytic) grading.
 *
 * Closed-form expectations for Grade-to-Distance / Grade-to-Elevation:
 * exact daylight offsets and elevations on straight courses, fail-closed
 * search/wrong-direction gates, large-coordinate stability, closed-group
 * miter geometry matching the analytic limit polygon, arc convergence, and
 * repeat-calc determinism. Complements the routing/persistence suites
 * (`cad_grading_analytic_20f`, `cad_grading_distance_elevation_20f`,
 * `cad_grading_group_analytic_20f`) — no overlap.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

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

/** CCW 100x100 square; `side: 'right'` grades outward. */
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

describe('(A) distance level source', () => {
  it('offset 20, elev 90, plan area 2000 — EXACT', () => {
    const out = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 100),
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
    });
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.daylightFlat).toEqual([0, -20, 90, 100, -20, 90]);
    expect(out.solve.distances).toEqual([20, 20]);

    const computed = computeGradingFromSnapshots({
      gradingId: 'a',
      revision: 'r',
      source: source(0, 0, 100, 0, 100, 100),
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    if (!computed.ok) throw new Error(computed.code);
    expect(computed.result.accuracy).toBe('EXACT');
    expect(computed.result.gradingPlanArea).toBeCloseTo(2000, 9);
    expect(computed.result.minProjectionDistance).toBe(20);
    expect(computed.result.maxProjectionDistance).toBe(20);
    expect(computed.result.meanProjectionDistance).toBe(20);
  });
});

describe('(B) distance sloped source', () => {
  it('limit follows the source grade: 90 -> 92', () => {
    const out = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
    });
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.daylightFlat).toEqual([0, -20, 90, 100, -20, 92]);
    expect(out.solve.distances).toEqual([20, 20]);
  });
});

describe('(C) elevation 100 -> 102', () => {
  it('d = 20/40, limit Z = 98, plan area 3000', () => {
    const out = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.1, targetElevation: 98 },
      maxSearchDistance: 1000,
    });
    if (!out.ok) throw new Error(out.code);
    expect(out.solve.distances).toEqual([20, 40]);
    expect(out.solve.daylightFlat[2]).toBe(98);
    expect(out.solve.daylightFlat[5]).toBe(98);

    const computed = computeGradingFromSnapshots({
      gradingId: 'c',
      revision: 'r',
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.1, targetElevation: 98 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    if (!computed.ok) throw new Error(computed.code);
    expect(computed.result.gradingPlanArea).toBeCloseTo(3000, 9);
    expect(computed.result.minProjectionDistance).toBe(20);
    expect(computed.result.maxProjectionDistance).toBe(40);
  });
});

describe('(D) elevation over-search', () => {
  it('d = 40 > maxSearchDistance 30 -> MAX_DISTANCE_REACHED (never clamped)', () => {
    const out = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.1, targetElevation: 98 },
      maxSearchDistance: 30,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected MAX_DISTANCE_REACHED');
    expect(out.code).toBe('MAX_DISTANCE_REACHED');
    expect(out.detail).toBe('GRADING_ELEVATION_BEYOND_SEARCH');
  });
});

describe('(E) wrong direction fails closed', () => {
  it('positive grade with target below source -> d < 0 -> NO_SOLUTION', () => {
    const out = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 100),
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: 0.1, targetElevation: 98 },
      maxSearchDistance: 1000,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected NO_SOLUTION');
    expect(out.code).toBe('NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ELEVATION_WRONG_DIRECTION');
  });
});

describe('(F) large coordinates', () => {
  it('E ~ 2,000,000 N ~ 7,000,000 agrees with a local origin', () => {
    const dx = 2_000_000;
    const dy = 7_000_000;
    const criterion = { kind: 'distance', gradeRatio: -0.5, distance: 20 } as const;
    const local = solveAnalyticGradingChord({
      source: source(0, 0, 100, 0, 100, 102),
      side: 'right',
      criterion,
      maxSearchDistance: 1000,
    });
    const shifted = solveAnalyticGradingChord({
      source: source(dx, dy, dx + 100, dy, 100, 102),
      side: 'right',
      criterion,
      maxSearchDistance: 1000,
    });
    if (!local.ok || !shifted.ok) throw new Error('large-coordinate solve failed');
    let maxDiff = 0;
    for (let i = 0; i < 6; i += 1) {
      const origin = i % 3 === 0 ? dx : i % 3 === 1 ? dy : 0;
      maxDiff = Math.max(maxDiff, Math.abs(shifted.solve.daylightFlat[i]! - origin - local.solve.daylightFlat[i]!));
    }
    expect(maxDiff).toBeLessThan(1e-6);
    expect(shifted.solve.distances).toEqual(local.solve.distances);
  });
});

describe('(G) closed flat 100x100 square', () => {
  const solve = (criterion: Parameters<typeof computeGradingGroupFromSnapshots>[0]['criterion']) =>
    computeGradingGroupFromSnapshots({
      groupId: 'g',
      revision: 'r',
      members: square(),
      side: 'right',
      criterion,
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });

  it('outer limit 140x140, mitre 20√2, areas 10000/19600/9600', () => {
    const out = solve({ kind: 'distance', gradeRatio: -0.5, distance: 20 });
    if (!out.ok) throw new Error(out.code);
    const r = out.result;
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(shoelace(r.sourceBoundaryPoints!)).toBeCloseTo(10000, 6);
    expect(shoelace(r.daylightPoints)).toBeCloseTo(19600, 6);
    const ties = r.corners.map((c) => c.tiePointXyz!.map((v) => Math.round(v * 1e6) / 1e6));
    expect(new Set(ties.map((t) => t.join(',')))).toEqual(
      new Set(['120,-20,0', '120,120,0', '-20,120,0', '-20,-20,0']),
    );
    for (const corner of r.corners) {
      expect(corner.classification).toBe('GAP');
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    }
  });

  it('elevation E = 0, g = -0.5 (d = 20) agrees geometrically', () => {
    const distance = solve({ kind: 'distance', gradeRatio: -0.5, distance: 20 });
    const elevation = solve({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 });
    if (!distance.ok || !elevation.ok) throw new Error('closed-group solve failed');
    expect(elevation.result.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(shoelace(elevation.result.daylightPoints)).toBeCloseTo(19600, 6);
    const tiesOf = (r: typeof elevation.result): string[] =>
      r.corners.map((c) => c.tiePointXyz!.join(',')).sort();
    expect(tiesOf(elevation.result)).toEqual(tiesOf(distance.result));
    expect(Math.min(...elevation.result.daylightPoints.filter((_, i) => i % 3 === 2))).toBeCloseTo(0, 9);
  });
});

describe('(H) arc convergence on the analytic offset', () => {
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

  it('coarse/med/fine: source on arc, concentric offset R±D, monotone convergence', () => {
    const tolerances = [1, 0.1, 0.01];
    const subdivisions = tolerances.map((tolerance) =>
      linearizeGradingArc(0, 0, R, 0, sweep, true, 10, 10, tolerance)!.subdivisions,
    );
    expect(subdivisions[0]!).toBeLessThan(subdivisions[1]!);
    expect(subdivisions[1]!).toBeLessThan(subdivisions[2]!);

    for (const side of ['right', 'left'] as const) {
      const target = side === 'right' ? R + 20 : R - 20;
      const errors: number[] = [];
      let previousVerts = 0;
      for (const tolerance of tolerances) {
        const out = computeGradingGroupFromSnapshots({
          groupId: 'h',
          revision: 'r',
          members: [arcMember()],
          side,
          criterion: { kind: 'distance', gradeRatio: 0, distance: 20 },
          maxSearchDistance: 50,
          curveChordTolerance: tolerance,
          closed: false,
        });
        if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
        const r = out.result;
        expect(r.accuracy).toBe('CURVE_APPROXIMATED');
        expect(r.diagnostics.map((d) => d.code)).toContain('CURVE_CORNER_APPROXIMATED');
        // Exact source discretization stays on the true arc.
        expect(radialError(r.sourceBoundaryPoints!, R)).toBeLessThan(1e-9);
        // Constant offset: no branch jumps in the projection distance.
        expect(r.minProjectionDistance).toBe(20);
        expect(r.maxProjectionDistance).toBe(20);
        // Limit Z rides the source grade (level here) exactly.
        const zs = r.daylightPoints.filter((_, i) => i % 3 === 2);
        expect(Math.min(...zs)).toBeCloseTo(10, 9);
        expect(Math.max(...zs)).toBeCloseTo(10, 9);
        const verts = r.gradingMesh.points.length / 3;
        expect(verts).toBeGreaterThan(previousVerts);
        previousVerts = verts;
        errors.push(radialError(r.daylightPoints, target));
      }
      // Concentric limit is approached monotonically as the chord error shrinks.
      expect(errors[1]!).toBeLessThan(errors[0]!);
      expect(errors[2]!).toBeLessThan(errors[1]!);
      expect(errors[2]!).toBeLessThan(0.01);
    }
  });
});

describe('(I) determinism', () => {
  it('repeat calc produces an identical digest', () => {
    const runChord = (): unknown =>
      solveAnalyticGradingChord({
        source: source(0, 0, 100, 0, 100, 102),
        side: 'right',
        criterion: { kind: 'elevation', gradeRatio: -0.1, targetElevation: 98 },
        maxSearchDistance: 1000,
      });
    expect(digest(runChord())).toBe(digest(runChord()));

    const runGroup = (): unknown =>
      computeGradingGroupFromSnapshots({
        groupId: 'i',
        revision: 'r',
        members: square(),
        side: 'right',
        criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
        maxSearchDistance: 50,
        curveChordTolerance: 0.05,
        closed: true,
      });
    expect(digest(runGroup())).toBe(digest(runGroup()));
  });
});
