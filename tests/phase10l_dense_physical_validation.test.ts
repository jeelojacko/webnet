/**
 * Phase 10L batch 2: old-vs-new differential for the full-dense C3
 * physical validator (agent tier).
 *
 * Every case requires exact valid/reasons/ordering equality between the
 * legacy validateSentinelPhysical and the new validateDensePhysical,
 * plus explicit fallback-proof assertions (malformed inputs take the
 * legacy path). Sample extraction (packed index vs number-key Map) is
 * covered differentially as well.
 */
import { describe, expect, it } from 'vitest';

import { validateSentinelPhysical } from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  sampleDensePhysicalIndex,
  tryBuildDensePhysicalIndex,
  validateDensePhysical,
} from '../src/engine/sentinelDensePhysicalValidation';

/** Deterministic SPD matrix: diagonally dominant, symmetric by construction. */
const buildSpd = (n: number): number[][] => {
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 4 + (i % 5);
      return ((i * 7 + j * 13 + 1) % 11 - 5) / 40;
    }),
  );
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const symmetric = (matrix[i]![j]! + matrix[j]![i]!) / 2;
      matrix[i]![j] = symmetric;
      matrix[j]![i] = symmetric;
    }
  }
  return matrix;
};

const flattenRowMajor = (matrix: number[][]): { rows: Int32Array; columns: Int32Array; values: number[] } => {
  const n = matrix.length;
  const rows: number[] = [];
  const columns: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      rows.push(i);
      columns.push(j);
      values.push(matrix[i]![j]!);
    }
  }
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns), values };
};

/** Deterministic permutation: reverse + rotate. */
const permute = (
  shape: { rows: Int32Array; columns: Int32Array; values: number[] },
  order: number[],
): { rows: Int32Array; columns: Int32Array; values: number[] } => ({
  rows: Int32Array.from(order.map((k) => shape.rows[k])),
  columns: Int32Array.from(order.map((k) => shape.columns[k])),
  values: order.map((k) => shape.values[k]),
});

const reversedOrder = (length: number): number[] =>
  Array.from({ length }, (_, k) => length - 1 - k);

const legacySample = (
  rows: Int32Array,
  columns: Int32Array,
  values: number[],
  n: number,
  sampleRows: ArrayLike<number>,
  sampleColumns: ArrayLike<number>,
): number[] => {
  const byKey = new Map<number, number>();
  for (let k = 0; k < rows.length; k += 1) {
    byKey.set((rows[k] ?? -1) * n + (columns[k] ?? -1), values[k] ?? Number.NaN);
  }
  return Array.from(sampleRows, (row, k) => byKey.get((row ?? -1) * n + (sampleColumns[k] ?? -1)) ?? Number.NaN);
};

describe('phase 10L dense physical validation differential', () => {
  const expectExactMatch = (
    shape: { rows: Int32Array; columns: Int32Array; values: number[] },
    n: number,
    fastPath: boolean,
  ): void => {
    const legacy = validateSentinelPhysical({ queryRows: shape.rows, queryColumns: shape.columns, values: shape.values });
    const next = validateDensePhysical({ queryRows: shape.rows, queryColumns: shape.columns, values: shape.values, n });
    expect(next.fastPath).toBe(fastPath);
    expect(next.valid).toBe(legacy.valid);
    expect(next.reasons).toEqual(legacy.reasons);
  };

  it('valid SPD row-major takes the fast path and matches legacy', () => {
    expectExactMatch(flattenRowMajor(buildSpd(4)), 4, true);
  });

  it('valid SPD n=16 takes the fast path and matches legacy', () => {
    expectExactMatch(flattenRowMajor(buildSpd(16)), 16, true);
  });

  it('query-order permutations match legacy with fast path', () => {
    const shape = flattenRowMajor(buildSpd(6));
    expectExactMatch(permute(shape, reversedOrder(shape.values.length)), 6, true);
    const columnMajor = shape.values.map((_, k) => (k % 6) * 6 + Math.floor(k / 6));
    expectExactMatch(permute(shape, columnMajor), 6, true);
  });

  it('asymmetric covariance matches legacy with fast path', () => {
    const shape = flattenRowMajor(buildSpd(5));
    shape.values[1 * 5 + 3]! += 1e-3;
    expectExactMatch(shape, 5, true);
  });

  it('tiny asymmetry within tolerance still passes identically', () => {
    const shape = flattenRowMajor(buildSpd(5));
    shape.values[0 * 5 + 4]! += 1e-12;
    expectExactMatch(shape, 5, true);
  });

  it('non-positive diagonals match legacy with fast path', () => {
    const zero = flattenRowMajor(buildSpd(4));
    zero.values[2 * 4 + 2] = 0;
    expectExactMatch(zero, 4, true);
    const negative = flattenRowMajor(buildSpd(4));
    negative.values[0] = -3;
    expectExactMatch(negative, 4, true);
  });

  it('NaN and Infinity entries match legacy with fast path', () => {
    const nan = flattenRowMajor(buildSpd(4));
    nan.values[7] = Number.NaN;
    expectExactMatch(nan, 4, true);
    const inf = flattenRowMajor(buildSpd(4));
    inf.values[3 * 4 + 1] = Number.POSITIVE_INFINITY;
    expectExactMatch(inf, 4, true);
    const nanDiag = flattenRowMajor(buildSpd(4));
    nanDiag.values[0] = Number.NaN;
    expectExactMatch(nanDiag, 4, true);
  });

  it('Cauchy-Schwarz violation matches legacy with fast path', () => {
    const shape = flattenRowMajor(buildSpd(4));
    shape.values[0 * 4 + 1] = 1e6;
    shape.values[1 * 4 + 0] = 1e6;
    expectExactMatch(shape, 4, true);
  });

  it('reason cap (8) matches legacy exactly under mass violation', () => {
    const n = 4;
    const shape = flattenRowMajor(buildSpd(n));
    for (let k = 0; k < 10; k += 1) shape.values[k] = Number.NaN;
    const legacy = validateSentinelPhysical({ queryRows: shape.rows, queryColumns: shape.columns, values: shape.values });
    expect(legacy.reasons).toHaveLength(8);
    expectExactMatch(shape, n, true);
  });

  it('missing entries fall back to legacy and match', () => {
    const full = flattenRowMajor(buildSpd(4));
    const drop = (index: number): { rows: Int32Array; columns: Int32Array; values: number[] } => ({
      rows: Int32Array.from(full.rows.filter((_, k) => k !== index)),
      columns: Int32Array.from(full.columns.filter((_, k) => k !== index)),
      values: full.values.filter((_, k) => k !== index),
    });
    expectExactMatch(drop(5), 4, false);
    expectExactMatch(drop(0), 4, false);
  });

  it('duplicate coordinates fall back to legacy and match', () => {
    const full = flattenRowMajor(buildSpd(4));
    const sameValue = {
      rows: Int32Array.from([...full.rows.slice(0, 15), full.rows[0]]),
      columns: Int32Array.from([...full.columns.slice(0, 15), full.columns[0]]),
      values: [...full.values.slice(0, 15), full.values[0]],
    };
    expectExactMatch(sameValue, 4, false);
    const conflicting = {
      rows: Int32Array.from([...full.rows.slice(0, 15), full.rows[0]]),
      columns: Int32Array.from([...full.columns.slice(0, 15), full.columns[0]]),
      values: [...full.values.slice(0, 15), (full.values[0] ?? 0) + 1],
    };
    expectExactMatch(conflicting, 4, false);
    const legacy = validateSentinelPhysical({
      queryRows: conflicting.rows,
      queryColumns: conflicting.columns,
      values: conflicting.values,
    });
    const next = validateDensePhysical({
      queryRows: conflicting.rows,
      queryColumns: conflicting.columns,
      values: conflicting.values,
      n: 4,
    });
    expect(next.fastPath).toBe(false);
    expect(next.reasons).toEqual(legacy.reasons);
  });

  it('malformed coordinates fall back to legacy and match', () => {
    const full = flattenRowMajor(buildSpd(4));
    const outOfRange = { rows: Int32Array.from(full.rows), columns: Int32Array.from(full.columns), values: [...full.values] };
    outOfRange.rows[3] = 4;
    expectExactMatch(outOfRange, 4, false);
    const negative = { rows: Int32Array.from(full.rows), columns: Int32Array.from(full.columns), values: [...full.values] };
    negative.columns[6] = -1;
    expectExactMatch(negative, 4, false);
    expect(tryBuildDensePhysicalIndex([0, 1.5, 0, 1], [0, 0, 1, 1], [4, 0, 0, 4], 2)).toBeNull();
  });

  it('holey arrays fall back to legacy and match', () => {
    const full = flattenRowMajor(buildSpd(4));
    const holeyValues: number[] = [...full.values];
    delete holeyValues[5];
    const legacy = validateSentinelPhysical({
      queryRows: Int32Array.from(full.rows),
      queryColumns: Int32Array.from(full.columns),
      values: holeyValues,
    });
    const next = validateDensePhysical({
      queryRows: Int32Array.from(full.rows),
      queryColumns: Int32Array.from(full.columns),
      values: holeyValues,
      n: 4,
    });
    expect(next.fastPath).toBe(false);
    expect(next.valid).toBe(legacy.valid);
    expect(next.reasons).toEqual(legacy.reasons);
    expect(tryBuildDensePhysicalIndex(full.rows, full.columns, holeyValues, 4)).toBeNull();
  });

  it('partial query shapes fall back to legacy and match', () => {
    const n = 4;
    const matrix = buildSpd(n);
    const diagonal = {
      rows: Int32Array.from([0, 1, 2, 3]),
      columns: Int32Array.from([0, 1, 2, 3]),
      values: [matrix[0]![0]!, matrix[1]![1]!, matrix[2]![2]!, matrix[3]![3]!],
    };
    expectExactMatch(diagonal, n, false);
    const full = flattenRowMajor(matrix);
    const oneColumn = {
      rows: Int32Array.from([0, 1, 2, 3]),
      columns: Int32Array.from([2, 2, 2, 2]),
      values: [matrix[0]![2]!, matrix[1]![2]!, matrix[2]![2]!, matrix[3]![2]!],
    };
    expectExactMatch(oneColumn, n, false);
    expectExactMatch(full, n + 1, false);
  });

  it('length mismatch falls back to legacy and match', () => {
    const full = flattenRowMajor(buildSpd(3));
    const short = { rows: full.rows.slice(0, 8), columns: full.columns.slice(0, 8), values: full.values.slice(0, 8) };
    expectExactMatch(short, 3, false);
  });

  it('packed sample extraction matches the legacy number-key Map', () => {
    const n = 6;
    const shape = permute(flattenRowMajor(buildSpd(n)), reversedOrder(n * n));
    const index = tryBuildDensePhysicalIndex(shape.rows, shape.columns, shape.values, n);
    expect(index).not.toBeNull();
    const sampleRows = [0, 5, 2, 5, 0];
    const sampleColumns = [0, 5, 3, 0, 5];
    expect(sampleDensePhysicalIndex(index!, sampleRows, sampleColumns)).toEqual(
      legacySample(shape.rows, shape.columns, shape.values, n, sampleRows, sampleColumns),
    );
    expect(sampleDensePhysicalIndex(index!, [0, n, -1], [0, 0, 0])).toEqual([
      legacySample(shape.rows, shape.columns, shape.values, n, [0], [0])[0],
      Number.NaN,
      Number.NaN,
    ]);
  });
});
