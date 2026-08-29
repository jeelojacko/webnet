#!/usr/bin/env tsx
/**
 * Deterministic post-Gate-A regression comparison-set builder.
 *
 * Assembles a fixed, named list of regression job ids into a comparison-set
 * JSON consumable by the local authoring runner (`--comparison-set`) and the
 * map-run auditor. Performs NO model inference: it only reads base-run job
 * files and V1 result locations so the set is reproducible byte-for-byte.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildRegressionSet.ts \
 *     --base-run ai-map-4c12-full-corpus-v2 \
 *     --v1-run ai-map-4c1-full-corpus-v1 \
 *     --out study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/post-gate-a-regression-set.json
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';
import { canonicalJson } from '../src/study/ai/studyAiResultContract';
import { categoryForJob, structuralStrataForJob } from './studyAiMapStrata';
import { stripUtf8Bom } from './studyAiProviderFailures';

const RUNS_ROOT = 'study-content/ai/runs';

/** Fixed regression population. Order is significant: it is the output order. */
const REGRESSION_JOBS: Array<{ jobId: string; label: string }> = [
  { jobId: 'map-3f89b1579eed6e71', label: 'failed-condominium-definitions-s1' },
  { jobId: 'map-562652e92d734a71', label: 'failed-highway-usage-s44-1' },
  { jobId: 'map-a43cade5ef767032', label: 'failed-mineral-powers-s3' },
  { jobId: 'map-a6952a9bdae2fbd5', label: 'failed-quarry-lease-s13' },
  { jobId: 'map-1a03f9105277e012', label: 'coverage-clean-water-advisory-committee-s13-1' },
  { jobId: 'map-58f1b0aaaa8b8304', label: 'coverage-fatal-accidents-amendments-s33' },
  { jobId: 'map-5e9676e19700f457', label: 'wording-devolution-part-ii-application-s21' },
  { jobId: 'map-392f73706a5a4c29', label: 'actor-narrowing-bituminous-shale-enforcement-s27' },
  { jobId: 'map-6425c3270b73132a', label: 'truncation-reg-83-130-s7' },
  { jobId: 'map-405adff8d1dea7a9', label: 'acronym-lgic-gas-distribution-s4' },
  { jobId: 'map-039fba57591b50bf', label: 'control-gas-distribution-s12' },
];

const HELP = `Deterministic post-Gate-A regression comparison-set builder (no inference).

Usage:
  npx tsx scripts/studyAiBuildRegressionSet.ts --base-run <runId> --v1-run <runId> --out <path>

  --base-run <id>   Base v2 full-corpus run id whose jobs/ directory holds the job files.
  --v1-run <id>     V1 run id whose results/*.jsonl files supply v1 result locations.
  --out <path>      Output comparison-set JSON path (parent dir must exist).`;

const hashText = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const valueFor = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const loadBaseJobs = (baseRun: string): Map<string, AiStudyMapJob> => {
  const jobsDir = join(RUNS_ROOT, baseRun, 'jobs');
  const byId = new Map<string, AiStudyMapJob>();
  for (const file of readdirSync(jobsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
    const lines = stripUtf8Bom(readFileSync(join(jobsDir, file), 'utf8')).split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const job = JSON.parse(line) as AiStudyMapJob;
      byId.set(job.jobId, job);
    }
  }
  return byId;
};

/** jobId -> '<v1Run>/results/<file>' for every job id present in V1 results. */
const loadV1Locations = (v1Run: string): Map<string, string> => {
  const resultsDir = join(RUNS_ROOT, v1Run, 'results');
  const locations = new Map<string, string>();
  for (const file of readdirSync(resultsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
    const lines = stripUtf8Bom(readFileSync(join(resultsDir, file), 'utf8')).split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const jobId = (JSON.parse(line) as { jobId?: unknown }).jobId;
      if (typeof jobId === 'string' && !locations.has(jobId)) {
        locations.set(jobId, `${v1Run}/results/${file}`);
      }
    }
  }
  return locations;
};

const countBy = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const baseRun = valueFor(argv, '--base-run') ?? '';
  const v1Run = valueFor(argv, '--v1-run') ?? '';
  const out = valueFor(argv, '--out') ?? '';
  if (!baseRun || !v1Run || !out) {
    console.error(HELP);
    process.exit(1);
  }

  const baseJobs = loadBaseJobs(baseRun);
  const missing = REGRESSION_JOBS.filter((entry) => !baseJobs.has(entry.jobId)).map(
    (entry) => entry.jobId,
  );
  if (missing.length > 0) {
    throw new Error(`base run ${baseRun} is missing regression jobs: ${missing.join(', ')}`);
  }
  const v1Locations = loadV1Locations(v1Run);

  const entries = REGRESSION_JOBS.map(({ jobId, label }) => {
    const job = baseJobs.get(jobId) as AiStudyMapJob;
    const v1JobId = v1Locations.has(jobId) ? jobId : undefined;
    return {
      v2JobId: jobId,
      document: {
        documentId: job.document.documentId,
        title: job.document.title,
        citation: job.document.citation,
        type: job.document.type,
      },
      target: job.target.sectionLabels.join(', '),
      sourceKey: job.target.sourceKeys[0],
      componentType: job.target.componentType,
      auditType: job.document.type,
      complexityCategory: categoryForJob(job),
      structuralStrata: structuralStrataForJob(job),
      reasonSelected: `regression:${label}`,
      v1JobId,
      v1KnownGoodResultLocation: v1Locations.get(jobId),
      v1ResultIdentity: v1JobId ? `${v1Run}:${v1JobId}` : undefined,
      v2Fingerprint: job.authoringInputFingerprint,
    };
  });

  const documentCounts = new Map<string, number>();
  for (const entry of entries) {
    documentCounts.set(entry.document.documentId, (documentCounts.get(entry.document.documentId) ?? 0) + 1);
  }
  const documentDistribution = [...documentCounts.entries()]
    .map(([documentId, count]) => {
      const entry = entries.find((candidate) => candidate.document.documentId === documentId) as {
        document: { documentId: string; title: string; citation: string; type: string };
      };
      return {
        documentId,
        title: entry.document.title,
        type: entry.document.type,
        citation: entry.document.citation,
        eligible: count,
        initialQuota: count,
        finalQuota: count,
        topUp: 0,
      };
    })
    .sort((a, b) => (a.documentId < b.documentId ? -1 : 1));

  const set = {
    schemaVersion: 1,
    kind: 'study-map-stratified-comparison-set',
    selectionAlgorithm: 'post-gate-a-regression-set-v1',
    baseRunId: baseRun,
    v2RunId: baseRun,
    seed: 'post-gate-a-regression-v1',
    requestedSize: REGRESSION_JOBS.length,
    perDocumentQuota: 0,
    size: entries.length,
    sampleSha256: hashText(canonicalJson(entries.map((entry) => entry.v2JobId))),
    v1Run,
    documentDistribution,
    categoryCoverage: countBy(entries.flatMap((entry) => entry.complexityCategory)),
    structuralCoverage: countBy(entries.flatMap((entry) => entry.structuralStrata)),
    unmetCoverageNotes: [],
    jobs: entries,
  };

  writeFileSync(out, `${JSON.stringify(set, null, 2)}\n`);
  console.log(
    `Wrote ${entries.length}-job regression comparison set to ${out} (sha256 ${set.sampleSha256.slice(0, 16)}…).`,
  );
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiBuildRegressionSetTest = { REGRESSION_JOBS, HELP, hashText, loadBaseJobs, loadV1Locations };
