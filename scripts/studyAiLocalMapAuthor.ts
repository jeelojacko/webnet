import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import { STUDY_MAP_V3_RESULT_SCHEMA } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';

const RUNS_DIR = 'study-content/ai/runs';

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
        json_schema: { name: string; strict: true; schema: typeof STUDY_MAP_V3_RESULT_SCHEMA };
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
  log?: (_message: string) => void;
};

const DEFAULT_LOCAL_AUTHOR_TIMEOUT_MS = 600_000;

type RequestInitLike = {
  method: string;
  headers: Record<string, string>;
  body: string;
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
        .map((line, index) =>
          parseJson<T>(index === 0 ? line.replace(/^\uFEFF/, '') : line, `${path}:${index + 1}`),
        )
    : [];

const writeJsonlAtomic = (path: string, rows: unknown[]): void => {
  const tempPath = `${path}.tmp`;
  writeFileSync(
    tempPath,
    rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
  );
  renameSync(tempPath, path);
};

const loadBatchJobs = (runId: string, batch?: string): AiStudyMapJob[] => {
  const jobsDir = join(RUNS_DIR, runId, 'jobs');
  const file = batch ? `batch-${batch.padStart(3, '0')}.jobs.jsonl` : '';
  if (file) return readJsonl<AiStudyMapJob>(join(jobsDir, file));
  const manifest = readJson<{ batchCount: number }>(
    join(RUNS_DIR, runId, 'reports', 'batch-manifest.json'),
  );
  return Array.from({ length: manifest.batchCount }, (_, index) =>
    readJsonl<AiStudyMapJob>(
      join(jobsDir, `batch-${String(index + 1).padStart(3, '0')}.jobs.jsonl`),
    ),
  ).flat();
};

const selectJobs = (options: RunnerOptions): AiStudyMapJob[] => {
  const allJobs = loadBatchJobs(options.runId, options.batch);
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

const acceptedJobIds = (runId: string): Set<string> =>
  new Set(readJsonl<AiStudyMapResult>(resultPath(runId)).map((result) => result.jobId));

const promptForJob = (job: AiStudyMapJob): ChatMessage[] => [
  {
    role: 'system',
    content: [
      'You are a Study Map V3 authoring assistant.',
      'Use only the supplied official source as authoritative.',
      'Context is for understanding only and is not evidence unless its sourceKey is included in a proposed group.',
      "Choose the disposition from the source's study value first: map substantive legal duties, powers, procedures, rights, prohibitions, criteria, or effects as standalone/split; use skip only for material with no useful independent study value.",
      'Administrative, procedural, institutional, government-directed, short, or single-section provisions are not skip reasons by themselves.',
      'The requiredResultIdentity values in the user message are input metadata to copy into the matching output identity fields; requiredResultIdentity is not an output field and must not affect the semantic disposition decision.',
      'Return exactly one JSON object matching the supplied Study Map V3 schema.',
    ].join('\n'),
  },
  {
    role: 'user',
    content: JSON.stringify({
      job,
      requiredResultIdentity: {
        schemaVersion: 1,
        jobId: job.jobId,
        runId: job.runId,
        corpusContentHash: job.corpusContentHash,
        inputHash: job.inputHash,
        promptSpecVersion: job.promptSpecVersion,
        authoringInputFingerprint: authoringInputFingerprint(job),
      },
    }),
  },
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
          name: 'study_map_v3_result',
          strict: true,
          schema: STUDY_MAP_V3_RESULT_SCHEMA,
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

const validateLocalResult = (
  value: unknown,
  job: AiStudyMapJob,
): { result?: AiStudyMapResult; issues: string[] } => {
  const report = validateAiStudyMapResult(value, job);
  const result = value as Partial<AiStudyMapResult>;
  const issues = report.issues.map((issue) => `${issue.code}: ${issue.message}`);
  if (
    result.authoringInputFingerprint &&
    result.authoringInputFingerprint !== authoringInputFingerprint(job)
  ) {
    issues.push('AUTHORING_FINGERPRINT_MISMATCH: Result fingerprint does not match the job.');
  }
  return report.valid &&
    issues.length === report.issues.filter((issue) => issue.severity === 'warning').length
    ? { result: value as AiStudyMapResult, issues }
    : { issues };
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

const transportFailureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const transportFailureArtifact = (
  message: string,
): { failureKind: 'transport/provider'; message: string } => ({
  failureKind: 'transport/provider',
  message,
});

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
      responseSchemaSha256: hashText(JSON.stringify(STUDY_MAP_V3_RESULT_SCHEMA)),
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
): Promise<{ accepted: number; failed: number; skipped: number; dryRunJobs: number }> => {
  if (!options.unsafeUnstructured && !STUDY_MAP_V3_RESULT_SCHEMA)
    throw new Error('Structured output schema is required.');
  if (options.concurrency !== 1)
    throw new Error('Only concurrency 1 is supported for local map authoring.');
  const jobs = selectJobs(options);
  const log = options.log ?? console.log;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_AUTHOR_TIMEOUT_MS;
  mkdirSync(join(RUNS_DIR, options.runId, 'results'), { recursive: true });
  const accepted = readJsonl<AiStudyMapResult>(resultPath(options.runId));
  const acceptedIds = options.resume
    ? new Set(accepted.map((result) => result.jobId))
    : acceptedJobIds(options.runId);
  let skipped = 0;
  let failed = 0;
  let acceptedCount = 0;
  for (const [jobIndex, job] of jobs.entries()) {
    log(`[${jobIndex + 1}/${jobs.length}] ${job.jobId}`);
    if (acceptedIds.has(job.jobId)) {
      skipped += 1;
      continue;
    }
    if (options.dryRun) continue;
    let retryNote: string | undefined;
    let written = false;
    for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
      const body = requestBody(job, options, retryNote);
      const attemptLimit = options.maxRetries + 1;
      log(`attempt ${attempt}/${attemptLimit} started`);
      let raw: unknown;
      let transportError: string | undefined;
      const attemptStartedAt = Date.now();
      try {
        const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        log(`HTTP response arrived after ${elapsedMs(attemptStartedAt)} ms`);
        if (!response.ok) {
          const text = await response.text();
          if (!options.unsafeUnstructured && /schema|response_format|json_schema/i.test(text)) {
            throw new Error(
              `Structured output unsupported or rejected by provider: HTTP ${response.status} ${text}`,
            );
          }
          throw new Error(`HTTP ${response.status} ${text}`);
        }
        raw = await parseModelContent(response);
      } catch (error) {
        transportError = transportFailureMessage(error);
        raw = transportFailureArtifact(transportError);
        log(
          `transport/provider failure after ${elapsedMs(attemptStartedAt)} ms: ${transportError}`,
        );
      }
      const validation: { result?: AiStudyMapResult; issues: string[] } = transportError
        ? { issues: [] }
        : validateLocalResult(raw, job);
      if (!transportError) log(`validation ${validation.result ? 'accepted' : 'rejected'}`);
      const provenance = {
        providerKind: 'local-openai-compatible',
        modelId: options.model,
        runId: options.runId,
        jobId: job.jobId,
        authoringInputFingerprint: authoringInputFingerprint(job),
        sourceHashes: job.target.sourceHashes,
        attempt,
        timestamp: new Date().toISOString(),
        structuredOutputMode: options.unsafeUnstructured
          ? 'unsafe-json-object'
          : 'strict-json-schema',
        resolvedInferenceConfig: resolvedInferenceConfig(job, options, timeoutMs),
        rawHash: hashText(JSON.stringify(raw)),
        accepted: Boolean(validation.result),
      };
      if (validation.result) {
        accepted.push({
          ...validation.result,
          authoringInputFingerprint: authoringInputFingerprint(job),
        });
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
      recordFailure(options.runId, job.jobId, attempt, raw, {
        ...provenance,
        ...(transportError
          ? { failureKind: 'transport/provider', errorMessage: transportError }
          : {}),
        issues: validation.issues,
      });
      retryNote = transportError
        ? undefined
        : 'The previous response failed validation. Regenerate the entire response as one JSON object that exactly matches the supplied schema and job identity.';
    }
    if (!written) failed += 1;
  }
  return {
    accepted: acceptedCount,
    failed,
    skipped,
    dryRunJobs: options.dryRun ? jobs.length - skipped : 0,
  };
};

export const __studyAiLocalMapAuthorTest = {
  optionsFromArgs,
  parseRawArgs,
};

const main = async (): Promise<void> => {
  const options = optionsFromArgs(parseArgs());
  if (!options.runId || !options.model)
    throw new Error('--run and --model/STUDY_AI_MODEL are required.');
  const result = await runLocalMapAuthoring(options);
  console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1]?.endsWith('studyAiLocalMapAuthor.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
