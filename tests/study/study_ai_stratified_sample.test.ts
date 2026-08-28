import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import {
  attachV1Mapping,
  buildStratifiedSample,
  type SampleOptions,
} from '../../scripts/studyAiBuildStratifiedMapSample';

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const makeJob = (documentId: string, index: number, text: string): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId: `${documentId}-job-${String(index).padStart(3, '0')}`,
  runId: 'test-base-run',
  promptSpecVersion: 'test',
  corpusContentHash: hashText(`${documentId}:corpus`),
  inputHash: hashText(`${documentId}:${index}`),
  authoringInputFingerprint: hashText(`fp:${documentId}:${index}`),
  document: { documentId, title: `Doc ${documentId}`, type: 'act' },
  target: {
    sourceKeys: [`${documentId}/s${index}`],
    sectionLabels: [`Section ${index}`],
    exactSourceText: text,
    operativeSourceText: text,
    sourceMetadata: {},
    sourceStatus: 'current',
    approximateInputSize: {
      exactCharacters: text.length,
      operativeCharacters: text.length,
      largeSection: text.length > 1200,
    },
    sourceHashes: { [`${documentId}/s${index}`]: hashText(`${documentId}:${index}`) },
  },
  context: {},
});

const options = (size: number, seed = 'seed-a'): SampleOptions => ({
  baseRunId: 'test-base-run',
  seed,
  size,
  perDocument: 0,
});

const corpus = (): AiStudyMapJob[] => [
  makeJob('doc-a', 1, 'Every surveyor shall file the plan of survey within thirty days of completion.'),
  makeJob('doc-a', 2, 'A person may apply for a licence under this section.'),
  makeJob('doc-a', 3, 'No person shall remove a survey monument.'),
  makeJob('doc-a', 4, 'The minister may, by order, regulate the practice of surveying in the manner set out in this schedule, which applies throughout.'),
  makeJob('doc-b', 1, 'The board may issue a notice of refusal stating reasons.'),
  makeJob('doc-b', 2, 'A fee prescribed by the regulations is payable on application.'),
  makeJob('doc-b', 3, 'Subsection 3(1) is repealed.'),
  makeJob('doc-b', 4, 'This Act comes into force on a day fixed by proclamation.'),
  makeJob('doc-c', 1, 'For the purposes of this Act, "boundary" means a line separating lands.'),
];

describe('buildStratifiedSample', () => {
  it('selects exactly the requested size without duplicates', () => {
    const result = buildStratifiedSample(corpus(), options(6));
    const ids = result.selected.map((entry) => entry.job.jobId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('is deterministic for the same seed and stable across calls', () => {
    const first = buildStratifiedSample(corpus(), options(6));
    const second = buildStratifiedSample(corpus(), options(6));
    expect(first.sampleSha256).toBe(second.sampleSha256);
    expect(first.selected.map((entry) => entry.job.jobId)).toEqual(
      second.selected.map((entry) => entry.job.jobId),
    );
  });

  it('changes the sample when the seed changes (when the corpus is larger than the sample)', () => {
    const jobs = corpus().concat(
      Array.from({ length: 12 }, (_, i) => makeJob('doc-d', i + 1, `Additional operative provision ${i} with enough text to matter.`)),
    );
    const first = buildStratifiedSample(jobs, options(10, 'seed-a'));
    const second = buildStratifiedSample(jobs, options(10, 'seed-b'));
    expect(first.sampleSha256).not.toBe(second.sampleSha256);
  });

  it('caps per-document selection at the available job count and records top-ups', () => {
    const result = buildStratifiedSample(corpus(), options(8));
    const byDoc = new Map<string, number>();
    for (const entry of result.selected) {
      const id = entry.job.document.documentId;
      byDoc.set(id, (byDoc.get(id) ?? 0) + 1);
    }
    expect(byDoc.get('doc-a')).toBeLessThanOrEqual(4);
    expect(byDoc.get('doc-b')).toBeLessThanOrEqual(4);
    expect(byDoc.get('doc-c')).toBeLessThanOrEqual(1);
    // doc-c is capped at 1, so its unfilled share is redistributed elsewhere.
    const plan = result.documents.find((doc) => doc.documentId === 'doc-c');
    expect(plan?.finalQuota).toBe(1);
    expect(result.documents.filter((doc) => doc.topUp > 0).reduce((sum, doc) => sum + doc.topUp, 0)).toBeGreaterThan(0);
    expect(result.unmetCoverageNotes.some((note) => note.includes('absorbed'))).toBe(true);
  });

  it('honors an explicit per-document quota as the base and redistributes shortfalls', () => {
    const result = buildStratifiedSample(corpus(), { ...options(6), perDocument: 2 });
    const byDoc = new Map<string, number>();
    for (const entry of result.selected) {
      const id = entry.job.document.documentId;
      byDoc.set(id, (byDoc.get(id) ?? 0) + 1);
    }
    for (const [documentId, count] of byDoc.entries()) {
      const plan = result.documents.find((doc) => doc.documentId === documentId);
      expect(count).toBe(plan?.finalQuota);
      expect(count).toBeLessThanOrEqual(plan?.eligible ?? 0);
    }
    // doc-c only has 1 job, so its quota-2 shortfall is redistributed elsewhere.
    expect(result.documents.find((doc) => doc.documentId === 'doc-c')?.finalQuota).toBe(1);
    expect(result.unmetCoverageNotes.some((note) => note.includes('shortfall'))).toBe(true);
  });

  it('throws for non-positive sizes', () => {
    expect(() => buildStratifiedSample(corpus(), options(0))).toThrow();
  });
});

describe('attachV1Mapping', () => {
  const selected = (() => {
    const jobs = corpus();
    return buildStratifiedSample(jobs, options(3)).selected;
  })();
  const firstJob = selected[0]?.job;

  it('returns nulls when no V1 index is available', () => {
    const mapping = attachV1Mapping(selected, null);
    expect(mapping).toHaveLength(selected.length);
    expect(mapping.every((entry) => entry.v1JobId === null)).toBe(true);
  });

  it('maps by document + source keys + section labels', () => {
    if (!firstJob) throw new Error('expected a selected job');
    const job = firstJob;
    const v1Job: AiStudyMapJob = { ...job, jobId: `v1-${job.jobId}` };
    const v1Result: AiStudyMapResult = {
      jobId: v1Job.jobId,
      runId: 'ai-map-4c1-full-corpus-v1',
      corpusContentHash: v1Job.corpusContentHash,
      inputHash: v1Job.inputHash,
      promptSpecVersion: v1Job.promptSpecVersion,
      authoringInputFingerprint: v1Job.authoringInputFingerprint,
      disposition: 'standalone',
      confidence: 'high',
      reason: 'ok',
      proposedGroups: [],
      warnings: [],
      suggestedPriority: 'P3',
      schemaVersion: 1,
    };
    const index = {
      jobs: new Map<string, AiStudyMapJob>([
        [`${job.document.documentId}::${job.target.sourceKeys.join('|')}::${job.target.sectionLabels.join('|')}`, v1Job],
      ]),
      resultByJob: new Map([[v1Job.jobId, { file: 'batch-001.results.jsonl', value: v1Result }]]),
    };
    const mapping = attachV1Mapping(selected, index as never);
    const hit = mapping[0];
    expect(hit.v1JobId).toBe(v1Job.jobId);
    expect(hit.v1KnownGoodResultLocation).toBe('ai-map-4c1-full-corpus-v1/results/batch-001.results.jsonl');
    expect(hit.v1ResultIdentity).toBe('ai-map-4c1-full-corpus-v1:' + v1Job.jobId);
  });
});
