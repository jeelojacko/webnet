/**
 * Post-QC Study Map semantic review — decision schema, parsing, and preview
 * classification. Pure, deterministic, no model inference, no writes.
 *
 * A review-decision file is the human's output over one of the deterministic
 * review bundles (adjacent P1, broad-group). Each decision names exactly one
 * accepted Map result (jobId) and decides, independently, the priority and
 * the grouping:
 *
 *   priorityDecision: 'keep' | 'change'   (with newPriority P1-P4 when change)
 *   groupingDecision: 'keep' | 'split' | 'combine' | 'reference-only' |
 *                     'skip' | 'needs-human-review'
 *
 * Classification (preview only — canonical results are never modified):
 *
 *   no-change                          priority kept AND grouping kept
 *   priority-only-adjudicable          grouping kept, priority changed —
 *                                      resolvable by re-issuing the SAME
 *                                      corrected Map result (same groups,
 *                                      new priority) through the ordinary
 *                                      human-adjudication path
 *   requires-corrected-map-result      grouping changed (or awaiting human
 *                                      review) — requires a complete corrected
 *                                      Map result artifact (new groups), not a
 *                                      metadata patch
 */
import type { AiSuggestedPriority } from './studyAiTypes';

export const REVIEW_DECISION_SCHEMA_VERSION = 1;
export const REVIEW_DECISION_TYPE = 'post-qc-map-semantic-review';

export type ReviewPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type PriorityDecision = 'keep' | 'change';
export type GroupingDecision =
  | 'keep'
  | 'split'
  | 'combine'
  | 'reference-only'
  | 'skip'
  | 'needs-human-review';
export type DecisionClassification =
  | 'no-change'
  | 'priority-only-adjudicable'
  | 'requires-corrected-map-result'
  | 'invalid';

export const REVIEW_PRIORITY_VALUES: ReviewPriority[] = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_DECISION_VALUES: PriorityDecision[] = ['keep', 'change'];
const GROUPING_DECISION_VALUES: GroupingDecision[] = [
  'keep',
  'split',
  'combine',
  'reference-only',
  'skip',
  'needs-human-review',
];
const JOB_ID_RE = /^map-[0-9a-f]{16}$/;

export interface MapReviewDecision {
  jobId: string;
  priorityDecision: PriorityDecision;
  /** Required (P1-P4) when priorityDecision is 'change'; null otherwise. */
  newPriority: ReviewPriority | null;
  groupingDecision: GroupingDecision;
  notes?: string;
}

export interface MapReviewDecisionFile {
  schemaVersion: 1;
  reviewType: 'post-qc-map-semantic-review';
  runId: string;
  decisions: MapReviewDecision[];
}

export interface ReviewDecisionIssue {
  /** null for file-level issues. */
  jobId: string | null;
  code: string;
  message: string;
}

export interface ClassifiedDecision {
  jobId: string;
  currentPriority: ReviewPriority | null;
  priorityDecision: PriorityDecision;
  newPriority: ReviewPriority | null;
  groupingDecision: GroupingDecision;
  classification: DecisionClassification;
  /** Deterministic reason code driving the classification. */
  reason: string;
  notes?: string;
}

export interface ClassifyResult {
  classifications: ClassifiedDecision[];
  issues: ReviewDecisionIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isReviewPriority = (value: unknown): value is ReviewPriority =>
  isString(value) && (REVIEW_PRIORITY_VALUES as string[]).includes(value);

const isPriorityDecision = (value: unknown): value is PriorityDecision =>
  isString(value) && (PRIORITY_DECISION_VALUES as string[]).includes(value);

const isGroupingDecision = (value: unknown): value is GroupingDecision =>
  isString(value) && (GROUPING_DECISION_VALUES as string[]).includes(value);

/**
 * Parse an unknown value into a MapReviewDecisionFile. Returns null file
 * plus issues when the document is structurally unusable; per-decision
 * issues also arrive here (so one report pass explains everything).
 */
export const parseMapReviewDecisionFile = (
  value: unknown,
): { file: MapReviewDecisionFile | null; issues: ReviewDecisionIssue[] } => {
  const issues: ReviewDecisionIssue[] = [];
  if (!isRecord(value)) {
    return {
      file: null,
      issues: [{ jobId: null, code: 'not-an-object', message: 'decision file is not a JSON object' }],
    };
  }
  if (value.schemaVersion !== REVIEW_DECISION_SCHEMA_VERSION) {
    issues.push({
      jobId: null,
      code: 'bad-schema-version',
      message: `schemaVersion must be ${REVIEW_DECISION_SCHEMA_VERSION}`,
    });
  }
  if (value.reviewType !== REVIEW_DECISION_TYPE) {
    issues.push({
      jobId: null,
      code: 'bad-review-type',
      message: `reviewType must be '${REVIEW_DECISION_TYPE}'`,
    });
  }
  if (!isString(value.runId) || value.runId.length === 0) {
    issues.push({ jobId: null, code: 'missing-run-id', message: 'runId must be a non-empty string' });
  }
  const rawDecisions = value.decisions;
  if (!Array.isArray(rawDecisions)) {
    issues.push({ jobId: null, code: 'missing-decisions', message: 'decisions must be an array' });
    return { file: null, issues };
  }
  if (rawDecisions.length === 0) {
    issues.push({ jobId: null, code: 'empty-decisions', message: 'decisions must not be empty' });
  }
  const seen = new Set<string>();
  const decisions: MapReviewDecision[] = [];
  rawDecisions.forEach((raw, index) => {
    if (!isRecord(raw)) {
      issues.push({ jobId: null, code: 'decision-not-an-object', message: `decision #${index} is not an object` });
      return;
    }
    const jobId = isString(raw.jobId) ? raw.jobId : '';
    if (!JOB_ID_RE.test(jobId)) {
      issues.push({
        jobId: jobId || null,
        code: 'bad-job-id',
        message: `decision #${index}: jobId must match map-<16 hex digits>`,
      });
    }
    if (seen.has(jobId)) {
      issues.push({ jobId, code: 'duplicate-job-id', message: `decision for ${jobId} appears more than once` });
    }
    seen.add(jobId);

    const priorityDecision = raw.priorityDecision;
    if (!isPriorityDecision(priorityDecision)) {
      issues.push({ jobId: jobId || null, code: 'bad-priority-decision', message: `decision for ${jobId || `#${index}`}: priorityDecision must be 'keep' or 'change'` });
      return;
    }
    const newPriority = raw.newPriority ?? null;
    if (newPriority !== null && !isReviewPriority(newPriority)) {
      issues.push({ jobId, code: 'bad-new-priority', message: `decision for ${jobId}: newPriority must be P1-P4 or null` });
      return;
    }
    if (priorityDecision === 'change' && newPriority === null) {
      issues.push({ jobId, code: 'change-without-new-priority', message: `decision for ${jobId}: priorityDecision 'change' requires newPriority P1-P4` });
    }
    if (priorityDecision === 'keep' && newPriority !== null) {
      issues.push({ jobId, code: 'keep-with-new-priority', message: `decision for ${jobId}: newPriority must be null when priorityDecision is 'keep'` });
    }
    const groupingDecision = raw.groupingDecision;
    if (!isGroupingDecision(groupingDecision)) {
      issues.push({
        jobId: jobId || null,
        code: 'bad-grouping-decision',
        message: `decision for ${jobId || `#${index}`}: groupingDecision must be one of ${GROUPING_DECISION_VALUES.join(', ')}`,
      });
      return;
    }
    decisions.push({
      jobId,
      priorityDecision,
      newPriority: newPriority === null ? null : (newPriority as ReviewPriority),
      groupingDecision,
      notes: isString(raw.notes) ? raw.notes : undefined,
    });
  });
  const file: MapReviewDecisionFile = {
    schemaVersion: 1,
    reviewType: REVIEW_DECISION_TYPE as 'post-qc-map-semantic-review',
    runId: isString(value.runId) ? value.runId : '',
    decisions,
  };
  return { file, issues };
};

/**
 * Classify parsed decisions against the current accepted state.
 * `currentPriorities` maps jobId -> suggestedPriority currently on the
 * accepted result (null when the result carries none).
 */
export const classifyMapReviewDecisions = (
  file: MapReviewDecisionFile,
  currentPriorities: Map<string, ReviewPriority | null>,
): ClassifyResult => {
  const classifications: ClassifiedDecision[] = [];
  const issues: ReviewDecisionIssue[] = [];
  for (const decision of file.decisions) {
    const current = currentPriorities.get(decision.jobId);
    const base = {
      jobId: decision.jobId,
      currentPriority: current ?? null,
      priorityDecision: decision.priorityDecision,
      newPriority: decision.newPriority,
      groupingDecision: decision.groupingDecision,
      notes: decision.notes,
    };
    if (!currentPriorities.has(decision.jobId)) {
      issues.push({
        jobId: decision.jobId,
        code: 'unknown-job',
        message: `${decision.jobId} has no accepted result in the run`,
      });
      classifications.push({ ...base, classification: 'invalid', reason: 'unknown-job' });
      continue;
    }
    const priorityChange = decision.priorityDecision === 'change' && decision.newPriority !== null;
    if (priorityChange && decision.newPriority === (current ?? null)) {
      issues.push({
        jobId: decision.jobId,
        code: 'ambiguous-priority-change',
        message: `${decision.jobId}: newPriority ${decision.newPriority} equals the current priority; pick keep or a different priority`,
      });
      classifications.push({ ...base, classification: 'invalid', reason: 'ambiguous-priority-change' });
      continue;
    }
    if (decision.groupingDecision === 'keep' && !priorityChange) {
      classifications.push({ ...base, classification: 'no-change', reason: 'keep-keep' });
    } else if (decision.groupingDecision === 'keep') {
      classifications.push({
        ...base,
        classification: 'priority-only-adjudicable',
        reason: 'priority-change-groups-unchanged',
      });
    } else if (decision.groupingDecision === 'needs-human-review') {
      classifications.push({
        ...base,
        classification: 'requires-corrected-map-result',
        reason: 'grouping-awaits-human-review',
      });
    } else {
      classifications.push({
        ...base,
        classification: 'requires-corrected-map-result',
        reason: `grouping-change-${decision.groupingDecision}`,
      });
    }
  }
  classifications.sort((a, b) => a.jobId.localeCompare(b.jobId));
  return { classifications, issues };
};
