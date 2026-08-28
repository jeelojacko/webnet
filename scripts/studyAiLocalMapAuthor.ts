import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AiStudyMapJob,
  AiStudyMapResult,
  AiValidationIssue,
  AiValidationReport,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import { STUDY_MAP_V3_RESULT_SCHEMA } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';

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

/**
 * Concise, code-specific explanations of deterministic validator requirements.
 * The actual semantic correction remains model-generated; this only states
 * what the validator mechanically requires.
 */
const RETRY_INSTRUCTIONS: Record<string, string> = {
  SUGGESTED_PRIORITY_REQUIRED:
    'Include top-level suggestedPriority with exactly one of P1, P2, P3, or P4 because proposedGroups is non-empty.',
  STANDALONE_GROUP_COUNT: 'standalone requires exactly one proposedGroup.',
  SPLIT_GROUP_COUNT: 'split requires at least two proposedGroups.',
  DUPLICATE_FOCUS_CHILD_LABEL:
    'Make sibling group focus selections disjoint for the duplicated source focus.',
  DUPLICATE_FOCUS_DEFINED_TERM:
    'Make sibling group focus selections disjoint for the duplicated source focus.',
  OPAQUE_WARNING_CODE:
    'Replace opaque warning codes with a self-describing SCREAMING_SNAKE code.',
};

/** Ordinary Study Map responses fit easily; cap only pathological invalid responses. */
const MAX_RETRY_RESPONSE_CHARS = 12_000;

const retryResponseText = (value: unknown): string => {
  let text = 'null';
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) text = serialized;
  } catch {
    text = String(value);
  }
  return text.length > MAX_RETRY_RESPONSE_CHARS
    ? `${text.slice(0, MAX_RETRY_RESPONSE_CHARS)} … [truncated for retry context]`
    : text;
};

/**
 * Build retry feedback so the model can correct its own previous invalid JSON
 * instead of regenerating the whole map decision from scratch. The retry shows
 * the bounded previous response (JSON only, no provider wrapper), the exact
 * validation error codes/messages, a concise fix per deterministic error code,
 * and an explicit mandatory restatement when the same error repeated.
 */
export const buildValidationRetryNote = (
  issues: readonly AiValidationIssue[],
  previousResponse: unknown,
  previousErrorCodes: readonly string[] = [],
): string => {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const lines = [
    'Correct the previous response. Preserve valid semantic decisions unless a validation issue requires changing them. Return the complete corrected JSON object that exactly matches the supplied schema.',
    '',
    'Previous invalid response (JSON only):',
    retryResponseText(previousResponse),
  ];
  if (errors.length === 0) {
    return `${lines.join('\n')}\n\nThe previous response failed validation. Apply the correction and return the complete corrected JSON object.`;
  }
  const body = errors
    .slice(0, 8)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(' ');
  lines.push('', `The previous response failed validation with: ${body}`);
  const fixes = errors
    .slice(0, 8)
    .map((issue) => {
      const instruction = RETRY_INSTRUCTIONS[issue.code];
      const repeated = previousErrorCodes.includes(issue.code)
        ? ` The previous attempt also produced ${issue.code}; this requirement is mandatory for this result.`
        : '';
      return instruction
        ? `- ${issue.code}: ${instruction}${repeated}`
        : `- ${issue.code}: ${issue.message}${repeated}`;
    });
  lines.push('', 'Required fixes (the semantic correction itself is yours to make):', ...fixes);
  return lines.join('\n');
};

const retryStateFor = (
  issues: readonly AiValidationIssue[],
  rawResponse: unknown,
  previousErrorCodes: readonly string[] | undefined,
): { note: string; errorCodes: string[] } => {
  const errorCodes = issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  return { note: buildValidationRetryNote(issues, rawResponse, previousErrorCodes), errorCodes };
};

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
const withRunnerIdentity = (value: Record<string, unknown>, job: AiStudyMapJob): AiStudyMapResult =>
  ({
    ...(value as Partial<AiStudyMapResult>),
    schemaVersion: 1,
    jobId: job.jobId,
    runId: job.runId,
    corpusContentHash: job.corpusContentHash,
    inputHash: job.inputHash,
    authoringInputFingerprint: authoringInputFingerprint(job),
    promptSpecVersion: job.promptSpecVersion,
  }) as AiStudyMapResult;

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
): Promise<{ accepted: number; failed: number; skipped: number; dryRunJobs: number }> => {
  if (!options.unsafeUnstructured && !STUDY_MAP_V3_LOCAL_RESULT_SCHEMA)
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
    let retry: { note: string; errorCodes: string[] } | undefined;
    let written = false;
    for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
      const body = requestBody(job, options, retry?.note);
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
      const validation: {
        result?: AiStudyMapResult;
        issues: string[];
        report?: AiValidationReport;
      } = transportError ? { issues: [] } : validateLocalResult(raw, job);
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
      recordFailure(options.runId, job.jobId, attempt, raw, {
        ...provenance,
        ...(transportError
          ? { failureKind: 'transport/provider', errorMessage: transportError }
          : {}),
        issues: validation.issues,
      });
      retry = transportError
        ? undefined
        : retryStateFor(validation.report?.issues ?? [], raw, retry?.errorCodes);
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
