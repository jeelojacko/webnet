/**
 * Local Study Map run auditor.
 *
 * Inspects one local-model run directory against a comparison set and writes:
 * - `reports/map-run-audit.json`         full deterministic metrics
 * - `reports/map-run-audit.md`           companion summary
 * - `reports/semantic-review-bundle.jsonl`  tiered sample for semantic review
 *
 * Integrity problems (malformed lines, duplicate results, unexpected job ids,
 * missing base jobs, runId mismatch) fail the run with a non-zero exit code.
 *
 * No LLM calls. No V1 ground-truth scoring: the V1 comparator is descriptive.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import {
  collectJobAuditRecords,
  loadProviderEvents,
  loadProvenanceSummary,
  loadRunAttempts,
  loadRunResults,
  normalizeIssue,
  type ComparisonSet,
  type NormalizedIssue,
} from './studyAiAuditMapRunCore';
import { stripUtf8Bom } from './studyAiProviderFailures';
import {
  buildReviewBundleEntry,
  computeConcision,
  computeHygiene,
  computePerStratum,
  computeReliability,
  computeStructureMetrics,
  computeV1Comparison,
  countBy,
  selectReviewBundle,
} from './studyAiAuditMapRunMetrics';

const RUNS_DIR = 'study-content/ai/runs';

export const AUDIT_MAP_RUN_HELP = `Local Study Map run auditor.

Usage:
  npx tsx scripts/studyAiAuditMapRun.ts --run <runId> --comparison-set <path> [--review-size <n>]

Options:
  --run <runId>          Local run id under study-content/ai/runs (or a path).
  --comparison-set <p>   Path to the stratified comparison-set JSON.
  --review-size <n>      Review bundle cap (default 40, positive integer).
  -h, --help             Show this help.

Writes into the audited run's reports/:
  map-run-audit.json, map-run-audit.md, semantic-review-bundle.jsonl

Reliability separates semantic failures (model output rejected by validation)
from provider interruptions (transport/HTTP/timeout failures). Provider
attempts never consume semantic retries, and provider-incomplete jobs are
excluded from the semantic review bundle. Provider telemetry, when present,
is read from reports/provider-events.jsonl and summarized in the report; older
runs without that file are noted rather than failed.`;

const parseArgs = (argv: string[]) => {
  const valueFor = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const run = valueFor('run') ?? process.env.STUDY_AI_RUN ?? '';
  const comparisonSet = valueFor('comparison-set') ?? '';
  const reviewSize = Number(valueFor('review-size') ?? '40');
  if (!run) throw new Error('pass --run <runId>');
  if (!comparisonSet) throw new Error('pass --comparison-set <path>');
  if (!Number.isInteger(reviewSize) || reviewSize <= 0)
    throw new Error('--review-size must be a positive integer');
  return { run, comparisonSet, reviewSize };
};

const loadBaseJobs = (baseRunId: string): Map<string, AiStudyMapJob> => {
  const jobsDir = join(RUNS_DIR, baseRunId, 'jobs');
  const jobs = readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) =>
      (
        readFileSync(join(jobsDir, file), 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '') as unknown[]
      ).map((line) => JSON.parse(line as string) as AiStudyMapJob),
    );
  return new Map(jobs.map((job) => [job.jobId, job]));
};

const resolveRunPath = (run: string): string =>
  run.includes('/') || run.startsWith('.') ? run : join(RUNS_DIR, run);

const loadV1Results = (
  setJobs: Array<{ v1JobId?: string | null; v1KnownGoodResultLocation?: string | null }>,
): Map<string, AiStudyMapResult> => {
  const byFile = new Map<string, AiStudyMapResult[]>();
  for (const setJob of setJobs) {
    if (!setJob.v1JobId || !setJob.v1KnownGoodResultLocation) continue;
    const location = setJob.v1KnownGoodResultLocation;
    if (!byFile.has(location)) {
      const path =
        location.startsWith('study-content/') || location.startsWith('.')
          ? location
          : join(RUNS_DIR, location);
      if (!existsSync(path)) continue;
      const rows = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(stripUtf8Bom(line)) as AiStudyMapResult);
      byFile.set(location, rows);
    }
  }
  const byJobId = new Map<string, AiStudyMapResult>();
  for (const [location, rows] of byFile.entries()) {
    void location;
    for (const row of rows) byJobId.set(row.jobId, row);
  }
  return byJobId;
};

const renderMarkdown = (
  audit: Record<string, unknown>,
  meta: { run: string; comparisonSet: string; reviewSize: number },
): string => {
  const reliability = audit.reliability as Record<string, unknown>;
  const structure = audit.structure as Record<string, unknown>;
  const concision = audit.concision as Record<string, unknown>;
  const v1 = audit.v1Comparison as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`# Local Study Map run audit — ${meta.run}`, '');
  lines.push(
    `- comparison set: \`${meta.comparisonSet}\``,
    `- comparison set sha256: \`${String(audit.sampleSha256 ?? 'n/a')}\``,
    `- review bundle size: ${meta.reviewSize}`,
  );
  const section = (title: string): void => {
    lines.push('', `## ${title}`, '');
  };
  const table = (entries: Record<string, number> | undefined): void => {
    if (entries === undefined) return;
    for (const [key, value] of Object.entries(entries).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      lines.push(`- \`${key}\`: ${value}`);
    }
  };
  section('Reliability');
  lines.push(
    `- accepted: ${String(reliability.acceptedJobs)}/${String(reliability.selectedJobs)} (rate ${String(reliability.acceptanceRate)})`,
    `- first-try accepted: ${String(reliability.firstTryAccepted)}; first-semantic-attempt accepted: ${String(reliability.firstSemanticAttemptAccepted)}`,
    `- semantic: retry jobs ${String(reliability.semanticRetryJobs)}; accepted after semantic retry ${String(reliability.acceptedAfterSemanticRetry)}; recovery rate ${String(reliability.semanticRecoveryRate)}`,
    `- provider: accepted after provider recovery ${String(reliability.acceptedAfterProviderRecovery)}`,
    `- permanently failed: ${String(reliability.permanentlyFailed)} = ${String(reliability.semanticPermanentFailures)} semantic + ${String(reliability.providerIncompleteJobs)} provider-incomplete`,
    `- total attempts: ${String(reliability.totalAttempts)} (extra attempts: ${String(reliability.extraAttempts)}; semantic: ${String(reliability.semanticAttemptsTotal)}, provider: ${String(reliability.providerAttemptsTotal)})`,
    `- retry introduced a different error: ${String(reliability.retryIntroducedDifferentErrorCount)} job(s)`,
    `- repeated identical error across attempts: ${String(reliability.repeatedIdenticalErrorCount)} job(s)`,
  );
  const provider = audit.provider as Record<string, unknown> | undefined;
  if (provider !== undefined) {
    lines.push(
      '',
      `Provider reliability (from reports/provider-events.jsonl):`,
    );
    lines.push(`- telemetry present: ${String(provider.telemetryPresent)}; malformed lines: ${String(provider.malformedLines)}`);
    lines.push(`- provider events: ${String(provider.events)}; recovered: ${String(provider.recovered)}; run-aborted: ${String(provider.runAborted)}`);
    const providerByCode = provider.byCode as Record<string, number> | undefined;
    if (providerByCode) table(providerByCode);
    if (typeof provider.note === 'string') lines.push(`- note: ${provider.note}`);
  }
  const perCode = reliability.perErrorCode as Array<Record<string, unknown>>;
  if (perCode.length > 0) {
    lines.push(
      '',
      '| error code | failed attempts | recovered jobs | recovery rate |',
      '| --- | ---: | ---: | ---: |',
    );
    for (const entry of perCode) {
      lines.push(
        `| \`${String(entry.code)}\` | ${String(entry.failedAttempts)} | ${String(entry.recoveredJobs)} | ${String(entry.recoveryRate)} |`,
      );
    }
  }
  if ((reliability.permanentlyFailedJobs as unknown[]).length > 0) {
    lines.push('', 'Permanent failures:', '');
    for (const entry of reliability.permanentlyFailedJobs as Array<Record<string, unknown>>) {
      const codes = (entry.issueCodes as string[]).join(', ') || 'no semantic validation codes';
      lines.push(
        `- \`${String(entry.jobId)}\` [${String(entry.origin)}] after ${String(entry.attempts)} attempts ` +
          `(${String(entry.semanticAttempts)} semantic / ${String(entry.providerAttempts)} provider): ${codes}`,
      );
    }
  }
  section('Structure');
  table((structure.dispositions as Record<string, number>) ?? undefined);
  lines.push('', 'Confidence:');
  table((structure.confidence as Record<string, number>) ?? undefined);
  lines.push('', 'Priority:');
  table((structure.priorities as Record<string, number>) ?? undefined);
  const finalValidation = structure.finalValidation as Record<string, unknown>;
  lines.push(
    '',
    `- final validation errors: ${String(finalValidation.errors)}`,
    `- broad-focus warnings: ${String(finalValidation.broadFocusWarnings)}; unbounded-focus warnings: ${String(finalValidation.unboundedFocusWarnings)}; structured-field leakage warnings: ${String(finalValidation.structuredFieldLeakageWarnings)}`,
    `- total groups: ${String(structure.totalGroups)}; group count stats: ${(structure.groupCount as Record<string, number>)['median'] ?? 'n/a'} median`,
  );
  section('Concision');
  const concisionBlock = (label: string, block: Record<string, unknown>): void => {
    lines.push(
      `- ${label}: mean ${String(block.mean)}, median ${String(block.median)}, p95 ${String(block.p95)}, max ${String(block.max)}, over threshold ${String(block.overThreshold)}`,
    );
  };
  concisionBlock('reason words', concision.reason as Record<string, unknown>);
  concisionBlock('group reason words', concision.groupReason as Record<string, unknown>);
  concisionBlock(
    'learning goal words',
    concision.approximateLearningGoal as Record<string, unknown>,
  );
  section('Hygiene');
  const hygiene = audit.hygiene as Array<Record<string, unknown>>;
  if (hygiene.length === 0) lines.push('No hygiene findings.');
  for (const finding of hygiene) {
    lines.push(
      `- \`${String(finding.jobId)}\` ${String(finding.field)} [${String(finding.pattern)}]: ${String(finding.snippet)}`,
    );
  }
  section('V1 comparison (descriptive only)');
  lines.push(`- ${String(v1.note)}`);
  lines.push(
    `- comparable: ${String(v1.comparable)}; disposition same/diff: ${String(v1.dispositionSame)}/${String(v1.dispositionDiff)}`,
    `- group count same/diff: ${String(v1.groupCountSame)}/${String(v1.groupCountDiff)}; confidence same/diff: ${String(v1.confidenceSame)}/${String(v1.confidenceDiff)}`,
    '- full comparable V1 rows: `reports/v1-comparable-results.jsonl` (same comparability predicate, deterministic order)',
  );
  section('Review bundle');
  lines.push(
    `- entries: ${String(audit.reviewBundleEntries)} (size cap ${meta.reviewSize})`,
    '- see `semantic-review-bundle.jsonl` (same directory)',
  );
  lines.push(
    '',
    'Files: `map-run-audit.json`, `map-run-audit.md`, `semantic-review-bundle.jsonl`, `v1-comparable-results.jsonl`.',
  );
  return `${lines.join('\n')}\n`;
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(AUDIT_MAP_RUN_HELP);
    return;
  }
  const args = parseArgs(argv);
  const runDir = resolveRunPath(args.run);
  const comparisonSet = JSON.parse(readFileSync(args.comparisonSet, 'utf8')) as ComparisonSet;
  const baseRunId = comparisonSet.baseRunId ?? comparisonSet.v2RunId ?? '';
  if (!baseRunId) throw new Error('comparison set has no baseRunId/v2RunId');
  const baseJobs = loadBaseJobs(baseRunId);

  const results = loadRunResults(runDir);
  const attempts = loadRunAttempts(runDir);
  const problems: string[] = [
    ...results.malformed.map((entry) => `malformed result line: ${entry}`),
  ];
  for (const jobId of results.duplicates) problems.push(`duplicate result for ${jobId}`);
  for (const entry of attempts.malformed) problems.push(`malformed failure record: ${entry}`);

  const missingBaseJobs = comparisonSet.jobs
    .map((entry) => entry.v2JobId)
    .filter((jobId) => !baseJobs.has(jobId));
  for (const jobId of missingBaseJobs)
    problems.push(`selected job missing from base run ${baseRunId}: ${jobId}`);

  const { records, problems: collectionProblems } = collectJobAuditRecords({
    comparisonSet,
    baseJobs,
    resultsByJob: results.resultsByJob,
    resultRunId: args.run,
    attemptsByJob: attempts.attemptsByJob,
  });
  problems.push(...collectionProblems);
  for (const record of records) {
    record.provenance = loadProvenanceSummary(runDir, record.jobId);
  }
  if (problems.length > 0) {
    console.error('Integrity problems in audited run:');
    problems.forEach((problem) => console.error(`  - ${problem}`));
    process.exitCode = 1;
    return;
  }

  const finalValidation = new Map<string, NormalizedIssue[]>();
  for (const record of records) {
    if (record.result === null) continue;
    const report = validateAiStudyMapResult(record.result, baseJobs.get(record.jobId));
    finalValidation.set(
      record.jobId,
      report.issues.map((issue) => normalizeIssue(issue)),
    );
  }

  const v1Results = loadV1Results(comparisonSet.jobs);
  const providerTelemetry = loadProviderEvents(runDir);
  const reliability = computeReliability(records);
  const structure = computeStructureMetrics(records, finalValidation);
  const concision = computeConcision(records);
  const hygiene = computeHygiene(records);
  const v1Comparison = computeV1Comparison(
    records,
    new Map(comparisonSet.jobs.map((entry) => [entry.v2JobId, entry])),
    v1Results,
  );
  const bundleSelection = selectReviewBundle(records, args.reviewSize, finalValidation);
  const bundleEntries = bundleSelection.map((selection) =>
    buildReviewBundleEntry({
      record: selection.record,
      tier: selection.tier,
      tierLabel: selection.tierLabel,
      job: baseJobs.get(selection.record.jobId) ?? null,
      setJob: comparisonSet.jobs.find((entry) => entry.v2JobId === selection.record.jobId) ?? null,
      finalIssues: finalValidation.get(selection.record.jobId),
      v1Result: (() => {
        const setJob = comparisonSet.jobs.find((entry) => entry.v2JobId === selection.record.jobId);
        return setJob?.v1JobId ? (v1Results.get(setJob.v1JobId) ?? null) : null;
      })(),
      v1Location:
        comparisonSet.jobs.find((entry) => entry.v2JobId === selection.record.jobId)
          ?.v1KnownGoodResultLocation ?? null,
    }),
  );

  const reportsDir = join(runDir, 'reports');
  const audit = {
    schemaVersion: 1,
    kind: 'study-map-local-run-audit',
    auditedRun: args.run,
    baseRunId,
    comparisonSetPath: args.comparisonSet,
    sampleSha256: comparisonSet.sampleSha256 ?? null,
    reliability,
    provider: {
      telemetryPresent: providerTelemetry.present,
      malformedLines: providerTelemetry.malformed,
      events: providerTelemetry.events.length,
      byCode: countBy(providerTelemetry.events.map((event) => event.code)),
      recovered: providerTelemetry.events.filter((event) => event.recovered).length,
      runAborted: providerTelemetry.events.filter((event) => event.runAborted).length,
      note: providerTelemetry.present
        ? undefined
        : 'No reports/provider-events.jsonl for this run (run predates provider telemetry or had no provider failures).',
    },
    perStratum: computePerStratum(records),
    structure,
    concision,
    hygiene,
    v1Comparison,
    reviewBundleEntries: bundleEntries.length,
  };
  writeFileSync(join(reportsDir, 'map-run-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    join(reportsDir, 'semantic-review-bundle.jsonl'),
    bundleEntries.length > 0
      ? `${bundleEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
      : '',
  );
  // Self-contained comparator export: the FULL V1 result rows for every
  // comparable job (accepted V2 + V1-mapped), in comparison-set order, so a
  // reviewer never has to open the legacy V1 run directory to diff a bundle
  // entry. Mirrors the comparability predicate in computeV1Comparison.
  const v1ComparableRows: string[] = [];
  for (const setJob of comparisonSet.jobs) {
    const record = records.find((entry) => entry.jobId === setJob.v2JobId);
    if (record === undefined || !record.accepted || !setJob.v1JobId) continue;
    const v1 = v1Results.get(setJob.v1JobId);
    if (v1 === undefined) continue;
    v1ComparableRows.push(JSON.stringify(v1));
  }
  writeFileSync(
    join(reportsDir, 'v1-comparable-results.jsonl'),
    v1ComparableRows.length > 0 ? `${v1ComparableRows.join('\n')}\n` : '',
  );
  writeFileSync(join(reportsDir, 'map-run-audit.md'), renderMarkdown(audit, args));
  console.log(
    `Wrote audit reports to ${reportsDir}: ${reliability.acceptedJobs}/${reliability.selectedJobs} accepted, ` +
      `${reliability.permanentlyFailed} permanent failures, ${bundleEntries.length} review-bundle entries.`,
  );
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiAuditMapRunTest = {
  parseArgs,
  loadBaseJobs,
  resolveRunPath,
  loadV1Results,
  renderMarkdown,
  AUDIT_MAP_RUN_HELP,
};
