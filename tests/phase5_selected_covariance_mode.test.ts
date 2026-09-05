import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import type { SparseMatrixRows } from '../src/engine/matrix';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import {
  createSelectedCovarianceStore,
  readSelectedCovariance,
} from '../src/engine/selectedCovarianceStore';
import type { Observation } from '../src/types';

/** Dense reference selected-covariance solver built from the engine's own dense helpers. */
const denseReferenceSelectedCovariance = (): SparseSelectedCovarianceSolver & {
  seen: SparseSelectedCovarianceInput[];
} => {
  const seen: SparseSelectedCovarianceInput[] = [];
  return {
    seen,
    querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
      seen.push(input);
      const eqCount = input.observationEquationCount;
      const paramCount = input.parameterCount;
      const sparseRows: SparseMatrixRows = Array.from({ length: eqCount }, () => []);
      for (let row = 0; row < eqCount; row += 1) {
        const start = input.design.rowOffsets[row] ?? 0;
        const end = input.design.rowOffsets[row + 1] ?? 0;
        for (let k = start; k < end; k += 1) {
          (sparseRows[row] as { index: number; value: number }[]).push({
            index: input.design.columns[k] ?? 0,
            value: input.design.values[k] ?? 0,
          });
        }
      }
      const weights = Array.from({ length: eqCount }, () => new Array<number>(eqCount).fill(0));
      for (let k = 0; k < input.weights.values.length; k += 1) {
        const row = input.weights.rows[k] ?? 0;
        const column = input.weights.columns[k] ?? 0;
        const value = input.weights.values[k] ?? 0;
        (weights[row] as number[])[column] = value;
        (weights[column] as number[])[row] = value;
      }
      const { normal } = accumulateNormalEquationsFromSparseRows(
        sparseRows,
        zeros(eqCount, 1),
        weights,
        paramCount,
      );
      const inverse = invertNormalMatrixForStats(normal, () => undefined);
      const covariance = new Float64Array(input.queryRows.length);
      for (let k = 0; k < input.queryRows.length; k += 1) {
        covariance[k] = inverse[input.queryRows[k] ?? 0]?.[input.queryColumns[k] ?? 0] ?? 0;
      }
      return { covariance, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
    },
  };
};

const loadCombinedInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/ts_triangulation_trilateration_2d.dat'), 'utf-8');

const assertClose = (actual: unknown, expected: unknown, label: string): void => {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    expect(Math.abs(actual - expected), label).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected)),
    );
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, label).toBe(expected.length);
    actual.forEach((value, index) => assertClose(value, expected[index], `${label}[${index}]`));
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    keys.forEach((key) => assertClose(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${label}.${key}`,
    ));
    return;
  }
  expect(actual, label).toEqual(expected);
};

const summarizeObservations = (observations: Observation[]): unknown =>
  observations.map((obs) => ({
    id: obs.id,
    stdRes: obs.stdRes,
    redundancy: obs.redundancy,
    mdb: obs.mdb,
  }));

describe('selected-network covariance mode', () => {
  it('matches station/relative precision with far fewer than n^2 queries', () => {
    const input = loadCombinedInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    expect(baseline.relativePrecision?.length).toBeGreaterThan(0);
    const solver = denseReferenceSelectedCovariance();
    const selected = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
    }).solve();
    expect(selected.success).toBe(true);
    expect(solver.seen.length).toBeGreaterThan(0);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      const denseDemand = queried.parameterCount * queried.parameterCount;
      // Selected mode queries plan entries only: station blocks plus
      // connected/requested pairs, never the dense all-entry demand.
      expect(queried.queryRows.length).toBeLessThan(denseDemand);
    }
    // Station blocks and connected/requested relative rows match the dense contract.
    assertClose(selected.stationCovariances, baseline.stationCovariances, 'stations');
    assertClose(selected.relativeCovariances, baseline.relativeCovariances, 'relative');
    assertClose(summarizeObservations(selected.observations), summarizeObservations(baseline.observations), 'stats');
    // Only the legacy all-pairs listing is skipped in selected mode.
    expect(selected.relativePrecision).toEqual([]);
  });

  it('covers REL/PTOL-requested pairs with matching values', () => {
    const input = `${loadCombinedInput()}\n.RELATIVE 2->4\n.PTOLERANCE 2->5\n`;
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const requested = (baseline.relativeCovariances ?? []).filter(
      (row) => row.selectedByRelativeDirective || row.selectedByPositionalToleranceDirective,
    );
    expect(requested.length).toBe(2);
    const solver = denseReferenceSelectedCovariance();
    const selected = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
    }).solve();
    expect(selected.success).toBe(true);
    assertClose(selected.relativeCovariances, baseline.relativeCovariances, 'relative');
    const selectedRequested = (selected.relativeCovariances ?? []).filter(
      (row) => row.selectedByRelativeDirective || row.selectedByPositionalToleranceDirective,
    );
    expect(selectedRequested.length).toBe(2);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      expect(queried.queryRows.length).toBeLessThan(
        queried.parameterCount * queried.parameterCount,
      );
    }
  });

  it('keeps the dense all-entry contract when selected mode is off', () => {
    const input = loadCombinedInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceSelectedCovariance();
    const routed = new LSAEngine({ input, sparseSelectedCovarianceSolver: solver }).solve();
    expect(routed.success).toBe(true);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      expect(queried.queryRows.length).toBe(
        queried.parameterCount * queried.parameterCount,
      );
    }
    expect(routed.relativePrecision?.length).toBe(baseline.relativePrecision?.length);
    assertClose(routed.stationCovariances, baseline.stationCovariances, 'stations');
    assertClose(routed.relativeCovariances, baseline.relativeCovariances, 'relative');
  });

  it('propagates selected mode into nested solves', () => {
    const input = loadCombinedInput();
    const seen: unknown[] = [];
    const originalSolve = LSAEngine.prototype.solve;
    // eslint-disable-next-line no-unused-vars
    LSAEngine.prototype.solve = function (this: LSAEngine) {
      seen.push(
        (this as unknown as Record<string, unknown>)['experimentalSelectedCovarianceMode'],
      );
      return originalSolve.apply(this);
    };
    try {
      const solver = denseReferenceSelectedCovariance();
      const result = new LSAEngine({
        input,
        parseOptions: { runMode: 'blunder-detect' },
        sparseSelectedCovarianceSolver: solver,
        experimentalSelectedCovarianceMode: true,
      }).solve();
      expect(result.success).toBe(true);
      expect(result.relativePrecision).toEqual([]);
    } finally {
      LSAEngine.prototype.solve = originalSolve;
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    seen.forEach((mode) => expect(mode).toBe(true));
  });

  it('fails closed on unqueried entries', () => {
    const store = createSelectedCovarianceStore(
      4,
      [{ row: 0, column: 0 }, { row: 0, column: 1 }],
      [1.5, 0.25],
    );
    expect(store.queryCount).toBe(2);
    expect(readSelectedCovariance(store, 0, 0)).toBe(1.5);
    // Symmetric orientation resolves through the canonical key.
    expect(readSelectedCovariance(store, 1, 0)).toBe(0.25);
    // Fixed-station (null) indices read as zero, never throw.
    expect(readSelectedCovariance(store, null, 0)).toBe(0);
    expect(() => readSelectedCovariance(store, 2, 3)).toThrow(/not queried/);
  });
});
