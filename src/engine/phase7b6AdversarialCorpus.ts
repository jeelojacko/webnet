/**
 * Phase 7B.6 deterministic adversarial/perturbation corpus (test-only).
 *
 * Expands the Phase 7B.5 candidate pattern to >=30 cases: strong-geometry
 * pass probes, the weak-resection divergence probe, ineligible false-admit
 * probes, reference-unconverged probes, and deterministic seed/iteration
 * perturbations. Every case classifies through `classifyPhase7b5Candidate`
 * (which always invokes `evaluateSparseProductionEligibility`), and corpus
 * verdicts distinguish false admits from false rejects. No production
 * routing, tolerance, or baseline changes.
 */
import {
  classifyPhase7b5Candidate,
  type Phase7b5CorpusCandidate,
} from './phase7b5CandidateCorpus';

export type Phase7b6CaseExpectation =
  | 'pass'
  | 'diverge-flag'
  | 'ineligible'
  | 'reference-unconverged';

export interface Phase7b6AdversarialCase extends Phase7b5CorpusCandidate {
  expectation: Phase7b6CaseExpectation;
}

export interface Phase7b6CorpusVerdict {
  id: string;
  expectation: Phase7b6CaseExpectation;
  eligible: boolean;
  reasons: string[];
  referenceSuccess: boolean;
  referenceConverged: boolean;
  sparseDisposition: string;
  /** Expected-pass case rejected before any sparse run. */
  falseReject: boolean;
  /** Expected-reject/diverge case cleared for a sparse run. */
  falseAdmit: boolean;
}

export interface Phase7b6CorpusSummary {
  total: number;
  passExpected: number;
  divergeExpected: number;
  ineligibleExpected: number;
  unconvergedExpected: number;
  falseAdmits: number;
  falseRejects: number;
}

/**
 * Classifies one adversarial case verdict under the FULL Phase 7B.6 gate.
 * A case is admitted only when legacy eligibility clears, the static
 * geometry preflight clears, and the reference converged — so the known
 * weak-resection hazard (legacy-eligible yet divergent) is held back by
 * preflight, not by luck. False admits (reject/diverge-expected cases
 * fully admitted) and false rejects (pass cases held back) are recorded
 * explicitly; both are corpus failures.
 */
export const classifyPhase7b6Verdict = (
  candidate: Phase7b6AdversarialCase,
  reference: { success: boolean; converged: boolean; iterations: number },
  preflightEligible: boolean,
): Phase7b6CorpusVerdict => {
  const record = classifyPhase7b5Candidate(candidate, reference);
  const admitted =
    record.sparseDisposition === 'sparse-worker-run' && preflightEligible;
  const falseAdmit =
    (candidate.expectation === 'ineligible' ||
      candidate.expectation === 'diverge-flag') &&
    admitted;
  const falseReject = candidate.expectation === 'pass' && !admitted;
  return {
    id: candidate.id,
    expectation: candidate.expectation,
    eligible: record.eligible,
    reasons: record.reasons,
    referenceSuccess: record.referenceSuccess,
    referenceConverged: record.referenceConverged,
    sparseDisposition: record.sparseDisposition,
    falseReject,
    falseAdmit,
  };
};

/** Deterministic corpus summary with false-admit/reject accounting. */
export const summarizePhase7b6Corpus = (
  verdicts: Phase7b6CorpusVerdict[],
): Phase7b6CorpusSummary => ({
  total: verdicts.length,
  passExpected: verdicts.filter((verdict) => verdict.expectation === 'pass').length,
  divergeExpected: verdicts.filter((verdict) => verdict.expectation === 'diverge-flag').length,
  ineligibleExpected: verdicts.filter(
    (verdict) => verdict.expectation === 'ineligible',
  ).length,
  unconvergedExpected: verdicts.filter(
    (verdict) => verdict.expectation === 'reference-unconverged',
  ).length,
  falseAdmits: verdicts.filter((verdict) => verdict.falseAdmit).length,
  falseRejects: verdicts.filter((verdict) => verdict.falseReject).length,
});
