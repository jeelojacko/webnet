/**
 * V4/V5 calibration comparison + side-by-side human review (WV5).
 *
 * Types + shared identity constants only. Deterministic post-inference
 * comparison of the two frozen calibration-80 sibling runs (V4
 * unit-authoring-v4 and V5 unit-authoring-v5) matched through the
 * authoritative crosswalk report. No provider calls, no wall clock, no RNG:
 * every document uses the fixed 20260902 identity, crosswalk-seq ordering
 * and stable key ordering.
 */
import type {
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
} from './studyAiTypes';
import type { UnitAttemptRecord } from './studyAiUnitCalibrationAudit.types';

/** Fixed report identity convention shared by all 20260902 artifacts. */
export const COMPARE_DATE_TAG = '20260902';
export const COMPARE_GENERATED_AT = '2026-09-02T00:00:00.000Z';
export const COMPARE_SCHEMA_VERSION = 1;

/** The two OCR-artifact corpus strings probed by the Land Surveyors Act s.18(2) case. */
export const OCR_TARGET_STRINGS: readonly string[] = ['by - laws', 'Registr ar'];

/** Subset markers read from the V4 human-review artifact tags (do not hardcode job lists). */
export const SUBSET_TAG_FINAL_QC = 'final-map-grouping-adjudication';
export const SUBSET_TAG_ANCHOR = 'unit-v4-regression-anchor';
export const SUBSET_TAG_RETRY = 'map-retry-history';
export const SUBSET_TAG_REPEALED_MIX = 'repealed-mix';

/** Outcome classification for one run side of one crosswalk row. */
export type SideOutcomeStatus =
  | 'accepted'
  | 'semantic-failed'
  | 'provider-incomplete'
  | 'nothing';

/** One crosswalk row (authoritative v4↔v5 job mapping, seq order). */
export type CompareCrosswalkRow = {
  seq: number;
  proposalId: string;
  groupId: string;
  v4JobId: string;
  v5JobId: string;
  jobIdChanged: boolean;
  documentIds: string[];
  titleSuggestion: string;
  frozenMapPriority: string;
};

/** Run-side data the compare builders need (resolved from a frozen run dir). */
export type CompareRunSide = {
  runId: string;
  model: string;
  endpoint: string;
  concurrency: number;
  promptSpecVersion: string;
  specSha256: string;
  jobsByJobId: ReadonlyMap<string, AiUnitAuthoringJob>;
  attemptsByJobId: ReadonlyMap<string, UnitAttemptRecord[]>;
  resultsByProposalId: ReadonlyMap<string, AiStudyUnitProposal>;
};

/** Named-subset membership resolved from the V4 human-review artifact tags. */
export type CompareMembership = {
  finalQcIds: string[];
  anchorIds: string[];
  retryIds: string[];
  repealedMixIds: string[];
};

/** Everything the pure builders need; loaded + integrity-checked by the CLI. */
export type CompareContext = {
  cohortSize: number;
  v4Run: CompareRunSide;
  v5Run: CompareRunSide;
  crosswalkRows: CompareCrosswalkRow[];
  membership: CompareMembership;
  specShas: { v4: string | null; v5: string | null };
  crosswalkSha256: string | null;
  /** Raw corpus strings probed by the OCR case (defaults to the two known artifacts). */
  ocrTargetStrings: string[];
  /** v4 job id suffix identifying the Land Surveyors Act s.18(2) OCR cohort job. */
  ocrV4JobIdSuffix: string;
  /** Canonical validator re-run over one accepted proposal (any side). */
  validate: (_proposal: AiStudyUnitProposal) => CompareValidationRun;
};

/** Canonical validator re-run result for one accepted proposal. */
export type CompareValidationRun = {
  status: 'valid' | 'warnings' | 'invalid';
  /** All issue codes, sorted. */
  issueCodes: string[];
  /** Severity-error issue codes, sorted. */
  errorCodes: string[];
  /** Severity-warning issue codes, sorted. */
  warningCodes: string[];
  errorCount: number;
  warningCount: number;
};

export type CompareValidationIssueRef = {
  code: string;
  severity: 'error' | 'warning';
};

/** Per-run-side facts for one crosswalk row. */
export type CompareSideRow = {
  outcome: SideOutcomeStatus;
  proposal?: AiStudyUnitProposal;
  /** authoringStatus when accepted; null when no accepted result. */
  authoringStatus: string | null;
  attemptCount: number;
  rejectedAttemptFiles: number;
  rejectedSemanticAttempts: number;
  providerAttempts: number;
  validation: CompareValidationRun | null;
};

/** Unified per-crosswalk-row comparison record (built once, reused by both docs). */
export type CompareRow = {
  seq: number;
  proposalId: string;
  groupId: string;
  v4JobId: string;
  v5JobId: string;
  documentIds: string[];
  titleSuggestion: string;
  frozenMapPriority: string;
  named: {
    finalQc: boolean;
    anchor: boolean;
    retry: boolean;
    repealedMix: boolean;
  };
  v4: CompareSideRow;
  v5: CompareSideRow;
};

/** Revision-consistency flag keys (mirror the five V5 validator codes). */
export type V5RevisionConsistencyFlag =
  | 'generatedWithBroadWarning'
  | 'generatedWithSuggestion'
  | 'needsRevisionWithoutBroadWarning'
  | 'needsRevisionWithoutSuggestion'
  | 'needsRevisionWithContradictoryReason';

export type TierIndex = 1 | 2 | 3 | 4 | 5 | 6;

export const COMPARE_TIER_LABELS: Record<TierIndex, string> = {
  1: 'v5-failure',
  2: 'v5-needs-revision',
  3: 'status-change',
  4: 'warning-heavy',
  5: 'named',
  6: 'remainder',
};

/* ------------------------------------------------------------------ *
 * Comparison machine document                                       *
 * ------------------------------------------------------------------ */

export type ComparePerRunSection = {
  runId: string;
  model: string;
  endpoint: string;
  concurrency: number;
  promptSpecVersion: string;
  specSha256: string;
  jobsTotal: number;
  accepted: number;
  semanticFailed: number;
  providerIncomplete: number;
  nothing: number;
  totalRejectedAttemptFiles: number;
  rejectedSemanticAttempts: number;
  providerAttempts: number;
  worstRetryJob: { jobId: string; rejectedAttemptFiles: number } | null;
};

export type StatusTransitionMatrix = {
  /** Present authoring-status labels incl. the 'no-accepted-result' pseudo-status. */
  v4Statuses: string[];
  v5Statuses: string[];
  counts: Record<string, Record<string, number>>;
  total: number;
};

export type RevisionConsistencyBucket = {
  count: number;
  jobIds: string[];
};

export type RevisionConsistencySection = Record<
  V5RevisionConsistencyFlag,
  RevisionConsistencyBucket
>;

export type WarningHistogramSection = {
  /** Sorted union of warning codes seen on either run. */
  codes: string[];
  v4: Record<string, number>;
  v5: Record<string, number>;
  v4Total: number;
  v5Total: number;
  v4CoverageReconciliation: {
    expected: { APPROVED_FOCUS_NOT_COVERED: number; UNCOVERED_SUBSTANTIVE_SOURCE: number; total: number };
    recomputed: { APPROVED_FOCUS_NOT_COVERED: number; UNCOVERED_SUBSTANTIVE_SOURCE: number; total: number };
    matched: boolean;
    note: string;
  };
};

export type QuestionLengthStats = {
  count: number;
  meanLengthChars: number;
  overMain180: number;
  overMain240: number;
  overGuided160: number;
  overGuided220: number;
};

export type CompareQuestionsSection = {
  v4: QuestionLengthStats;
  v5: QuestionLengthStats;
};

export type AnchorComparisonRow = {
  seq: number;
  v4JobId: string;
  v5JobId: string;
  v4Status: string | null;
  v5Status: string | null;
  v4Warnings: string[];
  v5Warnings: string[];
  verdict: 'stable' | 'status-change' | 'new-warnings' | 'warnings-cleared';
};

export type NamedSubsetSection = {
  finalQc20: NamedSubsetRows;
  anchors7: NamedSubsetRows;
  retry9: NamedSubsetRows;
  repealedMix16: NamedSubsetRows;
};

export type NamedSubsetRows = {
  count: number;
  rows: Array<{
    seq: number;
    v4JobId: string;
    v5JobId: string;
    v4Status: string | null;
    v5Status: string | null;
  }>;
};

export type OcrStringPresence = {
  v4JobExactSourceText: boolean;
  v4EvidenceUnion: boolean;
  v5EvidenceUnion: boolean;
  v5ObjectiveIds: string[];
};

export type OcrCaseSection = {
  seq: number;
  v4JobId: string;
  v5JobId: string;
  groupId: string;
  titleSuggestion: string;
  byLaws: OcrStringPresence;
  registrar: OcrStringPresence;
};

export type ComparisonDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-v4-v5-comparison';
  dateTag: string;
  generatedAt: string;
  cohortSize: number;
  crosswalkSha256: string | null;
  specShas: { v4: string | null; v5: string | null };
  perRun: { v4: ComparePerRunSection; v5: ComparePerRunSection };
  statusTransitionMatrix: StatusTransitionMatrix;
  revisionConsistencyV5: RevisionConsistencySection;
  warnings: WarningHistogramSection;
  questions: CompareQuestionsSection;
  objectives: { v4: Record<string, number>; v5: Record<string, number> };
  anchors: AnchorComparisonRow[];
  ocrCase: OcrCaseSection;
  namedSubsets: NamedSubsetSection;
};

/* ------------------------------------------------------------------ *
 * Side-by-side human review document                                *
 * ------------------------------------------------------------------ */

export type CompareReviewSide = {
  outcome: SideOutcomeStatus;
  authoringStatus: string | null;
  warnings: string[];
  objectiveCount: number;
  attemptCount: number;
  mainQuestion: string | null;
};

export type CompareReviewV5Side = CompareReviewSide & {
  mapRevisionSuggestion: {
    reason: string;
    proposedGroupTitles: string[];
  } | null;
  /** Error then warning codes (each code ascending), severity-annotated. */
  validationIssues: Array<{ code: string; severity: 'error' | 'warning' }>;
};

export type CompareReviewRow = {
  seq: number;
  tier: TierIndex;
  v4JobId: string;
  v5JobId: string;
  documentIds: string[];
  titleSuggestion: string;
  frozenMapPriority: string;
  v4: CompareReviewSide;
  v5: CompareReviewV5Side;
};

export type CompareReviewSummary = {
  tierCounts: Record<string, number>;
  statusTransitions: Record<string, number>;
  revisionConsistency: Record<string, number>;
  ocrCase: {
    v4JobExactSourceText: boolean;
    v4EvidenceUnion: boolean;
    v5EvidenceUnion: boolean;
  };
};

export type CompareHumanReviewDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-v4-v5-human-review';
  dateTag: string;
  generatedAt: string;
  v4RunId: string;
  v5RunId: string;
  cohortSize: number;
  summary: CompareReviewSummary;
  rows: CompareReviewRow[];
};

export type CompareDocs = {
  comparison: ComparisonDoc;
  humanReview: CompareHumanReviewDoc;
};
