import type { AiValidationIssue } from '../src/study/ai/studyAiTypes';

/**
 * Concise, code-specific explanations of deterministic validator requirements.
 * The actual semantic correction remains model-generated; this only states
 * what the validator mechanically requires.
 */
const RETRY_INSTRUCTIONS: Record<string, string> = {
  SUGGESTED_PRIORITY_REQUIRED:
    'Include top-level suggestedPriority with exactly one of P1, P2, P3, or P4 because proposedGroups is non-empty.',
  STANDALONE_GROUP_COUNT: 'standalone requires exactly one proposedGroup.',
  SPLIT_GROUP_COUNT: 'split requires at least two proposedGroups.',
  DUPLICATE_FOCUS_CHILD_LABEL:
    'Make sibling group focus selections disjoint for the duplicated source focus.',
  DUPLICATE_FOCUS_DEFINED_TERM:
    'Make sibling group focus selections disjoint for the duplicated source focus.',
  OPAQUE_WARNING_CODE: 'Replace opaque warning codes with a self-describing SCREAMING_SNAKE code.',
};

/** Ordinary Study Map responses fit easily; cap only pathological invalid responses. */
const MAX_RETRY_RESPONSE_CHARS = 12_000;

const retryResponseText = (value: unknown): string => {
  let text = 'null';
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) text = serialized;
  } catch {
    text = String(value);
  }
  return text.length > MAX_RETRY_RESPONSE_CHARS
    ? `${text.slice(0, MAX_RETRY_RESPONSE_CHARS)} … [truncated for retry context]`
    : text;
};

/**
 * Build retry feedback so the model can correct its own previous invalid JSON
 * instead of regenerating the whole map decision from scratch. The retry shows
 * the bounded previous response (JSON only, no provider wrapper), the exact
 * validation error codes/messages, a concise fix per deterministic error code,
 * and an explicit mandatory restatement when the same error repeated.
 */
export const buildValidationRetryNote = (
  issues: readonly AiValidationIssue[],
  previousResponse: unknown,
  previousErrorCodes: readonly string[] = [],
): string => {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const lines = [
    'Correct the previous response. Preserve valid semantic decisions unless a validation issue requires changing them. Return the complete corrected JSON object that exactly matches the supplied schema.',
    '',
    'Previous invalid response (JSON only):',
    retryResponseText(previousResponse),
  ];
  if (errors.length === 0) {
    return `${lines.join('\n')}\n\nThe previous response failed validation. Apply the correction and return the complete corrected JSON object.`;
  }
  const body = errors
    .slice(0, 8)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(' ');
  lines.push('', `The previous response failed validation with: ${body}`);
  const fixes = errors.slice(0, 8).map((issue) => {
    const instruction = RETRY_INSTRUCTIONS[issue.code];
    const repeated = previousErrorCodes.includes(issue.code)
      ? ` The previous attempt also produced ${issue.code}; this requirement is mandatory for this result.`
      : '';
    return instruction
      ? `- ${issue.code}: ${instruction}${repeated}`
      : `- ${issue.code}: ${issue.message}${repeated}`;
  });
  lines.push('', 'Required fixes (the semantic correction itself is yours to make):', ...fixes);
  return lines.join('\n');
};

export const retryStateFor = (
  issues: readonly AiValidationIssue[],
  rawResponse: unknown,
  previousErrorCodes: readonly string[] | undefined,
): { note: string; errorCodes: string[] } => {
  const errorCodes = issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  return { note: buildValidationRetryNote(issues, rawResponse, previousErrorCodes), errorCodes };
};
