/**
 * Test-only factory for the experimental sparse numerical bundle.
 *
 * Loads exactly one shared WebNet WASM module and wraps it in all three
 * sparse solvers (correction, row products, selected covariance) so tests
 * exercise the full experimental route without triplicating module loads.
 * Production defaults are untouched: nothing here is wired unless a test
 * explicitly injects the bundle's solvers into LSAEngine options.
 */
import type { EngineOptions } from '../adjustTypes';
import type { ExperimentalSparseRouteDiagnostics } from '../experimentalSparseDiagnostics';
import { WasmSparseSelectedCovariance } from './wasmSparseCovariance';
import { WasmSparseNormalEquationSolver } from './wasmSparseNormalSolver';
import { WasmSparseRowProducts } from './wasmSparseRowProducts';
import type { WebNetWasmFactory, WebNetWasmModule } from './wasmTypes';

export interface ExperimentalSparseNumericalBundle {
  module: WebNetWasmModule;
  sparseCorrectionSolver: WasmSparseNormalEquationSolver;
  sparseRowProductsSolver: WasmSparseRowProducts;
  sparseSelectedCovarianceSolver: WasmSparseSelectedCovariance;
}

/** Loads one module and exposes all three sparse solvers over it. */
export const createExperimentalSparseNumericalBundle = async (
  factory: WebNetWasmFactory,
): Promise<ExperimentalSparseNumericalBundle> => {
  const module = await factory();
  const bundle: ExperimentalSparseNumericalBundle = {
    module,
    sparseCorrectionSolver: new WasmSparseNormalEquationSolver(module),
    sparseRowProductsSolver: new WasmSparseRowProducts(module),
    sparseSelectedCovarianceSolver: new WasmSparseSelectedCovariance(module),
  };
  return bundle;
};

export type ExperimentalSparseEngineOptions = Pick<
  EngineOptions,
  | 'sparseCorrectionSolver'
  | 'sparseRowProductsSolver'
  | 'sparseSelectedCovarianceSolver'
  | 'experimentalSparseDiagnostics'
  | 'experimentalSelectedCovarianceMode'
>;

/**
 * Builds the full LSAEngine injection fragment from a bundle. LSAEngine
 * already forwards all three solvers plus diagnostics into nested solves,
 * so spreading this fragment into EngineOptions preserves nested
 * propagation for blunder-detect, auto-adjust, and cluster second passes.
 */
export const buildExperimentalSparseEngineOptions = (
  bundle: ExperimentalSparseNumericalBundle,
  diagnostics?: ExperimentalSparseRouteDiagnostics,
  selectedCovarianceMode = false,
): ExperimentalSparseEngineOptions => ({
  sparseCorrectionSolver: bundle.sparseCorrectionSolver,
  sparseRowProductsSolver: bundle.sparseRowProductsSolver,
  sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
  experimentalSparseDiagnostics: diagnostics,
  experimentalSelectedCovarianceMode: selectedCovarianceMode,
});
