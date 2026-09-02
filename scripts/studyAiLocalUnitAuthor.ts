import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';
import type {
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
  AiValidationReport,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import {
  UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA,
  UNIT_AUTHORING_V4_LOCAL_SCHEMA_NAME,
} from '../src/study/ai/studyAiUnitLocalSchema';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import {
  RUNS_DIR,
  loadBatchJobs,
  readJson,
  readJsonl,
  writeJson,
  writeJsonlAtomic,
  hashText,
  ProviderRunAbortError,
} from './studyAiLocalMapAuthor';
import { retryStateFor } from './studyAiLocalMapAuthorRetry';
import {
  classifyProviderFailure,
  type ProviderFailure,
  type ProviderFailureCode,
} from './studyAiProviderFailures';
import { waitForProviderHealth, type FetchLike } from './studyAiProviderRecovery';

export { hashText, readJson, readJsonl, writeJson, writeJsonlAtomic };

export const UNIT_AUTHORING_V4_SPEC_PATH = 'study-content/ai/specs/unit-authoring-v4.md';
export const UNIT_AUTHORING_V4_SPEC_VERSION = 'unit-authoring-v4';
export const DEFAULT_UNIT_AUTHORING_PACKAGE =
  'study-content/packages/nb-sit-statute-corpus.content-package.json';
export const LOCAL_UNIT_RESULTS_FILE = 'local-unit.results.jsonl';

const DEFAULT_LOCAL_UNIT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_PROVIDER_ATTEMPTS = 3;
const DEFAULT_PROVIDER_RECOVERY_TIMEOUT_MS = 300_000;
const DEFAULT_PROVIDER_RECOVERY_POLL_MS = 5_000;
const HEALTH_PREFLIGHT_TIMEOUT_MS = 15_000;
const FROZEN_PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4']);

type ConfigSource = 'cli' | 'env' | 'default' | 'omitted-request' | 'unknown';
type ResolvedConfigValue<T> = { value: T; source: ConfigSource };
type OmittedSamplerValue = ResolvedConfigValue<null>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ChatMessage = { role: 'system' | 'user'; content: string };
type UnitRequestBody = {
  model: string;
  messages: ChatMessage[];
  reasoning_effort?: string;
  response_format:
    | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: Record<string, unknown> } }
    | { type: 'json_object' };
};

export type RunnerOptions = {
  runId: string;
  model: string;
  modelSource?: ConfigSource;
  baseUrl: string;
  baseUrlSource?: ConfigSource;
  apiKey?: string;
  package: string;
  packageSource?: ConfigSource;
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
  noHealthPreflight: boolean;
  unsafeUnstructured: boolean;
  maxProviderAttempts?: number;
  providerRecoveryTimeoutMs?: number;
  providerRecoveryPollMs?: number;
  /** Test seam only (no CLI flag): parent of the run dir, default RUNS_DIR. */
  runsDir?: string;
  log?: (_message: string) => void;
};

export type LocalUnitAuthoringResult = {
  accepted: number;
  semanticFailed: number;
  providerIncomplete: number;
  skipped: number;
  dryRunJobs: number;
  providerAbort?: { code: ProviderFailureCode; jobId: string; message: string };
};

export type LocalUnitDryRunSummary = {
  runId: string;
  model: string;
  baseUrl: string;
  batch: string | null;
  package: string;
  promptSpecVersion: string;
  promptSha256: string;
  selectedJobs: number;
  firstJobIds: string[];
};

type LocalUnitRunMetadata = {
  schemaVersion: 1;
  runId: string;
  model: string;
  baseUrl: string;
  packagePath: string;
  promptSpecVersion: string;
  promptSha256: string;
  batch: string | null;
  concurrency: number;
  jobCount: number;
  jobIds: string[];
  jobsFileSha256: Record<string, string>;
  createdAt: string;
};

type RunIdentity = { jobIds: string[]; jobsFileSha256: Record<string, string> };
type ResolvedInferenceConfig = {
  provider: { kind: 'local-openai-compatible'; baseUrl: string; endpoint: string; baseUrlSource: ConfigSource };
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

type ProviderCallContext = {
  options: RunnerOptions;
  job: AiUnitAuthoringJob;
  chatUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  log: (_message: string) => void;
  body: UnitRequestBody;
  spec: string;
  semanticAttempt: number;
  nextArtifactNumber: () => number;
};

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

const parseArgs = (): Record<string, string | boolean> => parseRawArgs(process.argv.slice(2));

const parsePositiveIntOption = (
  value: string | boolean | undefined,
  source: string,
): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${source} must be a positive integer.`);
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
  if (env.STUDY_AI_TIMEOUT_MS !== undefined) return parseTimeoutMs(env.STUDY_AI_TIMEOUT_MS, 'STUDY_AI_TIMEOUT_MS');
  return DEFAULT_LOCAL_UNIT_TIMEOUT_MS;
};

const reasoningEffortFrom = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
): string | undefined => {
  if (args['reasoning-effort'] !== undefined) {
    if (typeof args['reasoning-effort'] !== 'string' || args['reasoning-effort'].trim().length === 0)
      throw new Error('--reasoning-effort must be a non-empty string.');
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

const sourceFor = (cli: boolean, envValue: string | undefined): ConfigSource =>
  cli ? 'cli' : envValue !== undefined ? 'env' : 'default';

export const optionsFromArgs = (
  args: Record<string, string | boolean>,
  env: Record<string, string | undefined> = process.env,
): RunnerOptions => ({
  runId: String(args.run ?? ''),
  model: String(args.model ?? env.STUDY_AI_MODEL ?? ''),
  modelSource: sourceFor(args.model !== undefined, env.STUDY_AI_MODEL),
  baseUrl: String(args['base-url'] ?? env.STUDY_AI_BASE_URL ?? 'http://127.0.0.1:8080/v1'),
  baseUrlSource: sourceFor(args['base-url'] !== undefined, env.STUDY_AI_BASE_URL),
  apiKey: args['api-key'] ? String(args['api-key']) : env.STUDY_AI_API_KEY,
  package: String(args.package ?? DEFAULT_UNIT_AUTHORING_PACKAGE),
  packageSource: sourceFor(args.package !== undefined, undefined),
  comparisonSet: args['comparison-set'] ? String(args['comparison-set']) : undefined,
  jobId: args.job ? String(args.job) : undefined,
  batch: args.batch ? String(args.batch) : undefined,
  resume: Boolean(args.resume),
  concurrency: Number(args.concurrency ?? 1),
  concurrencySource: args.concurrency !== undefined ? 'cli' : 'default',
  maxRetries: Number(args['max-retries'] ?? 2),
  maxRetriesSource: args['max-retries'] !== undefined ? 'cli' : 'default',
  timeoutMs: timeoutMsFrom(args, env),
  timeoutMsSource:
    args['timeout-ms'] !== undefined ? 'cli' : env.STUDY_AI_TIMEOUT_MS !== undefined ? 'env' : 'default',
  reasoningEffort: reasoningEffortFrom(args, env),
  reasoningEffortSource: reasoningEffortSourceFrom(args, env),
  dryRun: Boolean(args['dry-run']),
  noHealthPreflight: Boolean(args['no-health-preflight']),
  unsafeUnstructured: Boolean(args['unsafe-unstructured']),
  maxProviderAttempts: parsePositiveIntOption(args['max-provider-attempts'], '--max-provider-attempts'),
  providerRecoveryTimeoutMs: parsePositiveIntOption(
    args['provider-recovery-timeout-ms'],
    '--provider-recovery-timeout-ms',
  ),
  providerRecoveryPollMs: parsePositiveIntOption(args['provider-recovery-poll-ms'], '--provider-recovery-poll-ms'),
});

const runDirOf = (runsDir: string, runId: string): string => join(runsDir, runId);

export const loadUnitAuthoringV4Spec = (specPath: string = UNIT_AUTHORING_V4_SPEC_PATH): string => {
  if (!existsSync(specPath)) throw new Error(`Unit Authoring V4 spec not found at ${specPath}.`);
  const text = readFileSync(specPath, 'utf8');
  if (!text.trim()) throw new Error(`Unit Authoring V4 spec is empty at ${specPath}.`);
  return text;
};

/** Fail-closed gate: run.json must be a prepared unit-authoring run identity. */
const assertRunJson = (options: RunnerOptions, runsDir: string): void => {
  const path = join(runDirOf(runsDir, options.runId), 'run.json');
  if (!existsSync(path)) throw new Error(`Refusing to run ${options.runId}: no run.json found at ${path}.`);
  const run = readJson<Record<string, unknown>>(path);
  const quote = (value: unknown): string => JSON.stringify(value ?? null);
  if (run.jobType !== 'unit-authoring')
    throw new Error(
      `Refusing to run ${options.runId}: run.json jobType is ${quote(run.jobType)}; this runner executes only unit-authoring runs — a 'study-map' run must use studyAiLocalMapAuthor.ts.`,
    );
  if (run.providerKind !== 'local-openai-compatible')
    throw new Error(
      `Refusing to run ${options.runId}: run.json providerKind is ${quote(run.providerKind)}; only 'local-openai-compatible' is supported by this runner.`,
    );
  if (run.promptSpecVersion !== UNIT_AUTHORING_V4_SPEC_VERSION)
    throw new Error(
      `Refusing to run ${options.runId}: run.json promptSpecVersion is ${quote(run.promptSpecVersion)}; this runner executes only ${UNIT_AUTHORING_V4_SPEC_VERSION}.`,
    );
  if (run.runId !== options.runId)
    throw new Error(
      `Refusing to run ${options.runId}: run.json runId ${quote(run.runId)} does not match --run ${options.runId}.`,
    );
  if (typeof run.corpusContentHash !== 'string' || run.corpusContentHash.trim().length === 0)
    throw new Error(`Refusing to run ${options.runId}: run.json corpusContentHash is missing.`);
};

const loadContentPackage = (path: string): NbLawContentPackage => {
  if (!existsSync(path)) throw new Error(`Unit Authoring content package not found at ${path}.`);
  const pkg = readJson<NbLawContentPackage>(path);
  if (!Array.isArray(pkg.documents)) throw new Error(`Content package at ${path} has no documents array.`);
  return pkg;
};

const unitJobsDir = (runsDir: string, runId: string): string => join(runDirOf(runsDir, runId), 'jobs');

/** Unit runs write batch-NNN.jobs.jsonl slices but no reports/batch-manifest.json. */
export const unitBatchJobFiles = (
  runId: string,
  batch: string | undefined,
  runsDir: string = RUNS_DIR,
): string[] => {
  const jobsDir = unitJobsDir(runsDir, runId);
  if (batch) return [join(jobsDir, `batch-${batch.padStart(3, '0')}.jobs.jsonl`)];
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir)
    .filter((file) => /^batch-\d{3}\.jobs\.jsonl$/.test(file))
    .sort()
    .map((file) => join(jobsDir, file));
};

/**
 * Load unit jobs. With --batch, delegate to the map runner's exported
 * loadBatchJobs (identical file semantics); without a batch, enumerate the
 * run's batch files because prepared unit runs have no batch-manifest.json.
 */
const loadUnitJobs = (runId: string, batch: string | undefined, runsDir: string): AiUnitAuthoringJob[] => {
  const files = unitBatchJobFiles(runId, batch, runsDir);
  if (batch) {
    if (!existsSync(files[0] ?? '')) throw new Error(`Batch file not found: ${files[0] ?? ''}.`);
    return loadBatchJobs(runId, batch, runsDir) as unknown as AiUnitAuthoringJob[];
  }
  if (files.length === 0)
    throw new Error(`No unit-authoring job batch files found under ${unitJobsDir(runsDir, runId)}.`);
  return files.flatMap((file) => readJsonl<AiUnitAuthoringJob>(file));
};

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every job the runner will author must carry the unit-job authoring shape. */
const assertUnitJobShape = (job: AiUnitAuthoringJob, options: RunnerOptions, file: string): void => {
  const id = typeof job.jobId === 'string' && job.jobId ? job.jobId : '<missing jobId>';
  const where = `job ${id} in ${file}`;
  if (job.runId !== options.runId)
    throw new Error(
      `Refusing to run ${options.runId}: ${where} belongs to run ${job.runId ?? '<missing>'}; expected ${options.runId}.`,
    );
  if (!isPlainObject(job.approvedGroup) || !Array.isArray(job.approvedGroup.sourceKeys))
    throw new Error(
      `Refusing to run ${options.runId}: ${where} is not a unit-authoring job (missing approvedGroup.sourceKeys); map-shaped jobs are rejected here.`,
    );
  if (typeof job.exactSourceText !== 'string' || job.exactSourceText.trim().length === 0)
    throw new Error(`Refusing to run ${options.runId}: ${where} is missing exactSourceText.`);
  if (!FROZEN_PRIORITIES.has(job.frozenMapPriority ?? ''))
    throw new Error(
      `Refusing to run ${options.runId}: ${where} has no frozenMapPriority P1-P4 (${JSON.stringify(job.frozenMapPriority ?? null)}).`,
    );
  if (typeof job.inputHash !== 'string' || job.inputHash.length === 0)
    throw new Error(`Refusing to run ${options.runId}: ${where} is missing inputHash.`);
  if (typeof job.corpusContentHash !== 'string' || job.corpusContentHash.length === 0)
    throw new Error(`Refusing to run ${options.runId}: ${where} is missing corpusContentHash.`);
};

const gateUnitJobs = (jobs: AiUnitAuthoringJob[], options: RunnerOptions, runsDir: string): void => {
  const fileByJob = new Map<string, string>();
  unitBatchJobFiles(options.runId, options.batch, runsDir).forEach((file) => {
    readJsonl<{ jobId?: unknown }>(file).forEach((row) => {
      if (typeof row.jobId === 'string' && row.jobId && !fileByJob.has(row.jobId))
        fileByJob.set(row.jobId, file);
    });
  });
  jobs.forEach((job) => assertUnitJobShape(job, options, fileByJob.get(job.jobId) ?? '<unknown>'));
};

const applySelection = (allJobs: AiUnitAuthoringJob[], options: RunnerOptions): AiUnitAuthoringJob[] => {
  const selectedIds = options.comparisonSet
    ? new Set(
        readJson<{ jobs: Array<{ v2JobId: string }> }>(options.comparisonSet).jobs.map((job) => job.v2JobId),
      )
    : undefined;
  return allJobs.filter(
    (job) =>
      (!options.jobId || job.jobId === options.jobId) &&
      (!selectedIds || selectedIds.has(job.jobId)),
  );
};

const resultsPath = (runsDir: string, runId: string): string =>
  join(runDirOf(runsDir, runId), 'results', LOCAL_UNIT_RESULTS_FILE);
const metadataPath = (runsDir: string, runId: string): string =>
  join(runDirOf(runsDir, runId), 'reports', 'local-run-metadata.json');
const providerEventsPath = (runsDir: string, runId: string): string =>
  join(runDirOf(runsDir, runId), 'reports', 'provider-events.jsonl');
const basenameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const loadRunIdentity = (options: RunnerOptions, runsDir: string): RunIdentity => {
  const jobsFileSha256: Record<string, string> = {};
  const jobIds: string[] = [];
  unitBatchJobFiles(options.runId, undefined, runsDir).forEach((file) => {
    jobsFileSha256[basenameOf(file)] = hashText(readFileSync(file, 'utf8'));
    readJsonl<{ jobId?: unknown }>(file).forEach((row) => {
      if (typeof row.jobId === 'string' && row.jobId) jobIds.push(row.jobId);
    });
  });
  return { jobIds, jobsFileSha256 };
};

/**
 * Run identity recorded at first non-dry start and revalidated on every later
 * start: model, base URL, package, prompt spec hash, batch selection, job count,
 * job id list, and every jobs-file hash must match. Fail-closed: a mismatch
 * aborts instead of silently re-authoring a changed corpus into the same
 * result file. A dry run never writes; it only compares when metadata exists.
 */
const validateRunMetadata = (
  options: RunnerOptions,
  identity: RunIdentity,
  promptSha256: string,
  runsDir: string,
  writeIfMissing: boolean,
): void => {
  const path = metadataPath(runsDir, options.runId);
  if (!existsSync(path)) {
    if (!writeIfMissing) return;
    mkdirSync(dirname(path), { recursive: true });
    const metadata: LocalUnitRunMetadata = {
      schemaVersion: 1,
      runId: options.runId,
      model: options.model,
      baseUrl: options.baseUrl,
      packagePath: options.package,
      promptSpecVersion: UNIT_AUTHORING_V4_SPEC_VERSION,
      promptSha256,
      batch: options.batch ?? null,
      concurrency: options.concurrency,
      jobCount: identity.jobIds.length,
      jobIds: identity.jobIds,
      jobsFileSha256: identity.jobsFileSha256,
      createdAt: new Date().toISOString(),
    };
    writeJson(path, metadata);
    return;
  }
  const metadata = readJson<LocalUnitRunMetadata>(path);
  const refuse = (detail: string): never => {
    throw new Error(`Refusing to run ${options.runId}: metadata ${detail}.`);
  };
  const quote = (value: unknown): string => JSON.stringify(value ?? null);
  if (metadata.model !== options.model)
    refuse(`model ${quote(metadata.model)} does not match current model ${quote(options.model)}`);
  if (metadata.baseUrl !== options.baseUrl)
    refuse(`baseUrl ${quote(metadata.baseUrl)} does not match current baseUrl ${quote(options.baseUrl)}`);
  if (metadata.packagePath !== options.package)
    refuse(`content package ${quote(metadata.packagePath)} does not match current package ${quote(options.package)}`);
  if (metadata.promptSpecVersion !== UNIT_AUTHORING_V4_SPEC_VERSION || metadata.promptSha256 !== promptSha256)
    refuse('prompt spec identity does not match the current spec');
  if (metadata.batch !== (options.batch ?? null))
    refuse(`batch selection ${quote(metadata.batch)} does not match current ${quote(options.batch ?? null)}`);
  if (metadata.concurrency !== options.concurrency)
    refuse(`concurrency ${metadata.concurrency} does not match current ${options.concurrency}`);
  if (metadata.jobCount !== identity.jobIds.length)
    refuse(`job count ${metadata.jobCount} does not match current ${identity.jobIds.length}`);
  const sameIds =
    metadata.jobIds.length === identity.jobIds.length &&
    metadata.jobIds.every((id, index) => id === identity.jobIds[index]);
  if (!sameIds) refuse('job id list no longer matches the run batch files');
  for (const [name, expected] of Object.entries(metadata.jobsFileSha256)) {
    const actual = identity.jobsFileSha256[name];
    if (actual !== expected) refuse(`jobs file ${name} hash ${actual ?? 'missing'} does not match metadata ${expected}`);
  }
};

/**
 * Resume integrity on every previously accepted result row. Before any job is
 * skipped, the persisted proposal must match its job exactly (proposalId,
 * runId, corpusContentHash, runner-owned suggestedPriority = frozen priority,
 * generation source input hash). Any mismatch is a hard abort — the runner
 * never silently re-runs over or overwrites a persisted result.
 */
const validateExistingResults = (
  accepted: AiStudyUnitProposal[],
  allRunJobs: AiUnitAuthoringJob[],
  options: RunnerOptions,
): void => {
  if (accepted.length === 0) return;
  const jobById = new Map(allRunJobs.map((job) => [job.jobId, job]));
  const seen = new Set<string>();
  for (const result of accepted) {
    if (seen.has(result.proposalId))
      throw new Error(
        `Refusing to run ${options.runId}: duplicate accepted result for ${result.proposalId} in ${resultsPath(options.runsDir ?? RUNS_DIR, options.runId)}.`,
      );
    seen.add(result.proposalId);
    const job = jobById.get(result.proposalId);
    if (!job)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.proposalId} has no matching job file.`,
      );
    if (result.proposalId !== job.jobId)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result proposalId ${JSON.stringify(result.proposalId)} does not match job ${job.jobId}.`,
      );
    if (result.runId !== job.runId)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.proposalId} has runId ${JSON.stringify(result.runId)}, but its job file belongs to run ${job.runId}.`,
      );
    if (result.corpusContentHash !== job.corpusContentHash)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.proposalId} corpusContentHash does not match its job.`,
      );
    if (result.suggestedPriority !== job.frozenMapPriority)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.proposalId} suggestedPriority ${JSON.stringify(result.suggestedPriority)} does not match frozen map priority ${JSON.stringify(job.frozenMapPriority)}.`,
      );
    if (result.generationMetadata?.sourceJobInputHash !== job.inputHash)
      throw new Error(
        `Refusing to run ${options.runId}: accepted result for ${result.proposalId} generation sourceJobInputHash does not match its job inputHash.`,
      );
  }
};

const RUNNER_NOTES = [
  'RUNNER NOTES (local run only):',
  '- The approvedGroup in the job is the AUTHORING SCOPE; author only within approvedGroup.sourceKeys and its focus.',
  '- suggestedPriority is decided by the frozen Map run and is not yours to set; the runner stamps it.',
  '- Return only the semantic result fields: title, mainQuestion, studySummary, objectives, relatedSourceKeys, studyNotes, sourceCoverage, authoringStatus, mapRevisionSuggestion, confidence, and warnings.',
  '- The runner injects runner-owned identity fields (schemaVersion, proposalId, runId, corpusContentHash, sourceDocumentId, sourceKeys, sourceHashes, approvedGroup, mapDisposition, mapReason, approximateLearningGoal, suggestedPriority, generationMetadata); do not include them.',
  '- Return exactly one JSON object matching the supplied unit-authoring-v4 schema.',
].join('\n');

const promptForJob = (job: AiUnitAuthoringJob, spec: string): ChatMessage[] => [
  { role: 'system', content: `${spec.trimEnd()}\n\n${RUNNER_NOTES}` },
  { role: 'user', content: JSON.stringify({ job }) },
];

const requestBody = (
  job: AiUnitAuthoringJob,
  options: RunnerOptions,
  spec: string,
  retryNote?: string,
): UnitRequestBody => {
  const base = {
    model: options.model,
    messages: retryNote
      ? [...promptForJob(job, spec), { role: 'user' as const, content: retryNote }]
      : promptForJob(job, spec),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
  };
  if (!options.unsafeUnstructured) {
    return {
      ...base,
      response_format: {
        type: 'json_schema',
        json_schema: { name: UNIT_AUTHORING_V4_LOCAL_SCHEMA_NAME, strict: true, schema: UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA },
      },
    };
  }
  return { ...base, response_format: { type: 'json_object' } };
};

const parseModelContent = async (response: Pick<Response, 'json'>): Promise<JsonValue> => {
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | object } }>;
    output_text?: string;
  };
  const content = body.choices?.[0]?.message?.content ?? body.output_text;
  if (typeof content === 'object' && content !== null) return content as JsonValue;
  if (typeof content !== 'string') throw new Error('Provider response did not contain JSON content.');
  try {
    return JSON.parse(content) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in provider response content: ${message}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Group-restricted sourceHashes (historical proposal shape maps sourceKey -> hash). */
const groupSourceHashes = (job: AiUnitAuthoringJob): Record<string, string> => {
  const selected = new Set(job.approvedGroup.sourceKeys);
  return Object.fromEntries(Object.entries(job.sourceHashes).filter(([key]) => selected.has(key)));
};

/** Identity fields are runner-owned: model identity values are always overwritten. */
const withRunnerIdentity = (
  value: Record<string, unknown>,
  job: AiUnitAuthoringJob,
): AiStudyUnitProposal => ({
  ...(value as Partial<AiStudyUnitProposal>),
  schemaVersion: 1,
  proposalId: job.jobId,
  runId: job.runId,
  corpusContentHash: job.corpusContentHash,
  sourceDocumentId: job.document.documentId,
  sourceKeys: [...job.approvedGroup.sourceKeys],
  sourceHashes: groupSourceHashes(job),
  approvedGroup: job.approvedGroup,
  mapDisposition: job.mapDisposition,
  mapReason: job.mapReason,
  approximateLearningGoal: job.approximateLearningGoal,
  suggestedPriority: job.frozenMapPriority ?? null,
  generationMetadata: {
    providerKind: 'local-openai-compatible',
    promptSpecVersion: job.promptSpecVersion,
    generatedAt: new Date().toISOString(),
    sourceJobId: job.jobId,
    sourceJobInputHash: job.inputHash,
    rawResultFile: LOCAL_UNIT_RESULTS_FILE,
  },
} as AiStudyUnitProposal);

export const validateLocalUnitResult = (
  value: unknown,
  job: AiUnitAuthoringJob,
  pkg: NbLawContentPackage,
  corpusContentHash: string,
): { result?: AiStudyUnitProposal; issues: string[]; report?: AiValidationReport } => {
  if (!isRecord(value)) return { issues: ['RESULT_INVALID: Local unit result must be a JSON object.'] };
  const proposal = withRunnerIdentity(value, job);
  let report: AiValidationReport;
  try {
    const sourceComponents = sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys);
    report = validateAiStudyUnitProposal({ proposal, sourceComponents, corpusContentHash });
  } catch (error) {
    // Malformed model output (e.g. missing objectives in unsafe mode) must be a
    // semantic rejection with retry, never a crash that aborts the whole run.
    const message = error instanceof Error ? error.message : String(error);
    report = {
      valid: false,
      issues: [
        {
          code: 'PROPOSAL_VALIDATION_CRASH',
          severity: 'error',
          message: `Unit proposal validation crashed on this response: ${message}`,
        },
      ],
    };
  }
  const issues = report.issues.map((issue) => `${issue.code}: ${issue.message}`);
  return report.valid ? { result: proposal, issues, report } : { issues, report };
};

const failureDir = (runsDir: string, runId: string, jobId: string): string =>
  join(runDirOf(runsDir, runId), 'local-failures', jobId);

const recordFailure = (
  runsDir: string,
  runId: string,
  jobId: string,
  attempt: number,
  raw: unknown,
  validation: unknown,
): void => {
  const dir = failureDir(runsDir, runId, jobId);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, `attempt-${attempt}.raw.json`), raw);
  writeJson(join(dir, `attempt-${attempt}.validation.json`), validation);
};

const elapsedMs = (startedAt: number): number => Date.now() - startedAt;

/** Next per-job failure-artifact number; continues after existing artifacts (resume-safe). */
const nextFailureArtifactNumber = (runsDir: string, runId: string, jobId: string): number => {
  const dir = failureDir(runsDir, runId, jobId);
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    const match = /^attempt-(\d+)\.raw\.json$/.exec(entry);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
};

const omittedSamplerValue = (): OmittedSamplerValue => ({ value: null, source: 'omitted-request' });

const resolvedInferenceConfig = (
  job: AiUnitAuthoringJob,
  options: RunnerOptions,
  timeoutMs: number,
  spec: string,
): ResolvedInferenceConfig => {
  const systemPrompt = promptForJob(job, spec)[0]?.content ?? '';
  const mode = options.unsafeUnstructured ? 'unsafe-json-object' : 'strict-json-schema';
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
      source: options.reasoningEffortSource ?? 'omitted-request',
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
      mode,
      strict: !options.unsafeUnstructured,
      responseSchemaSha256: hashText(JSON.stringify(UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA)),
    },
    prompts: {
      systemPromptSha256: hashText(systemPrompt),
      promptSpecVersion: job.promptSpecVersion,
    },
  };
};

const provenanceFor = (
  job: AiUnitAuthoringJob,
  options: RunnerOptions,
  timeoutMs: number,
  attempt: number,
  raw: unknown,
  accepted: boolean,
  spec: string,
): Record<string, unknown> => ({
  providerKind: 'local-openai-compatible',
  modelId: options.model,
  runId: options.runId,
  jobId: job.jobId,
  proposalId: job.jobId,
  sourceJobInputHash: job.inputHash,
  sourceHashes: groupSourceHashes(job),
  attempt,
  timestamp: new Date().toISOString(),
  structuredOutputMode: options.unsafeUnstructured ? 'unsafe-json-object' : 'strict-json-schema',
  resolvedInferenceConfig: resolvedInferenceConfig(job, options, timeoutMs, spec),
  rawHash: hashText(JSON.stringify(raw)),
  accepted,
});

const appendProviderEvent = (runsDir: string, runId: string, event: Record<string, unknown>): void => {
  const path = providerEventsPath(runsDir, runId);
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
  recordFailure(context.options.runsDir ?? RUNS_DIR, context.options.runId, context.job.jobId,
    context.nextArtifactNumber(), raw, {
      ...provenanceFor(context.job, context.options, context.timeoutMs, context.semanticAttempt, raw, false, context.spec),
      failureKind: 'transport/provider',
      failureCode: failure.code,
      errorMessage: failure.message,
      ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      issues: [],
    });
};

/**
 * Health preflight before the first job: GET <base>/models and require the
 * configured model id (llama.cpp returns { data: [{ id, ... }] }). Any
 * transport failure or model-absence is a clean exit-1 failure with no job
 * started. Skipped with --no-health-preflight and in --dry-run.
 */
export const providerModelPreflight = async (
  options: RunnerOptions,
  fetchImpl: FetchLike,
  log: (_message: string) => void,
): Promise<void> => {
  const url = `${options.baseUrl.replace(/\/$/, '')}/models`;
  let response: Pick<Response, 'ok' | 'status' | 'json' | 'text'>;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(HEALTH_PREFLIGHT_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Health preflight failed: cannot reach the provider at ${url} (${message}); no job was started.`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Health preflight failed: HTTP ${response.status} from ${url}${text ? ` ${text}` : ''}; no job was started.`,
    );
  }
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
  const ids = Array.isArray(body.data)
    ? body.data.map((entry) => String(entry.id ?? '')).filter(Boolean)
    : [];
  if (!ids.includes(options.model))
    throw new Error(
      `Health preflight failed: model ${JSON.stringify(options.model)} is not served by ${url} (available: ${ids.length > 0 ? ids.join(', ') : 'none listed'}); no job was started.`,
    );
  log(`Health preflight ok: ${options.model} is served at ${url}.`);
};

/**
 * Call the local provider for one semantic attempt, retrying provider
 * (transport/HTTP/response-envelope) failures without consuming semantic
 * retries — behavior identical to studyAiLocalMapAuthor.ts. Throws
 * ProviderRunAbortError to stop the whole run; accepted results stay written.
 */
const acquireProviderContent = async (context: ProviderCallContext): Promise<unknown> => {
  const { options, job, chatUrl, timeoutMs, fetchImpl, log } = context;
  const maxProviderAttempts = options.maxProviderAttempts ?? DEFAULT_MAX_PROVIDER_ATTEMPTS;
  const recoveryTimeoutMs = options.providerRecoveryTimeoutMs ?? DEFAULT_PROVIDER_RECOVERY_TIMEOUT_MS;
  const recoveryPollMs = options.providerRecoveryPollMs ?? DEFAULT_PROVIDER_RECOVERY_POLL_MS;
  const runsDir = options.runsDir ?? RUNS_DIR;
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
        const unsupported = !options.unsafeUnstructured && /schema|response_format|json_schema/i.test(text);
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
      appendProviderEvent(runsDir, options.runId, providerFailureEvent(context, providerAttempt, failure, { recovered: false, waitedMs: 0 }));
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
    appendProviderEvent(runsDir, options.runId, providerFailureEvent(context, providerAttempt, failure, { recovered: health.recovered, waitedMs: health.waitedMs }));
    if (!health.recovered)
      throw new ProviderRunAbortError(
        'PROVIDER_RECOVERY_TIMEOUT',
        job.jobId,
        `Provider health did not recover within ${health.waitedMs} ms for ${job.jobId}; the run is aborted so the same command with --resume can continue after the provider is restored.`,
      );
  }
};

export const runLocalUnitAuthoring = async (
  options: RunnerOptions,
  fetchImpl: FetchLike = fetch,
): Promise<LocalUnitAuthoringResult & { dryRunSummary?: LocalUnitDryRunSummary }> => {
  const runsDir = options.runsDir ?? RUNS_DIR;
  if (options.concurrency !== 1)
    throw new Error('Only concurrency 1 is supported for local unit authoring.');
  const log = options.log ?? console.log;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_UNIT_TIMEOUT_MS;
  const chatUrl = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  // Fail-closed gates before any provider call and before any write.
  const spec = loadUnitAuthoringV4Spec();
  const promptSha256 = hashText(spec);
  const pkg = loadContentPackage(options.package);
  assertRunJson(options, runsDir);
  const allRunJobs = loadUnitJobs(options.runId, undefined, runsDir);
  const jobs = options.batch ? loadUnitJobs(options.runId, options.batch, runsDir) : allRunJobs;
  gateUnitJobs(jobs, options, runsDir);
  const selectedJobs = applySelection(jobs, options);
  const identity = loadRunIdentity(options, runsDir);

  if (!options.noHealthPreflight && !options.dryRun)
    await providerModelPreflight(options, fetchImpl, log);

  if (options.dryRun) {
    validateRunMetadata(options, identity, promptSha256, runsDir, false);
  } else {
    mkdirSync(join(runDirOf(runsDir, options.runId), 'results'), { recursive: true });
    validateRunMetadata(options, identity, promptSha256, runsDir, true);
  }

  const accepted = readJsonl<AiStudyUnitProposal>(resultsPath(runsDir, options.runId));
  validateExistingResults(accepted, allRunJobs, options);
  const acceptedIds = new Set(accepted.map((result) => result.proposalId));

  let skipped = 0;
  let semanticFailed = 0;
  let acceptedCount = 0;
  let providerAbort: LocalUnitAuthoringResult['providerAbort'];
  try {
    for (const [jobIndex, job] of selectedJobs.entries()) {
      log(`[${jobIndex + 1}/${selectedJobs.length}] ${job.jobId}`);
      if (acceptedIds.has(job.jobId)) {
        skipped += 1;
        continue;
      }
      if (options.dryRun) continue;
      let retry: { note: string; errorCodes: string[] } | undefined;
      let written = false;
      let artifactNumber = nextFailureArtifactNumber(runsDir, options.runId, job.jobId);
      const attemptLimit = options.maxRetries + 1;
      for (let semanticAttempt = 1; semanticAttempt <= attemptLimit; semanticAttempt += 1) {
        const context: ProviderCallContext = {
          options,
          job,
          chatUrl,
          timeoutMs,
          fetchImpl,
          log,
          body: requestBody(job, options, spec, retry?.note),
          spec,
          semanticAttempt,
          nextArtifactNumber: (): number => artifactNumber++,
        };
        log(`attempt ${semanticAttempt}/${attemptLimit} started`);
        const raw = await acquireProviderContent(context);
        const validation = validateLocalUnitResult(raw, job, pkg, job.corpusContentHash);
        log(`validation ${validation.result ? 'accepted' : 'rejected'}`);
        const provenance = provenanceFor(job, options, timeoutMs, semanticAttempt, raw, Boolean(validation.result), spec);
        if (validation.result) {
          accepted.push(validation.result);
          writeJsonlAtomic(resultsPath(runsDir, options.runId), accepted);
          writeJson(join(runDirOf(runsDir, options.runId), 'results', `${job.jobId}.provenance.json`), provenance);
          acceptedIds.add(job.jobId);
          acceptedCount += 1;
          written = true;
          break;
        }
        recordFailure(runsDir, options.runId, job.jobId, context.nextArtifactNumber(), raw, {
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

  const result: LocalUnitAuthoringResult = {
    accepted: acceptedCount,
    semanticFailed,
    providerIncomplete: providerAbort
      ? selectedJobs.filter((job) => !acceptedIds.has(job.jobId)).length
      : 0,
    skipped,
    dryRunJobs: options.dryRun ? selectedJobs.length - skipped : 0,
    ...(providerAbort ? { providerAbort } : {}),
  };
  if (!options.dryRun) return result;
  return {
    ...result,
    dryRunSummary: {
      runId: options.runId,
      model: options.model,
      baseUrl: options.baseUrl,
      batch: options.batch ?? null,
      package: options.package,
      promptSpecVersion: UNIT_AUTHORING_V4_SPEC_VERSION,
      promptSha256,
      selectedJobs: result.dryRunJobs,
      firstJobIds: selectedJobs.map((job) => job.jobId).slice(0, 5),
    },
  };
};

export const LOCAL_UNIT_AUTHOR_HELP = `studyAiLocalUnitAuthor.ts — Unit Authoring V4 local runner

Usage:
  npx tsx scripts/studyAiLocalUnitAuthor.ts --run <run-id> --model <model> [options]

Required:
  --run <run-id>                  Run id under study-content/ai/runs/ (run.json jobType 'unit-authoring')
  --model <model>                 Provider model id (or STUDY_AI_MODEL)

Options:
  --base-url <url>                Local OpenAI-compatible base URL (default http://127.0.0.1:8080/v1, or STUDY_AI_BASE_URL)
  --api-key <key>                 Optional bearer key (or STUDY_AI_API_KEY)
  --package <path>                Content package for proposal grounding (default study-content/packages/nb-sit-statute-corpus.content-package.json)
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
  --concurrency <n>               Must be 1 (default 1)
  --dry-run                       Run every gate except the network health preflight; no provider calls, no file writes
  --no-health-preflight           Skip the GET <base-url>/models model-availability preflight
  --unsafe-unstructured           Use json_object instead of the strict json_schema contract
  --help                          Show this help

Run gate (fail closed, before any provider call and before any write):
  run.json must exist with jobType 'unit-authoring' (map runs are rejected),
  providerKind 'local-openai-compatible', promptSpecVersion 'unit-authoring-v4',
  runId matching --run, and a corpusContentHash. Every loaded job must carry the
  unit-job authoring shape (approvedGroup, exactSourceText, frozenMapPriority).
  The unit-authoring-v4 spec file must exist. When reports/local-run-metadata.json
  exists, model, base URL, content package, prompt hash, batch selection, and job
  identity must match what wrote it.

Resume: accepted rows in results/local-unit.results.jsonl are skipped only after
  the persisted proposal matches its job (proposalId, runId, corpusContentHash,
  suggestedPriority === job frozenMapPriority, generationMetadata.sourceJobInputHash
  === job inputHash). Any mismatch aborts the run.

Provider failures:
  Transport/HTTP/timeout/envelope failures are provider failures, not semantic
  failures. They never consume --max-retries attempts. After each failure the
  runner polls GET <base-url>/models until healthy and reissues the same semantic
  attempt. If health does not recover within --provider-recovery-timeout-ms, or
  --max-provider-attempts is exceeded, or the structured-output contract is
  rejected, the run aborts (exit 1) with accepted results preserved; rerun with
  --resume to continue.

Artifacts (under study-content/ai/runs/<runId>/):
  results/local-unit.results.jsonl   Accepted proposals (canonical, atomic writes)
  results/<jobId>.provenance.json    Per-job accepted-attempt provenance
  local-failures/<jobId>/attempt-N.*  Numbered failure artifacts (semantic + provider)
  reports/local-run-metadata.json     Run identity (model, base url, package, prompt sha, jobs)
  reports/provider-events.jsonl       Append-only provider failure/recovery telemetry
`;

const main = async (): Promise<void> => {
  const rawArgs = parseArgs();
  if (rawArgs.help) {
    console.log(LOCAL_UNIT_AUTHOR_HELP.trimEnd());
    return;
  }
  const options = optionsFromArgs(rawArgs);
  if (!options.runId || !options.model)
    throw new Error('--run and --model/STUDY_AI_MODEL are required. Run with --help for options.');
  const result = await runLocalUnitAuthoring(options);
  if (result.dryRunSummary) console.log(JSON.stringify(result.dryRunSummary, null, 2));
  else console.log(JSON.stringify(result, null, 2));
  if (result.providerAbort) process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiLocalUnitAuthor.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
