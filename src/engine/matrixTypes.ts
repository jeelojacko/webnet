export type Matrix = number[][];

export interface SparseMatrixEntry {
  index: number;
  value: number;
}

export type SparseMatrixRows = SparseMatrixEntry[][];

export interface DampedCholeskyResult {
  factor: Matrix;
  damping: number;
  attempts: number;
}

export interface PivotedLDLTResult {
  lower: Matrix;
  diagonal: number[];
  offDiagonal: number[];
  blockSizes: number[];
  permutation: number[];
}

export interface InvertSymmetricLDLTResult {
  inverse: Matrix;
  factorization: PivotedLDLTResult;
  twoByTwoPivotCount: number;
}
