/**
 * Deterministic, model-free batch application of the final post-QC human
 * map-review decisions through the ordinary adjudication utility.
 *
 * The decision file (chatgpt-post-qc-map-review-decisions-FINAL-CANDIDATE.json)
 * classifies into exactly three actionable buckets under the production run:
 *
 *   - priority-only-adjudicable: grouping kept, suggestedPriority changed.
 *     The accepted result row is re-based by removing the runner-owned
 *     identity fields and replacing suggestedPriority; every other semantic
 *     field (disposition, groups, focus selections, titles, reasons, goals,
 *     confidence, warnings) is preserved byte-for-byte.
 *
 *   - requires-corrected-map-result: grouping changed (split / standalone /
 *     skip). A complete human-authored corrected Map result artifact is
 *     supplied from the corrections directory and validated under the current
 *     validator before acceptance.
 *
 *   - no-change: not touched.
 *
 * For every affected job the script snapshots the stale row + provenance,
 * builds a synthetic source run with explicitly-labeled reconstructed
 * attempt artifacts, removes the stale row/provenance, and re-adjudicates
 * through adjudicateMapResult (which re-injects runner identity and writes
 * fresh provenance). Finally it verifies the results file: unchanged total
 * row count, exactly one row per affected job, the expected new priority on
 * each affected row, and byte-identical unaffected rows.
 *
 * No model is called and no canonical artifact is mutated except through
 * adjudicateMapResult. Dry-run by default; fail closed on any mismatch.
 *
 * Usage:
 *   npx tsx scripts/studyAiFinalMapQcAdjudications.ts
 *     [--run <runId>] [--decisions <file>] [--corrections-dir <dir>]
 *     [--source-run <runId>] [--execute]
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
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
  classifyMapReviewDecisions,
  parseMapReviewDecisionFile,
  type ClassifiedDecision,
  type ReviewPriority,
} from '../src/study/ai/studyAiReviewDecision';
import {
  RUNS_DIR,
  batchJobFiles,
  readJsonl,
  validateLocalResult,
  writeJson,
} from './studyAiLocalMapAuthor';

const DEFAULT_RUN = 'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
const DEFAULT_DECISIONS =
  'temp/study-ai-final-map-review/chatgpt-post-qc-map-review-decisions-FINAL-CANDIDATE.json';
const DEFAULT_CORRECTIONS_DIR = 'temp/study-ai-final-map-review/corrections';
const DEFAULT_SOURCE_RUN = 'final-map-qc-adjudications-20260901-src';
const SNAPSHOT_DIRNAME = 'final-map-qc-snapshot-20260901';
const RECONSTRUCTION_SOURCE = 'final-map-qc-adjudications-20260901';
/** SHA-256 of the final human decision file; the batch refuses any other file. */
const EXPECTED_DECISIONS_SHA256 =
  'f31f8012d941871e745932e6501f7cd4a3192bca25f7c6178db65e2a94b946d8';
const PRIORITY_REASON = 'post-qc-final-human-priority-adjudication';
const GROUPING_REASON = 'post-qc-final-human-grouping-adjudication';

type Row = Record<string, unknown>;

const RUNNER_OWNED_FIELDS: readonly string[] = [
  'schemaVersion',
  'jobId',
  'runId',
  'corpusContentHash',
  'inputHash',
  'authoringInputFingerprint',
  'promptSpecVersion',
];

const stripRunnerOwned = (row: Row): Row => {
  const payload: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!RUNNER_OWNED_FIELDS.includes(key)) payload[key] = value;
  }
  return payload;
};

const createHashSha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const resultsPathFor = (runDir: string): string =>
  join(runDir, 'results', 'local-map.results.jsonl');

const provenancePathFor = (runDir: string, jobId: string): string =>
  join(runDir, 'results', `${jobId}.provenance.json`);

const loadProductionJobs = (runId: string): Map<string, unknown> =>
  new Map(
    batchJobFiles(runId).flatMap((file) =>
      readJsonl<Record<string, unknown>>(file).map((job) => [job.jobId as string, job]),
    ),
  );

type JobPlanKind = 'priority-only' | 'grouping-corrected';

interface JobPlan {
  jobId: string;
  kind: JobPlanKind;
  staleRow: Row;
  payload: Row;
  /** newPriority from the decision file (null when the decision keeps priority). */
  newPriority: ReviewPriority | null;
  /** Priority the accepted row must carry after adjudication (payload-derived). */
  expectedPriority: ReviewPriority | null;
  check: { valid: boolean; issues: string[] };
}

const checkPayload = (payload: Row, job: unknown) => {
  const { issues, report } = validateLocalResult(payload, job as never);
  return { valid: Boolean(report?.valid), issues };
};

const readResultsLines = (resultsFile: string): string[] => {
  const lines = readFileSync(resultsFile, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const rowsByJob = (lines: string[]): Map<string, Row> => {
  const map = new Map<string, Row>();
  for (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    map.set(row.jobId as string, row);
  }
  return map;
};

const buildPlan = (
  classifications: ClassifiedDecision[],
  jobs: Map<string, unknown>,
  rows: Map<string, Row>,
  correctionsDir: string,
): { plan: JobPlan[]; noChange: number; groupingMismatches: string[] } => {
  const plan: JobPlan[] = [];
  const groupingJobs = classifications.filter(
    (entry) => entry.classification === 'requires-corrected-map-result',
  );
  const groupingMismatches: string[] = [];
  for (const entry of groupingJobs) {
    const path = join(correctionsDir, `${entry.jobId}.json`);
    if (!existsSync(path)) groupingMismatches.push(`${entry.jobId}: missing correction artifact`);
  }
  for (const file of listCorrectionFiles(correctionsDir)) {
    const jobId = file.replace('.json', '');
    if (!groupingJobs.some((entry) => entry.jobId === jobId)) {
      groupingMismatches.push(`${jobId}: correction artifact present but not a grouping decision`);
    }
  }
  for (const entry of classifications) {
    if (entry.classification === 'no-change') continue;
    const staleRow = rows.get(entry.jobId);
    if (!staleRow) throw new Error(`no accepted result row for ${entry.jobId}`);
    const job = jobs.get(entry.jobId);
    if (!job) throw new Error(`no prepared job for ${entry.jobId}`);
    let payload: Row;
    if (entry.classification === 'priority-only-adjudicable') {
      payload = stripRunnerOwned(staleRow);
      payload.suggestedPriority = entry.newPriority as ReviewPriority;
    } else {
      const file = join(correctionsDir, `${entry.jobId}.json`);
      payload = stripRunnerOwned(JSON.parse(readFileSync(file, 'utf8')) as Row);
    }
    const expectedPriority = (payload.suggestedPriority ?? null) as ReviewPriority | null;
    if (
      entry.classification === 'requires-corrected-map-result' &&
      entry.newPriority !== null &&
      expectedPriority !== entry.newPriority
    ) {
      groupingMismatches.push(
        `${entry.jobId}: artifact priority ${String(expectedPriority)} does not match decision newPriority ${entry.newPriority}`,
      );
    }
    plan.push({
      jobId: entry.jobId,
      kind: entry.classification === 'priority-only-adjudicable' ? 'priority-only' : 'grouping-corrected',
      staleRow,
      payload,
      newPriority: entry.newPriority,
      expectedPriority,
      check: checkPayload(payload, job),
    });
  }
  const noChange = classifications.filter(
    (entry) => entry.classification === 'no-change',
  ).length;
  return { plan, noChange, groupingMismatches };
};

const listCorrectionFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json'))
    : [];

const buildSourceRun = (
  sourceRunDir: string,
  runId: string,
  jobs: Map<string, unknown>,
  plan: JobPlan[],
): void => {
  const failuresDir = join(sourceRunDir, 'local-failures');
  mkdirSync(join(sourceRunDir, 'reports'), { recursive: true });
  mkdirSync(join(sourceRunDir, 'jobs'), { recursive: true });
  writeJson(join(sourceRunDir, 'reports', 'batch-manifest.json'), { batchCount: 1 });
  writeFileSync(
    join(sourceRunDir, 'jobs', 'batch-001.jobs.jsonl'),
    plan.map(({ jobId }) => JSON.stringify(jobs.get(jobId)) + '\n').join(''),
  );
  for (const { jobId, kind, payload } of plan) {
    const dir = join(failuresDir, jobId);
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
      reconstructionMethod:
        kind === 'priority-only'
          ? 'accepted result row minus runner-owned identity fields, suggestedPriority updated from the final post-QC decision file'
          : 'human-authored corrected Map result artifact driven by the final post-QC decision file',
      issues: [],
    });
  }
};

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
      writeFileSync(
        join(snapshotDir, 'rows', `${jobId}.provenance.json`),
        readFileSync(provenance),
      );
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
  plan: JobPlan[],
  originalLines: string[],
): string[] => {
  const errors: string[] = [];
  const finalLines = readResultsLines(resultsPathFor(runDir));
  if (finalLines.length !== originalLines.length) {
    errors.push(`row count changed: ${originalLines.length} -> ${finalLines.length}`);
  }
  const countByJob = new Map<string, number>();
  const finalRows = new Map<string, Row>();
  for (const line of finalLines) {
    const row = JSON.parse(line) as Row;
    countByJob.set(row.jobId as string, (countByJob.get(row.jobId as string) ?? 0) + 1);
    finalRows.set(row.jobId as string, row);
  }
  for (const { jobId, expectedPriority } of plan) {
    if (countByJob.get(jobId) !== 1) {
      errors.push(`${jobId}: expected exactly one row, found ${countByJob.get(jobId) ?? 0}`);
      continue;
    }
    const row = finalRows.get(jobId);
    const actual = (row?.suggestedPriority ?? null) as ReviewPriority | null;
    if (actual !== expectedPriority) {
      errors.push(`${jobId}: expected suggestedPriority ${String(expectedPriority)}, found ${String(actual)}`);
    }
  }
  const affected = new Set(plan.map((entry) => entry.jobId));
  const originalSet = originalLines.filter((line) => {
    const row = JSON.parse(line) as Row;
    return !affected.has(row.jobId as string);
  });
  const finalSet = finalLines.filter((line) => {
    const row = JSON.parse(line) as Row;
    return !affected.has(row.jobId as string);
  });
  if (
    originalSet.length !== finalSet.length ||
    originalSet.some((line, index) => finalSet[index] !== line)
  ) {
    errors.push('an unaffected result row changed or moved');
  }
  return errors;
};

type Options = {
  run: string;
  decisions: string;
  correctionsDir: string;
  sourceRun: string;
  execute: boolean;
};

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    run: DEFAULT_RUN,
    decisions: DEFAULT_DECISIONS,
    correctionsDir: DEFAULT_CORRECTIONS_DIR,
    sourceRun: DEFAULT_SOURCE_RUN,
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') options.run = argv[++i];
    else if (arg === '--decisions') options.decisions = argv[++i];
    else if (arg === '--corrections-dir') options.correctionsDir = argv[++i];
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
  const decisionsPath = resolve(options.decisions);
  const correctionsDir = resolve(options.correctionsDir);
  if (!existsSync(decisionsPath)) throw new Error(`decision file not found: ${decisionsPath}`);
  const decisionsSha256 = createHashSha256(readFileSync(decisionsPath));
  if (decisionsSha256 !== EXPECTED_DECISIONS_SHA256) {
    throw new Error(
      `decision file sha256 ${decisionsSha256} does not match the final decision file ` +
        `${EXPECTED_DECISIONS_SHA256}; refusing`,
    );
  }
  const { file, issues: parseIssues } = parseMapReviewDecisionFile(
    JSON.parse(readFileSync(decisionsPath, 'utf8')),
  );
  if (file === null || parseIssues.length > 0) {
    throw new Error(`decision file failed to parse: ${parseIssues.map((i) => i.message).join('; ')}`);
  }
  if (file.runId !== options.run) {
    throw new Error(`decision file runId ${file.runId} does not match run ${options.run}`);
  }
  const jobs = loadProductionJobs(options.run);
  const originalLines = readResultsLines(resultsPathFor(runDir));
  const rows = rowsByJob(originalLines);
  const currentPriorities = new Map<string, ReviewPriority | null>();
  for (const [jobId, row] of rows) {
    const priority = row.suggestedPriority;
    currentPriorities.set(
      jobId,
      (priority === null ? null : (priority as ReviewPriority)) as ReviewPriority | null,
    );
  }
  const { classifications, issues: classifyIssues } = classifyMapReviewDecisions(file, currentPriorities);
  const invalid = classifications.filter((entry) => entry.classification === 'invalid');
  if (classifyIssues.length > 0 || invalid.length > 0) {
    throw new Error(
      `decision file has ${classifyIssues.length} issues / ${invalid.length} invalid decisions; refusing`,
    );
  }
  const { plan, noChange, groupingMismatches } = buildPlan(
    classifications,
    jobs,
    rows,
    correctionsDir,
  );
  if (groupingMismatches.length > 0) {
    throw new Error(`correction artifact set mismatch: ${groupingMismatches.join('; ')}`);
  }
  const invalidPayloads = plan.filter((entry) => !entry.check.valid);
  if (invalidPayloads.length > 0) {
    console.error('Payloads failing validation:');
    for (const entry of invalidPayloads) {
      console.error(`  ${entry.jobId}: ${entry.check.issues.join(' | ')}`);
    }
    process.exit(1);
  }
  const count = (kind: JobPlanKind): number =>
    plan.filter((entry) => entry.kind === kind).length;
  const summary = {
    run: options.run,
    execute: options.execute,
    decisionFile: decisionsPath,
    decisionFileSha256: decisionsSha256,
    counts: {
      totalDecisions: classifications.length,
      noChange,
      priorityOnly: count('priority-only'),
      groupingCorrected: count('grouping-corrected'),
      planned: plan.length,
    },
    jobs: plan.map(({ jobId, kind, newPriority, expectedPriority, check }) => ({
      jobId,
      kind,
      newPriority,
      expectedPriority,
      validation: check,
    })),
  };
  if (!options.execute) {
    console.log(JSON.stringify({ ...summary, status: 'valid-dry-run', note: 'pass --execute to apply' }, null, 2));
    return;
  }

  const snapshotDir = join(runDir, 'reports', SNAPSHOT_DIRNAME);
  snapshotStaleArtifacts(runDir, snapshotDir, plan);
  buildSourceRun(sourceRunDir, options.run, jobs, plan);
  removeStaleRows(runDir, new Set(plan.map((entry) => entry.jobId)), originalLines);

  const outcomes: AdjudicateMapResultReport[] = [];
  for (const entry of [...plan].sort((a, b) => a.jobId.localeCompare(b.jobId))) {
    mkdirSync(join(snapshotDir, 'payloads'), { recursive: true });
    const resultFile = join(snapshotDir, 'payloads', `${entry.jobId}.corrected.json`);
    writeFileSync(resultFile, JSON.stringify(entry.payload, null, 2) + '\n');
    outcomes.push(
      adjudicateMapResult({
        runId: options.run,
        jobId: entry.jobId,
        resultFile,
        sourceRunId: options.sourceRun,
        sourceAttempt: 1,
        adjudicationReason:
          entry.kind === 'priority-only' ? PRIORITY_REASON : GROUPING_REASON,
        decisionFileSha256: decisionsSha256,
      }),
    );
  }
  const failed = outcomes.filter((report) => report.outcome.status !== 'adjudicated');
  if (failed.length > 0) {
    console.error('Adjudication failures:', JSON.stringify(failed, null, 2));
    process.exit(1);
  }

  const verificationErrors = verifyFinalState(runDir, plan, originalLines);
  const report = {
    ...summary,
    status: verificationErrors.length === 0 ? 'adjudicated' : 'verification-failed',
    sourceRun: options.sourceRun,
    snapshotDir,
    outcomes,
    verificationErrors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (verificationErrors.length > 0) process.exit(1);
};

if (process.argv[1]?.endsWith('studyAiFinalMapQcAdjudications.ts')) {
  main();
}
