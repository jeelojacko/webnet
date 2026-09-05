import type { PackedSparseDesignRows, PackedUpperTriangle } from './sparseEquationPacking';

export type NumericalBackend = 'typescript' | 'wasm';

export interface NormalEquationSolveResult {
  correction: number[][];
  damping: number;
  dampingAttempts: number;
}

export interface NormalEquationSolver {
  solveCorrection(_normal: number[][], _rhs: number[][]): NormalEquationSolveResult;
}

export interface SparseCorrectionSolveInput {
  design: PackedSparseDesignRows;
  weights: PackedUpperTriangle;
  misclosures: Float64Array;
  observationEquationCount: number;
  parameterCount: number;
}

export interface SparseCorrectionSolveResult extends NormalEquationSolveResult {
  designNnz: number;
  weightNnz: number;
  normalNnz: number;
  factorNnz: number;
  ordering: string;
  solver: string;
}

export interface SparseCorrectionSolver {
  solveFromEquations(_input: SparseCorrectionSolveInput): SparseCorrectionSolveResult;
}

export interface SparseEquationSystem {
  design: PackedSparseDesignRows;
  weights: PackedUpperTriangle;
  observationEquationCount: number;
  parameterCount: number;
}

export interface SparseFactorMetadata {
  normalNnz: number;
  factorNnz: number;
  damping: number;
  dampingAttempts: number;
}

export interface SparseSelectedCovarianceInput extends SparseEquationSystem {
  /** Row index per query; length must equal queryColumns.length. */
  queryRows: Int32Array;
  /** Column index per query; entries must lie in [0, parameterCount). */
  queryColumns: Int32Array;
}

export interface SparseSelectedCovarianceResult extends SparseFactorMetadata {
  covariance: Float64Array;
}

export interface SparseSelectedCovarianceSolver {
  querySelected(_input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult;
}

export interface SparseRowProductsInput extends SparseEquationSystem {
  /** CSR row offsets over parameter space; length is queryRowCount + 1. */
  queryRowOffsets: Int32Array;
  queryColumns: Int32Array;
  queryValues: Float64Array;
  /** Query-row indices for cross products; lengths must match. */
  crossA: Int32Array;
  crossB: Int32Array;
}

export interface SparseRowProductsResult extends SparseFactorMetadata {
  quadratic: Float64Array;
  cross: Float64Array;
}

export interface SparseRowProductsSolver {
  queryRowProducts(_input: SparseRowProductsInput): SparseRowProductsResult;
}

export interface NumericalBackendOptions {
  backend?: NumericalBackend;
}

/** Phase 0 keeps the TypeScript implementation authoritative. */
export const resolveNumericalBackend = (
  options?: NumericalBackendOptions,
): NumericalBackend => options?.backend ?? 'typescript';
