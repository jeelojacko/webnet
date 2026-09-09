/**
 * Phase 9E first-stage fast path: eligibility for skipping the discarded
 * preanalysis correction factorization/assembly (dense 2D only).
 *
 * In preanalysis mode the iteration loop computes a correction vector and
 * then discards it (geometry is held at approximate coordinates; covariance
 * is recovered afterwards at the same planning geometry). The first-stage
 * fast path skips that discarded work and records the result.condition
 * estimate from the covariance-recovery normal matrix instead (bit-identical
 * N in eligible shapes, so the estimate is unchanged).
 *
 * Eligibility is fail-closed: every condition must positively hold.
 * Orientation unknowns are supported (the discarded correction is never
 * applied to stations or orientations, and recovery covers the same
 * parameters). Unsupported shapes fall back to the legacy correction loop
 * with zero behavior change.
 */

export type PreanalysisCorrectionFastPathShape = {
  preanalysisMode: boolean;
  /** Dense 2D only: 3D covariance augmentation changes the recovery N. */
  is2D: boolean;
  /** Debug mode emits per-observation assembly lines the fast path skips. */
  debug: boolean;
  /** Only unweighted reweighting-free solves; production preanalysis forces 'none'. */
  robustMode?: string;
  /** The legacy loop runs zero passes below 1; the fast path stays out. */
  maxIterations?: number;
  hasSparseCorrectionSolver: boolean;
  hasSparseRowProductsSolver: boolean;
  hasSparseSelectedCovarianceSolver: boolean;
  hasNormalEquationSolver: boolean;
};

export const isPreanalysisCorrectionFastPathEligible = (
  shape: PreanalysisCorrectionFastPathShape,
): boolean => {
  if (shape.preanalysisMode !== true) return false;
  if (shape.is2D !== true) return false;
  if (shape.debug === true) return false;
  if (shape.robustMode != null && shape.robustMode !== 'none') return false;
  if (
    shape.maxIterations != null &&
    (!Number.isInteger(shape.maxIterations) || shape.maxIterations < 1)
  ) {
    return false;
  }
  if (shape.hasSparseCorrectionSolver) return false;
  if (shape.hasSparseRowProductsSolver) return false;
  if (shape.hasSparseSelectedCovarianceSolver) return false;
  if (shape.hasNormalEquationSolver) return false;
  return true;
};

export type PreanalysisCorrectionFastPathStats = {
  evaluations: number;
  fastSolves: number;
  legacyFallbacks: number;
};

const stats: PreanalysisCorrectionFastPathStats = {
  evaluations: 0,
  fastSolves: 0,
  legacyFallbacks: 0,
};

/** Test-only counters; production behavior is unchanged. */
export const resetPreanalysisCorrectionFastPathStats = (): void => {
  stats.evaluations = 0;
  stats.fastSolves = 0;
  stats.legacyFallbacks = 0;
};

export const recordPreanalysisCorrectionFastPathEvaluation = (): void => {
  stats.evaluations += 1;
};

export const recordPreanalysisCorrectionFastPathSolve = (): void => {
  stats.fastSolves += 1;
};

export const recordPreanalysisCorrectionFastPathFallback = (): void => {
  stats.legacyFallbacks += 1;
};

export const getPreanalysisCorrectionFastPathStats =
  (): PreanalysisCorrectionFastPathStats => ({ ...stats });
