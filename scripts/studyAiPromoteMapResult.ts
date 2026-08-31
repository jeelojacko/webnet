#!/usr/bin/env tsx
/**
 * Deterministic, provenance-safe promotion/import of accepted Study Map
 * results from one local run into another (e.g. a targeted retry run into the
 * canonical full-corpus production run). It never calls a model, never
 * overwrites an already-accepted result in the target run, never appends a
 * duplicate row, keeps the source run's artifacts (including local-failures)
 * untouched, and writes per-job promotion provenance into the target run.
 *
 * Usage:
 *   npx tsx scripts/studyAiPromoteMapResult.ts --from-run <id> --to-run <id>
 *     --job <job-id> [--job ...] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { authoringInputFingerprint } from './studyAiFingerprint';
import {
  RUNS_DIR,
  hashText,
  loadBatchJobs,
  readJsonl,
  writeJson,
  writeJsonlAtomic,
} from './studyAiLocalMapAuthor';

export type PromoteMapResultOptions = {
  fromRunId: string;
  toRunId: string;
  jobIds: string[];
  dryRun?: boolean;
  /** ISO timestamp recorded in promotion provenance; defaults to now. */
  promotedAt?: string;
  /** Root for run directories; defaults to the repository RUNS_DIR. */
  runsDir?: string;
};

export type PromoteMapResultOutcome = {
  jobId: string;
  status: 'promoted' | 'valid-dry-run' | 'skipped-already-accepted' | 'failed';
  sourceRun: string;
  sourceRowHash: string | null;
  /** Whether the source run kept a per-job provenance file for this result. */
  hasSourceProvenance: boolean;
  disposition: string | null;
  confidence: string | null;
  error: string | null;
};

export type PromoteMapResultReport = {
  fromRunId: string;
  toRunId: string;
  dryRun: boolean;
  promotedAt: string;
  outcomes: PromoteMapResultOutcome[];
};

const resultsFileFor = (runsDir: string, runId: string): string =>
  join(runsDir, runId, 'results', 'local-map.results.jsonl');

const provenancePathFor = (runsDir: string, runId: string, jobId: string): string =>
  join(runsDir, runId, 'results', `${jobId}.provenance.json`);

const identityMatches = (result: AiStudyMapResult, job: AiStudyMapJob): boolean =>
  result.jobId === job.jobId &&
  result.corpusContentHash === job.corpusContentHash &&
  result.inputHash === job.inputHash &&
  result.authoringInputFingerprint === authoringInputFingerprint(job);

const sourceProvenanceFor = (runsDir: string, runId: string, jobId: string) => {
  const path = provenancePathFor(runsDir, runId, jobId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
};

const promotionProvenance = (params: {
  job: AiStudyMapJob;
  row: AiStudyMapResult;
  fromRunId: string;
  sourceProvenance: Record<string, unknown> | null;
  promotedAt: string;
}): Record<string, unknown> => ({
  jobId: params.job.jobId,
  authoringInputFingerprint: authoringInputFingerprint(params.job),
  sourceRowHash: hashText(JSON.stringify(params.row)),
  sourceRun: params.fromRunId,
  sourceResultFile: 'results/local-map.results.jsonl',
  sourceRawHash:
    typeof params.sourceProvenance?.rawHash === 'string' ? params.sourceProvenance.rawHash : null,
  accepted: true,
  promotion: {
    promotedVia: 'study:ai:promote-result',
    sourceRun: params.fromRunId,
    sourceJobFingerprintMatched: true,
    promotedAt: params.promotedAt,
  },
});

const promoteOne = (
  options: PromoteMapResultOptions,
  runsDir: string,
  toJobs: Map<string, AiStudyMapJob>,
  fromJobs: Map<string, AiStudyMapJob>,
  toResultsFile: string,
): PromoteMapResultOutcome => {
  const jobId = options.jobIds[0];
  const fromRun = options.fromRunId;
  const outcome: PromoteMapResultOutcome = {
    jobId,
    status: 'failed',
    sourceRun: fromRun,
    sourceRowHash: null,
    hasSourceProvenance: false,
    disposition: null,
    confidence: null,
    error: null,
  };
  const fail = (error: string): PromoteMapResultOutcome => {
    outcome.status = 'failed';
    outcome.error = error;
    return outcome;
  };

  const job = toJobs.get(jobId);
  if (!job) return fail(`no prepared job ${jobId} in to-run ${options.toRunId}`);
  if (job.authoringInputFingerprint !== authoringInputFingerprint(job))
    return fail(`prepared job ${jobId} fingerprint does not match its content; refusing`);

  // Fresh reads per job so promotions earlier in this invocation are observed.
  const toRows = readJsonl<AiStudyMapResult>(toResultsFile);
  if (toRows.some((row) => row.jobId === jobId)) {
    outcome.status = 'skipped-already-accepted';
    outcome.error = null;
    return outcome;
  }

  const fromRows = readJsonl<AiStudyMapResult>(
    resultsFileFor(runsDir, fromRun),
  );
  const row = fromRows.find((candidate) => candidate.jobId === jobId);
  if (!row) return fail(`no accepted result for ${jobId} in from-run ${fromRun}`);
  if (fromRows.filter((candidate) => candidate.jobId === jobId).length > 1)
    return fail(`duplicate accepted results for ${jobId} in from-run ${fromRun}; refusing`);

  const fromJob = fromJobs.get(jobId);
  if (!fromJob) return fail(`no prepared job ${jobId} in from-run ${fromRun}`);
  if (authoringInputFingerprint(fromJob) !== authoringInputFingerprint(job))
    return fail(
      `from-run ${fromRun} prepared a different input for ${jobId}; refusing to cross-run it`,
    );

  if (!identityMatches(row, job))
    return fail(`result identity does not match prepared job ${jobId}; refusing`);

  const targetProvenancePath = provenancePathFor(runsDir, options.toRunId, jobId);
  if (existsSync(targetProvenancePath))
    return fail(`target run already holds provenance for ${jobId}; refusing to clobber`);

  const sourceProvenance = sourceProvenanceFor(runsDir, fromRun, jobId);
  outcome.sourceRowHash = hashText(JSON.stringify(row));
  outcome.hasSourceProvenance = sourceProvenance !== null;
  outcome.disposition = row.disposition;
  outcome.confidence = row.confidence;

  if (options.dryRun) {
    outcome.status = 'valid-dry-run';
    return outcome;
  }

  const resultsDir = join(runsDir, options.toRunId, 'results');
  mkdirSync(resultsDir, { recursive: true });
  writeJsonlAtomic(toResultsFile, [...toRows, row]);
  writeJson(
    targetProvenancePath,
    promotionProvenance({
      job,
      row,
      fromRunId: fromRun,
      sourceProvenance,
      promotedAt: options.promotedAt ?? new Date().toISOString(),
    }),
  );
  outcome.status = 'promoted';
  return outcome;
};

export const promoteMapResults = (
  options: PromoteMapResultOptions,
): PromoteMapResultReport => {
  if (options.fromRunId === options.toRunId)
    throw new Error('--from-run and --to-run must name two different runs');
  if (options.jobIds.length === 0) throw new Error('At least one --job is required.');
  const runsDir = options.runsDir ?? RUNS_DIR;
  for (const runId of [options.fromRunId, options.toRunId]) {
    if (!existsSync(join(runsDir, runId))) throw new Error(`Unknown run: ${runId}`);
  }
  const toJobs = new Map(
    loadBatchJobs(options.toRunId, undefined, runsDir).map((job) => [job.jobId, job]),
  );
  const fromJobs = new Map(
    loadBatchJobs(options.fromRunId, undefined, runsDir).map((job) => [job.jobId, job]),
  );
  const toResultsFile = resultsFileFor(runsDir, options.toRunId);
  const outcomes = options.jobIds.map((jobId) =>
    promoteOne({ ...options, jobIds: [jobId] }, runsDir, toJobs, fromJobs, toResultsFile),
  );
  return {
    fromRunId: options.fromRunId,
    toRunId: options.toRunId,
    dryRun: Boolean(options.dryRun),
    promotedAt: options.promotedAt ?? new Date().toISOString(),
    outcomes,
  };
};

const HELP = `Deterministically promote accepted Study Map results between runs (no model calls).

Usage:
  npx tsx scripts/studyAiPromoteMapResult.ts --from-run <id> --to-run <id>
    --job <job-id> [--job ...] [--dry-run]

Imports an accepted results/local-map.results.jsonl row for each --job from the
source run into the target run's results file (atomic append, no duplicates),
writing promotion provenance at results/<jobId>.provenance.json in the target
run. Jobs already accepted in the target run are skipped, never overwritten.
Source-run artifacts, including local-failures, are never modified.`;

/**
 * Parse a `--job x --job y` style argv. Exported for test reuse.
 */
export const parsePromoteArgs = (argv: string[]) => {
  const valueFor = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const fromRun = valueFor('--from-run');
  const toRun = valueFor('--to-run');
  if (!fromRun || !toRun)
    throw new Error('--from-run and --to-run are required. Run with --help for options.');
  const jobIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--job' && typeof argv[index + 1] === 'string') {
      jobIds.push(argv[index + 1]);
    }
  }
  if (jobIds.length === 0)
    throw new Error('At least one --job is required. Run with --help for options.');
  return {
    fromRunId: fromRun,
    toRunId: toRun,
    jobIds,
    dryRun: argv.includes('--dry-run'),
  };
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP.trimEnd());
    return;
  }
  const report = promoteMapResults(parsePromoteArgs(argv));
  console.log(JSON.stringify(report, null, 2));
  if (report.outcomes.some((outcome) => outcome.status === 'failed')) process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiPromoteMapResult.ts')) main();
