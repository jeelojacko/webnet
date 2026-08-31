#!/usr/bin/env tsx
/**
 * Deterministic final-production retry-set builder. No inference.
 *
 * Derives the still-pending jobs of the canonical full-corpus production run as:
 *     retrySet = base jobs (3,692) − currently-accepted results
 * and fail-closes unless exactly the pinned nine job identities remain. The
 * output is a runner-consumable set (`jobs[].v2JobId` for
 * scripts/studyAiLocalMapAuthor.ts) plus a Markdown companion and the SHA-256
 * of the written JSON file.
 *
 * Determinism: jobId-ascending output order, plain-string sorts, no wall-clock
 * timestamps, no randomness. Fail-closed on wrong base size, wrong remaining
 * count, identity mismatch, or a retry job missing from the prepared
 * full-corpus comparison set.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildFinalRetrySet.ts [--base-run <runId>]
 *     [--base-dir <dir>] [--date YYYYMMDD] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';
import { authoringInputFingerprint } from './studyAiFingerprint';
import { stripUtf8Bom } from './studyAiProviderFailures';

const RUNS_ROOT = 'study-content/ai/runs';
export const DEFAULT_BASE_RUN =
  'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
export const DEFAULT_SET_DATE = '20260831';
export const EXPECTED_BASE_SIZE = 3692;
export const EXPECTED_RETRY_SIZE = 9;

/** Pinned retry population: every permanent semantic failure of the 2026-08-31
 * canonical audit, with the job identity that must hold at build time. */
const PinnedJobRaw = [
  ['map-1c37c940368bec16', 'doc-municipalities-act', 'Municipalities Act', ['section:100'], ['100']],
  ['map-1fa5a6239a1f7144', 'doc-community-planning-act', 'Community Planning Act', ['section:1'], ['1']],
  ['map-208559fbf2dbeffa', 'doc-mining-act', 'Mining Act', ['section:68'], ['68']],
  ['map-33a01d563229d6dd', 'doc-gas-distribution-act', 'Gas Distribution Act, 1999', ['section:52'], ['52']],
  ['map-56bae66370b899b1', 'doc-community-planning-act', 'Community Planning Act', ['section:75'], ['75']],
  ['map-59704851a9e697bf', 'doc-occupational-health-and-safety-act', 'Occupational Health and Safety Act', ['section:9'], ['9']],
  ['map-6c9e861025a7bfa4', 'doc-property-act', 'Property Act', ['section:44'], ['44']],
  ['map-7ae41a2728f7e83b', 'doc-assessment-act', 'Assessment Act', ['section:15.3'], ['15.3']],
  ['map-845a5dc610f4fb39', 'doc-registry-act', 'Registry Act', ['section:44'], ['44']],
] as const;

export const PINNED_JOBS = PinnedJobRaw.map(([jobId, documentId, title, sourceKeys, sectionLabels]) => ({
  jobId,
  documentId,
  title,
  sourceKeys,
  sectionLabels,
}));

const HELP = `Deterministic final-production retry-set builder (no inference).

Usage:
  npx tsx scripts/studyAiBuildFinalRetrySet.ts [--base-run <runId>]
    [--base-dir <dir>] [--date YYYYMMDD] [--dry-run]

  --base-run <id>   Production run id. Default: ${DEFAULT_BASE_RUN}
  --base-dir <dir>  Runs root directory. Default: ${RUNS_ROOT}
  --date YYYYMMDD   Set date embedded in the output file name. Default: ${DEFAULT_SET_DATE}
  --dry-run         Resolve and print the retry set; write nothing.`;

const valueFor = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

export type RetrySetEntry = {
  v2JobId: string;
  document: { documentId: string; title: string };
  sourceKeys: string[];
  sectionLabels: string[];
  authoringInputFingerprint: string;
  finalFailureIssueCodes: string[];
};

export type RetrySetFile = {
  schemaVersion: number;
  kind: string;
  baseRunId: string;
  date: string;
  size: number;
  selectionRule: string;
  preparedBase: { path: string; size: number; sha256: string };
  jobs: RetrySetEntry[];
};

const loadBaseJobs = (baseDir: string, runId: string): Map<string, AiStudyMapJob> => {
  const jobsDir = join(baseDir, runId, 'jobs');
  if (!existsSync(jobsDir)) throw new Error(`base run jobs directory not found: ${jobsDir}`);
  const byId = new Map<string, AiStudyMapJob>();
  for (const file of readdirSync(jobsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
    for (const line of stripUtf8Bom(readFileSync(join(jobsDir, file), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const job = JSON.parse(line) as AiStudyMapJob;
      if (byId.has(job.jobId)) throw new Error(`duplicate jobId in base run: ${job.jobId}`);
      byId.set(job.jobId, job);
    }
  }
  if (byId.size !== EXPECTED_BASE_SIZE) {
    throw new Error(`base run ${runId} has ${byId.size} jobs, expected ${EXPECTED_BASE_SIZE}`);
  }
  return byId;
};

const loadAcceptedJobIds = (baseDir: string, runId: string): Set<string> => {
  const resultsPath = join(baseDir, runId, 'results', 'local-map.results.jsonl');
  if (!existsSync(resultsPath)) throw new Error(`results file not found: ${resultsPath}`);
  const accepted = new Set<string>();
  for (const line of stripUtf8Bom(readFileSync(resultsPath, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const result = JSON.parse(line) as { jobId: string };
    if (accepted.has(result.jobId)) throw new Error(`duplicate accepted result: ${result.jobId}`);
    accepted.add(result.jobId);
  }
  return accepted;
};

const lastFailureCodes = (baseDir: string, runId: string, jobId: string): string[] => {
  const dir = join(baseDir, runId, 'local-failures', jobId);
  if (!existsSync(dir)) return [];
  const attempts = readdirSync(dir)
    .filter((name) => /^attempt-\d+\.validation\.json$/.test(name))
    .map((name) => Number(name.match(/^attempt-(\d+)/)![1]));
  if (attempts.length === 0) return [];
  const last = attempts.sort((a, b) => a - b).at(-1)!;
  const report = JSON.parse(
    stripUtf8Bom(readFileSync(join(dir, `attempt-${last}.validation.json`), 'utf8')),
  ) as { issues?: Array<string | { code?: string }> };
  const codes = (report.issues ?? [])
    .map((issue) => (typeof issue === 'string' ? issue.split(':')[0] : issue.code))
    .filter((code): code is string => typeof code === 'string' && code.length > 0);
  return [...new Set(codes)].sort();
};

const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const sortedKeys = (keys: string[]): string[] => [...keys].sort();

const identityMatches = (job: AiStudyMapJob, pinned: (typeof PINNED_JOBS)[number]): boolean =>
  job.document.documentId === pinned.documentId &&
  job.document.title === pinned.title &&
  JSON.stringify(sortedKeys(job.target.sourceKeys)) ===
    JSON.stringify(sortedKeys([...pinned.sourceKeys])) &&
  JSON.stringify(job.target.sectionLabels) === JSON.stringify([...pinned.sectionLabels]);

const renderMarkdown = (set: RetrySetFile): string => {
  const lines: string[] = [
    `# Final production retry set (${set.size} jobs)`,
    '',
    `- Base run: \`${set.baseRunId}\``,
    `- Date: ${set.date}`,
    '- Selection rule: base jobs minus currently-accepted results; exactly the nine canonical permanent semantic failures remain.',
    `- Prepared base: \`${set.preparedBase.path}\` (${set.preparedBase.size} jobs, sha256 ${set.preparedBase.sha256})`,
    '',
    '| # | v2JobId | document | sourceKeys | final failure codes |',
    '| --- | --- | --- | --- | --- |',
  ];
  set.jobs.forEach((job, index) => {
    lines.push(
      `| ${index + 1} | ${job.v2JobId} | ${job.document.documentId} | ${job.sourceKeys.join(', ')} | ${job.finalFailureIssueCodes.join(', ') || '-'} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const baseRun = valueFor(argv, '--base-run') ?? DEFAULT_BASE_RUN;
  const baseDir = valueFor(argv, '--base-dir') ?? RUNS_ROOT;
  const date = valueFor(argv, '--date') ?? DEFAULT_SET_DATE;
  const dryRun = argv.includes('--dry-run');

  const baseJobs = loadBaseJobs(baseDir, baseRun);
  const accepted = loadAcceptedJobIds(baseDir, baseRun);

  const remaining = [...baseJobs.keys()].filter((jobId) => !accepted.has(jobId)).sort();
  if (remaining.length !== EXPECTED_RETRY_SIZE) {
    throw new Error(
      `base run has ${remaining.length} jobs without an accepted result, expected ${EXPECTED_RETRY_SIZE}: ${remaining.join(', ')}`,
    );
  }
  const pinnedById = new Map(PINNED_JOBS.map((spec) => [spec.jobId, spec]));
  if (remaining.some((jobId) => !pinnedById.has(jobId))) {
    throw new Error(
      `remaining jobs are not the pinned nine: ${remaining.filter((jobId) => !pinnedById.has(jobId)).join(', ')}`,
    );
  }

  const preparedBasePath = join(baseDir, baseRun, 'reports', 'full-corpus-comparison-set.json');
  const preparedBase = JSON.parse(
    stripUtf8Bom(readFileSync(preparedBasePath, 'utf8')),
  ) as { size?: number; jobs?: Array<{ v2JobId?: string }> };
  const preparedJobIds = new Set((preparedBase.jobs ?? []).map((entry) => entry.v2JobId));
  if ((preparedBase.jobs ?? []).length !== EXPECTED_BASE_SIZE) {
    throw new Error('prepared full-corpus comparison set does not list 3692 jobs');
  }

  const entries: RetrySetEntry[] = remaining.map((jobId) => {
    const job = baseJobs.get(jobId)!;
    const pinned = pinnedById.get(jobId)!;
    if (!identityMatches(job, pinned)) {
      throw new Error(
        `identity mismatch for ${jobId}: expected ${pinned.documentId} ${JSON.stringify(pinned.sourceKeys)}, got ${job.document.documentId} ${JSON.stringify(job.target.sourceKeys)}`,
      );
    }
    if (!preparedJobIds.has(jobId)) {
      throw new Error(`retry job ${jobId} is missing from the prepared full-corpus comparison set`);
    }
    return {
      v2JobId: jobId,
      document: { documentId: job.document.documentId, title: job.document.title },
      sourceKeys: sortedKeys(job.target.sourceKeys),
      sectionLabels: [...job.target.sectionLabels],
      authoringInputFingerprint: authoringInputFingerprint(job),
      finalFailureIssueCodes: lastFailureCodes(baseDir, baseRun, jobId),
    };
  });

  const set: RetrySetFile = {
    schemaVersion: 1,
    kind: 'final-production-retry-set',
    baseRunId: baseRun,
    date,
    size: entries.length,
    selectionRule:
      'canonical prepared base jobs (3692) minus currently-accepted results; ' +
      'must equal exactly the nine pinned permanent semantic failures',
    preparedBase: {
      path: preparedBasePath,
      size: preparedBase.size ?? EXPECTED_BASE_SIZE,
      sha256: sha256File(preparedBasePath),
    },
    jobs: entries,
  };

  if (dryRun) {
    for (const entry of set.jobs) {
      console.log(`${entry.v2JobId} ${entry.document.documentId} ${entry.sourceKeys.join(',')}`);
    }
    console.log(`dry run: ${set.size} retry jobs; nothing written.`);
    return;
  }

  const outDir = join(baseDir, baseRun, 'reports');
  const outName = `final-production-retry-${set.size}-${date}.json`;
  const outPath = join(outDir, outName);
  writeFileSync(outPath, `${JSON.stringify(set, null, 2)}\n`);
  writeFileSync(outPath.replace(/\.json$/, '.md'), renderMarkdown(set));
  console.log(`Wrote ${outPath}`);
  console.log(`sha256 ${sha256File(outPath)}`);
  console.log(`size ${set.size}`);
};

main();
