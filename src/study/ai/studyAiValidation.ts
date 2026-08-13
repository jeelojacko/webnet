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
import { validateStudyMapGroupGrounding } from './studyAiGrounding';

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
    validateStudyMapGroupGrounding(group as AiProposedSourceGroup, job, issues);
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
  const approvedTitle = proposal.approvedGroup?.titleSuggestion.trim();
  if (!proposal.mainQuestion.trim()) addIssue(issues, { code: 'EMPTY_MAIN_QUESTION', proposalId: proposal.proposalId, message: 'Main question is empty.' });
  if (proposal.mainQuestion.length > 240) addIssue(issues, { code: 'MAIN_QUESTION_TOO_LONG', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question is unusually long.' });
  if (
    /what must (a )?(person|registrar general) do\??/i.test(proposal.mainQuestion) ||
    /^what should a learner remember about .+\?$/i.test(proposal.mainQuestion.trim()) ||
    (approvedTitle && normalizeText(proposal.mainQuestion) === normalizeText(`What should a learner remember about ${approvedTitle}?`))
  ) {
    addIssue(issues, { code: 'GENERIC_MAIN_QUESTION', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question is generic.' });
  }
  const seen = new Set<string>();
  questions.forEach((question) => {
    const key = normalizeText(question);
    if (!question) addIssue(issues, { code: 'EMPTY_GUIDED_QUESTION', proposalId: proposal.proposalId, message: 'An objective has an empty guided question.' });
    if (seen.has(key)) addIssue(issues, { code: 'DUPLICATE_QUESTION', severity: 'warning', proposalId: proposal.proposalId, message: `Duplicate guided question: ${question}` });
    if (key === normalizeText(proposal.mainQuestion)) addIssue(issues, { code: 'MAIN_EQUALS_GUIDED', severity: 'warning', proposalId: proposal.proposalId, message: 'Main question matches a guided question.' });
    if (question.length > 220) addIssue(issues, { code: 'GUIDED_QUESTION_TOO_LONG', severity: 'warning', proposalId: proposal.proposalId, message: `Guided question is unusually long: ${question}` });
    if (
      /^what does .+ require or allow for .+\?$/i.test(question.trim()) ||
      /^what is the rule for .+\?$/i.test(question.trim())
    ) {
      addIssue(issues, { code: 'GENERIC_GUIDED_QUESTION', severity: 'warning', proposalId: proposal.proposalId, message: `Guided question is generic: ${question}` });
    }
    seen.add(key);
  });
};

const legalReferencePattern =
  /\b(?:sections?|subsections?|paragraphs?)\s+(?:\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))(?:\([^)]+\))*(?:\s+or\s+(?:\d+(?:\.\d+)?)?\([^)]+\))*|\b\d+(?:\.\d+)?\([^)]+\)(?:\([^)]+\))*/gi;

const quantityPattern =
  /\$\s*\b\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:days?|months?|years?|per cent|percent|%)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirty|sixty)\s+(?:days?|months?|years?)\b/gi;

const sourceSectionFromKey = (sourceKey: string): string | undefined =>
  /^section:(\d+(?:\.\d+)?)/i.exec(sourceKey)?.[1];

const normalizeLegalReference = (token: string, currentSection?: string): string[] => {
  const normalized = normalizeText(token).replace(/\s+/g, ' ');
  const prefixMatch = /^(sections?|subsections?|paragraphs?)\s+(.+)$/i.exec(normalized);
  if (!prefixMatch) return [normalized];
  const prefix = prefixMatch[1].toLowerCase().replace(/s$/, '');
  const body = prefixMatch[2];
  const parts = body.split(/\s+or\s+/i);
  return parts.flatMap((part, index) => {
    const trimmed = part.trim();
    const withBare = (value: string): string[] =>
      /^\d+(?:\.\d+)?\([^)]+\)/.test(trimmed) ? [value, trimmed] : [value];
    if (/^\(\d+(?:\.\d+)?\)/.test(trimmed)) {
      const base = currentSection ?? /^\d+(?:\.\d+)?/.exec(parts[0])?.[0];
      return base ? `${prefix} ${base}${trimmed}` : `${prefix} ${trimmed}`;
    }
    if (index > 0 && /^\([^)]+\)/.test(trimmed)) {
      const base = /^\d+(?:\.\d+)?/.exec(parts[0])?.[0] ?? currentSection;
      return base ? `${prefix} ${base}${trimmed}` : `${prefix} ${trimmed}`;
    }
    return withBare(`${prefix} ${trimmed}`);
  });
};

const collectLegalReferences = (text: string, currentSection?: string): string[] =>
  Array.from(new Set(Array.from(text.matchAll(legalReferencePattern)).flatMap((match) =>
    normalizeLegalReference(match[0], currentSection),
  )));

const collectRiskTokens = (text: string): string[] =>
  Array.from(new Set([
    ...collectLegalReferences(text),
    ...Array.from(text.matchAll(quantityPattern)).map((match) => normalizeText(match[0])),
  ]));

const collectRiskTokensForSource = (text: string, sourceKey: string): string[] =>
  Array.from(new Set([...collectLegalReferences(text, sourceSectionFromKey(sourceKey)), ...collectRiskTokens(text)]));

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

const isAlphanumeric = (value: string | undefined): boolean => Boolean(value && /[A-Za-z0-9]/.test(value));

const sourceTextsForObjective = (
  objective: AiLearningObjective,
  sourceComponents: ImportedLegalComponent[],
): string[] =>
  objective.sourceKeys.map((sourceKey) => sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '');

const addTruncationIssue = (
  issues: AiValidationIssue[],
  proposal: AiStudyUnitProposal,
  objective: AiLearningObjective,
  text: string,
  sourceText: string,
  field: 'answer' | 'evidence',
  trigger: string,
): void => {
  addIssue(issues, {
    code: 'ANSWER_APPEARS_TRUNCATED',
    severity: 'warning',
    proposalId: proposal.proposalId,
    objectiveId: objective.id,
    guidedQuestion: objective.guidedQuestion,
    answerFragment: text,
    sourceFragment: sourceText.slice(0, 300),
    trigger: `${field}:${trigger}`,
    message: `Objective ${objective.id} ${field} appears truncated for question "${objective.guidedQuestion}".`,
  });
};

const validateTruncation = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const candidates = [
    { field: 'answer' as const, text: objective.studyAnswer },
    ...objective.evidence.map((evidence) => ({ field: 'evidence' as const, text: evidence.evidenceText })),
  ];
  const sourceTexts = sourceTextsForObjective(objective, sourceComponents);
  candidates.forEach(({ field, text }) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/[.。…]{3,}\s*$/.test(trimmed)) {
      addTruncationIssue(issues, proposal, objective, trimmed, sourceTexts.join('\n\n'), field, 'literal-ellipsis');
    }
    if (/^[a-z]\w*\b/.test(trimmed) && !/^(a|an|and|as|at|by|for|if|in|of|on|or|the|to|with)\b/i.test(trimmed)) {
      addTruncationIssue(issues, proposal, objective, trimmed, sourceTexts.join('\n\n'), field, 'suspicious-lowercase-start');
    }
    if (/[A-Za-z,;:]$/.test(trimmed) && !/\b(Act|Regulation|Registrar General|Director of Surveys|Board|Minister|Council)$/.test(trimmed)) {
      addTruncationIssue(issues, proposal, objective, trimmed, sourceTexts.join('\n\n'), field, 'suspicious-ending');
    }
    sourceTexts.forEach((sourceText) => {
      const index = sourceText.indexOf(trimmed);
      if (index < 0) return;
      if (isAlphanumeric(sourceText[index - 1]) && isAlphanumeric(trimmed[0])) {
        addTruncationIssue(issues, proposal, objective, trimmed, sourceText, field, 'mid-token-start');
      }
      const after = sourceText[index + trimmed.length];
      if (isAlphanumeric(after) && isAlphanumeric(trimmed.at(-1))) {
        addTruncationIssue(issues, proposal, objective, trimmed, sourceText, field, 'mid-token-end');
      }
    });
  });
  if (/[.。…]{3,}/.test(proposal.studySummary) && objective.studyAnswer.includes('...')) {
    addTruncationIssue(issues, proposal, objective, proposal.studySummary, sourceTexts.join('\n\n'), 'answer', 'summary-built-from-truncated-answer');
  }
};

const definitionTermsForObjective = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
): string[] => {
  const focusTerms = proposal.approvedGroup?.focusSelections.flatMap((selection) => selection.definedTerms ?? []) ?? [];
  const haystack = normalizeText(`${objective.objective} ${objective.guidedQuestion}`);
  return focusTerms.filter((term) => haystack.includes(normalizeText(term)));
};

const validateDefinitionResponsiveness = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  if (objective.type !== 'definition' && definitionTermsForObjective(objective, proposal).length === 0) return;
  const answer = normalizeText(objective.studyAnswer);
  const terms = definitionTermsForObjective(objective, proposal);
  const preambleOnly = /\bdefinitions?\b.+\bthe following definitions apply\b/.test(answer) && !/\bmeans\b|\bincludes\b/.test(answer);
  const missingFocusedTerm = terms.length > 0 && terms.every((term) => !answer.includes(normalizeText(term)));
  const sourceHasMeaning = sourceTextsForObjective(objective, sourceComponents).some((sourceText) =>
    terms.some((term) => new RegExp(`["“]?${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["”]?\\s+(?:means|includes)`, 'i').test(sourceText)),
  );
  if (preambleOnly || (sourceHasMeaning && missingFocusedTerm)) {
    addIssue(issues, {
      code: 'DEFINITION_ANSWER_MISSING_TERM_MEANING',
      severity: 'warning',
      proposalId: proposal.proposalId,
      objectiveId: objective.id,
      guidedQuestion: objective.guidedQuestion,
      answerFragment: objective.studyAnswer,
      sourceFragment: sourceTextsForObjective(objective, sourceComponents).join('\n\n').slice(0, 300),
      trigger: terms.join(', ') || 'definition',
      message: `Objective ${objective.id} definition answer does not state the term-specific meaning for question "${objective.guidedQuestion}".`,
    });
  }
};

const validateDuplicateAnswers = (
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
): void => {
  const answers = new Map<string, AiLearningObjective[]>();
  proposal.objectives.forEach((objective) => {
    const key = normalizeText(objective.studyAnswer);
    if (!key) return;
    answers.set(key, [...(answers.get(key) ?? []), objective]);
  });
  answers.forEach((objectives) => {
    const distinctQuestions = new Set(objectives.map((objective) => normalizeText(objective.guidedQuestion)));
    if (objectives.length > 1 && distinctQuestions.size > 1) {
      objectives.forEach((objective) => {
        addIssue(issues, {
          code: 'DUPLICATE_NONRESPONSIVE_ANSWER',
          severity: 'warning',
          proposalId: proposal.proposalId,
          objectiveId: objective.id,
          guidedQuestion: objective.guidedQuestion,
          answerFragment: objective.studyAnswer,
          message: `Objective ${objective.id} repeats the same study answer used for a distinct question.`,
        });
      });
    }
  });
};

const validateObjectiveFidelity = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const evidenceText = objective.evidence.map((evidence) => evidence.evidenceText).join(' ');
  const approvedFocusText = approvedFocusTextForObjective(objective, proposal, sourceComponents);
  const sourceTokenSet = riskTokensForFocus(objective, proposal, sourceComponents);
  collectRiskTokens(objective.studyAnswer).forEach((token) => {
    if (!sourceTokenSet.has(token)) {
      addIssue(issues, {
        code: 'UNSUPPORTED_NUMERIC_OR_REFERENCE',
        severity: 'warning',
        proposalId: proposal.proposalId,
        objectiveId: objective.id,
        guidedQuestion: objective.guidedQuestion,
        answerFragment: objective.studyAnswer,
        sourceFragment: approvedFocusText.slice(0, 300),
        trigger: token,
        message: `Objective ${objective.id} answer includes unsupported numeric or legal-reference token "${token}" for question "${objective.guidedQuestion}".`,
      });
    }
  });
  const answerModalities = modalityTokens(objective.studyAnswer);
  const focusModalities = modalityTokens(approvedFocusText);
  if (
    (answerModalities.has('duty') && focusModalities.has('permission') && !focusModalities.has('duty')) ||
    (answerModalities.has('permission') && focusModalities.has('duty') && !focusModalities.has('permission') && !focusModalities.has('prohibition')) ||
    (focusModalities.has('prohibition') && answerModalities.has('permission') && !answerModalities.has('prohibition') && !focusModalities.has('permission'))
  ) {
    addIssue(issues, {
      code: 'POSSIBLE_MODALITY_MISMATCH',
      severity: 'warning',
      proposalId: proposal.proposalId,
      objectiveId: objective.id,
      guidedQuestion: objective.guidedQuestion,
      answerFragment: objective.studyAnswer,
      sourceFragment: approvedFocusText.slice(0, 300),
      trigger: `answer=${Array.from(answerModalities).join(',')}; source=${Array.from(focusModalities).join(',')}`,
      message: `Objective ${objective.id} may change legal modality for question "${objective.guidedQuestion}".`,
    });
  }
  const answerActors = extractLikelyActors(objective.studyAnswer);
  const focusActors = extractLikelyActors(approvedFocusText);
  if (
    answerActors.length > 0 &&
    focusActors.length > 0 &&
    answerActors.some((actor) => !focusActors.includes(actor))
  ) {
    const trigger = answerActors.find((actor) => !focusActors.includes(actor));
    addIssue(issues, {
      code: 'POSSIBLE_ACTOR_MISMATCH',
      severity: 'warning',
      proposalId: proposal.proposalId,
      objectiveId: objective.id,
      guidedQuestion: objective.guidedQuestion,
      answerFragment: objective.studyAnswer,
      sourceFragment: approvedFocusText.slice(0, 300),
      trigger,
      message: `Objective ${objective.id} answer names actor "${trigger}" not found in the approved focus for question "${objective.guidedQuestion}".`,
    });
  }
  const focusTerms = new Set(significantTerms(approvedFocusText));
  const evidenceTerms = new Set(significantTerms(evidenceText));
  const answerTerms = significantTerms(objective.studyAnswer);
  const unsupportedByFocus = answerTerms.filter((term) => !focusTerms.has(term));
  const unsupportedByEvidence = answerTerms.filter((term) => !evidenceTerms.has(term));
  if (unsupportedByFocus.length >= 3) {
    addIssue(issues, {
      code: 'ANSWER_EXTENDS_BEYOND_EVIDENCE',
      severity: 'warning',
      proposalId: proposal.proposalId,
      objectiveId: objective.id,
      guidedQuestion: objective.guidedQuestion,
      answerFragment: objective.studyAnswer,
      sourceFragment: approvedFocusText.slice(0, 300),
      trigger: unsupportedByFocus.slice(0, 8).join(', '),
      message: `Objective ${objective.id} answer may include claims not supported by the approved focus for question "${objective.guidedQuestion}".`,
    });
  } else if (unsupportedByEvidence.length >= 3) {
    addIssue(issues, {
      code: 'EVIDENCE_INCOMPLETE_FOR_ANSWER',
      severity: 'warning',
      proposalId: proposal.proposalId,
      objectiveId: objective.id,
      guidedQuestion: objective.guidedQuestion,
      answerFragment: objective.studyAnswer,
      sourceFragment: evidenceText.slice(0, 300),
      trigger: unsupportedByEvidence.slice(0, 8).join(', '),
      message: `Objective ${objective.id} evidence does not demonstrate important answer terms for question "${objective.guidedQuestion}".`,
    });
  }
  validateTruncation(objective, proposal, sourceComponents, issues);
  validateDefinitionResponsiveness(objective, proposal, sourceComponents, issues);
};

const validateCoverage = (
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const coverage = proposal.sourceCoverage ?? [];
  const coverageByKey = new Map(coverage.map((entry) => [entry.sourceKey, entry]));
  const approvedLabelsBySource = new Map(
    (proposal.approvedGroup?.focusSelections ?? []).map((selection) => [
      selection.sourceKey,
      new Set(selection.childLabels ?? []),
    ]),
  );
  sourceComponents.forEach((component) => {
    const approvedLabels = approvedLabelsBySource.get(component.sourceKey);
    const labels = component.subsections
      ?.map((subsection) => subsection.label)
      .filter((label) => !approvedLabels || approvedLabels.has(label)) ?? [];
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

const childLabelSourceText = (
  sourceComponents: ImportedLegalComponent[],
  sourceKey: string,
  label: string,
): string | undefined => {
  const component = sourceComponents.find((entry) => entry.sourceKey === sourceKey);
  if (!component) return undefined;
  const subsection = component.subsections?.find((entry) => entry.label === label);
  return subsection?.text ?? (component.label === label ? component.text : undefined);
};

const focusTextForSource = (
  sourceComponents: ImportedLegalComponent[],
  approvedGroup: AiProposedSourceGroup,
  sourceKey: string,
): string => {
  const component = sourceComponents.find((entry) => entry.sourceKey === sourceKey);
  if (!component) return '';
  const selections = approvedGroup.focusSelections.filter((selection) => selection.sourceKey === sourceKey);
  const childTexts = selections.flatMap((selection) =>
    (selection.childLabels ?? [])
      .map((label) => childLabelSourceText(sourceComponents, sourceKey, label))
      .filter((text): text is string => Boolean(text)),
  );
  return childTexts.length > 0 ? childTexts.join('\n\n') : component.text;
};

const approvedFocusTextForObjective = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
): string => {
  if (!proposal.approvedGroup) {
    return objective.sourceKeys
      .map((sourceKey) => sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '')
      .join('\n\n');
  }
  return objective.sourceKeys
    .map((sourceKey) => focusTextForSource(sourceComponents, proposal.approvedGroup as AiProposedSourceGroup, sourceKey))
    .join('\n\n');
};

const riskTokensForFocus = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
): Set<string> =>
  new Set(
    objective.sourceKeys.flatMap((sourceKey) => {
      const focusText = proposal.approvedGroup
        ? focusTextForSource(sourceComponents, proposal.approvedGroup, sourceKey)
        : sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '';
      const labels = proposal.approvedGroup?.focusSelections
        .filter((selection) => selection.sourceKey === sourceKey)
        .flatMap((selection) => selection.childLabels ?? []) ?? [];
      const sectionReference = sourceSectionFromKey(sourceKey);
      return [
        ...collectRiskTokensForSource(focusText, sourceKey),
        ...(sectionReference ? [`section ${sectionReference}`] : []),
        ...labels.flatMap((label) => normalizeLegalReference(`subsection ${label}`, sourceSectionFromKey(sourceKey))),
      ];
    }),
  );

const evidenceWithinApprovedFocus = (
  evidenceText: string,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
): boolean => {
  if (!proposal.approvedGroup) return true;
  return normalizeText(focusTextForSource(sourceComponents, proposal.approvedGroup, proposal.sourceKeys[0] ?? '')).includes(
    normalizeText(evidenceText),
  ) || proposal.sourceKeys.some((sourceKey) =>
    normalizeText(focusTextForSource(sourceComponents, proposal.approvedGroup as AiProposedSourceGroup, sourceKey)).includes(
      normalizeText(evidenceText),
    ),
  );
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
  if (!Array.isArray(proposal.objectives)) return;
  proposal.objectives.forEach((objective) => {
    if (objective.sourceKeys.some((sourceKey) => !approvedGroup.sourceKeys.includes(sourceKey))) {
      addIssue(issues, {
        code: 'OUTSIDE_APPROVED_FOCUS',
        proposalId: proposal.proposalId,
        message: 'Objective sourceKeys must stay inside the approved authoring group.',
      });
    }
    objective.evidence.forEach((evidence) => {
      if (!approvedGroup.sourceKeys.includes(evidence.sourceKey)) {
        addIssue(issues, {
          code: 'UNIT_CONTEXT_LEAKAGE',
          proposalId: proposal.proposalId,
          sourceKey: evidence.sourceKey,
          message: 'Evidence sourceKey is context-only and not part of the approved group.',
        });
      }
    });
  });
};

const validateApprovedFocusCoverage = (
  proposal: AiStudyUnitProposal,
  approvedGroup: AiProposedSourceGroup | undefined,
  issues: AiValidationIssue[],
): void => {
  if (!approvedGroup) return;
  const coveredLabels = new Set(
    (proposal.sourceCoverage ?? []).flatMap((entry) =>
      (entry.childLabels ?? [])
        .filter((child) => child.status === 'covered')
        .flatMap((child) => child.objectiveIds?.map((id) => `${entry.sourceKey}::${child.label}::${id}`) ?? [`${entry.sourceKey}::${child.label}`]),
    ),
  );
  const omittedLabels = new Set(
    (proposal.sourceCoverage ?? []).flatMap((entry) =>
      (entry.childLabels ?? [])
        .filter((child) => child.status === 'intentionally-omitted' && child.reason?.trim())
        .map((child) => `${entry.sourceKey}::${child.label}`),
    ),
  );
  if (!Array.isArray(proposal.objectives)) return;
  approvedGroup.focusSelections.forEach((selection) => {
    selection.childLabels?.forEach((label) => {
      const prefix = `${selection.sourceKey}::${label}`;
      const covered = Array.from(coveredLabels).some((entry) => entry.startsWith(prefix));
      if (!covered && !omittedLabels.has(prefix)) {
        addIssue(issues, {
          code: 'APPROVED_FOCUS_NOT_COVERED',
          severity: 'warning',
          proposalId: proposal.proposalId,
          sourceKey: selection.sourceKey,
          message: `Approved focus item is not covered or intentionally omitted: ${label}.`,
        });
      }
    });
    selection.definedTerms?.forEach((term) => {
      const termText = normalizeText(term);
      const covered = proposal.objectives.some((objective) =>
        normalizeText(`${objective.objective} ${objective.guidedQuestion} ${objective.studyAnswer}`).includes(termText),
      );
      if (!covered) {
        addIssue(issues, {
          code: 'APPROVED_FOCUS_NOT_COVERED',
          severity: 'warning',
          proposalId: proposal.proposalId,
          sourceKey: selection.sourceKey,
          message: `Approved defined term is not covered: ${term}.`,
        });
      }
    });
  });
};

const validateMapRevisionSuggestion = (
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  if (!proposal.warnings?.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT')) return;
  if (proposal.generationMetadata.promptSpecVersion !== 'unit-authoring-v4') return;
  if (proposal.authoringStatus !== 'needs-map-revision') {
    addIssue(issues, {
      code: 'BROAD_GROUP_MUST_NEED_MAP_REVISION',
      severity: 'warning',
      proposalId: proposal.proposalId,
      message: 'A broad-group Unit proposal should be marked authoringStatus needs-map-revision.',
    });
  }
  const suggestion = proposal.mapRevisionSuggestion;
  if (!suggestion || !nonEmptyString(suggestion.reason) || !Array.isArray(suggestion.proposedGroups) || suggestion.proposedGroups.length < 2) {
    addIssue(issues, {
      code: 'MAP_REVISION_SUGGESTION_REQUIRED',
      proposalId: proposal.proposalId,
      message: 'MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT requires a mapRevisionSuggestion with at least two finer proposed groups.',
    });
    return;
  }
  suggestion.proposedGroups.forEach((group) => {
    if (!nonEmptyString(group.title) || !stringArray(group.sourceKeys) || group.sourceKeys.length === 0 || !Array.isArray(group.focusSelections) || !nonEmptyString(group.approximateLearningGoal)) {
      addIssue(issues, {
        code: 'MAP_REVISION_GROUP_INVALID',
        proposalId: proposal.proposalId,
        message: 'Each mapRevisionSuggestion group requires title, sourceKeys, focusSelections, and approximateLearningGoal.',
      });
      return;
    }
    if (group.sourceKeys.some((sourceKey) => !proposal.sourceKeys.includes(sourceKey))) {
      addIssue(issues, {
        code: 'MAP_REVISION_OUTSIDE_SOURCE',
        proposalId: proposal.proposalId,
        message: 'mapRevisionSuggestion groups must stay inside the original approved sourceKeys.',
      });
    }
    const groupText = normalizeText(`${group.title} ${group.approximateLearningGoal}`);
    const approvedText = normalizeText(
      group.sourceKeys
        .map((sourceKey) => sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '')
        .join('\n\n'),
    );
    if (/\bretroactive\b|\bretroactivity\b/.test(groupText) && !/\bretroactive\b|\bretroactivity\b/.test(approvedText)) {
      addIssue(issues, {
        code: 'MAP_REVISION_UNSUPPORTED_CONCEPT',
        proposalId: proposal.proposalId,
        message: 'mapRevisionSuggestion introduces an unsupported retroactive-effect concept.',
      });
    }
  });
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
  validateMapRevisionSuggestion(typed, sourceComponents, issues);
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
      if (!evidenceWithinApprovedFocus(evidence.evidenceText, typed, sourceComponents)) {
        addIssue(issues, {
          code: 'OUTSIDE_APPROVED_FOCUS',
          proposalId: typed.proposalId,
          sourceKey: evidence.sourceKey,
          message: 'Evidence text is not within the approved focus for this source.',
        });
      }
    });
    validateObjectiveFidelity(objective, typed, sourceComponents, issues);
  });
  validateCoverage(typed, sourceComponents, issues);
  validateApprovedFocusCoverage(typed, typed.approvedGroup, issues);
  validateQuestionQuality(typed, issues);
  validateDuplicateAnswers(typed, issues);
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
