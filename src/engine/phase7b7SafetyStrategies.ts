/**
 * Phase 7B.7 safety-strategy definitions (test-only, no routing).
 *
 * Four nested strategies bound what evidence a sparse candidate must
 * present before its result may be treated as authoritative. Every level
 * runs the sparse candidate, requires static-preflight admission and
 * final-result agreement; each level adds dense-oracle coverage over more
 * correction iterations (one sparse-solver call per iteration):
 *
 * - S0 `static-preflight+sparse`: preflight admission + final-result
 *   agreement (success/convergence/coordinates/height/iterations). No
 *   dense oracle.
 * - S1 `first-system-oracle`: S0 plus the dense rebuild oracle on the
 *   first correction system (correction agreement within 1e-9 absolute,
 *   undamped factor, finite condition evidence).
 * - S2 `first-two-systems`: S1 plus the same oracle gates on the second
 *   correction system. Fail-closed when fewer than two systems were
 *   captured.
 * - S3 `every-iteration`: oracle gates on EVERY captured correction
 *   system, and the captured count must equal the candidate iteration
 *   count (otherwise "every" cannot be claimed honestly). Capture is
 *   bounded (see PHASE7B7_MAX_CAPTURED_SYSTEMS); exceeding the bound
 *   rejects with an explicit limitation reason.
 *
 * Condition threshold excess warns exactly like production (never rejects);
 * missing/non-finite condition evidence rejects wherever the oracle runs.
 * No production routing, tolerance, or baseline changes.
 */
import {
  PHASE7B6_CORRECTION_TOLERANCE,
  PHASE7B6_HANDSHAKE_TOLERANCE_M,
} from './phase7b6CorrectionHandshake';

export type Phase7b7StrategyId = 'S0' | 'S1' | 'S2' | 'S3';

/** How many leading correction systems the dense oracle must clear. */
export type Phase7b7OracleCoverage = 0 | 1 | 2 | 'all';

export interface Phase7b7StrategySpec {
  id: Phase7b7StrategyId;
  label: string;
  /** True when a sparse candidate solve runs under this strategy. */
  runsSparseCandidate: boolean;
  /** True when the static geometry preflight gates admission. */
  requiresPreflight: boolean;
  /** True when final-result agreement gates acceptance. */
  requiresFinalAgreement: boolean;
  /** Leading correction systems the dense oracle must clear. */
  oracleSystemCount: Phase7b7OracleCoverage;
  /** True when finite condition evidence is required per oracled system. */
  requiresConditionEvidence: boolean;
}

/** Fixed-order strategy table; index order is the canonical report order. */
export const PHASE7B7_STRATEGIES: readonly Phase7b7StrategySpec[] = [
  {
    id: 'S0',
    label: 'static-preflight+sparse',
    runsSparseCandidate: true,
    requiresPreflight: true,
    requiresFinalAgreement: true,
    oracleSystemCount: 0,
    requiresConditionEvidence: false,
  },
  {
    id: 'S1',
    label: 'first-system-oracle',
    runsSparseCandidate: true,
    requiresPreflight: true,
    requiresFinalAgreement: true,
    oracleSystemCount: 1,
    requiresConditionEvidence: true,
  },
  {
    id: 'S2',
    label: 'first-two-systems',
    runsSparseCandidate: true,
    requiresPreflight: true,
    requiresFinalAgreement: true,
    oracleSystemCount: 2,
    requiresConditionEvidence: true,
  },
  {
    id: 'S3',
    label: 'every-iteration',
    runsSparseCandidate: true,
    requiresPreflight: true,
    requiresFinalAgreement: true,
    oracleSystemCount: 'all',
    requiresConditionEvidence: true,
  },
];

export const phase7b7StrategyById = (
  id: Phase7b7StrategyId,
): Phase7b7StrategySpec => {
  const found = PHASE7B7_STRATEGIES.find((strategy) => strategy.id === id);
  if (!found) throw new Error(`Unknown Phase 7B.7 strategy ${id}.`);
  return found;
};

/** Test-only bound on captured correction systems per solve. */
export const PHASE7B7_MAX_CAPTURED_SYSTEMS = 32;

export interface Phase7b7Tolerances {
  correctionTolerance: number;
  coordToleranceM: number;
}

/** Evidence-based tolerances shared by every strategy level. */
export const phase7b7Tolerances = (): Phase7b7Tolerances => ({
  correctionTolerance: PHASE7B6_CORRECTION_TOLERANCE,
  coordToleranceM: PHASE7B6_HANDSHAKE_TOLERANCE_M,
});

/**
 * Conservative evidence-based policy (see reports/phase7b7/):
 * the full S3 gate is recommended and sparse candidacy is capped at 64
 * unknown stations. Measured S3 (every-iteration) oracle medians vs
 * candidate end-to-end: 0.59/4.72 ms at 25, 2.25/8.86 ms at 50,
 * 3.72/11.97 ms at 64 — but 8.83/18.35 ms at 96 and 18.32/25.84 ms
 * at 128, where per-iteration dense rebuilds dominate. The 64 cap keeps
 * absolute S3 oracle cost under ~4.3 ms; every strong-geometry case
 * clears S3 at/below the cap while the weak resection stays rejected
 * at preflight.
 */
export const PHASE7B7_RECOMMENDED_STRATEGY: Phase7b7StrategyId = 'S3';
export const PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT = 64;
