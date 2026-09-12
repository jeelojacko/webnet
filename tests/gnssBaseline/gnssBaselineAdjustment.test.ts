/**
 * Phase 12B — end-to-end adjustment fixtures with independent golden parity
 * (GATES C-partial, E; fixtures 1, 2, 3, 8).
 *
 * Every solvable fixture is cross-checked against the independent
 * Gauss-Jordan golden solver (tests/gnssBaseline/gnssBaselineGolden.ts),
 * which shares no numerics with src/engine.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
  vectorBetween,
} from './gnssBaselineTestBuilder';
import { runGoldenBaselineAdjustment } from './gnssBaselineGolden';

const COORD_TOL_M = 1e-9;
const RESIDUAL_TOL_M = 1e-9;

const expectGoldenParity = (
  production: ReturnType<typeof runGnssBaselineAdjustment>,
  stations: ReturnType<typeof buildStations>,
  baselines: ReturnType<typeof buildBaselines>,
  coordTol = COORD_TOL_M,
) => {
  const golden = runGoldenBaselineAdjustment(stations, baselines);
  expect(production.unknowns).toEqual(golden.unknowns);
  expect(production.dof).toBe(golden.dof);
  golden.unknowns.forEach((id) => {
    const expected = golden.coordinates[id]!;
    const actual = production.stations[id]!;
    expect(Math.abs(actual.x - expected.x)).toBeLessThan(coordTol);
    expect(Math.abs(actual.y - expected.y)).toBeLessThan(coordTol);
    expect(Math.abs(actual.h - expected.z)).toBeLessThan(coordTol);
  });
  expect(production.residuals.length).toBe(golden.residuals.length);
  production.residuals.forEach((residual, index) => {
    const expected = golden.residuals[index]!;
    expect(residual.baselineId).toBe(expected.baselineId);
    expect(Math.abs(residual.vX - expected.vX)).toBeLessThan(RESIDUAL_TOL_M);
    expect(Math.abs(residual.vY - expected.vY)).toBeLessThan(RESIDUAL_TOL_M);
    expect(Math.abs(residual.vZ - expected.vZ)).toBeLessThan(RESIDUAL_TOL_M);
  });
  expect(
    Math.abs(production.weightedResidualSum - golden.weightedResidualSum),
  ).toBeLessThan(1e-12);
  expect(Math.abs(production.varianceFactor - golden.varianceFactor)).toBeLessThan(1e-9);
  expect(production.qxx.length).toBe(golden.qxx.length);
  for (let row = 0; row < golden.qxx.length; row += 1) {
    for (let column = 0; column < golden.qxx.length; column += 1) {
      // Qxx entries scale with 1/weight (~1e6 for mm sigmas); use a
      // relative comparison against the golden magnitude.
      const expected = golden.qxx[row]![column]!;
      const actual = production.qxx[row]![column]!;
      const scale = Math.max(1, Math.abs(expected));
      expect(Math.abs(actual - expected) / scale).toBeLessThan(1e-9);
    }
  }
  return golden;
};

describe('gnssBaselineAdjustment fixtures', () => {
  it('fixture 1: exact shift A(fixed) -> B recovers B = A + b with ~zero residual', () => {
    resetBaselineIds();
    // Realistic ECEF magnitudes (millions of metres).
    const a = { x: 3771793.0, y: 140253.0, z: 5124304.0 };
    const b = { dx: 1234.567, dy: -234.125, dz: 345.875 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', x: a.x + b.dx + 0.5, y: a.y + b.dy - 0.5, z: a.z + b.dz + 0.5 },
    ]);
    const baselines = buildBaselines([{ from: 'A', to: 'B', ...b }]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.adjustmentFrame).toBe('ecef');
    expect(result.routeProvenance).toBe('typescript-dense');
    expect(result.converged).toBe(true);
    expect(result.logicalObservations).toBe(1);
    expect(result.numObsEquations).toBe(3);
    expect(result.numParams).toBe(3);
    expect(result.dof).toBe(0);
    const solved = result.stations.B!;
    expect(Math.abs(solved.x - (a.x + b.dx))).toBeLessThan(COORD_TOL_M);
    expect(Math.abs(solved.y - (a.y + b.dy))).toBeLessThan(COORD_TOL_M);
    expect(Math.abs(solved.h - (a.z + b.dz))).toBeLessThan(COORD_TOL_M);
    const [residual] = result.residuals;
    expect(Math.abs(residual!.vX)).toBeLessThan(RESIDUAL_TOL_M);
    expect(Math.abs(residual!.vY)).toBeLessThan(RESIDUAL_TOL_M);
    expect(Math.abs(residual!.vZ)).toBeLessThan(RESIDUAL_TOL_M);
    expectGoldenParity(result, stations, baselines);
  });

  it('fixture 2: redundant closing triangle solves exactly with ~zero residuals', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2050, z: 3010 };
    const c = { x: 1050, y: 2150, z: 2995 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', x: b.x + 0.1, y: b.y - 0.1, z: b.z + 0.1 },
      { id: 'C', x: c.x - 0.1, y: c.y + 0.1, z: c.z - 0.1 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', ...vectorBetween(a, b) },
      { from: 'B', to: 'C', ...vectorBetween(b, c) },
      { from: 'A', to: 'C', ...vectorBetween(a, c) },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.logicalObservations).toBe(3);
    expect(result.numObsEquations).toBe(9);
    expect(result.numParams).toBe(6);
    expect(result.dof).toBe(3);
    expect(result.converged).toBe(true);
    const solvedB = result.stations.B!;
    expect(Math.abs(solvedB.x - b.x)).toBeLessThan(COORD_TOL_M);
    expect(Math.abs(solvedB.y - b.y)).toBeLessThan(COORD_TOL_M);
    expect(Math.abs(solvedB.h - b.z)).toBeLessThan(COORD_TOL_M);
    result.residuals.forEach((residual) => {
      expect(residual.magnitude).toBeLessThan(1e-8);
    });
    expectGoldenParity(result, stations, baselines);
  });

  it('fixture 3: millimetre loop error distributes by weight with golden parity', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const tight = isotropicCovariance(0.002);
    const loose = isotropicCovariance(0.010);
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    const closing = vectorBetween(a, c);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', ...vectorBetween(a, b), covariance: tight },
      // 5 mm deliberate error in dX with loose weight.
      { from: 'B', to: 'C', dx: 0.005, dy: 100, dz: 0, covariance: loose },
      { from: 'A', to: 'C', ...closing, covariance: tight },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.dof).toBe(3);
    const total = result.residuals.reduce((sum, r) => sum + r.magnitude, 0);
    expect(total).toBeGreaterThan(0.001);
    // The loose baseline absorbs most of the error.
    const looseResidual = result.residuals.find((r) => r.baselineId === baselines[1]!.id)!;
    const tightResidual = result.residuals.find((r) => r.baselineId === baselines[0]!.id)!;
    expect(looseResidual.magnitude).toBeGreaterThan(tightResidual.magnitude);
    expectGoldenParity(result, stations, baselines);
  });

  it('fixture 8: repeated A->B solutions stay independent and weight correctly', () => {
    resetBaselineIds();
    const a = { x: 5000, y: 6000, z: 7000 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', x: 5100, y: 6050, z: 7010 },
    ]);
    const baselines = buildBaselines([
      {
        from: 'A', to: 'B', dx: 100.0, dy: 50.0, dz: 10.0,
        covariance: isotropicCovariance(0.002), solutionId: 'run1',
      },
      {
        from: 'A', to: 'B', dx: 100.004, dy: 50.002, dz: 10.001,
        covariance: isotropicCovariance(0.004), solutionId: 'run2',
      },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.logicalObservations).toBe(2);
    expect(result.numObsEquations).toBe(6);
    expect(result.residuals.length).toBe(2);
    // Inverse-variance weighted mean of dX: (100/4e-6 + 100.004/16e-6) /
    // (1/4e-6 + 1/16e-6) = 100.0008.
    expect(result.stations.B!.x - a.x).toBeCloseTo(100.0008, 9);
    // Residuals have opposite signs (solutions straddle the estimate).
    const [r1, r2] = result.residuals;
    expect(r1!.vX * r2!.vX).toBeLessThan(0);
    expectGoldenParity(result, stations, baselines);
  });

  it('residual identity: observed = computed + residual (WebNet sign)', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2050, z: 3010 };
    const c = { x: 1050, y: 2150, z: 2995 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    const ab = vectorBetween(a, b);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: ab.dx + 0.003, dy: ab.dy - 0.002, dz: ab.dz + 0.001 },
      { from: 'B', to: 'C', ...vectorBetween(b, c) },
      { from: 'A', to: 'C', ...vectorBetween(a, c) },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    result.residuals.forEach((residual) => {
      const from = result.stations[residual.from]!;
      const to = result.stations[residual.to]!;
      const baseline = baselines.find((bl) => bl.id === residual.baselineId)!;
      expect(baseline.vector.x - (to.x - from.x) - residual.vX).toBeLessThan(1e-12);
      expect(baseline.vector.y - (to.y - from.y) - residual.vY).toBeLessThan(1e-12);
      expect(baseline.vector.z - (to.h - from.h) - residual.vZ).toBeLessThan(1e-12);
      expect(residual.magnitude).toBeCloseTo(
        Math.sqrt(residual.vX ** 2 + residual.vY ** 2 + residual.vZ ** 2),
        15,
      );
    });
  });

  it('quadratic proof: sum of block q_i equals the global vTPv', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    const bc = vectorBetween(b, c);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', ...vectorBetween(a, b) },
      {
        from: 'B', to: 'C', dx: bc.dx + 0.004, dy: bc.dy, dz: bc.dz,
        covariance: { xx: 9e-6, xy: 1e-6, xz: 0, yy: 9e-6, yz: 1e-6, zz: 9e-6 },
      },
      { from: 'A', to: 'C', ...vectorBetween(a, c) },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    const blockSum = result.residuals.reduce((sum, r) => sum + r.quadraticForm, 0);
    expect(Math.abs(blockSum - result.weightedResidualSum)).toBeLessThan(1e-15);
    expect(result.weightedResidualSum).toBeGreaterThan(0);
  });

  it('linear behavior: metre-level starting offsets converge to the same solution', () => {
    resetBaselineIds();
    const a = { x: 3771793.0, y: 140253.0, z: 5124304.0 };
    const bTrue = { x: a.x + 1234.567, y: a.y - 234.125, z: a.z + 345.875 };
    const oxide = (delta: number) =>
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', x: bTrue.x + delta, y: bTrue.y + delta, z: bTrue.z + delta },
      ]);
    resetBaselineIds();
    const good = runGnssBaselineAdjustment({
      stations: oxide(0.5),
      baselines: buildBaselines([{ from: 'A', to: 'B', dx: 1234.567, dy: -234.125, dz: 345.875 }]),
    });
    resetBaselineIds();
    const poor = runGnssBaselineAdjustment({
      stations: oxide(25),
      baselines: buildBaselines([{ from: 'A', to: 'B', dx: 1234.567, dy: -234.125, dz: 345.875 }]),
    });
    for (const [g, p] of [
      [good.stations.B!.x, poor.stations.B!.x],
      [good.stations.B!.y, poor.stations.B!.y],
      [good.stations.B!.h, poor.stations.B!.h],
    ]) {
      expect(Math.abs((g as number) - (p as number))).toBeLessThan(1e-9);
    }
    expect(good.converged).toBe(true);
    expect(poor.converged).toBe(true);
    // Linear problem: at most two generic iterations (solve + verify).
    expect(good.iterations).toBeLessThanOrEqual(2);
    expect(poor.iterations).toBeLessThanOrEqual(2);
  });
});
