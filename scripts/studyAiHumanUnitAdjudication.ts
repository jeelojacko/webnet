#!/usr/bin/env tsx
/**
 * Fail-closed human adjudication/recovery path for locally-run Unit Authoring
 * results.
 *
 * Promotes a deterministically corrected (non-model) revision of a job's last
 * rejected attempt into `results/local-unit.results.jsonl`, plus the matching
 * `results/<jobId>.provenance.json` sidecar. Every gate below must pass before
 * a single byte is written; the corrected row must also pass the complete V5
 * validation with zero error-severity issues. No model inference is involved:
 * the correction is applied verbatim from a human-authored correction file,
 * and both the result row and the provenance sidecar carry an explicit
 * human-adjudication block.
 *
 * Usage:
 *   npx tsx scripts/studyAiHumanUnitAdjudication.ts \
 *     --run <runId> --job <jobId> --attempt <n> --correction <correction.json> \
 *     [--package <path>] [--dry-run]
 *
 * Correction file shape (HumanUnitAdjudicationCorrection):
 *   { "schemaVersion": 1, "kind": "human-unit-adjudication",
 *     "runId", "jobId", "sourceAttempt", "frozenPriority",
 *     "method": "human-remediation", "reason",
 *     "changedFields": [...], "replacement": { <field>: <value>, ... } }
 * `sourceAttempt` is the local-failures artifact number (attempt-<n>.raw.json),
 * i.e. the cumulative attempt file number, not the per-session semantic counter.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AiHumanAdjudicationProvenance,
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';
import {
  RUNS_DIR,
  readJson,
  readJsonl,
  writeJson,
  writeJsonlAtomic,
} from './studyAiLocalMapAuthor';
import {
  DEFAULT_UNIT_AUTHORING_PACKAGE,
  LOCAL_UNIT_RESULTS_FILE,
  groupSourceHashes,
  unitBatchJobFiles,
  withRunnerIdentity,
} from './studyAiLocalUnitAuthor';

/** Model-output (semantic) fields a human correction may touch. Runner-owned
 *  identity fields (proposalId, runId, corpusContentHash, suggestedPriority, …)
 *  are NEVER human-editable. */
export const HUMAN_EDITABLE_UNIT_FIELDS = [
  'title',
  'mainQuestion',
  'studySummary',
  'objectives',
  'relatedSourceKeys',
  'studyNotes',
  'sourceCoverage',
  'authoringStatus',
  'mapRevisionSuggestion',
  'confidence',
  'warnings',
] as const;

/** Validation codes the close-out gate explicitly requires to be zero. */
export const FORBIDDEN_FINAL_CODES = [
  'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
  'SOURCE_COVERAGE_EXTRA_LABEL',
  'UNCOVERED_SUBSTANTIVE_SOURCE',
  'APPROVED_FOCUS_NOT_COVERED',
  'POLARITY_REVERSAL',
  'LEGAL_MODALITY_REVERSAL',
  'EVIDENCE_NOT_EXACT_VERBATIM',
  'CONTEXT_REF_LEAKAGE',
  'UNSUPPORTED_LEGAL_EFFECT',
] as const;

export type HumanUnitAdjudicationCorrection = {
  schemaVersion: 1;
  kind: 'human-unit-adjudication';
  runId: string;
  jobId: string;
  sourceAttempt: number;
  /** Frozen-map priority the job must carry (e.g. 'P1'). */
  frozenPriority: string;
  method: 'human-remediation';
  reason: string;
  changedFields: string[];
  replacement: Record<string, unknown>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Apply a human correction to a rejected attempt's raw model output.
 * Fails (issues[]) when a changed field is runner-owned, when changedFields
 * and replacement keys disagree, or when a listed field is not replaced.
 */
export const applyHumanCorrection = (
  raw: Record<string, unknown>,
  correction: HumanUnitAdjudicationCorrection,
): { corrected?: Record<string, unknown>; issues: string[] } => {
  const issues: string[] = [];
  for (const field of correction.changedFields) {
    if (!(HUMAN_EDITABLE_UNIT_FIELDS as readonly string[]).includes(field)) {
      issues.push(
        `CORRECTION_FIELD_NOT_ALLOWED: '${field}' is runner-owned or unknown; human corrections may only touch model-output fields.`,
      );
    }
  }
  for (const key of Object.keys(correction.replacement)) {
    if (!correction.changedFields.includes(key)) {
      issues.push(`CORRECTION_FIELD_UNLISTED: replacement key '${key}' is missing from changedFields.`);
    }
  }
  for (const field of correction.changedFields) {
    if (!Object.hasOwn(correction.replacement, field)) {
      issues.push(`CORRECTION_FIELD_UNREPLACED: changedFields lists '${field}' but replacement has no value for it.`);
    }
  }
  if (issues.length > 0) return { issues };
  return { corrected: { ...raw, ...correction.replacement }, issues };
};

/**
 * Verify the rejected-attempt artifact this correction is based on:
 * identity (job/proposal/run/input-hash/source-hashes), that it is a rejected
 * attempt, and that it is the job's most recent failed attempt.
 */
export const attemptIdentityIssues = (
  attemptValidation: Record<string, unknown>,
  job: AiUnitAuthoringJob,
  expectedAttempt: number,
  maxSeenAttempt: number,
): string[] => {
  const issues: string[] = [];
  const inAttempt = (code: string): string => `${code} in attempt artifact.`;
  if (attemptValidation.jobId !== job.jobId) issues.push(inAttempt('ATTEMPT_JOB_MISMATCH'));
  if (attemptValidation.proposalId !== job.jobId) issues.push(inAttempt('ATTEMPT_PROPOSAL_MISMATCH'));
  if (attemptValidation.runId !== job.runId) issues.push(inAttempt('ATTEMPT_RUN_MISMATCH'));
  if (attemptValidation.sourceJobInputHash !== job.inputHash)
    issues.push(inAttempt('ATTEMPT_SOURCE_JOB_INPUT_HASH_MISMATCH'));
  if (JSON.stringify(attemptValidation.sourceHashes) !== JSON.stringify(groupSourceHashes(job)))
    issues.push(inAttempt('ATTEMPT_SOURCE_HASH_MISMATCH'));
  if (attemptValidation.accepted !== false) issues.push('ATTEMPT_NOT_REJECTED: attempt artifact is not a rejected attempt.');
  if (expectedAttempt !== maxSeenAttempt)
    issues.push(`ATTEMPT_NOT_LATEST: correction targets attempt ${expectedAttempt} but the latest failed attempt is ${maxSeenAttempt}.`);
  return issues;
};

/**
 * Resume-integrity check over every already-accepted result row (same
 * semantics as the local unit runner's resume gate): unique proposalIds, each
 * row's job exists, and runId / corpusContentHash / suggestedPriority /
 * sourceJobInputHash all match the job.
 */
export const existingResultsIssues = (
  rows: AiStudyUnitProposal[],
  jobsById: Map<string, AiUnitAuthoringJob>,
): string[] => {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.proposalId)) {
      issues.push(`DUPLICATE_ACCEPTED_RESULT: ${row.proposalId} already has an accepted result row.`);
      continue;
    }
    seen.add(row.proposalId);
    const job = jobsById.get(row.proposalId);
    if (!job) {
      issues.push(`RESULT_WITHOUT_JOB: accepted result ${row.proposalId} has no matching job file.`);
      continue;
    }
    if (row.runId !== job.runId) issues.push(`RESULT_RUN_MISMATCH: ${row.proposalId} runId does not match its job.`);
    if (row.corpusContentHash !== job.corpusContentHash)
      issues.push(`RESULT_CORPUS_HASH_MISMATCH: ${row.proposalId} corpusContentHash does not match its job.`);
    if (row.suggestedPriority !== job.frozenMapPriority)
      issues.push(`RESULT_PRIORITY_MISMATCH: ${row.proposalId} suggestedPriority does not match its frozen map priority.`);
    if (row.generationMetadata?.sourceJobInputHash !== job.inputHash)
      issues.push(`RESULT_INPUT_HASH_MISMATCH: ${row.proposalId} generation sourceJobInputHash does not match its job inputHash.`);
  }
  return issues;
};

/**
 * The adjudication gate: run identity, corpus identity, job/correction
 * identity, frozen priority, and no duplicate accepted result for this job.
 */
export const adjudicationGateIssues = (args: {
  run: { runId?: unknown; corpusContentHash?: unknown; jobType?: unknown };
  job?: AiUnitAuthoringJob;
  rows: AiStudyUnitProposal[];
  correction: HumanUnitAdjudicationCorrection;
}): string[] => {
  const issues: string[] = [];
  const { run, job, rows, correction } = args;
  if (run.jobType !== 'unit-authoring') issues.push('RUN_NOT_UNIT_AUTHORING: run.json jobType is not unit-authoring.');
  if (run.runId !== correction.runId) issues.push('RUN_ID_MISMATCH: run.json runId does not match the correction file.');
  if (!job) {
    issues.push(`JOB_NOT_FOUND: no prepared job ${correction.jobId} in the run batch files.`);
    return issues;
  }
  if (job.jobId !== correction.jobId) issues.push('JOB_ID_MISMATCH: prepared job does not match the correction file.');
  if (job.runId !== correction.runId) issues.push('JOB_RUN_MISMATCH: prepared job runId does not match the correction file.');
  if (typeof run.corpusContentHash !== 'string' || run.corpusContentHash.length === 0) {
    issues.push('RUN_CORPUS_HASH_MISSING: run.json corpusContentHash is missing.');
  }
  if (typeof job.corpusContentHash !== 'string' || !/^[0-9a-f]{64}$/.test(job.corpusContentHash)) {
    issues.push('JOB_CORPUS_HASH_INVALID: job corpusContentHash is not a 64-hex hash.');
  }
  if (job.frozenMapPriority !== correction.frozenPriority)
    issues.push(
      `FROZEN_PRIORITY_MISMATCH: job frozen priority ${JSON.stringify(job.frozenMapPriority)} is not the required ${JSON.stringify(correction.frozenPriority)}.`,
    );
  if (rows.some((row) => row.proposalId === correction.jobId))
    issues.push('DUPLICATE_ACCEPTED_RESULT: an accepted result row for this job already exists.');
  return issues;
};

/** Stamp runner identity on the corrected raw output and attach the human-adjudication provenance block. */
export const buildHumanAdjudicatedProposal = (
  raw: Record<string, unknown>,
  job: AiUnitAuthoringJob,
  correction: HumanUnitAdjudicationCorrection,
  adjudicatedAt: string,
  validatorWarningCount: number,
): AiStudyUnitProposal => {
  const applied = applyHumanCorrection(raw, correction);
  if (!applied.corrected) throw new Error(`Refusing to build proposal: ${applied.issues.join(' ')}`);
  const base = withRunnerIdentity(applied.corrected, job);
  const humanAdjudication: AiHumanAdjudicationProvenance = {
    method: correction.method,
    reason: correction.reason,
    changedFields: correction.changedFields,
    sourceAttempt: correction.sourceAttempt,
    modelInferenceUsed: false,
    validatorErrorCount: 0,
    validatorWarningCount,
    adjudicatedAt,
  };
  return {
    ...base,
    generationMetadata: { ...base.generationMetadata, humanAdjudication },
  };
};

const parseCorrection = (value: unknown, path: string): HumanUnitAdjudicationCorrection => {
  if (!isPlainObject(value)) throw new Error(`Correction file ${path} is not a JSON object.`);
  const correction = value as unknown as HumanUnitAdjudicationCorrection;
  if (correction.schemaVersion !== 1 || correction.kind !== 'human-unit-adjudication')
    throw new Error('Correction file must have schemaVersion 1 and kind "human-unit-adjudication".');
  if (correction.method !== 'human-remediation') throw new Error('Correction method must be "human-remediation".');
  for (const field of ['runId', 'jobId', 'frozenPriority', 'reason'] as const) {
    const value2 = correction[field];
    if (typeof value2 !== 'string' || value2.length === 0)
      throw new Error(`Correction field '${field}' must be a non-empty string.`);
  }
  if (!Number.isInteger(correction.sourceAttempt) || correction.sourceAttempt < 1)
    throw new Error('Correction sourceAttempt must be a positive integer.');
  if (!Array.isArray(correction.changedFields) || correction.changedFields.length === 0)
    throw new Error('Correction changedFields must be a non-empty string array.');
  if (!isPlainObject(correction.replacement) || Object.keys(correction.replacement).length === 0)
    throw new Error('Correction replacement must be a non-empty object.');
  return correction;
};

const attemptArtifactNumber = (file: string): number | undefined => {
  const match = /^attempt-(\d+)\.validation\.json$/.exec(file);
  return match ? Number(match[1]) : undefined;
};

const fail = (issues: string[]): never => {
  for (const issue of issues) console.error(`REJECT ${issue}`);
  process.exit(1);
};

const main = (): void => {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const runId = opt('run');
  const jobId = opt('job');
  const attemptArg = opt('attempt');
  const correctionPath = opt('correction');
  const packagePath = opt('package') ?? DEFAULT_UNIT_AUTHORING_PACKAGE;
  const sourceRunId = opt('source-run');
  const dryRun = argv.includes('--dry-run');
  if (!runId || !jobId || attemptArg === undefined || !correctionPath) {
    console.error(
      'Usage: studyAiHumanUnitAdjudication.ts --run <runId> --job <jobId> --attempt <n> --correction <file> [--source-run <runId>] [--package <path>] [--dry-run]',
    );
    process.exit(2);
  }
  const expectedAttempt = Number(attemptArg);
  if (!Number.isInteger(expectedAttempt) || expectedAttempt < 1)
    fail(['CLI_ATTEMPT_INVALID: --attempt must be a positive integer.']);

  const issues: string[] = [];
  const correction = parseCorrection(JSON.parse(readFileSync(correctionPath, 'utf8')), correctionPath);
  if (correction.runId !== runId) issues.push('CLI_RUN_MISMATCH: --run does not match the correction file.');
  if (correction.jobId !== jobId) issues.push('CLI_JOB_MISMATCH: --job does not match the correction file.');
  if (correction.sourceAttempt !== expectedAttempt)
    issues.push('CLI_ATTEMPT_MISMATCH: --attempt does not match the correction file.');

  const runDir = join(RUNS_DIR, runId);
  const run = existsSync(join(runDir, 'run.json')) ? readJson<Record<string, unknown>>(join(runDir, 'run.json')) : {};
  const jobs: AiUnitAuthoringJob[] = [];
  for (const file of unitBatchJobFiles(runId, undefined, RUNS_DIR)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim()) jobs.push(JSON.parse(line) as AiUnitAuthoringJob);
    }
  }
  const job = jobs.find((candidate) => candidate.jobId === jobId);
  // Optional: prove the job is the reused frozen-map job by comparing corpus
  // hash, frozen priority, and source hashes against the source run's job.
  if (sourceRunId) {
    const sourceJobs: AiUnitAuthoringJob[] = [];
    for (const file of unitBatchJobFiles(sourceRunId, undefined, RUNS_DIR)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim()) sourceJobs.push(JSON.parse(line) as AiUnitAuthoringJob);
      }
    }
    const sourceJob = sourceJobs.find((candidate) => candidate.jobId === jobId);
    if (!sourceJob) {
      issues.push(`SOURCE_RUN_JOB_NOT_FOUND: no job ${jobId} in source run ${sourceRunId}.`);
    } else if (sourceJob.corpusContentHash !== job?.corpusContentHash) {
      issues.push('SOURCE_RUN_CORPUS_HASH_MISMATCH: source-run job corpusContentHash does not match this run\'s job.');
    } else if (sourceJob.frozenMapPriority !== job?.frozenMapPriority) {
      issues.push('SOURCE_RUN_PRIORITY_MISMATCH: source-run job frozen priority does not match this run\'s job.');
    } else if (JSON.stringify(sourceJob.sourceHashes) !== JSON.stringify(job?.sourceHashes)) {
      issues.push('SOURCE_RUN_SOURCE_HASH_MISMATCH: source-run job source hashes do not match this run\'s job.');
    }
  }

  const rowsPath = join(runDir, 'results', LOCAL_UNIT_RESULTS_FILE);
  const rows = existsSync(rowsPath) ? readJsonl<AiStudyUnitProposal>(rowsPath) : [];
  const jobsById = new Map(jobs.map((candidate) => [candidate.jobId, candidate]));
  issues.push(...existingResultsIssues(rows, jobsById));
  issues.push(...adjudicationGateIssues({ run, job, rows, correction }));

  const failuresDir = join(runDir, 'local-failures', jobId);
  const attemptRawPath = join(failuresDir, `attempt-${expectedAttempt}.raw.json`);
  const attemptValidationPath = join(failuresDir, `attempt-${expectedAttempt}.validation.json`);
  let attemptRaw: Record<string, unknown> | undefined;
  if (job && !existsSync(attemptRawPath)) issues.push(`ATTEMPT_RAW_MISSING: ${attemptRawPath} does not exist.`);
  if (job && !existsSync(attemptValidationPath)) issues.push(`ATTEMPT_VALIDATION_MISSING: ${attemptValidationPath} does not exist.`);
  if (job && existsSync(attemptRawPath) && existsSync(attemptValidationPath)) {
    attemptRaw = readJson<Record<string, unknown>>(attemptRawPath);
    const attemptValidation = readJson<Record<string, unknown>>(attemptValidationPath);
    const numbers = readdirSync(failuresDir).map(attemptArtifactNumber).filter((n): n is number => n !== undefined);
    const maxSeenAttempt = numbers.reduce((max, n) => Math.max(max, n), 0);
    issues.push(...attemptIdentityIssues(attemptValidation, job, expectedAttempt, maxSeenAttempt));
  }

  if (issues.length > 0 || !job || attemptRaw === undefined) fail(issues);
  if (!job || attemptRaw === undefined) throw new Error('unreachable: adjudication gate did not pass');

  // Complete V5 validation of the corrected proposal before any write.
  const pkg = readJson<NbLawContentPackage>(packagePath);
  const adjudicatedAt = new Date().toISOString();
  const validate = (proposal: AiStudyUnitProposal) =>
    validateAiStudyUnitProposal({
      proposal,
      sourceComponents: sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys),
      corpusContentHash: job.corpusContentHash,
    });
  const probe = validate(buildHumanAdjudicatedProposal(attemptRaw, job, correction, adjudicatedAt, 0));
  const warningCount = probe.issues.filter((issue) => issue.severity === 'warning').length;
  const finalProposal = buildHumanAdjudicatedProposal(attemptRaw, job, correction, adjudicatedAt, warningCount);
  const report = validate(finalProposal);
  const errorCodes = report.issues.map((issue) => issue.code);
  const forbiddenHits = FORBIDDEN_FINAL_CODES.filter((code) => errorCodes.includes(code));
  if (report.issues.some((issue) => issue.severity === 'error'))
    fail([`VALIDATION_ERRORS: corrected proposal has ${report.issues.filter((i) => i.severity === 'error').length} error-severity issues: ${errorCodes.join(', ')}`]);
  if (forbiddenHits.length > 0) fail([`FORBIDDEN_CODES_PRESENT: ${forbiddenHits.join(', ')}`]);

  if (dryRun) {
    console.log(
      `DRY RUN PASS: ${jobId} attempt ${expectedAttempt} + human correction -> 0 error issues, ${warningCount} warnings. No writes performed.`,
    );
    return;
  }

  const provenance = {
    providerKind: 'local-openai-compatible',
    modelId: null,
    humanAuthor: 'human-remediation',
    runId: job.runId,
    jobId: job.jobId,
    proposalId: job.jobId,
    sourceJobInputHash: job.inputHash,
    sourceHashes: groupSourceHashes(job),
    attempt: expectedAttempt,
    timestamp: adjudicatedAt,
    accepted: true,
    humanAdjudication: finalProposal.generationMetadata.humanAdjudication,
  };
  writeJsonlAtomic(rowsPath, [...rows, finalProposal]);
  writeJson(join(runDir, 'results', `${job.jobId}.provenance.json`), provenance);
  console.log(
    `PROMOTED ${job.jobId}: human adjudication of attempt ${expectedAttempt} (fields: ${correction.changedFields.join(', ')}); ` +
      `V5 validation 0 errors / ${warningCount} warnings; result row + provenance sidecar written.`,
  );
};

if (process.argv[1]?.endsWith('studyAiHumanUnitAdjudication.ts')) {
  main();
}
