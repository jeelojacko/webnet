/**
 * Phase 10D evidence-only Qxx comparison/reuse seam.
 *
 * Test-only instrumentation for comparing the recovered final dense Qxx
 * against the statistics Qxx that standardized-residual computation would
 * otherwise rebuild and invert, and for reusing the final Qxx in that
 * statistics path. Production default is always legacy (recompute); reuse
 * requires the explicit opt-in flag and passes a fail-closed eligibility
 * gate. No formulas, tolerances, or public result fields change.
 */

export interface QxxReuseProbeEvent {
  /** Which stage this event describes. */
  stage: 'final-covariance' | 'statistics';
  /** True only when the statistics stage reused the final dense Qxx. */
  reused: boolean;
  /** Machine-readable reason for the decision (or capture note). */
  reason: string;
  /** Dimension of the assembled normal matrix, when one was assembled. */
  normalDimension: number | null;
  /** Dimension of the Qxx matrix, when one is available. */
  qxxDimension: number | null;
  /** Normal-equation accumulations performed in this stage (0 or 1). */
  normalAccumulations: number;
  /** Dense inversions performed in this stage (0 or 1). */
  inversions: number;
  /** Deep copy of the stage normal matrix, when assembled and probed. */
  normal?: number[][];
  /** Deep copy of the stage Qxx, when available and probed. */
  qxx?: number[][];
}

/** Test-only sink for Qxx reuse evidence events; undefined disables capture. */
export type QxxReuseProbe = (_event: QxxReuseProbeEvent) => void;

export const copyMatrix = (matrix: number[][]): number[][] =>
  matrix.map((row) => [...row]);

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

export interface StatisticsQxxReuseInput {
  reuseRequested: boolean;
  preanalysisMode: boolean;
  robustMode: string | undefined;
  finalQxx: number[][] | null;
  hasSelectedStore: boolean;
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

/**
 * Fail-closed eligibility for reusing the recovered final dense Qxx as the
 * statistics Qxx. Any inadmissible shape falls back to the legacy
 * recompute path with a machine-readable reason; enabling the flag never
 * changes numerics on its own.
 */
export const decideStatisticsQxxReuse = (
  input: StatisticsQxxReuseInput,
): StatisticsQxxReuseDecision => {
  if (!input.reuseRequested) return { eligible: false, reason: 'reuse-disabled' };
  if (input.preanalysisMode) return { eligible: false, reason: 'preanalysis-mode' };
  if (input.finalQxx == null) return { eligible: false, reason: 'missing-final-qxx' };
  if (input.hasSelectedStore) return { eligible: false, reason: 'non-dense-selected-store' };
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
