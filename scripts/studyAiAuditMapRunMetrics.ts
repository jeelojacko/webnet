/**
 * Deterministic metric computation and semantic-review bundle selection for
 * the local Study Map run auditor. Pure functions over `JobAuditRecord`
 * lists; no filesystem access, no LLM calls.
 */

import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { failureOrigin } from './studyAiAuditMapRunCore';
import type { ComparisonSetJob, JobAuditRecord, NormalizedIssue } from './studyAiAuditMapRunCore';

export const wordCount = (text: string): number => {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
};

/** Nearest-rank stats; mean rounded to 2 decimals. Empty input => zeros. */
export const wordStats = (
  values: number[],
): { mean: number; median: number; p95: number; max: number } => {
  if (values.length === 0) return { mean: 0, median: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const at = (rank: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(rank * sorted.length) - 1))];
  return {
    mean: Number((sum / sorted.length).toFixed(2)),
    median: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
};

export const countBy = (values: string[]): Record<string, number> =>
  [...values].sort().reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

export const computeReliability = (records: JobAuditRecord[]) => {
  const accepted = records.filter((record) => record.accepted);
  const permanentlyFailed = records.filter((record) => !record.accepted);
  // Jobs with no semantic attempt on record failed at the provider/transport
  // layer (or were never reached); they are infrastructure-incomplete, not
  // semantic failures. Both counts are reported alongside the legacy total.
  const semanticFailedJobs = permanentlyFailed.filter((record) => record.semanticAttempts > 0);
  const providerIncompleteJobs = permanentlyFailed.filter((record) => record.semanticAttempts === 0);
  const totalAttempts = records.reduce((sum, record) => sum + record.totalAttempts, 0);
  const semanticAttemptsTotal = records.reduce((sum, record) => sum + record.semanticAttempts, 0);
  const providerAttemptsTotal = records.reduce((sum, record) => sum + record.providerAttempts, 0);
  // attempts = count of failed semantic attempt records carrying the code;
  // provider attempts carry no validation codes and are excluded so the
  // per-code distribution stays purely semantic.
  // affected/recovered = distinct jobs, for a per-job recovery rate.
  const perCode = new Map<string, { attempts: number; affected: number; recovered: number }>();
  const bump = (code: string): void => {
    const entry = perCode.get(code) ?? { attempts: 0, affected: 0, recovered: 0 };
    entry.attempts += 1;
    perCode.set(code, entry);
  };
  for (const record of records) {
    const codesInRecord = new Set<string>();
    for (const attempt of record.attempts) {
      if (attempt.provider) continue;
      for (const code of attempt.issueCodes) {
        bump(code);
        codesInRecord.add(code);
      }
    }
    for (const code of codesInRecord) {
      const entry = perCode.get(code) as { attempts: number; affected: number; recovered: number };
      entry.affected += 1;
      if (record.accepted) entry.recovered += 1;
    }
  }
  const errorCodes = [...perCode.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([code, value]) => ({
      code,
      failedAttempts: value.attempts,
      affectedJobs: value.affected,
      recoveredJobs: value.recovered,
      recoveryRate: value.affected > 0 ? Number((value.recovered / value.affected).toFixed(3)) : 0,
    }));
  return {
    selectedJobs: records.length,
    acceptedJobs: accepted.length,
    permanentlyFailed: permanentlyFailed.length,
    // Provider reliability is separate from semantic reliability: jobs with
    // no semantic attempts are provider-incomplete, not semantic failures.
    semanticPermanentFailures: semanticFailedJobs.length,
    providerIncompleteJobs: providerIncompleteJobs.length,
    acceptanceRate: records.length > 0 ? Number((accepted.length / records.length).toFixed(3)) : 0,
    firstTryAccepted: records.filter((record) => record.firstTryAccepted).length,
    firstSemanticAttemptAccepted: records.filter((record) => record.firstSemanticAttemptAccepted)
      .length,
    // "Accepted after retry" was ambiguous (provider retries look identical to
    // semantic retries in a combined count); the split below keeps the two
    // recovery paths separately accountable.
    acceptedAfterSemanticRetry: accepted.filter((record) => record.semanticAttempts > 0).length,
    acceptedAfterProviderRecovery: accepted.filter((record) => record.providerAttempts > 0).length,
    semanticRetryJobs: records.filter((record) => record.semanticAttempts > 0).length,
    // Of the jobs that needed at least one semantic retry, how many eventually
    // produced an accepted result.
    semanticRecoveryRate: (() => {
      const retried = records.filter((record) => record.semanticAttempts > 0).length;
      return retried > 0
        ? Number(
            (accepted.filter((record) => record.semanticAttempts > 0).length / retried).toFixed(3),
          )
        : 0;
    })(),
    totalAttempts,
    semanticAttemptsTotal,
    providerAttemptsTotal,
    extraAttempts: totalAttempts - records.length,
    retryIntroducedDifferentErrorCount: records.filter(
      (record) => record.retryIntroducedDifferentError,
    ).length,
    repeatedIdenticalErrorCount: records.filter((record) => record.repeatedIdenticalError).length,
    permanentlyFailedJobs: permanentlyFailed.map((record) => ({
      jobId: record.jobId,
      documentId: record.documentId,
      origin: failureOrigin(record),
      attempts: record.totalAttempts,
      semanticAttempts: record.semanticAttempts,
      providerAttempts: record.providerAttempts,
      issueCodes: [...new Set(record.attempts
        .filter((attempt) => !attempt.provider)
        .flatMap((attempt) => attempt.issueCodes))].sort(),
    })),
    perErrorCode: errorCodes,
  };
};

export const computePerStratum = (records: JobAuditRecord[]) => {
  const strata = new Map<string, JobAuditRecord[]>();
  for (const record of records) {
    for (const label of [...record.categories, ...record.structuralStrata]) {
      const list = strata.get(label) ?? [];
      list.push(record);
      strata.set(label, list);
    }
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [label, list] of [...strata.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const accepted = list.filter((record) => record.accepted);
    const totalAttempts = list.reduce((sum, record) => sum + record.totalAttempts, 0);
    out[label] = {
      selected: list.length,
      accepted: accepted.length,
      firstTryAccepted: list.filter((record) => record.firstTryAccepted).length,
      permanentlyFailed: list.length - accepted.length,
      totalAttempts,
      extraAttempts: totalAttempts - list.length,
    };
  }
  return out;
};

export const computeStructureMetrics = (
  records: JobAuditRecord[],
  finalValidation: Map<string, NormalizedIssue[]>,
) => {
  const results = records
    .map((record) => record.result)
    .filter((value): value is AiStudyMapResult => value !== null);
  const dispositions = countBy(results.map((result) => result.disposition));
  const confidence = countBy(results.map((result) => result.confidence));
  const priorities = countBy(results.map((result) => result.suggestedPriority ?? 'none'));
  const groupCounts = results.map((result) => result.proposedGroups.length);
  const groupCountStats = wordStats(groupCounts);
  const warningCodes = countBy(
    [...finalValidation.values()]
      .flat()
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.code),
  );
  const finalValidationErrors = [...finalValidation.values()].filter((issues) =>
    issues.some((issue) => issue.severity === 'error'),
  ).length;
  return {
    acceptedResults: results.length,
    dispositions,
    confidence,
    priorities,
    totalGroups: groupCounts.reduce((sum, value) => sum + value, 0),
    groupCount: groupCountStats,
    averageWarningsPerResult:
      results.length > 0
        ? Number(
            (
              results.reduce((sum, result) => sum + result.warnings.length, 0) / results.length
            ).toFixed(3),
          )
        : 0,
    finalValidation: {
      errors: finalValidationErrors,
      warningCodes,
      broadFocusWarnings: warningCodes['BROAD_FOCUS_WITHOUT_EVIDENCE'] ?? 0,
      unboundedFocusWarnings: warningCodes['FOCUS_SELECTION_UNBOUNDED'] ?? 0,
      structuredFieldLeakageWarnings: warningCodes['STRUCTURED_FIELD_LEAKAGE'] ?? 0,
    },
  };
};

export const computeConcision = (records: JobAuditRecord[]) => {
  const results = records
    .map((record) => record.result)
    .filter((value): value is AiStudyMapResult => value !== null);
  const reasons = results.map((result) => wordCount(result.reason));
  const groupReasons = results.flatMap((result) =>
    result.proposedGroups.map((group) => wordCount(group.reason)),
  );
  const goals = results.flatMap((result) =>
    result.proposedGroups.map((group) => wordCount(group.approximateLearningGoal)),
  );
  const titles = results.flatMap((result) =>
    result.proposedGroups.map((group) => group.titleSuggestion.length),
  );
  return {
    thresholds: { reasonWords: 40, groupReasonWords: 30, learningGoalWords: 60 },
    reason: { ...wordStats(reasons), overThreshold: reasons.filter((value) => value > 40).length },
    groupReason: {
      ...wordStats(groupReasons),
      overThreshold: groupReasons.filter((value) => value > 30).length,
    },
    approximateLearningGoal: {
      ...wordStats(goals),
      overThreshold: goals.filter((value) => value > 60).length,
    },
    titleLengthChars: wordStats(titles),
  };
};

const HYGIENE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'calibration-pattern-reference', pattern: /calibration\s+(pattern|example)/i },
  { label: 'prompt-reference', pattern: /\bthe prompt\b/i },
  { label: 'instructions-reference', pattern: /\bthese instructions\b/i },
  {
    label: 'ai-identity-reference',
    pattern: /\b(?:as\s+(?:an?\s+)?(?:ai|llm)\b|artificial\s+intelligence\b|language\s+model\b)/i,
  },
];

const snippetAround = (text: string, index: number): string => {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

export const computeHygiene = (records: JobAuditRecord[]) => {
  const findings: Array<{ jobId: string; field: string; pattern: string; snippet: string }> = [];
  for (const record of records) {
    const result = record.result;
    if (result === null) continue;
    const fields: Array<[string, string]> = [
      ['reason', result.reason],
      ...result.proposedGroups.flatMap(
        (group, groupIndex): Array<[string, string]> => [
          [`group[${groupIndex}].titleSuggestion`, group.titleSuggestion],
          [`group[${groupIndex}].reason`, group.reason],
          [`group[${groupIndex}].approximateLearningGoal`, group.approximateLearningGoal],
        ],
      ),
    ];
    for (const [field, text] of fields) {
      for (const { label, pattern } of HYGIENE_PATTERNS) {
        const match = pattern.exec(text);
        if (match !== null) {
          findings.push({
            jobId: record.jobId,
            field,
            pattern: label,
            snippet: snippetAround(text, match.index),
          });
        }
      }
    }
  }
  return findings;
};

export type V1ComparisonEntry = {
  jobId: string;
  v1JobId: string;
  disposition: { v1: string; v2: string; same: boolean };
  groupCount: { v1: number; v2: number; same: boolean };
  confidence: { v1: string; v2: string; same: boolean };
  priority: { v1?: string; v2?: string; same?: boolean; comparable: boolean };
};

export const computeV1Comparison = (
  records: JobAuditRecord[],
  setJobs: Map<string, ComparisonSetJob>,
  v1Results: Map<string, AiStudyMapResult>,
) => {
  const comparable: V1ComparisonEntry[] = [];
  let mapped = 0;
  let missing = 0;
  for (const record of records) {
    if (!record.accepted) continue;
    const setJob = setJobs.get(record.jobId);
    const v1Result = setJob?.v1JobId ? v1Results.get(setJob.v1JobId) : undefined;
    mapped += 1;
    if (!setJob?.v1JobId || v1Result === undefined) {
      missing += 1;
      continue;
    }
    const v2 = record.result as AiStudyMapResult;
    const v1 = v1Result;
    const priorityComparable =
      v1.suggestedPriority != null && v2.suggestedPriority != null;
    comparable.push({
      jobId: record.jobId,
      v1JobId: setJob.v1JobId,
      disposition: {
        v1: v1.disposition,
        v2: v2.disposition,
        same: v1.disposition === v2.disposition,
      },
      groupCount: {
        v1: v1.proposedGroups.length,
        v2: v2.proposedGroups.length,
        same: v1.proposedGroups.length === v2.proposedGroups.length,
      },
      confidence: { v1: v1.confidence, v2: v2.confidence, same: v1.confidence === v2.confidence },
      priority: {
        v1: v1.suggestedPriority ?? undefined,
        v2: v2.suggestedPriority ?? undefined,
        same: priorityComparable ? v1.suggestedPriority === v2.suggestedPriority : undefined,
        comparable: priorityComparable,
      },
    });
  }
  return {
    note: 'Descriptive V1/V2 comparison only; V1 is a pedagogical comparator, not ground truth. No accuracy score is computed.',
    v1Mapped: mapped,
    v1MissingOrNotAccepted: missing,
    comparable: comparable.length,
    dispositionSame: comparable.filter((entry) => entry.disposition.same).length,
    dispositionDiff: comparable.filter((entry) => !entry.disposition.same).length,
    groupCountSame: comparable.filter((entry) => entry.groupCount.same).length,
    groupCountDiff: comparable.filter((entry) => !entry.groupCount.same).length,
    confidenceSame: comparable.filter((entry) => entry.confidence.same).length,
    confidenceDiff: comparable.filter((entry) => !entry.confidence.same).length,
    prioritySame: comparable.filter(
      (entry) => entry.priority.comparable && entry.priority.same === true,
    ).length,
    priorityDiff: comparable.filter(
      (entry) => entry.priority.comparable && entry.priority.same === false,
    ).length,
    priorityNotComparable: comparable.filter((entry) => !entry.priority.comparable).length,
    perJob: comparable,
  };
};

/** Review tiers in priority order; index 0 fills first. */
/**
 * Structural/risk strata that justify extra human review on top of the
 * semantic tiers. Kept as a stable list so bundle composition is auditable.
 */
const RISK_STRATA = [
  'cross-reference-heavy provision',
  'surveying-specific provision',
  'large-operative-section',
  'many-child-labels',
  'definitions-context',
  'direct-reference-context',
  'omitted-context-warnings',
  'deadline',
  'filing requirement',
  'prohibition',
  'procedural rule',
  'regulation-making power',
  'short-simple-provision',
] as const;

export const reviewTierFor = (
  record: JobAuditRecord,
  finalIssues: NormalizedIssue[] | undefined,
): { tier: number; label: string } => {
  if (!record.accepted) return { tier: 0, label: 'permanent-failure' };
  // Genuine semantic retries only: a job whose retries were all provider
  // failures has no semantic reliability question for a human to review.
  if (record.semanticAttempts > 0) return { tier: 1, label: 'semantic-retry' };
  const result = record.result as AiStudyMapResult;
  if (result.confidence === 'low') return { tier: 2, label: 'low-confidence' };
  if (result.disposition === 'needs-human-review') return { tier: 3, label: 'needs-human-review' };
  if ((finalIssues ?? []).some((issue) => issue.severity === 'warning'))
    return { tier: 4, label: 'final-warning' };
  if (result.suggestedPriority === 'P1') return { tier: 5, label: 'priority-p1' };
  if (result.proposedGroups.length >= 3) return { tier: 6, label: 'multi-group' };
  const risk = [...record.structuralStrata, ...record.categories].find((label) =>
    (RISK_STRATA as readonly string[]).includes(label),
  );
  if (risk !== undefined) return { tier: 7, label: risk };
  // Provider recovery is informational for humans: the semantic content was
  // first-try clean, so it is reviewed only after every semantic tier is done.
  if (record.providerAttempts > 0) return { tier: 8, label: 'provider-recovery' };
  return { tier: 9, label: 'clean' };
};

/**
 * Deterministic human-readable reason a record was selected into the review
 * bundle. Stored on each bundle entry so a reviewer does not have to re-derive
 * the trigger from attempt metadata.
 */
export const reviewReasonFor = (
  record: JobAuditRecord,
  tierLabel: string,
  finalIssues: NormalizedIssue[] | undefined,
): string => {
  if (tierLabel === 'permanent-failure') {
    // Dedupe: attempt records repeat a code once per offending issue.
    const codes = record.permanentFailureAttempt
      ? [...new Set(record.permanentFailureAttempt.issueCodes)].sort().join(', ')
      : '';
    return codes
      ? `last semantic attempt failed with ${codes}`
      : 'no semantic validation codes recorded';
  }
  switch (tierLabel) {
    case 'semantic-retry':
      return `semantic-retry: ${record.semanticAttempts} semantic attempt(s) failed before acceptance`;
    case 'low-confidence':
      return 'final result confidence is low';
    case 'needs-human-review':
      return 'final disposition is needs-human-review';
    case 'final-warning':
      return `final validation warning(s): ${
        (finalIssues ?? [])
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.code)
          .join(', ')
      }`;
    case 'priority-p1':
      return 'final suggested priority is P1';
    case 'multi-group':
      return `final result proposes ${(record.result as AiStudyMapResult).proposedGroups.length} groups`;
    case 'provider-recovery':
      return `provider recovered after ${record.providerAttempts} provider failure(s)`;
    case 'clean':
      return 'clean control selected for disposition/stratum diversity';
    default:
      return `risk stratum: ${tierLabel}`;
  }
};

/**
 * Deterministic selection for the semantic review bundle: mandatory tiers are
 * exhausted before lower-priority tiers, and within a tier documents are
 * interleaved round-robin for diversity (then jobId order).
 */
export const selectReviewBundle = (
  records: JobAuditRecord[],
  reviewSize: number,
  finalValidation: Map<string, NormalizedIssue[]>,
): Array<{ record: JobAuditRecord; tier: number; tierLabel: string }> => {
  const byTier = new Map<number, JobAuditRecord[]>();
  for (const record of records) {
    // Provider-incomplete jobs have no semantic content to review; they are
    // reported by the reliability metrics instead of the semantic bundle.
    if (!record.accepted && record.semanticAttempts === 0) continue;
    const { tier } = reviewTierFor(record, finalValidation.get(record.jobId));
    const list = byTier.get(tier) ?? [];
    list.push(record);
    byTier.set(tier, list);
  }
  const selected: Array<{ record: JobAuditRecord; tier: number; tierLabel: string }> = [];
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (const tier of tiers) {
    if (selected.length >= reviewSize) break;
    const tierRecords = byTier.get(tier) as JobAuditRecord[];
    const tierLabel = reviewTierFor(
      tierRecords[0],
      finalValidation.get(tierRecords[0]?.jobId),
    ).label;
    // Clean controls are interleaved by disposition so the tail of the bundle
    // still covers standalone/split/reference-only/skip diversity; every other
    // tier interleaves by document.
    const keyFor = (record: JobAuditRecord): string =>
      tier === 9 ? String((record.result as AiStudyMapResult).disposition) : (record.documentId ?? '');
    const byDoc = new Map<string, JobAuditRecord[]>();
    for (const record of byTier.get(tier) as JobAuditRecord[]) {
      const key = keyFor(record);
      const list = byDoc.get(key) ?? [];
      list.push(record);
      byDoc.set(key, list);
    }
    const docs = [...byDoc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const queues = docs.map(([, list]) => [...list].sort((a, b) => (a.jobId < b.jobId ? -1 : 1)));
    const roundRobin: JobAuditRecord[] = [];
    while (roundRobin.length < queues.reduce((sum, queue) => sum + queue.length, 0)) {
      let added = false;
      for (const queue of queues) {
        const next = queue.shift();
        if (next !== undefined) {
          roundRobin.push(next);
          added = true;
        }
        if (roundRobin.length >= reviewSize - selected.length) break;
      }
      if (!added) break;
    }
    for (const record of roundRobin) {
      if (selected.length >= reviewSize) break;
      selected.push({ record, tier, tierLabel });
    }
  }
  return selected;
};

const truncate = (text: string, limit = 800): string =>
  text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;

/** One JSONL entry for the semantic review bundle. */
export const buildReviewBundleEntry = (args: {
  record: JobAuditRecord;
  tier: number;
  tierLabel: string;
  job: AiStudyMapJob | null;
  setJob: ComparisonSetJob | null;
  finalIssues: NormalizedIssue[] | undefined;
  v1Result: AiStudyMapResult | null;
  v1Location: string | null;
}) => {
  const { record, job, setJob } = args;
  const context = job?.context;
  const entry: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'study-map-semantic-review',
    jobId: record.jobId,
    // Review metadata: label plus the deterministic trigger, so a reviewer
    // does not have to re-derive the selection reason from attempt metadata.
    reviewTier: record.accepted ? args.tierLabel : 'permanent-failure',
    reviewReason: reviewReasonFor(record, record.accepted ? args.tierLabel : 'permanent-failure', args.finalIssues),
    document: job?.document ?? setJob?.document ?? null,
    target: job
      ? {
          sourceKeys: job.target.sourceKeys,
          sectionLabels: job.target.sectionLabels,
          componentType: job.target.componentType,
          heading: job.target.heading,
          operativeSourceText: job.target.operativeSourceText,
        }
      : null,
    context: context
      ? {
          previous: context.previous ? truncate(context.previous.text) : null,
          next: context.next ? truncate(context.next.text) : null,
          relevantDefinitions: (context.relevantDefinitions ?? []).map((entry) =>
            truncate(entry.text),
          ),
          directlyReferencedProvisions: (context.directlyReferencedProvisions ?? []).map((entry) =>
            truncate(entry.text),
          ),
          omittedContextWarnings: context.omittedContextWarnings ?? [],
        }
      : null,
    sourceFocusOptions: job?.target.sourceFocusOptions ?? null,
    contentFlags: job?.target.contentFlags ?? null,
    approximateInputSize: job?.target.approximateInputSize ?? null,
    complexityCategory: record.categories,
    structuralStrata: record.structuralStrata,
    failureOrigin: failureOrigin(record),
    reasonSelectedForReview: reviewReasonFor(record, args.tierLabel, args.finalIssues),
    // semanticAttempts = semantic generations made (failed ones + the accepted
    // one when the job succeeded); semanticInvalidAttempts = failed ones.
    semanticAttempts: record.semanticAttempts + (record.accepted ? 1 : 0),
    semanticInvalidAttempts: record.semanticAttempts,
    providerAttempts: record.providerAttempts,
    providerFailureEvents: record.providerAttempts,
    // A provider failure is only a recovery in hindsight of a job that
    // ultimately produced an accepted result.
    providerRecoveryEvents: record.accepted ? record.providerAttempts : 0,
    finalConfidence: record.result !== null ? (record.result as AiStudyMapResult).confidence : null,
    finalWarnings: (args.finalIssues ?? [])
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => ({ code: issue.code, message: issue.message })),
    attemptCount: record.totalAttempts,
    retryIntroducedDifferentError: record.retryIntroducedDifferentError,
    attempts: record.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      provider: attempt.provider,
      issueCodes: attempt.issueCodes,
      issues: attempt.issues,
    })),
    finalValidationIssues: args.finalIssues ?? [],
    finalResult: record.result,
    permanentFailure: record.permanentFailureAttempt
      ? {
          attempt: record.permanentFailureAttempt.attempt,
          issueCodes: record.permanentFailureAttempt.issueCodes,
        }
      : null,
    v1:
      setJob?.v1JobId !== undefined && setJob.v1JobId !== null
        ? {
            jobId: setJob.v1JobId,
            location: args.v1Location,
            result: args.v1Result,
            comparatorNote: 'V1 is a pedagogical comparator only, not ground truth.',
          }
        : null,
  };
  return entry;
};
