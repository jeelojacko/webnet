import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';

const RUNS_DIR = 'study-content/ai/runs';
const DEFAULT_OUT = 'study-map-local-comparison-report.json';

const USAGE = [
  'Usage: studyAiLocalMapCompare.ts <mode options>',
  '',
  'Single-job mode:',
  '  npm run study:ai:local-compare -- --job <job-json> --known-good <known-good-result-json> --local <local-result-json> --out <report-json>',
  '',
  'Batch mode:',
  '  npm run study:ai:local-compare -- --comparison-set <comparison-set-json> --local-results <local-results.jsonl> --v2-run <v2-run-id> --v1-run <v1-run-id> --out <report-json>',
  '',
  'Options:',
  '  --help              Show this help text.',
  '  --job               Study Map job JSON file (single-job mode).',
  '  --known-good        Known-good V1 result JSON file (single-job mode).',
  '  --local             Local result JSON file (single-job mode).',
  '  --comparison-set    Local-model comparison set JSON file (batch mode).',
  '  --local-results     Local results JSONL file (batch mode).',
  '  --v2-run            V2 run id under study-content/ai/runs (batch mode).',
  '  --v1-run            V1 run id under study-content/ai/runs (batch mode).',
  '  --out               Report output path (default: study-map-local-comparison-report.json).',
].join('\n');

type CompareArgs = Record<string, string | boolean>;

type SingleJobOptions = {
  job: string;
  knownGood: string;
  local: string;
  out: string;
};

type BatchOptions = {
  comparisonSet: string;
  localResults: string;
  v2Run: string;
  v1Run: string;
  out: string;
};

type ComparePlan =
  | { mode: 'help'; usage: string }
  | { mode: 'usage-error'; message: string; usage: string }
  | { mode: 'single'; options: SingleJobOptions }
  | { mode: 'batch'; options: BatchOptions };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const readJsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line, index) => JSON.parse((index === 0 ? line.replace(/^\uFEFF/, '') : line)) as T)
    : [];

const parseRawArgs = (rawArgs: string[]): CompareArgs => {
  const options: CompareArgs = {};
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

const argValue = (args: CompareArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const missingArgError = (missing: string[]): string =>
  `Missing required argument${missing.length === 1 ? '' : 's'}: ${missing.map((arg) => `--${arg}`).join(', ')}.`;

const planFromArgs = (args: CompareArgs): ComparePlan => {
  if (args.help !== undefined) return { mode: 'help', usage: USAGE };
  if (args['comparison-set'] !== undefined) {
    const required: Array<[string, string | undefined]> = [
      ['comparison-set', argValue(args, 'comparison-set')],
      ['local-results', argValue(args, 'local-results')],
      ['v2-run', argValue(args, 'v2-run')],
      ['v1-run', argValue(args, 'v1-run')],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) return { mode: 'usage-error', message: missingArgError(missing), usage: USAGE };
    return {
      mode: 'batch',
      options: {
        comparisonSet: argValue(args, 'comparison-set') as string,
        localResults: argValue(args, 'local-results') as string,
        v2Run: argValue(args, 'v2-run') as string,
        v1Run: argValue(args, 'v1-run') as string,
        out: argValue(args, 'out') ?? DEFAULT_OUT,
      },
    };
  }
  if (args.job !== undefined) {
    const required: Array<[string, string | undefined]> = [
      ['job', argValue(args, 'job')],
      ['known-good', argValue(args, 'known-good')],
      ['local', argValue(args, 'local')],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) return { mode: 'usage-error', message: missingArgError(missing), usage: USAGE };
    return {
      mode: 'single',
      options: {
        job: argValue(args, 'job') as string,
        knownGood: argValue(args, 'known-good') as string,
        local: argValue(args, 'local') as string,
        out: argValue(args, 'out') ?? DEFAULT_OUT,
      },
    };
  }
  return { mode: 'usage-error', message: 'No comparison mode selected.', usage: USAGE };
};

const focusFacts = (result: AiStudyMapResult) => ({
  groupCount: result.proposedGroups.length,
  groupSourceCoverage: result.proposedGroups.map((group) => ({
    groupId: group.groupId,
    sourceKeys: group.sourceKeys,
    childLabels: group.focusSelections.flatMap((selection) => selection.childLabels ?? []),
    definedTerms: group.focusSelections.flatMap((selection) => selection.definedTerms ?? []),
    evidenceTextCount: group.focusSelections.reduce((sum, selection) => sum + (selection.evidenceText?.length ?? 0), 0),
  })),
  childLabelCoverage: Array.from(new Set(result.proposedGroups.flatMap((group) => group.focusSelections.flatMap((selection) => selection.childLabels ?? [])))).sort(),
  definedTermCoverage: Array.from(new Set(result.proposedGroups.flatMap((group) => group.focusSelections.flatMap((selection) => selection.definedTerms ?? [])))).sort(),
});

const contextLeakageIndicators = (result: AiStudyMapResult, job: AiStudyMapJob): string[] => {
  const targetKeys = new Set(job.target.sourceKeys);
  return Array.from(new Set(result.proposedGroups.flatMap((group) => group.sourceKeys))).filter((sourceKey) => !targetKeys.has(sourceKey));
};

const sideSummary = (result: AiStudyMapResult, job: AiStudyMapJob) => {
  const validation = validateAiStudyMapResult(result, job);
  return {
    disposition: result.disposition,
    confidence: result.confidence,
    suggestedPriority: result.suggestedPriority,
    schemaValid: validation.valid,
    validationIssues: validation.issues,
    contextLeakageIndicators: contextLeakageIndicators(result, job),
    ...focusFacts(result),
  };
};

const NOTES = [
  'This report compares deterministic structure and validation facts only.',
  'It does not decide whether local-model wording is educationally or legally better.',
];

const runSingleJobComparison = (options: SingleJobOptions) => {
  const job = readJson<AiStudyMapJob>(options.job);
  const knownGood = readJson<AiStudyMapResult>(options.knownGood);
  const local = readJson<AiStudyMapResult>(options.local);
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    document: job.document,
    target: job.target.sectionLabels,
    knownGood: sideSummary(knownGood, job),
    local: sideSummary(local, job),
    humanReviewRequired: true,
    notes: NOTES,
  };
};

type ComparisonSetEntry = {
  v2JobId: string;
  document?: AiStudyMapJob['document'];
  target?: string;
  complexityCategory?: string[];
  v1KnownGoodResultLocation?: string;
  v1ResultIdentity?: string;
  v2Fingerprint?: string;
};

type LocalModelComparisonSet = {
  schemaVersion?: number;
  v2RunId?: string;
  size?: number;
  jobs: ComparisonSetEntry[];
};

type ComparisonSideSummary = ReturnType<typeof sideSummary>;
type ComparisonSide = ComparisonSideSummary | { status: string };

type PerJobComparisonFlags = {
  dispositionMismatch: boolean | null;
  groupCountMismatch: boolean | null;
  childLabelCoverageMismatch: boolean | null;
  priorityMismatch: boolean | null;
  contextLeakage: { knownGood: boolean; local: boolean };
  falseSkipCandidate: boolean;
  falseIncludeCandidate: boolean;
  localSchemaInvalid: boolean;
};

type PerJobComparison = {
  jobId: string;
  status?: string;
  document?: AiStudyMapJob['document'];
  target?: string[] | string;
  complexityCategory?: string[];
  knownGood?: ComparisonSide;
  local?: ComparisonSide;
  localStatus?: 'present' | 'missing-or-rejected';
  flags?: PerJobComparisonFlags;
};

const readV2Jobs = (v2Run: string): AiStudyMapJob[] => {
  const jobsDir = join(RUNS_DIR, v2Run, 'jobs');
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonl<AiStudyMapJob>(join(jobsDir, file)));
};

const resolveV1Location = (location: string, v1Run: string): string => {
  if (location.startsWith('study-content')) return location;
  const relative = location.replace(/^\.?\//, '');
  const underV1Run = relative === v1Run || relative.startsWith(`${v1Run}/`);
  return join(RUNS_DIR, underV1Run ? relative : join(v1Run, relative));
};

const compareComparisonSetEntry = (
  entry: ComparisonSetEntry,
  v2JobsById: Map<string, AiStudyMapJob>,
  localResultsById: Map<string, AiStudyMapResult>,
  findKnownGood: (_location: string | undefined, _jobId: string) => AiStudyMapResult | undefined,
): PerJobComparison => {
  const job = v2JobsById.get(entry.v2JobId);
  if (!job) {
    return {
      jobId: entry.v2JobId,
      status: 'v2-job-missing',
      document: entry.document,
      target: entry.target,
      complexityCategory: entry.complexityCategory,
    };
  }
  const knownGood = findKnownGood(entry.v1KnownGoodResultLocation, job.jobId);
  const local = localResultsById.get(job.jobId);
  const knownGoodSide = knownGood ? sideSummary(knownGood, job) : undefined;
  const localSide = local ? sideSummary(local, job) : undefined;
  return {
    jobId: job.jobId,
    document: job.document,
    target: job.target.sectionLabels,
    complexityCategory: entry.complexityCategory,
    knownGood: knownGoodSide ?? { status: 'missing' },
    local: localSide ?? { status: 'missing-or-rejected' },
    localStatus: localSide ? 'present' : 'missing-or-rejected',
    flags: jobFlags(knownGoodSide, localSide),
  };
};

const jobFlags = (knownGoodSide: ComparisonSideSummary | undefined, localSide: ComparisonSideSummary | undefined): PerJobComparisonFlags => {
  const contextLeakage = {
    knownGood: (knownGoodSide?.contextLeakageIndicators.length ?? 0) > 0,
    local: (localSide?.contextLeakageIndicators.length ?? 0) > 0,
  };
  if (!knownGoodSide || !localSide) {
    return {
      dispositionMismatch: null,
      groupCountMismatch: null,
      childLabelCoverageMismatch: null,
      priorityMismatch: null,
      contextLeakage,
      falseSkipCandidate: false,
      falseIncludeCandidate: false,
      localSchemaInvalid: localSide ? !localSide.schemaValid : false,
    };
  }
  const knownGoodIsSkip = knownGoodSide.disposition === 'skip';
  const localIsSkip = localSide.disposition === 'skip';
  return {
    dispositionMismatch: knownGoodSide.disposition !== localSide.disposition,
    groupCountMismatch: knownGoodSide.groupCount !== localSide.groupCount,
    childLabelCoverageMismatch: !sameStringLists(knownGoodSide.childLabelCoverage, localSide.childLabelCoverage),
    priorityMismatch:
      knownGoodSide.suggestedPriority == null || localSide.suggestedPriority == null
        ? null
        : knownGoodSide.suggestedPriority !== localSide.suggestedPriority,
    contextLeakage,
    falseSkipCandidate: !knownGoodIsSkip && localIsSkip,
    falseIncludeCandidate: knownGoodIsSkip && !localIsSkip,
    localSchemaInvalid: !localSide.schemaValid,
  };
};

const sameStringLists = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sideOf = (entry: PerJobComparison, key: 'knownGood' | 'local'): ComparisonSideSummary | undefined => {
  const side = entry[key];
  return side && 'disposition' in side ? side : undefined;
};

const rate = (count: number, total: number): number => (total === 0 ? 0 : Number((count / total).toFixed(4)));

const dispositionAggregate = (entries: PerJobComparison[], key: 'knownGood' | 'local', total: number) => {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    const side = sideOf(entry, key);
    if (side) counts.set(side.disposition, (counts.get(side.disposition) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([disposition, count]) => ({ disposition, count, rate: rate(count, total) }));
};

const priorityPairList = (entries: PerJobComparison[]) =>
  entries.flatMap((entry) => {
    const knownGood = sideOf(entry, 'knownGood');
    const local = sideOf(entry, 'local');
    if (knownGood?.suggestedPriority == null || local?.suggestedPriority == null) return [];
    return [{ jobId: entry.jobId, knownGood: knownGood.suggestedPriority, local: local.suggestedPriority }];
  });

const priorityAggregate = (pairs: Array<{ knownGood: string; local: string }>, total: number) => {
  const matches = pairs.filter((pair) => pair.knownGood === pair.local).length;
  const counts = new Map<string, number>();
  pairs.forEach((pair) => counts.set(pair.local, (counts.get(pair.local) ?? 0) + 1));
  return {
    bothPresent: { count: pairs.length, rate: rate(pairs.length, total) },
    match: { count: matches, rate: rate(matches, pairs.length) },
    distribution: [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([priority, count]) => ({ priority, count, rate: rate(count, pairs.length) })),
  };
};

const groupCountAggregate = (entries: PerJobComparison[], key: 'knownGood' | 'local') => {
  const sides = entries.map((entry) => sideOf(entry, key)).filter((side): side is ComparisonSideSummary => Boolean(side));
  const total = sides.reduce((sum, side) => sum + side.groupCount, 0);
  return { total, average: sides.length > 0 ? Number((total / sides.length).toFixed(4)) : 0 };
};

const contextLeakageJobCount = (entries: PerJobComparison[], key: 'knownGood' | 'local'): number =>
  entries.filter((entry) => (sideOf(entry, key)?.contextLeakageIndicators.length ?? 0) > 0).length;

type SidePairCompare = (_knownGood: ComparisonSideSummary, _local: ComparisonSideSummary) => boolean;

const exactMatchCount = (entries: PerJobComparison[], compare: SidePairCompare): number =>
  entries.filter((entry) => {
    const knownGood = sideOf(entry, 'knownGood');
    const local = sideOf(entry, 'local');
    return knownGood && local ? compare(knownGood, local) : false;
  }).length;

const runBatchComparison = (options: BatchOptions) => {
  const comparisonSet = readJson<LocalModelComparisonSet>(options.comparisonSet);
  const v2JobsById = new Map(readV2Jobs(options.v2Run).map((job) => [job.jobId, job]));
  const localResultsById = new Map(readJsonl<AiStudyMapResult>(options.localResults).map((result) => [result.jobId, result]));
  const v1ResultsCache = new Map<string, Map<string, AiStudyMapResult>>();
  const findKnownGood = (location: string | undefined, jobId: string): AiStudyMapResult | undefined => {
    if (!location) return undefined;
    if (!v1ResultsCache.has(location)) {
      v1ResultsCache.set(location, new Map(readJsonl<AiStudyMapResult>(resolveV1Location(location, options.v1Run)).map((result) => [result.jobId, result])));
    }
    return v1ResultsCache.get(location)?.get(jobId);
  };
  const perJob: PerJobComparison[] = comparisonSet.jobs.map((entry) =>
    compareComparisonSetEntry(entry, v2JobsById, localResultsById, findKnownGood),
  );
  const total = perJob.length;
  const priorityPairs = priorityPairList(perJob);
  const priorityMatches = priorityPairs.filter((pair) => pair.knownGood === pair.local).length;
  const localInvalidCount = perJob.filter((entry) => entry.flags?.localSchemaInvalid).length;
  const dispositionMatches = exactMatchCount(perJob, (knownGood, local) => knownGood.disposition === local.disposition);
  const groupCountMatches = exactMatchCount(perJob, (knownGood, local) => knownGood.groupCount === local.groupCount);
  const childLabelMatches = exactMatchCount(perJob, (knownGood, local) => sameStringLists(knownGood.childLabelCoverage, local.childLabelCoverage));
  return {
    schemaVersion: 1,
    mode: 'batch',
    comparisonSet: options.comparisonSet,
    v2RunId: options.v2Run,
    v1RunId: options.v1Run,
    localResults: options.localResults,
    jobCount: total,
    comparisonSetSize: total,
    knownGoodFound: perJob.filter((entry) => sideOf(entry, 'knownGood') !== undefined).length,
    localAcceptedFound: perJob.filter((entry) => sideOf(entry, 'local') !== undefined).length,
    localMissingOrRejected: perJob.filter((entry) => entry.localStatus === 'missing-or-rejected').length,
    dispositionExactMatch: { count: dispositionMatches, rate: rate(dispositionMatches, total) },
    suggestedPriorityExactMatch: {
      count: priorityMatches,
      rate: rate(priorityMatches, priorityPairs.length),
      bothPresent: priorityPairs.length,
    },
    groupCountExactMatch: { count: groupCountMatches, rate: rate(groupCountMatches, total) },
    childLabelCoverageExactMatch: { count: childLabelMatches, rate: rate(childLabelMatches, total) },
    contextLeakageJobCount: {
      knownGood: contextLeakageJobCount(perJob, 'knownGood'),
      local: contextLeakageJobCount(perJob, 'local'),
    },
    localInvalidCount,
    falseSkipCandidates: perJob.filter((entry) => entry.flags?.falseSkipCandidate).map((entry) => entry.jobId),
    falseIncludeCandidates: perJob.filter((entry) => entry.flags?.falseIncludeCandidate).map((entry) => entry.jobId),
    aggregates: {
      disposition: {
        knownGood: dispositionAggregate(perJob, 'knownGood', total),
        local: dispositionAggregate(perJob, 'local', total),
      },
      suggestedPriority: priorityAggregate(priorityPairs, total),
      groupCount: {
        knownGood: groupCountAggregate(perJob, 'knownGood'),
        local: groupCountAggregate(perJob, 'local'),
      },
    },
    perJob,
    humanReviewRequired: true,
    notes: [
      ...NOTES,
      'Exact-match counts cover jobs where both known-good and local results are present; their rates are fractions of the comparison-set jobs, rounded to 4 decimal places.',
      'suggestedPriorityExactMatch.rate is the match rate among jobs where both sides carry a suggested priority.',
    ],
  };
};

export const __studyAiLocalMapCompareTest = {
  USAGE,
  parseRawArgs,
  planFromArgs,
  resolveV1Location,
  readV2Jobs,
  sideSummary,
  focusFacts,
  contextLeakageIndicators,
  runSingleJobComparison,
  runBatchComparison,
};

const main = (): void => {
  const plan = planFromArgs(parseRawArgs(process.argv.slice(2)));
  if (plan.mode === 'help' || plan.mode === 'usage-error') {
    const message = plan.mode === 'usage-error' ? `${plan.message}\n\n${plan.usage}` : plan.usage;
    if (plan.mode === 'help') console.log(message);
    else console.error(message);
    process.exit(plan.mode === 'help' ? 0 : 1);
  }
  const report = plan.mode === 'batch' ? runBatchComparison(plan.options) : runSingleJobComparison(plan.options);
  writeJson(plan.options.out, report);
};

if (process.argv[1]?.endsWith('studyAiLocalMapCompare.ts')) {
  main();
}
