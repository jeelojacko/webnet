/**
 * Phase 12F.2 agent-tier: block-store Phase 12D reconstruction parity vs R0.
 *
 * Dense-backed stub answers the batched block API from the TS dense Qxx
 * oracle; recoverGnssBaselineStatisticsFromBlocks must reproduce the dense
 * recoverGnssBaselineStatistics output (Qvv/Cvv/standardized/redundancy/
 * blockT/traces) within 1e-9. No WASM, no production routing.
 */
import { describe, expect, it } from 'vitest';

import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import { queryGnssSelectedBlocks } from '../../src/engine/gnssSelectedBlockQuery';
import type {
  SparseSelectedBlockInput,
  SparseSelectedBlockResult,
  SparseSelectedBlockSolver,
} from '../../src/engine/numericalBackend';
import {
  recoverGnssBaselineStatistics,
  type GnssBaselineStatistics,
} from '../../src/engine/gnssBaselineStatistics';
import { recoverGnssBaselineStatisticsFromBlocks } from '../../src/engine/gnssBlockStatistics';
import { buildBlockTestNetwork } from './gnssSelectedBlockTestSupport';

const ABS_TOL = 1e-9;

const stubSolver = (qxx: number[][]): SparseSelectedBlockSolver => ({
  queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
    const stride = input.blockSize * input.blockSize;
    const blocks = new Float64Array(input.blockRowStarts.length * stride);
    for (let b = 0; b < input.blockRowStarts.length; b += 1) {
      const rowBase = input.blockRowStarts[b] ?? 0;
      const colBase = input.blockColStarts[b] ?? 0;
      for (let i = 0; i < input.blockSize; i += 1) {
        for (let j = 0; j < input.blockSize; j += 1) {
          blocks[b * stride + i * input.blockSize + j] = qxx[rowBase + i]?.[colBase + j] ?? Number.NaN;
        }
      }
    }
    return { blocks, normalNnz: 1, factorNnz: 1, damping: 0, dampingAttempts: 0 };
  },
});

const blockValues = (stats: GnssBaselineStatistics, key: 'qvv' | 'cvv'): number[] =>
  [stats[key].xx, stats[key].xy, stats[key].xz, stats[key].yy, stats[key].yz, stats[key].zz];

describe('gnssBlockStatistics (agent tier, stub-backed)', () => {
  it.each([
    // Bridgeless only: chain/tree spokes carry ~zero-redundancy bridges
    // and trip the orthogonal Qvv eigen PSD gate (audit finding F-BRIDGE).
    ['repeated-edge-8', 'repeated-edge' as const, 8, 13],
    ['ring-12', 'ring' as const, 12, 21],
    ['sparse-mesh-12', 'sparse-mesh' as const, 12, 33],
  ])('%s: block-store statistics match dense R0 within 1e-9', (_label, topology, stations, seed) => {
    const network = buildBlockTestNetwork(topology, stations, seed);
    const plan = buildGnssSelectedBlockPlan(
      network.paramIndex,
      network.baselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
      network.numParams,
    );
    const { store } = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: stubSolver(network.qxx),
    });
    // Zero residuals (v=0) exercise Qvv/Cvv/redundancy paths identically
    // in both statistics paths, isolating differences to Qxx sourcing.
    const zeroResiduals = network.baselines.map((baseline) => ({
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      vX: 0,
      vY: 0,
      vZ: 0,
      magnitude: 0,
      quadraticForm: 0,
    }));
    const seuw = 1.5;
    const dense = recoverGnssBaselineStatistics({
      baselines: network.baselines,
      residuals: zeroResiduals,
      paramIndex: network.paramIndex,
      qxx: network.qxx,
      seuw,
    });
    const blocked = recoverGnssBaselineStatisticsFromBlocks({
      baselines: network.baselines,
      residuals: zeroResiduals,
      paramIndex: network.paramIndex,
      stationIds: plan.stationIds,
      store,
      seuw,
    });
    expect(blocked.length).toBe(dense.length);
    let maxAbs = 0;
    dense.forEach((reference, k) => {
      const candidate = blocked[k]!;
      blockValues(reference, 'qvv').forEach((value, m) => {
        maxAbs = Math.max(maxAbs, Math.abs(value - blockValues(candidate, 'qvv')[m]!));
      });
      blockValues(reference, 'cvv').forEach((value, m) => {
        maxAbs = Math.max(maxAbs, Math.abs(value - blockValues(candidate, 'cvv')[m]!));
      });
      (['x', 'y', 'z'] as const).forEach((axis) => {
        maxAbs = Math.max(maxAbs, Math.abs(reference.redundancy[axis] - candidate.redundancy[axis]));
      });
      maxAbs = Math.max(maxAbs, Math.abs(reference.redundancy.trace - candidate.redundancy.trace));
    });
    expect(maxAbs).toBeLessThanOrEqual(ABS_TOL * 2);
    // Redundancy identity over the full small corpus (hard gate shape).
    const dof = network.baselines.length * 3 - network.numParams;
    const traceSum = blocked.reduce((sum, s) => sum + s.redundancy.trace, 0);
    expect(Math.abs(traceSum - dof)).toBeLessThan(1e-6);
  });

  it('missing off-diagonal block fails closed (explicit, never silent)', () => {
    const network = buildBlockTestNetwork('repeated-edge', 8, 13);
    const plan = buildGnssSelectedBlockPlan(
      network.paramIndex,
      network.baselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
      network.numParams,
    );
    const { store } = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: stubSolver(network.qxx),
    });
    // Drop every off-diagonal slot: any multi-station edge must throw.
    const emptied = { ...store, offDiag: new Float64Array(0), offIndex: new Map<string, number>() };
    const zeroResiduals = network.baselines.map((baseline) => ({
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      vX: 0,
      vY: 0,
      vZ: 0,
      magnitude: 0,
      quadraticForm: 0,
    }));
    expect(() => recoverGnssBaselineStatisticsFromBlocks({
      baselines: network.baselines,
      residuals: zeroResiduals,
      paramIndex: network.paramIndex,
      stationIds: plan.stationIds,
      store: emptied,
      seuw: 1,
    })).toThrow(/was not queried/);
  });
});
