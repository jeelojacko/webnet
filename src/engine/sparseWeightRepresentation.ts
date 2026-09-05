import type { PackedUpperTriangle } from './sparseEquationPacking';
import type { WeightMatrixWriter } from './adjustmentWeightWriter';

/**
 * Phase 4 structured symmetric weight representation.
 *
 * Finalized weights keep an explicit dense diagonal plus canonical
 * row<col off-diagonal triplets in deterministic (row, column) order.
 * Builders/writers validate finiteness, bounds, and symmetry; exact zero
 * entries are omitted so packing matches the dense P-upper-triangle rule.
 */
export interface StructuredSymmetricWeights {
  size: number;
  diagonal: Float64Array;
  offRows: Int32Array;
  offColumns: Int32Array;
  offValues: Float64Array;
}

const requireWeightSize = (size: number): void => {
  if (!Number.isInteger(size) || size < 0) {
    throw new Error(`Structured weight size must be a non-negative integer (got ${size}).`);
  }
};

const requireRowInBounds = (index: number, size: number, label: string): void => {
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new Error(`Structured weight ${label} index ${index} is out of bounds for size ${size}.`);
  }
};

const requireFiniteWeight = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`Structured weight contains non-finite ${label}.`);
};

const canonicalKey = (row: number, column: number): string => `${row}:${column}`;

/** Mutable builder for structured symmetric weights. Duplicate writes are last-wins. */
export class SymmetricWeightBuilder {
  private readonly size: number;
  private readonly diagonal: number[];
  private readonly offDiagonal = new Map<string, number>();

  constructor(size: number) {
    requireWeightSize(size);
    this.size = size;
    this.diagonal = new Array<number>(size).fill(0);
  }

  get equationCount(): number {
    return this.size;
  }

  setDiagonal(row: number, value: number): void {
    requireRowInBounds(row, this.size, 'diagonal');
    requireFiniteWeight(value, `diagonal at ${row}`);
    this.diagonal[row] = value;
  }

  setOffDiagonal(row: number, column: number, value: number): void {
    requireRowInBounds(row, this.size, 'off-diagonal row');
    requireRowInBounds(column, this.size, 'off-diagonal column');
    if (row === column) {
      throw new Error(`Structured weight off-diagonal entry must satisfy row<col (got ${row},${column}).`);
    }
    requireFiniteWeight(value, `off-diagonal at ${row},${column}`);
    const canonicalRow = Math.min(row, column);
    const canonicalColumn = Math.max(row, column);
    const key = canonicalKey(canonicalRow, canonicalColumn);
    if (value === 0) {
      this.offDiagonal.delete(key);
      return;
    }
    this.offDiagonal.set(key, value);
  }

  /** Canonical entry point: diagonal when row===column, off-diagonal otherwise. */
  set(row: number, column: number, value: number): void {
    if (row === column) {
      this.setDiagonal(row, value);
      return;
    }
    this.setOffDiagonal(row, column, value);
  }

  finalize(): StructuredSymmetricWeights {
    const keys = [...this.offDiagonal.keys()].sort((left, right) => {
      const [leftRow, leftColumn] = left.split(':').map(Number);
      const [rightRow, rightColumn] = right.split(':').map(Number);
      if (leftRow !== rightRow) return (leftRow as number) - (rightRow as number);
      return (leftColumn as number) - (rightColumn as number);
    });
    const offRows = new Int32Array(keys.length);
    const offColumns = new Int32Array(keys.length);
    const offValues = new Float64Array(keys.length);
    keys.forEach((key, position) => {
      const [row, column] = key.split(':').map(Number);
      offRows[position] = row as number;
      offColumns[position] = column as number;
      offValues[position] = this.offDiagonal.get(key) as number;
    });
    return {
      size: this.size,
      diagonal: Float64Array.from(this.diagonal),
      offRows,
      offColumns,
      offValues,
    };
  }
}

/** Adapter exposing builder semantics over an existing dense number[][] P matrix. */
export class DenseWeightWriter implements WeightMatrixWriter {
  private readonly matrix: number[][];

  constructor(matrix: number[][]) {
    this.matrix = matrix;
  }

  get size(): number {
    return this.matrix.length;
  }

  set(row: number, column: number, value: number): void {
    requireFiniteWeight(value, `dense entry at ${row},${column}`);
    const targetRow = this.matrix[row];
    const targetMirror = this.matrix[column];
    if (!targetRow || !targetMirror || column >= targetRow.length || row >= targetMirror.length) {
      throw new Error(`Dense weight entry ${row},${column} is out of bounds.`);
    }
    targetRow[column] = value;
    if (row !== column) targetMirror[row] = value;
  }

  setDiagonal(row: number, value: number): void {
    this.set(row, row, value);
  }

  setOffDiagonal(row: number, column: number, value: number): void {
    if (row === column) {
      throw new Error(`Dense weight off-diagonal entry must satisfy row<col (got ${row},${column}).`);
    }
    this.set(row, column, value);
  }

  /** Validates symmetry/finiteness and converts the dense matrix to structured form. */
  toStructured(): StructuredSymmetricWeights {
    return structuredWeightsFromDense(this.matrix, this.matrix.length);
  }
}

/** Adapter accumulating sparse weight entries directly into a structured builder. */
export class SparseWeightWriter implements WeightMatrixWriter {
  private readonly builder: SymmetricWeightBuilder;

  constructor(size: number) {
    this.builder = new SymmetricWeightBuilder(size);
  }

  get size(): number {
    return this.builder.equationCount;
  }

  set(row: number, column: number, value: number): void {
    this.builder.set(row, column, value);
  }

  setDiagonal(row: number, value: number): void {
    this.builder.setDiagonal(row, value);
  }

  setOffDiagonal(row: number, column: number, value: number): void {
    this.builder.setOffDiagonal(row, column, value);
  }

  finalize(): StructuredSymmetricWeights {
    return this.builder.finalize();
  }
}

/** Converts a dense P matrix to structured form with the packing symmetry rule. */
export const structuredWeightsFromDense = (
  matrix: number[][],
  size: number,
): StructuredSymmetricWeights => {
  requireWeightSize(size);
  if (matrix.length < size) {
    throw new Error(`Dense weight matrix has ${matrix.length} rows for size ${size}.`);
  }
  const builder = new SymmetricWeightBuilder(size);
  for (let row = 0; row < size; row += 1) {
    const sourceRow = matrix[row];
    if (!sourceRow || sourceRow.length < size) {
      throw new Error(`Dense weight matrix row ${row} is missing ${size} columns.`);
    }
    const diagonal = sourceRow[row] ?? 0;
    requireFiniteWeight(diagonal, `diagonal at ${row}`);
    builder.setDiagonal(row, diagonal);
  }
  for (let row = 0; row < size; row += 1) {
    for (let column = row + 1; column < size; column += 1) {
      const value = matrix[row]?.[column] ?? 0;
      requireFiniteWeight(value, `weight at ${row},${column}`);
      const mirror = matrix[column]?.[row] ?? 0;
      if (mirror !== 0) {
        requireFiniteWeight(mirror, `weight at ${column},${row}`);
        if (mirror !== value) {
          throw new Error(`Weight matrix is not symmetric at ${row},${column}.`);
        }
      }
      if (value === 0) continue;
      builder.setOffDiagonal(row, column, value);
    }
  }
  return builder.finalize();
};

/** Reconstructs the dense P matrix from structured weights. */
export const structuredWeightsToDense = (weights: StructuredSymmetricWeights): number[][] => {
  requireWeightSize(weights.size);
  if (weights.diagonal.length !== weights.size) {
    throw new Error('Structured weight diagonal length does not match size.');
  }
  const matrix: number[][] = Array.from({ length: weights.size }, () => new Array<number>(weights.size).fill(0));
  for (let row = 0; row < weights.size; row += 1) {
    matrix[row][row] = weights.diagonal[row] as number;
  }
  for (let position = 0; position < weights.offRows.length; position += 1) {
    const row = weights.offRows[position] as number;
    const column = weights.offColumns[position] as number;
    const value = weights.offValues[position] as number;
    matrix[row][column] = value;
    matrix[column][row] = value;
  }
  return matrix;
};

/** Evaluates vᵀPv directly from structured weights without a dense P matrix. */
export const structuredQuadraticForm = (
  weights: StructuredSymmetricWeights,
  v: number[][],
): number => {
  if (v.length !== weights.size) {
    throw new Error(`Structured quadratic form needs one residual per equation (got ${v.length} for size ${weights.size}).`);
  }
  let sum = 0;
  for (let row = 0; row < weights.size; row += 1) {
    const residual = v[row]?.[0] ?? 0;
    if (!Number.isFinite(residual)) throw new Error(`Structured quadratic form contains non-finite residual at ${row}.`);
    sum += (weights.diagonal[row] as number) * residual * residual;
  }
  for (let position = 0; position < weights.offRows.length; position += 1) {
    const row = weights.offRows[position] as number;
    const column = weights.offColumns[position] as number;
    sum += 2 * (weights.offValues[position] as number) * (v[row]?.[0] ?? 0) * (v[column]?.[0] ?? 0);
  }
  return sum;
};

/** Converts structured weights to the packed upper-triangle transfer form. */
export const structuredWeightsToPackedUpper = (
  weights: StructuredSymmetricWeights,
): PackedUpperTriangle => {
  const rows: number[] = [];
  const columns: number[] = [];
  const values: number[] = [];
  let offPosition = 0;
  for (let row = 0; row < weights.size; row += 1) {
    const diagonal = weights.diagonal[row] as number;
    if (diagonal !== 0) {
      rows.push(row);
      columns.push(row);
      values.push(diagonal);
    }
    while (offPosition < weights.offRows.length && (weights.offRows[offPosition] as number) === row) {
      rows.push(weights.offRows[offPosition] as number);
      columns.push(weights.offColumns[offPosition] as number);
      values.push(weights.offValues[offPosition] as number);
      offPosition += 1;
    }
  }
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns), values: Float64Array.from(values) };
};
