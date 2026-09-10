import { describe, expect, it } from 'vitest';
import {
  buildBalancedReviewSet,
  type ReviewJobInput,
  type ReviewRowInput,
} from '../../scripts/studyAiBuildBalancedReviewSet';

const makeJob = (index: number, documentId?: string): ReviewJobInput => ({
  jobId: `map-${String(index).padStart(16, '0')}`,
  documentId: documentId ?? `doc-act-${index % 5}`,
  title: `Doc ${index}`,
  sectionLabels: [`section:${index}`],
});

const jobIdFor = (index: number): string => makeJob(index).jobId;

const makeRow = (index: number, overrides: Partial<ReviewRowInput> = {}): ReviewRowInput => ({
  jobId: jobIdFor(index),
  disposition: 'standalone',
  confidence: 'high',
  suggestedPriority: null,
  groupCount: 1,
  warnings: [],
  ...overrides,
});

describe('buildBalancedReviewSet', () => {
  it('builds a deterministic, duplicate-free bundle bounded by totalTarget', () => {
    const jobs = Array.from({ length: 40 }, (_, i) => makeJob(i));
    const rows = Array.from({ length: 40 }, (_, i) => makeRow(i));
    const first = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 25,
      retryJobIds: new Set(),
      originByJob: new Map(),
    });
    const second = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 25,
      retryJobIds: new Set(),
      originByJob: new Map(),
    });
    expect(first.entries.length).toBeLessThanOrEqual(25);
    expect(first.entries.length).toBe(second.entries.length);
    expect(first.entries.map((entry) => entry.jobId)).toEqual(
      second.entries.map((entry) => entry.jobId),
    );
    const ids = new Set(first.entries.map((entry) => entry.jobId));
    expect(ids.size).toBe(first.entries.length);
    expect(first.entries.length + 0).toBeGreaterThanOrEqual(20);
    // Every selected entry is attributed to a declared stratum.
    const strataNames = new Set(first.strata.map((stratum) => stratum.name));
    for (const entry of first.entries) {
      expect(strataNames.has(entry.stratum)).toBe(true);
    }
  });

  it('puts core surveying jobs in the core stratum and earlier strata win ties', () => {
    const jobs = [
      makeJob(0, 'doc-surveys-act'),
      makeJob(1, 'doc-property-act'),
      // Clean standalone high job that is also P1: the earlier stratum wins.
      makeJob(2, 'doc-other-act'),
      makeJob(3, 'doc-other-act'),
    ];
    const rows = [
      makeRow(0),
      makeRow(1),
      makeRow(2, { suggestedPriority: 'P1' }),
      makeRow(3),
    ];
    const set = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 50,
      retryJobIds: new Set(),
      originByJob: new Map(),
    });
    const byJob = new Map(set.entries.map((entry) => [entry.jobId, entry.stratum]));
    expect(byJob.get(jobIdFor(0))).toBe('core-surveying-licensing');
    expect(byJob.get(jobIdFor(1))).toBe('core-surveying-licensing');
    expect(byJob.get(jobIdFor(2))).toBe('clean-high-confidence-standalone');
    expect(byJob.get(jobIdFor(3))).toBe('clean-high-confidence-standalone');
    expect(set.entries.length).toBe(4);
  });

  it('routes medium confidence, skip, reference-only and combine dispositions to their strata', () => {
    const jobs = [makeJob(0), makeJob(1), makeJob(2), makeJob(3)];
    const rows = [
      makeRow(0, { confidence: 'medium' }),
      makeRow(1, { disposition: 'skip' }),
      makeRow(2, { disposition: 'reference-only' }),
      makeRow(3, { disposition: 'combine' }),
    ];
    const set = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 50,
      retryJobIds: new Set(),
      originByJob: new Map(),
    });
    const byJob = new Map(set.entries.map((entry) => [entry.jobId, entry.stratum]));
    expect(byJob.get(jobIdFor(0))).toBe('medium-confidence');
    expect(byJob.get(jobIdFor(1))).toBe('skip-disposition');
    expect(byJob.get(jobIdFor(2))).toBe('reference-only');
    expect(byJob.get(jobIdFor(3))).toBe('combine');
  });

  it('caps the recovered-retries stratum at its quota so retries cannot dominate', () => {
    const jobs = Array.from({ length: 40 }, (_, i) => makeJob(i, 'doc-other-act'));
    const rows = Array.from({ length: 40 }, (_, i) =>
      makeRow(i, { warnings: ['TARGET_PARSE_LOOKS_DAMAGED'] }),
    );
    const retryJobIds = new Set(Array.from({ length: 40 }, (_, i) => jobIdFor(i)));
    const set = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 80,
      retryJobIds,
      originByJob: new Map(),
    });
    const retryStratum = set.strata.find((stratum) => stratum.name === 'recovered-retries');
    expect(retryStratum?.selected).toBe(16);
    expect(retryStratum?.poolSize).toBe(40);
    // Retries selected by the dedicated stratum cannot exceed the quota even
    // when the filler has budget left.
    const retryEntries = set.entries.filter((entry) => entry.stratum === 'recovered-retries');
    expect(retryEntries.length).toBe(16);
  });

  it('tolerates short strata and reports pool sizes honestly', () => {
    const jobs = [makeJob(0)];
    const rows = [makeRow(0)];
    const set = buildBalancedReviewSet({
      jobs,
      rows,
      totalTarget: 50,
      retryJobIds: new Set(),
      originByJob: new Map(),
    });
    expect(set.entries.length).toBe(1);
    for (const stratum of set.strata) {
      expect(stratum.selected).toBeLessThanOrEqual(stratum.poolSize);
    }
  });

  it('rejects duplicate jobs, duplicate rows, and non-positive targets', () => {
    const job = makeJob(0);
    expect(() =>
      buildBalancedReviewSet({
        jobs: [job, { ...job }],
        rows: [makeRow(0)],
        totalTarget: 10,
        retryJobIds: new Set(),
        originByJob: new Map(),
      }),
    ).toThrow(/duplicate job/);
    expect(() =>
      buildBalancedReviewSet({
        jobs: [job],
        rows: [makeRow(0), { ...makeRow(0) }],
        totalTarget: 10,
        retryJobIds: new Set(),
        originByJob: new Map(),
      }),
    ).toThrow(/duplicate result row/);
    expect(() =>
      buildBalancedReviewSet({
        jobs: [job],
        rows: [makeRow(0)],
        totalTarget: 0,
        retryJobIds: new Set(),
        originByJob: new Map(),
      }),
    ).toThrow(/totalTarget/);
  });
});
