/**
 * Freeze gate + map/proposal/job equivalence audit for the canonical frozen
 * Study Map run.
 *
 * `verifyFrozenStudyMap` fails closed on ANY mismatch against the tracked
 * `reports/study-map-final-freeze-20260901.json` freeze report and the frozen
 * canonical facts below. `auditMapProposalEquivalence` joins every canonical
 * result row to its map proposal (`id = "<runId>:<jobId>"`) and its prepared
 * map job and reports every identity / semantic difference.
 *
 * Pure logic only: no model calls, deterministic, importable by tests. Reads
 * are self-contained (small JSONL/JSON readers) so this module has no
 * dependency on `scripts/studyAiAuthoring.ts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type {
  AiStudyDisposition,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
} from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Frozen canonical constants (do not drift from the freeze report)    *
 * ------------------------------------------------------------------ */

/** Full canonical run directory name (freeze report `runId`). */
export const FROZEN_MAP_RUN_ID =
  'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';

/** Short run id carried inside artifacts (job rows / proposals / results). */
export const FROZEN_MAP_RUN_ABBREV_ID = 'ai-map-2026-08-29T12-23-57-891Z';

export const FROZEN_RESULT_ROW_COUNT = 3692;

export const FROZEN_PRIORITY_DISTRIBUTION: Record<string, number> = {
  P1: 175,
  P2: 1458,
  P3: 1054,
  P4: 284,
  null: 721,
};

/** The nine final grouping corrections from the freeze report (8 grouped + 1 skip). */
export const FROZEN_GROUPING_CORRECTION_JOB_IDS = [
  'map-10ff468d35d10873', // Registry Act s.71 (split, 2)
  'map-19c48590a1b233de', // Clean Water Act s.40 (split, 3)
  'map-445b7c242fa7ca8e', // Clean Water Act s.13 (split, 4)
  'map-48b1a91a069cabde', // Trespass Act s.1 (split, 2)
  'map-52353c0c8b64b6d3', // Crown Lands and Forests Act s.95 (split, 3)
  'map-7c48e28797b91624', // Registry Act s.66 (standalone, 1)
  'map-8860d90d22aae7ed', // Public Health Act s.68 (split, 3)
  'map-d1fadd2dfd0ce395', // Aquaculture Act s.90 (split, 2)
  'map-d747c4a97d7161d3', // Service New Brunswick Act s.56 (skip, 0)
];

export const RUNS_DIR_REL = 'study-content/ai/runs';
export const FREEZE_REPORT_REL_PATH = 'reports/study-map-final-freeze-20260901.json';
export const FREEZE_DECISION_FILE_REL_PATH =
  'temp/study-ai-final-map-review/chatgpt-post-qc-map-review-decisions-FINAL-CANDIDATE.json';
export const CANONICAL_RESULTS_REL_PATH = 'results/local-map.results.jsonl';
export const MAP_PROPOSALS_REL_PATH = 'reports/map-proposals.json';

export const canonicalRunDir = (runId: string = FROZEN_MAP_RUN_ID): string =>
  join(RUNS_DIR_REL, runId);

/* ------------------------------------------------------------------ *
 * Shared readers (self-contained)                                     *
 * ------------------------------------------------------------------ */

export const sha256File = (filePath: string): string | null => {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
};

export const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const readJsonlFile = <T>(filePath: string): T[] => {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
};

/** Every prepared map job across `batch-*.jobs.jsonl`, in sorted file order. */
export const readPreparedMapJobs = (runDir: string): AiStudyMapJob[] =>
  readdirSync(join(runDir, 'jobs'))
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonlFile<AiStudyMapJob>(join(runDir, 'jobs', file)));

export const readCanonicalResults = (runDir: string): AiStudyMapResult[] =>
  readJsonlFile<AiStudyMapResult>(join(runDir, CANONICAL_RESULTS_REL_PATH));

export const readMapProposals = (runDir: string): AiStudyMapProposal[] =>
  readJsonFile<AiStudyMapProposal[]>(join(runDir, MAP_PROPOSALS_REL_PATH)) ?? [];

/* ------------------------------------------------------------------ *
 * Freeze verification                                                  *
 * ------------------------------------------------------------------ */

export type FrozenMapIssue = { code: string; message: string };

export type FrozenFreezeReport = {
  runId?: unknown;
  finalState?: {
    resultRows?: unknown;
    priorityDistribution?: unknown;
    pinnedAnchors?: { allFound?: unknown };
  };
  adjudication?: {
    failed?: unknown;
    verification?: { resultRowsInvalid?: unknown };
  };
  inputs?: { decisionFileSha256?: unknown };
  regeneratedReports?: Array<{ file?: unknown; sha256?: unknown }>;
  groupingCorrections?: unknown[];
};

export type FrozenMapVerification = {
  ok: boolean;
  issues: FrozenMapIssue[];
  runId: string;
  freezeReportPath: string;
  resultRows: number;
  priorityRecount: Record<string, number>;
  invalidRowIds: string[];
  groupingCorrectionJobIds: string[];
  decisionFileSha256: string | null;
  recordedDecisionFileSha256: string | null;
  proposalsSha256: string | null;
  recordedProposalsSha256: string | null;
  canonicalResultsSha256: string | null;
};

export type FreezeGateOptions = {
  freezeReportPath?: string;
  runDir?: string;
  decisionFilePath?: string;
  expectedRunId?: string;
  expectedResultRows?: number;
  expectedPriorityDistribution?: Record<string, number>;
  groupingCorrectionJobIds?: string[];
};

const describeMismatch = (actual: unknown, expected: unknown): string =>
  `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;

const recountPriorities = (rows: AiStudyMapResult[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.suggestedPriority ?? 'null';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const MAP_DISPOSITIONS = new Set<string>([
  'standalone',
  'combine',
  'split',
  'reference-only',
  'skip',
  'needs-human-review',
]);
const CONFIDENCES = new Set<string>(['high', 'medium', 'low']);
const PRIORITIES = new Set<string>(['P1', 'P2', 'P3', 'P4']);

/**
 * Cheap schema-presence validation for canonical map result rows (not the full
 * semantic validator). Mirrors the model-facing strict schema: presence of the
 * identity/semantic fields, enum membership, well-formed groups, and the
 * priority rule (P1-P4 exactly when `proposedGroups` is non-empty, null when
 * empty). Returns a human-readable problem per violation.
 */
export const frozenMapRowPresenceIssues = (row: AiStudyMapResult): string[] => {
  const issues: string[] = [];
  const push = (field: string, problem: string): void => {
    issues.push(`${field} ${problem}`);
  };
  if (row.schemaVersion !== 1) push('schemaVersion', `must be 1, got ${row.schemaVersion}`);
  if (typeof row.jobId !== 'string' || !row.jobId) push('jobId', 'must be a non-empty string');
  if (typeof row.runId !== 'string' || !row.runId) push('runId', 'must be a non-empty string');
  if (typeof row.corpusContentHash !== 'string' || !row.corpusContentHash)
    push('corpusContentHash', 'must be a non-empty string');
  if (!MAP_DISPOSITIONS.has(row.disposition))
    push('disposition', `must be one of standalone/combine/split/reference-only/skip/needs-human-review, got ${row.disposition}`);
  if (!CONFIDENCES.has(row.confidence)) push('confidence', `must be high/medium/low, got ${row.confidence}`);
  if (typeof row.reason !== 'string') push('reason', 'must be a string');
  if (!Array.isArray(row.warnings)) push('warnings', 'must be an array');
  if (!Array.isArray(row.proposedGroups)) push('proposedGroups', 'must be an array');
  if (Array.isArray(row.proposedGroups)) {
    const groupedDispositions = new Set<string>(['standalone', 'combine', 'split']);
    if (groupedDispositions.has(row.disposition) && row.proposedGroups.length === 0)
      push('proposedGroups', `must be non-empty for disposition ${row.disposition}`);
    if (
      (row.disposition === 'skip' || row.disposition === 'reference-only') &&
      row.proposedGroups.length > 0
    )
      push('proposedGroups', `must be empty for disposition ${row.disposition}`);
    if (row.proposedGroups.length > 0) {
      if (row.suggestedPriority === undefined || row.suggestedPriority === null)
        push('suggestedPriority', 'must be P1-P4 when proposedGroups is non-empty');
      else if (!PRIORITIES.has(row.suggestedPriority))
        push('suggestedPriority', `must be P1-P4, got ${row.suggestedPriority}`);
    } else if (row.suggestedPriority !== undefined && row.suggestedPriority !== null) {
      push('suggestedPriority', 'must be null when proposedGroups is empty');
    }
    row.proposedGroups.forEach((group, groupIndex) => {
      const where = `proposedGroups[${groupIndex}]`;
      if (!group || typeof group !== 'object') return;
      if (typeof group.groupId !== 'string' || !group.groupId)
        push(`${where}.groupId`, 'must be a non-empty string');
      if (typeof group.titleSuggestion !== 'string') push(`${where}.titleSuggestion`, 'must be a string');
      if (!Array.isArray(group.sourceKeys) || group.sourceKeys.length === 0)
        push(`${where}.sourceKeys`, 'must be a non-empty array');
      if (typeof group.reason !== 'string') push(`${where}.reason`, 'must be a string');
      if (typeof group.approximateLearningGoal !== 'string')
        push(`${where}.approximateLearningGoal`, 'must be a string');
      if (!Array.isArray(group.focusSelections)) push(`${where}.focusSelections`, 'must be an array');
      else
        group.focusSelections.forEach((focus, focusIndex) => {
          const fwhere = `${where}.focusSelections[${focusIndex}]`;
          if (typeof focus.sourceKey !== 'string' || !focus.sourceKey)
            push(`${fwhere}.sourceKey`, 'must be a non-empty string');
          if (focus.childLabels !== undefined && !Array.isArray(focus.childLabels))
            push(`${fwhere}.childLabels`, 'must be an array');
          if (focus.definedTerms !== undefined && !Array.isArray(focus.definedTerms))
            push(`${fwhere}.definedTerms`, 'must be an array');
          if (focus.evidenceText !== undefined && !Array.isArray(focus.evidenceText))
            push(`${fwhere}.evidenceText`, 'must be an array');
        });
    });
  }
  return issues;
};

/**
 * Verify the frozen Study Map end-to-end, failing closed on ANY mismatch.
 * Every check failure is collected (never thrown) into `issues`; `ok` is only
 * true when every check passes. IO problems (missing files) also fail closed.
 */
export const verifyFrozenStudyMap = (opts: FreezeGateOptions = {}): FrozenMapVerification => {
  const freezeReportPath = opts.freezeReportPath ?? FREEZE_REPORT_REL_PATH;
  const runId = opts.expectedRunId ?? FROZEN_MAP_RUN_ID;
  const runDir = opts.runDir ?? canonicalRunDir(runId);
  const decisionFilePath = opts.decisionFilePath ?? FREEZE_DECISION_FILE_REL_PATH;
  const expectedResultRows = opts.expectedResultRows ?? FROZEN_RESULT_ROW_COUNT;
  const expectedPriorityDistribution =
    opts.expectedPriorityDistribution ?? FROZEN_PRIORITY_DISTRIBUTION;
  const expectedGroupingJobIds =
    opts.groupingCorrectionJobIds ?? FROZEN_GROUPING_CORRECTION_JOB_IDS;

  const issues: FrozenMapIssue[] = [];
  const add = (code: string, message: string): void => {
    issues.push({ code, message });
  };

  const freeze = readJsonFile<FrozenFreezeReport>(freezeReportPath);
  if (freeze === null) {
    add('FREEZE_REPORT_UNREADABLE', `Cannot read or parse freeze report at ${freezeReportPath}`);
    return {
      ok: false,
      issues,
      runId,
      freezeReportPath,
      resultRows: 0,
      priorityRecount: {},
      invalidRowIds: [],
      groupingCorrectionJobIds: [],
      decisionFileSha256: null,
      recordedDecisionFileSha256: null,
      proposalsSha256: null,
      recordedProposalsSha256: null,
      canonicalResultsSha256: null,
    };
  }

  if (freeze.runId !== runId)
    add('RUN_ID_MISMATCH', `freezeReport.runId mismatch: ${describeMismatch(freeze.runId, runId)}`);

  const verification = freeze.adjudication?.verification;
  if (freeze.adjudication?.failed !== 0)
    add(
      'ADJUDICATION_FAILED_MISMATCH',
      `freezeReport.adjudication.failed must be 0: ${describeMismatch(freeze.adjudication?.failed, 0)}`,
    );
  if (verification?.resultRowsInvalid !== 0)
    add(
      'INVALID_ROWS_MISMATCH',
      `freezeReport.adjudication.verification.resultRowsInvalid must be 0: ${describeMismatch(
        verification?.resultRowsInvalid,
        0,
      )}`,
    );
  if (freeze.finalState?.pinnedAnchors?.allFound !== true)
    add(
      'PINNED_ANCHORS_MISMATCH',
      `freezeReport.finalState.pinnedAnchors.allFound must be true: ${describeMismatch(
        freeze.finalState?.pinnedAnchors?.allFound,
        true,
      )}`,
    );

  const recordedDecisionSha = freeze.inputs?.decisionFileSha256;
  const decisionFileSha256 = sha256File(decisionFilePath);
  if (typeof recordedDecisionSha !== 'string')
    add('DECISION_SHA_MISSING', 'freezeReport.inputs.decisionFileSha256 is missing or not a string');
  else if (decisionFileSha256 !== recordedDecisionSha)
    add(
      'DECISION_SHA_MISMATCH',
      `Recomputed SHA-256 of ${decisionFilePath} does not match the freeze report: ${describeMismatch(
        decisionFileSha256,
        recordedDecisionSha,
      )}`,
    );

  const recordedProposals = freeze.regeneratedReports?.find(
    (entry) => typeof entry.file === 'string' && entry.file.endsWith(MAP_PROPOSALS_REL_PATH),
  );
  const recordedProposalsSha =
    typeof recordedProposals?.sha256 === 'string' ? recordedProposals.sha256 : null;
  const proposalsPath = join(runDir, MAP_PROPOSALS_REL_PATH);
  const proposalsSha256 = sha256File(proposalsPath);
  if (recordedProposalsSha === null)
    add(
      'PROPOSALS_SHA_MISSING',
      `No regeneratedReports SHA-256 recorded for ${MAP_PROPOSALS_REL_PATH}`,
    );
  else if (proposalsSha256 !== recordedProposalsSha)
    add(
      'PROPOSALS_SHA_MISMATCH',
      `Recomputed SHA-256 of ${proposalsPath} does not match the freeze report: ${describeMismatch(
        proposalsSha256,
        recordedProposalsSha,
      )}`,
    );

  const resultsPath = join(runDir, CANONICAL_RESULTS_REL_PATH);
  const canonicalResultsSha256 = sha256File(resultsPath);

  const rows = readCanonicalResults(runDir);
  const resultRows = rows.length;
  const recordedResultRows = freeze.finalState?.resultRows;
  if (recordedResultRows !== expectedResultRows)
    add(
      'RESULT_ROWS_MISMATCH',
      `freezeReport.finalState.resultRows must be ${expectedResultRows}: ${describeMismatch(
        recordedResultRows,
        expectedResultRows,
      )}`,
    );
  if (resultRows !== expectedResultRows)
    add(
      'RESULT_ROWS_MISMATCH',
      `Canonical ${CANONICAL_RESULTS_REL_PATH} must hold ${expectedResultRows} rows: ${describeMismatch(
        resultRows,
        expectedResultRows,
      )}`,
    );

  const priorityRecount = recountPriorities(rows);
  const recordedDistribution = freeze.finalState?.priorityDistribution;
  if (!isDeepStrictEqual(priorityRecount, recordedDistribution))
    add(
      'PRIORITY_DISTRIBUTION_MISMATCH',
      `Recomputed priority distribution does not match freezeReport.finalState.priorityDistribution: ${describeMismatch(
        priorityRecount,
        recordedDistribution,
      )}`,
    );
  if (!isDeepStrictEqual(priorityRecount, expectedPriorityDistribution))
    add(
      'PRIORITY_DISTRIBUTION_MISMATCH',
      `Recomputed priority distribution does not match the expected frozen distribution: ${describeMismatch(
        priorityRecount,
        expectedPriorityDistribution,
      )}`,
    );

  const invalidRowIds: string[] = [];
  rows.forEach((row, rowIndex) => {
    const problems = frozenMapRowPresenceIssues(row);
    if (problems.length > 0) invalidRowIds.push(`${rowIndex}:${row.jobId} (${problems.join('; ')})`);
  });
  if (invalidRowIds.length > 0)
    add(
      'INVALID_RESULT_ROWS',
      `${invalidRowIds.length} canonical result row(s) failed schema-presence checks: ${invalidRowIds
        .slice(0, 5)
        .join(' | ')}${invalidRowIds.length > 5 ? ' | …' : ''}`,
    );

  const correctionJobIds = (freeze.groupingCorrections ?? [])
    .map((entry) => (entry as { jobId?: unknown }).jobId)
    .filter((value): value is string => typeof value === 'string');
  if (correctionJobIds.length !== expectedGroupingJobIds.length)
    add(
      'GROUPING_CORRECTIONS_MISMATCH',
      `freezeReport.groupingCorrections must have ${expectedGroupingJobIds.length} entries: ${describeMismatch(
        correctionJobIds.length,
        expectedGroupingJobIds.length,
      )}`,
    );
  else if (!isDeepStrictEqual([...correctionJobIds].sort(), [...expectedGroupingJobIds].sort()))
    add(
      'GROUPING_CORRECTIONS_MISMATCH',
      `freezeReport.groupingCorrections jobIds differ from the frozen set: ${describeMismatch(
        correctionJobIds,
        expectedGroupingJobIds,
      )}`,
    );

  return {
    ok: issues.length === 0,
    issues,
    runId,
    freezeReportPath,
    resultRows,
    priorityRecount,
    invalidRowIds,
    groupingCorrectionJobIds: correctionJobIds,
    decisionFileSha256,
    recordedDecisionFileSha256: typeof recordedDecisionSha === 'string' ? recordedDecisionSha : null,
    proposalsSha256,
    recordedProposalsSha256: recordedProposalsSha,
    canonicalResultsSha256,
  };
};

/* ------------------------------------------------------------------ *
 * Map / proposal / job equivalence audit                              *
 * ------------------------------------------------------------------ */

export type MapEquivalenceMismatch = { jobId: string; kind: string; detail: string };

export type MapEquivalenceAudit = {
  checked: number;
  totalMismatches: number;
  mismatches: MapEquivalenceMismatch[];
};

export type EquivalenceAuditOptions = {
  runDir?: string;
  runId?: string;
};

const countGroupSizes = (
  rows: AiStudyMapResult[],
): { groupedResults: number; zeroGroupResults: number; totalGroups: number } => {
  let groupedResults = 0;
  let totalGroups = 0;
  for (const row of rows) {
    if (row.proposedGroups.length > 0) groupedResults += 1;
    totalGroups += row.proposedGroups.length;
  }
  return { groupedResults, zeroGroupResults: rows.length - groupedResults, totalGroups };
};

/** Cap how many mismatch records are listed while the total stays exact. */
const LIST_MISMATCH_LIMIT = 25;

/**
 * Join every canonical result row to its proposal (`id === "<runId>:<jobId>"`)
 * and its prepared map job. Checks identity fields across all three artifacts
 * and, for grouped rows, full deep equality of the authoring semantics
 * (disposition, suggestedPriority, reason, proposedGroups) between result and
 * proposal. Returns every mismatch; the caller decides the exit status.
 */
export const auditMapProposalEquivalence = (opts: EquivalenceAuditOptions = {}): MapEquivalenceAudit => {
  const runDir = opts.runDir ?? canonicalRunDir(FROZEN_MAP_RUN_ID);
  const runId = opts.runId ?? FROZEN_MAP_RUN_ABBREV_ID;
  const rows = readCanonicalResults(runDir);
  const proposals = readMapProposals(runDir);
  const jobs = readPreparedMapJobs(runDir);

  const mismatches: MapEquivalenceMismatch[] = [];
  let totalMismatches = 0;
  const record = (jobId: string, kind: string, detail: string): void => {
    totalMismatches += 1;
    if (mismatches.length < LIST_MISMATCH_LIMIT) mismatches.push({ jobId, kind, detail });
  };

  const resultById = new Map(rows.map((row) => [row.jobId, row]));
  const proposalById = new Map(proposals.map((proposal) => [proposal.jobId, proposal]));
  const jobById = new Map(jobs.map((job) => [job.jobId, job]));

  const semanticPick = (row: AiStudyMapResult): {
    disposition: AiStudyDisposition;
    suggestedPriority: string | null;
    reason: string;
    proposedGroups: unknown;
  } => ({
    disposition: row.disposition,
    suggestedPriority: row.suggestedPriority ?? null,
    reason: row.reason,
    proposedGroups: row.proposedGroups,
  });
  const proposalSemanticPick = (proposal: AiStudyMapProposal): {
    disposition: AiStudyDisposition;
    suggestedPriority: string | null;
    reason: string;
    proposedGroups: unknown;
  } => ({
    disposition: proposal.disposition,
    suggestedPriority: proposal.suggestedPriority ?? null,
    reason: proposal.reason,
    proposedGroups: proposal.proposedGroups,
  });

  for (const row of rows) {
    const jobId = row.jobId;
    const proposal = proposalById.get(jobId);
    const job = jobById.get(jobId);

    if (proposal === undefined) {
      record(jobId, 'ORPHAN_PROPOSAL', 'No map proposal exists for this result row.');
      continue;
    }
    if (job === undefined) {
      record(jobId, 'ORPHAN_JOB', 'No prepared map job exists for this result row.');
      continue;
    }
    if (proposal.id !== `${proposal.runId}:${proposal.jobId}`)
      record(
        jobId,
        'PROPOSAL_ID_MISMATCH',
        `proposal.id must equal "<runId>:<jobId>": got ${JSON.stringify(proposal.id)}`,
      );
    if (row.jobId !== proposal.jobId || row.jobId !== job.jobId)
      record(jobId, 'JOB_ID_MISMATCH', 'jobId differs across result/proposal/job.');
    if (row.runId !== runId || proposal.runId !== runId || job.runId !== runId)
      record(
        jobId,
        'RUN_ID_MISMATCH',
        `runId must be ${JSON.stringify(runId)} across result/proposal/job: result ${JSON.stringify(
          row.runId,
        )} proposal ${JSON.stringify(proposal.runId)} job ${JSON.stringify(job.runId)}`,
      );
    if (row.corpusContentHash !== proposal.corpusContentHash || row.corpusContentHash !== job.corpusContentHash)
      record(jobId, 'CORPUS_HASH_MISMATCH', 'corpusContentHash differs across result/proposal/job.');
    if (
      proposal.document?.documentId !== job.document?.documentId ||
      proposal.document?.title !== job.document?.title ||
      proposal.document?.type !== job.document?.type
    )
      record(jobId, 'DOCUMENT_MISMATCH', 'proposal document identity differs from the prepared job.');
    if (!isDeepStrictEqual(proposal.targetSourceKeys, job.target.sourceKeys))
      record(
        jobId,
        'SOURCE_KEYS_MISMATCH',
        `proposal.targetSourceKeys differs from job.target.sourceKeys: ${JSON.stringify(
          proposal.targetSourceKeys,
        )} vs ${JSON.stringify(job.target.sourceKeys)}`,
      );
    if (!isDeepStrictEqual(proposal.targetSectionLabels, job.target.sectionLabels))
      record(jobId, 'SECTION_LABELS_MISMATCH', 'proposal.targetSectionLabels differs from job.target.sectionLabels.');

    if (row.proposedGroups.length > 0) {
      if (!isDeepStrictEqual(semanticPick(row), proposalSemanticPick(proposal)))
        record(
          jobId,
          'SEMANTIC_MISMATCH',
          'disposition/suggestedPriority/reason/proposedGroups differ between result row and proposal.',
        );
    } else {
      if (row.proposedGroups.length !== proposal.proposedGroups.length)
        record(jobId, 'ZERO_GROUP_MISMATCH', 'zero-group result row has a proposal with groups.');
      if ((row.suggestedPriority ?? null) !== (proposal.suggestedPriority ?? null))
        record(
          jobId,
          'ZERO_GROUP_PRIORITY_MISMATCH',
          `zero-group priority differs: result ${JSON.stringify(row.suggestedPriority ?? null)} proposal ${JSON.stringify(
            proposal.suggestedPriority ?? null,
          )}`,
        );
    }
  }

  const orphans = [...proposalById.keys()].filter((jobId) => !resultById.has(jobId));
  orphans.forEach((jobId) => {
    totalMismatches += 1;
    if (mismatches.length < LIST_MISMATCH_LIMIT)
      mismatches.push({ jobId, kind: 'ORPHAN_RESULT', detail: 'Proposal has no result row.' });
  });
  [...jobById.keys()].forEach((jobId) => {
    if (!resultById.has(jobId)) {
      totalMismatches += 1;
      if (mismatches.length < LIST_MISMATCH_LIMIT)
        mismatches.push({ jobId, kind: 'ORPHAN_RESULT', detail: 'Prepared job has no result row.' });
    }
  });

  return { checked: rows.length, totalMismatches, mismatches };
};

export const summarizeMapResultCounts = (rows: AiStudyMapResult[]): {
  totalResults: number;
  groupedResults: number;
  zeroGroupResults: number;
  totalGroups: number;
} => {
  const { groupedResults, zeroGroupResults, totalGroups } = countGroupSizes(rows);
  return { totalResults: rows.length, groupedResults, zeroGroupResults, totalGroups };
};
