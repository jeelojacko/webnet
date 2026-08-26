// Runner-owned execution/provenance layer for Skip Critic V1.
//
// Wraps the single-attempt runSkipCriticInference(...) with:
// - durable per-job result/provenance artifacts in a critic-only namespace
//   (`critic/` under the run directory, separate from normal author outputs);
// - the repository-standard bounded retry policy (maxRetries, default 2,
//   total attempts = maxRetries + 1) applied to both transport/provider
//   failures and invalid model results; every attempt is a fresh inference
//   through runSkipCriticInference with no repair;
// - deterministic resume: a job is only skipped when a validated stored
//   result exists alongside matching provenance; anything else (missing,
//   malformed, mismatched identity, interrupted, terminal failure) is
//   re-executed. A terminal failure is never reused or reinterpreted as
//   success, and there is no silent fallback to skip-supported/uncertain.
//
// The model-authored SkipCriticResult is persisted verbatim: no runner
// identity, provenance, or attempt fields are added to it.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AiStudyMapJob } from './studyAiTypes';
import {
  runSkipCriticInference,
  type SkipCriticRunnerOptions,
  type SkipCriticRunnerOutcome,
  type SkipCriticTransport,
} from './studyAiSkipCriticRunner';
import { SKIP_CRITIC_RESULT_SCHEMA } from './studyAiSkipCriticContract';
import {
  authoringInputFingerprintPayload,
  canonicalJson,
} from './studyAiResultContract';
import { SKIP_CRITIC_SYSTEM_PROMPT, buildSkipCriticInput } from './studyAiSkipCriticInput';
import { validateSkipCriticResult } from './studyAiSkipCriticValidation';
import type { SkipCriticResult } from './studyAiSkipCriticTypes';

export const DEFAULT_SKIP_CRITIC_RUNS_DIR = 'study-content/ai/runs';
export const DEFAULT_SKIP_CRITIC_MAX_RETRIES = 2;

export type SkipCriticExecutorOptions = SkipCriticRunnerOptions & {
  runsDir?: string;
  maxRetries?: number;
};

export type SkipCriticExecutionOutcome =
  | {
      status: 'success';
      reused: boolean;
      result: SkipCriticResult;
      attempts: number;
    }
  | {
      status: 'failed';
      attempts: number;
      lastFailure: SkipCriticFailureClassification;
    };

export type SkipCriticFailureClassification =
  | { kind: 'invalid-result'; issues: string[] }
  | { kind: 'transport/provider'; message: string };

export type SkipCriticJobReport = {
  jobId: string;
  outcome: SkipCriticExecutionOutcome;
  previouslyTerminalFailed: boolean;
};

export type SkipCriticProvenance = {
  schemaVersion: 1;
  artifactKind: 'skip-critic-v1-provenance';
  runId: string;
  jobId: string;
  corpusContentHash: string;
  inputHash: string;
  authoringInputFingerprint: string;
  promptSpecVersion: string;
  criticSchemaVersion: 1;
  responseSchemaSha256: string;
  systemPromptSha256: string;
  providerKind: 'local-openai-compatible';
  baseUrl: string;
  modelId: string;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  status: 'success' | 'failed';
  terminalFailure?: SkipCriticFailureClassification;
  timestamp: string;
};

export type SkipCriticExecutionSummary = {
  total: number;
  success: number;
  reused: number;
  failed: number;
  reports: SkipCriticJobReport[];
};

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Deterministic input identity, identical to scripts/studyAiFingerprint. */
const jobFingerprint = (job: AiStudyMapJob): string =>
  hashText(canonicalJson(authoringInputFingerprintPayload(job)));

const parseJson = <T>(text: string, source: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${source}: ${message}`);
  }
};

const readJson = <T>(path: string): T => parseJson<T>(readFileSync(path, 'utf8'), path);

const readJsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, index) =>
          parseJson<T>(index === 0 ? line.replace(/^\uFEFF/, '') : line, `${path}:${index + 1}`),
        )
    : [];

/**
 * A missing or malformed results file is incomplete state, never success.
 * Callers re-execute the job and the file is rewritten atomically.
 */
const readJsonlSafe = <T>(path: string): T[] => {
  try {
    return readJsonl<T>(path);
  } catch {
    return [];
  }
};

const writeJsonlAtomic = (path: string, rows: unknown[]): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(
    tempPath,
    rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
  );
  renameSync(tempPath, path);
};

const writeJsonAtomic = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, path);
};

// Critic-only namespace under the run directory so critic artifacts can never
// be confused with (or overwrite) normal Study Map author outputs.
const criticDir = (runsDir: string, runId: string): string =>
  join(runsDir, runId, 'critic');
const criticResultsPath = (runsDir: string, runId: string): string =>
  join(criticDir(runsDir, runId), 'skip-critic.results.jsonl');
const criticProvenancePath = (runsDir: string, runId: string, jobId: string): string =>
  join(criticDir(runsDir, runId), `${jobId}.provenance.json`);
const criticFailureDir = (runsDir: string, runId: string, jobId: string): string =>
  join(criticDir(runsDir, runId), 'failures', jobId);
const criticTerminalFailurePath = (
  runsDir: string,
  runId: string,
  jobId: string,
): string => join(criticDir(runsDir, runId), `${jobId}.terminal-failure.json`);

const failureClassification = (
  outcome: Extract<SkipCriticRunnerOutcome, { status: 'invalid-result' | 'transport-failure' }>,
): SkipCriticFailureClassification =>
  outcome.status === 'transport-failure'
    ? { kind: 'transport/provider', message: outcome.message }
    : { kind: 'invalid-result', issues: outcome.issues.map((issue) => `${issue.code}`) };

/** Exact identity tuple a stored result/provenance pair must match to reuse. */
const identityMatches = (
  stored: {
    runId?: unknown;
    jobId?: unknown;
    corpusContentHash?: unknown;
    inputHash?: unknown;
    authoringInputFingerprint?: unknown;
    promptSpecVersion?: unknown;
  },
  job: AiStudyMapJob,
): boolean =>
  stored.runId === job.runId &&
  stored.jobId === job.jobId &&
  stored.corpusContentHash === job.corpusContentHash &&
  stored.inputHash === job.inputHash &&
  stored.authoringInputFingerprint === jobFingerprint(job) &&
  stored.promptSpecVersion === job.promptSpecVersion;

/**
 * Resume check: complete only when a result row exists AND a provenance file
 * exists with status 'success' AND identity matches the current job AND the
 * stored result still validates against the job's permitted evidence.
 */
const completedResult = (
  runsDir: string,
  runId: string,
  job: AiStudyMapJob,
): SkipCriticResult | undefined => {
  const row = readJsonlSafe<Record<string, unknown>>(criticResultsPath(runsDir, runId)).find(
    (candidate) => candidate.jobId === job.jobId,
  );
  if (!row) return undefined;
  const provenancePath = criticProvenancePath(runsDir, runId, job.jobId);
  if (!existsSync(provenancePath)) return undefined;
  let provenance: Record<string, unknown>;
  try {
    provenance = readJson(provenancePath);
  } catch {
    return undefined;
  }
  if (provenance.status !== 'success' || !identityMatches(provenance, job)) return undefined;
  const result = row.result as unknown;
  const report = validateSkipCriticResult(result, {
    permittedEvidence: buildSkipCriticInput(job).permittedEvidence,
  });
  return report.valid ? (result as SkipCriticResult) : undefined;
};

const previouslyTerminalFailed = (
  runsDir: string,
  runId: string,
  jobId: string,
): boolean => existsSync(criticTerminalFailurePath(runsDir, runId, jobId));

const recordAttemptFailure = (
  runsDir: string,
  runId: string,
  jobId: string,
  attempt: number,
  raw: unknown,
  classification: SkipCriticFailureClassification,
): void => {
  const dir = criticFailureDir(runsDir, runId, jobId);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, `attempt-${attempt}.raw.json`), raw);
  writeJsonAtomic(join(dir, `attempt-${attempt}.validation.json`), {
    schemaVersion: 1,
    artifactKind: 'skip-critic-v1-attempt-failure',
    attempt,
    failure: classification,
  });
};

const buildProvenance = (
  job: AiStudyMapJob,
  options: Required<Pick<SkipCriticExecutorOptions, 'model' | 'baseUrl'>> &
    Pick<SkipCriticExecutorOptions, 'timeoutMs' | 'maxRetries'>,
  attempts: number,
  maxAttempts: number,
  status: SkipCriticProvenance['status'],
  timestamp: string,
  terminalFailure?: SkipCriticFailureClassification,
): SkipCriticProvenance => ({
  schemaVersion: 1,
  artifactKind: 'skip-critic-v1-provenance',
  runId: job.runId,
  jobId: job.jobId,
  corpusContentHash: job.corpusContentHash,
  inputHash: job.inputHash,
  authoringInputFingerprint: jobFingerprint(job),
  promptSpecVersion: job.promptSpecVersion,
  criticSchemaVersion: 1,
  responseSchemaSha256: hashText(JSON.stringify(SKIP_CRITIC_RESULT_SCHEMA)),
  systemPromptSha256: hashText(SKIP_CRITIC_SYSTEM_PROMPT),
  providerKind: 'local-openai-compatible',
  baseUrl: options.baseUrl,
  modelId: options.model,
  attempts,
  maxAttempts,
  timeoutMs: options.timeoutMs ?? 600_000,
  status,
  ...(terminalFailure ? { terminalFailure } : {}),
  timestamp,
});

const executeJob = async (
  job: AiStudyMapJob,
  options: SkipCriticExecutorOptions,
  transport: SkipCriticTransport,
  timestamp: () => string,
): Promise<SkipCriticJobReport> => {
  const runsDir = options.runsDir ?? DEFAULT_SKIP_CRITIC_RUNS_DIR;
  const maxRetries = options.maxRetries ?? DEFAULT_SKIP_CRITIC_MAX_RETRIES;
  const maxAttempts = maxRetries + 1;
  const previouslyFailed = previouslyTerminalFailed(runsDir, job.runId, job.jobId);
  const reusedResult = completedResult(runsDir, job.runId, job);
  if (reusedResult) {
    return {
      jobId: job.jobId,
      outcome: { status: 'success', reused: true, result: reusedResult, attempts: 0 },
      previouslyTerminalFailed: previouslyFailed,
    };
  }
  const results = readJsonlSafe<Record<string, unknown>>(criticResultsPath(runsDir, job.runId));
  const index = results.findIndex((row) => row.jobId === job.jobId);
  let lastFailure: SkipCriticFailureClassification | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const outcome = await runSkipCriticInference(job, options, transport);
    if (outcome.status === 'accepted') {
      const row = { jobId: job.jobId, result: outcome.result };
      if (index >= 0) results[index] = row;
      else results.push(row);
      writeJsonlAtomic(criticResultsPath(runsDir, job.runId), results);
      writeJsonAtomic(
        criticProvenancePath(runsDir, job.runId, job.jobId),
        buildProvenance(job, options, attempt, maxAttempts, 'success', timestamp()),
      );
      rmSync(criticTerminalFailurePath(runsDir, job.runId, job.jobId), { force: true });
      return {
        jobId: job.jobId,
        outcome: { status: 'success', reused: false, result: outcome.result, attempts },
        previouslyTerminalFailed: previouslyFailed,
      };
    }
    lastFailure = failureClassification(outcome);
    recordAttemptFailure(
      runsDir,
      job.runId,
      job.jobId,
      attempt,
      'raw' in outcome ? outcome.raw : outcome.message,
      lastFailure,
    );
  }
  const terminal = lastFailure as SkipCriticFailureClassification;
  writeJsonAtomic(
    criticTerminalFailurePath(runsDir, job.runId, job.jobId),
    buildProvenance(job, options, attempts, maxAttempts, 'failed', timestamp(), terminal),
  );
  return {
    jobId: job.jobId,
    outcome: { status: 'failed', attempts, lastFailure: terminal },
    previouslyTerminalFailed: previouslyFailed,
  };
};

export const runSkipCriticJob = async (
  job: AiStudyMapJob,
  options: SkipCriticExecutorOptions,
  transport: SkipCriticTransport = fetch,
  timestamp: () => string = () => new Date().toISOString(),
): Promise<SkipCriticJobReport> => executeJob(job, options, transport, timestamp);

export const runSkipCriticJobs = async (
  jobs: AiStudyMapJob[],
  options: SkipCriticExecutorOptions,
  transport: SkipCriticTransport = fetch,
  timestamp: () => string = () => new Date().toISOString(),
): Promise<SkipCriticExecutionSummary> => {
  const reports: SkipCriticJobReport[] = [];
  for (const job of jobs) reports.push(await runSkipCriticJob(job, options, transport, timestamp));
  return {
    total: jobs.length,
    success: reports.filter((report) => report.outcome.status === 'success').length,
    reused: reports.filter(
      (report) =>
        report.outcome.status === 'success' && report.outcome.reused,
    ).length,
    failed: reports.filter((report) => report.outcome.status === 'failed').length,
    reports,
  };
};
