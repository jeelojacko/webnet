/**
 * Pure, deterministic helpers for the V4/V5 calibration comparison (WV5):
 * outcome classification, revision-consistency detection (mirroring the five
 * V5 validator codes), the contradictory-reason phrase detector, question
 * length statistics, warning histograms, anchor verdicts, the six-tier risk
 * ordering and the status transition matrix. No IO, no wall clock, no RNG.
 */
import type { AiStudyUnitProposal } from './studyAiTypes';
import type { UnitAttemptRecord } from './studyAiUnitCalibrationAudit.types';
import type {
  CompareSideRow,
  CompareValidationRun,
  SideOutcomeStatus,
  TierIndex,
  V5RevisionConsistencyFlag,
} from './studyAiUnitCalibrationCompare.types';

/** Status matrix pseudo-status used when a side has no accepted result. */
export const NO_ACCEPTED_RESULT = 'no-accepted-result';

const normalizePhrase = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();

/** The five contradictory map-revision phrases (verbatim V5 contract). */
export const CONTRADICTORY_REVISION_PHRASES: readonly string[] = [
  'no revision needed',
  'no further revision is required',
  'no structural change required',
  'appropriately scoped as a single unit',
  'current grouping is appropriate',
];

/**
 * Case-insensitive contradictory-phrase detector over a map-revision reason.
 * Returns the matched phrase (normalized) or null. Mirrors the V5
 * validator's `checkContradictoryReason` predicate.
 */
export const contradictoryPhraseHit = (reason: string): string | null => {
  const normalized = normalizePhrase(reason);
  const phrase = CONTRADICTORY_REVISION_PHRASES.find((candidate) =>
    normalized.includes(normalizePhrase(candidate)),
  );
  return phrase ?? null;
};

/* ------------------------------------------------------------------ *
 * Counting / statistics helpers                                     *
 * ------------------------------------------------------------------ */

export const sortedUnique = (values: Iterable<string>): string[] =>
  Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const countBy = (values: Array<string | null | undefined>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? NO_ACCEPTED_RESULT;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

/** Reinserts a count table with numeric keys ascending ('1', '2', ..., '10'). */
export const sortedNumericCountTable = (counts: Record<string, number>): Record<string, number> => {
  const ordered: Record<string, number> = {};
  for (const key of Object.keys(counts).sort(
    (a, b) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0),
  )) {
    ordered[key] = counts[key];
  }
  return ordered;
};

/** Deterministic two-decimal mean (0 when no samples). */
export const meanLengthChars = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  return Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100) / 100;
};

export const greaterThanCount = (samples: number[], threshold: number): number =>
  samples.filter((value) => value > threshold).length;

/* ------------------------------------------------------------------ *
 * Attempts / outcome classification                                 *
 * ------------------------------------------------------------------ */

export const classifySideAttempts = (
  attempts: UnitAttemptRecord[],
): {
  outcome: SideOutcomeStatus;
  rejectedAttemptFiles: number;
  rejectedSemanticAttempts: number;
  providerAttempts: number;
} => {
  const rejectedAttemptFiles = attempts.length;
  const rejectedSemanticAttempts = attempts.filter(
    (attempt) => attempt.kind === 'semantic',
  ).length;
  const providerAttempts = rejectedAttemptFiles - rejectedSemanticAttempts;
  let outcome: SideOutcomeStatus = 'nothing';
  if (rejectedSemanticAttempts > 0) outcome = 'semantic-failed';
  else if (providerAttempts > 0) outcome = 'provider-incomplete';
  return { outcome, rejectedAttemptFiles, rejectedSemanticAttempts, providerAttempts };
};

/** One run-side comparison record from the accepted proposal + failure artifacts. */
export const sideRowOf = (
  proposal: AiStudyUnitProposal | undefined,
  attempts: UnitAttemptRecord[],
  validation: CompareValidationRun | null,
): CompareSideRow => {
  const classified = classifySideAttempts(attempts);
  const accepted = proposal !== undefined;
  const outcome: SideOutcomeStatus = accepted ? 'accepted' : classified.outcome;
  return {
    outcome,
    proposal,
    authoringStatus: accepted ? (proposal.authoringStatus ?? null) : null,
    attemptCount: accepted ? classified.rejectedSemanticAttempts + 1 : attempts.length,
    rejectedAttemptFiles: classified.rejectedAttemptFiles,
    rejectedSemanticAttempts: classified.rejectedSemanticAttempts,
    providerAttempts: classified.providerAttempts,
    validation,
  };
};

export const authoringStatusKeyOf = (side: CompareSideRow): string =>
  side.outcome === 'accepted'
    ? (side.authoringStatus ?? 'no-authoring-status')
    : NO_ACCEPTED_RESULT;

/* ------------------------------------------------------------------ *
 * Revision consistency (target zero under the V5 contract)          *
 * ------------------------------------------------------------------ */

const FLAG_ORDER: readonly V5RevisionConsistencyFlag[] = [
  'generatedWithBroadWarning',
  'generatedWithSuggestion',
  'needsRevisionWithoutBroadWarning',
  'needsRevisionWithoutSuggestion',
  'needsRevisionWithContradictoryReason',
];

const suggestionMissing = (proposal: AiStudyUnitProposal): boolean => {
  const suggestion = proposal.mapRevisionSuggestion;
  return (
    suggestion === undefined ||
    typeof suggestion.reason !== 'string' ||
    suggestion.reason.trim().length === 0 ||
    !Array.isArray(suggestion.proposedGroups) ||
    suggestion.proposedGroups.length < 2
  );
};

const revisionFlagsOf = (proposal: AiStudyUnitProposal): V5RevisionConsistencyFlag[] => {
  const flags: V5RevisionConsistencyFlag[] = [];
  const status = proposal.authoringStatus;
  const broadWarning = (proposal.warnings ?? []).includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT');
  if (status === 'generated') {
    if (broadWarning) flags.push('generatedWithBroadWarning');
    if (proposal.mapRevisionSuggestion !== undefined) flags.push('generatedWithSuggestion');
  }
  if (status === 'needs-map-revision') {
    if (!broadWarning) flags.push('needsRevisionWithoutBroadWarning');
    if (suggestionMissing(proposal)) flags.push('needsRevisionWithoutSuggestion');
    else if (contradictoryPhraseHit(proposal.mapRevisionSuggestion?.reason ?? '') !== null)
      flags.push('needsRevisionWithContradictoryReason');
  }
  return flags;
};

export type RevisionConsistencyBucketRow = {
  seq: number;
  v5JobId: string;
  v5: CompareSideRow;
};

/**
 * Revision-consistency buckets over the accepted V5 side (each nonzero
 * bucket carries its v5 jobIds, seq-ordered). Deterministic given rows.
 */
export const revisionConsistencyBucketsOf = (
  rows: RevisionConsistencyBucketRow[],
): Record<V5RevisionConsistencyFlag, { count: number; jobIds: string[] }> => {
  const buckets = Object.fromEntries(
    FLAG_ORDER.map((flag) => [flag, { count: 0, jobIds: [] as string[] }]),
  ) as Record<V5RevisionConsistencyFlag, { count: number; jobIds: string[] }>;
  for (const row of rows) {
    const proposal = row.v5.proposal;
    if (proposal === undefined) continue;
    for (const flag of revisionFlagsOf(proposal)) {
      buckets[flag].count += 1;
      buckets[flag].jobIds.push(row.v5JobId);
    }
  }
  return buckets;
};

/* ------------------------------------------------------------------ *
 * Status transition matrix                                          *
 * ------------------------------------------------------------------ */

export const statusTransitionMatrixOf = (
  rows: Array<{ v4: CompareSideRow; v5: CompareSideRow }>,
): {
  v4Statuses: string[];
  v5Statuses: string[];
  counts: Record<string, Record<string, number>>;
  total: number;
} => {
  const v4Statuses = sortedUnique(rows.map((row) => authoringStatusKeyOf(row.v4)));
  const v5Statuses = sortedUnique(rows.map((row) => authoringStatusKeyOf(row.v5)));
  const counts: Record<string, Record<string, number>> = {};
  for (const status of v4Statuses) {
    const byV5: Record<string, number> = {};
    for (const status5 of v5Statuses) byV5[status5] = 0;
    counts[status] = byV5;
  }
  for (const row of rows) {
    counts[authoringStatusKeyOf(row.v4)][authoringStatusKeyOf(row.v5)] += 1;
  }
  return { v4Statuses, v5Statuses, counts, total: rows.length };
};

/* ------------------------------------------------------------------ *
 * Anchor verdict                                                    *
 * ------------------------------------------------------------------ */

export const anchorVerdictOf = (
  v4Status: string | null,
  v5Status: string | null,
  v4Warnings: string[],
  v5Warnings: string[],
): 'stable' | 'status-change' | 'new-warnings' | 'warnings-cleared' => {
  if (v4Status !== v5Status) return 'status-change';
  const v4Set = new Set(v4Warnings);
  const v5Set = new Set(v5Warnings);
  if (v5Warnings.some((code) => !v4Set.has(code))) return 'new-warnings';
  if (v4Warnings.some((code) => !v5Set.has(code))) return 'warnings-cleared';
  return 'stable';
};

/* ------------------------------------------------------------------ *
 * Six-tier risk ordering (first matching tier wins; ties by seq)    *
 * ------------------------------------------------------------------ */

export type CompareTierInput = {
  v5Accepted: boolean;
  v5AuthoringStatus: string | null;
  v4AuthoringStatus: string | null;
  v4Warnings: string[];
  v5Warnings: string[];
  named: boolean;
};

export const tierIndexOf = (input: CompareTierInput): TierIndex => {
  if (!input.v5Accepted) return 1;
  if (input.v5AuthoringStatus === 'needs-map-revision') return 2;
  if (input.v4AuthoringStatus !== input.v5AuthoringStatus) return 3;
  const v4Count = input.v4Warnings.length;
  const v5Count = input.v5Warnings.length;
  if (v5Count >= 3 || v5Count >= v4Count + 2) return 4;
  if (input.named) return 5;
  return 6;
};

/* ------------------------------------------------------------------ *
 * OCR probing                                                       *
 * ------------------------------------------------------------------ */

/** Does any objective evidence across the proposal contain the raw string? */
export const evidenceUnionHasString = (
  proposal: AiStudyUnitProposal | undefined,
  target: string,
): boolean =>
  (proposal?.objectives ?? []).some((objective) =>
    (objective.evidence ?? []).some((evidence) => evidence.evidenceText.includes(target)),
  );

/** Objective ids (proposal order, deduped) whose evidence contains the string. */
export const objectiveIdsCarryingString = (
  proposal: AiStudyUnitProposal,
  target: string,
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const objective of proposal.objectives ?? []) {
    if (seen.has(objective.id)) continue;
    const hit = (objective.evidence ?? []).some((evidence) =>
      evidence.evidenceText.includes(target),
    );
    if (hit) {
      ids.push(objective.id);
      seen.add(objective.id);
    }
  }
  return ids;
};
