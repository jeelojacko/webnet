/**
 * Phase 12D — independent golden parity for Qvv blocks, redundancy, and
 * loop closures. The reference (gnssBaselineGoldenStats) shares no
 * numerics with src/engine. Note the scale bridge: golden blockT is
 * v^T Qvv^-1 v (cofactor scale) while production blockT is v^T Cvv^+ v
 * with Cvv = seuw^2 Qvv, so production blockT == golden blockT / seuw^2.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import {
  goldenLoopClosure,
  goldenQvvBlocks,
} from './gnssBaselineGoldenStats';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const stationsOf = (specs: Parameters<typeof buildStations>[0]) => buildStations(specs);

describe('gnss statistics golden parity', () => {
  it('triangle with error: Qvv/redundancy/qObs/blockT match', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const stations = stationsOf([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0.006, dy: 100, dz: -0.003 },
      { from: 'A', to: 'C', dx: 100, dy: 100, dz: 0 },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    const golden = goldenQvvBlocks(stations, baselines);
    expect(golden.dof).toBe(result.dof);
    const seuw2 = result.varianceFactor;
    result.statistics.forEach((entry) => {
      const expected = golden.blocks.find((block) => block.baselineId === entry.baselineId)!;
      let diff = 0;
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        diff = Math.max(diff, Math.abs(entry.qvv[key] - expected.qvv[key]));
      }
      expect(diff).toBeLessThan(1e-12);
      expect(Math.abs(entry.redundancy.trace - expected.redundancy.trace)).toBeLessThan(1e-9);
      expect(Math.abs(entry.redundancy.x - expected.redundancy.x)).toBeLessThan(1e-9);
      expect(Math.abs(entry.qObs - expected.qObs)).toBeLessThan(1e-12);
      // Scale bridge: production T (Cvv scale) vs golden T (Qvv scale).
      expect(Math.abs((entry.blockT ?? 0) * seuw2 - expected.blockT) / Math.max(1, expected.blockT)).toBeLessThan(1e-9);
    });
  });

  it('correlated covariance: all six Qvv terms match', () => {
    resetBaselineIds();
    const correlated = { xx: 9e-6, xy: 4e-6, xz: 1e-6, yy: 9e-6, yz: -2e-6, zz: 9e-6 };
    const stations = stationsOf([
      { id: 'A', x: 1000, y: 2000, z: 3000, fixed: true },
      { id: 'B', x: 1100, y: 2050, z: 3010 },
      { id: 'C', x: 1050, y: 2150, z: 2995 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.003, dy: 50, dz: 10 },
      { from: 'B', to: 'C', dx: -50, dy: 99.996, dz: -15.002 },
      { from: 'A', to: 'C', dx: 50.001, dy: 150.001, dz: -4.999, covariance: correlated },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    const golden = goldenQvvBlocks(stations, baselines);
    const entry = result.statistics.find((stat) => stat.baselineId === 3)!;
    const expected = golden.blocks.find((block) => block.baselineId === 3)!;
    let diff = 0;
    for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
      diff = Math.max(diff, Math.abs(entry.qvv[key] - expected.qvv[key]));
    }
    expect(diff).toBeLessThan(1e-15);
    expect(Math.abs(entry.cvv.xy)).toBeGreaterThan(0);
  });

  it('repeated baselines match the golden', () => {
    resetBaselineIds();
    const stations = stationsOf([
      { id: 'A', x: 5000, y: 6000, z: 7000, fixed: true },
      { id: 'B', x: 5100, y: 6050, z: 7010 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.0, dy: 50.0, dz: 10.0, covariance: isotropicCovariance(0.002) },
      { from: 'A', to: 'B', dx: 100.004, dy: 50.002, dz: 10.001, covariance: isotropicCovariance(0.004) },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    const golden = goldenQvvBlocks(stations, baselines);
    result.statistics.forEach((entry) => {
      const expected = golden.blocks.find((block) => block.baselineId === entry.baselineId)!;
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        expect(Math.abs(entry.qvv[key] - expected.qvv[key])).toBeLessThan(1e-15);
      }
    });
    const total = result.statistics.reduce((sum, entry) => sum + entry.redundancy.trace, 0);
    expect(Math.abs(total - result.dof)).toBeLessThan(1e-9);
  });

  it('loop closures match the independent loop golden (vector, covariance, T)', () => {
    resetBaselineIds();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0, covariance: isotropicCovariance(0.002) },
      { from: 'B', to: 'C', dx: 0.003, dy: 99.998, dz: 0.001, covariance: isotropicCovariance(0.003) },
      { from: 'C', to: 'A', dx: -100, dy: -100, dz: 0, covariance: isotropicCovariance(0.002) },
    ]);
    const result = computeGnssLoopClosures(baselines);
    expect(result.loops).toHaveLength(1);
    const loop = result.loops[0]!;
    const members = loop.members.map((member) => ({ baselineId: member.baselineId, sign: member.sign }));
    const golden = goldenLoopClosure(baselines, members);
    expect(Math.abs(loop.closure.x - golden.s.x)).toBeLessThan(1e-12);
    expect(Math.abs(loop.closure.y - golden.s.y)).toBeLessThan(1e-12);
    expect(Math.abs(loop.closure.z - golden.s.z)).toBeLessThan(1e-12);
    for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
      expect(Math.abs(loop.covariance[key] - golden.cov[key])).toBeLessThan(1e-18);
    }
    expect(Math.abs((loop.tLoop ?? 0) - golden.tLoop)).toBeLessThan(1e-9);
  });
});
