import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  queryStandardizedResidualRowProducts,
  type StandardizedResidualRowProductRequest,
} from '../src/engine/adjustStatisticsRowProducts';
import type {
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
} from '../src/engine/numericalBackend';
import type { Observation } from '../src/types';

/** Dense Gauss-Jordan reference, independent of the engine's inversion path. */
const invertDense = (matrix: number[][]): number[][] => {
  const n = matrix.length;
  const work = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(work[row][col]) > Math.abs(work[pivot][col])) pivot = row;
    }
    const pivotValue = work[pivot][col];
    if (!Number.isFinite(pivotValue) || Math.abs(pivotValue) < 1e-15) {
      throw new Error('Reference solver hit a singular normal matrix.');
    }
    [work[col], work[pivot]] = [work[pivot], work[col]];
    const scale = work[col][col];
    for (let j = 0; j < 2 * n; j += 1) work[col][j] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = work[row][col];
      for (let j = 0; j < 2 * n; j += 1) work[row][j] -= factor * work[col][j];
    }
  }
  return work.map((row) => row.slice(n));
};

const denseReferenceSolver = (): SparseRowProductsSolver => ({
  queryRowProducts(input: SparseRowProductsInput): SparseRowProductsResult {
    const eqCount = input.observationEquationCount;
    const paramCount = input.parameterCount;
    const designNnz = input.design.values.length;
    if (input.design.rowOffsets.length !== eqCount + 1 || designNnz !== input.design.columns.length) {
      throw new Error('Reference solver saw inconsistent design packing.');
    }
    const dense = Array.from({ length: eqCount }, () => new Array<number>(paramCount).fill(0));
    for (let row = 0; row < eqCount; row += 1) {
      for (let k = input.design.rowOffsets[row]; k < input.design.rowOffsets[row + 1]; k += 1) {
        dense[row][input.design.columns[k]] = input.design.values[k];
      }
    }
    const weight = Array.from({ length: eqCount }, () => new Array<number>(eqCount).fill(0));
    for (let k = 0; k < input.weights.values.length; k += 1) {
      const r = input.weights.rows[k] ?? -1;
      const c = input.weights.columns[k] ?? -1;
      weight[r][c] = input.weights.values[k];
      weight[c][r] = input.weights.values[k];
    }
    const normal = Array.from({ length: paramCount }, () => new Array<number>(paramCount).fill(0));
    for (let i = 0; i < paramCount; i += 1) {
      for (let j = 0; j < paramCount; j += 1) {
        let sum = 0;
        for (let a = 0; a < eqCount; a += 1) {
          for (let b = 0; b < eqCount; b += 1) {
            sum += dense[a][i] * weight[a][b] * dense[b][j];
          }
        }
        normal[i][j] = sum;
      }
    }
    const inverse = invertDense(normal);
    const queryRowCount = input.queryRowOffsets.length - 1;
    if (input.queryValues.length !== input.queryColumns.length) {
      throw new Error('Reference solver saw inconsistent query packing.');
    }
    const queryRow = (row: number): number[] => {
      const out = new Array<number>(paramCount).fill(0);
      for (let k = input.queryRowOffsets[row]; k < input.queryRowOffsets[row + 1]; k += 1) {
        out[input.queryColumns[k]] = input.queryValues[k];
      }
      return out;
    };
    const form = (left: number[], right: number[]): number => {
      let sum = 0;
      for (let i = 0; i < paramCount; i += 1) {
        for (let j = 0; j < paramCount; j += 1) sum += left[i] * inverse[i][j] * right[j];
      }
      return sum;
    };
    const quadratic = new Float64Array(queryRowCount);
    for (let row = 0; row < queryRowCount; row += 1) {
      const vector = queryRow(row);
      quadratic[row] = form(vector, vector);
    }
    const cross = new Float64Array(input.crossA.length);
    for (let c = 0; c < input.crossA.length; c += 1) {
      cross[c] = form(queryRow(input.crossA[c] ?? -1), queryRow(input.crossB[c] ?? -1));
    }
    return { quadratic, cross, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
  },
});

const loadTutorialInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf-8');

const summarizeStats = (observations: Observation[]): unknown[] =>
  observations.map((obs) => ({
    id: obs.id,
    stdRes: obs.stdRes,
    redundancy: obs.redundancy,
    mdb: obs.mdb,
    localTest: obs.localTest,
    stdResComponents: obs.stdResComponents,
    redundancyComponents: (obs as { redundancyComponents?: unknown }).redundancyComponents,
    localTestComponents: obs.localTestComponents,
    mdbComponents: obs.mdbComponents,
    componentStdRes: (obs as { componentStdRes?: unknown }).componentStdRes,
    componentResidualStdErr: (obs as { componentResidualStdErr?: unknown }).componentResidualStdErr,
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

describe('standardized residual row-product routing', () => {
  it('matches dense standardized residuals when a solver is injected', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const seen: SparseRowProductsInput[] = [];
    const solver = denseReferenceSolver();
    const recording: SparseRowProductsSolver = {
      queryRowProducts: (request) => {
        seen.push(request);
        return solver.queryRowProducts(request);
      },
    };
    const routed = new LSAEngine({ input, sparseRowProductsSolver: recording }).solve();
    expect(routed.success).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((request) => {
      expect(request.queryRowOffsets.length - 1).toBe(request.observationEquationCount);
      expect(request.crossA.length).toBe(request.crossB.length);
    });
    assertStatsClose(summarizeStats(routed.observations), summarizeStats(baseline.observations), 'stdRes');
  });

  it('falls back to dense statistics when the injected solver fails', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    const failing: SparseRowProductsSolver = {
      queryRowProducts: () => {
        throw new Error('experimental backend offline');
      },
    };
    const routed = new LSAEngine({ input, sparseRowProductsSolver: failing }).solve();
    expect(routed.success).toBe(true);
    expect(summarizeStats(routed.observations)).toEqual(summarizeStats(baseline.observations));
    expect(routed.logs.some((line) => line.includes('sparse row-product'))).toBe(true);
  });

  it('packs a three-component GPS group into nine ordered cross pairs', () => {
    const gpsObs = {
      id: 7, type: 'gps', from: 'A', to: 'B', obs: { dE: 1, dN: 2, dU: 3 },
    } as unknown as Observation;
    const request: StandardizedResidualRowProductRequest = {
      sparseRows: [
        [{ index: 0, value: 1 }],
        [{ index: 1, value: 1 }],
        [{ index: 0, value: 0.5 }, { index: 1, value: 0.5 }],
      ],
      weights: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      rowInfo: [
        { obs: gpsObs, component: 'E' },
        { obs: gpsObs, component: 'N' },
        { obs: gpsObs, component: 'U' },
      ],
      activeObservations: [gpsObs],
      observationEquationCount: 3,
      parameterCount: 2,
    };
    const spy = vi.fn((input: SparseRowProductsInput): SparseRowProductsResult => ({
      quadratic: new Float64Array([1, 2, 3]),
      cross: Float64Array.from({ length: input.crossA.length }, (_, c) => (input.crossA[c] ?? 0) * 10 + (input.crossB[c] ?? 0)),
      normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0,
    }));
    const products = queryStandardizedResidualRowProducts({ queryRowProducts: spy }, { ...request });
    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]?.[0];
    expect(sent?.observationEquationCount).toBe(3);
    expect(sent?.parameterCount).toBe(2);
    expect(Array.from(sent?.queryRowOffsets ?? [])).toEqual([0, 1, 2, 4]);
    expect(Array.from(sent?.crossA ?? [])).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(Array.from(sent?.crossB ?? [])).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(Array.from(products.quadratic)).toEqual([1, 2, 3]);
    expect(products.crossFor(0, 2)).toBe(2);
    expect(products.crossFor(2, 1)).toBe(21);
    expect(products.crossFor(0, 9)).toBeUndefined();
  });

  it('requests four ordered cross pairs for a two-component GPS pair', () => {
    const gpsObs = { id: 9, type: 'gps', from: 'A', to: 'B', obs: { dE: 1, dN: 2 } } as unknown as Observation;
    const spy = vi.fn((input: SparseRowProductsInput): SparseRowProductsResult => ({
      quadratic: new Float64Array(input.queryRowOffsets.length - 1),
      cross: new Float64Array(input.crossA.length),
      normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0,
    }));
    const products = queryStandardizedResidualRowProducts({ queryRowProducts: spy }, {
      sparseRows: [[{ index: 0, value: 1 }], [{ index: 1, value: 1 }]],
      weights: [[2, 0.5], [0.5, 3]],
      rowInfo: [{ obs: gpsObs, component: 'E' }, { obs: gpsObs, component: 'N' }],
      activeObservations: [gpsObs],
      observationEquationCount: 2,
      parameterCount: 2,
    });
    expect(Array.from(spy.mock.calls[0]?.[0].crossA ?? [])).toEqual([0, 0, 1, 1]);
    expect(Array.from(spy.mock.calls[0]?.[0].crossB ?? [])).toEqual([0, 1, 0, 1]);
    // Correlated weights still pack the shared off-diagonal pair once.
    expect(spy.mock.calls[0]?.[0].weights.values.length).toBe(3);
    expect(products.crossFor(0, 1)).toBe(0);
    expect(products.crossFor(1, 1)).toBe(0);
  });

  it('requests no cross pairs without multi-row GPS groups', () => {
    const distObs = { id: 3, type: 'dist', from: 'A', to: 'B', obs: 10 } as unknown as Observation;
    const spy = vi.fn((input: SparseRowProductsInput): SparseRowProductsResult => ({
      quadratic: new Float64Array(input.queryRowOffsets.length - 1),
      cross: new Float64Array(0),
      normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0,
    }));
    queryStandardizedResidualRowProducts({ queryRowProducts: spy }, {
      sparseRows: [[{ index: 0, value: 2 }]],
      weights: [[1]],
      rowInfo: [{ obs: distObs }],
      activeObservations: [distObs],
      observationEquationCount: 1,
      parameterCount: 1,
    });
    expect(spy.mock.calls[0]?.[0].crossA.length).toBe(0);
    expect(spy.mock.calls[0]?.[0].crossB.length).toBe(0);
  });

  it('rejects damped row products so callers fall back to dense', () => {
    const distObs = { id: 3, type: 'dist', from: 'A', to: 'B', obs: 10 } as unknown as Observation;
    const damped: SparseRowProductsSolver = {
      queryRowProducts: (input) => ({
        quadratic: new Float64Array(input.queryRowOffsets.length - 1),
        cross: new Float64Array(input.crossA.length),
        normalNnz: 0, factorNnz: 0, damping: 1e-8, dampingAttempts: 1,
      }),
    };
    expect(() => queryStandardizedResidualRowProducts(damped, {
      sparseRows: [[{ index: 0, value: 2 }]],
      weights: [[1]],
      rowInfo: [{ obs: distObs }],
      activeObservations: [distObs],
      observationEquationCount: 1,
      parameterCount: 1,
    })).toThrow(/diagonal damping/);
  });
});
