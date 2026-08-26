import type { SkipCriticValidationIssue } from './studyAiSkipCriticTypes';

export const SKIP_CRITIC_SCHEMA_VERSION = 1;

export const SKIP_CRITIC_DECISIONS = ['skip-supported', 'skip-not-supported', 'uncertain'] as const;

export const SKIP_CRITIC_CONFIDENCES = ['high', 'medium', 'low'] as const;

export const SKIP_CRITIC_STUDY_VALUE_CATEGORIES = [
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
] as const;

export const SKIP_CRITIC_RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://webnet.local/schemas/skip-critic-v1-result.schema.json',
  title: 'Skip Critic V1 Result',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'decision', 'confidence', 'detectedStudyValue', 'reason', 'warnings'],
  properties: {
    schemaVersion: { const: 1 },
    decision: { enum: [...SKIP_CRITIC_DECISIONS] },
    confidence: { enum: [...SKIP_CRITIC_CONFIDENCES] },
    detectedStudyValue: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'sourceKey', 'childLabels', 'summary'],
        properties: {
          category: { enum: [...SKIP_CRITIC_STUDY_VALUE_CATEGORIES] },
          sourceKey: { type: 'string', minLength: 1 },
          childLabels: { type: 'array', items: { type: 'string', minLength: 1 } },
          summary: { type: 'string', minLength: 1 },
        },
      },
    },
    reason: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const issue = (code: string, message: string, sourceKey?: string): SkipCriticValidationIssue => ({
  code,
  message,
  sourceKey,
});

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonEmptyString);

const unexpectedKeys = (value: Record<string, unknown>, allowed: string[]): string[] =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort();

export const validateSkipCriticResultContract = (value: unknown): SkipCriticValidationIssue[] => {
  if (!isRecord(value))
    return [issue('SKIP_CRITIC_SCHEMA_INVALID', 'Skip critic result must be an object.')];
  const issues: SkipCriticValidationIssue[] = [];
  const allowedResultKeys = [
    'schemaVersion',
    'decision',
    'confidence',
    'detectedStudyValue',
    'reason',
    'warnings',
  ];
  unexpectedKeys(value, allowedResultKeys).forEach((key) => {
    issues.push(
      issue('SKIP_CRITIC_UNEXPECTED_FIELD', `Unexpected skip critic result field: ${key}.`),
    );
  });
  if (value.schemaVersion !== SKIP_CRITIC_SCHEMA_VERSION) {
    issues.push(issue('SKIP_CRITIC_SCHEMA_VERSION', 'Skip critic schemaVersion must be 1.'));
  }
  if (!(SKIP_CRITIC_DECISIONS as readonly string[]).includes(value.decision as string)) {
    issues.push(issue('SKIP_CRITIC_DECISION_INVALID', 'Invalid skip critic decision.'));
  }
  if (!(SKIP_CRITIC_CONFIDENCES as readonly string[]).includes(value.confidence as string)) {
    issues.push(issue('SKIP_CRITIC_CONFIDENCE_INVALID', 'Invalid skip critic confidence.'));
  }
  if (typeof value.reason !== 'string')
    issues.push(issue('SKIP_CRITIC_REASON_INVALID', 'reason must be a string.'));
  if (value.warnings !== undefined && !Array.isArray(value.warnings)) {
    issues.push(issue('SKIP_CRITIC_WARNINGS_INVALID', 'warnings must be an array of strings.'));
  } else {
    (value.warnings ?? []).forEach((warning) => {
      if (typeof warning !== 'string') {
        issues.push(issue('SKIP_CRITIC_WARNINGS_INVALID', 'warnings must be an array of strings.'));
      }
    });
  }
  if (value.detectedStudyValue === undefined) {
    issues.push(issue('SKIP_CRITIC_ITEMS_REQUIRED', 'detectedStudyValue must be an array.'));
    return issues;
  }
  if (!Array.isArray(value.detectedStudyValue)) {
    issues.push(issue('SKIP_CRITIC_ITEMS_REQUIRED', 'detectedStudyValue must be an array.'));
    return issues;
  }
  value.detectedStudyValue.forEach((item) => {
    if (!isRecord(item)) {
      issues.push(
        issue('SKIP_CRITIC_ITEM_INVALID', 'Each detectedStudyValue item must be an object.'),
      );
      return;
    }
    unexpectedKeys(item, ['category', 'sourceKey', 'childLabels', 'summary']).forEach((key) => {
      issues.push(
        issue('SKIP_CRITIC_UNEXPECTED_FIELD', `Unexpected detectedStudyValue field: ${key}.`),
      );
    });
    if (
      !(SKIP_CRITIC_STUDY_VALUE_CATEGORIES as readonly string[]).includes(item.category as string)
    ) {
      issues.push(issue('SKIP_CRITIC_CATEGORY_INVALID', 'Invalid detectedStudyValue category.'));
    }
    if (!nonEmptyString(item.sourceKey))
      issues.push(
        issue('SKIP_CRITIC_SOURCE_KEY_REQUIRED', 'detectedStudyValue.sourceKey is required.'),
      );
    if (!stringArray(item.childLabels))
      issues.push(
        issue(
          'SKIP_CRITIC_CHILD_LABELS_INVALID',
          'childLabels must be an array of non-empty strings.',
        ),
      );
    if (!nonEmptyString(item.summary))
      issues.push(issue('SKIP_CRITIC_SUMMARY_REQUIRED', 'detectedStudyValue.summary is required.'));
  });
  return issues;
};
