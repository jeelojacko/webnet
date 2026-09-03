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
  EVIDENCE_NOT_EXACT_VERBATIM:
    'Copy each objective evidence character-for-character from exactSourceText; preserve spacing, OCR artifacts, hyphenation, punctuation, and capitalization. Reproduce typographic Unicode exactly as supplied: curly apostrophes (U+2019), curly quotes (U+201C U+201D), never substitute straight ASCII quotes. When the error names a first-mismatch position, replace only that character with the named source code point; do not retype the rest of the quote.',
  SOURCE_COVERAGE_EXTRA_SOURCE: 'sourceCoverage may only contain sourceKeys from the approved group.',
  SOURCE_COVERAGE_EXTRA_LABEL:
    'sourceCoverage childLabels may only declare selected childLabels and approved definedTerms; remove every other label and never invent sublabels.',
  SOURCE_COVERAGE_DUPLICATE_LABEL: 'Declare each selected childLabel exactly once in sourceCoverage.',
  SOURCE_COVERAGE_MISSING_SELECTED_LABEL:
    'Add a sourceCoverage entry for every selected childLabel: covered with objectiveIds, or intentionally-omitted with a nonblank source-grounded reason.',
  SOURCE_COVERAGE_INVALID_STATUS:
    'Use status covered or intentionally-omitted for each selected childLabel; context-only and not-assessed are not valid for selected labels.',
  SOURCE_COVERAGE_COVERED_WITHOUT_OBJECTIVES:
    'Every covered childLabel must list the objectiveIds that teach it.',
  SOURCE_COVERAGE_UNKNOWN_OBJECTIVE: 'sourceCoverage objectiveIds must reference existing objective ids.',
  SOURCE_COVERAGE_OMISSION_WITHOUT_REASON:
    'Every intentionally-omitted childLabel needs a nonblank source-grounded reason.',
  POLARITY_REVERSAL:
    'The source prohibits this act ("No ... shall"); state the prohibition, not an affirmative duty. Preserve the negation.',
  LEGAL_MODALITY_REVERSAL:
    'The source trigger is conditional or discretionary; keep the source condition and permissive modality, do not rewrite it as a mandatory duty.',
  UNSUPPORTED_LEGAL_EFFECT:
    'Remove legal-effect claims (e.g. that a rule bars or precludes recovery, or creates no standalone right) unless the exact wording appears in the approved source.',
  CONTEXT_REF_LEAKAGE:
    'The study summary must not reference provisions outside the approved focus; remove contrasts with other sections.',
  SUMMARY_ACTOR_OVERREACH:
    'The study summary assigns a duty to an actor the approved focus never names; remove or source-ground the actor.',
  SUMMARY_APPROVAL_SEQUENCING:
    'The study summary claims an approval step the approved focus does not contain; remove the sequencing claim.',
  STUDY_NOTE_OUTSIDE_APPROVED_SOURCE:
    'Study notes may only cite sourceKeys from the approved group.',
  SOURCE_DERIVED_NOTE_UNGROUNDED:
    'Source-derived notes must stay within their declared source text; remove references or legal terms not present there.',
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
