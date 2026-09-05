import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import type { SparseMatrixRows } from '../src/engine/matrix';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
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

const loadTutorialInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf-8');

const summarizeStats = (observations: Observation[]): unknown =>
  observations.map((obs) => ({
    id: obs.id,
    stdRes: obs.stdRes,
    redundancy: obs.redundancy,
    mdb: obs.mdb,
  }));

const assertStatsClose = (actual: unknown, expected: unknown, label: string): void => {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    expect(Math.abs(actual - expected), label).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected)),
    );
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, label).toBe(expected.length);
    actual.forEach((value, index) => assertStatsClose(value, expected[index], `${label}[${index}]`));
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    keys.forEach((key) => assertStatsClose(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${label}.${key}`,
    ));
    return;
  }
  expect(actual, label).toEqual(expected);
};

describe('sparse selected-covariance recovery wiring', () => {
  it('matches dense Qxx precision with an injected selected-covariance solver', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceSelectedCovariance();
    const routed = new LSAEngine({ input, sparseSelectedCovarianceSolver: solver }).solve();
    expect(routed.success).toBe(true);
    expect(solver.seen.length).toBeGreaterThan(0);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      // Full Qxx demand: every parameter pair is queried in row-major order.
      expect(queried.queryRows.length).toBe(
        queried.parameterCount * queried.parameterCount,
      );
    }
    assertStatsClose(summarizeStats(routed.observations), summarizeStats(baseline.observations), 'stats');
  });

  it('falls back to dense covariance when the injected solver fails', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const failing: SparseSelectedCovarianceSolver = {
      querySelected: () => {
        throw new Error('experimental backend offline');
      },
    };
    const fallenBack = new LSAEngine({ input, sparseSelectedCovarianceSolver: failing }).solve();
    expect(fallenBack.success).toBe(true);
    expect(summarizeStats(fallenBack.observations)).toEqual(summarizeStats(baseline.observations));
  });
});
