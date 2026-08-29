/**
 * Deterministic, model-free recovery for locally authored Study Map results.
 *
 * Revalidates saved local-failures attempt artifacts against the current
 * validator and, for an explicit job list, promotes the highest-numbered
 * cleanly validating attempt into the canonical results file. It never calls
 * the model, never overwrites an already-accepted job, keeps historical
 * failure artifacts untouched, and writes per-job recovery provenance.
 *
 * Usage:
 *   npx tsx scripts/studyAiRecoverMapResult.ts --run <run-id> --job <job-id> [--job ...]
 *     [--attempt <n>] [--dry-run]
 *
 * `--attempt` is only allowed with exactly one `--job` and pins the source
 * artifact; without it the highest-numbered validating attempt is chosen.
 */
import { existsSync, readdirSync } from 'node:fs';
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

export type RecoverMapResultOptions = {
  runId: string;
  jobIds: string[];
  /** Pin the source artifact number (requires exactly one job id). */
  attempt?: number;
  dryRun?: boolean;
  /** ISO timestamp for recovery provenance; defaults to the current time. */
  recoveredAt?: string;
  /** Root for run directories; defaults to the repository RUNS_DIR. */
  runsDir?: string;
};

export type RecoverMapResultOutcome = {
  jobId: string;
  status: 'recovered' | 'valid-dry-run' | 'failed';
  attempt: number | null;
  rawHash: string | null;
  disposition: string | null;
  confidence: string | null;
  error: string | null;
  /** Issue messages from the last invalid attempt inspected (empty when valid). */
  validationIssues: string[];
  attemptsInspected: number;
};

export type RecoverMapResultReport = {
  runId: string;
  dryRun: boolean;
  recoveredAt: string;
  outcomes: RecoverMapResultOutcome[];
};

const failureDirFor = (runsDir: string, runId: string, jobId: string): string =>
  join(runsDir, runId, 'local-failures', jobId);

const resultsFileFor = (runsDir: string, runId: string): string =>
  join(runsDir, runId, 'results', 'local-map.results.jsonl');

const provenancePathFor = (runsDir: string, runId: string, jobId: string): string =>
  join(runsDir, runId, 'results', `${jobId}.provenance.json`);

const attemptNumbersFor = (dir: string): number[] =>
  readdirSync(dir)
    .map((file) => /^attempt-(\d+)\.raw\.json$/.exec(file)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);

const identityMatches = (result: AiStudyMapResult, job: AiStudyMapJob): boolean =>
  result.jobId === job.jobId &&
  result.runId === job.runId &&
  result.corpusContentHash === job.corpusContentHash &&
  result.inputHash === job.inputHash &&
  result.authoringInputFingerprint === authoringInputFingerprint(job);

const recoveryProvenance = (
  validation: Record<string, unknown>,
  job: AiStudyMapJob,
  rawHash: string,
  sourceAttempt: number,
  recoveredAt: string,
): Record<string, unknown> => {
  const { issues, ...base } = validation;
  return {
    ...base,
    jobId: job.jobId,
    authoringInputFingerprint: authoringInputFingerprint(job),
    rawHash,
    accepted: true,
    recovery: {
      recoveredFromHistoricalAttempt: true,
      sourceAttempt,
      rawHash,
      preRecoveryIssues: Array.isArray(issues) ? issues : [],
      recoveryReason: 'post-audit-validator-correction',
      recoveredVia: 'study:ai:recover-result',
      recoveredAt,
    },
  };
};

const recoverOne = (
  options: RecoverMapResultOptions,
  runsDir: string,
  runDir: string,
  jobs: Map<string, AiStudyMapJob>,
  resultsFile: string,
): RecoverMapResultOutcome => {
  // Read fresh on every call so recoveries earlier in the same invocation are
  // observed both by the already-accepted guard and the rewritten file.
  const results = readJsonl<AiStudyMapResult>(resultsFile);
  const jobId = options.jobIds[0];
  const outcome: RecoverMapResultOutcome = {
    jobId,
    status: 'failed',
    attempt: null,
    rawHash: null,
    disposition: null,
    confidence: null,
    error: null,
    validationIssues: [],
    attemptsInspected: 0,
  };
  const fail = (error: string): RecoverMapResultOutcome => {
    outcome.status = 'failed';
    outcome.error = error;
    return outcome;
  };

  const job = jobs.get(jobId);
  if (!job) return fail(`no prepared job ${jobId} under ${join(runDir, 'jobs')}`);
  if (job.authoringInputFingerprint !== authoringInputFingerprint(job))
    return fail(`prepared job ${jobId} fingerprint does not match its content; refusing`);
  if (results.some((row) => row.jobId === jobId))
    return fail(`${jobId} already has an accepted result; refusing to overwrite`);

  const failureDir = failureDirFor(runsDir, options.runId, jobId);
  if (!existsSync(failureDir)) return fail(`no local-failures directory for ${jobId}`);
  const known = attemptNumbersFor(failureDir);
  const candidates =
    options.attempt !== undefined
      ? known.includes(options.attempt)
        ? [options.attempt]
        : []
      : [...known].sort((a, b) => b - a);
  if (options.attempt !== undefined && candidates.length === 0)
    return fail(`attempt ${options.attempt} was not recorded for ${jobId}`);

  for (const attempt of candidates) {
    const rawFile = join(failureDir, `attempt-${attempt}.raw.json`);
    const validationFile = join(failureDir, `attempt-${attempt}.validation.json`);
    if (!existsSync(rawFile) || !existsSync(validationFile)) continue;
    const raw = readJson<unknown>(rawFile);
    const validation = readJson<Record<string, unknown>>(validationFile);
    const rawHash = hashText(JSON.stringify(raw));
    if (typeof validation.rawHash === 'string' && validation.rawHash !== rawHash)
      return fail(
        `attempt-${attempt} raw no longer matches its recorded rawHash; artifacts may be corrupted`,
      );
    const { result, issues, report } = validateLocalResult(raw, job);
    outcome.attemptsInspected += 1;
    outcome.validationIssues = issues;
    if (!report || !report.valid || !result) continue;
    if (!identityMatches(result, job))
      return fail(`recovered result identity does not match prepared job ${jobId}`);
    outcome.attempt = attempt;
    outcome.rawHash = rawHash;
    outcome.disposition = result.disposition;
    outcome.confidence = result.confidence;
    if (options.dryRun) {
      outcome.status = 'valid-dry-run';
      return outcome;
    }
    writeJsonlAtomic(resultsFile, [...results, result]);
    writeJson(
      provenancePathFor(runsDir, options.runId, jobId),
      recoveryProvenance(validation, job, rawHash, attempt, options.recoveredAt ?? new Date().toISOString()),
    );
    outcome.status = 'recovered';
    return outcome;
  }
  outcome.error =
    outcome.attemptsInspected === 0
      ? `no readable attempt artifacts for ${jobId}`
      : `no saved attempt for ${jobId} validates under the current validator`;
  return outcome;
};

export const recoverMapResults = (
  options: RecoverMapResultOptions,
): RecoverMapResultReport => {
  if (options.jobIds.length === 0) throw new Error('At least one --job is required.');
  if (options.attempt !== undefined && options.jobIds.length !== 1)
    throw new Error('--attempt can only be used with exactly one --job.');
  const runsDir = options.runsDir ?? RUNS_DIR;
  const runDir = join(runsDir, options.runId);
  if (!existsSync(runDir)) throw new Error(`Unknown run: ${options.runId}`);
  const jobs = new Map(
    loadBatchJobs(options.runId, undefined, runsDir).map((job) => [job.jobId, job]),
  );
  const resultsFile = resultsFileFor(runsDir, options.runId);
  const outcomes = options.jobIds.map((jobId) =>
    recoverOne({ ...options, jobIds: [jobId] }, runsDir, runDir, jobs, resultsFile),
  );
  return {
    runId: options.runId,
    dryRun: Boolean(options.dryRun),
    recoveredAt: options.recoveredAt ?? new Date().toISOString(),
    outcomes,
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

export const optionsFromArgs = (argv: string[]): RecoverMapResultOptions => {
  const flags = parseFlags(argv);
  const run = flags.run;
  if (typeof run !== 'string') throw new Error('--run is required. Run with --help for options.');
  const jobIds = argv
    .slice(1)
    .reduce<string[]>((acc, arg, index, list) => {
      if (arg === '--job' && typeof list[index + 1] === 'string') acc.push(list[index + 1]);
      return acc;
    }, []);
  if (jobIds.length === 0)
    throw new Error('At least one --job is required. Run with --help for options.');
  const attempt = flags.attempt;
  return {
    runId: run,
    jobIds,
    ...(typeof attempt === 'string' ? { attempt: Number(attempt) } : {}),
    dryRun: Boolean(flags['dry-run']),
  };
};

const HELP = `Deterministically recover locally authored Study Map results (no model calls).

Usage:
  npx tsx scripts/studyAiRecoverMapResult.ts --run <run-id> --job <job-id> [--job ...]
    [--attempt <n>] [--dry-run]

Revalidates saved local-failures/<jobId>/attempt-N.raw.json artifacts with the
current validator and promotes the highest-numbering cleanly validating
attempt (or the pinned --attempt) into results/local-map.results.jsonl with
recovery provenance at results/<jobId>.provenance.json. Already-accepted jobs
are refused; historical failure artifacts are never modified.`;

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP.trimEnd());
    return;
  }
  const report = recoverMapResults(optionsFromArgs(argv));
  console.log(JSON.stringify(report, null, 2));
  if (report.outcomes.some((outcome) => outcome.status === 'failed')) process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiRecoverMapResult.ts')) main();
