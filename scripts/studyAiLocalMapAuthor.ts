import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  AiStudyMapJob,
  AiStudyMapResult,
  AiValidationIssue,
  AiValidationReport,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import { STUDY_MAP_V3_RESULT_SCHEMA } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';
import { retryStateFor } from './studyAiLocalMapAuthorRetry';
import {
  classifyProviderFailure,
  stripUtf8Bom,
  type ProviderFailure,
  type ProviderFailureCode,
} from './studyAiProviderFailures';
import { waitForProviderHealth } from './studyAiProviderRecovery';

export { buildValidationRetryNote } from './studyAiLocalMapAuthorRetry';

const RUNS_DIR = 'study-content/ai/runs';

const RUNNER_OWNED_RESULT_IDENTITY: ReadonlySet<string> = new Set([
  'schemaVersion',
  'jobId',
  'runId',
  'corpusContentHash',
  'inputHash',
  'authoringInputFingerprint',
  'promptSpecVersion',
]);

// Local response schema the model fills: semantic fields only. The runner
// injects the runner-owned identity fields before validation, so the schema
// sent to a local model omits them.
export const STUDY_MAP_V3_LOCAL_RESULT_SCHEMA: Record<string, unknown> = {
  $schema: STUDY_MAP_V3_RESULT_SCHEMA.$schema,
  $id: 'https://webnet.local/schemas/study-map-v3-local-author-result.schema.json',
  title: 'Study Map V3 Local Author Result',
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(STUDY_MAP_V3_RESULT_SCHEMA.properties).filter(
      ([field]) => !RUNNER_OWNED_RESULT_IDENTITY.has(field),
    ),
  ),
  required: STUDY_MAP_V3_RESULT_SCHEMA.required.filter(
    (field) => !RUNNER_OWNED_RESULT_IDENTITY.has(field),
  ),
};

type ConfigSource = 'cli' | 'env' | 'default' | 'omitted-request' | 'unknown';
type ResolvedConfigValue<T> = { value: T; source: ConfigSource };
type OmittedSamplerValue = ResolvedConfigValue<null>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ChatMessage = { role: 'system' | 'user'; content: string };
type StudyMapRequestBody = {
  model: string;
  messages: ChatMessage[];
  reasoning_effort?: string;
  response_format:
    | {
        type: 'json_schema';
        json_schema: { name: string; strict: true; schema: Record<string, unknown> };
      }
    | { type: 'json_object' };
};
type ResolvedInferenceConfig = {
  provider: {
    kind: 'local-openai-compatible';
    baseUrl: string;
    endpoint: string;
    baseUrlSource: ConfigSource;
  };
  model: { id: string; source: ConfigSource };
  reasoningEffort: ResolvedConfigValue<string | null>;
  sampler: Record<string, OmittedSamplerValue>;
  execution: {
    timeoutMs: ResolvedConfigValue<number>;
    maxRetries: ResolvedConfigValue<number>;
    concurrency: ResolvedConfigValue<number>;
  };
  structuredOutput: { mode: string; strict: boolean; responseSchemaSha256: string };
  prompts: { systemPromptSha256: string; promptSpecVersion: string };
};

type RunnerOptions = {
  runId: string;
  model: string;
  modelSource?: ConfigSource;
  baseUrl: string;
  baseUrlSource?: ConfigSource;
  apiKey?: string;
  comparisonSet?: string;
  jobId?: string;
  batch?: string;
  resume: boolean;
  concurrency: number;
  concurrencySource?: ConfigSource;
  maxRetries: number;
  maxRetriesSource?: ConfigSource;
  timeoutMs?: number;
  timeoutMsSource?: ConfigSource;
  reasoningEffort?: string;
  reasoningEffortSource?: ConfigSource;
  dryRun: boolean;
  unsafeUnstructured: boolean;
  /** Max provider (transport/HTTP/response) calls per semantic attempt. Default 3. */
  maxProviderAttempts?: number;
  /** Max ms to poll provider health after a provider failure before aborting. Default 300000. */
  providerRecoveryTimeoutMs?: number;
  /** Provider health poll interval in ms. Default 5000. */
  providerRecoveryPollMs?: number;
  log?: (_message: string) => void;
};

export type LocalMapAuthoringResult = {
  accepted: number;
  semanticFailed: number;
  /** Jobs without a result because the run aborted on provider failure (0 when no abort). */
  providerIncomplete: number;
  skipped: number;
  dryRunJobs: number;
  providerAbort?: { code: ProviderFailureCode; jobId: string; message: string };
};

/** Thrown to stop the run (accepted results preserved) when the provider cannot be recovered. */
export class ProviderRunAbortError extends Error {
  readonly jobId: string;
  readonly code: ProviderFailureCode;
  constructor(code: ProviderFailureCode, jobId: string, message: string) {
    super(message);
    this.name = 'ProviderRunAbortError';
    this.jobId = jobId;
    this.code = code;
  }
}

const DEFAULT_LOCAL_AUTHOR_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_PROVIDER_ATTEMPTS = 3;
const DEFAULT_PROVIDER_RECOVERY_TIMEOUT_MS = 300_000;
const DEFAULT_PROVIDER_RECOVERY_POLL_MS = 5_000;

type RequestInitLike = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
};

type FetchLike = (
  _input: string,
  _init: RequestInitLike,
) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

const parseArgs = (): Record<string, string | boolean> => parseRawArgs(process.argv.slice(2));

const parseRawArgs = (rawArgs: string[]): Record<string, string | boolean> => {
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
};

const parsePositiveIntOption = (
  value: string | boolean | undefined,
  source: string,
): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${source} must be a positive integer.`);
  return parsed;
};

const parseTimeoutMs = (value: unknown, source: string): number => {
  if (typeof value !== 'string')
    throw new Error(`${source} must be a positive integer number of milliseconds.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${source} must be a positive integer number of milliseconds.`);
  return parsed;
};

const timeoutMsFrom = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
): number => {
  if (args['timeout-ms'] !== undefined) return parseTimeoutMs(args['timeout-ms'], '--timeout-ms');
  if (env.STUDY_AI_TIMEOUT_MS !== undefined)
    return parseTimeoutMs(env.STUDY_AI_TIMEOUT_MS, 'STUDY_AI_TIMEOUT_MS');
  return DEFAULT_LOCAL_AUTHOR_TIMEOUT_MS;
};

const timeoutMsSourceFrom = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
): ConfigSource => {
  if (args['timeout-ms'] !== undefined) return 'cli';
  if (env.STUDY_AI_TIMEOUT_MS !== undefined) return 'env';
  return 'default';
};

const reasoningEffortFrom = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
): string | undefined => {
  if (args['reasoning-effort'] !== undefined) {
    if (
      typeof args['reasoning-effort'] !== 'string' ||
      args['reasoning-effort'].trim().length === 0
    ) {
      throw new Error('--reasoning-effort must be a non-empty string.');
    }
    return args['reasoning-effort'];
  }
  return env.STUDY_AI_REASONING_EFFORT?.trim() ? env.STUDY_AI_REASONING_EFFORT : undefined;
};

const reasoningEffortSourceFrom = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
): ConfigSource => {
  if (args['reasoning-effort'] !== undefined) return 'cli';
  if (env.STUDY_AI_REASONING_EFFORT?.trim()) return 'env';
  return 'omitted-request';
};

const optionsFromArgs = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined> = process.env,
): RunnerOptions => ({
  runId: String(args.run ?? ''),
  model: String(args.model ?? env.STUDY_AI_MODEL ?? ''),
  modelSource:
    args.model !== undefined ? 'cli' : env.STUDY_AI_MODEL !== undefined ? 'env' : 'default',
  baseUrl: String(args['base-url'] ?? env.STUDY_AI_BASE_URL ?? 'http://127.0.0.1:1234/v1'),
  baseUrlSource:
    args['base-url'] !== undefined
      ? 'cli'
      : env.STUDY_AI_BASE_URL !== undefined
        ? 'env'
        : 'default',
  apiKey: args['api-key'] ? String(args['api-key']) : env.STUDY_AI_API_KEY,
  comparisonSet: args['comparison-set'] ? String(args['comparison-set']) : undefined,
  jobId: args.job ? String(args.job) : undefined,
  batch: args.batch ? String(args.batch) : undefined,
  resume: Boolean(args.resume),
  concurrency: Number(args.concurrency ?? 1),
  concurrencySource: args.concurrency !== undefined ? 'cli' : 'default',
  maxRetries: Number(args['max-retries'] ?? 2),
  maxRetriesSource: args['max-retries'] !== undefined ? 'cli' : 'default',
  timeoutMs: timeoutMsFrom(args, env),
  timeoutMsSource: timeoutMsSourceFrom(args, env),
  reasoningEffort: reasoningEffortFrom(args, env),
  reasoningEffortSource: reasoningEffortSourceFrom(args, env),
  dryRun: Boolean(args['dry-run']),
  unsafeUnstructured: Boolean(args['unsafe-unstructured']),
  maxProviderAttempts: parsePositiveIntOption(args['max-provider-attempts'], '--max-provider-attempts'),
  providerRecoveryTimeoutMs: parsePositiveIntOption(
    args['provider-recovery-timeout-ms'],
    '--provider-recovery-timeout-ms',
  ),
  providerRecoveryPollMs: parsePositiveIntOption(
    args['provider-recovery-poll-ms'],
    '--provider-recovery-poll-ms',
  ),
});

const parseJson = <T>(text: string, source: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${source}: ${message}`);
  }
};

const readJson = <T>(path: string): T => parseJson<T>(readFileSync(path, 'utf8'), path);
const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');
const readJsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, index) => parseJson<T>(stripUtf8Bom(line), `${path}:${index + 1}`))
    : [];

const writeJsonlAtomic = (path: string, rows: unknown[]): void => {
  const tempPath = `${path}.tmp`;
  writeFileSync(
    tempPath,
    rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
  );
  renameSync(tempPath, path);
};

const jobsDirFor = (runId: string): string => join(RUNS_DIR, runId, 'jobs');

const batchJobFiles = (runId: string, batch?: string): string[] => {
  if (batch) return [join(jobsDirFor(runId), `batch-${batch.padStart(3, '0')}.jobs.jsonl`)];
  const manifest = readJson<{ batchCount: number }>(
    join(RUNS_DIR, runId, 'reports', 'batch-manifest.json'),
  );
  return Array.from(
    { length: manifest.batchCount },
    (_, index) => join(jobsDirFor(runId), `batch-${String(index + 1).padStart(3, '0')}.jobs.jsonl`),
  );
};

const loadBatchJobs = (runId: string, batch?: string): AiStudyMapJob[] =>
  batchJobFiles(runId, batch).flatMap((file) => readJsonl<AiStudyMapJob>(file));

const applySelection = (allJobs: AiStudyMapJob[], options: RunnerOptions): AiStudyMapJob[] => {
  const selectedIds = options.comparisonSet
    ? new Set(
        readJson<{ jobs: Array<{ v2JobId: string }> }>(options.comparisonSet).jobs.map(
          (job) => job.v2JobId,
        ),
      )
    : undefined;
  return allJobs.filter(
    (job) =>
      (!options.jobId || job.jobId === options.jobId) &&
      (!selectedIds || selectedIds.has(job.jobId)),
  );
};

const resultPath = (runId: string): string =>
  join(RUNS_DIR, runId, 'results', 'local-map.results.jsonl');

const runMetadataPath = (runId: string): string =>
  join(RUNS_DIR, runId, 'reports', 'local-run-metadata.json');

const providerEventsPath = (runId: string): string =>
  join(RUNS_DIR, runId, 'reports', 'provider-events.jsonl');

type LocalRunMetadata = {
  schemaVersion: 1;
  runId: string;
  model: string;
  comparisonSetPath: string | null;
  comparisonSetSha256: string | null;
  jobsFileSha256: Record<string, string>;
  createdAt: string;
};

type RunIdentity = {
  comparisonSetSha256: string | null;
  jobsFileSha256: Record<string, string>;
};

const loadRunIdentity = (options: RunnerOptions): RunIdentity => {
  const jobsFileSha256: Record<string, string> = {};
  for (const file of batchJobFiles(options.runId)) {
    jobsFileSha256[basename(file)] = hashText(readFileSync(file, 'utf8'));
  }
  return {
    comparisonSetSha256: options.comparisonSet
      ? hashText(readFileSync(options.comparisonSet, 'utf8'))
      : null,
    jobsFileSha256,
  };
};

/**
 * Identity recorded at first start and revalidated on every subsequent start
 * (with or without --resume): the comparison set, every jobs file, and the
 * model must match. Fail-closed: any mismatch aborts instead of silently
 * re-authoring a changed corpus or model into the same result file.
 */
const validateRunMetadata = (options: RunnerOptions, identity: RunIdentity): void => {
  const path = runMetadataPath(options.runId);
  if (!existsSync(path)) {
    const metadata: LocalRunMetadata = {
      schemaVersion: 1,
      runId: options.runId,
      model: options.model,
      comparisonSetPath: options.comparisonSet ?? null,
      comparisonSetSha256: identity.comparisonSetSha256,
      jobsFileSha256: identity.jobsFileSha256,
      createdAt: new Date().toISOString(),
    };
    writeJson(path, metadata);
    return;
  }
  const metadata = readJson<LocalRunMetadata>(path);
  if (metadata.model !== options.model)
    throw new Error(
      `Refusing to run ${options.runId}: metadata model ${metadata.model} does not match current model ${options.model}.`,
    );
  if (metadata.comparisonSetPath !== (options.comparisonSet ?? null))
    throw new Error(
      `Refusing to run ${options.runId}: metadata comparison set ${metadata.comparisonSetPath ?? '<none>'} does not match current ${options.comparisonSet ?? '<none>'}.`,
    );
  if (metadata.comparisonSetSha256 !== identity.comparisonSetSha256)
    throw new Error(
      `Refusing to run ${options.runId}: comparison set hash ${identity.comparisonSetSha256} does not match metadata ${metadata.comparisonSetSha256}.`,
    );
  for (const [name, expected] of Object.entries(metadata.jobsFileSha256)) {
    const file = join(jobsDirFor(options.runId), name);
    const actual = existsSync(file) ? hashText(readFileSync(file, 'utf8')) : null;
    if (actual !== expected)
      throw new Error(
        `Refusing to run ${options.runId}: jobs file ${name} hash ${actual ?? 'missing'} does not match metadata ${expected}.`,
      );
  }
};

/**
 * --resume integrity checks on every previously accepted result: no duplicate
 * rows, the result runId must match the job file's prepared run identity
 * (warm-started run directories keep the source run's identity on purpose),
 * and the result fingerprint must match the job file hash.
 */
const validateExistingResults = (
  accepted: AiStudyMapResult[],
  allRunJobs: AiStudyMapJob[],
  options: RunnerOptions,
): void => {
  if (accepted.length === 0) return;
  const jobById = new Map(allRunJobs.map((job) => [job.jobId, job]));
  const seen = new Set<string>();
  for (const result of accepted) {
    if (seen.has(result.jobId))
      throw new Error(
        `Refusing to run ${options.runId}: duplicate accepted result for ${result.jobId} in ${resultPath(options.runId)}.`,
      );
    seen.add(result.jobId);
    const job = jobById.get(result.jobId);
    if (!job)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.jobId} has no matching job file.`,
      );
    if (result.runId !== job.runId)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.jobId} has runId ${result.runId}, but its job file belongs to run ${job.runId}.`,
      );
    const expectedFingerprint = authoringInputFingerprint(job);
    if (result.authoringInputFingerprint !== expectedFingerprint)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.jobId} fingerprint ${result.authoringInputFingerprint} does not match job hash ${expectedFingerprint}.`,
      );
  }
};

/** Path of the canonical Study Map V3 spec; local runner and external providers share it. */
export const STUDY_MAP_V3_SPEC_PATH = 'study-content/ai/specs/study-map-v3.md';

/**
 * Load the canonical Study Map V3 spec at runtime so the local model receives the
 * same prompt spec as the external provider workflow (fail closed when missing).
 */
export const loadStudyMapV3Spec = (specPath: string = STUDY_MAP_V3_SPEC_PATH): string => {
  if (!existsSync(specPath)) throw new Error(`Study Map V3 spec not found at ${specPath}.`);
  const text = readFileSync(specPath, 'utf8');
  if (!text.trim()) throw new Error(`Study Map V3 spec is empty at ${specPath}.`);
  return text;
};

const RUNNER_NOTES = [
  'RUNNER NOTES (local run only):',
  '- Return only the semantic result fields: disposition, confidence, reason, suggestedPriority, proposedGroups, and warnings.',
  '- The runner injects runner-owned identity fields (schemaVersion, jobId, runId, corpusContentHash, inputHash, authoringInputFingerprint, promptSpecVersion); do not include them.',
  '- Return exactly one JSON object matching the supplied Study Map V3 schema.',
].join('\n');

const promptForJob = (job: AiStudyMapJob, spec = loadStudyMapV3Spec()): ChatMessage[] => [
  { role: 'system', content: `${spec.trimEnd()}\n\n${RUNNER_NOTES}` },
  { role: 'user', content: JSON.stringify({ job }) },
];

const requestBody = (
  job: AiStudyMapJob,
  options: RunnerOptions,
  retryNote?: string,
): StudyMapRequestBody => {
  const base = {
    model: options.model,
    messages: retryNote
      ? [...promptForJob(job), { role: 'user' as const, content: retryNote }]
      : promptForJob(job),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
  };
  if (!options.unsafeUnstructured) {
    return {
      ...base,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'study_map_v3_local_result',
          strict: true,
          schema: STUDY_MAP_V3_LOCAL_RESULT_SCHEMA,
        },
      },
    };
  }
  return {
    ...base,
    response_format: { type: 'json_object' },
  };
};

const parseModelContent = async (response: Pick<Response, 'json'>): Promise<JsonValue> => {
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | object } }>;
    output_text?: string;
  };
  const content = body.choices?.[0]?.message?.content ?? body.output_text;
  if (typeof content === 'object' && content !== null) return content as JsonValue;
  if (typeof content !== 'string')
    throw new Error('Provider response did not contain JSON content.');
  return parseJson<JsonValue>(content, 'provider response content');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Identity fields are runner-owned: any identity values the model returned
// are overwritten with the job's canonical identity before validation.
const withRunnerIdentity = (value: Record<string, unknown>, job: AiStudyMapJob): AiStudyMapResult => {
  const groupCount = Array.isArray(value.proposedGroups) ? value.proposedGroups.length : 0;
  return {
    ...(value as Partial<AiStudyMapResult>),
    schemaVersion: 1,
    jobId: job.jobId,
    runId: job.runId,
    corpusContentHash: job.corpusContentHash,
    inputHash: job.inputHash,
    authoringInputFingerprint: authoringInputFingerprint(job),
    promptSpecVersion: job.promptSpecVersion,
    // Canonical serialization: suggestedPriority is always present in stored results —
    // P1-P4 chosen by the model for grouped results, or exactly null when there are no
    // groups. This completes serialization only; it never infers a P level. Grouped
    // results with a missing/null priority still fail SUGGESTED_PRIORITY_REQUIRED.
    ...(groupCount === 0 && value.suggestedPriority === undefined
      ? { suggestedPriority: null }
      : {}),
  } as AiStudyMapResult;
};

const validateLocalResult = (
  value: unknown,
  job: AiStudyMapJob,
): { result?: AiStudyMapResult; issues: string[]; report?: AiValidationReport } => {
  if (!isRecord(value)) return { issues: ['RESULT_INVALID: Local result must be a JSON object.'] };
  const result = withRunnerIdentity(value, job);
  const report = validateAiStudyMapResult(result, job);
  const issues = report.issues.map((issue) => `${issue.code}: ${issue.message}`);
  return report.valid ? { result, issues, report } : { issues, report };
};

const failureDir = (runId: string, jobId: string): string =>
  join(RUNS_DIR, runId, 'local-failures', jobId);

const recordFailure = (
  runId: string,
  jobId: string,
  attempt: number,
  raw: unknown,
  validation: unknown,
): void => {
  const dir = failureDir(runId, jobId);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, `attempt-${attempt}.raw.json`), raw);
  writeJson(join(dir, `attempt-${attempt}.validation.json`), validation);
};

const elapsedMs = (startedAt: number): number => Date.now() - startedAt;

/** Next per-job failure-artifact number; continues after existing artifacts (resume-safe). */
const nextFailureArtifactNumber = (runId: string, jobId: string): number => {
  const dir = failureDir(runId, jobId);
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    const match = /^attempt-(\d+)\.raw\.json$/.exec(entry);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
};

const provenanceFor = (
  job: AiStudyMapJob,
  options: RunnerOptions,
  timeoutMs: number,
  attempt: number,
  raw: unknown,
  accepted: boolean,
): Record<string, unknown> => ({
  providerKind: 'local-openai-compatible',
  modelId: options.model,
  runId: options.runId,
  jobId: job.jobId,
  authoringInputFingerprint: authoringInputFingerprint(job),
  sourceHashes: job.target.sourceHashes,
  attempt,
  timestamp: new Date().toISOString(),
  structuredOutputMode: options.unsafeUnstructured ? 'unsafe-json-object' : 'strict-json-schema',
  resolvedInferenceConfig: resolvedInferenceConfig(job, options, timeoutMs),
  rawHash: hashText(JSON.stringify(raw)),
  accepted,
});

type ProviderCallContext = {
  options: RunnerOptions;
  job: AiStudyMapJob;
  chatUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  log: (_message: string) => void;
  body: StudyMapRequestBody;
  semanticAttempt: number;
  nextArtifactNumber: () => number;
};

const appendProviderEvent = (runId: string, event: Record<string, unknown>): void => {
  const path = providerEventsPath(runId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
};

const providerFailureEvent = (
  context: ProviderCallContext,
  providerAttempt: number,
  failure: ProviderFailure,
  outcome: { recovered: boolean; waitedMs: number },
): Record<string, unknown> => ({
  runId: context.options.runId,
  jobId: context.job.jobId,
  semanticAttempt: context.semanticAttempt,
  providerAttempt,
  timestamp: new Date().toISOString(),
  code: failure.code,
  message: failure.message,
  ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
  baseUrl: context.options.baseUrl,
  recovered: outcome.recovered,
  waitedMs: outcome.waitedMs,
  ...(outcome.recovered ? {} : { runAborted: true }),
});

const recordProviderFailure = (context: ProviderCallContext, failure: ProviderFailure): void => {
  const raw = {
    failureKind: 'transport/provider' as const,
    failureCode: failure.code,
    message: failure.message,
    ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
  };
  recordFailure(context.options.runId, context.job.jobId, context.nextArtifactNumber(), raw, {
    ...provenanceFor(context.job, context.options, context.timeoutMs, context.semanticAttempt, raw, false),
    failureKind: 'transport/provider',
    failureCode: failure.code,
    errorMessage: failure.message,
    ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
    issues: [],
  });
};

/**
 * Call the local provider for one semantic attempt, retrying provider (transport/HTTP/
 * response-envelope) failures without consuming semantic retries: after each provider
 * failure the runner polls provider health and reissues the same request until content
 * arrives, provider attempts are exhausted, health does not recover, or the
 * structured-output contract is rejected (a permanent configuration mismatch). Each
 * provider failure writes a failure artifact (continuing per-job artifact numbering) and
 * is appended to reports/provider-events.jsonl. Throws ProviderRunAbortError to stop
 * the run — not just the job — when the provider cannot be recovered within the
 * configured bounds; accepted results stay written, so the same command with --resume
 * can continue once the server is back.
 */
const acquireProviderContent = async (context: ProviderCallContext): Promise<unknown> => {
  const { options, job, chatUrl, timeoutMs, fetchImpl, log } = context;
  const maxProviderAttempts = options.maxProviderAttempts ?? DEFAULT_MAX_PROVIDER_ATTEMPTS;
  const recoveryTimeoutMs = options.providerRecoveryTimeoutMs ?? DEFAULT_PROVIDER_RECOVERY_TIMEOUT_MS;
  const recoveryPollMs = options.providerRecoveryPollMs ?? DEFAULT_PROVIDER_RECOVERY_POLL_MS;
  for (let providerAttempt = 1; ; providerAttempt += 1) {
    const callStartedAt = Date.now();
    let error: unknown;
    try {
      const response = await fetchImpl(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(context.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      log(`HTTP response arrived after ${elapsedMs(callStartedAt)} ms`);
      if (!response.ok) {
        const text = await response.text();
        const unsupported =
          !options.unsafeUnstructured && /schema|response_format|json_schema/i.test(text);
        error = Object.assign(
          new Error(
            unsupported
              ? `Structured output unsupported or rejected by provider: HTTP ${response.status} ${text}`
              : `HTTP ${response.status} ${text}`,
          ),
          { providerHttpStatus: response.status },
        );
        throw error;
      }
      return await parseModelContent(response);
    } catch (caught) {
      error = caught;
    }
    const failure = classifyProviderFailure(error);
    recordProviderFailure(context, failure);
    log(`provider failure (${failure.code}) after ${elapsedMs(callStartedAt)} ms: ${failure.message}`);
    const abortRun = (code: ProviderFailureCode, message: string): never => {
      appendProviderEvent(
        options.runId,
        providerFailureEvent(context, providerAttempt, failure, {
          recovered: false,
          waitedMs: 0,
        }),
      );
      throw new ProviderRunAbortError(code, job.jobId, message);
    };
    if (failure.message.startsWith('Structured output unsupported'))
      return abortRun(
        failure.code,
        `Structured output is the safe default and ${options.baseUrl} rejected it; no result is written. ${failure.message}`,
      );
    if (providerAttempt >= maxProviderAttempts)
      return abortRun(
        failure.code,
        `Provider failed ${providerAttempt} times for ${job.jobId} (${failure.code}); the run is aborted so the same command with --resume can continue after the provider is restored. ${failure.message}`,
      );
    const health = await waitForProviderHealth({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetchImpl,
      timeoutMs: recoveryTimeoutMs,
      pollIntervalMs: recoveryPollMs,
      log,
    });
    appendProviderEvent(
      options.runId,
      providerFailureEvent(context, providerAttempt, failure, {
        recovered: health.recovered,
        waitedMs: health.waitedMs,
      }),
    );
    if (!health.recovered)
      throw new ProviderRunAbortError(
        'PROVIDER_RECOVERY_TIMEOUT',
        job.jobId,
        `Provider health did not recover within ${health.waitedMs} ms for ${job.jobId}; the run is aborted so the same command with --resume can continue after the provider is restored.`,
      );
  }
};

const omittedSamplerValue = (): OmittedSamplerValue => ({ value: null, source: 'omitted-request' });

const resolvedInferenceConfig = (
  job: AiStudyMapJob,
  options: RunnerOptions,
  timeoutMs: number,
): ResolvedInferenceConfig => {
  const systemPrompt = promptForJob(job)[0]?.content ?? '';
  const structuredOutputMode = options.unsafeUnstructured
    ? 'unsafe-json-object'
    : 'strict-json-schema';
  return {
    provider: {
      kind: 'local-openai-compatible',
      baseUrl: options.baseUrl,
      endpoint: `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      baseUrlSource: options.baseUrlSource ?? 'unknown',
    },
    model: { id: options.model, source: options.modelSource ?? 'unknown' },
    reasoningEffort: {
      value: options.reasoningEffort ?? null,
      source:
        options.reasoningEffortSource ?? (options.reasoningEffort ? 'unknown' : 'omitted-request'),
    },
    sampler: {
      temperature: omittedSamplerValue(),
      topP: omittedSamplerValue(),
      topK: omittedSamplerValue(),
      minP: omittedSamplerValue(),
      presencePenalty: omittedSamplerValue(),
      repetitionPenalty: omittedSamplerValue(),
      repeatPenalty: omittedSamplerValue(),
      maxTokens: omittedSamplerValue(),
    },
    execution: {
      timeoutMs: { value: timeoutMs, source: options.timeoutMsSource ?? 'unknown' },
      maxRetries: { value: options.maxRetries, source: options.maxRetriesSource ?? 'unknown' },
      concurrency: { value: options.concurrency, source: options.concurrencySource ?? 'unknown' },
    },
    structuredOutput: {
      mode: structuredOutputMode,
      strict: !options.unsafeUnstructured,
      responseSchemaSha256: hashText(JSON.stringify(STUDY_MAP_V3_LOCAL_RESULT_SCHEMA)),
    },
    prompts: {
      systemPromptSha256: hashText(systemPrompt),
      promptSpecVersion: job.promptSpecVersion,
    },
  };
};

export const runLocalMapAuthoring = async (
  options: RunnerOptions,
  fetchImpl: FetchLike = fetch,
): Promise<LocalMapAuthoringResult> => {
  if (!options.unsafeUnstructured && !STUDY_MAP_V3_LOCAL_RESULT_SCHEMA)
    throw new Error('Structured output schema is required.');
  if (options.concurrency !== 1)
    throw new Error('Only concurrency 1 is supported for local map authoring.');
  const batchJobs = loadBatchJobs(options.runId, options.batch);
  const jobs = applySelection(batchJobs, options);
  const allRunJobs = options.batch ? loadBatchJobs(options.runId) : batchJobs;
  const log = options.log ?? console.log;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_AUTHOR_TIMEOUT_MS;
  const chatUrl = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  mkdirSync(join(RUNS_DIR, options.runId, 'results'), { recursive: true });
  if (!options.dryRun) validateRunMetadata(options, loadRunIdentity(options));
  const accepted = readJsonl<AiStudyMapResult>(resultPath(options.runId));
  validateExistingResults(accepted, allRunJobs, options);
  const acceptedIds = new Set(accepted.map((result) => result.jobId));
  let skipped = 0;
  let semanticFailed = 0;
  let acceptedCount = 0;
  let providerAbort: LocalMapAuthoringResult['providerAbort'];
  try {
    for (const [jobIndex, job] of jobs.entries()) {
      log(`[${jobIndex + 1}/${jobs.length}] ${job.jobId}`);
      if (acceptedIds.has(job.jobId)) {
        skipped += 1;
        continue;
      }
      if (options.dryRun) continue;
      let retry: { note: string; errorCodes: string[] } | undefined;
      let written = false;
      let artifactNumber = nextFailureArtifactNumber(options.runId, job.jobId);
      const attemptLimit = options.maxRetries + 1;
      for (let semanticAttempt = 1; semanticAttempt <= attemptLimit; semanticAttempt += 1) {
        const context: ProviderCallContext = {
          options,
          job,
          chatUrl,
          timeoutMs,
          fetchImpl,
          log,
          body: requestBody(job, options, retry?.note),
          semanticAttempt,
          nextArtifactNumber: (): number => artifactNumber++,
        };
        log(`attempt ${semanticAttempt}/${attemptLimit} started`);
        const raw = await acquireProviderContent(context);
        const validation = validateLocalResult(raw, job);
        log(`validation ${validation.result ? 'accepted' : 'rejected'}`);
        const provenance = provenanceFor(
          job,
          options,
          timeoutMs,
          semanticAttempt,
          raw,
          Boolean(validation.result),
        );
        if (validation.result) {
          accepted.push(validation.result);
          writeJsonlAtomic(resultPath(options.runId), accepted);
          writeJson(
            join(RUNS_DIR, options.runId, 'results', `${job.jobId}.provenance.json`),
            provenance,
          );
          acceptedIds.add(job.jobId);
          acceptedCount += 1;
          written = true;
          break;
        }
        recordFailure(options.runId, job.jobId, context.nextArtifactNumber(), raw, {
          ...provenance,
          issues: validation.issues,
        });
        retry = retryStateFor(validation.report?.issues ?? [], raw, retry?.errorCodes);
      }
      if (!written) semanticFailed += 1;
    }
  } catch (error) {
    if (!(error instanceof ProviderRunAbortError)) throw error;
    providerAbort = { code: error.code, jobId: error.jobId, message: error.message };
    log(`RUN INCOMPLETE: ${error.message}`);
  }
  return {
    accepted: acceptedCount,
    semanticFailed,
    providerIncomplete: providerAbort
      ? jobs.filter((job) => !acceptedIds.has(job.jobId)).length
      : 0,
    skipped,
    dryRunJobs: options.dryRun ? jobs.length - skipped : 0,
    ...(providerAbort ? { providerAbort } : {}),
  };
};

export const __studyAiLocalMapAuthorTest = {
  optionsFromArgs,
  parseRawArgs,
  validateExistingResults,
  withRunnerIdentity,
};

export const LOCAL_MAP_AUTHOR_HELP = `studyAiLocalMapAuthor.ts — Study Map V3 local authoring runner

Usage:
  npx tsx scripts/studyAiLocalMapAuthor.ts --run <run-id> --model <model> [options]

Required:
  --run <run-id>                  Run id under study-content/ai/runs/
  --model <model>                 Provider model id (or STUDY_AI_MODEL)

Options:
  --base-url <url>                Local OpenAI-compatible base URL (default http://127.0.0.1:1234/v1, or STUDY_AI_BASE_URL)
  --api-key <key>                 Optional bearer key (or STUDY_AI_API_KEY)
  --comparison-set <path>         Restrict the run to the job ids in a comparison set
  --job <job-id>                  Restrict the run to one job id
  --batch <n>                     Restrict the run to one batch file
  --resume                        Skip accepted results after validating run identity
  --max-retries <n>               Semantic retries per job after the initial attempt (default 2)
  --timeout-ms <ms>               Per-request timeout (default 600000, or STUDY_AI_TIMEOUT_MS)
  --reasoning-effort <level>      Optional provider reasoning effort
  --max-provider-attempts <n>     Provider calls per semantic attempt before aborting the run (default 3)
  --provider-recovery-timeout-ms <ms>  Max wait for provider health after a failure (default 300000)
  --provider-recovery-poll-ms <ms>     Provider health poll interval (default 5000)
  --dry-run                       Validate configuration without calling the provider
  --unsafe-unstructured           Use json_object instead of the strict json_schema contract
  --help                          Show this help

Provider failures:
  Transport, HTTP, timeout, and response-envelope failures are provider failures, not
  semantic validation failures. They never consume --max-retries attempts and never
  become semantic permanent failures. After each provider failure the runner polls
  GET <base-url>/models until the provider is healthy and reissues the same semantic
  attempt. If the provider does not recover within --provider-recovery-timeout-ms,
  exceeds --max-provider-attempts, or rejects the structured-output contract, the run
  is aborted with exit code 1 and remaining jobs marked provider-incomplete; accepted
  results are preserved, and rerunning the same command with --resume continues
  where the run stopped.

Artifacts:
  results/local-map.results.jsonl   Accepted results (canonical)
  results/<jobId>.provenance.json  Per-job accepted-attempt provenance
  local-failures/<jobId>/attempt-N.*  Numbered failure artifacts (semantic + provider)
  reports/local-run-metadata.json   Run identity (model, comparison set, jobs hashes)
  reports/provider-events.jsonl     Append-only provider failure/recovery telemetry
`;

const main = async (): Promise<void> => {
  const rawArgs = parseArgs();
  if (rawArgs.help) {
    console.log(LOCAL_MAP_AUTHOR_HELP.trimEnd());
    return;
  }
  const options = optionsFromArgs(rawArgs);
  if (!options.runId || !options.model)
    throw new Error('--run and --model/STUDY_AI_MODEL are required. Run with --help for options.');
  const result = await runLocalMapAuthoring(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.providerAbort) process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiLocalMapAuthor.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
