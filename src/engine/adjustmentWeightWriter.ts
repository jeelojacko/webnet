/**
 * Narrow writer interface for symmetric weight-matrix assembly.
 *
 * Both the dense adapter (over a live `number[][]` P matrix) and the sparse
 * structured builder expose this surface, so equation-row, constraint, and
 * correlation code can write weights without depending on a dense matrix.
 */
export interface WeightMatrixWriter {
  readonly size: number;
  set: (_row: number, _column: number, _value: number) => void;
  setDiagonal: (_row: number, _value: number) => void;
  setOffDiagonal: (_row: number, _column: number, _value: number) => void;
}
