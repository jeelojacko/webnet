/**
 * Deterministic, model-free human adjudication for Study Map results.
 *
 * Accepts a human-corrected model output (derived from a saved local-failures
 * attempt of a source run), validates it with the ordinary validator against
 * the prepared production job, and appends it to the production results file
 * with per-job adjudication provenance. It never calls the model, never
 * overwrites an already-accepted job, keeps historical failure artifacts in
 * both runs untouched, and reuses the runner's canonical identity injection so
 * the accepted row matches every other production row.
 *
 * Usage:
 *   npx tsx scripts/studyAiAdjudicateMapResult.ts --run <production-run-id>
 *     --job <job-id> --result <corrected-model-output.json>
 *     --source-run <source-run-id> --source-attempt <n> [--dry-run]
 *
 * The corrected output must be a plain model result object (disposition,
 * confidence, reason, suggestedPriority, proposedGroups, warnings); runner
 * identity fields are injected and overwritten by the runner, exactly as for
 * freshly authored results.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { authoringInputFingerprint } from './studyAiFingerprint';
import {
  RUNS_DIR,
  hashText,
  loadBatchJobs,
  readJson,
  readJsonl,
  validateLocalResult,
  writeJson,
  writeJsonlAtomic,
} from './studyAiLocalMapAuthor';

export type AdjudicateMapResultOptions = {
  /** Production (target) run that receives the accepted result. */
  runId: string;
  jobId: string;
  /** Path to the human-corrected model output JSON. */
  resultFile: string;
  /** Run whose local-failures artifacts supply the semantic basis. */
  sourceRunId: string;
  /** Saved attempt number under local-failures/<jobId>/ of the source run. */
  sourceAttempt: number;
  dryRun?: boolean;
  /** ISO timestamp for adjudication provenance; defaults to the current time. */
  adjudicatedAt?: string;
  /** Root for run directories; defaults to the repository RUNS_DIR. */
  runsDir?: string;
};

export type AdjudicateMapResultOutcome = {
  jobId: string;
  status: 'adjudicated' | 'valid-dry-run' | 'failed';
  sourceRunId: string;
  sourceAttempt: number;
  sourceRawHash: string | null;
  correctedOutputHash: string | null;
  disposition: string | null;
  confidence: string | null;
  error: string | null;
  /** Issue messages from validating the corrected output (empty when valid). */
  validationIssues: string[];
};

export type AdjudicateMapResultReport = {
  runId: string;
  jobId: string;
  dryRun: boolean;
  adjudicatedAt: string;
  outcome: AdjudicateMapResultOutcome;
};

const resultsFileFor = (runsDir: string, runId: string): string =>
  join(runsDir, runId, 'results', 'local-map.results.jsonl');

const provenancePathFor = (runsDir: string, runId: string, jobId: string): string =>
  join(runsDir, runId, 'results', `${jobId}.provenance.json`);

const sourceAttemptFiles = (runsDir: string, sourceRunId: string, jobId: string, attempt: number) => ({
  rawFile: join(runsDir, sourceRunId, 'local-failures', jobId, `attempt-${attempt}.raw.json`),
  validationFile: join(runsDir, sourceRunId, 'local-failures', jobId, `attempt-${attempt}.validation.json`),
});

/** The runner-owned identity fields that must agree between both job files. */
const jobIdentityMatches = (production: AiStudyMapJob, source: AiStudyMapJob): boolean =>
  production.jobId === source.jobId &&
  production.runId === source.runId &&
  production.corpusContentHash === source.corpusContentHash &&
  production.inputHash === source.inputHash &&
  production.authoringInputFingerprint === source.authoringInputFingerprint &&
  production.promptSpecVersion === source.promptSpecVersion;

const adjudicationProvenance = (
  validation: Record<string, unknown>,
  job: AiStudyMapJob,
  sourceRunId: string,
  sourceAttempt: number,
  sourceRawHash: string,
  correctedOutputHash: string,
  result: AiStudyMapResult,
  adjudicatedAt: string,
): Record<string, unknown> => {
  const { issues, ...base } = validation;
  return {
    ...base,
    jobId: job.jobId,
    runId: job.runId,
    authoringInputFingerprint: authoringInputFingerprint(job),
    rawHash: sourceRawHash,
    accepted: true,
    adjudication: {
      humanAdjudicated: true,
      sourceRun: sourceRunId,
      sourceAttempt,
      sourceRawHash,
      correctedOutputHash,
      resultRowHash: hashText(JSON.stringify(result)),
      preAdjudicationIssues: Array.isArray(issues) ? issues : [],
      adjudicationReason: 'final-production-tail-human-adjudication',
      adjudicatedVia: 'study:ai:adjudicate-result',
      adjudicatedAt,
    },
  };
};

const adjudicateOne = (
  options: AdjudicateMapResultOptions,
  runsDir: string,
  jobs: Map<string, AiStudyMapJob>,
  resultsFile: string,
): AdjudicateMapResultOutcome => {
  const jobId = options.jobId;
  const outcome: AdjudicateMapResultOutcome = {
    jobId,
    status: 'failed',
    sourceRunId: options.sourceRunId,
    sourceAttempt: options.sourceAttempt,
    sourceRawHash: null,
    correctedOutputHash: null,
    disposition: null,
    confidence: null,
    error: null,
    validationIssues: [],
  };
  const fail = (error: string): AdjudicateMapResultOutcome => {
    outcome.status = 'failed';
    outcome.error = error;
    return outcome;
  };

  const job = jobs.get(jobId);
  if (!job) return fail(`no prepared job ${jobId} under the production run`);
  if (job.authoringInputFingerprint !== authoringInputFingerprint(job))
    return fail(`prepared job ${jobId} fingerprint does not match its content; refusing`);

  const results = readJsonl<AiStudyMapResult>(resultsFile);
  if (results.some((row) => row.jobId === jobId))
    return fail(`${jobId} already has an accepted result; refusing to overwrite`);
  if (existsSync(provenancePathFor(runsDir, options.runId, jobId)))
    return fail(`${jobId} already has adjudication provenance; refusing to overwrite`);

  const sourceJobs = new Map(
    loadBatchJobs(options.sourceRunId, undefined, runsDir).map((entry) => [entry.jobId, entry]),
  );
  const sourceJob = sourceJobs.get(jobId);
  if (!sourceJob) return fail(`no prepared job ${jobId} under source run ${options.sourceRunId}`);
  if (!jobIdentityMatches(job, sourceJob))
    return fail(`source run job ${jobId} identity does not match the production job`);

  const { rawFile, validationFile } = sourceAttemptFiles(
    runsDir,
    options.sourceRunId,
    jobId,
    options.sourceAttempt,
  );
  if (!existsSync(rawFile) || !existsSync(validationFile))
    return fail(`attempt ${options.sourceAttempt} artifacts not found for ${jobId} in ${options.sourceRunId}`);
  const raw = readJson<unknown>(rawFile);
  const validation = readJson<Record<string, unknown>>(validationFile);
  const sourceRawHash = hashText(JSON.stringify(raw));
  if (typeof validation.rawHash === 'string' && validation.rawHash !== sourceRawHash)
    return fail(
      `attempt-${options.sourceAttempt} raw no longer matches its recorded rawHash; artifacts may be corrupted`,
    );
  outcome.sourceRawHash = sourceRawHash;

  let corrected: unknown;
  try {
    corrected = JSON.parse(readFileSync(options.resultFile, 'utf8'));
  } catch (error) {
    return fail(`cannot read corrected output ${options.resultFile}: ${(error as Error).message}`);
  }
  if (typeof corrected !== 'object' || corrected === null || Array.isArray(corrected))
    return fail(`corrected output ${options.resultFile} must be a JSON object`);
  const correctedOutputHash = hashText(JSON.stringify(corrected));
  outcome.correctedOutputHash = correctedOutputHash;

  const { result, issues, report } = validateLocalResult(corrected, job);
  outcome.validationIssues = issues;
  if (!report || !report.valid || !result)
    return fail(`corrected output for ${jobId} does not validate under the current validator`);

  outcome.disposition = result.disposition;
  outcome.confidence = result.confidence;
  if (options.dryRun) {
    outcome.status = 'valid-dry-run';
    return outcome;
  }

  writeJsonlAtomic(resultsFile, [...results, result]);
  writeJson(
    provenancePathFor(runsDir, options.runId, jobId),
    adjudicationProvenance(
      validation,
      job,
      options.sourceRunId,
      options.sourceAttempt,
      sourceRawHash,
      correctedOutputHash,
      result,
      options.adjudicatedAt ?? new Date().toISOString(),
    ),
  );
  outcome.status = 'adjudicated';
  return outcome;
};

export const adjudicateMapResult = (
  options: AdjudicateMapResultOptions,
): AdjudicateMapResultReport => {
  const runsDir = options.runsDir ?? RUNS_DIR;
  const runDir = join(runsDir, options.runId);
  if (!existsSync(runDir)) throw new Error(`Unknown production run: ${options.runId}`);
  if (!existsSync(join(runsDir, options.sourceRunId)))
    throw new Error(`Unknown source run: ${options.sourceRunId}`);
  if (!Number.isInteger(options.sourceAttempt) || options.sourceAttempt < 1)
    throw new Error('--source-attempt must be a positive integer.');
  const jobs = new Map(
    loadBatchJobs(options.runId, undefined, runsDir).map((job) => [job.jobId, job]),
  );
  const resultsFile = resultsFileFor(runsDir, options.runId);
  const adjudicatedAt = options.adjudicatedAt ?? new Date().toISOString();
  return {
    runId: options.runId,
    jobId: options.jobId,
    dryRun: Boolean(options.dryRun),
    adjudicatedAt,
    outcome: adjudicateOne(options, runsDir, jobs, resultsFile),
  };
};

const parseFlags = (argv: string[]): Record<string, string | boolean> => {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
};

const valueFor = (flags: Record<string, string | boolean>, key: string): string | undefined =>
  typeof flags[key] === 'string' ? (flags[key] as string) : undefined;

export const optionsFromArgs = (argv: string[]): AdjudicateMapResultOptions => {
  const flags = parseFlags(argv);
  const run = valueFor(flags, 'run');
  const job = valueFor(flags, 'job');
  const resultFile = valueFor(flags, 'result');
  const sourceRun = valueFor(flags, 'source-run');
  const sourceAttempt = valueFor(flags, 'source-attempt');
  if (!run) throw new Error('--run is required. Run with --help for options.');
  if (!job) throw new Error('--job is required. Run with --help for options.');
  if (!resultFile) throw new Error('--result is required. Run with --help for options.');
  if (!sourceRun) throw new Error('--source-run is required. Run with --help for options.');
  if (!sourceAttempt) throw new Error('--source-attempt is required. Run with --help for options.');
  return {
    runId: run,
    jobId: job,
    resultFile,
    sourceRunId: sourceRun,
    sourceAttempt: Number(sourceAttempt),
    dryRun: Boolean(flags['dry-run']),
  };
};

const HELP = `Deterministically adjudicate a human-corrected Study Map result (no model calls).

Usage:
  npx tsx scripts/studyAiAdjudicateMapResult.ts --run <production-run-id>
    --job <job-id> --result <corrected-model-output.json>
    --source-run <source-run-id> --source-attempt <n> [--dry-run]

Validates the human-corrected model output with the ordinary validator against
the prepared production job, verifies the saved source-run attempt artifacts
(rawHash integrity, job identity), then appends the result to
results/local-map.results.jsonl and writes results/<jobId>.provenance.json
with humanAdjudicated=true and the source-run/attempt/raw-hash provenance.
Already-accepted jobs are refused; historical failure artifacts in both runs
are never modified.`;

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP.trimEnd());
    return;
  }
  const report = adjudicateMapResult(optionsFromArgs(argv));
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome.status === 'failed') process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiAdjudicateMapResult.ts')) main();
