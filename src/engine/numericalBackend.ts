export type NumericalBackend = 'typescript' | 'wasm';

export interface NormalEquationSolveResult {
  correction: number[][];
  damping: number;
  dampingAttempts: number;
}

export interface NormalEquationSolver {
  solveCorrection(_normal: number[][], _rhs: number[][]): NormalEquationSolveResult;
}

export interface NumericalBackendOptions {
  backend?: NumericalBackend;
}

/** Phase 0 keeps the TypeScript implementation authoritative. */
export const resolveNumericalBackend = (
  options?: NumericalBackendOptions,
): NumericalBackend => options?.backend ?? 'typescript';
