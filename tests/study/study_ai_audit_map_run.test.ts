import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import {
  failureOrigin,
  normalizeIssue,
  collectJobAuditRecords,
  type JobAuditRecord,
  type AttemptRecord,
} from '../../scripts/studyAiAuditMapRunCore';
import { __studyAiAuditMapRunTest } from '../../scripts/studyAiAuditMapRun';
import { __studyAiBuildStratifiedMapSampleTest } from '../../scripts/studyAiBuildStratifiedMapSample';
import {
  computeConcision,
  computeHygiene,
  computePerStratum,
  computeReliability,
  computeV1Comparison,
  reviewTierFor,
  selectReviewBundle,
  wordStats,
} from '../../scripts/studyAiAuditMapRunMetrics';

const makeGroup = (suffix: string) => ({
  groupId: `g-${suffix}`,
  titleSuggestion: `Title ${suffix}`,
  sourceKeys: ['src-1'],
  focusSelections: [{ sourceKey: 'src-1', childLabels: ['s1'] }],
  reason: 'One concise group reason.',
  approximateLearningGoal: 'Learn the rule and when it applies.',
});

const makeResult = (
  jobId: string,
  overrides: Partial<AiStudyMapResult> = {},
): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId,
  runId: 'test-base-run',
  corpusContentHash: 'c'.repeat(12),
  disposition: 'standalone',
  confidence: 'high',
  reason: 'A short deterministic reason for this mapping decision.',
  suggestedPriority: 'P3',
  proposedGroups: [makeGroup(jobId)],
  warnings: [],
  ...overrides,
});

const attempt = (
  attemptNumber: number,
  codes: string[],
  provider = false,
): AttemptRecord => ({
  attempt: attemptNumber,
  issueCodes: [...codes],
  issues: codes.map((code) => normalizeIssue(`${code}: synthetic message`)),
  provider,
});

const makeRecord = (jobId: string, overrides: Partial<JobAuditRecord> = {}): JobAuditRecord => ({
  jobId,
  documentId: 'doc-a',
  categories: ['duty'],
  structuralStrata: [],
  result: null,
  attempts: [],
  totalAttempts: 0,
  accepted: false,
  firstTryAccepted: false,
  retryIntroducedDifferentError: false,
  repeatedIdenticalError: false,
  permanentFailureAttempt: null,
  provenance: null,
  semanticAttempts: 0,
  providerAttempts: 0,
  firstSemanticAttemptAccepted: false,
  ...overrides,
});

const acceptedRecord = (
  jobId: string,
  resultOverrides: Partial<AiStudyMapResult> = {},
): JobAuditRecord =>
  makeRecord(jobId, {
    result: makeResult(jobId, resultOverrides),
    totalAttempts: 1,
    accepted: true,
    firstTryAccepted: true,
    firstSemanticAttemptAccepted: true,
  });

describe('normalizeIssue', () => {
  it('parses CODE: message strings', () => {
    expect(normalizeIssue('SUGGESTED_PRIORITY_REQUIRED: missing field')).toEqual({
      code: 'SUGGESTED_PRIORITY_REQUIRED',
      severity: 'unspecified',
      message: 'missing field',
    });
  });

  it('accepts object-form issues with severity', () => {
    expect(
      normalizeIssue({
        code: 'BROAD_FOCUS_WITHOUT_EVIDENCE',
        severity: 'warning',
        message: 'too broad',
      }),
    ).toEqual({
      code: 'BROAD_FOCUS_WITHOUT_EVIDENCE',
      severity: 'warning',
      message: 'too broad',
    });
  });
});

describe('collectJobAuditRecords', () => {
  const comparisonSet = {
    baseRunId: 'test-base-run',
    jobs: [{ v2JobId: 'map-a' }, { v2JobId: 'map-b' }, { v2JobId: 'map-c' }],
  };

  it('flags a fingerprint mismatch and unexpected run jobs', () => {
    const baseJobs = new Map<string, never>([]);
    const resultsByJob = new Map<string, AiStudyMapResult>([
      ['map-a', makeResult('map-a', { authoringInputFingerprint: 'f-a' })],
      ['map-b', makeResult('map-b')],
      ['map-outside', makeResult('map-outside')],
    ]);
    const { records, problems } = collectJobAuditRecords({
      comparisonSet,
      baseJobs,
      resultsByJob,
      resultRunId: 'child-run',
      attemptsByJob: new Map(),
    });
    expect(records).toHaveLength(3);
    const problemText = problems.join('\n');
    expect(problemText).toContain('unexpected job');
    expect(problemText).not.toContain('authoringInputFingerprint mismatch for map-a');
  });

  it('detects fingerprint mismatches against base jobs', () => {
    // Fields exercised: fingerprint, document, and enough of target/context
    // for the stratification helpers.
    const baseJob = {
      authoringInputFingerprint: 'expected-fp',
      document: { documentId: 'doc-a' },
      target: {
        heading: 'S1',
        operativeSourceText: 'A person shall file a plan.',
        approximateInputSize: { exactCharacters: 25, operativeCharacters: 25, largeSection: false },
      },
      context: {},
    };
    const baseJobs: Map<string, unknown> = new Map([['map-a', baseJob]]);
    const resultsByJob = new Map<string, AiStudyMapResult>([
      ['map-a', makeResult('map-a', { authoringInputFingerprint: 'different-fp' })],
    ]);
    const { problems } = collectJobAuditRecords({
      comparisonSet,
      baseJobs: baseJobs as unknown as Map<
        string,
        import('../../src/study/ai/studyAiTypes').AiStudyMapJob
      >,
      resultsByJob,
      resultRunId: 'child-run',
      attemptsByJob: new Map(),
    });
    expect(
      problems.some((problem) => problem.includes('authoringInputFingerprint mismatch for map-a')),
    ).toBe(true);
  });

  it('computes retry semantics from attempt issue-code signatures', () => {
    const attemptsByJob = new Map([
      ['map-same', [attempt(1, ['CODE_A']), attempt(2, ['CODE_A'])]],
      ['map-diff', [attempt(1, ['CODE_A']), attempt(2, ['CODE_B'])]],
    ]);
    const { records } = collectJobAuditRecords({
      comparisonSet: {
        baseRunId: 'test-base-run',
        jobs: [{ v2JobId: 'map-same' }, { v2JobId: 'map-diff' }],
      },
      baseJobs: new Map(),
      resultsByJob: new Map(),
      resultRunId: 'child-run',
      attemptsByJob,
    });
    const same = records.find((record) => record.jobId === 'map-same');
    const diff = records.find((record) => record.jobId === 'map-diff');
    expect(same?.repeatedIdenticalError).toBe(true);
    expect(diff?.repeatedIdenticalError).toBe(false);
    expect(diff?.retryIntroducedDifferentError).toBe(true);
    expect(same?.permanentFailureAttempt?.attempt).toBe(2);
  });
});

describe('computeReliability', () => {
  it('summarizes acceptance, retries, and per-code recovery', () => {
    const clean = acceptedRecord('map-clean');
    const retried = acceptedRecord('map-retried', { reason: 'accepted after retry' });
    retried.attempts = [attempt(1, ['SUGGESTED_PRIORITY_REQUIRED'])];
    retried.totalAttempts = 2;
    retried.firstTryAccepted = false;
    retried.semanticAttempts = 1;
    const failed = makeRecord('map-failed', {
      attempts: [
        attempt(1, ['SUGGESTED_PRIORITY_REQUIRED']),
        attempt(2, ['SUGGESTED_PRIORITY_REQUIRED']),
      ],
      totalAttempts: 2,
      semanticAttempts: 2,
      repeatedIdenticalError: true,
      permanentFailureAttempt: attempt(2, ['SUGGESTED_PRIORITY_REQUIRED']),
    });
    const summary = computeReliability([clean, retried, failed]);
    expect(summary.selectedJobs).toBe(3);
    expect(summary.accepted).toBe(2);
    expect(summary.permanentlyFailed).toBe(1);
    expect(summary.acceptanceRate).toBeCloseTo(2 / 3, 3);
    expect(summary.firstTryAccepted).toBe(1);
    expect(summary.acceptedAfterRetry).toBe(1);
    expect(summary.totalAttempts).toBe(5);
    expect(summary.extraAttempts).toBe(2);
    const code = summary.perErrorCode.find((entry) => entry.code === 'SUGGESTED_PRIORITY_REQUIRED');
    expect(code?.failedAttempts).toBe(3);
    expect(code?.recoveredJobs).toBe(1);
    expect(summary.permanentlyFailedJobs[0].jobId).toBe('map-failed');
  });
});

describe('computePerStratum', () => {
  it('aggregates by category and structural label', () => {
    const records = [
      makeRecord('map-a', {
        categories: ['duty'],
        structuralStrata: ['short-simple-provision'],
        result: makeResult('map-a'),
        totalAttempts: 1,
        accepted: true,
        firstTryAccepted: true,
      }),
      makeRecord('map-b', { categories: ['duty'], totalAttempts: 1 }),
    ];
    const perStratum = computePerStratum(records);
    expect(perStratum['duty']).toEqual({
      selected: 2,
      accepted: 1,
      firstTryAccepted: 1,
      permanentlyFailed: 1,
      totalAttempts: 2,
      extraAttempts: 0,
    });
    expect(perStratum['short-simple-provision']?.selected).toBe(1);
  });
});

describe('computeConcision', () => {
  it('applies word thresholds', () => {
    const longReason =
      ' '.repeat(0) + Array.from({ length: 45 }, (_, index) => `word${index}`).join(' ');
    const record = acceptedRecord('map-long', { reason: longReason });
    const concision = computeConcision([record]);
    expect(concision.reason.overThreshold).toBe(1);
    expect(concision.reason.max).toBe(45);
    expect(concision.thresholds).toEqual({
      reasonWords: 40,
      groupReasonWords: 30,
      learningGoalWords: 60,
    });
  });
});

describe('computeHygiene', () => {
  it('flags prompt and calibration references', () => {
    const record = acceptedRecord('map-hyg', {
      reason: 'Following the calibration pattern for a split, the prompt asked for groups.',
    });
    const findings = computeHygiene([record]);
    const labels = findings.map((finding) => finding.pattern);
    expect(labels).toContain('calibration-pattern-reference');
    expect(labels).toContain('prompt-reference');
  });

  it('stays quiet for clean prose', () => {
    const record = acceptedRecord('map-clean', {
      reason: 'The provision imposes a filing duty with a deadline.',
    });
    expect(computeHygiene([record])).toEqual([]);
  });
});

describe('computeV1Comparison', () => {
  it('compares only mapped accepted jobs and stays descriptive', () => {
    const records = [acceptedRecord('map-a'), makeRecord('map-b')];
    const setJobs = new Map([['map-a', { v2JobId: 'map-a', v1JobId: 'v1-a' }]]);
    const v1Results = new Map([
      [
        'v1-a',
        makeResult('v1-a', { disposition: 'split', confidence: 'medium', suggestedPriority: 'P4' }),
      ],
    ]);
    const comparison = computeV1Comparison(records, setJobs, v1Results);
    expect(comparison.comparable).toBe(1);
    expect(comparison.dispositionSame).toBe(0);
    expect(comparison.dispositionDiff).toBe(1);
    expect(comparison.prioritySame).toBe(0);
    expect(comparison.priorityDiff).toBe(1);
    expect(comparison.note).toContain('not ground truth');
  });
});

describe('review tiers and bundle selection', () => {
  const finalValidation = new Map<string, ReturnType<typeof normalizeIssue>[]>([]);

  it('assigns tiers in strict priority order', () => {
    const failed = makeRecord('map-failed', { totalAttempts: 2, attempts: [attempt(1, ['CODE'])] });
    expect(reviewTierFor(failed, undefined)).toEqual({ tier: 0, label: 'permanent-failure' });
    const low = acceptedRecord('map-low', { confidence: 'low' });
    expect(reviewTierFor(low, undefined)).toEqual({ tier: 1, label: 'low-confidence' });
    const retried = acceptedRecord('map-retried');
    retried.totalAttempts = 2;
    expect(reviewTierFor(retried, undefined)).toEqual({ tier: 2, label: 'multi-attempt' });
    const warned = acceptedRecord('map-warned');
    expect(
      reviewTierFor(warned, [normalizeIssue({ code: 'X', severity: 'warning', message: 'w' })]),
    ).toEqual({
      tier: 3,
      label: 'final-warning',
    });
    const clean = acceptedRecord('map-clean');
    expect(reviewTierFor(clean, undefined)).toEqual({ tier: 10, label: 'clean' });
  });

  it('fills the bundle tier by tier', () => {
    const records = [
      acceptedRecord('map-clean-1'),
      acceptedRecord('map-clean-2'),
      acceptedRecord('map-low-1', { confidence: 'low' }),
      makeRecord('map-failed-1', {
        totalAttempts: 1,
        attempts: [attempt(1, ['CODE'])],
        semanticAttempts: 1,
      }),
    ];
    const selection = selectReviewBundle(records, 3, finalValidation);
    expect(selection.map((entry) => entry.record.jobId)).toEqual([
      'map-failed-1',
      'map-low-1',
      'map-clean-1',
    ]);
    expect(selection.map((entry) => entry.tier)).toEqual([0, 1, 10]);
  });
});

describe('failureOrigin', () => {
  it('classifies accepted, provider-incomplete, semantic, and mixed records', () => {
    expect(failureOrigin(acceptedRecord('map-a'))).toBe('none');
    // No semantic attempts: provider-only failures, or the run never reached it.
    expect(
      failureOrigin(
        makeRecord('map-p', {
          attempts: [attempt(1, [], true)],
          totalAttempts: 1,
          providerAttempts: 1,
        }),
      ),
    ).toBe('provider');
    expect(failureOrigin(makeRecord('map-never-reached'))).toBe('provider');
    expect(
      failureOrigin(
        makeRecord('map-s', {
          attempts: [attempt(1, ['CODE'])],
          totalAttempts: 1,
          semanticAttempts: 1,
        }),
      ),
    ).toBe('semantic');
    expect(
      failureOrigin(
        makeRecord('map-mix', {
          attempts: [attempt(1, ['CODE']), attempt(2, [], true)],
          totalAttempts: 2,
          semanticAttempts: 1,
          providerAttempts: 1,
        }),
      ),
    ).toBe('mixed');
  });
});

describe('provider vs semantic reliability', () => {
  it('keeps provider attempts out of semantic error codes and counts', () => {
    const providerOnly = makeRecord('map-provider-only', {
      attempts: [attempt(1, [], true)],
      totalAttempts: 1,
      providerAttempts: 1,
    });
    const semanticFailed = makeRecord('map-semantic', {
      attempts: [attempt(1, ['CODE_A']), attempt(2, ['CODE_B'])],
      totalAttempts: 2,
      semanticAttempts: 2,
      permanentFailureAttempt: attempt(2, ['CODE_B']),
    });
    const mixed = makeRecord('map-mixed', {
      attempts: [attempt(1, ['CODE_A']), attempt(2, [], true)],
      totalAttempts: 2,
      semanticAttempts: 1,
      providerAttempts: 1,
    });
    const summary = computeReliability([providerOnly, semanticFailed, mixed]);
    expect(summary.permanentlyFailed).toBe(3);
    expect(summary.semanticPermanentFailures).toBe(2);
    expect(summary.providerIncompleteJobs).toBe(1);
    expect(summary.semanticAttemptsTotal).toBe(3);
    expect(summary.providerAttemptsTotal).toBe(2);
    expect(summary.perErrorCode.map((entry) => entry.code)).toEqual(['CODE_A', 'CODE_B']);
    const perJob = (jobId: string) =>
      (summary.permanentlyFailedJobs as Array<Record<string, unknown>>).find(
        (entry) => entry.jobId === jobId,
      );
    expect(perJob('map-provider-only')?.origin).toBe('provider');
    expect(perJob('map-provider-only')?.issueCodes).toEqual([]);
    expect(perJob('map-semantic')?.origin).toBe('semantic');
    expect(perJob('map-mixed')?.origin).toBe('mixed');
  });

  it('excludes provider-incomplete jobs from the semantic review bundle', () => {
    const providerOnly = makeRecord('map-provider-only', {
      attempts: [attempt(1, [], true)],
      totalAttempts: 1,
      providerAttempts: 1,
    });
    const neverReached = makeRecord('map-never-reached');
    const semanticFailed = makeRecord('map-semantic-failed', {
      attempts: [attempt(1, ['CODE'])],
      totalAttempts: 1,
      semanticAttempts: 1,
    });
    const selection = selectReviewBundle(
      [providerOnly, neverReached, semanticFailed],
      10,
      new Map<string, ReturnType<typeof normalizeIssue>[]>,
    );
    expect(selection.map((entry) => entry.record.jobId)).toEqual(['map-semantic-failed']);
  });
});

describe('auditor and sampler CLI contracts', () => {
  it('auditor help documents --run and --comparison-set', () => {
    const help = __studyAiAuditMapRunTest.AUDIT_MAP_RUN_HELP;
    expect(help).toContain('--run <runId>');
    expect(help).toContain('--comparison-set <path>');
    expect(help).toContain('--review-size');
  });

  it('sampler help documents --out and the selection options', () => {
    const help = __studyAiBuildStratifiedMapSampleTest.STRATIFIED_SAMPLER_HELP;
    expect(help).toContain('--out <path>');
    expect(help).toContain('--per-document');
  });

  it('parseArgs resolves run, comparison set, and review size', () => {
    const args = __studyAiAuditMapRunTest.parseArgs([
      '--run',
      'ai-run-x',
      '--comparison-set',
      'cs.json',
      '--review-size',
      '8',
    ]);
    expect(args).toEqual({ run: 'ai-run-x', comparisonSet: 'cs.json', reviewSize: 8 });
  });

  it('parses BOM-prefixed V1 result lines', () => {
    const dir = join('study-content', 'ai', 'runs', 'ai-test-audit-map-run');
    const location = join(dir, 'v1-results.jsonl');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      location,
      `${'\uFEFF'}${JSON.stringify(makeResult('v1-bom'))}\n${JSON.stringify(makeResult('v1-plain', { jobId: 'v1-plain' }))}\n`,
    );
    try {
      const byJobId = __studyAiAuditMapRunTest.loadV1Results([
        { v1JobId: 'v1-bom', v1KnownGoodResultLocation: location },
      ]);
      expect([...byJobId.keys()].sort()).toEqual(['v1-bom', 'v1-plain']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('wordStats', () => {
  it('computes nearest-rank percentiles', () => {
    expect(wordStats([1, 2, 3, 4, 5])).toEqual({ mean: 3, median: 3, p95: 5, max: 5 });
    expect(wordStats([])).toEqual({ mean: 0, median: 0, p95: 0, max: 0 });
  });
});
