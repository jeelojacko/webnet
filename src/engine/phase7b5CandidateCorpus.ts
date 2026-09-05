/**
 * Phase 7B.5 test-only candidate corpus simulation (pure, no routing).
 *
 * Every candidate is classified through `evaluateSparseProductionEligibility`,
 * unconditionally — eligible or not — so the corpus always records the exact
 * deterministic ineligibility reasons. Eligible + converged candidates are
 * then executed as the real sparse candidate inside the actual adjustment
 * worker by the test layer (existing runtime bridge); this module only builds
 * the deterministic simulation records. No production routing, tolerance, or
 * baseline changes.
 */
import {
  evaluateSparseProductionEligibility,
  type SparseProductionEligibilityInput,
} from './sparseProductionEligibility';

export interface Phase7b5CorpusCandidate {
  /** Stable case id, deterministic order in reports. */
  id: string;
  /** Representative family: industry, gps, robust, correlation, etc. */
  family: string;
  /** Committed fixture file or generator label backing this case. */
  source: string;
  /** WebNet input text for the TS reference solve. */
  input: string;
  /** Flags consumed by the eligibility classifier (declared per case). */
  eligibility: SparseProductionEligibilityInput;
  /** TS reference iterations; 0 forces reference-unconverged semantics. */
  maxIterations: number;
}

export interface Phase7b5CandidateRecord {
  id: string;
  family: string;
  source: string;
  eligible: boolean;
  reasons: string[];
  referenceSuccess: boolean;
  referenceConverged: boolean;
  referenceIterations: number;
  /** Why the sparse worker run was (or was not) attempted. */
  sparseDisposition: string;
}

/**
 * Classifies one candidate. Always invokes the eligibility classifier and
 * always records its reasons, even for ineligible or unconverged cases.
 */
export const classifyPhase7b5Candidate = (
  candidate: Phase7b5CorpusCandidate,
  reference: { success: boolean; converged: boolean; iterations: number },
): Phase7b5CandidateRecord => {
  const verdict = evaluateSparseProductionEligibility(candidate.eligibility);
  let sparseDisposition = 'sparse-worker-run';
  if (!verdict.eligible) {
    sparseDisposition = `skipped: ineligible (${verdict.reasons.join('; ')})`;
  } else if (!reference.success || !reference.converged) {
    sparseDisposition = 'skipped: reference-unconverged (no sparse comparison)';
  }
  return {
    id: candidate.id,
    family: candidate.family,
    source: candidate.source,
    eligible: verdict.eligible,
    reasons: verdict.reasons,
    referenceSuccess: reference.success,
    referenceConverged: reference.converged,
    referenceIterations: reference.iterations,
    sparseDisposition,
  };
};

/** Deterministic corpus summary: eligible / ineligible / unconverged counts. */
export const summarizePhase7b5Corpus = (
  records: Phase7b5CandidateRecord[],
): { total: number; eligible: number; ineligible: number; referenceUnconverged: number } => ({
  total: records.length,
  eligible: records.filter((record) => record.eligible).length,
  ineligible: records.filter((record) => !record.eligible).length,
  referenceUnconverged: records.filter(
    (record) => record.eligible && (!record.referenceSuccess || !record.referenceConverged),
  ).length,
});
