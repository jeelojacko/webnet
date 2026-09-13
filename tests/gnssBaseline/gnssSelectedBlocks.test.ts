/**
 * Phase 12F.2 agent-tier contract: batched selected-covariance blocks.
 *
 * Fast, deterministic, no WASM: a dense-backed stub implements the block
 * API over the TS dense Qxx oracle, and every returned block is compared
 * against that oracle. Covers the TS helper mapping (plan → inputs →
 * named store), symmetry, transpose accessor, positive variances,
 * determinism, single-bridge-call discipline, and helper error paths.
 * Real-WASM parity lives in gnssSelectedBlocksRealWasm.test.ts (WASM tier).
 */
import { describe, expect, it } from 'vitest';

import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import {
  GNSS_SELECTED_BLOCK_SIZE,
  gnssBlockPairKey,
  queryGnssSelectedBlocks,
  readGnssBlock,
} from '../../src/engine/gnssSelectedBlockQuery';
import type {
  SparseSelectedBlockInput,
  SparseSelectedBlockResult,
  SparseSelectedBlockSolver,
} from '../../src/engine/numericalBackend';
import { buildBlockTestNetwork } from './gnssSelectedBlockTestSupport';

/** Existing selected-vs-full contract: 1e-9 abs (cpp scalar path). */
const ABS_TOL = 1e-9;

const allowed = (reference: number): number => ABS_TOL * (1 + Math.abs(reference));

/** Dense-backed stub: answers blocks straight from the TS dense Qxx oracle. */
const stubBlockSolver = (
  qxx: number[][],
  onCall?: () => void,
): SparseSelectedBlockSolver => ({
  queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
    onCall?.();
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

const planInput = (topology: 'chain' | 'repeated-edge' | 'ring', stations: number, seed: number) => {
  const network = buildBlockTestNetwork(topology, stations, seed);
  const plan = buildGnssSelectedBlockPlan(
    network.paramIndex,
    network.baselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
    network.numParams,
  );
  return { network, plan };
};

describe('gnssSelectedBlocks (agent tier, stub-backed)', () => {
  it.each([
    ['chain-6', 'chain' as const, 6, 7],
    ['repeated-edge-8', 'repeated-edge' as const, 8, 13],
    ['ring-12', 'ring' as const, 12, 21],
  ])('%s: every block matches the dense Qxx oracle within 1e-9', (_label, topology, stations, seed) => {
    const { network, plan } = planInput(topology, stations, seed);
    let calls = 0;
    const { store, uniqueColumns } = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: stubBlockSolver(network.qxx, () => {
        calls += 1;
      }),
    });
    expect(calls).toBe(1);
    expect(uniqueColumns).toBeLessThanOrEqual(network.numParams);
    const out = new Float64Array(9);
    let maxAbs = 0;
    plan.pairs.forEach((pair) => {
      readGnssBlock(store, pair.blockA, pair.blockB, out);
      const rowBase = network.paramIndex[plan.stationIds[pair.blockA]!]!['x']!;
      const colBase = network.paramIndex[plan.stationIds[pair.blockB]!]!['x']!;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const reference = network.qxx[rowBase + i]?.[colBase + j] ?? Number.NaN;
          const diff = Math.abs((out[i * 3 + j] ?? 0) - reference);
          maxAbs = Math.max(maxAbs, diff);
          expect(diff).toBeLessThanOrEqual(allowed(reference));
        }
      }
    });
    expect(maxAbs).toBeLessThanOrEqual(ABS_TOL * 2);
    expect(GNSS_SELECTED_BLOCK_SIZE).toBe(3);
  });

  it('Q_ii blocks are symmetric with positive variances; Q_ji reads as Q_ij^T', () => {
    const { network, plan } = planInput('repeated-edge', 8, 13);
    const { store } = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: stubBlockSolver(network.qxx),
    });
    const out = new Float64Array(9);
    const transposed = new Float64Array(9);
    plan.pairs.forEach((pair) => {
      if (pair.blockA === pair.blockB) {
        readGnssBlock(store, pair.blockA, pair.blockB, out);
        for (let i = 0; i < 3; i += 1) {
          expect(out[i * 3 + i]).toBeGreaterThan(0);
          for (let j = 0; j < 3; j += 1) {
            expect(Math.abs((out[i * 3 + j] ?? 0) - (out[j * 3 + i] ?? 0))).toBeLessThanOrEqual(ABS_TOL);
          }
        }
      } else {
        readGnssBlock(store, pair.blockA, pair.blockB, out);
        readGnssBlock(store, pair.blockB, pair.blockA, transposed);
        for (let i = 0; i < 3; i += 1) {
          for (let j = 0; j < 3; j += 1) {
            expect(transposed[i * 3 + j]).toBe(out[j * 3 + i]);
          }
        }
        expect(store.offIndex.get(gnssBlockPairKey(pair.blockA, pair.blockB))).toBeDefined();
      }
    });
  });

  it('same request twice is bitwise identical and uses compact typed buffers', () => {
    const { network, plan } = planInput('chain', 6, 7);
    const run = () => queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: stubBlockSolver(network.qxx),
    });
    const first = run();
    const second = run();
    expect(second.store.diag).toEqual(first.store.diag);
    expect(second.store.offDiag).toEqual(first.store.offDiag);
    expect(first.store.diag).toBeInstanceOf(Float64Array);
    expect(first.store.offDiag).toBeInstanceOf(Float64Array);
    expect(first.store.diag.length).toBe(plan.stationIds.length * 9);
  });

  it('helper error paths fail closed', () => {
    const { network, plan } = planInput('chain', 6, 7);
    const solver = stubBlockSolver(network.qxx);
    const base = { plan, paramIndex: network.paramIndex, system: network.system, solver };
    // Short result buffer mismatches the request plan.
    expect(() => queryGnssSelectedBlocks({
      ...base,
      solver: { queryBlocks: () => ({ blocks: new Float64Array(3), normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 }) },
    })).toThrow(/mismatches the request plan/);
    // Unknown station ordinal in the plan.
    expect(() => queryGnssSelectedBlocks({
      ...base,
      plan: { ...plan, stationIds: [] },
    })).toThrow(/out of range/);
    // Reading a block that was never queried.
    const { store } = queryGnssSelectedBlocks(base);
    expect(() => readGnssBlock(store, 0, 99)).toThrow(/was not queried/);
    expect(() => readGnssBlock(store, 0, 0, new Float64Array(4))).toThrow(/length-9/);
  });
});
