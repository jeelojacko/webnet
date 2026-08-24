import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import { STUDY_MAP_V3_RESULT_SCHEMA } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';

const RUNS_DIR = 'study-content/ai/runs';

type RunnerOptions = {
  runId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  comparisonSet?: string;
  jobId?: string;
  batch?: string;
  resume: boolean;
  concurrency: number;
  maxRetries: number;
  dryRun: boolean;
  unsafeUnstructured: boolean;
};

type RequestInitLike = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

type FetchLike = (_input: string, _init: RequestInitLike) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

const parseArgs = (): Record<string, string | boolean> => {
  const [, , ...rawArgs] = process.argv;
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

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');
const readJsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, index) => JSON.parse((index === 0 ? line.replace(/^\uFEFF/, '') : line)) as T)
    : [];

const writeJsonlAtomic = (path: string, rows: unknown[]): void => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');
  renameSync(tempPath, path);
};

const loadBatchJobs = (runId: string, batch?: string): AiStudyMapJob[] => {
  const jobsDir = join(RUNS_DIR, runId, 'jobs');
  const file = batch ? `batch-${batch.padStart(3, '0')}.jobs.jsonl` : '';
  if (file) return readJsonl<AiStudyMapJob>(join(jobsDir, file));
  const manifest = readJson<{ batchCount: number }>(join(RUNS_DIR, runId, 'reports', 'batch-manifest.json'));
  return Array.from({ length: manifest.batchCount }, (_, index) =>
    readJsonl<AiStudyMapJob>(join(jobsDir, `batch-${String(index + 1).padStart(3, '0')}.jobs.jsonl`)),
  ).flat();
};

const selectJobs = (options: RunnerOptions): AiStudyMapJob[] => {
  const allJobs = loadBatchJobs(options.runId, options.batch);
  const selectedIds = options.comparisonSet
    ? new Set(readJson<{ jobs: Array<{ v2JobId: string }> }>(options.comparisonSet).jobs.map((job) => job.v2JobId))
    : undefined;
  return allJobs.filter((job) =>
    (!options.jobId || job.jobId === options.jobId) &&
    (!selectedIds || selectedIds.has(job.jobId)),
  );
};

const resultPath = (runId: string): string => join(RUNS_DIR, runId, 'results', 'local-map.results.jsonl');

const acceptedJobIds = (runId: string): Set<string> =>
  new Set(readJsonl<AiStudyMapResult>(resultPath(runId)).map((result) => result.jobId));

const promptForJob = (job: AiStudyMapJob): Array<{ role: 'system' | 'user'; content: string }> => [
  {
    role: 'system',
    content: [
      'You are a Study Map V3 authoring assistant.',
      'Use only the supplied official source as authoritative.',
      'Context is for understanding only and is not evidence unless its sourceKey is included in a proposed group.',
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

const requestBody = (job: AiStudyMapJob, options: RunnerOptions, retryNote?: string): unknown => {
  if (!options.unsafeUnstructured) {
    return {
      model: options.model,
      messages: retryNote ? [...promptForJob(job), { role: 'user', content: retryNote }] : promptForJob(job),
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
    model: options.model,
    messages: retryNote ? [...promptForJob(job), { role: 'user', content: retryNote }] : promptForJob(job),
    response_format: { type: 'json_object' },
  };
};

const parseModelContent = async (response: Pick<Response, 'json'>): Promise<unknown> => {
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | object } }>;
    output_text?: string;
  };
  const content = body.choices?.[0]?.message?.content ?? body.output_text;
  if (typeof content === 'object' && content !== null) return content;
  if (typeof content !== 'string') throw new Error('Provider response did not contain JSON content.');
  return JSON.parse(content);
};

const validateLocalResult = (value: unknown, job: AiStudyMapJob): { result?: AiStudyMapResult; issues: string[] } => {
  const report = validateAiStudyMapResult(value, job);
  const result = value as Partial<AiStudyMapResult>;
  const issues = report.issues.map((issue) => `${issue.code}: ${issue.message}`);
  if (result.authoringInputFingerprint && result.authoringInputFingerprint !== authoringInputFingerprint(job)) {
    issues.push('AUTHORING_FINGERPRINT_MISMATCH: Result fingerprint does not match the job.');
  }
  return report.valid && issues.length === report.issues.filter((issue) => issue.severity === 'warning').length
    ? { result: value as AiStudyMapResult, issues }
    : { issues };
};

const failureDir = (runId: string, jobId: string): string => join(RUNS_DIR, runId, 'local-failures', jobId);

const recordFailure = (runId: string, jobId: string, attempt: number, raw: unknown, validation: unknown): void => {
  const dir = failureDir(runId, jobId);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, `attempt-${attempt}.raw.json`), raw);
  writeJson(join(dir, `attempt-${attempt}.validation.json`), validation);
};

export const runLocalMapAuthoring = async (
  options: RunnerOptions,
  fetchImpl: FetchLike = fetch,
): Promise<{ accepted: number; failed: number; skipped: number; dryRunJobs: number }> => {
  if (!options.unsafeUnstructured && !STUDY_MAP_V3_RESULT_SCHEMA) throw new Error('Structured output schema is required.');
  if (options.concurrency !== 1) throw new Error('Only concurrency 1 is supported for local map authoring.');
  const jobs = selectJobs(options);
  mkdirSync(join(RUNS_DIR, options.runId, 'results'), { recursive: true });
  const accepted = readJsonl<AiStudyMapResult>(resultPath(options.runId));
  const acceptedIds = options.resume ? new Set(accepted.map((result) => result.jobId)) : acceptedJobIds(options.runId);
  let skipped = 0;
  let failed = 0;
  let acceptedCount = 0;
  for (const job of jobs) {
    if (acceptedIds.has(job.jobId)) {
      skipped += 1;
      continue;
    }
    if (options.dryRun) continue;
    let retryNote: string | undefined;
    let written = false;
    for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
      const body = requestBody(job, options, retryNote);
      let raw: unknown;
      try {
        const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) {
          const text = await response.text();
          if (!options.unsafeUnstructured && /schema|response_format|json_schema/i.test(text)) {
            throw new Error(`Structured output unsupported or rejected by provider: HTTP ${response.status} ${text}`);
          }
          throw new Error(`HTTP ${response.status} ${text}`);
        }
        raw = await parseModelContent(response);
      } catch (error) {
        raw = { error: error instanceof Error ? error.message : String(error) };
      }
      const validation = validateLocalResult(raw, job);
      const provenance = {
        providerKind: 'local-openai-compatible',
        modelId: options.model,
        runId: options.runId,
        jobId: job.jobId,
        authoringInputFingerprint: authoringInputFingerprint(job),
        sourceHashes: job.target.sourceHashes,
        attempt,
        timestamp: new Date().toISOString(),
        structuredOutputMode: options.unsafeUnstructured ? 'unsafe-json-object' : 'strict-json-schema',
        rawHash: hashText(JSON.stringify(raw)),
        accepted: Boolean(validation.result),
      };
      if (validation.result) {
        accepted.push({ ...validation.result, authoringInputFingerprint: authoringInputFingerprint(job) });
        writeJsonlAtomic(resultPath(options.runId), accepted);
        writeJson(join(RUNS_DIR, options.runId, 'results', `${job.jobId}.provenance.json`), provenance);
        acceptedIds.add(job.jobId);
        acceptedCount += 1;
        written = true;
        break;
      }
      recordFailure(options.runId, job.jobId, attempt, raw, { ...provenance, issues: validation.issues });
      retryNote = 'The previous response failed validation. Regenerate the entire response as one JSON object that exactly matches the supplied schema and job identity.';
    }
    if (!written) failed += 1;
  }
  return { accepted: acceptedCount, failed, skipped, dryRunJobs: options.dryRun ? jobs.length - skipped : 0 };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const options: RunnerOptions = {
    runId: String(args.run ?? ''),
    model: String(args.model ?? process.env.STUDY_AI_MODEL ?? ''),
    baseUrl: String(args['base-url'] ?? process.env.STUDY_AI_BASE_URL ?? 'http://127.0.0.1:1234/v1'),
    apiKey: args['api-key'] ? String(args['api-key']) : process.env.STUDY_AI_API_KEY,
    comparisonSet: args['comparison-set'] ? String(args['comparison-set']) : undefined,
    jobId: args.job ? String(args.job) : undefined,
    batch: args.batch ? String(args.batch) : undefined,
    resume: Boolean(args.resume),
    concurrency: Number(args.concurrency ?? 1),
    maxRetries: Number(args['max-retries'] ?? 2),
    dryRun: Boolean(args['dry-run']),
    unsafeUnstructured: Boolean(args['unsafe-unstructured']),
  };
  if (!options.runId || !options.model) throw new Error('--run and --model/STUDY_AI_MODEL are required.');
  const result = await runLocalMapAuthoring(options);
  console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1]?.endsWith('studyAiLocalMapAuthor.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
