/**
 * Production eligibility gate for reusing the recovered final dense Qxx
 * as the standardized-residual statistics Qxx.
 *
 * Automatic (default-on) reuse applies to the dimension-independent dense
 * cohort: a normal converged dense TypeScript solve (2D or 3D) whose final
 * Qxx is finite and correctly dimensioned, with no preanalysis, robust
 * weighting, covariance augmentation, final-recovery damping,
 * selected-covariance store, active sparse selected-covariance solver, or
 * sparse row products. Rejection for the solver is on presence alone
 * (conservative): while the solver is active the final dense Qxx is
 * normally sparse-derived even when no selected store is captured, and a
 * solve whose sparse recovery fell back to dense still keeps the legacy
 * path. TS correlation is admissible (the same correlation transform runs
 * on both paths). Anything else — including non-converged solves — keeps
 * the legacy rebuild-and-invert statistics path.
 *
 * N_final == N_stats argument (why 2D reuse is sound): statistics
 * re-assembles the same equations (L, rowInfo, weights) from the same
 * activeObservations/constraints/numParams path as the final iteration,
 * and the two known 2D/3D divergences cannot split the normals by
 * construction — covariance augmentation early-returns for 2D
 * (augmentCovarianceObservations) and the weak-float-zenith display
 * projection early-returns for 2D
 * (projectWeakFloatZenithLeafStationsForDisplay). Orientation unknowns,
 * GPS/TS-correlation/weighted-control weighting, and station ordering are
 * preserved through the shared assembly path, so no new gates are needed
 * for them. Free-network needs no gate here: terrestrial solves have no
 * free-network path, and static-GNSS free networks never enter native R2B
 * (native dense 2D stays on its existing fallback, untouched).
 *
 * Reuse still assembles the statistics equations (L, rowInfo, weights);
 * only the statistics normal accumulation and inversion are skipped.
 * Enabling reuse never changes numerics on its own: the gate is
 * fail-closed with a machine-readable reason.
 *
 * Kill switch: the existing forceLegacyStatisticsQxx oracle
 * (test-only, deterministic) forces the legacy path; the
 * allowEvidence/allowVerified native-dense flags only widen the
 * sparse-solver gate and never admit anything else. No new switch needed.
 */

export interface StatisticsQxxReuseInput {
  /** Test-only oracle: true forces the legacy recompute path. */
  forceLegacy?: boolean;
  /** The solve converged explicitly (required). */
  converged: boolean;
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
  /** Evidence-only override for validated native dense all-entry Qxx. */
  allowEvidenceNativeDenseQxxReuse?: boolean;
  /**
   * Phase 10I production provenance: set only by the worker-only native
   * full-Qxx auto-route when it injects the all-entry dense native
   * covariance solver. Never enabled by in-process defaults.
   */
  allowVerifiedNativeDenseQxxReuse?: boolean;
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
  if (input.preanalysisMode) return { eligible: false, reason: 'preanalysis-mode' };
  if (input.finalQxx == null) return { eligible: false, reason: 'missing-final-qxx' };
  if (input.hasSelectedStore) return { eligible: false, reason: 'non-dense-selected-store' };
  if (
    input.hasSparseSelectedCovarianceSolver &&
    input.allowEvidenceNativeDenseQxxReuse !== true &&
    input.allowVerifiedNativeDenseQxxReuse !== true
  ) {
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
