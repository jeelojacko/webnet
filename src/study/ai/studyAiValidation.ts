import type { ImportedLegalComponent } from '../studyTypes';
import type {
  AiLearningObjective,
  AiProposedSourceGroup,
  AiSourceCoverage,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
  AiStudyUnitProposal,
  AiValidationIssue,
  AiValidationReport,
} from './studyAiTypes';

const DISPOSITIONS = new Set(['standalone', 'combine', 'split', 'reference-only', 'skip', 'needs-human-review']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4']);
const SOURCE_STATUSES = new Set(['current', 'repealed', 'historical']);
const WARNING_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const REFERENCE_ONLY_REASON_CODES = new Set([
  'VERY_SHORT_REFERENCE_ONLY',
  'SHORT_CONTEXT_REFERENCE_ONLY',
  'COMMENCEMENT_OR_CITATION_REFERENCE_ONLY',
]);
const OBJECTIVE_TYPES = new Set([
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
]);

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): value is string => typeof value === 'string';

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(stringValue);

const optionalStringArray = (value: unknown): value is string[] | undefined =>
  value === undefined || stringArray(value);

const normalizeKeySet = (values: string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

const sameKeySet = (left: string[], right: string[]): boolean =>
  JSON.stringify(normalizeKeySet(left)) === JSON.stringify(normalizeKeySet(right));

const addIssue = (
  issues: AiValidationIssue[],
  issue: Omit<AiValidationIssue, 'severity'> & { severity?: AiValidationIssue['severity'] },
): void => {
  issues.push({ severity: issue.severity ?? 'error', ...issue });
};

const groupRequiresFocus = (job?: AiStudyMapJob): boolean =>
  job?.promptSpecVersion === 'study-map-v3';

const sourceTextForGroup = (job: AiStudyMapJob, group: AiProposedSourceGroup): string => {
  const contexts = [
    job.context.previous,
    job.context.next,
    ...(job.context.relevantDefinitions ?? []),
    ...(job.context.directlyReferencedProvisions ?? []),
  ];
  const extraContext = contexts
    .filter((context) => context && group.sourceKeys.includes(context.sourceKey))
    .map((context) => `${context?.operativeText ?? ''} ${context?.text ?? ''}`)
    .join(' ');
  return `${job.target.operativeSourceText} ${extraContext}`;
};

const genericGroupPattern =
  /^(?:[^-:]+[-:]\s*)?(?:core rule|procedure or conditions|effects, exceptions, or enforcement|other defined terms|related provisions)$/i;

const hasSpecificTopicSuffix = (title: string): boolean =>
  /\b(?:of|for|by|re|respecting|under|to)\s+[a-z][a-z-]{3,}/i.test(title);

const mapTopicTerms = (text: string): string[] => {
  const stopWords = new Set([
    'act',
    'section',
    'regulation',
    'regulations',
    'rule',
    'rules',
    'recall',
    'know',
    'understand',
    'practical',
    'legal',
    'effect',
    'effects',
    'source',
    'sources',
    'study',
    'unit',
    'provision',
    'provisions',
    'defined',
    'definitions',
    'terms',
    'scope',
    'limits',
    'other',
    'core',
    'procedure',
    'conditions',
    'enforcement',
    'related',
    'topic',
    'topics',
    'group',
  ]);
  return Array.from(new Set(normalizeText(text).match(/\b[a-z][a-z-]{4,}\b/g) ?? [])).filter(
    (word) => !stopWords.has(word),
  );
};

const validateGroupGrounding = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
  issues: AiValidationIssue[],
): void => {
  if (genericGroupPattern.test(group.titleSuggestion.trim()) && !hasSpecificTopicSuffix(group.titleSuggestion)) {
    addIssue(issues, {
      code: 'GENERIC_MAP_GROUP',
      severity: 'warning',
      jobId: job.jobId,
      message: `Generic Study Map group title: ${group.titleSuggestion}.`,
    });
  }
  const sourceTerms = new Set(mapTopicTerms(sourceTextForGroup(job, group)));
  const topicTerms = mapTopicTerms(`${group.titleSuggestion} ${group.approximateLearningGoal}`);
  const unsupported = topicTerms.filter(
    (term) => !sourceTerms.has(term) && !sourceTerms.has(`${term}s`) && !(term.endsWith('s') && sourceTerms.has(term.slice(0, -1))),
  );
  const highRiskUnsupported = unsupported.filter((term) =>
    ['director', 'minister', 'instrument', 'instruments', 'land', 'integrated', 'institution', 'institutions'].includes(term),
  );
  if (highRiskUnsupported.length > 0) {
    addIssue(issues, {
      code: 'GROUP_TOPIC_NOT_GROUNDED',
      severity: 'warning',
      jobId: job.jobId,
      message: `Group topic may not be grounded in target or included combined source: ${highRiskUnsupported.slice(0, 5).join(', ')}.`,
    });
  }
};

const validateMapGroup = (
  group: unknown,
  result: Record<string, unknown>,
  job: AiStudyMapJob | undefined,
  issues: AiValidationIssue[],
): void => {
  const jobId = stringValue(result.jobId) ? result.jobId : undefined;
  if (!isRecord(group)) {
    addIssue(issues, { code: 'GROUP_INVALID', jobId, message: 'Each proposed group must be an object.' });
    return;
  }
  if (!nonEmptyString(group.groupId)) addIssue(issues, { code: 'GROUP_ID_REQUIRED', jobId, message: 'groupId is required.' });
  if (!nonEmptyString(group.titleSuggestion)) addIssue(issues, { code: 'GROUP_TITLE_REQUIRED', jobId, message: 'titleSuggestion is required.' });
  if (!stringArray(group.sourceKeys) || group.sourceKeys.length === 0) addIssue(issues, { code: 'GROUP_SOURCE_KEYS_REQUIRED', jobId, message: 'group.sourceKeys must be non-empty.' });
  if (!nonEmptyString(group.reason)) addIssue(issues, { code: 'GROUP_REASON_REQUIRED', jobId, message: 'group.reason is required.' });
  if (!nonEmptyString(group.approximateLearningGoal)) addIssue(issues, { code: 'GROUP_GOAL_REQUIRED', jobId, message: 'group.approximateLearningGoal is required.' });
  if (groupRequiresFocus(job) && !Array.isArray(group.focusSelections)) {
    addIssue(issues, { code: 'FOCUS_SELECTIONS_REQUIRED', jobId, message: 'v3 Study Map groups require focusSelections.' });
  }
  if (group.focusSelections !== undefined && !Array.isArray(group.focusSelections)) {
    addIssue(issues, { code: 'FOCUS_SELECTIONS_INVALID', jobId, message: 'focusSelections must be an array.' });
  }
  (Array.isArray(group.focusSelections) ? group.focusSelections : []).forEach((selection) => {
    if (!isRecord(selection)) {
      addIssue(issues, { code: 'FOCUS_SELECTION_INVALID', jobId, message: 'focusSelections entries must be objects.' });
      return;
    }
    if (!nonEmptyString(selection.sourceKey)) addIssue(issues, { code: 'FOCUS_SOURCE_KEY_REQUIRED', jobId, message: 'focusSelection.sourceKey is required.' });
    if (!optionalStringArray(selection.childLabels)) addIssue(issues, { code: 'FOCUS_CHILD_LABELS_INVALID', jobId, message: 'childLabels must be string array when present.' });
    if (!optionalStringArray(selection.definedTerms)) addIssue(issues, { code: 'FOCUS_DEFINED_TERMS_INVALID', jobId, message: 'definedTerms must be string array when present.' });
    if (!optionalStringArray(selection.evidenceText)) addIssue(issues, { code: 'FOCUS_EVIDENCE_INVALID', jobId, message: 'evidenceText must be string array when present.' });
  });
  if (job && nonEmptyString(group.titleSuggestion) && nonEmptyString(group.approximateLearningGoal)) {
    validateGroupGrounding(group as AiProposedSourceGroup, job, issues);
  }
};

export const validateAiStudyMapJob = (value: unknown): AiValidationReport => {
  const issues: AiValidationIssue[] = [];
  if (!isRecord(value)) return { valid: false, issues: [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Job must be an object.' }] };
  if (value.schemaVersion !== 1) addIssue(issues, { code: 'SCHEMA_VERSION', message: 'Study Map job schemaVersion must be 1.' });
  if (!nonEmptyString(value.jobId)) addIssue(issues, { code: 'JOB_ID_REQUIRED', message: 'jobId is required.' });
  if (!nonEmptyString(value.runId)) addIssue(issues, { code: 'RUN_ID_REQUIRED', message: 'runId is required.' });
  if (!nonEmptyString(value.promptSpecVersion)) addIssue(issues, { code: 'PROMPT_SPEC_VERSION_REQUIRED', message: 'promptSpecVersion is required.' });
  if (!nonEmptyString(value.corpusContentHash)) addIssue(issues, { code: 'CORPUS_HASH_REQUIRED', message: 'corpusContentHash is required.' });
  if (!nonEmptyString(value.inputHash)) addIssue(issues, { code: 'INPUT_HASH_REQUIRED', message: 'inputHash is required.' });
  const document = value.document;
  if (!isRecord(document) || !nonEmptyString(document.documentId) || !nonEmptyString(document.title)) {
    addIssue(issues, { code: 'DOCUMENT_INVALID', message: 'document identity is required.' });
  }
  const target = value.target;
  if (!isRecord(target)) {
    addIssue(issues, { code: 'TARGET_INVALID', message: 'target is required.' });
  } else {
    if (!stringArray(target.sourceKeys) || target.sourceKeys.length === 0) addIssue(issues, { code: 'SOURCE_KEYS_REQUIRED', message: 'target.sourceKeys must be non-empty.' });
    if (!stringArray(target.sectionLabels)) addIssue(issues, { code: 'SECTION_LABELS_INVALID', message: 'target.sectionLabels must be an array.' });
    if (!nonEmptyString(target.exactSourceText)) addIssue(issues, { code: 'SOURCE_TEXT_REQUIRED', message: 'target.exactSourceText is required.' });
    if (!nonEmptyString(target.operativeSourceText)) addIssue(issues, { code: 'OPERATIVE_SOURCE_TEXT_REQUIRED', message: 'target.operativeSourceText is required.' });
    if (!isRecord(target.sourceMetadata)) addIssue(issues, { code: 'SOURCE_METADATA_REQUIRED', message: 'target.sourceMetadata is required.' });
    if (!SOURCE_STATUSES.has(String(target.sourceStatus))) addIssue(issues, { code: 'INVALID_SOURCE_STATUS', message: 'target.sourceStatus must be current, historical, or repealed.' });
    if (target.contentFlags !== undefined && !isRecord(target.contentFlags)) addIssue(issues, { code: 'CONTENT_FLAGS_INVALID', message: 'target.contentFlags must be an object when present.' });
    if (!isRecord(target.sourceHashes)) addIssue(issues, { code: 'SOURCE_HASHES_REQUIRED', message: 'target.sourceHashes is required.' });
  }
  return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
};

export const validateAiStudyMapResult = (
  value: unknown,
  job?: AiStudyMapJob,
): AiValidationReport => {
  const issues: AiValidationIssue[] = [];
  if (!isRecord(value)) return { valid: false, issues: [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Map result must be an object.' }] };
  const jobId = stringValue(value.jobId) ? value.jobId : undefined;
  if (value.schemaVersion !== 1) addIssue(issues, { code: 'SCHEMA_VERSION', jobId, message: 'Study Map result schemaVersion must be 1.' });
  if (!nonEmptyString(value.jobId)) addIssue(issues, { code: 'JOB_ID_REQUIRED', message: 'jobId is required.' });
  if (!nonEmptyString(value.runId)) addIssue(issues, { code: 'RUN_ID_REQUIRED', jobId, message: 'runId is required.' });
  if (!DISPOSITIONS.has(String(value.disposition))) addIssue(issues, { code: 'INVALID_DISPOSITION', jobId, message: 'Invalid Study Map disposition.' });
  if (!CONFIDENCES.has(String(value.confidence))) addIssue(issues, { code: 'INVALID_CONFIDENCE', jobId, message: 'Invalid Study Map confidence.' });
  if (!nonEmptyString(value.reason)) addIssue(issues, { code: 'REASON_REQUIRED', jobId, message: 'reason is required.' });
  if (typeof value.suggestedPriority !== 'undefined' && !PRIORITIES.has(String(value.suggestedPriority))) {
    addIssue(issues, { code: 'INVALID_SUGGESTED_PRIORITY', jobId, message: 'suggestedPriority must be P1, P2, P3, P4, or absent.' });
  }
  if (typeof value.reason === 'string' && REFERENCE_ONLY_REASON_CODES.has(value.reason.trim())) {
    addIssue(issues, { code: 'WARNING_CODE_IN_REASON', jobId, message: 'Machine warning codes must be placed in warnings, not reason.' });
  }
  if (!Array.isArray(value.proposedGroups)) addIssue(issues, { code: 'GROUPS_REQUIRED', jobId, message: 'proposedGroups must be an array.' });
  if (!Array.isArray(value.warnings)) addIssue(issues, { code: 'WARNINGS_REQUIRED', jobId, message: 'warnings must be an array.' });
  if (Array.isArray(value.warnings)) {
    value.warnings.forEach((warning) => {
      if (typeof warning !== 'string' || !WARNING_CODE_PATTERN.test(warning)) {
        addIssue(issues, { code: 'INVALID_WARNING_CODE', jobId, message: 'warnings must contain machine-readable uppercase codes.' });
      }
    });
  }
  if (Array.isArray(value.proposedGroups)) {
    value.proposedGroups.forEach((group) => validateMapGroup(group, value, job, issues));
  }
  if (job) {
    if (value.jobId !== job.jobId) addIssue(issues, { code: 'JOB_MISMATCH', jobId, message: 'Result jobId does not match the job.' });
    if (value.runId !== job.runId) addIssue(issues, { code: 'RUN_MISMATCH', jobId, message: 'Result runId does not match the job.' });
    if (value.corpusContentHash !== job.corpusContentHash) addIssue(issues, { code: 'STALE_PROPOSAL', jobId, message: 'Result corpusContentHash does not match the job.' });
    if (value.inputHash && value.inputHash !== job.inputHash) addIssue(issues, { code: 'INPUT_HASH_MISMATCH', jobId, message: 'Result inputHash does not match the job.' });
    if (value.promptSpecVersion !== job.promptSpecVersion) {
      addIssue(issues, { code: 'PROMPT_SPEC_MISMATCH', jobId, message: 'Result promptSpecVersion does not match the job.' });
    }
  }
  if (value.confidence === 'low') {
    addIssue(issues, { code: 'LOW_CONFIDENCE', severity: 'warning', jobId, message: 'Low confidence requires human review.' });
  }
  if (
    value.disposition === 'reference-only' &&
    job &&
    /\b(shall|shall not|must|prohibited|within\s+\d+\s+days?|registration|filing|boundary|survey|deemed)\b/i.test(job.target.operativeSourceText)
  ) {
    addIssue(issues, {
      code: 'POSSIBLE_SUBSTANTIVE_REFERENCE_ONLY',
      severity: 'warning',
      jobId,
      message: 'Reference-only result covers a source with substantive legal signals.',
    });
  }
  if (
    value.disposition === 'standalone' &&
    job?.target.contentFlags &&
    (job.target.contentFlags.commencementOnly || job.target.contentFlags.repealOnly)
  ) {
    addIssue(issues, {
      code: 'POSSIBLE_TRIVIAL_STANDALONE',
      severity: 'warning',
      jobId,
      message: 'Standalone result covers a citation, commencement, or repeal-only source.',
    });
  }
  return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
};

const sourceTextByKey = (components: ImportedLegalComponent[]): Map<string, ImportedLegalComponent | { text: string; contentHash: string; documentId: string }> => {
  const map = new Map<string, ImportedLegalComponent | { text: string; contentHash: string; documentId: string }>();
  components.forEach((component) => {
    map.set(component.sourceKey, component);
    component.subsections?.forEach((subsection) => {
      map.set(subsection.sourceKey, {
        text: subsection.text,
        contentHash: subsection.contentHash,
        documentId: component.documentId,
      });
    });
  });
  return map;
};

const validateQuestionQuality = (
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
): void => {
  const questions = proposal.objectives.map((objective) => objective.guidedQuestion.trim());
  if (!proposal.mainQuestion.trim()) addIssue(issues, { code: 'EMPTY_MAIN_QUESTION', proposalId: proposal.proposalId, message: 'Main question is empty.' });
  if (proposal.mainQuestion.length > 240) addIssue(issues, { code: 'MAIN_QUESTION_TOO_LONG', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question is unusually long.' });
  if (/what must (a )?(person|registrar general) do\??/i.test(proposal.mainQuestion)) {
    addIssue(issues, { code: 'GENERIC_MAIN_QUESTION', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question is generic.' });
  }
  const seen = new Set<string>();
  questions.forEach((question) => {
    const key = normalizeText(question);
    if (!question) addIssue(issues, { code: 'EMPTY_GUIDED_QUESTION', proposalId: proposal.proposalId, message: 'An objective has an empty guided question.' });
    if (seen.has(key)) addIssue(issues, { code: 'DUPLICATE_QUESTION', severity: 'warning', proposalId: proposal.proposalId, message: `Duplicate guided question: ${question}` });
    if (key === normalizeText(proposal.mainQuestion)) addIssue(issues, { code: 'MAIN_EQUALS_GUIDED', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question matches a guided question.' });
    if (question.length > 220) addIssue(issues, { code: 'GUIDED_QUESTION_TOO_LONG', severity: 'warning', proposalId: proposal.proposalId, message: `Guided question is unusually long: ${question}` });
    seen.add(key);
  });
};

const tokenPattern =
  /\$?\b\d+(?:\.\d+)?\b(?:\s*(?:days?|months?|years?|per cent|percent|%))?|\bsection\s+\d+(?:\([^)]+\))*|\bsubsection\s+\d+(?:\([^)]+\))*|\bparagraph\s+\d+\([^)]+\)/gi;

const collectRiskTokens = (text: string): string[] =>
  Array.from(new Set((text.match(tokenPattern) ?? []).map((token) => normalizeText(token))));

const modalityTokens = (text: string): Set<string> => {
  const normalized = normalizeText(text);
  const tokens = new Set<string>();
  if (/\bshall not\b|\bmust not\b|\bmay not\b|\bprohibited\b/.test(normalized)) tokens.add('prohibition');
  if (/\bshall\b|\bmust\b|\brequired\b/.test(normalized)) tokens.add('duty');
  if (/\bmay\b|\bpermitted\b/.test(normalized)) tokens.add('permission');
  if (/\bentitled\b/.test(normalized)) tokens.add('entitlement');
  if (/\bdeemed\b|\bfinal\b|\bbinding\b|\bconclusive\b/.test(normalized)) tokens.add('legal-effect');
  return tokens;
};

const extractLikelyActors = (text: string): string[] =>
  Array.from(
    new Set(
      Array.from(
        text.matchAll(
          /\b(Registrar General|Director of Surveys|surveyor|person|Minister|Board|Council|inspector|owner|applicant)\b/gi,
        ),
      ).map((match) => normalizeText(match[1])),
    ),
  );

const significantTerms = (text: string): string[] => {
  const stopWords = new Set([
    'the',
    'and',
    'or',
    'of',
    'to',
    'a',
    'an',
    'in',
    'for',
    'by',
    'with',
    'that',
    'this',
    'is',
    'be',
    'as',
    'it',
    'under',
    'from',
    'on',
    'at',
    'may',
    'must',
    'shall',
  ]);
  return Array.from(new Set(normalizeText(text).match(/\b[a-z][a-z-]{4,}\b/g) ?? [])).filter(
    (word) => !stopWords.has(word),
  );
};

const validateObjectiveFidelity = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sources: Map<string, ImportedLegalComponent | { text: string; contentHash: string; documentId: string }>,
  issues: AiValidationIssue[],
): void => {
  const linkedTexts = objective.evidence
    .map((evidence) => `${evidence.evidenceText} ${sources.get(evidence.sourceKey)?.text ?? ''}`)
    .join(' ');
  const sourceTokenSet = new Set(collectRiskTokens(linkedTexts));
  collectRiskTokens(objective.studyAnswer).forEach((token) => {
    if (!sourceTokenSet.has(token)) {
      addIssue(issues, {
        code: 'UNSUPPORTED_NUMERIC_OR_REFERENCE',
        severity: 'warning',
        proposalId: proposal.proposalId,
        message: `Study answer includes unsupported numeric or legal-reference token: ${token}.`,
      });
    }
  });
  const answerModalities = modalityTokens(objective.studyAnswer);
  const evidenceModalities = modalityTokens(linkedTexts);
  if (
    (answerModalities.has('duty') && evidenceModalities.has('permission') && !evidenceModalities.has('duty')) ||
    (answerModalities.has('permission') && evidenceModalities.has('duty') && !evidenceModalities.has('permission')) ||
    (evidenceModalities.has('prohibition') && !answerModalities.has('prohibition'))
  ) {
    addIssue(issues, {
      code: 'POSSIBLE_MODALITY_MISMATCH',
      severity: 'warning',
      proposalId: proposal.proposalId,
      message: 'Study answer may have changed legal modality from the evidence.',
    });
  }
  const answerActors = extractLikelyActors(objective.studyAnswer);
  const evidenceActors = extractLikelyActors(linkedTexts);
  if (
    answerActors.length > 0 &&
    evidenceActors.length > 0 &&
    answerActors.some((actor) => !evidenceActors.includes(actor))
  ) {
    addIssue(issues, {
      code: 'POSSIBLE_ACTOR_MISMATCH',
      severity: 'warning',
      proposalId: proposal.proposalId,
      message: 'Study answer names a legal actor not found in the linked evidence.',
    });
  }
  const evidenceTerms = new Set(significantTerms(linkedTexts));
  const unsupportedTerms = significantTerms(objective.studyAnswer).filter(
    (term) => !evidenceTerms.has(term),
  );
  if (unsupportedTerms.length >= 3) {
    addIssue(issues, {
      code: 'ANSWER_EXTENDS_BEYOND_EVIDENCE',
      severity: 'warning',
      proposalId: proposal.proposalId,
      message: 'Study answer may include claims not supported by linked evidence.',
    });
  }
};

const validateCoverage = (
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const coverage = proposal.sourceCoverage ?? [];
  const coverageByKey = new Map(coverage.map((entry) => [entry.sourceKey, entry]));
  sourceComponents.forEach((component) => {
    const labels = component.subsections?.map((subsection) => subsection.label) ?? [];
    if (labels.length === 0) return;
    const entry = coverageByKey.get(component.sourceKey);
    labels.forEach((label) => {
      const child = entry?.childLabels?.find((item) => item.label === label);
      if (!child) {
        addIssue(issues, {
          code: 'UNCOVERED_SUBSTANTIVE_SOURCE',
          severity: 'warning',
          proposalId: proposal.proposalId,
          sourceKey: component.sourceKey,
          message: `No coverage status supplied for ${label}.`,
        });
        return;
      }
      if (child.status === 'intentionally-omitted' && !child.reason?.trim()) {
        addIssue(issues, {
          code: 'UNEXPLAINED_OMISSION',
          severity: 'warning',
          proposalId: proposal.proposalId,
          sourceKey: component.sourceKey,
          message: `Coverage marks ${label} omitted without a reason.`,
        });
      }
    });
  });
};

const validateApprovedScope = (
  proposal: AiStudyUnitProposal,
  approvedGroup: AiProposedSourceGroup | undefined,
  issues: AiValidationIssue[],
): void => {
  if (!approvedGroup) return;
  if (!sameKeySet(proposal.sourceKeys, approvedGroup.sourceKeys)) {
    addIssue(issues, {
      code: 'AUTHORING_SCOPE_MISMATCH',
      proposalId: proposal.proposalId,
      message: 'Proposal sourceKeys must equal the approved authoring group sourceKeys.',
    });
  }
};

const validateObjectiveSchema = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
): void => {
  if (!nonEmptyString(objective.id)) addIssue(issues, { code: 'OBJECTIVE_ID_REQUIRED', proposalId: proposal.proposalId, message: 'Objective id is required.' });
  if (!OBJECTIVE_TYPES.has(String(objective.type))) addIssue(issues, { code: 'INVALID_OBJECTIVE_TYPE', proposalId: proposal.proposalId, message: `Invalid objective type: ${String(objective.type)}.` });
  if (!nonEmptyString(objective.objective)) addIssue(issues, { code: 'OBJECTIVE_REQUIRED', proposalId: proposal.proposalId, message: 'Objective text is required.' });
  if (!nonEmptyString(objective.studyAnswer)) addIssue(issues, { code: 'ANSWER_REQUIRED', proposalId: proposal.proposalId, message: 'Objective study answer is required.' });
  if (!CONFIDENCES.has(String(objective.confidence))) addIssue(issues, { code: 'INVALID_CONFIDENCE', proposalId: proposal.proposalId, message: 'Invalid objective confidence.' });
  if (!Array.isArray(objective.sourceKeys) || objective.sourceKeys.length === 0) addIssue(issues, { code: 'OBJECTIVE_SOURCE_KEYS_REQUIRED', proposalId: proposal.proposalId, message: 'Objective sourceKeys must be non-empty.' });
  if (!Array.isArray(objective.evidence) || objective.evidence.length === 0) addIssue(issues, { code: 'EVIDENCE_REQUIRED', proposalId: proposal.proposalId, message: 'Objective evidence must be non-empty.' });
};

export const validateAiStudyUnitProposal = ({
  proposal,
  sourceComponents,
  corpusContentHash,
}: {
  proposal: unknown;
  sourceComponents: ImportedLegalComponent[];
  corpusContentHash?: string;
}): AiValidationReport => {
  const issues: AiValidationIssue[] = [];
  if (!isRecord(proposal)) return { valid: false, issues: [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Unit proposal must be an object.' }] };
  const typed = proposal as AiStudyUnitProposal;
  if (typed.schemaVersion !== 1) addIssue(issues, { code: 'SCHEMA_VERSION', proposalId: typed.proposalId, message: 'Unit proposal schemaVersion must be 1.' });
  if (!nonEmptyString(typed.proposalId)) addIssue(issues, { code: 'PROPOSAL_ID_REQUIRED', message: 'proposalId is required.' });
  if (!nonEmptyString(typed.runId)) addIssue(issues, { code: 'RUN_ID_REQUIRED', proposalId: typed.proposalId, message: 'runId is required.' });
  if (corpusContentHash && typed.corpusContentHash !== corpusContentHash) addIssue(issues, { code: 'STALE_PROPOSAL', proposalId: typed.proposalId, message: 'Proposal corpusContentHash does not match current corpus.' });
  if (!stringArray(typed.sourceKeys) || typed.sourceKeys.length === 0) addIssue(issues, { code: 'SOURCE_KEYS_REQUIRED', proposalId: typed.proposalId, message: 'sourceKeys must be non-empty.' });
  validateApprovedScope(typed, typed.approvedGroup, issues);
  if (typed.confidence === 'low') addIssue(issues, { code: 'LOW_CONFIDENCE', severity: 'warning', proposalId: typed.proposalId, message: 'Low confidence proposal requires explicit review.' });
  if (!nonEmptyString(typed.title)) addIssue(issues, { code: 'TITLE_REQUIRED', proposalId: typed.proposalId, message: 'title is required.' });
  if (!nonEmptyString(typed.mainQuestion)) addIssue(issues, { code: 'MAIN_QUESTION_REQUIRED', proposalId: typed.proposalId, message: 'mainQuestion is required.' });
  if (!Array.isArray(typed.objectives) || typed.objectives.length === 0) addIssue(issues, { code: 'OBJECTIVES_REQUIRED', proposalId: typed.proposalId, message: 'At least one learning objective is required.' });
  if (!CONFIDENCES.has(String(typed.confidence))) addIssue(issues, { code: 'INVALID_CONFIDENCE', proposalId: typed.proposalId, message: 'Invalid proposal confidence.' });
  if (!Array.isArray(typed.warnings)) addIssue(issues, { code: 'WARNINGS_REQUIRED', proposalId: typed.proposalId, message: 'warnings must be an array.' });
  const sources = sourceTextByKey(sourceComponents);
  typed.objectives?.forEach((objective) => {
    validateObjectiveSchema(objective, typed, issues);
    objective.evidence?.forEach((evidence) => {
      const source = sources.get(evidence.sourceKey);
      if (!source) {
        addIssue(issues, { code: 'SOURCE_KEY_NOT_FOUND', proposalId: typed.proposalId, sourceKey: evidence.sourceKey, message: 'Evidence sourceKey was not found.' });
        return;
      }
      if (source.documentId !== typed.sourceDocumentId) {
        addIssue(issues, { code: 'DOCUMENT_MISMATCH', proposalId: typed.proposalId, sourceKey: evidence.sourceKey, message: 'Evidence source belongs to another document.' });
      }
      if (typed.sourceHashes[evidence.sourceKey] && typed.sourceHashes[evidence.sourceKey] !== source.contentHash) {
        addIssue(issues, { code: 'SOURCE_HASH_CHANGED', proposalId: typed.proposalId, sourceKey: evidence.sourceKey, message: 'Evidence source hash changed.' });
      }
      if (!normalizeText(source.text).includes(normalizeText(evidence.evidenceText))) {
        addIssue(issues, { code: 'EVIDENCE_NOT_FOUND', proposalId: typed.proposalId, sourceKey: evidence.sourceKey, message: 'Evidence text was not found in the authoritative source.' });
      }
    });
    validateObjectiveFidelity(objective, typed, sources, issues);
  });
  validateCoverage(typed, sourceComponents, issues);
  validateQuestionQuality(typed, issues);
  return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
};

export const detectAiUnitProposalOverlaps = ({
  proposals,
  existingUnits = [],
}: {
  proposals: AiStudyUnitProposal[];
  existingUnits?: Array<{
    id: string;
    title: string;
    phase?: string;
    sourceReferences?: Array<{ documentId: string; sourceKey: string }>;
    scheduling?: unknown;
    fsrs?: unknown;
  }>;
}): AiValidationIssue[] => {
  const issues: AiValidationIssue[] = [];
  const proposalCoverage = new Map<string, string[]>();
  proposals.forEach((proposal) => {
    proposal.sourceKeys.forEach((sourceKey) => {
      const key = `${proposal.sourceDocumentId}::${sourceKey}`;
      proposalCoverage.set(key, [...(proposalCoverage.get(key) ?? []), proposal.proposalId]);
    });
  });
  proposals.forEach((proposal) => {
    proposal.sourceKeys.forEach((sourceKey) => {
      const key = `${proposal.sourceDocumentId}::${sourceKey}`;
      if ((proposalCoverage.get(key)?.length ?? 0) > 1) {
        addIssue(issues, {
          code: 'PROPOSAL_SOURCE_OVERLAP',
          severity: 'warning',
          proposalId: proposal.proposalId,
          sourceKey,
          message: 'Another AI unit proposal covers this source key.',
        });
      }
      existingUnits.forEach((unit) => {
        if (unit.sourceReferences?.some((ref) => ref.documentId === proposal.sourceDocumentId && ref.sourceKey === sourceKey)) {
          addIssue(issues, {
            code: 'EXISTING_UNIT_OVERLAP',
            severity: 'warning',
            proposalId: proposal.proposalId,
            sourceKey,
            message: `Existing StudyUnit overlaps this source: ${unit.title} (${unit.phase ?? 'unknown phase'}).`,
          });
        }
      });
    });
  });
  return issues;
};

export const reconcileAiStudyMapProposals = (
  proposals: AiStudyMapProposal[],
): AiStudyMapProposal[] => {
  const coverage = new Map<string, string[]>();
  const focusCoverageKey = (proposal: AiStudyMapProposal, group: AiProposedSourceGroup, sourceKey: string): string[] => {
    const selections = group.focusSelections?.filter((selection) => selection.sourceKey === sourceKey) ?? [];
    if (selections.length === 0) return [`${proposal.document.documentId}::${sourceKey}`];
    const keys = selections.flatMap((selection) => {
      const childLabels = selection.childLabels?.map((label) => `child:${normalizeText(label)}`) ?? [];
      const terms = selection.definedTerms?.map((term) => `term:${normalizeText(term)}`) ?? [];
      const evidence = selection.evidenceText?.map((text) => `evidence:${normalizeText(text).slice(0, 80)}`) ?? [];
      const focus = [...childLabels, ...terms, ...evidence].sort();
      return [
        focus.length > 0
          ? `${proposal.document.documentId}::${sourceKey}::${focus.join('|')}`
          : `${proposal.document.documentId}::${sourceKey}`,
      ];
    });
    return Array.from(new Set(keys));
  };
  proposals.forEach((proposal) => {
    proposal.proposedGroups.forEach((group) => {
      group.sourceKeys.forEach((sourceKey) => {
        focusCoverageKey(proposal, group, sourceKey).forEach((key) => {
          coverage.set(key, [...(coverage.get(key) ?? []), `${proposal.id}/${group.groupId}`]);
        });
      });
    });
  });
  return proposals.map((proposal) => {
    const conflictCodes = new Set(proposal.conflictCodes);
    proposal.proposedGroups.forEach((group) => {
      group.sourceKeys.forEach((sourceKey) => {
        focusCoverageKey(proposal, group, sourceKey).forEach((key) => {
          if ((coverage.get(key)?.length ?? 0) > 1) conflictCodes.add('MAP_CONFLICT');
        });
      });
    });
    if (
      proposal.disposition === 'combine' &&
      proposal.proposedGroups.every((group) => group.sourceKeys.length <= 1)
    ) {
      conflictCodes.add('MAP_CONFLICT');
    }
    return {
      ...proposal,
      conflictCodes: Array.from(conflictCodes).sort(),
      validationStatus: conflictCodes.size > 0 ? 'warnings' : proposal.validationStatus,
      validationMessages:
        conflictCodes.size > 0
          ? Array.from(new Set([...proposal.validationMessages, 'MAP_CONFLICT']))
          : proposal.validationMessages,
    };
  });
};

export const mapResultToProposal = ({
  result,
  job,
  createdAt = new Date().toISOString(),
}: {
  result: AiStudyMapResult;
  job: AiStudyMapJob;
  createdAt?: string;
}): AiStudyMapProposal => ({
  id: `${result.runId}:${result.jobId}`,
  schemaVersion: 1,
  runId: result.runId,
  jobId: result.jobId,
  corpusContentHash: result.corpusContentHash,
  inputHash: result.inputHash,
  document: job.document,
  targetSourceKeys: job.target.sourceKeys,
  targetSectionLabels: job.target.sectionLabels,
  targetHeading: job.target.heading,
  exactSourceText: job.target.exactSourceText,
  operativeSourceText: job.target.operativeSourceText,
  context: job.context,
  disposition: result.disposition,
  confidence: result.confidence,
  reason: result.reason,
  suggestedPriority: result.suggestedPriority,
  proposedGroups: result.proposedGroups,
  warnings: result.warnings,
  conflictCodes: [],
  reviewStatus: result.confidence === 'low' ? 'needs-review' : 'validated',
  validationStatus: result.confidence === 'low' ? 'warnings' : 'valid',
  validationMessages: result.confidence === 'low' ? ['LOW_CONFIDENCE'] : [],
  createdAt,
  updatedAt: createdAt,
});
