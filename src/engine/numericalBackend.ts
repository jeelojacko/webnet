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

export interface NumericalBackendOptions {
  backend?: NumericalBackend;
}

/** Phase 0 keeps the TypeScript implementation authoritative. */
export const resolveNumericalBackend = (
  options?: NumericalBackendOptions,
): NumericalBackend => options?.backend ?? 'typescript';
