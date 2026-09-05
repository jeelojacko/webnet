/**
 * Pure fail-closed sparse production eligibility classifier (test-only).
 *
 * Decides whether a network would be allowed onto a hypothetical sparse
 * production route. It is NOT wired into any solver, worker, or benchmark
 * routing: production stays TypeScript-dense regardless of the verdict.
 * Every ineligibility carries a deterministic, human-readable reason in a
 * fixed check order so repeated evaluations are byte-identical.
 */
import type { RunMode } from '../typesParseSettings';

export type SparseEligibilityDimension = '2d' | '3d';

export type SparseEligibilityRankRisk = 'none' | 'suspect' | 'deficient';

export interface SparseProductionEligibilityInput {
  dimension: SparseEligibilityDimension;
  unknownCount: number;
  maxUnknownCount: number;
  runMode: RunMode;
  robustWeighting: boolean;
  tsCorrelation: boolean;
  gpsCovarianceWeighting: boolean;
  wasmAvailable: boolean;
  workerAvailable: boolean;
  rankRisk: SparseEligibilityRankRisk;
}

export interface SparseProductionEligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * Fails closed: any unmet gate makes the network ineligible. Reasons are
 * appended in a fixed order (mode, WASM, worker, robust, correlation,
 * dimension, size, rank) independent of input construction order.
 */
export const evaluateSparseProductionEligibility = (
  input: SparseProductionEligibilityInput,
): SparseProductionEligibility => {
  const reasons: string[] = [];
  if (input.runMode !== 'adjustment') {
    reasons.push(`unsupported runMode '${input.runMode}': sparse production requires 'adjustment'`);
  }
  if (!input.wasmAvailable) {
    reasons.push('WASM sparse module unavailable');
  }
  if (!input.workerAvailable) {
    reasons.push('sparse worker unavailable');
  }
  if (input.robustWeighting) {
    reasons.push('robust reweighting not cleared for sparse production');
  }
  if (input.tsCorrelation) {
    reasons.push('TS correlation not cleared for sparse production');
  }
  if (input.gpsCovarianceWeighting) {
    reasons.push('GPS covariance weighting not cleared for sparse production');
  }
  if (input.dimension !== '2d') {
    reasons.push(`dimension '${input.dimension}' not cleared for sparse production`);
  }
  if (input.unknownCount > input.maxUnknownCount) {
    reasons.push(
      `size guard: ${input.unknownCount} unknowns exceed SPARSE_PRODUCTION_MAX_UNKNOWN_COUNT=${input.maxUnknownCount}`,
    );
  }
  if (input.rankRisk !== 'none') {
    reasons.push(`rank risk '${input.rankRisk}': datum/weak-geometry risk not cleared`);
  }
  return { eligible: reasons.length === 0, reasons };
};
