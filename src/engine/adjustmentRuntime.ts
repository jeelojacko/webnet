/**
 * Phase 7B internal runtime dependency seam (no production routing).
 *
 * Bundles non-serializable engine dependencies — sparse numerical solvers,
 * route diagnostics, and the selected-covariance precision policy flag —
 * so they can be threaded session -> scenario -> LSAEngine without touching
 * `RunSessionRequest`, persisted state, UI, or automatic routing.
 *
 * `undefined` runtime preserves exact legacy behavior: every field is
 * optional and only defined fields are forwarded into `EngineOptions`.
 */
import type { EngineOptions } from './adjustTypes';

export interface AdjustmentRuntime {
  /** Test-only dense/sparse correction backend; undefined keeps TS. */
  sparseCorrectionSolver?: EngineOptions['sparseCorrectionSolver'];
  /** Test-only row-product backend; undefined keeps dense. */
  sparseRowProductsSolver?: EngineOptions['sparseRowProductsSolver'];
  /** Test-only selected-covariance backend; undefined keeps dense. */
  sparseSelectedCovarianceSolver?: EngineOptions['sparseSelectedCovarianceSolver'];
  /** Test-only route diagnostics; undefined disables counting. */
  experimentalSparseDiagnostics?: EngineOptions['experimentalSparseDiagnostics'];
  /**
   * Test-only selected-network precision policy: with an injected
   * selected-covariance solver, query only plan entries and skip the dense
   * all-entry Qxx reconstruction plus legacy all-pairs relativePrecision.
   */
  experimentalSelectedCovarianceMode?: EngineOptions['experimentalSelectedCovarianceMode'];
  /**
   * Phase 7B.5 test-only legacy compat (Option B): with selected mode,
   * also query exact all-station pairs without dense Qxx. Undefined
   * preserves selected-network omission/scaling.
   */
  experimentalSelectedCovarianceLegacyAllPairs?: EngineOptions['experimentalSelectedCovarianceLegacyAllPairs'];
  /** Test-only experimental correction backend; undefined keeps TS. */
  normalEquationSolver?: EngineOptions['normalEquationSolver'];
}

export type AdjustmentRuntimeEngineOptions = Pick<
  EngineOptions,
  | 'normalEquationSolver'
  | 'sparseCorrectionSolver'
  | 'sparseRowProductsSolver'
  | 'sparseSelectedCovarianceSolver'
  | 'experimentalSparseDiagnostics'
  | 'experimentalSelectedCovarianceMode'
  | 'experimentalSelectedCovarianceLegacyAllPairs'
>;

/** Extracts only defined runtime fields so `undefined` stays exact legacy. */
export const toEngineOptions = (
  runtime: AdjustmentRuntime | undefined,
): AdjustmentRuntimeEngineOptions => {
  if (!runtime) return {};
  const options: AdjustmentRuntimeEngineOptions = {};
  if (runtime.normalEquationSolver !== undefined) {
    options.normalEquationSolver = runtime.normalEquationSolver;
  }
  if (runtime.sparseCorrectionSolver !== undefined) {
    options.sparseCorrectionSolver = runtime.sparseCorrectionSolver;
  }
  if (runtime.sparseRowProductsSolver !== undefined) {
    options.sparseRowProductsSolver = runtime.sparseRowProductsSolver;
  }
  if (runtime.sparseSelectedCovarianceSolver !== undefined) {
    options.sparseSelectedCovarianceSolver = runtime.sparseSelectedCovarianceSolver;
  }
  if (runtime.experimentalSparseDiagnostics !== undefined) {
    options.experimentalSparseDiagnostics = runtime.experimentalSparseDiagnostics;
  }
  if (runtime.experimentalSelectedCovarianceMode !== undefined) {
    options.experimentalSelectedCovarianceMode = runtime.experimentalSelectedCovarianceMode;
  }
  if (runtime.experimentalSelectedCovarianceLegacyAllPairs !== undefined) {
    options.experimentalSelectedCovarianceLegacyAllPairs =
      runtime.experimentalSelectedCovarianceLegacyAllPairs;
  }
  return options;
};
