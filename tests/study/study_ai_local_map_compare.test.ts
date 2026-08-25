import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { __studyAiLocalMapCompareTest } from '../../scripts/studyAiLocalMapCompare';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';

const V2_RUN = 'ai-test-compare-v2';
const V1_RUN = 'ai-test-compare-v1';
const SINGLE_RUN = 'ai-test-compare-single';
const testRuns = [V2_RUN, V1_RUN, SINGLE_RUN];
const RUNS = join('study-content', 'ai', 'runs');
const SOURCE_TEXT = '10 A person shall file a notice.';

afterEach(() => {
  testRuns.forEach((runId) => rmSync(join(RUNS, runId), { recursive: true, force: true }));
});

const jobFixture = (jobId: string, runId: string): AiStudyMapJob => {
  const base: AiStudyMapJob = {
    schemaVersion: 1,
    jobId,
    runId,
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: 'corpus-hash',
    inputHash: 'input-hash',
    document: { documentId: 'doc-cmp', title: 'Compare Act', type: 'act' },
    target: {
      sourceKeys: ['section:10'],
      sectionLabels: ['10'],
      componentType: 'section',
      exactSourceText: SOURCE_TEXT,
      operativeSourceText: SOURCE_TEXT,
      sourceMetadata: {},
      sourceStatus: 'current',
      approximateInputSize: { exactCharacters: SOURCE_TEXT.length, operativeCharacters: SOURCE_TEXT.length, largeSection: false },
      sourceFocusOptions: [{ sourceKey: 'section:10', label: '10' }],
      sourceHashes: { 'section:10': 'source-hash' },
    },
    context: {},
  };
  return { ...base, authoringInputFingerprint: authoringInputFingerprint(base) };
};

const resultFixture = (job: AiStudyMapJob, overrides: Partial<AiStudyMapResult> = {}): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId: job.jobId,
  runId: job.runId,
  corpusContentHash: job.corpusContentHash,
  inputHash: job.inputHash,
  authoringInputFingerprint: authoringInputFingerprint(job),
  promptSpecVersion: job.promptSpecVersion,
  disposition: 'standalone',
  confidence: 'high',
  reason: 'The source contains one focused filing duty.',
  suggestedPriority: 'P2',
  proposedGroups: [
    {
      groupId: 'group-1',
      titleSuggestion: 'Notice filing duty',
      sourceKeys: ['section:10'],
      focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)'], evidenceText: ['shall file a notice'] }],
      reason: 'One duty is stated in the target source.',
      approximateLearningGoal: 'Know that notice filing is required.',
    },
  ],
  warnings: [],
  ...overrides,
});

const skipResultFixture = (job: AiStudyMapJob): AiStudyMapResult => ({
  ...resultFixture(job, { disposition: 'skip', reason: 'No focused learning material in the source.' }),
  proposedGroups: [],
});

const leakyResultFixture = (job: AiStudyMapJob): AiStudyMapResult =>
  resultFixture(job, {
    reason: 'The duty appears alongside adjacent context.',
    proposedGroups: [
      {
        groupId: 'group-1',
        titleSuggestion: 'Notice filing duty',
        sourceKeys: ['section:10', 'section:11'],
        focusSelections: [{ sourceKey: 'section:10', childLabels: ['11(1)'], evidenceText: ['totally absent evidence'] }],
        reason: 'One duty is stated in the target source.',
        approximateLearningGoal: 'Know that notice filing is required.',
      },
    ],
  });

const writeJsonl = (path: string, rows: unknown[]): void => {
  const fullPath = join(RUNS, path);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(fullPath, rows.length > 0 ? `${body}\n` : '');
};

const setupBatch = () => {
  const jobs = ['cmp-a', 'cmp-b', 'cmp-c', 'cmp-d'].map((jobId) => jobFixture(jobId, V2_RUN));
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  const knownGood: Record<string, AiStudyMapResult> = {
    'cmp-a': resultFixture(byId.get('cmp-a') as AiStudyMapJob),
    'cmp-b': resultFixture(byId.get('cmp-b') as AiStudyMapJob),
    'cmp-c': skipResultFixture(byId.get('cmp-c') as AiStudyMapJob),
    'cmp-d': skipResultFixture(byId.get('cmp-d') as AiStudyMapJob),
  };
  const local: Record<string, AiStudyMapResult> = {
    'cmp-a': resultFixture(byId.get('cmp-a') as AiStudyMapJob),
    'cmp-b': skipResultFixture(byId.get('cmp-b') as AiStudyMapJob),
    'cmp-d': leakyResultFixture(byId.get('cmp-d') as AiStudyMapJob),
  };
  const v1Location = `${V1_RUN}/results/batch-001.results.jsonl`;
  const comparisonSet = {
    schemaVersion: 1,
    v2RunId: V2_RUN,
    size: 5,
    jobs: ['cmp-a', 'cmp-b', 'cmp-c', 'cmp-d', 'cmp-e'].map((jobId, index) => ({
      v2JobId: jobId,
      document: { documentId: 'doc-cmp', title: 'Compare Act', citation: 'SB 2026-1', type: 'act' },
      target: '10',
      complexityCategory: index % 2 === 0 ? ['single-section'] : ['multi-clause'],
      v1KnownGoodResultLocation: v1Location,
      v1ResultIdentity: `${V1_RUN}:${jobId}`,
      v2Fingerprint: `fp-${jobId}`,
    })),
  };
  writeJsonl(`${V2_RUN}/jobs/batch-001.jobs.jsonl`, jobs);
  writeJsonl(`${V2_RUN}/results/local-map.results.jsonl`, Object.values(local));
  writeJsonl(`${V1_RUN}/results/batch-001.results.jsonl`, Object.values(knownGood));
  mkdirSync(join(RUNS, V2_RUN, 'reports'), { recursive: true });
  writeFileSync(join(RUNS, V2_RUN, 'reports', 'local-model-comparison-set.json'), `${JSON.stringify(comparisonSet, null, 2)}\n`);
  return { byId, knownGood, local, comparisonSet };
};

describe('Study Map local comparison CLI planning', () => {
  it('shows usage when no mode is selected and treats --help as help', () => {
    expect(__studyAiLocalMapCompareTest.planFromArgs(__studyAiLocalMapCompareTest.parseRawArgs([]))).toMatchObject({
      mode: 'usage-error',
      message: 'No comparison mode selected.',
    });
    expect(__studyAiLocalMapCompareTest.planFromArgs(__studyAiLocalMapCompareTest.parseRawArgs(['--help']))).toMatchObject({
      mode: 'help',
      usage: __studyAiLocalMapCompareTest.USAGE,
    });
  });

  it('reports every missing required argument for both modes instead of reading undefined paths', () => {
    const single = __studyAiLocalMapCompareTest.planFromArgs(
      __studyAiLocalMapCompareTest.parseRawArgs(['--job', 'job.json', '--local', 'local.json']),
    );
    expect(single.mode).toBe('usage-error');
    if (single.mode === 'usage-error') expect(single.message).toBe('Missing required argument: --known-good.');

    const batch = __studyAiLocalMapCompareTest.planFromArgs(
      __studyAiLocalMapCompareTest.parseRawArgs(['--comparison-set', 'set.json', '--local-results', 'local.jsonl']),
    );
    expect(batch.mode).toBe('usage-error');
    if (batch.mode === 'usage-error') expect(batch.message).toBe('Missing required arguments: --v2-run, --v1-run.');

    const planned = __studyAiLocalMapCompareTest.planFromArgs(
      __studyAiLocalMapCompareTest.parseRawArgs(['--job', 'job.json', '--known-good', 'kg.json', '--local', 'local.json', '--out', 'out.json']),
    );
    expect(planned).toMatchObject({ mode: 'single', options: { job: 'job.json', knownGood: 'kg.json', local: 'local.json', out: 'out.json' } });

    const plannedBatch = __studyAiLocalMapCompareTest.planFromArgs(
      __studyAiLocalMapCompareTest.parseRawArgs(['--comparison-set', 'set.json', '--local-results', 'local.jsonl', '--v2-run', V2_RUN, '--v1-run', V1_RUN]),
    );
    expect(plannedBatch).toMatchObject({ mode: 'batch', options: { comparisonSet: 'set.json', localResults: 'local.jsonl', v2Run: V2_RUN, v1Run: V1_RUN, out: 'study-map-local-comparison-report.json' } });
  });

  it('resolves V1 known-good locations against the V1 run directory deterministically', () => {
    expect(__studyAiLocalMapCompareTest.resolveV1Location('study-content/ai/runs/other/runs.jsonl', V1_RUN)).toBe('study-content/ai/runs/other/runs.jsonl');
    expect(__studyAiLocalMapCompareTest.resolveV1Location(`${V1_RUN}/results/batch-001.results.jsonl`, V1_RUN)).toBe(`study-content/ai/runs/${V1_RUN}/results/batch-001.results.jsonl`);
    expect(__studyAiLocalMapCompareTest.resolveV1Location('results/batch-001.results.jsonl', V1_RUN)).toBe(`study-content/ai/runs/${V1_RUN}/results/batch-001.results.jsonl`);
    expect(__studyAiLocalMapCompareTest.resolveV1Location('./results/batch-001.results.jsonl', V1_RUN)).toBe(`study-content/ai/runs/${V1_RUN}/results/batch-001.results.jsonl`);
  });
});

describe('Study Map local comparison single-job mode', () => {
  it('preserves the original report shape for a single job', () => {
    const job = jobFixture('cmp-single', SINGLE_RUN);
    mkdirSync(join(RUNS, SINGLE_RUN), { recursive: true });
    writeFileSync(join(RUNS, SINGLE_RUN, 'job.json'), JSON.stringify(job));
    writeFileSync(join(RUNS, SINGLE_RUN, 'known-good.json'), JSON.stringify(resultFixture(job)));
    writeFileSync(join(RUNS, SINGLE_RUN, 'local.json'), JSON.stringify(skipResultFixture(job)));

    const report = __studyAiLocalMapCompareTest.runSingleJobComparison({
      job: join(RUNS, SINGLE_RUN, 'job.json'),
      knownGood: join(RUNS, SINGLE_RUN, 'known-good.json'),
      local: join(RUNS, SINGLE_RUN, 'local.json'),
      out: join(RUNS, SINGLE_RUN, 'report.json'),
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      jobId: 'cmp-single',
      document: { documentId: 'doc-cmp', title: 'Compare Act', type: 'act' },
      target: ['10'],
      humanReviewRequired: true,
    });
    expect(report.knownGood).toMatchObject({
      disposition: 'standalone',
      confidence: 'high',
      suggestedPriority: 'P2',
      schemaValid: true,
      validationIssues: [],
      contextLeakageIndicators: [],
      groupCount: 1,
      childLabelCoverage: ['10(1)'],
      definedTermCoverage: [],
    });
    expect(report.local).toMatchObject({ disposition: 'skip', schemaValid: true, groupCount: 0, childLabelCoverage: [] });
  });
});

describe('Study Map local comparison batch mode', () => {
  const options = () => ({
    comparisonSet: join(RUNS, V2_RUN, 'reports', 'local-model-comparison-set.json'),
    localResults: join(RUNS, V2_RUN, 'results', 'local-map.results.jsonl'),
    v2Run: V2_RUN,
    v1Run: V1_RUN,
    out: join(RUNS, V2_RUN, 'report.json'),
  });

  const side = (report: ReturnType<typeof __studyAiLocalMapCompareTest.runBatchComparison>, jobId: string, key: 'knownGood' | 'local') =>
    report.perJob.find((entry) => entry.jobId === jobId)?.[key];

  it('compares every comparison-set job against V2 jobs, V1 known-good results, and local results', () => {
    const { byId } = setupBatch();
    const report = __studyAiLocalMapCompareTest.runBatchComparison(options());

    expect(report).toMatchObject({
      schemaVersion: 1,
      mode: 'batch',
      comparisonSet: options().comparisonSet,
      v2RunId: V2_RUN,
      v1RunId: V1_RUN,
      localResults: options().localResults,
      jobCount: 5,
      comparisonSetSize: 5,
      knownGoodFound: 4,
      localAcceptedFound: 3,
      localMissingOrRejected: 1,
      humanReviewRequired: true,
    });
    expect(report.perJob.map((entry) => entry.jobId)).toEqual(['cmp-a', 'cmp-b', 'cmp-c', 'cmp-d', 'cmp-e']);

    expect(side(report, 'cmp-a', 'knownGood')).toMatchObject({ disposition: 'standalone', schemaValid: true, contextLeakageIndicators: [] });
    expect(side(report, 'cmp-a', 'local')).toMatchObject({ disposition: 'standalone', schemaValid: true, childLabelCoverage: ['10(1)'] });
    expect(report.perJob[0]?.localStatus).toBe('present');
    expect(report.perJob[0]?.flags).toEqual({
      dispositionMismatch: false,
      groupCountMismatch: false,
      childLabelCoverageMismatch: false,
      priorityMismatch: false,
      contextLeakage: { knownGood: false, local: false },
      falseSkipCandidate: false,
      falseIncludeCandidate: false,
      localSchemaInvalid: false,
    });
    expect(report.perJob[0]?.document).toEqual(byId.get('cmp-a')?.document);
    expect(report.perJob[0]?.target).toEqual(['10']);
    expect(report.perJob[0]?.complexityCategory).toEqual(['single-section']);

    expect(report.perJob[1]?.flags).toMatchObject({
      dispositionMismatch: true,
      groupCountMismatch: true,
      childLabelCoverageMismatch: true,
      priorityMismatch: false,
      contextLeakage: { knownGood: false, local: false },
      falseSkipCandidate: true,
      falseIncludeCandidate: false,
    });
    expect(report.perJob[2]?.knownGood).toMatchObject({ disposition: 'skip', schemaValid: true });
    expect(report.perJob[2]?.local).toEqual({ status: 'missing-or-rejected' });
    expect(report.perJob[2]?.localStatus).toBe('missing-or-rejected');
    expect(report.perJob[2]?.flags).toMatchObject({
      dispositionMismatch: null,
      groupCountMismatch: null,
      childLabelCoverageMismatch: null,
      priorityMismatch: null,
      localSchemaInvalid: false,
      falseSkipCandidate: false,
      falseIncludeCandidate: false,
    });
    expect(report.perJob[3]?.flags).toMatchObject({
      dispositionMismatch: true,
      groupCountMismatch: true,
      contextLeakage: { knownGood: false, local: true },
      localSchemaInvalid: true,
      falseIncludeCandidate: true,
    });
    const leakyLocal = side(report, 'cmp-d', 'local') as
      | { contextLeakageIndicators?: string[]; validationIssues?: { code: string }[] }
      | undefined;
    expect(leakyLocal?.contextLeakageIndicators).toEqual(['section:11']);
    expect(leakyLocal?.validationIssues?.map((issue) => issue.code)).toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
    expect(report.perJob[4]).toMatchObject({ jobId: 'cmp-e', status: 'v2-job-missing', complexityCategory: ['single-section'] });
  });

  it('computes deterministic aggregates over the comparison set', () => {
    setupBatch();
    const report = __studyAiLocalMapCompareTest.runBatchComparison(options());

    expect(report.aggregates.disposition.knownGood).toEqual([
      { disposition: 'skip', count: 2, rate: 0.4 },
      { disposition: 'standalone', count: 2, rate: 0.4 },
    ]);
    expect(report.aggregates.disposition.local).toEqual([
      { disposition: 'skip', count: 1, rate: 0.2 },
      { disposition: 'standalone', count: 2, rate: 0.4 },
    ]);
    expect(report.aggregates.suggestedPriority).toEqual({
      bothPresent: { count: 3, rate: 0.6 },
      match: { count: 3, rate: 1 },
      distribution: [{ priority: 'P2', count: 3, rate: 1 }],
    });
    expect(report.aggregates.groupCount.knownGood).toEqual({ total: 2, average: 0.5 });
    expect(report.aggregates.groupCount.local).toEqual({ total: 2, average: 0.6667 });
    expect(report.dispositionExactMatch).toEqual({ count: 1, rate: 0.2 });
    expect(report.suggestedPriorityExactMatch).toEqual({ count: 3, rate: 1, bothPresent: 3 });
    expect(report.groupCountExactMatch).toEqual({ count: 1, rate: 0.2 });
    expect(report.childLabelCoverageExactMatch).toEqual({ count: 1, rate: 0.2 });
    expect(report.contextLeakageJobCount).toEqual({ knownGood: 0, local: 1 });
    expect(report.localInvalidCount).toBe(1);
    expect(report.falseSkipCandidates).toEqual(['cmp-b']);
    expect(report.falseIncludeCandidates).toEqual(['cmp-d']);
    expect(report.notes).toContain('suggestedPriorityExactMatch.rate is the match rate among jobs where both sides carry a suggested priority.');
  });

  it('reads V2 jobs from sorted jobs files and tolerates a missing jobs directory', () => {
    expect(__studyAiLocalMapCompareTest.readV2Jobs('ai-test-compare-missing')).toEqual([]);
    const jobs = ['cmp-x', 'cmp-y'].map((jobId) => jobFixture(jobId, V2_RUN));
    mkdirSync(join(RUNS, V2_RUN, 'jobs'), { recursive: true });
    writeFileSync(join(RUNS, V2_RUN, 'jobs', 'batch-002.jobs.jsonl'), `${JSON.stringify(jobs[1])}\n`);
    writeFileSync(join(RUNS, V2_RUN, 'jobs', 'batch-001.jobs.jsonl'), `${JSON.stringify(jobs[0])}\n`);
    expect(__studyAiLocalMapCompareTest.readV2Jobs(V2_RUN).map((job) => job.jobId)).toEqual(['cmp-x', 'cmp-y']);
  });
});
