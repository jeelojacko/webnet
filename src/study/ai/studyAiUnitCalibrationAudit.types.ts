/**
 * Deterministic post-inference audit of a frozen calibration-80 Unit
 * Authoring V4 run.
 *
 * Types only. Pure logic lives in `studyAiUnitCalibrationAudit.ts`, file IO
 * and SHA-256 capture in `studyAiUnitCalibrationAudit.load.ts`, small pure
 * helpers in `studyAiUnitCalibrationAudit.utils.ts`, and the four Markdown
 * renderers in `studyAiUnitCalibrationAudit.markdown.ts`.
 *
 * The audit is read-only against the run dir (never writes into it), uses a
 * fixed `generatedAt` for report identity, orders every listing by jobId, and
 * embeds SHA-256 digests of every key input so the artifacts are
 * independently reproducible.
 */
import type { NbLawContentPackage } from '../content/nbLawTypes';
import type { UnitCalibrationJobRecord } from './studyAiUnitCalibration';
import type { AiStudyUnitProposal, AiUnitAuthoringJob } from './studyAiTypes';

/** Fixed report identity convention shared by all 20260902 artifacts. */
export const AUDIT_DATE_TAG = '20260902';
export const AUDIT_GENERATED_AT = '2026-09-02T00:00:00.000Z';
export const AUDIT_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Run metadata / input shapes                                        *
 * ------------------------------------------------------------------ */

/** reports/local-run-metadata.json written by the local Unit runner. */
export type LocalUnitRunMetadata = {
  schemaVersion: number;
  runId: string;
  model: string;
  baseUrl: string;
  packagePath: string;
  promptSpecVersion: string;
  promptSha256: string;
  batch: string | null;
  concurrency: number;
  jobCount: number;
  jobIds: string[];
  jobsFileSha256: Record<string, string>;
  createdAt: string;
};

/** The frozen calibration selection doc (reports/unit-calibration-80-20260902.json). */
export type CalibrationSelectionDoc = {
  schemaVersion: number;
  kind: string;
  dateTag: string;
  seedTag: string;
  runId: string;
  generatedAt: string;
  promptSpecVersion: string;
  sourceMapRunId: string;
  preflightRunId: string;
  counts: {
    jobCount: number;
    pinCount: number;
    retryRepresentatives: number;
    anchorTaggedJobs: number;
    correctionJobIds: number;
  };
  pins: string[];
  retryTargetCoverage: Array<{ targetId: string; unitJobId: string | null; note?: string }>;
  anchorTargetCoverage: Array<{ targetId: string; unitJobId: string | null; note?: string }>;
  notes: Array<{ code: string; message: string }>;
  distributions: {
    priority: { target: Record<string, number>; actual: Record<string, number> };
    domain: { target: Record<string, number>; actual: Record<string, number> };
    provenanceMix: Record<string, number>;
    sizeBuckets: Record<string, number>;
    focusStyles: Record<string, number>;
  };
  runLayout: {
    runDir: string;
    batchSize: number;
    batchCount: number;
    batchFiles: Array<{ file: string; sha256: string }>;
  };
  jobs: UnitCalibrationJobRecord[];
};

/** results/<jobId>.provenance.json — the accepted attempt's runner provenance. */
export type UnitProvenance = {
  providerKind?: string;
  modelId?: string;
  runId?: string;
  jobId?: string;
  proposalId?: string;
  sourceJobInputHash?: string;
  sourceHashes?: Record<string, string>;
  attempt?: number;
  timestamp?: string;
  structuredOutputMode?: string;
  rawHash?: string;
  accepted?: boolean;
};

export type UnitAttemptKind = 'semantic' | 'provider';

/** One numbered local-failures attempt artifact (validation side). */
export type UnitAttemptRecord = {
  attempt: number;
  kind: UnitAttemptKind;
  issueCodes: string[];
  issues: Array<{ code: string; message: string }>;
  timestamp?: string;
  rawHash?: string;
};

/** One reports/provider-events.jsonl row (transport/provider recovery event). */
export type UnitProviderEvent = {
  runId: string;
  jobId: string;
  semanticAttempt: number;
  providerAttempt: number;
  timestamp?: string;
  code: string;
  message: string;
  httpStatus?: number;
  recovered?: boolean;
  waitedMs?: number;
  runAborted?: boolean;
};

export type AuditLoadedInputs = {
  runDirPath: string;
  selectionReportPath: string;
  packagePath: string;
  specPath: string | null;
  metadata: LocalUnitRunMetadata;
  metadataSha256: string;
  runJsonSha256: string;
  resultsJsonlSha256: string;
  selection: CalibrationSelectionDoc;
  selectionSha256: string;
  package: NbLawContentPackage;
  packageSha256: string;
  specSha256: string | null;
  /** Batch file digest rows: file -> sha256 (actual recomputed). */
  batchSha256: Array<{ file: string; sha256: string }>;
  /** Run job order: jobId per index in batch-file order (batch-major). */
  jobOrder: string[];
  /** jobId -> 1-based batch number (10 batches x 8 jobs). */
  batchByJobId: Map<string, number>;
  /** Every run job by jobId (from jobs/batch-*.jobs.jsonl). */
  jobsByJobId: Map<string, AiUnitAuthoringJob>;
  /** Accepted proposals keyed by proposalId (results/local-unit.results.jsonl). */
  resultsByProposalId: Map<string, AiStudyUnitProposal>;
  /** Provenance for accepted jobs keyed by jobId. */
  provenanceByJobId: Map<string, UnitProvenance>;
  /** Failure artifacts keyed by jobId (local-failures/<jobId>/). */
  attemptsByJobId: Map<string, UnitAttemptRecord[]>;
  /** Provider events (reports/provider-events.jsonl). */
  providerEvents: UnitProviderEvent[];
  providerEventsPresent: boolean;
};

/* ------------------------------------------------------------------ *
 * Per-job audit                                                      *
 * ------------------------------------------------------------------ */

export type UnitJobOutcomeStatus =
  | 'accepted'
  | 'semantic-failed'
  | 'provider-incomplete'
  | 'nothing';

export type ValidatorStatus = 'valid' | 'warnings' | 'invalid';

export type UnitValidationRun = {
  status: ValidatorStatus | 'not-revalidated';
  issueCodes: string[];
  issueCount: number;
  errorCount: number;
  warningCount: number;
};

export type JobSelectionFlags = {
  correction: boolean;
  retry: boolean;
  regression: boolean;
  pin: boolean;
  selectionReason: string;
  anchorTargetId?: string;
  retryTargetId?: string;
  tags: string[];
  provenance: string;
  parentKind?: string;
};

export type UnitAuditError = {
  code: string;
  jobId?: string;
  message: string;
};

export type UnitAuditFinding = {
  code: string;
  count: number;
  jobIds: string[];
  note: string;
};

export type JobAuditRecord = {
  jobId: string;
  batch: number;
  runIndex: number;
  status: UnitJobOutcomeStatus;
  frozenPriority: string | null;
  selection: JobSelectionFlags;
  domain: string;
  sourceKeyCount: number;
  sizeBucket: string;
  focusStyle: string;
  result?: AiStudyUnitProposal;
  provenance?: UnitProvenance;
  attempts: UnitAttemptRecord[];
  attemptsUsed: number;
  rejectedSemanticAttempts: number;
  providerAttempts: number;
  providerEventCount: number;
  identityErrors: UnitAuditError[];
  validation: UnitValidationRun;
  proposalWarnings: string[];
  objectiveCount: number;
  authoringStatus: string | null;
  hasMapRevisionSuggestion: boolean;
  coverageFlags: string[];
};

/* ------------------------------------------------------------------ *
 * Gap / histograms                                                  *
 * ------------------------------------------------------------------ */

export type PriorityGapRow = {
  priority: string;
  target: number;
  selected: number;
  accepted: number;
  semanticFailed: number;
  providerIncomplete: number;
  nothing: number;
  gap: number;
};

export type GapAccounting = {
  priority: {
    target: Record<string, number>;
    rows: PriorityGapRow[];
    exact: boolean;
    note: string;
  };
};

export type CountTable = Record<string, number>;

/* ------------------------------------------------------------------ *
 * Named subsets (resolved from selection + run data)                *
 * ------------------------------------------------------------------ */

export type FinalQcParent = {
  parentId: string;
  mapJobId: string;
  documentTitle: string;
  sections: string[];
  unitJobIds: string[];
  count: number;
};

export type RegressionAnchorRow = {
  targetId: string;
  unitJobId: string;
  note?: string;
  outcome: UnitJobOutcomeStatus;
};

export type RetryTargetRow = {
  targetId: string;
  unitJobId: string;
  note?: string;
  outcome: UnitJobOutcomeStatus;
};

/** Named subsets resolved deterministically from selection + jobs. */
export type AuditSubsets = {
  finalQc: {
    count: number;
    parents: FinalQcParent[];
    unitJobIds: string[];
  };
  regressionAnchors: {
    count: number;
    rows: RegressionAnchorRow[];
  };
  retryNine: {
    count: number;
    rows: RetryTargetRow[];
  };
  containsRepealedSubprovision: {
    count: number;
    unitJobIds: string[];
  };
};

/* ------------------------------------------------------------------ *
 * Review / risk ordering                                            *
 * ------------------------------------------------------------------ */

export type RiskCategoryIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type RiskCategory = {
  index: RiskCategoryIndex;
  label: string;
};

/* ------------------------------------------------------------------ *
 * Audit / review documents                                           *
 * ------------------------------------------------------------------ */

export type InputDigestSummary = {
  runDirPath: string;
  selectionReportPath: string;
  selectionReportSha256: string | null;
  runJsonSha256: string | null;
  metadataSha256: string | null;
  resultsJsonlSha256: string | null;
  packageSha256: string | null;
  specSha256: string | null;
  batchFiles: Array<{ file: string; sha256: string | null }>;
  jobsFileSha256FromMetadata: Record<string, string>;
  metadataJobIdsMatchSelection: boolean;
  metadataJobCount: number;
  selectionJobCount: number;
};

export type CompletionRow = {
  batch: number;
  expected: number;
  accepted: number;
  semanticFailed: number;
  providerIncomplete: number;
  nothing: number;
};

export type AuditCompletion = {
  expected: number;
  accepted: number;
  semanticFailed: number;
  providerIncomplete: number;
  nothing: number;
  perBatch: CompletionRow[];
};

export type AuditPerJobRow = {
  jobId: string;
  batch: number;
  runIndex: number;
  status: UnitJobOutcomeStatus;
  priority: string | null;
  authoringStatus: string | null;
  suggestedPriority: string | null;
  objectiveCount: number;
  validationStatus: ValidatorStatus | 'not-revalidated';
  issueCodes: string[];
  rejectedSemanticAttempts: number;
  attemptsUsed: number;
  providerEventCount: number;
  identityErrorCount: number;
};

export type AuditDistributions = {
  authoringStatus: CountTable;
  suggestedPriority: CountTable;
  confidence: CountTable;
  warnings: CountTable;
  objectives: CountTable;
  sevenPlusObjectives: string[];
  domains: CountTable;
  focusStyles: CountTable;
  mapDisposition: CountTable;
  parentKind: CountTable;
  sourceCounts: CountTable;
  sizeBuckets: CountTable;
  provenance: CountTable;
  attemptsUsed: CountTable;
  issueCodesAcrossAttempts: CountTable;
  providerEventReferences: CountTable;
};

export type AuditDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-result-audit';
  dateTag: string;
  runId: string;
  generatedAt: string;
  promptSpecVersion: string;
  sourceMapRunId: string;
  inputs: InputDigestSummary;
  completion: AuditCompletion;
  gap: GapAccounting;
  auditErrors: UnitAuditError[];
  auditFindings: UnitAuditFinding[];
  identity: {
    checkedProposals: number;
    errors: UnitAuditError[];
    suggestedPriorityMatches: number;
    suggestedPriorityMismatches: UnitAuditError[];
  };
  validation: {
    revalidated: number;
    valid: number;
    warnings: number;
    invalid: number;
    issueCodeCounts: CountTable;
    issueSeverityCounts: Record<'error' | 'warning', number>;
    notRevalidated: number;
  };
  overlaps: {
    checked: number;
    sourceOverlaps: number;
    jobsWithOverlap: string[];
  };
  distributions: AuditDistributions;
  perJob: AuditPerJobRow[];
  subsets: AuditSubsets;
};

/** Human-review row content (all 80 selected jobs). */
export type ReviewSourceContext = {
  documentTitle: string;
  documentId: string | null;
  sections: string[];
  groupTitle: string;
  groupGoal: string;
  sourceKeys: string[];
  focus: Array<{ sourceKey: string; childLabels: string[] }>;
  exactSourceTextLength: number | null;
  operativeSourceTextLength: number | null;
  exactSourcePreview: string;
  containsRepealedSubprovision: boolean;
  mixedLiveRepealed: boolean;
  tags: string[];
};

export type ReviewGeneratedFields = {
  title: string;
  mainQuestion: string;
  studySummary: string;
  objectives: Array<{
    id: string;
    type: string;
    objective: string;
    evidenceCount: number;
    confidence: string;
    sourceKeys: string[];
    evidence: Array<{ sourceKey: string; evidenceText: string }>;
  }>;
  objectiveCount: number;
  confidence: string;
  warnings: string[];
  authoringStatus: string | null;
  mapRevisionSuggestion: {
    present: boolean;
    reason: string;
    proposedGroupCount: number;
  };
};

export type ReviewUnitEntry = {
  rank: number;
  categoryIndex: RiskCategoryIndex;
  categoryLabel: string;
  categoryReason: string;
  jobId: string;
  batch: number;
  runIndex: number;
  status: UnitJobOutcomeStatus;
  domain: string;
  sourceContext: ReviewSourceContext;
  generated: ReviewGeneratedFields | null;
  validation: {
    status: ValidatorStatus | 'not-revalidated';
    issueCodes: string[];
    issueCount: number;
    errorCount: number;
    warningCount: number;
  };
  attempts: {
    attemptsUsed: number;
    rejectedSemanticAttempts: number;
    providerAttempts: number;
    providerEventCount: number;
    perAttempt: Array<{
      attempt: number;
      kind: UnitAttemptKind;
      issueCodes: string[];
      issues: Array<{ code: string; message: string }>;
      timestamp: string | null;
    }>;
  };
  provenance: {
    modelId: string | null;
    attempt: number | null;
    structuredOutputMode: string | null;
    timestamp: string | null;
    rawHash: string | null;
    sourceJobInputHash: string | null;
  } | null;
  identityErrors: UnitAuditError[];
};

export type ReviewDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-human-review';
  dateTag: string;
  runId: string;
  generatedAt: string;
  promptSpecVersion: string;
  total: number;
  categoryCounts: CountTable;
  units: ReviewUnitEntry[];
};

/** Regression anchors companion doc (7 rows). */
export type RegressionAnchorDocRow = {
  targetId: string;
  unitJobId: string | null;
  resolved: boolean;
  outcome: string;
  priority: string | null;
  authoringStatus: string | null;
  warnings: string[];
  objectiveCount: number;
  title: string;
};

export type RegressionAnchorsDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-regression-anchors';
  dateTag: string;
  runId: string;
  generatedAt: string;
  total: number;
  anchors: RegressionAnchorDocRow[];
};

/** Final-QC companion doc (20 rows grouped under 8 correction parents). */
export type FinalQcUnitRow = {
  jobId: string;
  status: UnitJobOutcomeStatus;
  authoringStatus: string | null;
  suggestedPriority: string | null;
  warnings: string[];
  objectiveCount: number;
  title: string;
  oneLineSummary: string;
};

export type FinalQcDoc = {
  schemaVersion: number;
  kind: 'unit-calibration-final-qc';
  dateTag: string;
  runId: string;
  generatedAt: string;
  total: number;
  parents: Array<{
    parentId: string;
    mapJobId: string;
    documentTitle: string;
    sections: string[];
    count: number;
    units: FinalQcUnitRow[];
  }>;
};

/** The four machine documents + records produced by one audit run. */
export type AuditBundle = {
  audit: AuditDoc;
  review: ReviewDoc;
  regressionAnchors: RegressionAnchorsDoc;
  finalQc: FinalQcDoc;
  records: JobAuditRecord[];
};

export type { UnitCalibrationJobRecord };
