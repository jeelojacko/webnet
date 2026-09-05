export type NumericalBackend = 'typescript' | 'wasm';

export interface NormalEquationSolver {
  solve(_normal: number[][], _rhs: number[][]): { correction: number[][]; qxx?: number[][] };
}

export interface NumericalBackendOptions {
  backend?: NumericalBackend;
}

/** Phase 0 keeps the TypeScript implementation authoritative. */
export const resolveNumericalBackend = (
  options?: NumericalBackendOptions,
): NumericalBackend => options?.backend ?? 'typescript';
