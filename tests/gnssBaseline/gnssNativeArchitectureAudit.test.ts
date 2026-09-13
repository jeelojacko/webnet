/**
 * Phase 12F.0 — TS-oracle correctness legs (agent tier, fast, no WASM).
 *
 * Covers the native-independent correctness claims of the audit:
 * replica fidelity of the stage-timed harness loop, translated-origin
 * equivalence, full correlated 3x3 weights (incl. negative correlations)
 * vs the independent golden, fixed-endpoint Qvv formulas (fixed/free
 * combos, repeated/reversed edges) with in-test hand computations,
 * redundancy-trace identity, setup self-consistency, multi-component
 * semantics, and the completeness-inventory shape.
 *
 * Real-WASM R1/R2 parity, corpus scaling, and perf/memory legs live in
 * tests/evidence/phase12f0_native_architecture_audit.test.ts (manual).
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  rankGnssBaselineSuspects,
  recoverGnssBaselineStatistics,
  symmetricRank3,
  symmetricEigen3,
} from '../../src/engine/gnssBaselineStatistics';
import { invertGnssBaselineCovariance } from '../../src/engine/gnssBaselineCovariance';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';
import {
  AUDIT_TOPOLOGIES,
  BRIDGELESS_TOPOLOGIES,
  buildGnssAdjustInput,
  COMPLETENESS_INVENTORY,
  compareParity,
  generateAuditNetwork,
  latLonToEcef,
  runTimedGnssLoop,
} from '../../scripts/gnss/gnssNativeArchitectureAudit';
import { runGoldenBaselineAdjustment } from './gnssBaselineGolden';

const ecefStation = (id: string, xyz: [number, number, number], fixed: boolean): [string, StationMap[string]] => [
  id,
  { x: xyz[0], y: xyz[1], h: xyz[2], fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed },
];

const tinyTriangle = (): { stations: StationMap; baselines: GnssBaselineObservation[] } => {
  const a = latLonToEcef(45, -75, 100);
  const b = latLonToEcef(45.001, -75, 105);
  const c = latLonToEcef(45, -74.999, 110);
  const stations: StationMap = Object.fromEntries([
    ecefStation('A', a, true),
    ecefStation('B', [b[0] + 0.02, b[1] - 0.01, b[2] + 0.015], false),
    ecefStation('C', [c[0] - 0.01, c[1] + 0.02, c[2] - 0.01], false),
  ]);
  const base = { type: 'gnssBaseline' as const, frame: 'ecef' as const, referenceFrame: 'ITRF2020@2020.0', epoch: '2020.0', ellipsoid: 'GRS80' };
  const vec = (f: [number, number, number], t: [number, number, number]) => ({
    x: t[0] - f[0], y: t[1] - f[1], z: t[2] - f[2],
  });
  // Correlated covariances with negative off-diagonals (mm-level).
  const cov1 = { xx: 4e-6, xy: -1.2e-6, xz: 0.8e-6, yy: 5e-6, yz: -1e-6, zz: 6e-6 };
  const cov2 = { xx: 9e-6, xy: 2e-6, xz: -3e-6, yy: 8e-6, yz: 1.5e-6, zz: 1e-5 };
  const cov3 = { xx: 3e-6, xy: -0.5e-6, xz: 0.2e-6, yy: 4e-6, yz: -0.8e-6, zz: 3.5e-6 };
  const baselines: GnssBaselineObservation[] = [
    { ...base, id: 1, from: 'A', to: 'B', vector: vec(a, b), covariance: cov1 },
    { ...base, id: 2, from: 'B', to: 'C', vector: vec(b, c), covariance: cov2 },
    { ...base, id: 3, from: 'A', to: 'C', vector: vec(a, c), covariance: cov3 },
  ];
  return { stations, baselines };
};

describe('phase12f0 audit oracle correctness (TS-only)', () => {
  it('stage-timed replica matches production bitwise-tight', () => {
    const network = generateAuditNetwork('sparse-mesh', 10, 1201);
    const input = buildGnssAdjustInput(network);
    const timed = runTimedGnssLoop(input);
    expect(timed.replicaMaxCoordDiff).toBeLessThan(1e-12);
    expect(timed.replicaMaxQxxDiff).toBeLessThan(1e-15);
    expect(timed.result.converged).toBe(true);
    expect(timed.stages.totalMs).toBeGreaterThan(0);
    expect(timed.stages.qxxInvertMs).toBeGreaterThanOrEqual(0);
  });

  it('translated-origin network preserves corrections and vTPv', () => {
    const network = generateAuditNetwork('ring', 8, 77);
    const r0 = runGnssBaselineAdjustment(buildGnssAdjustInput(network));
    const shift: [number, number, number] = [1000, -2000, 3000];
    const shifted: StationMap = Object.fromEntries(
      Object.entries(network.stations).map(([id, s]) => [
        id, { ...s, x: s.x + shift[0], y: s.y + shift[1], h: s.h + shift[2] },
      ]),
    );
    const r1 = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations: shifted, baselines: network.baselines }));
    expect(r1.converged).toBe(r0.converged);
    expect(Math.abs(r1.weightedResidualSum - r0.weightedResidualSum) / Math.max(1, r0.weightedResidualSum))
      .toBeLessThan(1e-9);
    expect(Math.abs(r1.maxCorrectionM - r0.maxCorrectionM)).toBeLessThan(1e-9);
    r0.unknowns.forEach((id) => {
      const a = r0.stations[id]!;
      const b = r1.stations[id]!;
      expect(Math.abs(b.x - a.x - shift[0])).toBeLessThan(1e-6);
      expect(Math.abs(b.y - a.y - shift[1])).toBeLessThan(1e-6);
      expect(Math.abs(b.h - a.h - shift[2])).toBeLessThan(1e-6);
    });
  });

  it('correlated 3x3 weights with negative correlations match the independent golden', () => {
    const { stations, baselines } = tinyTriangle();
    const production = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations, baselines }));
    const golden = runGoldenBaselineAdjustment(stations, baselines);
    expect(production.dof).toBe(3);
    production.unknowns.forEach((id) => {
      const expected = golden.coordinates[id]!;
      const actual = production.stations[id]!;
      expect(Math.abs(actual.x - expected.x)).toBeLessThan(1e-9);
      expect(Math.abs(actual.y - expected.y)).toBeLessThan(1e-9);
      expect(Math.abs(actual.h - expected.z)).toBeLessThan(1e-9);
    });
    production.residuals.forEach((residual, index) => {
      const expected = golden.residuals[index]!;
      expect(Math.abs(residual.vX - expected.vX)).toBeLessThan(1e-9);
      expect(Math.abs(residual.vY - expected.vY)).toBeLessThan(1e-9);
      expect(Math.abs(residual.vZ - expected.vZ)).toBeLessThan(1e-9);
    });
    expect(Math.abs(production.weightedResidualSum - golden.weightedResidualSum)).toBeLessThan(1e-12);
  });

  it('fixed/free single baseline yields zero Qvv and zero redundancy', () => {
    const a = latLonToEcef(45, -75, 100);
    const b = latLonToEcef(45.001, -75, 100);
    const stations: StationMap = Object.fromEntries([
      ecefStation('A', a, true),
      ecefStation('B', [b[0] + 0.01, b[1], b[2]], false),
    ]);
    const baselines: GnssBaselineObservation[] = [{
      type: 'gnssBaseline', id: 1, from: 'A', to: 'B',
      vector: { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] },
      covariance: { xx: 4e-6, xy: 0, xz: 0, yy: 4e-6, yz: 0, zz: 4e-6 },
      frame: 'ecef', referenceFrame: 'ITRF2020@2020.0', epoch: '2020.0', ellipsoid: 'GRS80',
    }];
    const result = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations, baselines }));
    expect(result.dof).toBe(0);
    const stats = result.statistics[0]!;
    // dof=0: Qxx == C exactly, so Qvv == 0 and redundancy trace == 0.
    expect(Math.abs(stats.qvv.xx) + Math.abs(stats.qvv.yy) + Math.abs(stats.qvv.zz)).toBeLessThan(1e-15);
    expect(Math.abs(stats.redundancy.trace)).toBeLessThan(1e-9);
    expect(stats.status).toBe('no-scale');
  });

  it('triangle Qvv matches an in-test hand computation (A Qxx A^T)', () => {
    const { stations, baselines } = tinyTriangle();
    const result = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations, baselines }));
    // Hand index: unknowns sorted [B, C] => B:(0,1,2) C:(3,4,5).
    expect(result.unknowns).toEqual(['B', 'C']);
    const edge = baselines[1]!; // B -> C
    const qxx = result.qxx;
    // A rows: B cols negated, C cols positive.
    const expected: number[][] = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        expected[r]![s] =
          qxx[r]![s]! - qxx[r]![s + 3]! - qxx[r + 3]![s]! + qxx[r + 3]![s + 3]!;
      }
    }
    const dense: number[][] = [
      [edge.covariance.xx, edge.covariance.xy, edge.covariance.xz],
      [edge.covariance.xy, edge.covariance.yy, edge.covariance.yz],
      [edge.covariance.xz, edge.covariance.yz, edge.covariance.zz],
    ];
    const stats = result.statistics.find((s) => s.baselineId === 2)!;
    const got = [[stats.qvv.xx, stats.qvv.xy, stats.qvv.xz], [stats.qvv.xy, stats.qvv.yy, stats.qvv.yz], [stats.qvv.xz, stats.qvv.yz, stats.qvv.zz]];
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        expect(Math.abs(got[r]![s]! - (dense[r]![s]! - expected[r]![s]!))).toBeLessThan(1e-18);
      }
    }
  });

  it('repeated and reversed edges solve with trace identity', () => {
    const network = generateAuditNetwork('repeated-edge', 6, 4242);
    const result = runGnssBaselineAdjustment(buildGnssAdjustInput(network));
    expect(result.converged).toBe(true);
    const trace = result.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
    expect(Math.abs(trace - result.dof)).toBeLessThan(1e-9);
    // Reversed duplicate edges carry distinct residuals but shared geometry.
    expect(result.residuals.length).toBe(network.baselines.length);
  });

  it('redundancy-trace identity holds on every bridgeless topology', () => {
    BRIDGELESS_TOPOLOGIES.forEach((topology, index) => {
      const network = generateAuditNetwork(topology, 12, 900 + index);
      const result = runGnssBaselineAdjustment(buildGnssAdjustInput(network));
      const trace = result.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
      expect(Math.abs(trace - result.dof)).toBeLessThan(1e-9);
    });
  });

  it('setup augmentation equals a manual effective-covariance solve', () => {
    const network = generateAuditNetwork('sparse-mesh', 8, 5150);
    const setup = { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 };
    const augmented = runGnssBaselineAdjustment(buildGnssAdjustInput(network, setup));
    expect(augmented.setupModel).toBeDefined();
    expect(augmented.setupContributions?.length).toBe(network.baselines.length);
    // Manual effective covariances must reproduce the augmented solve tightly.
    const manualBaselines = network.baselines.map((baseline, index) => {
      const contribution = augmented.setupContributions![index]!;
      return { ...baseline, covariance: { ...contribution.effectiveCovariance } };
    });
    const manual = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations: network.stations, baselines: manualBaselines }));
    const parity = compareParity(augmented, manual, 'full');
    expect(parity.maxCoordAbs).toBeLessThan(1e-12);
    expect(parity.vtpvRel).toBeLessThan(1e-12);
    expect(parity.qxxMaxRel).toBeLessThan(1e-9);
  });

  it('two-component network preserves multi-component semantics in TS', () => {
    const first = generateAuditNetwork('sparse-mesh', 7, 11);
    const second = generateAuditNetwork('sparse-mesh', 7, 12);
    // Relabel the second component so the session has two components.
    const stations: StationMap = { ...first.stations };
    Object.entries(second.stations).forEach(([id, station]) => {
      stations[`T${id}`] = { ...station };
    });
    let nextId = Math.max(...first.baselines.map((b) => b.id)) + 1;
    const baselines: GnssBaselineObservation[] = [
      ...first.baselines,
      ...second.baselines.map((b) => ({
        ...b,
        id: nextId++,
        from: `T${b.from}`,
        to: `T${b.to}`,
      })),
    ];
    const result = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations, baselines }));
    expect(result.converged).toBe(true);
    const trace = result.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
    expect(Math.abs(trace - result.dof)).toBeLessThan(1e-9);
    // Blunder ranking (whole-block suspects) is defined on both components.
    const ranked = rankGnssBaselineSuspects(result.statistics);
    expect(ranked.length).toBe(baselines.length);
  });

  it('statistics recovery rejects misuse fail-closed', () => {
    const network = generateAuditNetwork('ring', 4, 31);
    const result = runGnssBaselineAdjustment(buildGnssAdjustInput(network));
    expect(() => recoverGnssBaselineStatistics({
      baselines: network.baselines,
      residuals: result.residuals,
      paramIndex: {},
      qxx: result.qxx,
      seuw: Number.NaN,
    })).toThrow();
    expect(() => invertGnssBaselineCovariance(
      { xx: 1, xy: 2, xz: 0, yy: 1, yz: 0, zz: 1 },
      'BAD',
    )).toThrow();
  });

  it('F-BRIDGE pin: bridge edges with dof>0 trip the Qvv eigen gate', () => {
    // A chain plus one redundant tie (dof=3) leaves every chain edge a
    // bridge with ~zero redundancy; its Qvv block sits at roundoff scale
    // and production throws. Bridge-containing survey graphs (chains,
    // trees, rays, spokes) are therefore not reliably supportable on the
    // current TS-dense statistics path. Pinned, not fixed (audit scope).
    const network = generateAuditNetwork('chain', 8, 77);
    expect(network.baselines.length).toBeGreaterThan(7);
    expect(() => runGnssBaselineAdjustment(buildGnssAdjustInput(network))).toThrow(/non-PSD/);
    // The inventory still enumerates bridge topologies for documentation.
    expect(AUDIT_TOPOLOGIES.length).toBe(7);
  });

  it('F-PSD pin: eigen gate is stricter than the diagonal floor on ~zero Qvv', () => {
    // A spur/ray edge in a larger network leaves Qvv ~= 0 (all entries
    // ~1e-21); the diagonal roundoff floor (1e-9 of mm-level variance ~
    // 1e-15 abs) would pass it, but the eigen gate (tau ~ 1e-28 relative
    // to lambda_max ~= 0) throws. Pinned as audit finding F-PSD.
    const qvv = [[1e-20, 0, 0], [0, 1e-20, 0], [0, 0, -1.9e-21]] as [
      [number, number, number], [number, number, number], [number, number, number]
    ];
    expect(() => symmetricRank3(symmetricEigen3(qvv), 'F-PSD')).toThrow(/non-PSD/);
  });

  it('completeness inventory covers every Phase-12D output', () => {
    const items = COMPLETENESS_INVENTORY.map((entry) => entry.item);
    ['adjusted coordinates', 'residuals v', 'vTPv/SEUW', 'Qvv blocks', 'Cvv blocks',
      'standardized residuals', 'block redundancy + trace=DOF', 'block T',
      'loop QC closures', 'blunder what-if ranking'].forEach((item) => {
      expect(items).toContain(item);
    });
    expect(COMPLETENESS_INVENTORY.every((entry) =>
      entry.verdict === 'FULL' || entry.verdict === 'SELECTED-SUFFICIENT' || entry.verdict === 'NO-QXX')).toBe(true);
  });
});
