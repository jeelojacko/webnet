/**
 * Sparse raw-N condition estimate preserving TypeScript rowMax*colMax semantics.
 *
 * Production `LSAEngine.estimateCondition` computes
 * `max_i sum_j |Nij| * max_j sum_i |Nij|` over the dense normal matrix on
 * the first correction iteration. This module computes the same quantity
 * directly from packed sparse design rows plus packed upper-triangle
 * weights (assembling N = A^T P A accumulation only as absolute row/column
 * sums, never a dense matrix), so the injected sparse correction path can
 * record equivalent metadata without dense N.
 */
import type {
  PackedSparseDesignRows,
  PackedUpperTriangle,
} from './sparseEquationPacking';

export const SPARSE_CONDITION_THRESHOLD = 1e12;

const requireNonNegativeInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Sparse condition estimate requires a non-negative ${label}.`);
  }
};

/**
 * Estimates the raw normal-matrix norm product from packed sparse inputs.
 * Off-diagonal packed weights apply both symmetric terms, matching the
 * C++ sparse assembly rule. Throws fail-closed on inconsistent packing.
 */
export const estimateSparseNormalCondition = (
  design: PackedSparseDesignRows,
  weights: PackedUpperTriangle,
  parameterCount: number,
): number => {
  requireNonNegativeInteger(parameterCount, 'parameter count');
  if (parameterCount === 0) return 0;
  if (design.rowOffsets.length === 0) {
    throw new Error('Sparse condition estimate received empty design row offsets.');
  }
  const equationCount = design.rowOffsets.length - 1;
  if (design.columns.length !== design.values.length) {
    throw new Error('Sparse condition estimate received inconsistent design lengths.');
  }
  if (weights.rows.length !== weights.columns.length || weights.rows.length !== weights.values.length) {
    throw new Error('Sparse condition estimate received inconsistent weight lengths.');
  }
  const rowEntries: Array<Array<{ column: number; value: number }>> = Array.from(
    { length: equationCount },
    () => [],
  );
  for (let row = 0; row < equationCount; row += 1) {
    const start = design.rowOffsets[row] ?? 0;
    const end = design.rowOffsets[row + 1] ?? 0;
    if (start < 0 || end < start || end > design.columns.length) {
      throw new Error(`Sparse condition estimate found an invalid design offset at row ${row}.`);
    }
    for (let k = start; k < end; k += 1) {
      const column = design.columns[k] ?? -1;
      const value = design.values[k] ?? Number.NaN;
      if (!Number.isInteger(column) || column < 0 || column >= parameterCount) {
        throw new Error(`Sparse condition estimate found design column ${column} out of range.`);
      }
      if (!Number.isFinite(value)) {
        throw new Error('Sparse condition estimate received a non-finite design value.');
      }
      (rowEntries[row] as Array<{ column: number; value: number }>).push({ column, value });
    }
  }
  const rowSums = new Float64Array(parameterCount);
  const columnSums = new Float64Array(parameterCount);
  // Signed normal entries keyed by ORDERED (row, column) position.
  // Same-position contributions merge with signs before magnitudes are
  // taken; transpose writes stay separate entries. This bit-replicates the
  // dense TypeScript accumulation in matrixSparse.ts and the C++ sparse
  // assembly in sparse_normal_solver.cpp, including their shared rule that
  // off-diagonal same-column pairs write twice (unguarded mirror write).
  const normalEntries = new Map<number, number>();
  const addOrderedNormalEntry = (row: number, column: number, value: number): void => {
    if (value === 0) return;
    const key = row * parameterCount + column;
    normalEntries.set(key, (normalEntries.get(key) ?? 0) + value);
  };
  const accumulateDiagonalWeight = (entries: Array<{ column: number; value: number }>, scale: number): void => {
    for (let ai = 0; ai < entries.length; ai += 1) {
      const a = entries[ai] as { column: number; value: number };
      for (let bi = ai; bi < entries.length; bi += 1) {
        const b = entries[bi] as { column: number; value: number };
        const contribution = scale * a.value * b.value;
        addOrderedNormalEntry(a.column, b.column, contribution);
        if (b.column !== a.column) addOrderedNormalEntry(b.column, a.column, contribution);
      }
    }
  };
  const accumulateOffDiagonalWeight = (left: Array<{ column: number; value: number }>, right: Array<{ column: number; value: number }>, scale: number): void => {
    for (const a of left) {
      for (const b of right) {
        const contribution = scale * a.value * b.value;
        addOrderedNormalEntry(a.column, b.column, contribution);
        addOrderedNormalEntry(b.column, a.column, contribution);
      }
    }
  };
  for (let k = 0; k < weights.values.length; k += 1) {
    const row = weights.rows[k] ?? -1;
    const column = weights.columns[k] ?? -1;
    const value = weights.values[k] ?? Number.NaN;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= equationCount || column >= equationCount) {
      throw new Error(`Sparse condition estimate found weight entry ${k} out of range.`);
    }
    if (!Number.isFinite(value)) {
      throw new Error('Sparse condition estimate received a non-finite weight value.');
    }
    const left = rowEntries[row] as Array<{ column: number; value: number }>;
    const right = rowEntries[column] as Array<{ column: number; value: number }>;
    if (row === column) {
      accumulateDiagonalWeight(left, value);
    } else {
      accumulateOffDiagonalWeight(left, right, value);
    }
  }
  let rowMax = 0;
  let columnMax = 0;
  for (const [key, value] of normalEntries) {
    const magnitude = Math.abs(value);
    if (magnitude === 0) continue;
    const row = Math.floor(key / parameterCount);
    const column = key % parameterCount;
    rowSums[row] = (rowSums[row] ?? 0) + magnitude;
    columnSums[column] = (columnSums[column] ?? 0) + magnitude;
  }
  for (let i = 0; i < parameterCount; i += 1) {
    rowMax = Math.max(rowMax, rowSums[i] ?? 0);
    columnMax = Math.max(columnMax, columnSums[i] ?? 0);
  }
  return rowMax * columnMax;
};

export interface ConditionWarningClassification {
  flagged: boolean;
  /** Null when unflagged; otherwise byte-matches the TS production warning text. */
  message: string | null;
}

/**
 * Mirrors the production warning rule (`estimate > maxCondition`, default
 * 1e12) and wording in `adjust.ts` without logging; the sparse path records
 * metadata only and never changes production output.
 */
export const classifyConditionWarning = (
  estimate: number,
  threshold = SPARSE_CONDITION_THRESHOLD,
): ConditionWarningClassification => {
  const flagged = estimate > threshold;
  return {
    flagged,
    message: flagged
      ? `Warning: normal matrix appears ill-conditioned (estimate=${estimate.toExponential(3)}, threshold=${threshold.toExponential(3)}).`
      : null,
  };
};
