/**
 * Test-only route diagnostics for the experimental sparse numerical paths.
 *
 * Production defaults are unchanged: the diagnostics object is optional, and
 * every recorder no-ops when it is absent. Tests inject one shared instance
 * (forwarded through nested solves) to count sparse attempts versus dense
 * fallbacks and to capture fallback reasons.
 */
export interface ExperimentalSparseRouteDiagnostics {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  sparseCorrectionFallbackReasons: string[];
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  rowProductsFallbackReasons: string[];
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  selectedCovarianceFallbackReasons: string[];
  /** Sparse raw-N condition estimates; first correction iteration only. */
  sparseConditionEstimates: number[];
}

export const createExperimentalSparseRouteDiagnostics =
  (): ExperimentalSparseRouteDiagnostics => ({
    sparseCorrectionCalls: 0,
    sparseCorrectionFallbacks: 0,
    sparseCorrectionFallbackReasons: [],
    rowProductsCalls: 0,
    rowProductsFallbacks: 0,
    rowProductsFallbackReasons: [],
    selectedCovarianceCalls: 0,
    selectedCovarianceFallbacks: 0,
    selectedCovarianceFallbackReasons: [],
    sparseConditionEstimates: [],
  });

const pushReason = (reasons: string[], reason: string): void => {
  reasons.push(reason.slice(0, 300));
};

export const recordSparseCorrectionCall = (
  diagnostics?: ExperimentalSparseRouteDiagnostics,
): void => {
  if (diagnostics) diagnostics.sparseCorrectionCalls += 1;
};

export const recordSparseCorrectionFallback = (
  diagnostics: ExperimentalSparseRouteDiagnostics | undefined,
  reason: string,
): void => {
  if (!diagnostics) return;
  diagnostics.sparseCorrectionFallbacks += 1;
  pushReason(diagnostics.sparseCorrectionFallbackReasons, reason);
};

export const recordRowProductsCall = (
  diagnostics?: ExperimentalSparseRouteDiagnostics,
): void => {
  if (diagnostics) diagnostics.rowProductsCalls += 1;
};

export const recordRowProductsFallback = (
  diagnostics: ExperimentalSparseRouteDiagnostics | undefined,
  reason: string,
): void => {
  if (!diagnostics) return;
  diagnostics.rowProductsFallbacks += 1;
  pushReason(diagnostics.rowProductsFallbackReasons, reason);
};

export const recordSelectedCovarianceCall = (
  diagnostics?: ExperimentalSparseRouteDiagnostics,
): void => {
  if (diagnostics) diagnostics.selectedCovarianceCalls += 1;
};

export const recordSelectedCovarianceFallback = (
  diagnostics: ExperimentalSparseRouteDiagnostics | undefined,
  reason: string,
): void => {
  if (!diagnostics) return;
  diagnostics.selectedCovarianceFallbacks += 1;
  pushReason(diagnostics.selectedCovarianceFallbackReasons, reason);
};

/**
 * Records a sparse raw-N condition estimate for the first correction
 * iteration only. Later iterations and non-finite estimates are ignored;
 * metadata only, never production output.
 */
export const recordSparseConditionEstimate = (
  diagnostics: ExperimentalSparseRouteDiagnostics | undefined,
  estimate: number,
  iterationNumber: number,
): void => {
  if (!diagnostics || iterationNumber !== 1) return;
  if (diagnostics.sparseConditionEstimates.length > 0) return;
  if (!Number.isFinite(estimate)) return;
  diagnostics.sparseConditionEstimates.push(estimate);
};
