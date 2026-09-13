/**
 * Phase 12F.2 WASM-tier contract: batched selected-covariance blocks over
 * the REAL cpp/build-wasm bundle (missing artifact fails loudly, never a
 * silent skip).
 *
 * Small nets (chain-6 with one fixed endpoint, repeated-edge mesh-8 with
 * one fixed endpoint, ring-12) compare EVERY returned block against both
 * the TS full dense Qxx oracle and the existing scalar querySelected API,
 * with max abs/rel diffs asserted at-or-tighter than the shared 1e-9
 * selected-vs-full contract. Also covers Q_ii symmetry, Q_ji == Q_ij^T
 * (bitwise, answered by transpose with no extra solves), positive
 * variances, determinism (repeat request bitwise identical), error paths
 * (OOB block, blockSize <= 0, count 0 ok, NaN detection), solve-count
 * reduction (unique columns vs legacy R2 scalar-query length), and exactly
 * one bridge call per queryBlocks invocation.
 *
 * Evidence/test-harness only: no production routing, no R1 default change.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import {
  queryGnssSelectedBlocks,
  readGnssBlock,
} from '../../src/engine/gnssSelectedBlockQuery';
import type { SparseSelectedBlockSolver } from '../../src/engine/numericalBackend';
import { WasmSparseSelectedCovariance } from '../../src/engine/wasm/wasmSparseCovariance';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  selectedBlockQueries,
} from '../../scripts/gnss/gnssNativeArchitectureAudit';
import { buildBlockTestNetwork } from './gnssSelectedBlockTestSupport';

/** Shared selected-vs-full contract: 1e-9 abs (cpp scalar path). */
const ABS_TOL = 1e-9;

const allowedAbs = (reference: number): number => ABS_TOL * (1 + Math.abs(reference));

const relDiff = (actual: number, reference: number): number => {
  const denom = Math.max(Math.abs(actual), Math.abs(reference));
  return denom === 0 ? 0 : Math.abs(actual - reference) / denom;
};

const loadBlocksSolver = async (): Promise<WasmSparseSelectedCovariance> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  const factory = mod.default;
  if (typeof factory !== 'function') throw new Error('Real WASM factory did not load.');
  const module = await factory();
  return new WasmSparseSelectedCovariance(module);
};

const countingSolver = (
  solver: SparseSelectedBlockSolver,
  onCall: () => void,
): SparseSelectedBlockSolver => ({
  queryBlocks: (input) => {
    onCall();
    return solver.queryBlocks(input);
  },
});

describe('gnssSelectedBlocks (WASM tier, real bundle)', () => {
  it.each([
    ['chain-6', 'chain' as const, 6, 7],
    ['repeated-edge-8', 'repeated-edge' as const, 8, 13],
    ['ring-12', 'ring' as const, 12, 21],
  ])('%s: blocks match dense Qxx and scalar queries within 1e-9', async (_label, topology, stations, seed) => {
    const solver = await loadBlocksSolver();
    const network = buildBlockTestNetwork(topology, stations, seed);
    const plan = buildGnssSelectedBlockPlan(
      network.paramIndex,
      network.baselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
      network.numParams,
    );
    let calls = 0;
    const { store, meta, uniqueColumns } = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver: countingSolver(solver, () => {
        calls += 1;
      }),
    });
    expect(calls).toBe(1);
    expect(meta.damping).toBe(0);
    expect(meta.dampingAttempts).toBe(0);

    // Legacy R2 cost baseline: per-edge scalar queries (21/edge, no dedup).
    const legacy = selectedBlockQueries(network.paramIndex, network.baselines, network.numParams);
    expect(uniqueColumns).toBeLessThan(legacy.columns.length);

    // Scalar querySelected over every (row,col) entry of every block.
    const scalarRows: number[] = [];
    const scalarColumns: number[] = [];
    const out = new Float64Array(9);
    plan.pairs.forEach((pair) => {
      const rowBase = network.paramIndex[plan.stationIds[pair.blockA]!]!['x']!;
      const colBase = network.paramIndex[plan.stationIds[pair.blockB]!]!['x']!;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          scalarRows.push(rowBase + i);
          scalarColumns.push(colBase + j);
        }
      }
    });
    const scalar = solver.querySelected({
      ...network.system,
      queryRows: Int32Array.from(scalarRows),
      queryColumns: Int32Array.from(scalarColumns),
    });

    let maxAbsDense = 0;
    let maxRelDense = 0;
    let maxAbsScalar = 0;
    let maxRelScalar = 0;
    plan.pairs.forEach((pair, slot) => {
      readGnssBlock(store, pair.blockA, pair.blockB, out);
      const rowBase = network.paramIndex[plan.stationIds[pair.blockA]!]!['x']!;
      const colBase = network.paramIndex[plan.stationIds[pair.blockB]!]!['x']!;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const value = out[i * 3 + j] ?? Number.NaN;
          const dense = network.qxx[rowBase + i]?.[colBase + j] ?? Number.NaN;
          expect(Number.isFinite(value)).toBe(true);
          maxAbsDense = Math.max(maxAbsDense, Math.abs(value - dense));
          maxRelDense = Math.max(maxRelDense, relDiff(value, dense));
          expect(Math.abs(value - dense)).toBeLessThanOrEqual(allowedAbs(dense));
          const scalarValue = scalar.covariance[slot * 9 + i * 3 + j] ?? Number.NaN;
          maxAbsScalar = Math.max(maxAbsScalar, Math.abs(value - scalarValue));
          maxRelScalar = Math.max(maxRelScalar, relDiff(value, scalarValue));
          expect(Math.abs(value - scalarValue)).toBeLessThanOrEqual(allowedAbs(scalarValue));
        }
      }
    });
    expect(maxRelDense).toBeLessThanOrEqual(1e-6);
    expect(maxRelScalar).toBeLessThanOrEqual(1e-6);

    // Q_ii symmetry, positive variances, Q_ji bitwise transpose of Q_ij.
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
        expect(Array.from(transposed)).toEqual(Array.from(out).map((_, k) => out[(k % 3) * 3 + Math.floor(k / 3)]));
      }
    });

    // Determinism: same request twice is bitwise identical.
    const repeat = queryGnssSelectedBlocks({
      plan,
      paramIndex: network.paramIndex,
      system: network.system,
      solver,
    });
    expect(repeat.store.diag).toEqual(store.diag);
    expect(repeat.store.offDiag).toEqual(store.offDiag);
    expect(calls).toBe(1);
  });

  it('error paths: OOB block, blockSize <= 0, count 0 ok, NaN detection', async () => {
    const solver = await loadBlocksSolver();
    const network = buildBlockTestNetwork('chain', 6, 7);
    const rowStarts = (values: number[]): Int32Array => Int32Array.from(values);
    await expect(
      (async () => solver.queryBlocks({
        ...network.system,
        blockRowStarts: rowStarts([network.numParams]),
        blockColStarts: rowStarts([0]),
        blockSize: 3,
      }))(),
    ).rejects.toThrow(/outside parameter range/);
    await expect(
      (async () => solver.queryBlocks({
        ...network.system,
        blockRowStarts: rowStarts([0]),
        blockColStarts: rowStarts([0]),
        blockSize: 0,
      }))(),
    ).rejects.toThrow(/positive block size/);
    const empty = solver.queryBlocks({
      ...network.system,
      blockRowStarts: rowStarts([]),
      blockColStarts: rowStarts([]),
      blockSize: 3,
    });
    expect(empty.blocks.length).toBe(0);
    const poisoned = {
      ...network.system,
      design: {
        ...network.system.design,
        values: Float64Array.from(network.system.design.values, (value, index) =>
          (index === 0 ? Number.NaN : value)),
      },
    };
    expect(() => solver.queryBlocks({
      ...poisoned,
      blockRowStarts: rowStarts([0]),
      blockColStarts: rowStarts([0]),
      blockSize: 3,
    })).toThrow();
  });
});
