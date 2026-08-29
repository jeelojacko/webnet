import type { AiStudyMapJob, AiValidationIssue } from './studyAiTypes';

const dispositions = ['standalone', 'combine', 'split', 'reference-only', 'skip', 'needs-human-review'] as const;
const confidences = ['high', 'medium', 'low'] as const;
const priorities = ['P1', 'P2', 'P3', 'P4'] as const;

export const STUDY_MAP_V3_RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://webnet.local/schemas/study-map-v3-result.schema.json',
  title: 'Study Map V3 Result',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'jobId',
    'runId',
    'corpusContentHash',
    'promptSpecVersion',
    'disposition',
    'confidence',
    'reason',
    'suggestedPriority',
    'proposedGroups',
    'warnings',
  ],
  properties: {
    schemaVersion: { const: 1 },
    jobId: { type: 'string', minLength: 1 },
    runId: { type: 'string', minLength: 1 },
    corpusContentHash: { type: 'string', minLength: 1 },
    inputHash: { type: 'string', minLength: 1 },
    authoringInputFingerprint: { type: 'string', minLength: 1 },
    promptSpecVersion: { type: 'string', minLength: 1 },
    disposition: { enum: dispositions },
    confidence: { enum: confidences },
    reason: { type: 'string', minLength: 1 },
    // Always-emitted and nullable: the model must supply a P1-P4 for grouped results
    // and exactly null for zero-group results. This llama.cpp build's strict
    // json_schema converter renders enum [P1..P4, null] as ("P1"|"P2"|"P3"|"P4"|null),
    // so the key is structurally required and can no longer be omitted. The runner
    // still enforces group<->priority consistency and never infers a P level (see
    // withRunnerIdentity and validateAiStudyMapResult).
    suggestedPriority: { enum: [...priorities, null] },
    proposedGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId', 'titleSuggestion', 'sourceKeys', 'focusSelections', 'reason', 'approximateLearningGoal'],
        properties: {
          groupId: { type: 'string', minLength: 1 },
          titleSuggestion: { type: 'string', minLength: 1 },
          sourceKeys: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          focusSelections: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceKey'],
              properties: {
                sourceKey: { type: 'string', minLength: 1 },
                childLabels: { type: 'array', items: { type: 'string', minLength: 1 } },
                definedTerms: { type: 'array', items: { type: 'string', minLength: 1 } },
                evidenceText: { type: 'array', items: { type: 'string', minLength: 1 } },
              },
            },
          },
          reason: { type: 'string', minLength: 1 },
          approximateLearningGoal: { type: 'string', minLength: 1 },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]+$' } },
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const issue = (code: string, message: string, jobId?: string): AiValidationIssue => ({
  code,
  severity: 'error',
  message,
  jobId,
});

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonEmptyString);

const optionalStringArray = (value: unknown): value is string[] | undefined =>
  value === undefined || stringArray(value);

const unexpectedKeys = (value: Record<string, unknown>, allowed: string[]): string[] =>
  Object.keys(value).filter((key) => !allowed.includes(key)).sort();

export const validateStudyMapV3ResultContract = (value: unknown): AiValidationIssue[] => {
  if (!isRecord(value)) return [issue('SCHEMA_INVALID', 'Map result must be an object.')];
  const jobId = nonEmptyString(value.jobId) ? value.jobId : undefined;
  const issues: AiValidationIssue[] = [];
  const allowedResultKeys = [
    'schemaVersion',
    'jobId',
    'runId',
    'corpusContentHash',
    'inputHash',
    'authoringInputFingerprint',
    'promptSpecVersion',
    'disposition',
    'confidence',
    'reason',
    'suggestedPriority',
    'proposedGroups',
    'warnings',
  ];
  unexpectedKeys(value, allowedResultKeys).forEach((key) => {
    issues.push(issue('SCHEMA_UNEXPECTED_FIELD', `Unexpected Study Map result field: ${key}.`, jobId));
  });
  if (value.schemaVersion !== 1) issues.push(issue('SCHEMA_VERSION', 'Study Map result schemaVersion must be 1.', jobId));
  if (!nonEmptyString(value.jobId)) issues.push(issue('JOB_ID_REQUIRED', 'jobId is required.', jobId));
  if (!nonEmptyString(value.runId)) issues.push(issue('RUN_ID_REQUIRED', 'runId is required.', jobId));
  if (!nonEmptyString(value.corpusContentHash)) issues.push(issue('CORPUS_HASH_REQUIRED', 'corpusContentHash is required.', jobId));
  if (value.inputHash !== undefined && !nonEmptyString(value.inputHash)) issues.push(issue('INPUT_HASH_INVALID', 'inputHash must be a non-empty string when present.', jobId));
  if (value.authoringInputFingerprint !== undefined && !nonEmptyString(value.authoringInputFingerprint)) issues.push(issue('AUTHORING_FINGERPRINT_INVALID', 'authoringInputFingerprint must be a non-empty string when present.', jobId));
  if (value.promptSpecVersion !== undefined && !nonEmptyString(value.promptSpecVersion)) issues.push(issue('PROMPT_SPEC_INVALID', 'promptSpecVersion must be a non-empty string when present.', jobId));
  if (!dispositions.includes(value.disposition as never)) issues.push(issue('INVALID_DISPOSITION', 'Invalid Study Map disposition.', jobId));
  if (!confidences.includes(value.confidence as never)) issues.push(issue('INVALID_CONFIDENCE', 'Invalid Study Map confidence.', jobId));
  if (!nonEmptyString(value.reason)) issues.push(issue('REASON_REQUIRED', 'reason is required.', jobId));
  if (value.suggestedPriority !== undefined && value.suggestedPriority !== null && !priorities.includes(value.suggestedPriority as never)) {
    issues.push(issue('INVALID_SUGGESTED_PRIORITY', 'suggestedPriority must be P1, P2, P3, P4, null, or absent.', jobId));
  }
  if (!Array.isArray(value.proposedGroups)) {
    issues.push(issue('GROUPS_REQUIRED', 'proposedGroups must be an array.', jobId));
  } else {
    value.proposedGroups.forEach((group) => {
      if (!isRecord(group)) {
        issues.push(issue('GROUP_INVALID', 'Each proposed group must be an object.', jobId));
        return;
      }
      unexpectedKeys(group, ['groupId', 'titleSuggestion', 'sourceKeys', 'focusSelections', 'reason', 'approximateLearningGoal'])
        .forEach((key) => issues.push(issue('SCHEMA_UNEXPECTED_FIELD', `Unexpected Study Map group field: ${key}.`, jobId)));
      if (!nonEmptyString(group.groupId)) issues.push(issue('GROUP_ID_REQUIRED', 'groupId is required.', jobId));
      if (!nonEmptyString(group.titleSuggestion)) issues.push(issue('GROUP_TITLE_REQUIRED', 'titleSuggestion is required.', jobId));
      if (!stringArray(group.sourceKeys) || group.sourceKeys.length === 0) issues.push(issue('GROUP_SOURCE_KEYS_REQUIRED', 'group.sourceKeys must be non-empty.', jobId));
      if (!Array.isArray(group.focusSelections) || group.focusSelections.length === 0) {
        issues.push(issue('FOCUS_SELECTIONS_REQUIRED', 'v3 Study Map groups require focusSelections.', jobId));
      } else {
        group.focusSelections.forEach((selection) => {
          if (!isRecord(selection)) {
            issues.push(issue('FOCUS_SELECTION_INVALID', 'focusSelections entries must be objects.', jobId));
            return;
          }
          unexpectedKeys(selection, ['sourceKey', 'childLabels', 'definedTerms', 'evidenceText'])
            .forEach((key) => issues.push(issue('SCHEMA_UNEXPECTED_FIELD', `Unexpected focusSelection field: ${key}.`, jobId)));
          if (!nonEmptyString(selection.sourceKey)) issues.push(issue('FOCUS_SOURCE_KEY_REQUIRED', 'focusSelection.sourceKey is required.', jobId));
          if (!optionalStringArray(selection.childLabels)) issues.push(issue('FOCUS_CHILD_LABELS_INVALID', 'childLabels must be string array when present.', jobId));
          if (!optionalStringArray(selection.definedTerms)) issues.push(issue('FOCUS_DEFINED_TERMS_INVALID', 'definedTerms must be string array when present.', jobId));
          if (!optionalStringArray(selection.evidenceText)) issues.push(issue('FOCUS_EVIDENCE_INVALID', 'evidenceText must be string array when present.', jobId));
        });
      }
      if (!nonEmptyString(group.reason)) issues.push(issue('GROUP_REASON_REQUIRED', 'group.reason is required.', jobId));
      if (!nonEmptyString(group.approximateLearningGoal)) issues.push(issue('GROUP_GOAL_REQUIRED', 'group.approximateLearningGoal is required.', jobId));
    });
  }
  if (!Array.isArray(value.warnings)) {
    issues.push(issue('WARNINGS_REQUIRED', 'warnings must be an array.', jobId));
  } else {
    value.warnings.forEach((warning) => {
      if (typeof warning !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(warning)) {
        issues.push(issue('INVALID_WARNING_CODE', 'warnings must contain machine-readable uppercase codes.', jobId));
      }
    });
  }
  return issues;
};

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
};

export const canonicalJson = (value: unknown): string => JSON.stringify(sortDeep(value));

export const authoringInputFingerprintPayload = (job: AiStudyMapJob): unknown => ({
  schemaVersion: job.schemaVersion,
  promptSpecVersion: job.promptSpecVersion,
  corpusContentHash: job.corpusContentHash,
  document: job.document,
  target: job.target,
  context: job.context,
});
