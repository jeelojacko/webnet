#!/usr/bin/env tsx
/**
 * Deterministic final Study Map regression-set builder (15 jobs). No inference.
 *
 * Assembles a fixed, named list of 14 regression jobs from a prepared base run
 * plus one "unseen consequential-amendment" job (the lexicographically-smallest
 * jobId among base-run consequentialAmendment jobs that are neither part of the
 * pinned 14 nor present in the Gate A / Gate B / post-Gate-A regression
 * exclusion sets). The result is a runner-consumable set (`jobs[].v2JobId` for
 * scripts/studyAiLocalMapAuthor.ts applySelection) plus a Markdown companion.
 *
 * Determinism: fixed job order, plain-string jobId sort for candidates, no
 * wall-clock timestamps, no randomness. Fail-closed on missing/duplicate jobs,
 * identity mismatch, missing exclusion files, or wrong exclusion counts.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildFinalRegressionSet.ts \
 *     [--base-run <runId>] [--base-dir <dir>] [--out <dir>] [--dry-run]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';
import { stripUtf8Bom } from './studyAiProviderFailures';

const RUNS_ROOT = 'study-content/ai/runs';
export const DEFAULT_BASE_RUN = 'ai-map-2026-08-29T12-23-57-891Z';
export const SET_DATE = '2026-08-29';
export const SELECTION_RULE =
  '14 pinned regression jobs in fixed order plus the lexicographically-smallest jobId ' +
  'among base-run consequentialAmendment jobs excluding the pinned 14 and all ' +
  'Gate A / Gate B / post-Gate-A regression exclusion-set jobs';

/** Fixed 14-job regression population. Order is significant: it is the output order. */
const FIXED_JOBS_RAW: Array<[string, string, string, string[]]> = [
  ['map-a266db00836863a7', 'leak-bca-s20', 'doc-boundaries-confirmation-act', ['section:20']],
  ['map-f932c1fe40ea83a3', 'static-boundary-tda-s6', 'doc-territorial-division-act', ['section:6']],
  ['map-30a62b622ff6bca5', 'static-boundary-tda-s19', 'doc-territorial-division-act', ['section:19']],
  ['map-972f43510c026076', 'boundary-control-surveys-s13', 'doc-surveys-act', ['section:13']],
  ['map-d44c63432f5d1900', 'p1-nbls-s16-1', 'doc-new-brunswick-land-surveyors-act', ['section:16(1)']],
  ['map-f2af93d80f832e89', 'p1-surveys-s4', 'doc-surveys-act', ['section:4']],
  ['map-1058e56221d4e85b', 'p1-reg-84-76-s3', 'reg-surveys-84-76', ['section:3']],
  ['map-ed3f74e6ccd6099c', 'p1-reg-95-166-s3', 'reg-boundaries-95-166', ['section:3']],
  ['map-b2e44c7723caab2b', 'p1-land-titles-s16', 'doc-land-titles-act', ['section:16']],
  ['map-c78b434562a0b8a9', 'p1-registry-s50', 'doc-registry-act', ['section:50']],
  ['map-f533ea19ec124317', 'p2-cpa-s25', 'doc-community-planning-act', ['section:25']],
  ['map-7511a95ba0a65901', 'p2-registry-s55', 'doc-registry-act', ['section:55']],
  ['map-97da9b45be9f1d85', 'mixed-repeal-reg-83-130-s10', 'reg-land-titles-83-130', ['section:10']],
  ['map-022de9af0c2cc613', 'surveys-s14-non-geographic', 'doc-surveys-act', ['section:14']],
];

export const FIXED_JOBS: Array<{
  jobId: string;
  label: string;
  expectedDocumentId: string;
  expectedSourceKeys: string[];
}> = FIXED_JOBS_RAW.map(([jobId, label, expectedDocumentId, expectedSourceKeys]) => ({
  jobId,
  label,
  expectedDocumentId,
  expectedSourceKeys,
}));

const HELP = `Deterministic final Study Map regression-set builder (no inference).

Usage:
  npx tsx scripts/studyAiBuildFinalRegressionSet.ts [--base-run <runId>] [--base-dir <dir>] [--out <dir>] [--dry-run]

  --base-run <id>   Base run id whose jobs/ directory holds the job files.
                    Default: ${DEFAULT_BASE_RUN}
  --base-dir <dir>  Runs root directory. Default: ${RUNS_ROOT}
  --out <dir>       Output directory (JSON + Markdown). Default: <base-dir>/<runId>/reports
  --dry-run         Print the resolved jobIds + labels and write nothing.`;

export type FinalRegressionJobLike = {
  jobId: string;
  document: { documentId: string; title: string };
  target: {
    sourceKeys: string[];
    contentFlags?: { consequentialAmendment?: boolean };
  };
  authoringInputFingerprint?: string;
};

export type FixedJobSpec = {
  jobId: string;
  label: string;
  expectedDocumentId: string;
  expectedSourceKeys: string[];
};

export type FinalRegressionEntry = {
  v2JobId: string;
  label: string;
  document: { documentId: string; title: string };
  target: string;
  sourceKey: string;
  authoringInputFingerprint?: string;
  reasonSelected: string;
};

export type FinalRegressionInput = {
  jobs: FinalRegressionJobLike[];
  fixedJobs: FixedJobSpec[];
  exclusionJobIds: Set<string>;
};

export type FinalRegressionResult = {
  jobs: FinalRegressionEntry[];
  selectedJobId: string;
};

const valueFor = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const entryFor = (
  job: FinalRegressionJobLike,
  label: string,
  reasonSelected: string,
): FinalRegressionEntry => {
  const sourceKey = job.target.sourceKeys[0];
  if (!sourceKey) throw new Error(`job ${job.jobId} has no sourceKeys`);
  return {
    v2JobId: job.jobId,
    label,
    document: { documentId: job.document.documentId, title: job.document.title },
    target: sourceKey.replace(/^section:/, ''),
    sourceKey,
    authoringInputFingerprint: job.authoringInputFingerprint,
    reasonSelected,
  };
};

const sortedIdentity = (keys: string[]): string[] => [...keys].sort();

const identityMatches = (
  job: FinalRegressionJobLike,
  spec: FixedJobSpec,
): boolean => {
  const actual = sortedIdentity(job.target.sourceKeys);
  const expected = sortedIdentity(spec.expectedSourceKeys);
  return (
    job.document.documentId === spec.expectedDocumentId &&
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

/**
 * Pure core: resolve the pinned 14, pick the unseen consequential-amendment
 * job, and return the ordered entries. Throws (fail-closed) on any mismatch.
 */
export const buildFinalRegressionSet = (
  input: FinalRegressionInput,
): FinalRegressionResult => {
  const { jobs, fixedJobs, exclusionJobIds } = input;

  const byId = new Map<string, FinalRegressionJobLike>();
  for (const job of jobs) {
    if (byId.has(job.jobId)) {
      throw new Error(`duplicate jobId in corpus: ${job.jobId}`);
    }
    byId.set(job.jobId, job);
  }
  const fixedIds = new Set(fixedJobs.map((spec) => spec.jobId));
  if (fixedIds.size !== fixedJobs.length) {
    throw new Error('fixed job list contains duplicate jobIds');
  }

  const resolved: Array<{ job: FinalRegressionJobLike; label: string; reasonSelected: string }> =
    [];
  for (const spec of fixedJobs) {
    const job = byId.get(spec.jobId);
    if (!job) throw new Error(`fixed regression job missing from base run: ${spec.jobId}`);
    if (!identityMatches(job, spec)) {
      throw new Error(
        `fixed regression job identity mismatch for ${spec.jobId}: expected ` +
          `${spec.expectedDocumentId} ${JSON.stringify(sortedIdentity(spec.expectedSourceKeys))}, ` +
          `got ${job.document.documentId} ${JSON.stringify(sortedIdentity(job.target.sourceKeys))}`,
      );
    }
    resolved.push({ job, label: spec.label, reasonSelected: `regression:${spec.label}` });
  }

  const candidates = jobs
    .filter(
      (job) =>
        job.target.contentFlags?.consequentialAmendment === true &&
        !fixedIds.has(job.jobId) &&
        !exclusionJobIds.has(job.jobId),
    )
    .map((job) => job.jobId)
    .sort();
  if (candidates.length === 0) {
    throw new Error('no unseen consequentialAmendment candidate remains after exclusions');
  }
  const selectedJobId = candidates[0];
  const selected = byId.get(selectedJobId);
  if (!selected) throw new Error(`selected candidate missing: ${selectedJobId}`);

  const entries: FinalRegressionEntry[] = [
    ...resolved.map(({ job, label, reasonSelected }) => entryFor(job, label, reasonSelected)),
    entryFor(
      selected,
      'unseen-consequential-amendment',
      'regression:unseen-consequential-amendment',
    ),
  ];
  const unique = new Set(entries.map((entry) => entry.v2JobId));
  if (unique.size !== entries.length) {
    throw new Error('final regression set contains duplicate jobIds');
  }
  return { jobs: entries, selectedJobId };
};

const loadBaseJobs = (baseDir: string, runId: string): Map<string, AiStudyMapJob> => {
  const jobsDir = join(baseDir, runId, 'jobs');
  if (!existsSync(jobsDir)) {
    throw new Error(`base run jobs directory not found: ${jobsDir}`);
  }
  const byId = new Map<string, AiStudyMapJob>();
  for (const file of readdirSync(jobsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
    const lines = stripUtf8Bom(readFileSync(join(jobsDir, file), 'utf8')).split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const job = JSON.parse(line) as AiStudyMapJob;
      if (byId.has(job.jobId)) throw new Error(`duplicate jobId in base run: ${job.jobId}`);
      byId.set(job.jobId, job);
    }
  }
  if (byId.size === 0) throw new Error(`base run ${runId} has no jobs`);
  return byId;
};

type ExclusionSetKey = 'gateA200' | 'gateB100' | 'postGateARegression11';

const exclusionSpecsFor = (baseDir: string, runId: string): Array<{
  key: ExclusionSetKey;
  path: string;
  expectedCount: number;
}> => [
  {
    key: 'gateA200',
    path: join(baseDir, 'ai-map-4c12-full-corpus-v2', 'reports', 'stratified-200-seed-20260828.json'),
    expectedCount: 200,
  },
  {
    key: 'gateB100',
    path: join(baseDir, runId, 'reports', 'gate-b-surveying-100-seed-20260829.json'),
    expectedCount: 100,
  },
  {
    key: 'postGateARegression11',
    path: join(baseDir, 'ai-map-4c12-full-corpus-v2', 'reports', 'post-gate-a-regression-set.json'),
    expectedCount: 11,
  },
];

const loadExclusionSets = (
  baseDir: string,
  runId: string,
): { exclusions: Record<ExclusionSetKey, { path: string; count: number }>; jobIds: Set<string> } => {
  const exclusions = {} as Record<ExclusionSetKey, { path: string; count: number }>;
  const jobIds = new Set<string>();
  for (const spec of exclusionSpecsFor(baseDir, runId)) {
    if (!existsSync(spec.path)) throw new Error(`exclusion file missing: ${spec.path}`);
    const data = JSON.parse(stripUtf8Bom(readFileSync(spec.path, 'utf8'))) as {
      jobs?: Array<{ v2JobId?: string }>;
    };
    const entries = data.jobs ?? [];
    if (entries.length !== spec.expectedCount) {
      throw new Error(
        `exclusion file ${spec.path} has ${entries.length} jobs, expected exactly ${spec.expectedCount}`,
      );
    }
    for (const entry of entries) {
      if (!entry.v2JobId) throw new Error(`exclusion file ${spec.path} has an entry without v2JobId`);
      jobIds.add(entry.v2JobId);
    }
    exclusions[spec.key] = { path: spec.path, count: entries.length };
  }
  return { exclusions, jobIds };
};

const renderMarkdown = (params: {
  baseRunId: string;
  date: string;
  requestedSize: number;
  size: number;
  selectionRule: string;
  jobs: FinalRegressionEntry[];
}): string => {
  const lines: string[] = [
    `# Final Study Map regression set (${params.size} jobs)`,
    '',
    `- Base run: \`${params.baseRunId}\``,
    `- Date: ${params.date}`,
    `- Requested size: ${params.requestedSize}, actual: ${params.size}`,
    `- Selection rule: ${params.selectionRule}`,
    '',
    '| # | v2JobId | document | sourceKey | coverage | reason |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  params.jobs.forEach((job, index) => {
    lines.push(
      `| ${index + 1} | ${job.v2JobId} | ${job.document.documentId} | ${job.sourceKey} | ` +
        `${job.label} | ${job.reasonSelected} |`,
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
  const outDir = valueFor(argv, '--out') ?? join(baseDir, baseRun, 'reports');
  const dryRun = argv.includes('--dry-run');

  const baseJobs = loadBaseJobs(baseDir, baseRun);
  const { exclusions, jobIds } = loadExclusionSets(baseDir, baseRun);
  const { jobs: entries, selectedJobId } = buildFinalRegressionSet({
    jobs: [...baseJobs.values()],
    fixedJobs: FIXED_JOBS,
    exclusionJobIds: jobIds,
  });

  if (dryRun) {
    for (const entry of entries) console.log(`${entry.v2JobId} ${entry.label}`);
    console.log(
      `dry run: ${entries.length} final regression jobs (selected ${selectedJobId})`,
    );
    return;
  }

  const jsonPath = join(outDir, 'final-regression-15-20260829.json');
  const mdPath = join(outDir, 'final-regression-15-20260829.md');
  const payload = {
    schemaVersion: 1,
    kind: 'final-regression-set',
    date: SET_DATE,
    baseRunId: baseRun,
    requestedSize: FIXED_JOBS.length + 1,
    size: entries.length,
    exclusions,
    selectionRule: SELECTION_RULE,
    jobs: entries,
  };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(
    mdPath,
    renderMarkdown({
      baseRunId: baseRun,
      date: SET_DATE,
      requestedSize: payload.requestedSize,
      size: entries.length,
      selectionRule: SELECTION_RULE,
      jobs: entries,
    }),
  );
  console.log(`final regression set: ${entries.length} jobs written to ${jsonPath}`);
};

if (process.argv[1]?.endsWith('studyAiBuildFinalRegressionSet.ts')) {
  main();
}

export const __studyAiBuildFinalRegressionSetTest = {
  FIXED_JOBS,
  DEFAULT_BASE_RUN,
  SET_DATE,
  SELECTION_RULE,
  HELP,
  entryFor,
  identityMatches,
  buildFinalRegressionSet,
  loadBaseJobs,
  loadExclusionSets,
  renderMarkdown,
};
