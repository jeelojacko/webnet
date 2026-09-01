#!/usr/bin/env tsx
/**
 * Deterministic balanced production review-set builder. No inference.
 *
 * Selects a fixed ~250-entry review bundle from an accepted local run using
 * fixed quotas per review stratum (core NB surveying/licensing laws, clean
 * high-confidence controls, medium confidence, skip / reference-only /
 * combine dispositions, large splits, P1/P2 priorities, broad-focus warnings,
 * recovered retries, then a document-diversity top-up). Every job appears at
 * most once; earlier strata win ties. The retry stratum is capped so retries
 * cannot dominate. Output is jobId-deterministic (no wall clock, no
 * randomness) plus a Markdown companion.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildBalancedReviewSet.ts [--run <runId>]
 *     [--base-dir <dir>] [--date YYYYMMDD] [--total <n>] [--dry-run]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { RUNS_DIR, readJsonl } from './studyAiLocalMapAuthor';

export const DEFAULT_RUN =
  'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
export const DEFAULT_TOTAL = 250;
export const SET_DATE = '20260831';

/**
 * Core NB surveying / land-registration / licensing instrument set.
 * The Association of New Brunswick Land Surveyors Bylaws are part of the core
 * NB surveying/licensing curriculum alongside the Land Surveyors Act.
 */
export const CORE_SURVEYING_DOCS = [
  'doc-boundaries-confirmation-act',
  'doc-land-titles-act',
  'doc-new-brunswick-land-surveyors-act',
  'doc-new-brunswick-land-surveyors-bylaws',
  'doc-property-act',
  'doc-registry-act',
  'doc-surveys-act',
  'doc-territorial-division-act',
  'reg-boundaries-95-166',
  'reg-land-titles-83-130',
  'reg-surveys-84-76',
];

export const BROAD_FOCUS_CODES = new Set([
  'BROAD_ENUMERATION_SINGLE_CONCEPT',
  'BROAD_FOCUS_WITHOUT_EVIDENCE',
  'LARGE_SECTION_TARGET',
]);

export type ReviewJobInput = {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabels: string[];
};

export type ReviewRowInput = {
  jobId: string;
  disposition: string;
  confidence: string;
  suggestedPriority: string | null;
  groupCount: number;
  warnings: string[];
};

export type JobOrigin = 'original' | 'recovered' | 'promoted';

export type BuildBalancedReviewSetInput = {
  jobs: ReviewJobInput[];
  rows: ReviewRowInput[];
  totalTarget: number;
  /** Jobs that required at least one semantic retry (local-failures history). */
  retryJobIds: Set<string>;
  originByJob: Map<string, JobOrigin>;
};

export type BalancedEntry = {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabels: string[];
  disposition: string;
  confidence: string;
  suggestedPriority: string | null;
  groupCount: number;
  warnings: string[];
  origin: JobOrigin;
  requiredRetry: boolean;
  stratum: string;
};

export type StratumReport = {
  name: string;
  quota: number;
  poolSize: number;
  selected: number;
};

export type BalancedReviewSet = {
  entries: BalancedEntry[];
  strata: StratumReport[];
};

type StratumSpec = {
  name: string;
  quota: number | 'fill';
  /** Candidates are already filtered and jobId-ascending; return all. */
  matches: (
    _row: ReviewRowInput,
    _job: ReviewJobInput,
    _input: BuildBalancedReviewSetInput,
  ) => boolean;
};

const matchesCoreDocs = (row: ReviewRowInput, job: ReviewJobInput): boolean =>
  CORE_SURVEYING_DOCS.includes(job.documentId);

const matchesCleanStandalone = (row: ReviewRowInput): boolean =>
  row.disposition === 'standalone' && row.confidence === 'high' && row.warnings.length === 0;

const matchesCleanSplit = (row: ReviewRowInput): boolean =>
  row.disposition === 'split' && row.confidence === 'high' && row.warnings.length === 0;

const matchesMedium = (row: ReviewRowInput): boolean => row.confidence === 'medium';

const matchesSkip = (row: ReviewRowInput): boolean => row.disposition === 'skip';

const matchesReferenceOnly = (row: ReviewRowInput): boolean =>
  row.disposition === 'reference-only';

const matchesCombine = (row: ReviewRowInput): boolean => row.disposition === 'combine';

const matchesLargeSplit = (row: ReviewRowInput): boolean =>
  row.disposition === 'split' && row.groupCount >= 3;

const matchesP1 = (row: ReviewRowInput): boolean => row.suggestedPriority === 'P1';

const matchesP2 = (row: ReviewRowInput): boolean => row.suggestedPriority === 'P2';

const matchesBroadFocus = (row: ReviewRowInput): boolean =>
  row.warnings.some((warning) => BROAD_FOCUS_CODES.has(warning));

const matchesRetry = (
  row: ReviewRowInput,
  _job: ReviewJobInput,
  input: BuildBalancedReviewSetInput,
): boolean =>
  input.retryJobIds.has(row.jobId) || input.originByJob.get(row.jobId) !== 'original';

export const STRATA: Array<{ name: string; quota: number | 'fill'; matches: StratumSpec['matches'] }> =
  [
    { name: 'core-surveying-licensing', quota: 24, matches: matchesCoreDocs },
    { name: 'clean-high-confidence-standalone', quota: 34, matches: matchesCleanStandalone },
    { name: 'clean-high-confidence-split', quota: 22, matches: matchesCleanSplit },
    { name: 'medium-confidence', quota: 26, matches: matchesMedium },
    { name: 'skip-disposition', quota: 26, matches: matchesSkip },
    { name: 'reference-only', quota: 16, matches: matchesReferenceOnly },
    { name: 'combine', quota: 8, matches: matchesCombine },
    { name: 'split-large-groups', quota: 22, matches: matchesLargeSplit },
    { name: 'priority-p1', quota: 14, matches: matchesP1 },
    { name: 'priority-p2', quota: 14, matches: matchesP2 },
    { name: 'broad-focus-warnings', quota: 12, matches: matchesBroadFocus },
    { name: 'recovered-retries', quota: 16, matches: matchesRetry },
    { name: 'diverse-documents', quota: 'fill', matches: () => true },
  ];

const entryFor = (
  row: ReviewRowInput,
  job: ReviewJobInput,
  input: BuildBalancedReviewSetInput,
  stratum: string,
): BalancedEntry => ({
  jobId: row.jobId,
  documentId: job.documentId,
  title: job.title,
  sectionLabels: [...job.sectionLabels],
  disposition: row.disposition,
  confidence: row.confidence,
  suggestedPriority: row.suggestedPriority,
  groupCount: row.groupCount,
  warnings: [...row.warnings],
  origin: input.originByJob.get(row.jobId) ?? 'original',
  requiredRetry: input.retryJobIds.has(row.jobId),
  stratum,
});

/** Round-robin across documents (document order ascending) for a pool. */
const byDocument = (pool: Array<[ReviewRowInput, ReviewJobInput]>): Array<
  [ReviewRowInput, ReviewJobInput]
> => {
  const docs = [...new Set(pool.map(([, job]) => job.documentId))].sort();
  const buckets = new Map<string, Array<[ReviewRowInput, ReviewJobInput]>>();
  for (const doc of docs) buckets.set(doc, []);
  for (const candidate of pool) buckets.get(candidate[1].documentId)!.push(candidate);
  const out: Array<[ReviewRowInput, ReviewJobInput]> = [];
  while (out.length < pool.length) {
    let advanced = false;
    for (const doc of docs) {
      const bucket = buckets.get(doc)!;
      if (bucket.length > 0) {
        out.push(bucket.shift()!);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return out;
};

export const buildBalancedReviewSet = (
  input: BuildBalancedReviewSetInput,
): BalancedReviewSet => {
  if (input.totalTarget <= 0) throw new Error('totalTarget must be positive');
  const jobsById = new Map<string, ReviewJobInput>();
  for (const job of input.jobs) {
    if (jobsById.has(job.jobId)) throw new Error(`duplicate job in input: ${job.jobId}`);
    jobsById.set(job.jobId, job);
  }
  const rowsByJob = new Map<string, ReviewRowInput>();
  for (const row of [...input.rows].sort((a, b) => a.jobId.localeCompare(b.jobId))) {
    if (rowsByJob.has(row.jobId)) throw new Error(`duplicate result row: ${row.jobId}`);
    rowsByJob.set(row.jobId, row);
  }
  const selected = new Set<string>();
  const entries: BalancedEntry[] = [];
  const strata: StratumReport[] = [];

  const take = (
    name: string,
    quota: number,
    pool: Array<[ReviewRowInput, ReviewJobInput]>,
  ): void => {
    let selectedCount = 0;
    for (const candidate of pool) {
      if (selectedCount >= quota) break;
      if (selected.has(candidate[0].jobId)) continue;
      selected.add(candidate[0].jobId);
      entries.push(entryFor(candidate[0], candidate[1], input, name));
      selectedCount += 1;
    }
    strata.push({ name, quota, poolSize: pool.length, selected: selectedCount });
  };

  const rowsFor = (
    matches: StratumSpec['matches'],
    order: (_pool: Array<[ReviewRowInput, ReviewJobInput]>) => Array<
      [ReviewRowInput, ReviewJobInput]
    >,
  ): Array<[ReviewRowInput, ReviewJobInput]> => {
    const pool = input.rows
      .map((row) => {
        const job = jobsById.get(row.jobId);
        return job && matches(row, job, input) ? ([row, job] as [ReviewRowInput, ReviewJobInput]) : null;
      })
      .filter((candidate): candidate is [ReviewRowInput, ReviewJobInput] => candidate !== null)
      .sort((a, b) => a[0].jobId.localeCompare(b[0].jobId));
    return order(pool);
  };

  for (const spec of STRATA) {
    if (spec.quota === 'fill') continue;
    const ordered =
      spec.name === 'core-surveying-licensing'
        ? byDocument(rowsFor(spec.matches, (pool) => pool))
        : rowsFor(spec.matches, (pool) => pool);
    take(spec.name, Math.min(spec.quota, input.totalTarget - entries.length), ordered);
  }
  // Document-diversity top-up fills the remainder of the target.
  const fillQuota = Math.max(0, input.totalTarget - entries.length);
  take(
    'diverse-documents',
    fillQuota,
    byDocument(rowsFor(() => true, (pool) => pool)),
  );
  return { entries, strata };
};

const loadRunRows = (
  runsDir: string,
  runId: string,
): {
  jobs: ReviewJobInput[];
  rows: ReviewRowInput[];
  retryJobIds: Set<string>;
  originByJob: Map<string, JobOrigin>;
} => {
  const runDir = join(runsDir, runId);
  const manifest = JSON.parse(
    readFileSync(join(runDir, 'reports', 'batch-manifest.json'), 'utf8'),
  ) as { batchCount: number };
  const jobs: ReviewJobInput[] = [];
  for (let index = 1; index <= manifest.batchCount; index += 1) {
    const file = join(
      runDir,
      'jobs',
      `batch-${String(index).padStart(3, '0')}.jobs.jsonl`,
    );
    for (const row of readJsonl<AiStudyMapJob>(file)) {
      jobs.push({
        jobId: row.jobId,
        documentId: row.document.documentId,
        title: row.document.title,
        sectionLabels: [...row.target.sectionLabels],
      });
    }
  }
  const results = readJsonl<AiStudyMapResult>(join(runDir, 'results', 'local-map.results.jsonl'));
  const retryJobIds = new Set<string>();
  const failureDir = join(runDir, 'local-failures');
  if (existsSync(failureDir)) {
    for (const name of readdirSync(failureDir).sort()) retryJobIds.add(name);
  }
  const originByJob = new Map<string, JobOrigin>();
  const rows: ReviewRowInput[] = results.map((result) => {
    const jobId = result.jobId;
    let origin: JobOrigin = 'original';
    const provenancePath = join(runDir, 'results', `${jobId}.provenance.json`);
    if (existsSync(provenancePath)) {
      const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as Record<
        string,
        unknown
      >;
      origin =
        provenance.promotion !== undefined
          ? 'promoted'
          : provenance.recovery !== undefined
            ? 'recovered'
            : 'original';
    }
    originByJob.set(jobId, origin);
    return {
      jobId,
      disposition: result.disposition,
      confidence: result.confidence,
      suggestedPriority: result.suggestedPriority ?? null,
      groupCount: result.proposedGroups?.length ?? 0,
      warnings: [...(result.warnings ?? [])],
    };
  });
  return { jobs, rows, retryJobIds, originByJob };
};

const renderMarkdown = (runId: string, date: string, size: number, set: BalancedReviewSet): string => {
  const lines: string[] = [
    `# Balanced production review set (${size} entries)`,
    '',
    `- Base run: \`${runId}\``,
    `- Date: ${date}`,
    '',
    '| Stratum | quota | pool | selected |',
    '| --- | --- | --- | --- |',
  ];
  for (const stratum of set.strata) {
    lines.push(`| ${stratum.name} | ${stratum.quota} | ${stratum.poolSize} | ${stratum.selected} |`);
  }
  lines.push(
    '',
    '| # | jobId | document | disposition | confidence | priority | origin | retry |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  set.entries.forEach((entry, index) => {
    lines.push(
      `| ${index + 1} | ${entry.jobId} | ${entry.documentId} | ${entry.disposition} | ` +
        `${entry.confidence} | ${entry.suggestedPriority ?? '-'} | ${entry.origin} | ` +
        `${entry.requiredRetry ? 'yes' : 'no'} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
};

const HELP = `Deterministic balanced production review-set builder (no inference).

Usage:
  npx tsx scripts/studyAiBuildBalancedReviewSet.ts [--run <runId>]
    [--base-dir <dir>] [--date YYYYMMDD] [--total <n>] [--dry-run]

  --run <id>       Accepted local run to sample. Default: ${DEFAULT_RUN}
  --base-dir <dir> Runs root. Default: ${RUNS_DIR}
  --date YYYYMMDD  Output date tag. Default: ${SET_DATE}
  --total <n>      Target bundle size. Default: ${DEFAULT_TOTAL}
  --dry-run        Print the stratum table only.`;

const valueFor = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const runId = valueFor(argv, '--run') ?? DEFAULT_RUN;
  const runsDir = valueFor(argv, '--base-dir') ?? RUNS_DIR;
  const date = valueFor(argv, '--date') ?? SET_DATE;
  const totalTarget = Number(valueFor(argv, '--total') ?? DEFAULT_TOTAL);
  if (!Number.isInteger(totalTarget) || totalTarget <= 0) {
    throw new Error('--total must be a positive integer');
  }
  const dryRun = argv.includes('--dry-run');

  const { jobs, rows, retryJobIds, originByJob } = loadRunRows(runsDir, runId);
  const set = buildBalancedReviewSet({
    jobs,
    rows,
    totalTarget,
    retryJobIds,
    originByJob,
  });

  for (const stratum of set.strata) {
    console.log(`${stratum.name} quota=${stratum.quota} pool=${stratum.poolSize} selected=${stratum.selected}`);
  }

  if (dryRun) {
    console.log(`dry run: ${set.entries.length} entries; nothing written.`);
    return;
  }

  const outDir = join(runsDir, runId, 'reports');
  const outPath = join(outDir, `balanced-review-set-${date}.json`);
  const file = {
    schemaVersion: 1,
    kind: 'balanced-production-review-set',
    baseRunId: runId,
    date,
    totalTarget,
    size: set.entries.length,
    selectionRule:
      'fixed per-stratum quotas with jobId-ascending order, earlier strata win ties, ' +
      'core-surveying stratum round-robins across its pinned documents, and a ' +
      'document-diversity top-up fills the remainder of the target',
    strata: set.strata,
    jobs: set.entries,
  };
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(outPath.replace(/\.json$/, '.md'), renderMarkdown(runId, date, set.entries.length, set));
  console.log(`Wrote ${outPath} (${set.entries.length} entries)`);
}

if (process.argv[1]?.endsWith('studyAiBuildBalancedReviewSet.ts')) main();
