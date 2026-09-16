/**
 * Phase 15E: solve-local memo for dense-Qxx residual-covariance row products.
 *
 * On the dense-Qxx statistics path the transient B = A·Qxx (m×n) already has
 * a solve-local lifetime shared by every consumer (diagonal, cross terms,
 * stochastic blocks, external reliability), so no second B is ever built.
 * What repeats is the quadratic-form dot `B[rowA]·a_rowB`: the GPS block
 * covariance, the statistical-MDB sensitivity, and the stochastic block /
 * TS-cross assembly each re-dot the same ordered equation pairs.
 *
 * This cache memoizes those ordered-pair products per statistics call. The
 * first computation uses the IDENTICAL accumulation order as the legacy
 * inline dots (sparse entries in order, `?? 0` fallbacks), so reuse is
 * bit-identical; the memo only skips exact recomputation. Cache keys are
 * equation-row indexes (rowInfo order), never observation ids. Storage is
 * one float per unique ordered pair — no m×n retention.
 *
 * Lifetime is solve-local only: the caller creates one cache per
 * statistics call (primary solve, each LOO alternate, each auto-adjust
 * solve, post-final robust stats), and it is never shared across solves
 * or iterations. No module-global cached values exist; only the kill
 * switch and the last-call telemetry snapshot are module state.
 *
 * Kill switch: module-local, default ON, test-only. Disabling it restores
 * the legacy recompute-everything behavior with identical numerics (same
 * arithmetic, no memo). There is no user setting.
 */
import type { Matrix, SparseMatrixRows } from './matrixTypes';

export interface DenseRowProductCacheCounters {
  /** Every quadratic/cross request (diagonal + cross terms). */
  rowProductRequests: number;
  /** Diagonal a_i·u_i requests (phase-one qvv loop). */
  quadraticFormRequests: number;
  /** Off-diagonal a_A·u_B requests (GPS/sensitivity/stochastic). */
  crossTermRequests: number;
  /** Dots actually performed (legacy cost = this with the switch OFF). */
  computations: number;
  /** Requests served from the memo. */
  cacheHits: number;
  /** Distinct ordered pairs computed (memo size). */
  uniquePairsComputed: number;
}

const zeroCounters = (): DenseRowProductCacheCounters => ({
  rowProductRequests: 0,
  quadraticFormRequests: 0,
  crossTermRequests: 0,
  computations: 0,
  cacheHits: 0,
  uniquePairsComputed: 0,
});

let reuseEnabled = true;

/** Test-only kill switch (default ON). No user setting. */
export const setStatisticsDenseRowProductReuseEnabled = (enabled: boolean): void => {
  reuseEnabled = enabled;
};

export const isStatisticsDenseRowProductReuseEnabled = (): boolean => reuseEnabled;

let lastCounters: DenseRowProductCacheCounters | null = null;

/** Telemetry only (tests/benchmarks): snapshot of the last recorded call. */
export const getLastDenseRowProductCounters = (): DenseRowProductCacheCounters | null =>
  lastCounters == null ? null : { ...lastCounters };

/** Called once per statistics call by the dense-path owner. Not UI data. */
export const recordDenseRowProductCounters = (
  counters: DenseRowProductCacheCounters,
): void => {
  lastCounters = { ...counters };
};

export interface DenseRowProductCache {
  /** Memoized a_row·(B[row]) — the diagonal quadratic form. */
  quadratic: (_row: number) => number | undefined;
  /** Memoized B[rowA]·a_rowB ordered-pair cross term. */
  cross: (_rowA: number, _rowB: number) => number | undefined;
  counters: DenseRowProductCacheCounters;
}

/**
 * Solve-local memo over the transient dense B rows. Fail-closed exactly
 * like the legacy inline code: a missing B row yields undefined (the cross
 * readers already treat that as unavailable), and every other shape
 * (empty rows, NaN) flows through the same arithmetic untouched.
 */
export const createDenseRowProductCache = (
  B: Matrix,
  sparseRows: SparseMatrixRows,
): DenseRowProductCache => {
  const rowCount = sparseRows.length;
  const memo = new Map<number, number>();
  const counters = zeroCounters();
  // Single tested dot helper with the IDENTICAL accumulation order of the
  // legacy inline dots: sparse entries in order, `?? 0` fallbacks.
  const dotRow = (rowA: number, rowB: number): number | undefined => {
    const brow = B[rowA];
    if (!brow) return undefined;
    const arow = sparseRows[rowB] ?? [];
    let sum = 0;
    for (let entryIndex = 0; entryIndex < arow.length; entryIndex += 1) {
      const entry = arow[entryIndex];
      sum += (brow[entry.index] ?? 0) * entry.value;
    }
    return sum;
  };
  const product = (rowA: number, rowB: number, diagonal: boolean): number | undefined => {
    counters.rowProductRequests += 1;
    if (diagonal) counters.quadraticFormRequests += 1;
    else counters.crossTermRequests += 1;
    if (!reuseEnabled || !(rowCount > 0)) {
      // Kill switch OFF (or degenerate shape): legacy behavior, every dot
      // recomputed with identical arithmetic.
      const value = dotRow(rowA, rowB);
      if (value !== undefined) counters.computations += 1;
      return value;
    }
    const key = rowA * rowCount + rowB;
    const hit = memo.get(key);
    if (hit !== undefined) {
      counters.cacheHits += 1;
      return hit;
    }
    const value = dotRow(rowA, rowB);
    if (value === undefined) return undefined;
    memo.set(key, value);
    counters.computations += 1;
    counters.uniquePairsComputed = memo.size;
    return value;
  };
  return {
    quadratic: (row) => product(row, row, true),
    cross: (rowA, rowB) => product(rowA, rowB, rowA === rowB),
    counters,
  };
};
