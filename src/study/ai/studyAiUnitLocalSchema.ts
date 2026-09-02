/**
 * Strict structured-output schema for the local Unit Authoring V4 runner.
 *
 * The model fills ONLY the semantic fields it owns on `AiStudyUnitProposal`.
 * Every runner-owned identity field (schemaVersion, proposalId, runId,
 * corpusContentHash, sourceDocumentId, sourceKeys, sourceHashes, approvedGroup,
 * mapDisposition, mapReason, approximateLearningGoal, suggestedPriority,
 * generationMetadata) is omitted here and injected by the runner after parsing.
 *
 * Field shapes mirror the src/study/ai/studyAiTypes.ts proposal element types;
 * enums mirror the unit-authoring-v4 spec and the validator's accepted values.
 */

const stringType = { type: 'string', minLength: 1 } as const;
const stringArray = { type: 'array', items: stringType } as const;
const nonEmptyStringArray = { type: 'array', minItems: 1, items: stringType } as const;

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
const AUTHORING_STATUS_VALUES = ['generated', 'needs-map-revision'] as const;
const COVERAGE_STATUS_VALUES = [
  'covered',
  'context-only',
  'intentionally-omitted',
  'not-assessed',
] as const;
const STUDY_NOTE_KIND_VALUES = ['surveying-relevance', 'memory-aid', 'relationship', 'other'] as const;
const STUDY_NOTE_BASIS_VALUES = ['source-derived', 'inference'] as const;
/** Model-facing warning codes the unit-authoring-v4 spec instructs the model to emit. */
const WARNING_CODE_VALUES = ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT', 'OUTSIDE_APPROVED_FOCUS'] as const;
const OBJECTIVE_TYPE_VALUES = [
  'definition',
  'scope',
  'trigger',
  'actor',
  'authority',
  'duty',
  'prohibition',
  'procedure',
  'required-information',
  'notice',
  'deadline',
  'hearing',
  'evidence',
  'filing',
  'exception',
  'legal-effect',
  'appeal',
  'offence',
  'penalty',
  'relationship',
  'surveying-practice',
  'other',
] as const;

/** AiGroundingEvidence element. */
const evidenceItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceKey', 'evidenceText'],
  properties: {
    sourceKey: stringType,
    evidenceText: stringType,
    evidenceHash: stringType,
  },
} as const;

/** AiLearningObjective element (exact shape from the type). */
const learningObjectiveSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'type',
    'objective',
    'guidedQuestion',
    'studyAnswer',
    'required',
    'sourceKeys',
    'evidence',
    'confidence',
  ],
  properties: {
    id: stringType,
    type: { enum: OBJECTIVE_TYPE_VALUES },
    objective: stringType,
    guidedQuestion: stringType,
    studyAnswer: stringType,
    required: { type: 'boolean' },
    sourceKeys: nonEmptyStringArray,
    evidence: { type: 'array', minItems: 1, items: evidenceItemSchema },
    confidence: { enum: CONFIDENCE_VALUES },
  },
} as const;

/** AiMapFocusSelection element. */
const focusSelectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceKey'],
  properties: {
    sourceKey: stringType,
    childLabels: stringArray,
    definedTerms: stringArray,
    evidenceText: stringArray,
  },
} as const;

/** AiMapRevisionSuggestion.proposedGroups element. */
const revisionGroupSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sourceKeys', 'focusSelections', 'approximateLearningGoal'],
  properties: {
    title: stringType,
    sourceKeys: nonEmptyStringArray,
    focusSelections: { type: 'array', minItems: 1, items: focusSelectionSchema },
    approximateLearningGoal: stringType,
  },
} as const;

/** AiMapRevisionSuggestion (validator requires at least two finer groups). */
const mapRevisionSuggestionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'proposedGroups'],
  properties: {
    reason: stringType,
    proposedGroups: { type: 'array', minItems: 2, items: revisionGroupSchema },
  },
} as const;

/** AiSourceCoverage element. */
const sourceCoverageItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceKey'],
  properties: {
    sourceKey: stringType,
    childLabels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'status'],
        properties: {
          label: stringType,
          status: { enum: COVERAGE_STATUS_VALUES },
          objectiveIds: stringArray,
          reason: stringType,
        },
      },
    },
  },
} as const;

/** AiStudyNote element. */
const studyNoteItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'text', 'basis'],
  properties: {
    id: stringType,
    kind: { enum: STUDY_NOTE_KIND_VALUES },
    text: stringType,
    basis: { enum: STUDY_NOTE_BASIS_VALUES },
    sourceKeys: stringArray,
  },
} as const;

/** Local response schema: model-owned fields only. */
export const UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://webnet.local/schemas/study-unit-authoring-v4-local-author-result.schema.json',
  title: 'Study Unit Authoring V4 Local Author Result',
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'mainQuestion',
    'studySummary',
    'objectives',
    'authoringStatus',
    'confidence',
    'warnings',
  ],
  properties: {
    title: stringType,
    mainQuestion: stringType,
    studySummary: stringType,
    objectives: { type: 'array', minItems: 1, items: learningObjectiveSchema },
    relatedSourceKeys: stringArray,
    studyNotes: { type: 'array', items: studyNoteItemSchema },
    sourceCoverage: { type: 'array', items: sourceCoverageItemSchema },
    authoringStatus: { enum: AUTHORING_STATUS_VALUES },
    mapRevisionSuggestion: mapRevisionSuggestionSchema,
    confidence: { enum: CONFIDENCE_VALUES },
    warnings: { type: 'array', items: { enum: WARNING_CODE_VALUES } },
  },
};

/** Schema name used for the strict json_schema response_format request. */
export const UNIT_AUTHORING_V4_LOCAL_SCHEMA_NAME = 'study_unit_v4_local_result';

/** Semantic fields the model owns (documented alongside the runner stamp list). */
export const UNIT_AUTHORING_V4_MODEL_FIELDS = [
  'title',
  'mainQuestion',
  'studySummary',
  'objectives',
  'relatedSourceKeys',
  'studyNotes',
  'sourceCoverage',
  'authoringStatus',
  'mapRevisionSuggestion',
  'confidence',
  'warnings',
] as const;
