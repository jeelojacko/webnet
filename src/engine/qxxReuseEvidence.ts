/**
 * Phase 10D test-only Qxx comparison probes.
 *
 * Instrumentation for comparing the recovered final dense Qxx against
 * the statistics Qxx. The eligibility gate lives in the production
 * module `./statisticsQxxReuse` and is re-exported here so existing
 * probe consumers keep a single import. Production default is automatic
 * reuse on the eligible cohort; the test-only `forceLegacyStatisticsQxx`
 * oracle forces the legacy recompute path. No formulas, tolerances, or
 * public result fields change.
 */

export type { StatisticsQxxReuseInput, StatisticsQxxReuseDecision } from './statisticsQxxReuse';
export { decideStatisticsQxxReuse } from './statisticsQxxReuse';

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
