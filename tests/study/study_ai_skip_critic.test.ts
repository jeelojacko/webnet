import { describe, expect, it } from 'vitest';
import {
  SKIP_CRITIC_RESULT_SCHEMA,
  SKIP_CRITIC_STUDY_VALUE_CATEGORIES,
  validateSkipCriticResultContract,
} from '../../src/study/ai/studyAiSkipCriticContract';
import {
  validateSkipCriticGrounding,
  validateSkipCriticResult,
} from '../../src/study/ai/studyAiSkipCriticValidation';
import type {
  SkipCriticResult,
  SkipCriticValidationContext,
} from '../../src/study/ai/studyAiSkipCriticTypes';
import {
  STUDY_MAP_V3_RESULT_SCHEMA,
  validateStudyMapV3ResultContract,
} from '../../src/study/ai/studyAiResultContract';
import { validateAiStudyMapResult } from '../../src/study/ai/studyAiValidation';

const context: SkipCriticValidationContext = {
  permittedEvidence: {
    'section:10': ['10(1)', '10(2)'],
    'section:11': [],
  },
};

const baseResult = (): SkipCriticResult => ({
  schemaVersion: 1,
  decision: 'skip-supported',
  confidence: 'high',
  detectedStudyValue: [],
  reason: 'Definitions only; no operative study value.',
  warnings: [],
});

const item = (overrides: Partial<SkipCriticResult['detectedStudyValue'][number]> = {}) => ({
  category: 'duty' as const,
  sourceKey: 'section:10',
  childLabels: ['10(1)'],
  summary: 'Requires filing a notice.',
  ...overrides,
});

describe('Skip Critic V1 contract and validation', () => {
  it('accepts a valid skip-supported result', () => {
    const report = validateSkipCriticResult(baseResult(), context);
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('accepts a valid skip-not-supported result with a grounded item', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    result.detectedStudyValue = [item()];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('rejects skip-not-supported with zero detected items', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_CROSS_ITEMS_REQUIRED');
  });

  it('rejects skip-supported with non-empty detected items', () => {
    const result = baseResult();
    result.detectedStudyValue = [item()];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_CROSS_ITEMS_FORBIDDEN');
  });

  it('accepts a valid uncertain result with a non-empty reason', () => {
    const result = baseResult();
    result.decision = 'uncertain';
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('rejects uncertain with an empty reason', () => {
    const result = baseResult();
    result.decision = 'uncertain';
    result.reason = '   ';
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_CROSS_REASON_REQUIRED');
  });

  it('rejects an invalid decision', () => {
    const result = baseResult();
    result.decision = 'maybe' as unknown as SkipCriticResult['decision'];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_DECISION_INVALID');
  });

  it('rejects an invalid category', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    result.detectedStudyValue = [item({ category: 'vibes' as never })];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_CATEGORY_INVALID');
  });

  it('rejects a sourceKey outside the permitted critic evidence set', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    result.detectedStudyValue = [item({ sourceKey: 'section:99' })];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_SOURCE_NOT_PERMITTED');
    expect(report.issues.find((entry) => entry.sourceKey)?.sourceKey).toBe('section:99');
  });

  it('rejects a childLabel that does not exist for the sourceKey', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    result.detectedStudyValue = [item({ childLabels: ['10(9)'] })];
    const report = validateSkipCriticResult(result, context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_CHILD_LABEL_NOT_FOUND');
  });

  it('rejects a malformed non-object shape', () => {
    const report = validateSkipCriticResult('not an object', context);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_SCHEMA_INVALID');
  });

  it('rejects a non-object detectedStudyValue entry in contract validation', () => {
    const result = baseResult();
    result.decision = 'skip-not-supported';
    result.detectedStudyValue = ['nope' as never];
    const issues = validateSkipCriticResultContract(result);
    expect(issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_ITEM_INVALID');
  });

  it('rejects unexpected top-level identity fields from the model payload', () => {
    const result = { ...baseResult(), runId: 'should-not-exist' } as unknown as SkipCriticResult;
    const issues = validateSkipCriticResultContract(result);
    expect(issues.map((entry) => entry.code)).toContain('SKIP_CRITIC_UNEXPECTED_FIELD');
  });

  it('grounds items generically against caller-permitted evidence only', () => {
    expect(
      validateSkipCriticGrounding(
        [item({ sourceKey: 'section:11', childLabels: [] })],
        context.permittedEvidence,
      ),
    ).toEqual([]);
    expect(
      validateSkipCriticGrounding(
        [item({ sourceKey: 'section:11', childLabels: ['11(1)'] })],
        context.permittedEvidence,
      ).map((entry) => entry.code),
    ).toEqual(['SKIP_CRITIC_CHILD_LABEL_NOT_FOUND']);
    expect(validateSkipCriticGrounding('not an array', context.permittedEvidence)).toEqual([]);
  });
});

describe('Study Map V3 remains unchanged', () => {
  const v3Result = () => ({
    schemaVersion: 1,
    jobId: 'map-test',
    runId: 'run-test',
    corpusContentHash: 'corpus-hash',
    promptSpecVersion: 'study-map-v3',
    disposition: 'skip',
    confidence: 'high',
    reason: 'Definitions only.',
    proposedGroups: [],
    warnings: [],
  });

  it('still validates a Study Map V3 result and rejects the same bad shape', () => {
    expect(validateStudyMapV3ResultContract(v3Result())).toEqual([]);
    expect(validateAiStudyMapResult(v3Result()).valid).toBe(true);
    const bad: Record<string, unknown> = v3Result();
    delete bad.disposition;
    expect(validateStudyMapV3ResultContract(bad).map((entry) => entry.code)).toContain(
      'INVALID_DISPOSITION',
    );
  });

  it('keeps a distinct schema id and does not accept skip critic results', () => {
    expect(SKIP_CRITIC_RESULT_SCHEMA.$id).not.toBe(STUDY_MAP_V3_RESULT_SCHEMA.$id);
    expect(validateStudyMapV3ResultContract(baseResult()).map((entry) => entry.code)).toContain(
      'JOB_ID_REQUIRED',
    );
  });

  it('exposes the frozen study value category list', () => {
    expect([...SKIP_CRITIC_STUDY_VALUE_CATEGORIES]).toEqual([
      'duty',
      'permission',
      'prohibition',
      'right',
      'official-power',
      'procedure',
      'prerequisite',
      'legal-effect',
      'consequence',
      'remedy',
      'payment-cost-liability',
      'review-appeal',
      'filing-registration-evidence',
      'offence-enforcement',
      'other',
    ]);
  });
});
