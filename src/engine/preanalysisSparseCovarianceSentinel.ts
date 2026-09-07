/**
 * Phase 8A.7 production-safe packed sparse normal accumulator + covariance sentinel.
 *
 * Production-safe pure sentinel built from the same packed sparse inputs the sparse backend consumes. It never allocates a dense weight matrix P and never reconstructs a full dense Qxx. The Phase 8A.6 evidence math is reused verbatim under neutral names; this module has no test/script imports and is safe for production routing (the route is enabled by default after Phase 8B.2, with an internal rollback switch).
 *
 * Designs:
 * - C1 selected-entry oracle: captured native values vs a TS reference
 *   solved at the same selected entries (reference only, fail-closed).
 *   The reference factors dense N exactly once and solves only the
 *   distinct queried columns: no full inverse and no dense Qxx are ever
 *   materialized. At least one queried entry is required; C1 judges every
 *   queried entry (complete columns are C2's job).
 * - C2 inverse residual: ||N q_j - e_j|| per column judged on the CAPTURED
 *   native/selected-solver values (never a re-solved TS factor, which
 *   would be tautological). Columns need full-row coverage or C2 fails
 *   closed. Native re-verification uses a bounded deterministic set of
 *   complete columns (hard k = 16), never an n^2 all-pairs re-query.
 * - C3 hybrid: C1 (when an oracle is available) AND C2 must both pass.
 */

import {
  choleskyDecomposeWithDamping,
  solveSPDFromCholesky,
} from './matrixCholesky';
import {
  scaleNormalMatrix,
  scaleNormalRhs,
  unscaleNormalSolution,
} from './adjustNormalMatrixHelpers';
import type { Matrix } from './matrixTypes';

/** Hard cap: column probes are only defined for bounded planning systems. */
export const PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT = 128;

/** Relative tolerance for C1 dense-selected agreement at selected entries. */
export const PREANALYSIS_SPARSE_C1_RELATIVE_TOLERANCE = 1e-6;

/** Absolute floor under the C1 relative tolerance (mirrors contract gates). */
export const PREANALYSIS_SPARSE_C1_ABSOLUTE_FLOOR = 1e-12;

/**
 * Hard verification-column bound for C2 native re-verification.
 *
 * Rationale: the pre-8B route re-queried all n^2 entries natively per
 * planning system (16,384 entries at n = 128, ~15 ms/system, ~960 ms
 * over a full 64-system session; see reports/phase8b/pre-sentinel-cost.md).
 * k = 16 complete columns cost 2,048 entries / ~2.3 ms at n = 128.
 * Columns are evenly spaced including 0 and n-1, each verified over all
 * n rows (full columns only); systems with n <= k verify every column.
 */
export const PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT = 16;

/** Infinity-norm tolerance for the C2 inverse residual per column. */
export const PREANALYSIS_SPARSE_C2_RESIDUAL_TOLERANCE = 1e-6;

/** Symmetry tolerance for probed (r,c)/(c,r) pairs. */
export const PREANALYSIS_SPARSE_SYMMETRY_TOLERANCE = 1e-9;

export interface PreanalysisSparsePackedDesign {
  rowOffsets: Int32Array;
  columns: Int32Array;
  values: Float64Array;
}

export interface PreanalysisSparsePackedUpperWeights {
  rows: Int32Array;
  columns: Int32Array;
  values: Float64Array;
}

export interface PreanalysisSparsePackedSystem {
  design: PreanalysisSparsePackedDesign;
  weights: PreanalysisSparsePackedUpperWeights;
  observationEquationCount: number;
  parameterCount: number;
}

export interface PreanalysisSparseProbeResult {
  /** One value per query, in query order. */
  values: number[];
  /** Columns actually factored (sorted, deduped). */
  probedColumns: number[];
  /** True when the factor required damping (fail-closed, values unusable). */
  damped: boolean;
  damping: number;
  conditionEstimate?: number;
}

interface SparseRowEntry {
  index: number;
  value: number;
}

const readDesignRow = (
  design: PreanalysisSparsePackedDesign,
  row: number,
): SparseRowEntry[] => {
  const start = design.rowOffsets[row] ?? 0;
  const end = design.rowOffsets[row + 1] ?? start;
  const entries: SparseRowEntry[] = [];
  for (let k = start; k < end; k += 1) {
    entries.push({
      index: design.columns[k] ?? -1,
      value: design.values[k] ?? Number.NaN,
    });
  }
  return entries;
};

/**
 * Accumulates the dense normal matrix N = A' W A directly from packed
 * sparse inputs. No dense P (m x m) is ever allocated: each packed
 * upper-triangle weight entry fans out over its two sparse design rows.
 * N itself is n x n with n <= cap; the cap is enforced fail-closed.
 */
export const accumulatePackedNormal = (system: PreanalysisSparsePackedSystem): Matrix => {
  const n = system.parameterCount;
  const m = system.observationEquationCount;
  if (!Number.isInteger(n) || n <= 0) throw new Error('sentinel requires at least one parameter.');
  if (n > PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT) {
    throw new Error(
      `sentinel cap: ${n} unknowns exceed ${PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT} (fail-closed).`,
    );
  }
  if (!Number.isInteger(m) || m < 0) throw new Error('sentinel requires a non-negative equation count.');
  const normal: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const entryCount = system.weights.rows.length;
  for (let k = 0; k < entryCount; k += 1) {
    const r = system.weights.rows[k] ?? -1;
    const c = system.weights.columns[k] ?? -1;
    const w = system.weights.values[k] ?? Number.NaN;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= m || c >= m) {
      throw new Error(`sentinel weight entry ${k} is outside equation range (fail-closed).`);
    }
    if (!Number.isFinite(w)) throw new Error(`sentinel weight entry ${k} is non-finite (fail-closed).`);
    if (c < r) throw new Error(`sentinel weight entry ${k} is not upper-triangular (fail-closed).`);
    if (w === 0) continue;
    const rowR = readDesignRow(system.design, r);
    if (r === c) {
      for (const a of rowR) {
        if (a.index < 0 || a.index >= n || !Number.isFinite(a.value)) {
          throw new Error(`sentinel design row ${r} carries an invalid entry (fail-closed).`);
        }
        for (const b of rowR) {
          normal[a.index]![b.index]! += a.value * w * b.value;
        }
      }
    } else {
      const rowC = readDesignRow(system.design, c);
      for (const a of rowR) {
        if (a.index < 0 || a.index >= n || !Number.isFinite(a.value)) {
          throw new Error(`sentinel design row ${r} carries an invalid entry (fail-closed).`);
        }
        for (const b of rowC) {
          if (b.index < 0 || b.index >= n || !Number.isFinite(b.value)) {
            throw new Error(`sentinel design row ${c} carries an invalid entry (fail-closed).`);
          }
          const contribution = a.value * w * b.value;
          normal[a.index]![b.index]! += contribution;
          normal[b.index]![a.index]! += contribution;
        }
      }
    }
  }
  return normal;
};

/**
 * Solves only the needed covariance columns of N^-1 for the selected
 * (row, column) queries. Queries are validated and columns are probed in
 * sorted order so repeats are byte-deterministic. Damped factors fail
 * closed (no usable values). Uses the existing scaled Cholesky primitives.
 */
export const probeSelectedCovariance = (
  normal: Matrix,
  queryRows: Int32Array,
  queryColumns: Int32Array,
): PreanalysisSparseProbeResult => {
  const n = normal.length;
  if (n === 0 || n > PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT) {
    throw new Error('sentinel probe requires 1..128 parameters (fail-closed).');
  }
  if (queryRows.length !== queryColumns.length) {
    throw new Error('sentinel probe requires one row per query column (fail-closed).');
  }
  for (let k = 0; k < queryRows.length; k += 1) {
    const r = queryRows[k] ?? -1;
    const c = queryColumns[k] ?? -1;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= n || c >= n) {
      throw new Error(`sentinel query ${k} is outside parameter range (fail-closed).`);
    }
  }
  const scaled = scaleNormalMatrix(normal);
  const factorization = choleskyDecomposeWithDamping(scaled.scaled);
  if (factorization.damping > 0) {
    return {
      values: Array.from(queryRows, () => Number.NaN),
      probedColumns: [],
      damped: true,
      damping: factorization.damping,
    };
  }
  const needed = [...new Set(queryColumns)].sort((a, b) => a - b);
  const columns = new Map<number, number[]>();
  for (const column of needed) {
    const unit = Array.from({ length: n }, (_, row) => (row === column ? [1] : [0]));
    const scaledRhs = scaleNormalRhs(unit, scaled.scale);
    const solved = solveSPDFromCholesky(factorization.factor, scaledRhs);
    const unscaled = unscaleNormalSolution(solved, scaled.scale);
    columns.set(column, unscaled.map((row) => row[0] ?? Number.NaN));
  }
  const values = Array.from({ length: queryRows.length }, (_, k) => {
    const column = columns.get(queryColumns[k] ?? -1) ?? [];
    return column[queryRows[k] ?? -1] ?? Number.NaN;
  });
  return { values, probedColumns: needed, damped: false, damping: 0 };
};

export interface PreanalysisSparseC1Result {
  pass: boolean;
  reasons: string[];
  maxAbsoluteDiff: number;
  maxRelativeDiff: number;
}

/** C1: probed sentinel values vs the dense reference sampled at the same entries. */
export const evaluateSentinelC1 = (
  probed: number[],
  reference: number[],
  tolerance = PREANALYSIS_SPARSE_C1_RELATIVE_TOLERANCE,
): PreanalysisSparseC1Result => {
  const reasons: string[] = [];
  if (probed.length !== reference.length) {
    return {
      pass: false,
      reasons: ['probed/reference length mismatch (fail-closed)'],
      maxAbsoluteDiff: Number.POSITIVE_INFINITY,
      maxRelativeDiff: Number.POSITIVE_INFINITY,
    };
  }
  let maxAbsoluteDiff = 0;
  let maxRelativeDiff = 0;
  probed.forEach((value, k) => {
    const expected = reference[k] ?? Number.NaN;
    const magnitude = Math.abs(expected);
    const diff = Math.abs(value - expected);
    if (!Number.isFinite(diff)) {
      if (reasons.length < 8) reasons.push(`entry ${k}: non-finite comparison (fail-closed)`);
      maxAbsoluteDiff = Number.POSITIVE_INFINITY;
      maxRelativeDiff = Number.POSITIVE_INFINITY;
      return;
    }
    maxAbsoluteDiff = Math.max(maxAbsoluteDiff, diff);
    // Scale by the entry magnitude floored at the absolute floor: tiny
    // covariances judge against the floor instead of inheriting a unit
    // scale that would hide large relative corruption.
    maxRelativeDiff = Math.max(
      maxRelativeDiff,
      diff / Math.max(magnitude, PREANALYSIS_SPARSE_C1_ABSOLUTE_FLOOR),
    );
    const allowed = Math.max(
      PREANALYSIS_SPARSE_C1_ABSOLUTE_FLOOR,
      tolerance * magnitude,
    );
    if (diff > allowed && reasons.length < 8) {
      reasons.push(`entry ${k}: diff ${diff.toExponential(2)} exceeds ${allowed.toExponential(2)}`);
    }
  });
  return { pass: reasons.length === 0, reasons, maxAbsoluteDiff, maxRelativeDiff };
};

export interface PreanalysisSparseC2Result {
  pass: boolean;
  reasons: string[];
  maxResidual: number;
  perColumnResidual: number[];
}

/**
 * C2: inverse residual check with no dense inverse, judged on the
 * CAPTURED (native/selected-solver) values — never on a re-solved TS
 * factor, which would be tautological. Each evaluated column q_j must
 * satisfy ||N q_j - e_j||_inf within tolerance, where N is accumulated
 * from the same packed inputs. A column is evaluated only when every
 * one of its n rows is present in the queries (full-column coverage);
 * with no complete column the check fails closed. queryColumns is used
 * to group values into columns, so partial/selected query plans either
 * verify or fail closed — they never silently pass.
 */
export const evaluateSentinelC2 = (
  normal: Matrix,
  queryRows: ArrayLike<number>,
  queryColumns: ArrayLike<number>,
  values: ArrayLike<number>,
  tolerance = PREANALYSIS_SPARSE_C2_RESIDUAL_TOLERANCE,
): PreanalysisSparseC2Result => {
  const reasons: string[] = [];
  const failClosed = (reason: string): PreanalysisSparseC2Result => ({
    pass: false,
    reasons: [reason],
    maxResidual: Number.POSITIVE_INFINITY,
    perColumnResidual: [],
  });
  const n = normal.length;
  if (n === 0 || n > PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT) {
    return failClosed('C2 requires 1..128 parameters (fail-closed)');
  }
  if (queryRows.length !== queryColumns.length || queryRows.length !== values.length) {
    return failClosed('C2 query/value length mismatch (fail-closed)');
  }
  const byColumn = new Map<number, Map<number, number>>();
  for (let k = 0; k < queryRows.length; k += 1) {
    const row = queryRows[k] ?? -1;
    const column = queryColumns[k] ?? -1;
    const value = values[k] ?? Number.NaN;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= n || column >= n) {
      return failClosed(`C2 query ${k} is outside parameter range (fail-closed)`);
    }
    if (!Number.isFinite(value)) {
      reasons.push(`C2 entry (${row},${column}): non-finite captured value (rejected)`);
      continue;
    }
    let columnMap = byColumn.get(column);
    if (!columnMap) {
      columnMap = new Map();
      byColumn.set(column, columnMap);
    }
    const previous = columnMap.get(row);
    if (previous != null && previous !== value) {
      reasons.push(`C2 entry (${row},${column}): conflicting duplicate values (rejected)`);
      continue;
    }
    columnMap.set(row, value);
  }
  const complete = [...byColumn.entries()]
    .filter(([, columnMap]) => columnMap.size === n)
    .map(([column]) => column)
    .sort((a, b) => a - b);
  const incomplete = byColumn.size - complete.length;
  if (complete.length === 0) {
    reasons.push(
      `C2: no complete column (${byColumn.size} partial, ${incomplete} incomplete); full-column coverage required (fail-closed)`,
    );
    return { pass: false, reasons, maxResidual: Number.POSITIVE_INFINITY, perColumnResidual: [] };
  }
  const perColumnResidual: number[] = [];
  for (const column of complete) {
    const columnMap = byColumn.get(column) as Map<number, number>;
    const q = Array.from({ length: n }, (_, row) => columnMap.get(row) as number);
    let worst = 0;
    for (let row = 0; row < n; row += 1) {
      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += (normal[row]?.[k] ?? 0) * (q[k] ?? Number.NaN);
      const expected = row === column ? 1 : 0;
      const residual = Math.abs(sum - expected);
      if (!Number.isFinite(residual)) {
        worst = Number.POSITIVE_INFINITY;
        break;
      }
      worst = Math.max(worst, residual);
    }
    perColumnResidual.push(worst);
    if (!Number.isFinite(worst) || worst > tolerance) {
      reasons.push(`C2 column ${column}: residual ${worst.toExponential(2)} exceeds ${tolerance.toExponential(2)} (rejected)`);
    }
  }
  if (incomplete > 0 && reasons.length < 8) {
    reasons.push(`C2 note: ${incomplete} partial column(s) skipped (full-column coverage required)`);
  }
  const maxResidual = perColumnResidual.length > 0 ? Math.max(...perColumnResidual) : Number.POSITIVE_INFINITY;
  const rejected = reasons.some((reason) => reason.includes('(rejected)'));
  return { pass: !rejected, reasons, maxResidual, perColumnResidual };
};

export interface PreanalysisSparseC3Result {
  pass: boolean;
  reasons: string[];
}

/** C3 hybrid: C1 (when an oracle is available) AND C2 must both pass. */
export const evaluateSentinelC3 = (args: {
  c1: PreanalysisSparseC1Result | null;
  c2: PreanalysisSparseC2Result;
}): PreanalysisSparseC3Result => {
  const reasons: string[] = [];
  if (!args.c1) {
    reasons.push('no dense oracle: C1 unevaluated (fail-closed)');
  } else if (!args.c1.pass) {
    reasons.push(...args.c1.reasons.map((reason) => `C1: ${reason}`));
  }
  if (!args.c2.pass) {
    reasons.push(...args.c2.reasons.map((reason) => `C2: ${reason}`));
  }
  return { pass: reasons.length === 0, reasons };
};

/** Physical covariance validation over probed selected entries. */
export const validateSentinelPhysical = (args: {
  queryRows: Int32Array;
  queryColumns: Int32Array;
  values: number[];
}): { valid: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const fail = (reason: string): void => {
    if (reasons.length < 8) reasons.push(reason);
  };
  if (args.queryRows.length !== args.values.length || args.queryColumns.length !== args.values.length) {
    return { valid: false, reasons: ['query/value length mismatch (fail-closed)'] };
  }
  const byKey = new Map<string, number>();
  args.values.forEach((value, k) => {
    byKey.set(`${args.queryRows[k]}|${args.queryColumns[k]}`, value);
  });
  args.values.forEach((value, k) => {
    const row = args.queryRows[k] ?? -1;
    const column = args.queryColumns[k] ?? -1;
    if (!Number.isFinite(value)) {
      fail(`entry (${row},${column}): non-finite (${value})`);
      return;
    }
    if (row === column && value <= 0) {
      fail(`diagonal (${row},${column}): non-positive (${value})`);
    }
  });
  args.values.forEach((value, k) => {
    const row = args.queryRows[k] ?? -1;
    const column = args.queryColumns[k] ?? -1;
    if (row === column) return;
    const mirror = byKey.get(`${column}|${row}`);
    if (mirror == null) return;
    const diff = Math.abs(value - mirror);
    const allowed = Math.max(PREANALYSIS_SPARSE_SYMMETRY_TOLERANCE, 1e-9 * Math.max(1, Math.abs(value)));
    if (diff > allowed) fail(`symmetry (${row},${column}): |${value}-${mirror}|=${diff.toExponential(2)}`);
  });
  // Cauchy-Schwarz: |c_ij| <= sqrt(c_ii c_jj) (with small slack).
  args.values.forEach((value, k) => {
    const row = args.queryRows[k] ?? -1;
    const column = args.queryColumns[k] ?? -1;
    if (row === column || !Number.isFinite(value)) return;
    const dii = byKey.get(`${row}|${row}`);
    const djj = byKey.get(`${column}|${column}`);
    if (dii == null || djj == null || !Number.isFinite(dii) || !Number.isFinite(djj)) return;
    if (dii <= 0 || djj <= 0) return;
    const bound = Math.sqrt(dii * djj) * (1 + 1e-6);
    if (Math.abs(value) > bound) {
      fail(`cauchy-schwarz (${row},${column}): |${value.toExponential(2)}| > ${bound.toExponential(2)}`);
    }
  });
  return { valid: reasons.length === 0, reasons };
};

/**
 * Deterministic bounded verification-query builder: complete columns
 * only. Picks min(k, n) evenly spaced columns including 0 and n-1 and
 * emits all n rows per column in column-major order, so every verified
 * column has full-row coverage by construction. Never emits n^2 entries:
 * at most k*n (2,048 at n = 128, k = 16). Throws fail-closed on bad input.
 */
export const buildBoundedVerificationQueries = (
  n: number,
  columnCount: number = PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
): { rows: Int32Array; columns: Int32Array; verifiedColumns: number[] } => {
  if (!Number.isInteger(n) || n <= 0 || n > PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT) {
    throw new Error('bounded verification requires 1..128 parameters (fail-closed).');
  }
  if (!Number.isInteger(columnCount) || columnCount <= 0) {
    throw new Error('bounded verification requires a positive column count (fail-closed).');
  }
  const picked: number[] = [];
  if (n <= columnCount) {
    for (let column = 0; column < n; column += 1) picked.push(column);
  } else {
    for (let i = 0; i < columnCount; i += 1) {
      const column = Math.min(n - 1, Math.floor((i * (n - 1)) / (columnCount - 1)));
      if (!picked.includes(column)) picked.push(column);
    }
    picked.sort((a, b) => a - b);
  }
  const rows: number[] = [];
  const columns: number[] = [];
  for (const column of picked) {
    for (let row = 0; row < n; row += 1) {
      rows.push(row);
      columns.push(column);
    }
  }
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns), verifiedColumns: picked };
};

/** Deterministic diagonal-only query builder (minimal selected shape). */
export const buildDiagonalQueries = (n: number): { rows: Int32Array; columns: Int32Array } => {
  const rows: number[] = [];
  const columns: number[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push(i);
    columns.push(i);
  }
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns) };
};
