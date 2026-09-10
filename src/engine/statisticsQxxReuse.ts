/**
 * Production eligibility gate for reusing the recovered final dense Qxx
 * as the standardized-residual statistics Qxx.
 *
 * Automatic (default-on) reuse applies only to the Phase 10D cohort:
 * a normal converged 3D dense TypeScript solve whose final Qxx is finite
 * and correctly dimensioned, with no preanalysis, robust weighting,
 * covariance augmentation, final-recovery damping, selected-covariance
 * store, active sparse selected-covariance solver, or sparse row
 * products. Rejection for the solver is on presence alone (conservative):
 * while the solver is active the final dense Qxx is normally sparse-derived
 * even when no selected store is captured, and a solve whose sparse
 * recovery fell back to dense still keeps the legacy path. TS correlation is admissible (the same
 * correlation transform runs on both paths). Anything else — including
 * 2D solves and non-converged solves — keeps the legacy
 * rebuild-and-invert statistics path.
 *
 * Reuse still assembles the statistics equations (L, rowInfo, weights);
 * only the statistics normal accumulation and inversion are skipped.
 * Enabling reuse never changes numerics on its own: the gate is
 * fail-closed with a machine-readable reason.
 */

export interface StatisticsQxxReuseInput {
  /** Test-only oracle: true forces the legacy recompute path. */
  forceLegacy?: boolean;
  /** The solve converged explicitly (required). */
  converged: boolean;
  /** 2D solves always keep the legacy path. */
  is2D: boolean;
  preanalysisMode: boolean;
  robustMode: string | undefined;
  finalQxx: number[][] | null;
  hasSelectedStore: boolean;
  /**
   * Active sparse selected-covariance solver. Presence alone rejects reuse
   * (conservative): the final dense Qxx is normally sparse-derived even
   * with no selected store, and a dense-fallback recovery still keeps the
   * legacy path.
   */
  hasSparseSelectedCovarianceSolver: boolean;
  sparseRowProductsAvailable: boolean;
  numParams: number;
  /** Synthetic rows the final recovery appended (covariance augmentation). */
  augmentedRowCount: number;
  /** Diagonal damping lambda the final recovery inversion required. */
  finalCovarianceDamping: number;
}

export interface StatisticsQxxReuseDecision {
  eligible: boolean;
  reason: string;
}

const isFiniteSquare = (matrix: number[][], dimension: number): boolean => {
  if (!Array.isArray(matrix) || matrix.length !== dimension || dimension <= 0) return false;
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== dimension) return false;
    for (const value of row) {
      if (!Number.isFinite(value)) return false;
    }
  }
  return true;
};

/**
 * Fail-closed eligibility for reusing the recovered final dense Qxx as the
 * statistics Qxx. Any inadmissible shape falls back to the legacy
 * recompute path with a machine-readable reason.
 */
export const decideStatisticsQxxReuse = (
  input: StatisticsQxxReuseInput,
): StatisticsQxxReuseDecision => {
  if (input.forceLegacy === true) return { eligible: false, reason: 'force-legacy-oracle' };
  if (!input.converged) return { eligible: false, reason: 'not-converged' };
  if (input.is2D) return { eligible: false, reason: 'two-dimensional-legacy' };
  if (input.preanalysisMode) return { eligible: false, reason: 'preanalysis-mode' };
  if (input.finalQxx == null) return { eligible: false, reason: 'missing-final-qxx' };
  if (input.hasSelectedStore) return { eligible: false, reason: 'non-dense-selected-store' };
  if (input.hasSparseSelectedCovarianceSolver) {
    return { eligible: false, reason: 'sparse-selected-solver-active' };
  }
  if (input.sparseRowProductsAvailable) {
    return { eligible: false, reason: 'sparse-row-products-active' };
  }
  if (input.robustMode != null && input.robustMode !== 'none') {
    return { eligible: false, reason: 'robust-mode-inadmissible' };
  }
  if (input.augmentedRowCount > 0) {
    return { eligible: false, reason: 'covariance-augmentation-active' };
  }
  if (input.finalCovarianceDamping > 0) {
    return { eligible: false, reason: 'damped-final-recovery' };
  }
  if (!isFiniteSquare(input.finalQxx, input.numParams)) {
    return { eligible: false, reason: 'dimension-mismatch-or-non-finite' };
  }
  return { eligible: true, reason: 'reused-final-dense-qxx' };
};
