/**
 * Deterministic stratified comparison-set sampler for the local Study Map
 * authoring pipeline.
 *
 * Selects a reproducible validation sample from a base run's authoring jobs
 * (default: the full NB SIT corpus V2 run, 61 acts/regulations/bylaws, 3692 jobs) with:
 * - per-document balance (auto: even spread of --size; or explicit --per-document),
 * - multi-label complexity + structural strata coverage,
 * - seeded deterministic ordering (same inputs + seed => same selection),
 * - a SHA-256 fingerprint over the canonical selected job-id list,
 * - V1 run mapping (job identity + known-good result location) per selected job.
 *
 * Output: a runner-consumable comparison set (`jobs[].v2JobId`) plus a
 * companion Markdown report. No LLM calls; pure filesystem + hashing.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { canonicalJson } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';
import { categoryForJob, structuralStrataForJob } from './studyAiMapStrata';

const RUNS_DIR = 'study-content/ai/runs';
const V1_RUN = 'ai-map-4c1-full-corpus-v1';
const SELECTION_ALGORITHM = 'study-map-stratified-sampler-v1';

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');
const readJsonl = (path: string): unknown[] =>
  readFileSync(path, 'utf8').split(/\r?\n/).map((line, index) => (index === 0 ? line.replace(/^\uFEFF/, '') : line)).filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
const writeJsonFile = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

export type SampleOptions = {
  baseRunId: string;
  seed: string;
  size: number;
  perDocument: number;
};

type DocumentPlan = {
  documentId: string;
  title: string;
  type: string;
  citation?: string;
  eligible: number;
  initialQuota: number;
  finalQuota: number;
  topUp: number;
};

type SelectedJob = {
  job: AiStudyMapJob;
  categories: string[];
  structuralStrata: string[];
  reasonSelected: string;
};

type SampleResult = {
  options: SampleOptions;
  selectionAlgorithm: typeof SELECTION_ALGORITHM;
  selected: SelectedJob[];
  documents: DocumentPlan[];
  categoryCoverage: Record<string, number>;
  structuralCoverage: Record<string, number>;
  unmetCoverageNotes: string[];
  sampleSha256: string;
};

const loadRunJobs = (runId: string): AiStudyMapJob[] => {
  const jobsDir = join(RUNS_DIR, runId, 'jobs');
  return readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonl(join(jobsDir, file)) as AiStudyMapJob[]);
};

/** Stable per-job rank within a (seed, baseRunId) selection. */
const jobRank = (options: SampleOptions, jobId: string): string =>
  hashText(`${options.seed}\u0000${options.baseRunId}\u0000${jobId}`);

const sortByRank = (jobs: AiStudyMapJob[], options: SampleOptions): AiStudyMapJob[] =>
  [...jobs].sort((a, b) => {
    const rankA = jobRank(options, a.jobId);
    const rankB = jobRank(options, b.jobId);
    return rankA === rankB ? (a.jobId < b.jobId ? -1 : 1) : (rankA < rankB ? -1 : 1);
  });

const countBy = (values: string[]): Record<string, number> =>
  [...values].sort().reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

const planDocuments = (
  jobs: AiStudyMapJob[],
  options: SampleOptions,
): { documents: DocumentPlan[]; notes: string[] } => {
  const byDoc = new Map<string, AiStudyMapJob[]>();
  for (const job of jobs) {
    const id = job.document.documentId;
    const list = byDoc.get(id) ?? [];
    list.push(job);
    byDoc.set(id, list);
  }
  const documents: DocumentPlan[] = [...byDoc.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([documentId, docJobs]) => {
      const doc = docJobs[0].document;
      return {
        documentId,
        title: doc.title,
        type: doc.type,
        citation: doc.citation,
        eligible: docJobs.length,
        initialQuota: 0,
        finalQuota: 0,
        topUp: 0,
      };
    });
  const notes: string[] = [];
  // Per-document target quota: explicit --per-document wins when consistent
  // with --size; otherwise auto mode spreads the size evenly (floor + one
  // extra for the first `size % docs` documents by documentId order).
  const auto = options.perDocument <= 0;
  const base = Math.floor(options.size / documents.length);
  const remainder = options.size - base * documents.length;
  documents.forEach((doc, index) => {
    const wanted = auto
      ? Math.min(base + (index < remainder ? 1 : 0), doc.eligible)
      : Math.min(options.perDocument, doc.eligible);
    doc.initialQuota = wanted;
    doc.finalQuota = wanted;
    if (!auto && doc.eligible < options.perDocument) {
      notes.push(
        `document ${doc.documentId} has ${doc.eligible} eligible jobs, below quota ${options.perDocument}; ` +
          `shortfall ${options.perDocument - doc.eligible} redistributed`,
      );
    }
    if (auto && doc.eligible < base + (index < remainder ? 1 : 0)) {
      notes.push(
        `document ${doc.documentId} has ${doc.eligible} eligible jobs, below target ` +
          `${base + (index < remainder ? 1 : 0)}; shortfall redistributed`,
      );
    }
  });
  let remaining = options.size - documents.reduce((sum, doc) => sum + doc.finalQuota, 0);
  if (remaining < 0) {
    throw new Error(
      `per-document quota ${options.perDocument} x ${documents.length} documents exceeds requested size ${options.size}`,
    );
  }
  // Redistribute the deficit to documents with remaining headroom, round-robin.
  while (remaining > 0) {
    const withHeadroom = documents.filter((doc) => doc.finalQuota < doc.eligible);
    if (withHeadroom.length === 0) {
      throw new Error(
        `requested size ${options.size} exceeds total eligible jobs (${jobs.length}); ` +
          `cannot fill remaining ${remaining}`,
      );
    }
    for (const doc of withHeadroom) {
      if (remaining <= 0) break;
      if (doc.finalQuota < doc.eligible) {
        doc.finalQuota += 1;
        doc.topUp += 1;
        remaining -= 1;
      }
    }
  }
  return { documents, notes };
};

/**
 * Two-pass per-document selection: pass 1 takes the highest-ranked jobs that
 * add new strata to the per-document selection (coverage-first); pass 2 fills
 * the remaining quota by rank order. Deterministic for a fixed seed.
 */
const selectForDocument = (
  jobs: AiStudyMapJob[],
  quota: number,
  options: SampleOptions,
): SelectedJob[] => {
  const ranked = sortByRank(jobs, options);
  const selected: SelectedJob[] = [];
  const covered = new Set<string>();
  const take = (job: AiStudyMapJob, pass: 1 | 2): void => {
    const categories = categoryForJob(job);
    const structuralStrata = structuralStrataForJob(job);
    const newStrata = [...categories, ...structuralStrata].filter((label) => !covered.has(label));
    selected.push({
      job,
      categories,
      structuralStrata,
      reasonSelected:
        pass === 1 && newStrata.length > 0 ? `coverage:${newStrata.join('|')}` : 'quota-fill',
    });
    [...categories, ...structuralStrata].forEach((label) => covered.add(label));
  };
  for (const job of ranked) {
    if (selected.length >= quota) break;
    const addsStrata = [...categoryForJob(job), ...structuralStrataForJob(job)].some(
      (label) => !covered.has(label),
    );
    if (addsStrata) take(job, 1);
  }
  for (const job of ranked) {
    if (selected.length >= quota) break;
    if (!selected.some((entry) => entry.job.jobId === job.jobId)) take(job, 2);
  }
  return selected;
};

export const buildStratifiedSample = (jobs: AiStudyMapJob[], options: SampleOptions): SampleResult => {
  if (options.size <= 0 || options.perDocument < 0) {
    throw new Error('size must be positive; per-document quota must be non-negative (0 = auto)');
  }
  const { documents, notes } = planDocuments(jobs, options);
  const selected: SelectedJob[] = [];
  for (const doc of documents) {
    const docJobs = jobs.filter((job) => job.document.documentId === doc.documentId);
    const picks = selectForDocument(docJobs, doc.finalQuota, options);
    selected.push(...picks);
  }
  const unmet = notes.slice();
  const corpusStructural = countBy(jobs.flatMap((job) => structuralStrataForJob(job)));
  const corpusCategories = countBy(jobs.flatMap((job) => categoryForJob(job)));
  const structuralCoverage = countBy(selected.flatMap((entry) => entry.structuralStrata));
  const categoryCoverage = countBy(selected.flatMap((entry) => entry.categories));
  for (const label of Object.keys(corpusStructural)) {
    if ((structuralCoverage[label] ?? 0) === 0) {
      unmet.push(`structural stratum ${label} has ${corpusStructural[label]} eligible jobs but 0 selected (quota-limited)`);
    }
  }
  for (const label of Object.keys(corpusCategories)) {
    if ((categoryCoverage[label] ?? 0) === 0) {
      unmet.push(`category ${label} has ${corpusCategories[label]} eligible jobs but 0 selected (quota-limited)`);
    }
  }
  const finalNotes = [
    ...unmet,
    ...documents
      .filter((doc) => doc.topUp > 0)
      .map((doc) => `document ${doc.documentId} absorbed ${doc.topUp} redistributed job(s)`),
  ];
  const sampleSha256 = hashText(
    canonicalJson(selected.map((entry) => entry.job.jobId)),
  );
  return {
    options,
    selectionAlgorithm: SELECTION_ALGORITHM,
    selected,
    documents,
    categoryCoverage,
    structuralCoverage,
    unmetCoverageNotes: finalNotes,
    sampleSha256,
  };
};

type V1Index = {
  jobs: Map<string, AiStudyMapJob>;
  resultByJob: Map<string, { file: string; value: AiStudyMapResult }>;
};

const loadV1Index = (): V1Index | null => {
  const resultsDir = join(RUNS_DIR, V1_RUN, 'results');
  if (!existsSync(resultsDir)) return null;
  const jobsDir = join(RUNS_DIR, V1_RUN, 'jobs');
  const jobs: AiStudyMapJob[] = existsSync(jobsDir)
    ? readdirSync(jobsDir)
        .filter((file) => file.endsWith('.jobs.jsonl'))
        .sort()
        .flatMap((file) => readJsonl(join(jobsDir, file)) as AiStudyMapJob[])
    : [];
  const resultByJob = new Map<string, { file: string; value: AiStudyMapResult }>();
  for (const file of readdirSync(resultsDir).filter((f) => f.endsWith('.results.jsonl')).sort()) {
    for (const value of readJsonl(join(resultsDir, file)) as AiStudyMapResult[]) {
      resultByJob.set(value.jobId, { file, value });
    }
  }
  return {
    jobs: new Map(jobs.map((job) => [`${job.document.documentId}::${job.target.sourceKeys.join('|')}::${job.target.sectionLabels.join('|')}`, job])),
    resultByJob,
  };
};

const v1TargetKey = (job: AiStudyMapJob): string =>
  `${job.document.documentId}::${job.target.sourceKeys.join('|')}::${job.target.sectionLabels.join('|')}`;

export const attachV1Mapping = (
  selected: SelectedJob[],
  v1: V1Index | null,
): Array<{ v1JobId: string | null; v1KnownGoodResultLocation: string | null; v1ResultIdentity: string | null }> =>
  selected.map((entry) => {
    if (!v1) return { v1JobId: null, v1KnownGoodResultLocation: null, v1ResultIdentity: null };
    const v1Job = v1.jobs.get(v1TargetKey(entry.job));
    if (!v1Job) return { v1JobId: null, v1KnownGoodResultLocation: null, v1ResultIdentity: null };
    const row = v1.resultByJob.get(v1Job.jobId);
    if (!row) return { v1JobId: v1Job.jobId, v1KnownGoodResultLocation: null, v1ResultIdentity: null };
    return {
      v1JobId: v1Job.jobId,
      v1KnownGoodResultLocation: `${V1_RUN}/results/${row.file}`,
      v1ResultIdentity: `${V1_RUN}:${row.value.jobId}`,
    };
  });

export const buildComparisonSetDocument = (
  sample: SampleResult,
  v1Mapping: Array<{ v1JobId: string | null; v1KnownGoodResultLocation: string | null; v1ResultIdentity: string | null }>,
): Record<string, unknown> => ({
  schemaVersion: 1,
  kind: 'study-map-stratified-comparison-set',
  selectionAlgorithm: sample.selectionAlgorithm,
  baseRunId: sample.options.baseRunId,
  v2RunId: sample.options.baseRunId,
  seed: sample.options.seed,
  requestedSize: sample.options.size,
  perDocumentQuota: sample.options.perDocument,
  size: sample.selected.length,
  sampleSha256: sample.sampleSha256,
  v1Run: V1_RUN,
  documentDistribution: sample.documents.map((doc) => ({
    documentId: doc.documentId,
    title: doc.title,
    type: doc.type,
    citation: doc.citation,
    eligible: doc.eligible,
    initialQuota: doc.initialQuota,
    finalQuota: doc.finalQuota,
    topUp: doc.topUp,
  })),
  categoryCoverage: sample.categoryCoverage,
  structuralCoverage: sample.structuralCoverage,
  unmetCoverageNotes: sample.unmetCoverageNotes,
  jobs: sample.selected.map((entry, index) => ({
    v2JobId: entry.job.jobId,
    document: entry.job.document,
    target: entry.job.target.sectionLabels.join(', '),
    sourceKey: entry.job.target.sourceKeys[0],
    componentType: entry.job.target.componentType,
    auditType: entry.job.document.type,
    complexityCategory: entry.categories,
    structuralStrata: entry.structuralStrata,
    reasonSelected: entry.reasonSelected,
    v1JobId: v1Mapping[index].v1JobId,
    v1KnownGoodResultLocation: v1Mapping[index].v1KnownGoodResultLocation,
    v1ResultIdentity: v1Mapping[index].v1ResultIdentity,
    v2Fingerprint: entry.job.authoringInputFingerprint ?? authoringInputFingerprint(entry.job),
  })),
});

const renderMarkdown = (doc: Record<string, unknown>, runLabel: string): string => {
  const lines: string[] = [];
  const header = (title: string): void => {
    lines.push('', `## ${title}`, '');
  };
  lines.push(`# Stratified comparison set — ${runLabel}`, '');
  lines.push(
    `- algorithm: \`${String(doc.selectionAlgorithm)}\``,
    `- seed: \`${String(doc.seed)}\``,
    `- size: ${String(doc.size)} (requested ${String(doc.requestedSize)}, per-document quota ${String(doc.perDocumentQuota)})`,
    `- sample sha256: \`${String(doc.sampleSha256)}\``,
    `- v1 run: \`${String(doc.v1Run)}\``,
  );
  header('Per-document balance');
  lines.push('| document | type | eligible | initial quota | final quota | top-up |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const entry of doc.documentDistribution as Array<Record<string, unknown>>) {
    lines.push(
      `| ${String(entry.documentId)} | ${String(entry.type)} | ${String(entry.eligible)} | ${String(entry.initialQuota)} | ${String(entry.finalQuota)} | ${String(entry.topUp)} |`,
    );
  }
  header('Category coverage');
  for (const [label, count] of Object.entries(doc.categoryCoverage as Record<string, number>).sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    lines.push(`- \`${label}\`: ${count}`);
  }
  header('Structural coverage');
  const structural = Object.entries(doc.structuralCoverage as Record<string, number>).sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  );
  if (structural.length === 0) lines.push('(none)');
  for (const [label, count] of structural) lines.push(`- \`${label}\`: ${count}`);
  header('Unmet coverage notes');
  const notes = doc.unmetCoverageNotes as string[];
  if (notes.length === 0) lines.push('(none)');
  for (const note of notes) lines.push(`- ${note}`);
  lines.push('', `Companion JSON: see sibling \`*.json\` (same directory).`, '');
  return `${lines.join('\n')}\n`;
};

const parseArgs = (argv: string[]): SampleOptions => {
  const valueFor = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    if (index < 0 || argv[index + 1] === undefined) return fallback;
    return argv[index + 1];
  };
  const options: SampleOptions = {
    baseRunId: valueFor('run', 'ai-map-4c12-full-corpus-v2'),
    seed: valueFor('seed', '20260828'),
    size: Number(valueFor('size', '200')),
    perDocument: Number(valueFor('per-document', '0')),
  };
  if (!Number.isInteger(options.size) || !Number.isInteger(options.perDocument)) {
    throw new Error('--size and --per-document must be integers');
  }
  if (options.size <= 0 || options.perDocument < 0) {
    throw new Error('--size must be positive; --per-document must be non-negative (0 = auto)');
  }
  return options;
};

const main = (): void => {
  const argv = process.argv.slice(2);
  const outPath = resolve(argv[argv.indexOf('--out') + 1] ?? '');
  if (!outPath || !existsSync(dirname(outPath))) {
    throw new Error('pass --out <path> (parent directory must exist)');
  }
  const options = parseArgs(argv);
  const jobs = loadRunJobs(options.baseRunId);
  const sample = buildStratifiedSample(jobs, options);
  const v1 = loadV1Index();
  const v1Mapping = attachV1Mapping(sample.selected, v1);
  const doc = buildComparisonSetDocument(sample, v1Mapping);
  writeJsonFile(outPath, doc);
  const mdPath = outPath.replace(/\.json$/i, '.md');
  writeFileSync(mdPath, renderMarkdown(doc, `${options.baseRunId} (seed ${options.seed})`));
  console.log(
    `Wrote ${sample.selected.length}-job stratified comparison set to ${outPath} (sha256 ${sample.sampleSha256.slice(0, 16)}…).`,
  );
  if (sample.unmetCoverageNotes.length > 0) {
    console.log(`Unmet coverage notes: ${sample.unmetCoverageNotes.length}`);
    sample.unmetCoverageNotes.forEach((note) => console.log(`  - ${note}`));
  }
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiBuildStratifiedMapSampleTest = {
  buildStratifiedSample,
  attachV1Mapping,
  buildComparisonSetDocument,
  jobRank,
  SELECTION_ALGORITHM,
  V1_RUN,
  hashText,
};
