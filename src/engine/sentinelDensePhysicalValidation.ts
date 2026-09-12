/**
 * Phase 10L batch 2: full-dense specialized C3 physical validator.
 *
 * FAST PATH ONLY for proven-valid full-dense inputs: rows/cols/values
 * each of length n^2 with every (row, column) in 0..n-1 present exactly
 * once. A typed-integer packed index (position[row*n+col] -> value slot)
 * built once replaces the legacy string-key Map (`${row}|${col}`) plus
 * its per-lookup string allocations, and the same index serves C1/C2
 * bounded sample extraction without a second Map build.
 *
 * ANY malformed shape (length mismatch, out-of-range or non-integer
 * coordinates, any duplicate coordinate, missing coverage) falls back to
 * the legacy validateSentinelPhysical — never silently normalized. The
 * fast scans iterate the values array in query order and reproduce the
 * legacy valid flag, reason strings, reason ordering, and 8-reason cap
 * exactly. Generic preanalysis sentinel contract untouched: this module
 * is only called from the native full-Qxx verification path.
 */

import {
  PREANALYSIS_SPARSE_SYMMETRY_TOLERANCE,
  validateSentinelPhysical,
} from './preanalysisSparseCovarianceSentinel';

export interface DensePhysicalIndex {
  /** Packed slot per cell (row*n+col); always complete when built. */
  denseValues: Float64Array;
  n: number;
}

/**
 * Builds the packed dense index once, or returns null when the input is
 * not a proven-valid full-dense bijection (caller takes the legacy path).
 * Any duplicate coordinate returns null — even same-value duplicates, so
 * the fast scans only ever run over exact one-entry-per-cell inputs and
 * scan-order equivalence with legacy holds by construction. Array holes
 * also return null: legacy forEach skips holes while indexed reads would
 * see undefined (→ NaN), so holes take the legacy path.
 */
export const tryBuildDensePhysicalIndex = (
  queryRows: ArrayLike<number>,
  queryColumns: ArrayLike<number>,
  values: ArrayLike<number>,
  n: number,
): DensePhysicalIndex | null => {
  if (!Number.isInteger(n) || n <= 0) return null;
  const expected = n * n;
  if (
    queryRows.length !== expected ||
    queryColumns.length !== expected ||
    values.length !== expected
  ) {
    return null;
  }
  const denseValues = new Float64Array(expected);
  const seen = new Uint8Array(expected);
  const rowsObj = Object(queryRows);
  const colsObj = Object(queryColumns);
  const valsObj = Object(values);
  for (let k = 0; k < expected; k += 1) {
    // Hole guard: a missing index must fall back (see doc comment above).
    if (!(k in rowsObj) || !(k in colsObj) || !(k in valsObj)) {
      return null;
    }
    const row = queryRows[k] ?? -1;
    const column = queryColumns[k] ?? -1;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= n || column >= n) {
      return null;
    }
    const position = row * n + column;
    if (seen[position] === 1) return null;
    seen[position] = 1;
    denseValues[position] = values[k] ?? Number.NaN;
  }
  return { denseValues, n };
};

/**
 * Fast physical scans over a proven bijective full-dense input. Iterates
 * the values array in query order (same order as legacy) and uses the
 * packed index only for mirror/diagonal lookups. Reason strings, ordering,
 * and the 8-reason cap match validateSentinelPhysical exactly.
 */
export const scanDensePhysical = (
  index: DensePhysicalIndex,
  queryRows: ArrayLike<number>,
  queryColumns: ArrayLike<number>,
  values: ArrayLike<number>,
): { valid: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const fail = (reason: string): void => {
    if (reasons.length < 8) reasons.push(reason);
  };
  const { denseValues, n } = index;
  const count = values.length;
  for (let k = 0; k < count; k += 1) {
    const value = values[k] ?? Number.NaN;
    const row = queryRows[k] ?? -1;
    const column = queryColumns[k] ?? -1;
    if (!Number.isFinite(value)) {
      fail(`entry (${row},${column}): non-finite (${value})`);
      continue;
    }
    if (row === column && value <= 0) {
      fail(`diagonal (${row},${column}): non-positive (${value})`);
    }
  }
  for (let k = 0; k < count; k += 1) {
    const value = values[k] ?? Number.NaN;
    const row = queryRows[k] ?? -1;
    const column = queryColumns[k] ?? -1;
    if (row === column) continue;
    const mirror = denseValues[column * n + row] as number;
    const diff = Math.abs(value - mirror);
    const allowed = Math.max(PREANALYSIS_SPARSE_SYMMETRY_TOLERANCE, 1e-9 * Math.max(1, Math.abs(value)));
    if (diff > allowed) fail(`symmetry (${row},${column}): |${value}-${mirror}|=${diff.toExponential(2)}`);
  }
  // Cauchy-Schwarz: |c_ij| <= sqrt(c_ii c_jj) (with small slack).
  for (let k = 0; k < count; k += 1) {
    const value = values[k] ?? Number.NaN;
    const row = queryRows[k] ?? -1;
    const column = queryColumns[k] ?? -1;
    if (row === column || !Number.isFinite(value)) continue;
    const dii = denseValues[row * n + row] as number;
    const djj = denseValues[column * n + column] as number;
    if (!Number.isFinite(dii) || !Number.isFinite(djj)) continue;
    if (dii <= 0 || djj <= 0) continue;
    const bound = Math.sqrt(dii * djj) * (1 + 1e-6);
    if (Math.abs(value) > bound) {
      fail(`cauchy-schwarz (${row},${column}): |${value.toExponential(2)}| > ${bound.toExponential(2)}`);
    }
  }
  return { valid: reasons.length === 0, reasons };
};

/**
 * Full-dense C3 entry point for the native full-Qxx verification path:
 * fast packed-index scans when the input proves bijective, legacy
 * validateSentinelPhysical otherwise. Result includes which path ran so
 * tests can prove malformed inputs take the legacy path.
 */
export const validateDensePhysical = (args: {
  queryRows: Int32Array;
  queryColumns: Int32Array;
  values: number[];
  n: number;
}): { valid: boolean; reasons: string[]; fastPath: boolean } => {
  const index = tryBuildDensePhysicalIndex(args.queryRows, args.queryColumns, args.values, args.n);
  if (!index) {
    const legacy = validateSentinelPhysical({
      queryRows: args.queryRows,
      queryColumns: args.queryColumns,
      values: args.values,
    });
    return { ...legacy, fastPath: false };
  }
  return { ...scanDensePhysical(index, args.queryRows, args.queryColumns, args.values), fastPath: true };
};

/**
 * Bounded sample extraction through the packed index (replaces the
 * number-key nativeByKey Map for proven full-dense inputs). Out-of-range
 * sample coordinates yield NaN, matching the legacy `?? NaN` behavior.
 */
export const sampleDensePhysicalIndex = (
  index: DensePhysicalIndex,
  sampleRows: ArrayLike<number>,
  sampleColumns: ArrayLike<number>,
): number[] => {
  const { denseValues, n } = index;
  return Array.from(sampleRows, (row, k) => {
    const column = sampleColumns[k] ?? -1;
    const r = row ?? -1;
    if (!Number.isInteger(r) || !Number.isInteger(column) || r < 0 || column < 0 || r >= n || column >= n) {
      return Number.NaN;
    }
    return denseValues[r * n + column] as number;
  });
};
