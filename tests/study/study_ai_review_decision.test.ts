/**
 * Hermetic tests for the post-QC review-decision schema, parser, and
 * classifier (src/study/ai/studyAiReviewDecision.ts). No filesystem, no
 * model calls — pure data in / data out.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyMapReviewDecisions,
  parseMapReviewDecisionFile,
  REVIEW_DECISION_TYPE,
  REVIEW_DECISION_SCHEMA_VERSION,
  type MapReviewDecisionFile,
  type ReviewPriority,
} from '../../src/study/ai/studyAiReviewDecision';

const RUN = 'ai-map-test-run';

const validFile = (decisions: unknown[]): MapReviewDecisionFile => {
  const { file, issues } = parseMapReviewDecisionFile({
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    reviewType: REVIEW_DECISION_TYPE,
    runId: RUN,
    decisions,
  });
  expect(issues).toEqual([]);
  expect(file).not.toBeNull();
  return file as MapReviewDecisionFile;
};

const keepKeep = (jobId: string) => ({
  jobId,
  priorityDecision: 'keep',
  newPriority: null,
  groupingDecision: 'keep',
});

const priorities = new Map<string, ReviewPriority | null>([
  ['map-0000000000000001', 'P1'],
  ['map-0000000000000002', 'P2'],
  ['map-0000000000000003', null],
]);

const classify = (file: MapReviewDecisionFile) =>
  classifyMapReviewDecisions(file, priorities);

describe('parseMapReviewDecisionFile', () => {
  it('accepts a structurally valid file with no issues', () => {
    const file = validFile([keepKeep('map-0000000000000001')]);
    expect(file.decisions).toHaveLength(1);
  });

  it('rejects a non-object document', () => {
    const { file, issues } = parseMapReviewDecisionFile('nope');
    expect(file).toBeNull();
    expect(issues[0]?.code).toBe('not-an-object');
  });

  it('rejects wrong schema version, review type, missing runId, missing decisions', () => {
    const { file, issues } = parseMapReviewDecisionFile({
      schemaVersion: 2,
      reviewType: 'something-else',
      decisions: null,
    });
    expect(file).toBeNull();
    const codes = issues.map((i) => i.code).sort();
    expect(codes).toEqual(
      ['bad-review-type', 'bad-schema-version', 'missing-decisions', 'missing-run-id'].sort(),
    );
  });

  it('flags bad jobIds and duplicate jobIds', () => {
    const { file, issues } = parseMapReviewDecisionFile({
      schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
      reviewType: REVIEW_DECISION_TYPE,
      runId: RUN,
      decisions: [
        { ...keepKeep('not-a-map-id') },
        keepKeep('map-0000000000000001'),
        keepKeep('map-0000000000000001'),
      ],
    });
    expect(file).not.toBeNull();
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('bad-job-id');
    expect(codes).toContain('duplicate-job-id');
  });

  it('requires newPriority for change and forbids it for keep', () => {
    const { issues } = parseMapReviewDecisionFile({
      schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
      reviewType: REVIEW_DECISION_TYPE,
      runId: RUN,
      decisions: [
        {
          jobId: 'map-0000000000000001',
          priorityDecision: 'change',
          newPriority: null,
          groupingDecision: 'keep',
        },
        {
          jobId: 'map-0000000000000002',
          priorityDecision: 'keep',
          newPriority: 'P1',
          groupingDecision: 'keep',
        },
        {
          jobId: 'map-0000000000000003',
          priorityDecision: 'keep',
          newPriority: 'P9',
          groupingDecision: 'keep',
        },
      ],
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('change-without-new-priority');
    expect(codes).toContain('keep-with-new-priority');
    expect(codes).toContain('bad-new-priority');
  });

  it('rejects unknown grouping decisions', () => {
    const { issues } = parseMapReviewDecisionFile({
      schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
      reviewType: REVIEW_DECISION_TYPE,
      runId: RUN,
      decisions: [
        {
          jobId: 'map-0000000000000001',
          priorityDecision: 'keep',
          newPriority: null,
          groupingDecision: 'merge-everything',
        },
      ],
    });
    expect(issues[0]?.code).toBe('bad-grouping-decision');
  });
});

describe('classifyMapReviewDecisions', () => {
  it('classifies keep/keep as no-change', () => {
    const file = validFile([keepKeep('map-0000000000000001')]);
    const { classifications, issues } = classify(file);
    expect(issues).toEqual([]);
    expect(classifications[0]).toMatchObject({
      jobId: 'map-0000000000000001',
      classification: 'no-change',
      reason: 'keep-keep',
    });
  });

  it('classifies priority-only changes as adjudicable', () => {
    const file = validFile([
      {
        jobId: 'map-0000000000000001',
        priorityDecision: 'change',
        newPriority: 'P3',
        groupingDecision: 'keep',
      },
    ]);
    const { classifications, issues } = classify(file);
    expect(issues).toEqual([]);
    expect(classifications[0]).toMatchObject({
      classification: 'priority-only-adjudicable',
      reason: 'priority-change-groups-unchanged',
    });
  });

  it('classifies grouping changes as requiring a corrected Map result', () => {
    for (const groupingDecision of ['split', 'standalone', 'combine', 'reference-only', 'skip'] as const) {
      const file = validFile([
        { ...keepKeep('map-0000000000000002'), groupingDecision },
      ]);
      const { classifications } = classify(file);
      expect(classifications[0]).toMatchObject({
        classification: 'requires-corrected-map-result',
        reason: `grouping-change-${groupingDecision}`,
      });
    }
  });

  it('classifies needs-human-review as requiring a corrected Map result', () => {
    const file = validFile([
      { ...keepKeep('map-0000000000000002'), groupingDecision: 'needs-human-review' },
    ]);
    const { classifications } = classify(file);
    expect(classifications[0]).toMatchObject({
      classification: 'requires-corrected-map-result',
      reason: 'grouping-awaits-human-review',
    });
  });

  it('rejects decisions for unknown jobs and same-priority changes', () => {
    const file = validFile([
      keepKeep('map-ffffffffffffffff'),
      {
        jobId: 'map-0000000000000001',
        priorityDecision: 'change',
        newPriority: 'P1',
        groupingDecision: 'keep',
      },
    ]);
    const { classifications, issues } = classify(file);
    const byId = new Map(classifications.map((c) => [c.jobId, c]));
    expect(byId.get('map-ffffffffffffffff')).toMatchObject({
      classification: 'invalid',
      reason: 'unknown-job',
    });
    expect(byId.get('map-0000000000000001')).toMatchObject({
      classification: 'invalid',
      reason: 'ambiguous-priority-change',
    });
    const issueCodes = issues.map((i) => i.code);
    expect(issueCodes).toContain('unknown-job');
    expect(issueCodes).toContain('ambiguous-priority-change');
  });

  it('allows a priority change on a result that currently has none', () => {
    const file = validFile([
      {
        jobId: 'map-0000000000000003',
        priorityDecision: 'change',
        newPriority: 'P2',
        groupingDecision: 'keep',
      },
    ]);
    const { classifications, issues } = classify(file);
    expect(issues).toEqual([]);
    expect(classifications[0]).toMatchObject({
      classification: 'priority-only-adjudicable',
      currentPriority: null,
      newPriority: 'P2',
    });
  });

  it('sorts classifications by jobId', () => {
    const file = validFile([
      keepKeep('map-0000000000000002'),
      keepKeep('map-0000000000000001'),
    ]);
    const { classifications } = classify(file);
    expect(classifications.map((c) => c.jobId)).toEqual([
      'map-0000000000000001',
      'map-0000000000000002',
    ]);
  });
});
