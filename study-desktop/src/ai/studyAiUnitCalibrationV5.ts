/**
 * Calibration-80 V5 sibling run + V4/V5 crosswalk orchestration.
 *
 * `buildCal80V5Run(opts)` deterministically rebuilds the cal80-v4 cohort
 * under the unit-authoring-v5 prompt spec: read the ordered 80-job v4 cohort
 * (jobs/batch-*.jobs.jsonl in batch order), match every (sourceMapProposalId,
 * groupId) key against the full v5 preflight job set, rewrite the matched v5
 * jobs for the new sibling run, re-validate each rewritten job against the
 * NEW runId, write the prepared run (batch size 8, prepared 0/0, fixed
 * timestamps, no wall-clock), and produce the V4/V5 crosswalk rows for report
 * building.
 *
 * Pure logic: no provider calls, deterministic. The cohort matching and
 * priority-parity checks are exported pure functions over loaded job lists so
 * tests exercise them without file I/O; crosswalk row / report content lives
 * in `studyAiUnitCalibrationV5Report.ts`. Every mismatch fails closed by
 * throwing (messages name the offending key(s)); the run is only written
 * after all checks pass, and a post-write layout recount re-verifies the
 * written batch files.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { NbLawContentPackage } from '../content/nbLawTypes';
import {
  FROZEN_MAP_RUN_ID,
  MAP_PROPOSALS_REL_PATH,
  RUNS_DIR_REL,
  canonicalRunDir,
  readJsonFile,
  readJsonlFile,
  sha256File,
} from './studyAiMapFreezeGate';
import { hashText, rewriteUnitJobForRun, writeUnitAuthoringRun } from './studyAiUnitJobPrep';
import { inspectPreparedRunLayout } from './studyAiUnitPreflightReport';
import {
  validateAiUnitAuthoringJob,
  type AiUnitAuthoringValidationContext,
} from './studyAiUnitJobValidation';
import {
  buildV4V5CrosswalkReport,
  buildV4V5CrosswalkRows,
  type V4V5CrosswalkReport,
  type V4V5CrosswalkSpecShas,
} from './studyAiUnitCalibrationV5Report';
import type {
  AiAuthoringProviderKind,
  AiAuthoringRun,
  AiStudyMapProposal,
  AiUnitAuthoringJob,
} from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Calibration-80 V5 constants                                        *
 * ------------------------------------------------------------------ */

export const CAL80_V4_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v4';
export const V5_PREFLIGHT_RUN_ID = 'ai-units-2026-09-02-frozen-map-v5-preflight';
export const CAL80_V5_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v5';
export const CAL80_V5_DATE_TAG = '20260902';
export const CAL80_V5_GENERATED_AT = '2026-09-02T00:00:00.000Z';
export const CAL80_V5_BATCH_SIZE = 8;
export const CAL80_V5_PROMPT_SPEC_VERSION = 'unit-authoring-v5';
export const CAL80_V5_PROVIDER_KIND = 'local-openai-compatible' as const;
export const CAL80_V5_COHORT_SIZE = 80;
export const CAL80_V5_PREFLIGHT_JOB_COUNT = 4251;
export const CAL80_V5_SOURCE_PACKAGE_ID = 'nb-sit-statute-corpus-2026-08-29';
export const CAL80_V5_PRIORITY_DISTRIBUTION: Record<string, number> = {
  P1: 24,
  P2: 28,
  P3: 20,
  P4: 8,
};
/** Spec files hashed into run notes / crosswalk specShas. */
export const V4_UNIT_AUTHORING_SPEC_PATH = 'study-content/ai/specs/unit-authoring-v4.md';
export const V5_UNIT_AUTHORING_SPEC_PATH = 'study-content/ai/specs/unit-authoring-v5.md';

/* ------------------------------------------------------------------ *
 * Cohort keys                                                        *
 * ------------------------------------------------------------------ */

export type Cal80CohortKey = {
  proposalId: string;
  groupId: string;
};

/** Semantic crosswalk key between v4 and v5 = (sourceMapProposalId, groupId). */
const cohortKeyOf = (job: AiUnitAuthoringJob): Cal80CohortKey => ({
  proposalId: job.sourceMapProposalId,
  groupId: job.approvedGroup.groupId,
});

const keyTag = (key: Cal80CohortKey): string => `${key.proposalId}::${key.groupId}`;

const describeKey = (key: Cal80CohortKey): string =>
  `(sourceMapProposalId, groupId) = (${JSON.stringify(key.proposalId)}, ${JSON.stringify(key.groupId)})`;

const duplicateKeyTags = (keys: Cal80CohortKey[]): string[] => {
  const seen = new Map<string, number>();
  for (const key of keys) seen.set(keyTag(key), (seen.get(keyTag(key)) ?? 0) + 1);
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([tag, count]) => `${tag} (x${count})`);
};

/* ------------------------------------------------------------------ *
 * Pure cohort matching                                               *
 * ------------------------------------------------------------------ */

export type V4CohortMatch = {
  /** The v4 cohort keys in v4 run order (seq = index + 1). */
  cohortKeys: Cal80CohortKey[];
  /** The v4 cohort jobs (same order as cohortKeys). */
  v4CohortJobs: AiUnitAuthoringJob[];
  /** The matched v5 preflight jobs, one per cohort key, in v4 run order. */
  matchedV5Jobs: AiUnitAuthoringJob[];
};

/**
 * Match an ordered v4 cohort against the v5 preflight job set by
 * (sourceMapProposalId, groupId). Fail closed (throws):
 *  - v4 cohort size ≠ expectedCohortSize
 *  - duplicate keys inside the v4 cohort run
 *  - duplicate keys in the v5 preflight job set
 *  - any cohort key absent from the v5 preflight set (names each missing key)
 */
export const matchV4CohortToV5Preflight = (args: {
  v4CohortJobs: readonly AiUnitAuthoringJob[];
  v5PreflightJobs: readonly AiUnitAuthoringJob[];
  expectedCohortSize: number;
}): V4CohortMatch => {
  const { v4CohortJobs, v5PreflightJobs, expectedCohortSize } = args;
  if (v4CohortJobs.length !== expectedCohortSize) {
    throw new Error(
      `Cal80-v5 fail-closed: v4 cohort size mismatch — expected ${expectedCohortSize} jobs, found ${v4CohortJobs.length} in the v4 run.`,
    );
  }
  const v4Keys = v4CohortJobs.map(cohortKeyOf);
  const duplicateV4 = duplicateKeyTags(v4Keys);
  if (duplicateV4.length > 0) {
    throw new Error(
      `Cal80-v5 fail-closed: ${duplicateV4.length} duplicate (sourceMapProposalId, groupId) key(s) inside the v4 cohort run: ${duplicateV4.join('; ')}.`,
    );
  }
  const v5Keys = v5PreflightJobs.map(cohortKeyOf);
  const duplicateV5 = duplicateKeyTags(v5Keys);
  if (duplicateV5.length > 0) {
    throw new Error(
      `Cal80-v5 fail-closed: ${duplicateV5.length} duplicate (sourceMapProposalId, groupId) key(s) in the v5 preflight job set: ${duplicateV5.join('; ')}.`,
    );
  }
  const v5ByKey = new Map(v5Keys.map((key, index) => [keyTag(key), v5PreflightJobs[index]]));
  const missing: Array<{ key: Cal80CohortKey; seq: number }> = [];
  const matchedV5Jobs: AiUnitAuthoringJob[] = [];
  v4Keys.forEach((key, index) => {
    const v5Job = v5ByKey.get(keyTag(key));
    if (v5Job === undefined) missing.push({ key, seq: index + 1 });
    else matchedV5Jobs.push(v5Job);
  });
  if (missing.length > 0) {
    throw new Error(
      `Cal80-v5 fail-closed: ${missing.length} cohort key(s) missing from the v5 preflight job set: ${missing
        .map((entry) => `${describeKey(entry.key)} (v4 seq ${entry.seq})`)
        .join('; ')}.`,
    );
  }
  return { cohortKeys: v4Keys, v4CohortJobs: [...v4CohortJobs], matchedV5Jobs };
};

/* ------------------------------------------------------------------ *
 * Priority parity (map-side facts)                                   *
 * ------------------------------------------------------------------ */

/**
 * The 80 v5 siblings occupy the same indexes as their v4 cohort twins, and
 * frozenMapPriority is a map-side fact stamped identically under both spec
 * versions. Fail closed on any index-level mismatch.
 */
export const assertCohortPriorityParity = (
  v4CohortJobs: readonly AiUnitAuthoringJob[],
  matchedV5Jobs: readonly AiUnitAuthoringJob[],
): void => {
  if (v4CohortJobs.length !== matchedV5Jobs.length) {
    throw new Error(
      `Cal80-v5 fail-closed: priority parity requires equal list lengths, got ${v4CohortJobs.length} v4 vs ${matchedV5Jobs.length} v5 jobs.`,
    );
  }
  for (let index = 0; index < v4CohortJobs.length; index += 1) {
    const v4 = v4CohortJobs[index];
    const v5 = matchedV5Jobs[index];
    const v4Priority = v4.frozenMapPriority ?? null;
    const v5Priority = v5.frozenMapPriority ?? null;
    if (v4Priority !== v5Priority) {
      throw new Error(
        `Cal80-v5 fail-closed: priority mismatch at seq ${index + 1} — ${describeKey(
          cohortKeyOf(v4),
        )}: v4 frozenMapPriority ${String(v4Priority)} vs v5 ${String(v5Priority)}.`,
      );
    }
  }
};

/* ------------------------------------------------------------------ *
 * Orchestration options / result                                     *
 * ------------------------------------------------------------------ */

export type BuildCal80V5RunOptions = {
  /** cal80-v4 run directory (default study-content/ai/runs/…-cal80-v4). */
  v4RunDir?: string;
  /** v5 preflight run directory (default study-content/ai/runs/…-v5-preflight). */
  v5PreflightRunDir?: string;
  /** Canonical frozen map run (proposals for re-validation). */
  mapRunDir?: string;
  corpusPackagePath?: string;
  /** Root the sibling run is written under. */
  runDirRoot?: string;
  runId?: string;
  batchSize?: number;
  generatedAt?: string;
  dateTag?: string;
  promptSpecVersion?: string;
  providerKind?: AiAuthoringProviderKind;
  sourcePackageId?: string;
  expectedCohortSize?: number;
  /** Total distinct jobs expected in the v5 preflight run (fail closed). */
  expectedPreflightJobCount?: number;
  expectedPriorityDistribution?: Record<string, number>;
  v4SpecPath?: string;
  v5SpecPath?: string;
};

export type Cal80V5RunSuccess = {
  ok: true;
  dateTag: string;
  runId: string;
  generatedAt: string;
  batchSize: number;
  runDir: string;
  v4RunId: string;
  v5PreflightRunId: string;
  sourceMapRunId: string;
  promptSpecVersion: string;
  corpusContentHash: string;
  sourcePackageId: string;
  specShas: V4V5CrosswalkSpecShas;
  cohort: { expected: number; matched: number; unmatched: number };
  priorityDistribution: Record<string, number>;
  rewrittenJobs: AiUnitAuthoringJob[];
  crosswalk: V4V5CrosswalkReport;
  validation: { checkedJobs: number; issuesTotal: number; sampleIssues: string[] };
  layout: ReturnType<typeof inspectPreparedRunLayout>;
};

/* ------------------------------------------------------------------ *
 * Shared readers                                                     *
 * ------------------------------------------------------------------ */

const readPreparedUnitJobs = (runDir: string): AiUnitAuthoringJob[] => {
  const jobsDir = join(runDir, 'jobs');
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonlFile<AiUnitAuthoringJob>(join(jobsDir, file)));
};

const readRunJson = (runDir: string, expectedRunId: string): AiAuthoringRun => {
  const run = readJsonFile<AiAuthoringRun>(join(runDir, 'run.json'));
  if (run === null) {
    throw new Error(`Cal80-v5 fail-closed: cannot read or parse run.json at ${runDir}.`);
  }
  if (run.runId !== expectedRunId) {
    throw new Error(
      `Cal80-v5 fail-closed: run.json runId ${JSON.stringify(run.runId)} does not match the expected run ${JSON.stringify(
        expectedRunId,
      )}.`,
    );
  }
  return run;
};

/** Full validation of the rewritten jobs against the NEW runId (mirrors the
 *  cal80-v4 flow: rewriteUnitJobForRun rehashes with the new runId in the
 *  base, so runId/inputHash consistency is what matters). */
const validateRewrittenV5Jobs = (
  rewrittenJobs: AiUnitAuthoringJob[],
  proposals: AiStudyMapProposal[],
  packageObject: NbLawContentPackage,
  corpusContentHash: string,
  runId: string,
  promptSpecVersion: string,
  providerKind: AiAuthoringProviderKind,
  sourceMapRunId: string,
): { issuesTotal: number; sampleIssues: string[] } => {
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const sampleIssues: string[] = [];
  let issuesTotal = 0;
  const recordIssue = (issue: string): void => {
    issuesTotal += 1;
    if (sampleIssues.length < 20) sampleIssues.push(issue);
  };
  for (const job of rewrittenJobs) {
    const proposal = proposalById.get(job.sourceMapProposalId);
    if (proposal === undefined) {
      recordIssue(`PROPOSAL_MISSING: no frozen proposal for ${job.sourceMapProposalId}.`);
      continue;
    }
    const groupIndex = proposal.proposedGroups.findIndex(
      (group) => group.groupId === job.approvedGroup.groupId,
    );
    if (groupIndex < 0) {
      recordIssue(
        `GROUP_INDEX_MISSING: group ${job.approvedGroup.groupId} not found on proposal ${proposal.id}.`,
      );
      continue;
    }
    const ctx: AiUnitAuthoringValidationContext = {
      run: {
        runId,
        jobType: 'unit-authoring',
        providerKind,
        promptSpecVersion,
      },
      sourceMapRunId,
      proposal,
      groupIndex,
      package: packageObject,
      corpusContentHash,
    };
    for (const issue of validateAiUnitAuthoringJob(job, ctx)) recordIssue(issue);
  }
  return { issuesTotal, sampleIssues };
};

/* ------------------------------------------------------------------ *
 * Orchestration                                                       *
 * ------------------------------------------------------------------ */

/**
 * Build the deterministic cal80-v5 sibling run. Fail closed at every stage
 * (throws with a message naming the offending keys / values):
 *   1. inputs      — cal80-v4 run.json identity/count/status sanity; v5
 *                    preflight total job count
 *   2. matching    — `matchV4CohortToV5Preflight` (size, duplicates, missing)
 *   3. parity      — `assertCohortPriorityParity` (index-wise P1-P4 echo) +
 *                    aggregate distribution against the 24/28/20/8 targets
 *   4. rewrite     — `rewriteUnitJobForRun` for the new runId
 *   5. validation  — full `validateAiUnitAuthoringJob` on all 80 rewritten
 *                    jobs (ctx runId = the new sibling run)
 *   6. write       — prepared run (batch size 8, fixed generatedAt) + a
 *                    post-write recount of the written batch files
 * The run is written only after steps 1-5 pass.
 */
export const buildCal80V5Run = (opts: BuildCal80V5RunOptions = {}): Cal80V5RunSuccess => {
  const v4RunId = CAL80_V4_RUN_ID;
  const v5PreflightRunId = V5_PREFLIGHT_RUN_ID;
  const runId = opts.runId ?? CAL80_V5_RUN_ID;
  const v4RunDir = opts.v4RunDir ?? join(RUNS_DIR_REL, v4RunId);
  const v5PreflightRunDir = opts.v5PreflightRunDir ?? join(RUNS_DIR_REL, v5PreflightRunId);
  const mapRunDir = opts.mapRunDir ?? canonicalRunDir(FROZEN_MAP_RUN_ID);
  const corpusPackagePath =
    opts.corpusPackagePath ?? 'study-content/packages/nb-sit-statute-corpus.content-package.json';
  const runDirRoot = opts.runDirRoot ?? RUNS_DIR_REL;
  const batchSize = opts.batchSize ?? CAL80_V5_BATCH_SIZE;
  const generatedAt = opts.generatedAt ?? CAL80_V5_GENERATED_AT;
  const dateTag = opts.dateTag ?? CAL80_V5_DATE_TAG;
  const promptSpecVersion = opts.promptSpecVersion ?? CAL80_V5_PROMPT_SPEC_VERSION;
  const providerKind = opts.providerKind ?? CAL80_V5_PROVIDER_KIND;
  const sourcePackageId = opts.sourcePackageId ?? CAL80_V5_SOURCE_PACKAGE_ID;
  const expectedCohortSize = opts.expectedCohortSize ?? CAL80_V5_COHORT_SIZE;
  const expectedPreflightJobCount =
    opts.expectedPreflightJobCount ?? CAL80_V5_PREFLIGHT_JOB_COUNT;
  const expectedPriorityDistribution =
    opts.expectedPriorityDistribution ?? CAL80_V5_PRIORITY_DISTRIBUTION;
  const v4SpecPath = opts.v4SpecPath ?? V4_UNIT_AUTHORING_SPEC_PATH;
  const v5SpecPath = opts.v5SpecPath ?? V5_UNIT_AUTHORING_SPEC_PATH;

  // Step 1a: cal80-v4 run.json sanity (identity, status, count, package).
  const v4Run = readRunJson(v4RunDir, v4RunId);
  if (v4Run.status !== 'prepared') {
    throw new Error(
      `Cal80-v5 fail-closed: cal80-v4 run.json status is ${JSON.stringify(v4Run.status)}, expected 'prepared'.`,
    );
  }
  if (v4Run.jobCount !== expectedCohortSize) {
    throw new Error(
      `Cal80-v5 fail-closed: cal80-v4 run.json jobCount ${v4Run.jobCount} does not equal the expected cohort size ${expectedCohortSize}.`,
    );
  }
  const corpusContentHash = v4Run.corpusContentHash;
  if (!corpusContentHash) {
    throw new Error('Cal80-v5 fail-closed: cal80-v4 run.json carries no corpusContentHash.');
  }
  if (v4Run.sourcePackageId !== undefined && v4Run.sourcePackageId !== sourcePackageId) {
    throw new Error(
      `Cal80-v5 fail-closed: cal80-v4 sourcePackageId ${JSON.stringify(
        v4Run.sourcePackageId,
      )} does not equal the expected ${JSON.stringify(sourcePackageId)}.`,
    );
  }

  // Step 1b: ordered inputs (v4 cohort in batch order; v5 preflight set).
  const v4CohortJobs = readPreparedUnitJobs(v4RunDir);
  const v5PreflightJobs = readPreparedUnitJobs(v5PreflightRunDir);
  if (v5PreflightJobs.length !== expectedPreflightJobCount) {
    throw new Error(
      `Cal80-v5 fail-closed: v5 preflight run has ${v5PreflightJobs.length} jobs, expected ${expectedPreflightJobCount}.`,
    );
  }
  // sourceMapRunId is carried per job (run.json has no such field): every
  // v4 cohort job and every v5 preflight job must name the frozen map run
  // (the v4 preflight's mapRunId) — fail closed otherwise.
  const sourceMapRunIdsOf = (jobs: AiUnitAuthoringJob[]): Set<string> =>
    new Set(jobs.map((job) => job.sourceMapRunId));
  const v4SourceMapRunIds = sourceMapRunIdsOf(v4CohortJobs);
  const v5SourceMapRunIds = sourceMapRunIdsOf(v5PreflightJobs);
  if (
    v4SourceMapRunIds.size !== 1 ||
    !v4SourceMapRunIds.has(FROZEN_MAP_RUN_ID) ||
    v5SourceMapRunIds.size !== 1 ||
    !v5SourceMapRunIds.has(FROZEN_MAP_RUN_ID)
  ) {
    throw new Error(
      `Cal80-v5 fail-closed: cohort/preflight sourceMapRunId values {${[
        ...v4SourceMapRunIds,
      ].join(', ')}} (v4) / {${[...v5SourceMapRunIds].join(', ')}} (v5) do not all equal the frozen map run id ${JSON.stringify(
        FROZEN_MAP_RUN_ID,
      )}.`,
    );
  }

  // Step 2: pure matching (fail closed on size / duplicates / missing keys).
  const match = matchV4CohortToV5Preflight({
    v4CohortJobs,
    v5PreflightJobs,
    expectedCohortSize,
  });

  // Step 3: priority parity (index-wise echo + aggregate 24/28/20/8 targets).
  assertCohortPriorityParity(match.v4CohortJobs, match.matchedV5Jobs);
  const priorityDistribution: Record<string, number> = {};
  for (const job of match.matchedV5Jobs) {
    const priority = job.frozenMapPriority ?? 'null';
    priorityDistribution[priority] = (priorityDistribution[priority] ?? 0) + 1;
  }
  if (!isDeepStrictEqual(priorityDistribution, expectedPriorityDistribution)) {
    throw new Error(
      `Cal80-v5 fail-closed: v5 cohort priority distribution ${JSON.stringify(
        priorityDistribution,
      )} does not match the expected ${JSON.stringify(expectedPriorityDistribution)}.`,
    );
  }

  // Step 4: rewrite each matched v5 job for the sibling run.
  const rewrittenJobs = match.matchedV5Jobs.map((job) => rewriteUnitJobForRun(job, runId));

  // Step 5: full validation against the NEW runId.
  const packageObject = readJsonFile<NbLawContentPackage>(corpusPackagePath);
  if (packageObject === null) {
    throw new Error(`Cal80-v5 fail-closed: cannot read corpus package at ${corpusPackagePath}.`);
  }
  const proposals =
    readJsonFile<AiStudyMapProposal[]>(join(mapRunDir, MAP_PROPOSALS_REL_PATH)) ?? [];
  const packageContentHash = hashText(JSON.stringify(packageObject.sourceHashes));
  const validation = validateRewrittenV5Jobs(
    rewrittenJobs,
    proposals,
    packageObject,
    packageContentHash,
    runId,
    promptSpecVersion,
    providerKind,
    FROZEN_MAP_RUN_ID,
  );
  if (validation.issuesTotal > 0) {
    throw new Error(
      `Cal80-v5 fail-closed: ${validation.issuesTotal} validation issue(s) on the rewritten v5 cohort — ${validation.sampleIssues
        .slice(0, 20)
        .join(' | ')}`,
    );
  }

  // Spec SHAs for the run notes + crosswalk (fail closed when absent).
  const v4SpecSha = sha256File(v4SpecPath);
  const v5SpecSha = sha256File(v5SpecPath);
  if (v4SpecSha === null || v5SpecSha === null) {
    throw new Error(
      `Cal80-v5 fail-closed: cannot hash spec files ${v4SpecPath} / ${v5SpecPath}.`,
    );
  }

  // Step 6: write the prepared sibling run (fixed timestamps, batch size 8).
  const newRunDir = join(runDirRoot, runId);
  writeUnitAuthoringRun({
    runDir: newRunDir,
    jobs: rewrittenJobs,
    batchSize,
    meta: {
      runId,
      sourceMapRunId: FROZEN_MAP_RUN_ID,
      promptSpecVersion,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      corpusContentHash,
      providerKind,
      sourcePackageId,
      notes: `Deterministic V5 sibling of ${v4RunId}, same ${expectedCohortSize} semantic cohort matched by (sourceMapProposalId, groupId), prompt spec ${promptSpecVersion} (sha256 ${v5SpecSha}), prepared ${generatedAt.slice(0, 10)}.`,
    },
  });

  // Post-write recount: jobCount, batch file count, per-job spec version.
  const writtenJobs = readPreparedUnitJobs(newRunDir);
  const expectedBatchCount = Math.ceil(rewrittenJobs.length / batchSize);
  const layout = inspectPreparedRunLayout(newRunDir, batchSize, rewrittenJobs.length);
  if (
    writtenJobs.length !== rewrittenJobs.length ||
    layout.batchFiles.length !== expectedBatchCount ||
    layout.runJsonSha256 === null
  ) {
    throw new Error(
      `Cal80-v5 fail-closed: post-write recount mismatch at ${newRunDir} — wrote ${rewrittenJobs.length} jobs / ${expectedBatchCount} batches, recounted ${writtenJobs.length} jobs / ${layout.batchFiles.length} batches.`,
    );
  }
  for (const job of writtenJobs) {
    if (job.promptSpecVersion !== promptSpecVersion || job.runId !== runId) {
      throw new Error(
        `Cal80-v5 fail-closed: written job ${job.jobId} carries promptSpecVersion ${JSON.stringify(
          job.promptSpecVersion,
        )} / runId ${JSON.stringify(job.runId)}; expected ${JSON.stringify(
          promptSpecVersion,
        )} / ${JSON.stringify(runId)}.`,
      );
    }
  }

  // Crosswalk rows + report content (v5 side hashes the rewritten sibling job).
  const rows = buildV4V5CrosswalkRows(match.v4CohortJobs, rewrittenJobs);
  const crosswalk = buildV4V5CrosswalkReport({
    dateTag,
    v4RunId,
    v5RunId: runId,
    specShas: { v4: v4SpecSha, v5: v5SpecSha },
    rows,
  });

  return {
    ok: true,
    dateTag,
    runId,
    generatedAt,
    batchSize,
    runDir: newRunDir,
    v4RunId,
    v5PreflightRunId,
    sourceMapRunId: FROZEN_MAP_RUN_ID,
    promptSpecVersion,
    corpusContentHash,
    sourcePackageId,
    specShas: crosswalk.specShas,
    cohort: { expected: expectedCohortSize, matched: rows.length, unmatched: 0 },
    priorityDistribution,
    rewrittenJobs,
    crosswalk,
    validation: { checkedJobs: rewrittenJobs.length, issuesTotal: 0, sampleIssues: [] },
    layout,
  };
};
