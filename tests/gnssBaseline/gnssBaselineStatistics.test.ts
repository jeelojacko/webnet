/**
 * Phase 12D — Qvv recovery, redundancy, component diagnostics, and block
 * statistics. Golden cross-checks live in gnssBaselineStatisticsGolden.test
 * (worker-built reference); here: analytic identities, invariances, and
 * edge fixtures.
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

const solve = (
  stations: ReturnType<typeof buildStations>,
  baselines: ReturnType<typeof buildBaselines>,
): ReturnType<typeof runGnssBaselineAdjustment> =>
  runGnssBaselineAdjustment({ stations, baselines });

describe('gnss baseline statistics', () => {
  it('recovers symmetric finite Qvv blocks with valid diagonals', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2050, z: 3010 };
    const c = { x: 1050, y: 2150, z: 2995 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', dx: 100.003, dy: 50, dz: 10 },
        { from: 'B', to: 'C', dx: -49.998, dy: 100, dz: -15 },
        { from: 'A', to: 'C', dx: 50, dy: 150, dz: -5 },
      ]),
    );
    expect(result.statistics).toHaveLength(3);
    result.statistics.forEach((entry) => {
      for (const value of [entry.qvv.xx, entry.qvv.xy, entry.qvv.xz, entry.qvv.yy, entry.qvv.yz, entry.qvv.zz]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(entry.qvv.xx).toBeGreaterThanOrEqual(0);
      expect(entry.qvv.yy).toBeGreaterThanOrEqual(0);
      expect(entry.qvv.zz).toBeGreaterThanOrEqual(0);
      expect(entry.status).toBe('ok');
      expect(entry.blockRank).toBe(3);
      expect(entry.distributionKind).toBe('diagnostic-only');
    });
  });

  it('block redundancy traces sum to network DOF', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const d = { x: 1000, y: 2100, z: 3000 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
        { id: 'D', ...d },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', ...vectorBetween(a, b) },
        { from: 'B', to: 'C', ...vectorBetween(b, c) },
        { from: 'C', to: 'D', ...vectorBetween(c, d) },
        { from: 'D', to: 'A', ...vectorBetween(d, a) },
        { from: 'A', to: 'C', ...vectorBetween(a, c) },
      ]),
    );
    // 5 baselines = 15 equations, 3 unknowns x 3 = 9 params, dof = 6.
    expect(result.dof).toBe(6);
    const total = result.statistics.reduce((sum, entry) => sum + entry.redundancy.trace, 0);
    expect(Math.abs(total - result.dof)).toBeLessThan(1e-9);
    result.statistics.forEach((entry) => {
      expect(entry.redundancy.trace).toBeGreaterThanOrEqual(-1e-9);
      expect(entry.redundancy.trace).toBeLessThanOrEqual(3 + 1e-9);
    });
  });

  it('repeated baselines: redundancy sums to DOF', () => {
    resetBaselineIds();
    const a = { x: 5000, y: 6000, z: 7000 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', x: 5100, y: 6050, z: 7010 },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', dx: 100.0, dy: 50.0, dz: 10.0, covariance: isotropicCovariance(0.002) },
        { from: 'A', to: 'B', dx: 100.004, dy: 50.002, dz: 10.001, covariance: isotropicCovariance(0.004) },
      ]),
    );
    expect(result.dof).toBe(3);
    const total = result.statistics.reduce((sum, entry) => sum + entry.redundancy.trace, 0);
    expect(Math.abs(total - 3)).toBeLessThan(1e-9);
  });

  it('sum of block qObs equals the global weighted residual sum', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', ...vectorBetween(a, b) },
        { from: 'B', to: 'C', dx: 0.004, dy: 100, dz: 0 },
        { from: 'A', to: 'C', ...vectorBetween(a, c) },
      ]),
    );
    const blockSum = result.statistics.reduce((sum, entry) => sum + entry.qObs, 0);
    expect(Math.abs(blockSum - result.weightedResidualSum)).toBeLessThan(1e-12);
  });

  it('component standardized residuals use Cvv, not Cll', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    // Strong triangle: Cvv differs substantially from Cll (high redundancy).
    const tight = isotropicCovariance(0.002);
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', ...vectorBetween(a, b), covariance: tight },
        { from: 'B', to: 'C', dx: 0.006, dy: 100, dz: 0, covariance: tight },
        { from: 'A', to: 'C', ...vectorBetween(a, c), covariance: tight },
        { from: 'A', to: 'B', dx: 100.001, dy: 0.001, dz: 0, covariance: tight },
      ]),
    );
    const entry = result.statistics.find((stat) => stat.baselineId === 2)!;
    // Cvv must be much smaller than Cll here (redundant baseline).
    expect(entry.cvv.xx).toBeLessThan(4e-6 * 0.9);
    // t = v / sqrt(Cvv): verify the formula directly.
    const residual = result.residuals.find((r) => r.baselineId === 2)!;
    expect(entry.standardized.x).toBeCloseTo(residual.vX / Math.sqrt(entry.cvv.xx), 12);
    // Using Cll instead would give a much smaller |t| — the bug catcher.
    const wrongT = Math.abs(residual.vX) / 0.002;
    expect(Math.abs(entry.standardized.x ?? 0)).toBeGreaterThan(wrongT * 1.1);
  });

  it('correlated input produces correlated residual covariance', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2050, z: 3010 };
    const c = { x: 1050, y: 2150, z: 2995 };
    const correlated = { xx: 9e-6, xy: 4e-6, xz: 1e-6, yy: 9e-6, yz: -2e-6, zz: 9e-6 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', dx: 100.003, dy: 50, dz: 10 },
        { from: 'B', to: 'C', dx: -50, dy: 99.996, dz: -15.002 },
        { from: 'A', to: 'C', dx: 50.001, dy: 150.001, dz: -4.999, covariance: correlated },
      ]),
    );
    const entry = result.statistics.find((stat) => stat.baselineId === 3)!;
    expect(Math.abs(entry.cvv.xy)).toBeGreaterThan(1e-9);
    expect(entry.residualCorrelation.xy).not.toBeUndefined();
    expect(Math.abs(entry.residualCorrelation.xy ?? 0)).toBeGreaterThan(0.05);
  });

  it('low-redundancy spur: near-zero trace, no explosion, rank-limited T', () => {
    resetBaselineIds();
    // B hangs off fixed A by a single baseline (zero freedom for that
    // block); C closes a redundant triangle elsewhere.
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 1000, y: 0, z: 0 };
    const c = { x: 0, y: 1000, z: 0 };
    const d = { x: 1000, y: 1000, z: 0 };
    const result = solve(
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
        { id: 'D', ...d },
      ]),
      buildBaselines([
        { from: 'A', to: 'B', ...vectorBetween(a, b) },
        { from: 'A', to: 'C', ...vectorBetween(a, c) },
        // 5 mm error in the redundant quad keeps seuw > 0 while the spur
        // block itself has no residual freedom.
        { from: 'C', to: 'D', dx: 1000.005, dy: 0, dz: 0 },
        { from: 'A', to: 'D', ...vectorBetween(a, d) },
      ]),
    );
    const spur = result.statistics.find((stat) => stat.to === 'B')!;
    expect(spur.redundancy.trace).toBeLessThan(1e-6);
    expect(spur.status).toBe('no-freedom');
    expect(spur.blockT).toBe(0);
    expect(Number.isFinite(spur.qObs)).toBe(true);
  });

  it('dof=0 session: Qvv/redundancy valid, scale-dependent stats unavailable', () => {
    resetBaselineIds();
    const result = solve(
      buildStations([
        { id: 'A', x: 0, y: 0, z: 0, fixed: true },
        { id: 'B', x: 100, y: 0, z: 0 },
      ]),
      buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 }]),
    );
    expect(result.dof).toBe(0);
    const entry = result.statistics[0]!;
    expect(entry.status).toBe('no-scale');
    expect(entry.blockT).toBeUndefined();
    expect(entry.standardized.x).toBeUndefined();
    expect(Math.abs(entry.redundancy.trace)).toBeLessThan(1e-9);
  });

  it('reversal invariance: Cvv/redundancy/T unchanged, residual flips sign', () => {
    resetBaselineIds();
    const a = { x: 2000, y: 3000, z: 4000 };
    const b = { x: 2150, y: 3075, z: 4025 };
    const covariance = { xx: 4e-6, xy: 1e-6, xz: 0, yy: 9e-6, yz: 1e-6, zz: 16e-6 };
    const stationsOf = () =>
      buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', x: 2080, y: 3180, z: 3990 },
      ]);
    const forward = solve(
      stationsOf(),
      buildBaselines([
        { from: 'A', to: 'B', dx: 150.002, dy: 75, dz: 25, covariance },
        { from: 'B', to: 'C', dx: -70, dy: 105, dz: -35, covariance },
        { from: 'A', to: 'C', dx: 80, dy: 180, dz: -10, covariance },
      ]),
    );
    resetBaselineIds();
    const reversed = solve(
      stationsOf(),
      buildBaselines([
        { from: 'B', to: 'A', dx: -150.002, dy: -75, dz: -25, covariance },
        { from: 'C', to: 'B', dx: 70, dy: -105, dz: 35, covariance },
        { from: 'C', to: 'A', dx: -80, dy: -180, dz: 10, covariance },
      ]),
    );
    expect(forward.statistics.length).toBe(3);
    forward.statistics.forEach((entry, index) => {
      const mirror = reversed.statistics[index]!;
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        expect(Math.abs(entry.cvv[key] - mirror.cvv[key])).toBeLessThan(1e-18);
      }
      expect(Math.abs(entry.redundancy.trace - mirror.redundancy.trace)).toBeLessThan(1e-12);
      expect(Math.abs((entry.blockT ?? 0) - (mirror.blockT ?? 0))).toBeLessThan(1e-9);
      expect(entry.blockRank).toBe(mirror.blockRank);
      const fwd = forward.residuals[index]!;
      const rev = reversed.residuals[index]!;
      expect(Math.abs(fwd.vX + rev.vX)).toBeLessThan(1e-9);
      for (const component of ['x', 'y', 'z'] as const) {
        expect(Math.abs(Math.abs(entry.standardized[component] ?? 0) - Math.abs(mirror.standardized[component] ?? 0))).toBeLessThan(1e-9);
      }
    });
  });
});
