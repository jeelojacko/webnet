/**
 * Deterministic, model-free result rebase for accepted Study Map results
 * whose prepared-job identity changed under the repeal-metadata repair
 * (scripts/studyAiRepealIntegrityAudit.ts --repair).
 *
 * For each affected job this tool:
 *
 *   1. reads the stale accepted result row from the production run,
 *   2. reconstructs the model-semantic payload by removing the runner-owned
 *      identity fields (schemaVersion, jobId, runId, corpusContentHash,
 *      inputHash, authoringInputFingerprint, promptSpecVersion),
 *   3. validates the payload under the REPAIRED job with the production
 *      validator (validateLocalResult),
 *   4. builds a synthetic source run carrying the repaired jobs plus
 *      explicitly-labeled reconstructed local-failure attempt artifacts,
 *   5. snapshots the stale row + provenance, removes them from the
 *      production results, and re-accepts the unchanged semantic payload
 *      through the existing adjudication utility
 *      (studyAiAdjudicateMapResult), which re-injects the repaired identity,
 *   6. verifies the final results file: same total row count, each affected
 *      jobId exactly once, every affected row valid under the repaired job,
 *      and every unaffected row byte-identical to before.
 *
 * No model is called and no semantic field of any result changes; only the
 * runner-owned identity is re-based onto the repaired job.
 *
 * Usage:
 *   npx tsx scripts/studyAiRepealRebaseResults.ts [--run <runId>]
 *     [--jobs <csv>] [--source-run <runId>] [--execute]
 *
 * Without --execute the script performs every check except the file changes
 * and exits (dry-run by default; fail closed on any invalidation).
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  adjudicateMapResult,
  type AdjudicateMapResultReport,
} from './studyAiAdjudicateMapResult';
import {
  RUNS_DIR,
  batchJobFiles,
  readJsonl,
  validateLocalResult,
  writeJson,
} from './studyAiLocalMapAuthor';

const DEFAULT_RUN = 'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
const DEFAULT_SOURCE_RUN = 'repeal-rebase-20260901-src';
const RECONSTRUCTION_SOURCE = 'repeal-metadata-rebase-20260901';

const RUNNER_OWNED_FIELDS: readonly string[] = [
  'schemaVersion',
  'jobId',
  'runId',
  'corpusContentHash',
  'inputHash',
  'authoringInputFingerprint',
  'promptSpecVersion',
];

const DEFAULT_JOBS = [
  'map-445b7c242fa7ca8e',
  'map-a8dca3bad6375a4b',
  'map-b3f4a3a3929f97a7',
  'map-4907cf4a742b9f7e',
  'map-af6c07e39012da11',
  'map-11fc0137f38dd967',
  'map-7c48e28797b91624',
];

type Row = Record<string, unknown>;

const stripRunnerOwned = (row: Row): Row => {
  const payload: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!RUNNER_OWNED_FIELDS.includes(key)) payload[key] = value;
  }
  return payload;
};

const loadProductionJobs = (runId: string): Map<string, unknown> =>
  new Map(
    batchJobFiles(runId).flatMap((file) =>
      readJsonl<Record<string, unknown>>(file).map((job) => [job.jobId as string, job]),
    ),
  );

/**
 * Validate the reconstructed payload under the repaired job. Returns the
 * validation report summary; empty issues means the re-based result is valid.
 */
const checkPayload = (payload: Row, job: Record<string, unknown>) => {
  const { issues, report } = validateLocalResult(payload, job as never);
  return {
    valid: Boolean(report?.valid),
    issues,
    warnings: report?.issues.filter((issue) => issue.severity === 'warning').map((i) => i.code),
  };
};

type JobPlan = {
  jobId: string;
  staleRow: Row;
  payload: Row;
  check: { valid: boolean; issues: string[]; warnings: string[] };
};

const buildPlan = (
  runDir: string,
  jobs: Map<string, unknown>,
  jobIds: string[],
  resultsFile: string,
): { plan: JobPlan[]; originalLines: string[] } => {
  const originalLines = readFileSync(resultsFile, 'utf8').split('\n');
  const trailing = originalLines[originalLines.length - 1] === '';
  if (trailing) originalLines.pop();
  const rowsByJob = new Map<string, Row>();
  for (const line of originalLines) {
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    rowsByJob.set(row.jobId as string, row);
  }
  const plan: JobPlan[] = [];
  for (const jobId of jobIds) {
    const staleRow = rowsByJob.get(jobId);
    if (!staleRow) throw new Error(`no accepted result row for ${jobId}`);
    const job = jobs.get(jobId);
    if (!job) throw new Error(`no prepared job for ${jobId}`);
    const payload = stripRunnerOwned(staleRow);
    plan.push({ jobId, staleRow, payload, check: checkPayload(payload, job) });
  }
  return { plan, originalLines };
};

const buildSourceRun = (
  sourceRunDir: string,
  runId: string,
  jobs: Map<string, unknown>,
  plan: JobPlan[],
): void => {
  const payloadDir = join(sourceRunDir, 'local-failures');
  mkdirSync(join(sourceRunDir, 'reports'), { recursive: true });
  mkdirSync(join(sourceRunDir, 'jobs'), { recursive: true });
  writeJson(join(sourceRunDir, 'reports', 'batch-manifest.json'), { batchCount: 1 });
  writeFileSync(
    join(sourceRunDir, 'jobs', 'batch-001.jobs.jsonl'),
    plan.map(({ jobId }) => JSON.stringify(jobs.get(jobId)) + '\n').join(''),
  );
  for (const { jobId, payload } of plan) {
    const dir = join(payloadDir, jobId);
    mkdirSync(dir, { recursive: true });
    const raw = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const rawFile = join(dir, 'attempt-1.raw.json');
    writeFileSync(rawFile, JSON.stringify(raw, null, 2) + '\n');
    const rawHash = createHashSha256(JSON.stringify(raw));
    writeJson(join(dir, 'attempt-1.validation.json'), {
      jobId,
      runId,
      attempt: 1,
      rawHash,
      reconstructed: true,
      reconstructionSource: RECONSTRUCTION_SOURCE,
      reconstructionMethod: 'accepted result row minus runner-owned identity fields',
      issues: [],
    });
  }
};

const createHashSha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const resultsPathFor = (runDir: string): string =>
  join(runDir, 'results', 'local-map.results.jsonl');

const provenancePathFor = (runDir: string, jobId: string): string =>
  join(runDir, 'results', `${jobId}.provenance.json`);

const snapshotStaleArtifacts = (
  runDir: string,
  snapshotDir: string,
  plan: JobPlan[],
): void => {
  for (const { jobId, staleRow } of plan) {
    mkdirSync(join(snapshotDir, 'rows'), { recursive: true });
    writeFileSync(
      join(snapshotDir, 'rows', `${jobId}.result.json`),
      JSON.stringify(staleRow, null, 2) + '\n',
    );
    const provenance = provenancePathFor(runDir, jobId);
    if (existsSync(provenance)) {
      writeFileSync(join(snapshotDir, 'rows', `${jobId}.provenance.json`), readFileSync(provenance));
    }
  }
};

const removeStaleRows = (
  runDir: string,
  jobIds: Set<string>,
  originalLines: string[],
): void => {
  const resultsFile = resultsPathFor(runDir);
  const kept = originalLines.filter((line) => {
    if (!line) return true;
    const row = JSON.parse(line) as Row;
    return !jobIds.has(row.jobId as string);
  });
  const tmp = `${resultsFile}.tmp-${process.pid}`;
  writeFileSync(tmp, kept.join('\n') + '\n');
  renameSync(tmp, resultsFile);
  for (const jobId of jobIds) {
    rmSync(provenancePathFor(runDir, jobId), { force: true });
  }
};

const verifyFinalState = (
  runDir: string,
  runId: string,
  jobIds: string[],
  originalLines: string[],
): string[] => {
  const errors: string[] = [];
  const finalLines = readFileSync(resultsPathFor(runDir), 'utf8').split('\n');
  const trailing = finalLines[finalLines.length - 1] === '';
  if (trailing) finalLines.pop();
  if (finalLines.length !== originalLines.length) {
    errors.push(`row count changed: ${originalLines.length} -> ${finalLines.length}`);
  }
  const countByJob = new Map<string, number>();
  for (const line of finalLines) {
    const row = JSON.parse(line) as Row;
    countByJob.set(row.jobId as string, (countByJob.get(row.jobId as string) ?? 0) + 1);
  }
  for (const jobId of jobIds) {
    if (countByJob.get(jobId) !== 1) errors.push(`${jobId}: expected exactly one row`);
  }
  const originalSet = originalLines.filter((line) => {
    const row = JSON.parse(line) as Row;
    return !jobIds.includes(row.jobId as string);
  });
  const finalSet = finalLines.filter((line) => {
    const row = JSON.parse(line) as Row;
    return !jobIds.includes(row.jobId as string);
  });
  if (
    originalSet.length !== finalSet.length ||
    originalSet.some((line, index) => finalSet[index] !== line)
  ) {
    errors.push('an unaffected result row changed or moved');
  }
  return errors;
};

type Options = { run: string; jobs: string[]; sourceRun: string; execute: boolean };

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    run: DEFAULT_RUN,
    jobs: DEFAULT_JOBS,
    sourceRun: DEFAULT_SOURCE_RUN,
    execute: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run') options.run = argv[++i];
    else if (arg === '--jobs') options.jobs = argv[++i].split(',').map((value) => value.trim());
    else if (arg === '--source-run') options.sourceRun = argv[++i];
    else if (arg === '--execute') options.execute = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const runDir = resolve(RUNS_DIR, options.run);
  const sourceRunDir = resolve(RUNS_DIR, options.sourceRun);
  const jobs = loadProductionJobs(options.run);
  const { plan, originalLines } = buildPlan(
    runDir,
    jobs,
    options.jobs,
    resultsPathFor(runDir),
  );

  const invalid = plan.filter((entry) => !entry.check.valid);
  if (invalid.length > 0) {
    console.error('Reconstructed payloads failing validation:');
    for (const entry of invalid) {
      console.error(`  ${entry.jobId}: ${entry.check.issues.join(' | ')}`);
    }
    process.exit(1);
  }

  const summary = {
    run: options.run,
    execute: options.execute,
    jobs: plan.map(({ jobId, staleRow, payload, check }) => ({
      jobId,
      staleInputHash: staleRow.inputHash,
      repairedInputHash: (jobs.get(jobId) as Row).inputHash,
      payloadKeys: Object.keys(payload),
      validation: check,
    })),
  };

  if (!options.execute) {
    console.log(
      JSON.stringify(
        { ...summary, status: 'valid-dry-run', note: 'pass --execute to apply the rebase' },
        null,
        2,
      ),
    );
    return;
  }

  const snapshotDir = join(runDir, 'reports', 'repeal-rebase-snapshot-20260901');
  snapshotStaleArtifacts(runDir, snapshotDir, plan);
  buildSourceRun(sourceRunDir, options.run, jobs, plan);
  removeStaleRows(runDir, new Set(options.jobs), originalLines);

  const outcomes: AdjudicateMapResultReport[] = [];
  for (const { jobId } of [...plan].sort((a, b) => a.jobId.localeCompare(b.jobId))) {
    const resultFile = join(snapshotDir, 'payloads', `${jobId}.corrected.json`);
    mkdirSync(join(snapshotDir, 'payloads'), { recursive: true });
    writeFileSync(resultFile, JSON.stringify(plan.find((entry) => entry.jobId === jobId)!.payload, null, 2) + '\n');
    outcomes.push(
      adjudicateMapResult({
        runId: options.run,
        jobId,
        resultFile,
        sourceRunId: options.sourceRun,
        sourceAttempt: 1,
      }),
    );
  }
  const failed = outcomes.filter((report) => report.outcome.status !== 'adjudicated');
  if (failed.length > 0) {
    console.error('Adjudication failures:', JSON.stringify(failed, null, 2));
    process.exit(1);
  }

  const verificationErrors = verifyFinalState(runDir, options.run, options.jobs, originalLines);
  const report = {
    ...summary,
    status: verificationErrors.length === 0 ? 'rebased' : 'verification-failed',
    sourceRun: options.sourceRun,
    snapshotDir,
    outcomes,
    verificationErrors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (verificationErrors.length > 0) process.exit(1);
};

if (process.argv[1]?.endsWith('studyAiRepealRebaseResults.ts')) {
  main();
}
