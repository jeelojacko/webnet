import type { SparseMatrixRows } from './matrix';
import type { SparseCorrectionSolveInput } from './numericalBackend';

export interface PackedSparseDesignRows {
  rowOffsets: Int32Array;
  columns: Int32Array;
  values: Float64Array;
}

export interface PackedUpperTriangle {
  rows: Int32Array;
  columns: Int32Array;
  values: Float64Array;
}

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`Sparse equation input contains non-finite ${label}.`);
};

export const packSparseDesignRows = (rows: SparseMatrixRows): PackedSparseDesignRows => {
  const rowOffsets = new Int32Array(rows.length + 1);
  const columns: number[] = [];
  const values: number[] = [];
  rows.forEach((entries, row) => {
    let previous = -1;
    entries.forEach((entry) => {
      if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index <= previous) {
        throw new Error(`Sparse design row ${row} is not strictly column-sorted.`);
      }
      requireFinite(entry.value, `design value at row ${row}`);
      columns.push(entry.index);
      values.push(entry.value);
      previous = entry.index;
    });
    rowOffsets[row + 1] = columns.length;
  });
  if (columns.length > 2_147_483_647) throw new Error('Sparse design input exceeds Int32 capacity.');
  return { rowOffsets, columns: Int32Array.from(columns), values: Float64Array.from(values) };
};

// Exact zero is the only omission rule: tiny correlation terms remain transferable.
// Upper-triangle entries are packed; a nonzero lower-triangle entry that
// differs exactly from its upper counterpart is rejected as asymmetric input.
// Lower entries that are exactly zero are ignored, so upper-only P matrices
// keep packing identically to before.
export const packUpperTriangleWeights = (weights: number[][], rowCount: number): PackedUpperTriangle => {
  const rows: number[] = [];
  const columns: number[] = [];
  const values: number[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = row; column < rowCount; column += 1) {
      const value = weights[row]?.[column] ?? 0;
      requireFinite(value, `weight at ${row},${column}`);
      if (column !== row) {
        const mirror = weights[column]?.[row] ?? 0;
        if (mirror !== 0) {
          requireFinite(mirror, `weight at ${column},${row}`);
          if (mirror !== value) {
            throw new Error(`Weight matrix is not symmetric at ${row},${column}.`);
          }
        }
      }
      if (value === 0) continue;
      rows.push(row);
      columns.push(column);
      values.push(value);
    }
  }
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns), values: Float64Array.from(values) };
};

export const buildSparseSolveInput = (
  rows: SparseMatrixRows,
  weights: number[][],
  misclosures: number[][],
  parameterCount: number,
): SparseCorrectionSolveInput => {
  if (rows.length !== misclosures.length) {
    throw new Error(`Sparse equation input requires one design row per misclosure (got ${rows.length} design rows for ${misclosures.length} equations).`);
  }
  return {
    design: packSparseDesignRows(rows),
    weights: packUpperTriangleWeights(weights, misclosures.length),
    misclosures: packMisclosures(misclosures, misclosures.length),
    observationEquationCount: misclosures.length,
    parameterCount,
  };
};

export const packMisclosures = (misclosures: number[][], rowCount: number): Float64Array => {
  if (misclosures.length !== rowCount || misclosures.some((row) => row.length !== 1)) {
    throw new Error('Sparse equation input requires one misclosure per equation row.');
  }
  return Float64Array.from(misclosures.map((row, index) => {
    const value = row[0] ?? 0;
    requireFinite(value, `misclosure at row ${index}`);
    return value;
  }));
};
