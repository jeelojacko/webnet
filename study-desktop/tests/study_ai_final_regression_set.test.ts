import { describe, expect, it } from 'vitest';
import {
  buildFinalRegressionSet,
  FIXED_JOBS,
  type FinalRegressionJobLike,
} from '../../scripts/studyAiBuildFinalRegressionSet';

const makeJob = (
  jobId: string,
  documentId: string,
  sourceKey: string,
  consequential = false,
): FinalRegressionJobLike => ({
  jobId,
  document: { documentId, title: `Title ${documentId}` },
  target: {
    sourceKeys: [sourceKey],
    ...(consequential ? { contentFlags: { consequentialAmendment: true } } : {}),
  },
  authoringInputFingerprint: `fp:${jobId}`,
});

const fixedCorpusJobs = (): FinalRegressionJobLike[] =>
  FIXED_JOBS.map((spec) => makeJob(spec.jobId, spec.expectedDocumentId, spec.expectedSourceKeys[0]));

const run = (jobs: FinalRegressionJobLike[], exclusionJobIds: Set<string> = new Set()) =>
  buildFinalRegressionSet({ jobs, fixedJobs: FIXED_JOBS, exclusionJobIds });

describe('final regression set builder (15 jobs)', () => {
  it('returns exactly 15 unique v2JobIds in the fixed order for a corpus containing all fixed jobs', () => {
    const corpus = [
      ...fixedCorpusJobs(),
      makeJob('map-10', 'doc-x', 'section:1', true),
      makeJob('map-2', 'doc-x', 'section:2', true),
      makeJob('map-30', 'doc-x', 'section:3', true),
    ];
    const result = run(corpus);

    expect(result.jobs).toHaveLength(15);
    expect(new Set(result.jobs.map((job) => job.v2JobId)).size).toBe(15);
    expect(result.jobs.slice(0, 14).map((job) => job.v2JobId)).toEqual(
      FIXED_JOBS.map((spec) => spec.jobId),
    );
    // The 15th is the lexicographically-smallest consequential candidate.
    expect(result.jobs[14].v2JobId).toBe('map-10');
    expect(result.jobs[14].label).toBe('unseen-consequential-amendment');
    expect(result.selectedJobId).toBe('map-10');
    // Every entry carries the runner-consumable shape.
    for (const entry of result.jobs) {
      expect(entry).toHaveProperty('v2JobId');
      expect(entry).toHaveProperty('label');
      expect(entry.document).toHaveProperty('documentId');
      expect(entry.document).toHaveProperty('title');
      expect(entry).toHaveProperty('target');
      expect(entry).toHaveProperty('sourceKey');
      expect(entry).toHaveProperty('authoringInputFingerprint');
      expect(entry).toHaveProperty('reasonSelected');
    }
  });

  it('derives target as the first sourceKey without its section: prefix', () => {
    const corpus = [...fixedCorpusJobs(), makeJob('map-10', 'doc-x', 'section:1', true)];
    const result = run(corpus);
    expect(result.jobs[0].target).toBe('20');
    expect(result.jobs[0].sourceKey).toBe('section:20');
    expect(result.jobs[14].target).toBe('1');
  });

  it('fails closed on an expected-identity mismatch (wrong documentId)', () => {
    const corpus = fixedCorpusJobs();
    corpus[0] = makeJob(FIXED_JOBS[0].jobId, 'doc-wrong', 'section:20');
    expect(() => run(corpus)).toThrow(/identity mismatch/);
  });

  it('fails closed on an expected-identity mismatch (wrong sourceKeys)', () => {
    const corpus = fixedCorpusJobs();
    corpus[0] = makeJob(FIXED_JOBS[0].jobId, FIXED_JOBS[0].expectedDocumentId, 'section:21');
    expect(() => run(corpus)).toThrow(/identity mismatch/);
  });

  it('fails closed when a fixed jobId is missing', () => {
    const corpus = fixedCorpusJobs().filter((job) => job.jobId !== FIXED_JOBS[3].jobId);
    expect(() => run(corpus)).toThrow(/missing from base run/);
  });

  it('fails closed on duplicate jobIds in the corpus', () => {
    const corpus = [...fixedCorpusJobs(), ...fixedCorpusJobs()];
    expect(() => run(corpus)).toThrow(/duplicate jobId/);
  });

  it('selects the lexicographically-smallest consequentialAmendment candidate not excluded', () => {
    const corpus = [
      ...fixedCorpusJobs(),
      makeJob('map-10', 'doc-x', 'section:1', true),
      makeJob('map-2', 'doc-x', 'section:2', true),
      makeJob('map-30', 'doc-x', 'section:3', true),
      makeJob('map-non-flagged', 'doc-x', 'section:4'),
    ];
    // map-10 is excluded; map-2 is the smallest remaining candidate.
    const result = run(corpus, new Set(['map-10']));
    expect(result.selectedJobId).toBe('map-2');
    expect(result.jobs[14].v2JobId).toBe('map-2');
    // Non-flagged jobs never enter the candidate pool.
    expect(result.jobs[14].v2JobId).not.toBe('map-non-flagged');
  });

  it('skips excluded candidates and fails closed when none remain', () => {
    const corpus = [
      ...fixedCorpusJobs(),
      makeJob('map-10', 'doc-x', 'section:1', true),
      makeJob('map-2', 'doc-x', 'section:2', true),
    ];
    const allExcluded = new Set(['map-10', 'map-2']);
    expect(() => run(corpus, allExcluded)).toThrow(/no unseen consequentialAmendment candidate/);
  });

  it('fails closed when no consequentialAmendment candidate exists at all', () => {
    expect(() => run(fixedCorpusJobs())).toThrow(/no unseen consequentialAmendment candidate/);
  });

  it('serializes deterministically across two calls', () => {
    const corpus = [
      ...fixedCorpusJobs(),
      makeJob('map-10', 'doc-x', 'section:1', true),
      makeJob('map-2', 'doc-x', 'section:2', true),
    ];
    const first = JSON.stringify(run(corpus));
    const second = JSON.stringify(run(corpus));
    expect(second).toBe(first);
  });
});
