/**
 * Phase 16C structured-weight read adapter for the statistics stage.
 *
 * One read interface with two backings (dense P or finalized structured
 * weights) so statistics consumes weights without allocating a dense P.
 * Construction validates and returns null on anything malformed so
 * callers fail closed to the legacy dense path. Coupled iteration visits
 * nonzero columns in ascending row order (never Map insertion order).
 */
import { structuredWeightsToDense } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import { buildCouplingGroupRows } from './adjustExternalReliability';

export interface WeightAccess {
  readonly size: number;
  /** Exact weight entry; 0 for absent off-diagonals. NaN only on dense holes. */
  weight: (_row: number, _column: number) => number;
  /** Diagonal entry (same as weight(row, row)). */
  diagonal: (_row: number) => number;
  /** Visits nonzero columns of one row in ascending column order. */
  forEachCoupled: (_row: number, _visit: (_column: number, _value: number) => void) => void;
  /** Existing true-P coupling group rows (always includes the row itself). */
  groupRows: (_row: number) => number[];
}

const isValidIndex = (index: number, size: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < size;

/** Dense backing over an m×m P matrix. Null on ragged/missing input. */
export const denseWeightAccess = (matrix: number[][] | undefined): WeightAccess | null => {
  if (!Array.isArray(matrix) || matrix.length === 0) return null;
  const size = matrix.length;
  for (let row = 0; row < size; row += 1) {
    if (!Array.isArray(matrix[row]) || (matrix[row] as number[]).length < size) return null;
  }
  const dense = matrix as number[][];
  return {
    size,
    weight: (row, column) => {
      if (!isValidIndex(row, size) || !isValidIndex(column, size)) return Number.NaN;
      const value = dense[row]?.[column];
      return typeof value === 'number' ? value : Number.NaN;
    },
    diagonal: (row) => {
      if (!isValidIndex(row, size)) return Number.NaN;
      const value = dense[row]?.[row];
      return typeof value === 'number' ? value : Number.NaN;
    },
    forEachCoupled: (row, visit) => {
      if (!isValidIndex(row, size)) return;
      const source = dense[row] as number[];
      for (let column = 0; column < size; column += 1) {
        const value = source[column];
        if (typeof value === 'number' && value !== 0) visit(column, value);
      }
    },
    groupRows: (row) => (isValidIndex(row, size) ? [row] : []),
  };
};

interface AdjacencyEntry {
  column: number;
  value: number;
}

/**
 * Structured backing over finalized weights. Null on size/diagonal
 * mismatch, ragged triplets, out-of-bounds or non-canonical (row<col)
 * entries, non-finite values, or duplicate triplets.
 */
export const structuredWeightAccess = (
  weights: StructuredSymmetricWeights | undefined,
  groupRowsOf?: (_row: number) => number[],
): WeightAccess | null => {
  if (weights == null) return null;
  try {
    const size = weights.size;
    if (!Number.isInteger(size) || size <= 0) return null;
    if (!(weights.diagonal instanceof Float64Array) || weights.diagonal.length !== size) {
      return null;
    }
    if (
      !(weights.offRows instanceof Int32Array) ||
      !(weights.offColumns instanceof Int32Array) ||
      !(weights.offValues instanceof Float64Array) ||
      weights.offRows.length !== weights.offColumns.length ||
      weights.offRows.length !== weights.offValues.length
    ) {
      return null;
    }
    for (let row = 0; row < size; row += 1) {
      if (!Number.isFinite(weights.diagonal[row] as number)) return null;
    }
    const adjacency: AdjacencyEntry[][] = Array.from({ length: size }, () => []);
    let previousRow = -1;
    let previousColumn = -1;
    for (let position = 0; position < weights.offRows.length; position += 1) {
      const row = weights.offRows[position] as number;
      const column = weights.offColumns[position] as number;
      const value = weights.offValues[position] as number;
      if (
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        column < 0 ||
        row >= size ||
        column >= size ||
        row >= column ||
        !Number.isFinite(value) ||
        value === 0
      ) {
        return null;
      }
      // Canonical finalize() order is strictly ascending (row, column);
      // anything else (duplicates included) fails closed to dense.
      if (row < previousRow || (row === previousRow && column <= previousColumn)) return null;
      previousRow = row;
      previousColumn = column;
      (adjacency[row] as AdjacencyEntry[]).push({ column, value });
      (adjacency[column] as AdjacencyEntry[]).push({ column: row, value });
    }
    // Canonical triplets arrive row-ascending per row; sort defensively so
    // coupled iteration is ascending regardless of producer order.
    for (let row = 0; row < size; row += 1) {
      (adjacency[row] as AdjacencyEntry[]).sort((left, right) => left.column - right.column);
    }
    const diagonal = weights.diagonal;
    const weightAt = (row: number, column: number): number => {
      if (!isValidIndex(row, size) || !isValidIndex(column, size)) return Number.NaN;
      if (row === column) return diagonal[row] as number;
      const entries = adjacency[row] as AdjacencyEntry[];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index] as AdjacencyEntry;
        if (entry.column === column) return entry.value;
        if (entry.column > column) break;
      }
      return 0;
    };
    return {
      size,
      weight: weightAt,
      diagonal: (row) => (isValidIndex(row, size) ? (diagonal[row] as number) : Number.NaN),
      forEachCoupled: (row, visit) => {
        if (!isValidIndex(row, size)) return;
        const diagonalValue = diagonal[row] as number;
        const entries = adjacency[row] as AdjacencyEntry[];
        let cursor = 0;
        // Ascending merge of the diagonal position with off-diagonal entries.
        while (cursor < entries.length && (entries[cursor] as AdjacencyEntry).column < row) {
          const entry = entries[cursor] as AdjacencyEntry;
          visit(entry.column, entry.value);
          cursor += 1;
        }
        if (diagonalValue !== 0) visit(row, diagonalValue);
        while (cursor < entries.length) {
          const entry = entries[cursor] as AdjacencyEntry;
          visit(entry.column, entry.value);
          cursor += 1;
        }
      },
      groupRows: (row) => {
        if (!isValidIndex(row, size)) return [];
        if (groupRowsOf) return groupRowsOf(row);
        return [row];
      },
    };
  } catch {
    return null;
  }
};

/**
 * Single fail-closed materialization for the dense fallback: validated
 * structured weights rebuilt as dense P (equivalent to
 * structuredWeightsToDense). Throws on malformed input so callers that
 * cannot recover keep the legacy error contract.
 */
export const materializeDenseWeightMatrix = (
  weights: StructuredSymmetricWeights,
): number[][] => structuredWeightsToDense(weights);

/** Group-row resolver delegating to the existing coupling-group builder. */
export const couplingGroupRowsOf = (
  rowInfo: ({ obsId: number; component?: string } | null | undefined)[],
  tsGroupKeyOf: (_obsId: number) => string | null,
): ((_row: number) => number[]) => {
  const byRow = buildCouplingGroupRows(rowInfo, tsGroupKeyOf);
  return (row: number) => byRow.get(row) ?? [row];
};
