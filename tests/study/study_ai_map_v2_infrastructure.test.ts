import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { __studyAiAuthoringTest } from '../../scripts/studyAiAuthoring';
import { runLocalMapAuthoring } from '../../scripts/studyAiLocalMapAuthor';
import { validateAiStudyMapResult } from '../../src/study/ai/studyAiValidation';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../../src/study/content/nbLawTypes';

const testRuns = ['ai-test-local-map-runner'];

afterEach(() => {
  testRuns.forEach((runId) => rmSync(join('study-content', 'ai', 'runs', runId), { recursive: true, force: true }));
});

const readCorpusPackage = (): NbLawContentPackage =>
  JSON.parse(readFileSync('study-content/packages/nb-sit-statute-corpus.content-package.json', 'utf8')) as NbLawContentPackage;

const corpusComponent = (pkg: NbLawContentPackage, documentId: string, sourceKey: string): NbLawDocumentComponent => {
  const document = pkg.documents.find((entry) => entry.id === documentId);
  const component = document?.components.find((entry) => entry.sourceKey === sourceKey);
  if (!component) throw new Error(`Missing fixture component ${documentId} ${sourceKey}`);
  return component;
};

const focusChildLabels = (component: NbLawDocumentComponent): string[] =>
  __studyAiAuthoringTest.sourceFocusOptionsFromComponent(component)?.[0]?.childLabels ?? [];

const jobFixture = (): AiStudyMapJob => {
  const text = '10 A person shall file a notice.';
  const base: AiStudyMapJob = {
    schemaVersion: 1,
    jobId: 'map-test-local',
    runId: 'ai-test-local-map-runner',
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: 'corpus-hash',
    inputHash: 'input-hash',
    document: { documentId: 'doc-test', title: 'Test Act', type: 'act' },
    target: {
      sourceKeys: ['section:10'],
      sectionLabels: ['10'],
      componentType: 'section',
      exactSourceText: text,
      operativeSourceText: text,
      sourceMetadata: {},
      sourceStatus: 'current',
      approximateInputSize: { exactCharacters: text.length, operativeCharacters: text.length, largeSection: false },
      sourceFocusOptions: [{ sourceKey: 'section:10', label: '10' }],
      sourceHashes: { 'section:10': 'source-hash' },
    },
    context: {},
  };
  return { ...base, authoringInputFingerprint: authoringInputFingerprint(base) };
};

const resultFixture = (job = jobFixture()): AiStudyMapResult => ({
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
      focusSelections: [{ sourceKey: 'section:10', evidenceText: ['shall file a notice'] }],
      reason: 'One duty is stated in the target source.',
      approximateLearningGoal: 'Know that notice filing is required.',
    },
  ],
  warnings: [],
});

const writeJobRun = (job: AiStudyMapJob): void => {
  const runDir = join('study-content', 'ai', 'runs', job.runId);
  mkdirSync(join(runDir, 'jobs'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });
  writeFileSync(join(runDir, 'jobs', 'batch-001.jobs.jsonl'), `${JSON.stringify(job)}\n`);
  writeFileSync(join(runDir, 'reports', 'batch-manifest.json'), '{"batchCount":1}\n');
};

describe('Study Map V2 infrastructure repairs', () => {
  it('keeps only parsed direct structural child labels and preserves definition terms', () => {
    const pkg = readCorpusPackage();

    expect(focusChildLabels(corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-act', 'section:18(2)'))).not.toContain('18(2)(2)');
    expect(focusChildLabels(corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-act', 'section:31(1)'))).not.toContain('31(1)(2)');
    expect(focusChildLabels(corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-bylaws', 'section:2.2.6'))).not.toContain('2.2.6(5)');
    expect(focusChildLabels(corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-bylaws', 'section:8.2.4.1'))).not.toContain('8.2.4.1(14)');
    expect(focusChildLabels(corpusComponent(pkg, 'doc-boundaries-confirmation-act', 'section:10'))).toEqual([
      '10(1)',
      '10(2)',
      '10(3)',
      '10(4)',
      '10(5)',
      '10(6)',
    ]);
    expect(__studyAiAuthoringTest.sourceFocusOptionsFromComponent(corpusComponent(pkg, 'doc-surveys-act', 'section:1'))?.[0]?.definedTerms).toContain('surveyor');
    expect(__studyAiAuthoringTest.sourceFocusOptionsFromComponent(corpusComponent(pkg, 'doc-community-planning-act', 'schedule:schedule-a'))?.[0]?.sourceKey).toBe('schedule:schedule-a');
  });

  it('fails closed on malformed Study Map V3 result shapes before grounding', () => {
    const job = jobFixture();
    const invalidCases = [
      { ...resultFixture(job), proposedGroups: [{ ...resultFixture(job).proposedGroups[0], focusSelections: [{ sourceKey: 'section:10', evidenceText: 'shall file' }] }] },
      { ...resultFixture(job), proposedGroups: [{ ...resultFixture(job).proposedGroups[0], groupId: undefined }] },
      { ...resultFixture(job), proposedGroups: [{ ...resultFixture(job).proposedGroups[0], title: 'Wrong', titleSuggestion: undefined }] },
      { ...resultFixture(job), disposition: 'other' },
      { ...resultFixture(job), confidence: 'certain' },
      { ...resultFixture(job), proposedGroups: [{ ...resultFixture(job).proposedGroups[0], sourceKeys: 'section:10' }] },
      { ...resultFixture(job), proposedGroups: [{ ...resultFixture(job).proposedGroups[0], focusSelections: null }] },
      { ...resultFixture(job), warnings: null },
    ];

    invalidCases.forEach((value) => {
      const report = validateAiStudyMapResult(value, job);
      expect(report.valid).toBe(false);
      expect(report.issues.map((issue) => issue.code)).not.toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
    });
  });

  it('writes accepted local results canonically and leaves invalid results outside canonical output', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { ...resultFixture(job), confidence: 'certain' } : resultFixture(job)) } }] }),
        text: async () => '',
      };
    };

    const result = await runLocalMapAuthoring({
      runId: job.runId,
      model: 'mock-model',
      baseUrl: 'http://mock/v1',
      resume: true,
      concurrency: 1,
      maxRetries: 2,
      dryRun: false,
      unsafeUnstructured: false,
    }, fetchMock);

    expect(result.accepted).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toBe(2);
    expect(readFileSync(join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'), 'utf8').trim().split(/\r?\n/)).toHaveLength(1);
    expect(existsSync(join('study-content', 'ai', 'runs', job.runId, 'local-failures', job.jobId, 'attempt-1.validation.json'))).toBe(true);
  });

  it('skips already accepted local results on resume without duplicate lines', async () => {
    const job = jobFixture();
    writeJobRun(job);
    mkdirSync(join('study-content', 'ai', 'runs', job.runId, 'results'), { recursive: true });
    writeFileSync(join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'), `${JSON.stringify(resultFixture(job))}\n`);

    const result = await runLocalMapAuthoring({
      runId: job.runId,
      model: 'mock-model',
      baseUrl: 'http://mock/v1',
      resume: true,
      concurrency: 1,
      maxRetries: 2,
      dryRun: false,
      unsafeUnstructured: false,
    }, async () => {
      throw new Error('fetch should not be called on resume');
    });

    expect(result.skipped).toBe(1);
    expect(readFileSync(join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'), 'utf8').trim().split(/\r?\n/)).toHaveLength(1);
  });

  it('fails closed when structured output is rejected by the provider', async () => {
    const job = jobFixture();
    writeJobRun(job);

    const result = await runLocalMapAuthoring({
      runId: job.runId,
      model: 'mock-model',
      baseUrl: 'http://mock/v1',
      resume: true,
      concurrency: 1,
      maxRetries: 0,
      dryRun: false,
      unsafeUnstructured: false,
    }, async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => 'json_schema response_format unsupported',
    }));

    expect(result.accepted).toBe(0);
    expect(result.failed).toBe(1);
    expect(existsSync(join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'))).toBe(false);
    expect(existsSync(join('study-content', 'ai', 'runs', job.runId, 'local-failures', job.jobId, 'attempt-1.validation.json'))).toBe(true);
  });

  it('rejects wrong local result identity outside canonical output', async () => {
    const job = jobFixture();
    writeJobRun(job);

    const result = await runLocalMapAuthoring({
      runId: job.runId,
      model: 'mock-model',
      baseUrl: 'http://mock/v1',
      resume: true,
      concurrency: 1,
      maxRetries: 0,
      dryRun: false,
      unsafeUnstructured: false,
    }, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...resultFixture(job), jobId: 'wrong-job' }) } }] }),
      text: async () => '',
    }));

    expect(result.accepted).toBe(0);
    expect(result.failed).toBe(1);
    expect(existsSync(join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'))).toBe(false);
  });
});
