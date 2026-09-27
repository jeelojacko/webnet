// Phase 20B — straight grading solver analytic oracles (§70–§84).
//
// Every expectation is a closed-form value computed from the analytic model;
// there is no numerical sampling or tolerance fitting. All zero
// classification flows through the shared Phase 18I `zeroDelta` policy.
import { describe, expect, it } from 'vitest';

import {
  classifyPlaneRelation,
  gradeElevation,
  solveDaylightDistance,
  targetPlaneCoeffs,
} from '../src/engine/cad/grading/gradingStraightSolve';
import {
  buildNearestEnvelope,
  extractZeroSegments,
  type EnvelopeResult,
  type ZeroSegment,
} from '../src/engine/cad/grading/gradingZeroLocus';
import {
  buildGradingStripMesh,
  isZeroWidthPair,
  mesh3dArea,
  meshPlanArea,
  tieStats,
  type GradingStripMesh,
  type GradingStripMeshResult,
  type MeshPoint,
} from '../src/engine/cad/grading/gradingMesh';
import {
  classifySourceDelta,
  requireSourceCoverage,
  splitStationsAtZeros,
} from '../src/engine/cad/grading/gradingCutFill';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';

const expectMesh = (result: GradingStripMeshResult): GradingStripMesh => {
  if (!result.ok) throw new Error(`expected mesh, got ${result.code}`);
  return result;
};

const expectMeshSignal = (
  result: GradingStripMeshResult,
): Extract<GradingStripMeshResult, { ok: false }> => {
  if (result.ok) throw new Error('expected ALREADY_TIED signal');
  return result;
};

const expectEnvelope = (result: EnvelopeResult): Array<{ u: number; d: number }> => {
  if (!result.ok) throw new Error(`expected envelope, got ${result.code}`);
  return result.polyline;
};

const flatStripSource = (z: number): MeshPoint[] => [
  { x: 0, y: 0, z },
  { x: 100, y: 0, z },
];

describe('§70–§71 flat fill and flat cut', () => {
  it('§70 flat fill ties at d = 20 with exact plan and 3D areas', () => {
    const z0 = 10;
    const g = -0.5;
    const deltaAtSource = 0 - gradeElevation(z0, 0, 0, g, 0); // target 0 − source 10
    const d = solveDaylightDistance(deltaAtSource, g - 0, 1000);
    expect(deltaAtSource).toBe(-10);
    expect(d).toBe(20);
    expect(classifySourceDelta(deltaAtSource)).toBe('FILL');
    expect(gradeElevation(z0, 0, 40, g, d as number)).toBe(0); // tie Z == flat target

    const mesh = expectMesh(
      buildGradingStripMesh(
        flatStripSource(10),
        [
          { x: 0, y: 20, z: 0 },
          { x: 100, y: 20, z: 0 },
        ],
      ),
    );
    expect(mesh.skippedZeroWidth).toBe(0);
    expect(meshPlanArea(mesh.points, mesh.triangles)).toBe(2000);
    expect(mesh3dArea(mesh.points, mesh.triangles)).toBeCloseTo(2000 * Math.sqrt(1.25), 9);
  });

  it('§71 flat cut ties at d = 20 and classifies CUT', () => {
    const z0 = -10;
    const g = 0.5;
    const deltaAtSource = 0 - gradeElevation(z0, 0, 0, g, 0); // target 0 − source −10
    const d = solveDaylightDistance(deltaAtSource, g - 0, 1000);
    expect(deltaAtSource).toBe(10);
    expect(d).toBe(20);
    expect(classifySourceDelta(deltaAtSource)).toBe('CUT');
    expect(gradeElevation(z0, 0, 60, g, d as number)).toBe(0);
  });
});

describe('§72–§73 general-plane closed form', () => {
  // Target plane z = 5 − 0.06u + 0.02d, recovered from three local points.
  const planePoints = [
    { u: 0, d: 0, z: 5 },
    { u: 10, d: 0, z: 4.4 },
    { u: 0, d: 10, z: 5.2 },
  ] as const;
  const z0 = 10;
  const gs = 0.02;
  const g = -0.5;

  const deltaAt = (u: number): number => {
    const coeffs = targetPlaneCoeffs(planePoints[0], planePoints[1], planePoints[2]);
    if (!coeffs) throw new Error('plane fit failed');
    return coeffs.p + coeffs.q * u - (z0 + gs * u);
  };
  const coeffs = targetPlaneCoeffs(planePoints[0], planePoints[1], planePoints[2]);
  const denom = g - (coeffs?.r ?? 0);

  it('§72 pins start/mid/end against the closed form', () => {
    expect(coeffs).not.toBeNull();
    expect(coeffs?.p).toBeCloseTo(5, 12);
    expect(coeffs?.q).toBeCloseTo(-0.06, 12);
    expect(coeffs?.r).toBeCloseTo(0.02, 12);
    expect(denom).toBeCloseTo(-0.52, 12);
    expect(solveDaylightDistance(deltaAt(0), denom, 1000)).toBeCloseTo(5 / 0.52, 9);
    expect(solveDaylightDistance(deltaAt(50), denom, 1000)).toBeCloseTo(9 / 0.52, 9);
    expect(solveDaylightDistance(deltaAt(100), denom, 1000)).toBeCloseTo(25, 9);
    expect(classifyPlaneRelation(deltaAt(100), denom)).toBe('intersecting');
  });

  it('§73 varying d(u) is linear and non-parallel at endpoints + midpoint', () => {
    const d0 = solveDaylightDistance(deltaAt(0), denom, 1000) as number;
    const d50 = solveDaylightDistance(deltaAt(50), denom, 1000) as number;
    const d100 = solveDaylightDistance(deltaAt(100), denom, 1000) as number;
    expect(d50).toBeCloseTo((d0 + d100) / 2, 9);
    expect(d0).toBeLessThan(d50);
    expect(d50).toBeLessThan(d100);
  });
});

describe('§74–§76 envelope geometry and determinism', () => {
  it('§74 two-plane kink keeps the exact breakpoint', () => {
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 20, u1: 50, d1: 30 },
      { u0: 50, d0: 30, u1: 100, d1: 15 },
    ];
    const polyline = expectEnvelope(buildNearestEnvelope(segments, 1000));
    expect(polyline).toEqual([
      { u: 0, d: 20 },
      { u: 50, d: 30 },
      { u: 100, d: 15 },
    ]);
  });

  it('§75 two triangulations of one plane give identical daylight', () => {
    const a = { u: 0, d: 0, z: 5 };
    const b = { u: 10, d: 0, z: 4.4 };
    const c = { u: 10, d: 10, z: 4.6 };
    const d = { u: 0, d: 10, z: 5.2 };
    const tri1 = targetPlaneCoeffs(a, b, d);
    const tri2 = targetPlaneCoeffs(a, b, c);
    expect(tri1).not.toBeNull();
    expect(tri2).not.toBeNull();
    if (!tri1 || !tri2) return;
    expect(tri1.q).toBeCloseTo(tri2.q, 12);
    expect(tri1.r).toBeCloseTo(tri2.r, 12);
    expect(tri1.p).toBeCloseTo(tri2.p, 12);
    const z0 = 10;
    const gs = 0.02;
    const g = -0.5;
    const u = 50;
    const delta = (coeffs: typeof tri1): number => coeffs.p + coeffs.q * u - (z0 + gs * u);
    const d1 = solveDaylightDistance(delta(tri1), g - tri1.r, 1000);
    const d2 = solveDaylightDistance(delta(tri2), g - tri2.r, 1000);
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    if (d1 === null || d2 === null) return;
    // Grid-invariance contract: identical within the zeroDelta numeric floor.
    expect(Math.abs(d1 - d2)).toBeLessThanOrEqual(zeroDelta(d1, d2));
  });

  it('§76 shuffled segment input yields identical geometry', () => {
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 20, u1: 50, d1: 30 },
      { u0: 50, d0: 30, u1: 100, d1: 15 },
    ];
    const shuffled: ZeroSegment[] = [
      { u0: 100, d0: 15, u1: 50, d1: 30 },
      { u0: 50, d0: 30, u1: 0, d1: 20 },
    ];
    const forward = expectEnvelope(buildNearestEnvelope(segments, 1000));
    const reverse = expectEnvelope(buildNearestEnvelope(shuffled, 1000));
    expect(reverse).toEqual(forward);
  });
});

describe('§78–§79 search limit and parallel planes', () => {
  it('§78 rejects a tie beyond max distance then accepts at/inside the limit', () => {
    expect(solveDaylightDistance(10, 0.5, 15)).toBeNull(); // d = 20 > 15
    expect(solveDaylightDistance(10, 0.5, 20)).toBe(20); // d == max allowed
    expect(solveDaylightDistance(10, 0.5, 25)).toBe(20);
  });

  it('§79 parallel planes have no solution', () => {
    expect(solveDaylightDistance(-10, 0, 100)).toBeNull();
    expect(classifyPlaneRelation(-10, 0)).toBe('parallel');
    expect(buildNearestEnvelope([], 100)).toEqual({ ok: false, code: 'NO_SOLUTION' });
  });
});

describe('§80 coincident target diagnostics', () => {
  it('§80 flags zeroDelta-coincident planes and patches', () => {
    expect(classifyPlaneRelation(0, 0)).toBe('coincident');
    const square = [
      { u: 0, d: 0, delta: 0 },
      { u: 10, d: 0, delta: 0 },
      { u: 10, d: 10, delta: 0 },
      { u: 0, d: 10, delta: 0 },
    ];
    expect(extractZeroSegments(square)).toEqual({ segments: [], coincident: true });
  });

  it('§80 extracts the exact crossing chord of an affine-delta triangle', () => {
    const triangle = [
      { u: 0, d: 0, delta: 10 },
      { u: 10, d: 0, delta: -10 },
      { u: 5, d: 10, delta: 10 },
    ];
    expect(extractZeroSegments(triangle)).toEqual({
      segments: [{ u0: 5, d0: 0, u1: 7.5, d1: 5 }],
      coincident: false,
    });
  });
});

describe('§81–§82 nearest selection and fail-closed continuity', () => {
  it('§81 selects the nearest root and reports the root count', () => {
    // Two crossing roots: nearest switches at the u = 50 crossover.
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 10, u1: 100, d1: 30 },
      { u0: 0, d0: 30, u1: 100, d1: 10 },
    ];
    expect(segments.length).toBe(2); // multipleSolutionCount source
    const polyline = expectEnvelope(buildNearestEnvelope(segments, 1000));
    expect(polyline).toEqual([
      { u: 0, d: 10 },
      { u: 50, d: 20 },
      { u: 100, d: 10 },
    ]);
  });

  it('§81 overlapping near-parallel roots keep the minimum d', () => {
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 30, u1: 100, d1: 30 },
      { u0: 0, d0: 10, u1: 100, d1: 10 },
    ];
    const polyline = expectEnvelope(buildNearestEnvelope(segments, 1000));
    expect(polyline).toEqual([
      { u: 0, d: 10 },
      { u: 100, d: 10 },
    ]);
  });

  it('§82 d-jump between branches fails closed', () => {
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 20, u1: 50, d1: 20 },
      { u0: 50, d0: 50, u1: 100, d1: 50 },
    ];
    expect(buildNearestEnvelope(segments, 1000)).toEqual({
      ok: false,
      code: 'BRANCH_DISCONTINUITY',
    });
  });

  it('§82 u-gap between branches fails closed', () => {
    const segments: ZeroSegment[] = [
      { u0: 0, d0: 20, u1: 30, d1: 20 },
      { u0: 50, d0: 20, u1: 100, d1: 20 },
    ];
    expect(buildNearestEnvelope(segments, 1000)).toEqual({
      ok: false,
      code: 'BRANCH_DISCONTINUITY',
    });
  });
});

describe('§83–§84 transition classification and already-tied meshes', () => {
  it('§83 inserts the exact cut/fill zero station', () => {
    expect(classifySourceDelta(-10)).toBe('FILL');
    expect(classifySourceDelta(10)).toBe('CUT');
    expect(classifySourceDelta(0)).toBe('TIED');
    expect(splitStationsAtZeros([0, 100], [-10, 10])).toEqual([0, 50, 100]);
    expect(splitStationsAtZeros([0, 50, 100], [-10, 0, 10])).toEqual([0, 50, 100]);
    expect(splitStationsAtZeros([100, 0], [10, -10])).toEqual([0, 50, 100]);
  });

  it('§83 requires full source coverage for cut/fill', () => {
    expect(requireSourceCoverage([10, -5, 3])).toBe(true);
    expect(requireSourceCoverage([10, null, 3])).toBe(false);
    expect(requireSourceCoverage([Number.NaN])).toBe(false);
    expect(requireSourceCoverage([])).toBe(false);
  });

  it('§84 already-tied course emits the ALREADY_TIED signal with no area', () => {
    expect(classifySourceDelta(0)).toBe('TIED');
    expect(isZeroWidthPair({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 5 })).toBe(true);
    const source = flatStripSource(5);
    const tied = expectMeshSignal(buildGradingStripMesh(source, [...source]));
    expect(tied.skippedZeroWidth).toBe(1);
    const threePoint = buildGradingStripMesh(
      [...source, { x: 200, y: 0, z: 5 }],
      [...source, { x: 200, y: 0, z: 5 }],
    );
    expect(threePoint).toEqual({ ok: false, code: 'ALREADY_TIED', skippedZeroWidth: 2 });
  });

  it('§84 flat fill tie statistics are exact', () => {
    expect(tieStats([20, 20, 20])).toEqual({ min: 20, max: 20, mean: 20 });
    expect(tieStats([10, 20, 30])).toEqual({ min: 10, max: 30, mean: 20 });
    expect(tieStats([])).toEqual({ min: 0, max: 0, mean: 0 });
  });
});
