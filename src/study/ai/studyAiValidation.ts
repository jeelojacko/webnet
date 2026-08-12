import type { ImportedLegalComponent } from '../studyTypes';
import type {
  AiLearningObjective,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
  AiStudyUnitProposal,
  AiValidationIssue,
  AiValidationReport,
} from './studyAiTypes';

const DISPOSITIONS = new Set(['standalone', 'combine', 'split', 'reference-only', 'skip', 'needs-human-review']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
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

const addIssue = (
  issues: AiValidationIssue[],
  issue: Omit<AiValidationIssue, 'severity'> & { severity?: AiValidationIssue['severity'] },
): void => {
  issues.push({ severity: issue.severity ?? 'error', ...issue });
};

export const validateAiStudyMapJob = (value: unknown): AiValidationReport => {
  const issues: AiValidationIssue[] = [];
  if (!isRecord(value)) return { valid: false, issues: [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Job must be an object.' }] };
  if (value.schemaVersion !== 1) addIssue(issues, { code: 'SCHEMA_VERSION', message: 'Study Map job schemaVersion must be 1.' });
  if (!nonEmptyString(value.jobId)) addIssue(issues, { code: 'JOB_ID_REQUIRED', message: 'jobId is required.' });
  if (!nonEmptyString(value.runId)) addIssue(issues, { code: 'RUN_ID_REQUIRED', message: 'runId is required.' });
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
  if (!Array.isArray(value.proposedGroups)) addIssue(issues, { code: 'GROUPS_REQUIRED', jobId, message: 'proposedGroups must be an array.' });
  if (!Array.isArray(value.warnings)) addIssue(issues, { code: 'WARNINGS_REQUIRED', jobId, message: 'warnings must be an array.' });
  if (job) {
    if (value.jobId !== job.jobId) addIssue(issues, { code: 'JOB_MISMATCH', jobId, message: 'Result jobId does not match the job.' });
    if (value.runId !== job.runId) addIssue(issues, { code: 'RUN_MISMATCH', jobId, message: 'Result runId does not match the job.' });
    if (value.corpusContentHash !== job.corpusContentHash) addIssue(issues, { code: 'STALE_PROPOSAL', jobId, message: 'Result corpusContentHash does not match the job.' });
    if (value.inputHash && value.inputHash !== job.inputHash) addIssue(issues, { code: 'INPUT_HASH_MISMATCH', jobId, message: 'Result inputHash does not match the job.' });
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
  });
  validateQuestionQuality(typed, issues);
  return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
};

export const reconcileAiStudyMapProposals = (
  proposals: AiStudyMapProposal[],
): AiStudyMapProposal[] => {
  const coverage = new Map<string, string[]>();
  proposals.forEach((proposal) => {
    proposal.proposedGroups.forEach((group) => {
      group.sourceKeys.forEach((sourceKey) => {
        const key = `${proposal.document.documentId}::${sourceKey}`;
        coverage.set(key, [...(coverage.get(key) ?? []), `${proposal.id}/${group.groupId}`]);
      });
    });
  });
  return proposals.map((proposal) => {
    const conflictCodes = new Set(proposal.conflictCodes);
    proposal.proposedGroups.forEach((group) => {
      group.sourceKeys.forEach((sourceKey) => {
        const key = `${proposal.document.documentId}::${sourceKey}`;
        if ((coverage.get(key)?.length ?? 0) > 1) conflictCodes.add('MAP_CONFLICT');
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
  disposition: result.disposition,
  confidence: result.confidence,
  reason: result.reason,
  suggestedPriority: result.suggestedPriority,
  proposedGroups: result.proposedGroups,
  warnings: result.warnings,
  conflictCodes: [],
  reviewStatus: 'generated',
  validationStatus: 'valid',
  validationMessages: [],
  createdAt,
  updatedAt: createdAt,
});
