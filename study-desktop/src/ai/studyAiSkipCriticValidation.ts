import { validateSkipCriticResultContract } from './studyAiSkipCriticContract';
import type {
  SkipCriticPermittedEvidence,
  SkipCriticValidationContext,
  SkipCriticValidationIssue,
  SkipCriticValidationReport,
} from './studyAiSkipCriticTypes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Grounds each detectedStudyValue item against caller-permitted evidence:
 * sourceKey must be in the permitted set and each childLabel must exist
 * for that sourceKey. No statute-specific rules live here.
 */
export const validateSkipCriticGrounding = (
  value: unknown,
  permittedEvidence: SkipCriticPermittedEvidence,
): SkipCriticValidationIssue[] => {
  const issues: SkipCriticValidationIssue[] = [];
  if (!Array.isArray(value)) return issues;
  value.forEach((item) => {
    if (!isRecord(item)) return;
    const sourceKey = nonEmptyString(item.sourceKey) ? item.sourceKey : undefined;
    if (!sourceKey) return;
    const allowedLabels = permittedEvidence[sourceKey];
    if (allowedLabels === undefined) {
      issues.push({
        code: 'SKIP_CRITIC_SOURCE_NOT_PERMITTED',
        message: `sourceKey ${sourceKey} is not permitted critic evidence.`,
        sourceKey,
      });
      return;
    }
    if (!Array.isArray(item.childLabels)) return;
    item.childLabels
      .filter((label): label is string => typeof label === 'string')
      .forEach((label) => {
        if (!allowedLabels.includes(label)) {
          issues.push({
            code: 'SKIP_CRITIC_CHILD_LABEL_NOT_FOUND',
            message: `childLabel ${label} does not exist for ${sourceKey}.`,
            sourceKey,
          });
        }
      });
  });
  return issues;
};

const crossFieldIssues = (value: Record<string, unknown>): SkipCriticValidationIssue[] => {
  const issues: SkipCriticValidationIssue[] = [];
  const items = Array.isArray(value.detectedStudyValue) ? value.detectedStudyValue : undefined;
  if (value.decision === 'skip-not-supported' && (!items || items.length === 0)) {
    issues.push({
      code: 'SKIP_CRITIC_CROSS_ITEMS_REQUIRED',
      message: 'skip-not-supported requires at least one detectedStudyValue item.',
    });
  }
  if (value.decision === 'skip-supported' && !!items && items.length > 0) {
    issues.push({
      code: 'SKIP_CRITIC_CROSS_ITEMS_FORBIDDEN',
      message: 'skip-supported requires detectedStudyValue to be empty.',
    });
  }
  if (value.decision === 'uncertain' && !nonEmptyString(value.reason)) {
    issues.push({
      code: 'SKIP_CRITIC_CROSS_REASON_REQUIRED',
      message: 'uncertain requires a non-empty reason.',
    });
  }
  return issues;
};

export const validateSkipCriticResult = (
  value: unknown,
  context: SkipCriticValidationContext,
): SkipCriticValidationReport => {
  const issues = validateSkipCriticResultContract(value);
  if (isRecord(value)) {
    issues.push(...crossFieldIssues(value));
    issues.push(
      ...validateSkipCriticGrounding(value.detectedStudyValue, context.permittedEvidence),
    );
  }
  return { valid: issues.length === 0, issues };
};
