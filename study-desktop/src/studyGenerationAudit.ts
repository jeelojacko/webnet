import type { NbLawContentPackage } from './content/nbLawTypes';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateStudyQuestion,
  generateStudyTitle,
} from './studyDraftGeneration';
import { generateRequiredConcepts } from './studyConceptGeneration';
import {
  classifyStudyRubricSectionTopic,
  generateStudyRubricWithDiagnostics,
  type ExtractedLegalFact,
  type LegalModality,
} from './studyRubricGeneration';
import {
  estimateRubricFacts,
  headingQuestionTokenOverlap,
  hasTierASurfaceQualityFailure,
  normalizeGeneratedQuestionText,
  questionHasUnsupportedTopic,
  strongHeadingTopicMismatch,
  suggestStudyChunks,
  type StudyQuestionTier,
  type SuggestedStudyChunk,
} from './studyQuestionSupport';
import { toImportedLegalComponents, toImportedLegalDocuments } from './studyOfficialContent';
import { prepareLegalText } from './studyLegalTextPreparation';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyRubricCategory,
} from './studyTypes';

export const STUDY_GENERATION_AUDIT_SCHEMA_VERSION = 1;
export const STUDY_GENERATION_AUDIT_GENERATOR_VERSION = 'study-deterministic-v1';

export type StudyGenerationWarningSeverity = 'info' | 'warning' | 'critical';

export type StudyGenerationWarning = {
  code: string;
  severity: StudyGenerationWarningSeverity;
  explanation: string;
  field: string;
  text: string;
};

export type StudyGenerationAuditSection = {
  documentId: string;
  documentTitle: string;
  documentCitation: string;
  sourceKey: string;
  sectionLabel: string;
  sectionHeading?: string;
  sourceText: string;
  detectedTopic?: string;
  generated: {
    title: string;
    mainQuestion: string;
    mainQuestionTier: StudyQuestionTier;
    referenceAnswer: string;
    rubricItems: Array<{
      id: string;
      category: StudyRubricCategory;
      prompt: string;
      questionTier: StudyQuestionTier;
      referenceAnswer: string;
      sourceKeys: string[];
      generatedFromFacts?: unknown[];
    }>;
    concepts: Array<{
      label: string;
      reason?: string;
      confidence?: string;
    }>;
  };
  diagnostics: {
    extractedFacts?: unknown[];
    questionTemplate?: string;
    suggestedChunks?: SuggestedStudyChunk[];
    rejectedRubricItems?: unknown[];
    removedAmendmentHistory?: string[];
    removedConsolidationText?: string[];
    tierAQualityDowngrades?: string[];
    semanticQualityDowngrades?: string[];
  };
  quality: {
    score: number;
    warnings: StudyGenerationWarning[];
  };
};

export type StudyGenerationAuditDocument = {
  documentId: string;
  documentTitle: string;
  documentCitation: string;
  sections: StudyGenerationAuditSection[];
};

export type StudyGenerationAuditSummary = {
  totalSections: number;
  totalRubricItems: number;
  sectionsWithNoWarnings: number;
  sectionsWithWarnings: number;
  warningsByType: Record<string, number>;
  warningsByDocument: Record<string, number>;
  averageQaScore: number;
  questionTierCounts: Record<StudyQuestionTier, number>;
  sectionsWithChunkSuggestions: number;
  suggestedChunkCount: number;
  uniqueSuggestedChunkCount: number;
  tierAQualityDowngradeCount: number;
  semanticQualityDowngradeCount: number;
  genuineTopicMismatchCount: number;
  actorMismatchCount: number;
  modalityMismatchCount: number;
  clauseBindingAmbiguousCount: number;
  chunkGranularityLimitedSections: number;
  chunkPlanningFailedSections: number;
  averageEstimatedRubricItemsPerChunk: number;
  lowestScoringSections: Array<{
    documentId: string;
    documentTitle: string;
    sectionLabel: string;
    sectionHeading?: string;
    score: number;
    warnings: string[];
  }>;
};

export type StudyGenerationAudit = {
  schemaVersion: 1;
  createdAt: string;
  contentPackageId: string;
  generatorVersion: string;
  summary: StudyGenerationAuditSummary;
  documents: StudyGenerationAuditDocument[];
};

export type StudyGenerationAuditOptions = {
  documentId?: string;
  sectionLabel?: string;
  includeSchedules?: boolean;
  includeForms?: boolean;
  createdAt?: string;
};

export type StudyGenerationBaselineDiff = {
  sectionKey: string;
  documentTitle: string;
  sectionLabel: string;
  beforeMainQuestion: string;
  afterMainQuestion: string;
  beforeRubricPrompts: string[];
  afterRubricPrompts: string[];
  warningsRemoved: string[];
  warningsAdded: string[];
  beforeScore: number;
  afterScore: number;
};

const QUESTION_TOO_LONG_THRESHOLD = 160;
const RUBRIC_ANSWER_TOO_LONG_THRESHOLD = 700;
const TOO_MANY_RUBRIC_ITEMS_THRESHOLD = 10;

const severityRank: Record<StudyGenerationWarningSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const componentRecordKey = (component: Pick<ImportedLegalComponent, 'documentId' | 'sourceKey'>): string =>
  `${component.documentId}::${component.sourceKey}`;

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizePromptKey = (value: string): string =>
  normalizeSpaces(value)
    .toLowerCase()
    .replace(/\bsection\s+\d+(?:\.\d+)?(?:\([^)]+\))?\b/g, 'section #')
    .replace(/\b\d+(?:\.\d+)?(?:\([^)]+\))?\b/g, '#')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();

const sectionSortKey = (value: string): Array<number | string> =>
  value
    .toLowerCase()
    .split(/(\d+(?:\.\d+)?)/)
    .filter(Boolean)
    .map((part) => (/^\d+(?:\.\d+)?$/.test(part) ? Number(part) : part));

const compareLabels = (left: string, right: string): number => {
  const a = sectionSortKey(left);
  const b = sectionSortKey(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index];
    const rightPart = b[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (typeof leftPart === 'number' && typeof rightPart === 'number' && leftPart !== rightPart) {
      return leftPart - rightPart;
    }
    const compared = String(leftPart).localeCompare(String(rightPart));
    if (compared !== 0) return compared;
  }
  return 0;
};

const isIncludedComponent = (component: ImportedLegalComponent, options: StudyGenerationAuditOptions): boolean => {
  if (options.sectionLabel && component.label !== options.sectionLabel) return false;
  if (component.componentType === 'section') return true;
  if (component.componentType === 'schedule') return Boolean(options.includeSchedules);
  if (component.componentType === 'form') return Boolean(options.includeForms);
  return false;
};

const warning = (
  code: string,
  severity: StudyGenerationWarningSeverity,
  field: string,
  text: string,
  explanation: string,
): StudyGenerationWarning => ({
  code,
  severity,
  field,
  text: normalizeSpaces(text),
  explanation,
});

const hasUnbalancedPairs = (text: string): boolean => {
  const pairs: Array<[string, string]> = [['(', ')'], ['"', '"']];
  return pairs.some(([open, close]) => {
    const openCount = [...text].filter((char) => char === open).length;
    const closeCount = [...text].filter((char) => char === close).length;
    return openCount !== closeCount;
  });
};

const hasMalformedQuestionText = (question: string): boolean => {
  const compact = normalizeSpaces(question);
  if (!compact.endsWith('?')) return true;
  if (hasUnbalancedPairs(compact)) return true;
  if (/\b(?:alth|th)\?$/i.test(compact) || (/\b[A-Z][a-z]{1,2}\?$/.test(compact) && !/\bAct\?$/.test(compact))) {
    return true;
  }
  if (/\b(?:if|to|the|by|of|from|with|and|or|not)\s*\?$/i.test(compact)) return true;
  if (/\(\s*\?/.test(compact)) return true;
  if (/\s+[,.!?]|[,:;]\s*\?|\?\?/.test(compact)) return true;
  return false;
};

const hasDuplicatedConnectorWord = (question: string): boolean =>
  normalizeGeneratedQuestionText(question) !== normalizeSpaces(question);

const hasInanimateActorQuestion = (question: string): boolean =>
  /\bWhat\s+(?:must|may)\s+(?:an?\s+)?(?:instrument|plan|document|application|certificate|notice|record|deed|transfer|mortgage|registration|by-law)\s+do\?/i.test(question);

const trailingStructuralHeadingLeak = (source: ImportedLegalComponent, text: string): string | undefined => {
  const heading = prepareLegalText(source.text).trailingStructuralHeadingText;
  if (!heading) return undefined;
  return normalizeSpaces(text).includes(normalizeSpaces(heading)) ? heading : undefined;
};

const hasMissingSubject = (prompt: string): boolean =>
  /\b(?:it|this|that)\?$/i.test(prompt) ||
  /\b(?:applies to|required for|establishes for)\s*\?$/i.test(prompt);

const isGenericRubricPrompt = (prompt: string): boolean =>
  /^What specific rule applies to\b/i.test(prompt) ||
  /^What procedure does section\b/i.test(prompt) ||
  /^What power or duty does section\b/i.test(prompt);

const hasSpecificFact = (facts: ExtractedLegalFact[]): boolean =>
  facts.some((fact) => fact.confidence !== 'low' && Boolean(fact.actor || fact.action || fact.object || fact.trigger || fact.filingEffect));

const hasTopicMismatch = (section: ImportedLegalComponent, detectedTopic: string, mainQuestion: string): boolean => {
  const heading = normalizeSpaces(section.heading ?? '').toLowerCase();
  const question = mainQuestion.toLowerCase();
  if (!heading) return false;
  if (headingQuestionTokenOverlap(heading, mainQuestion) >= 0.5) return false;
  if (/validity and coming into force|orders? of .*cabinet|order/.test(heading) && /validity|coming into force|order-making|orders?/.test(question)) {
    return false;
  }
  if (/objection/.test(heading)) return /notice/.test(question) && !/objection|hearing/.test(question);
  if (/subdivision plan/.test(heading)) return /definitions?/.test(question);
  if (/approval/.test(heading)) return /certification/.test(question) && !/approval/.test(question);
  if (/effect/.test(heading)) return /application requirements/.test(question);
  if (/fil(?:e|ing)|record|register|coordinate monument/.test(heading)) {
    return /powers? or authority|procedure/.test(question) && !/fil(?:e|ing)|record|register|coordinate monument/.test(question);
  }
  if (/offences?|penalt/.test(heading)) {
    return /procedure|filing|requirements/.test(question) && !/offences?|penalt/.test(question);
  }
  if (detectedTopic === 'notice') return !/notice/.test(question);
  if (detectedTopic === 'filing') return !/fil(?:e|ing)|record|register/.test(question);
  return false;
};

const chunkSignature = (chunk: SuggestedStudyChunk): string => chunk.sourceKeys.join('|');

const auditChunkSignature = (section: StudyGenerationAuditSection, chunk: SuggestedStudyChunk): string =>
  `${section.documentId}::${section.sourceKey}::${chunkSignature(chunk)}`;

const collectChunkWarnings = (chunks: SuggestedStudyChunk[]): StudyGenerationWarning[] => {
  const warnings: StudyGenerationWarning[] = [];
  const signatures = new Map<string, number>();
  for (const chunk of chunks) {
    const signature = chunkSignature(chunk);
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    if (new Set(chunk.sourceKeys).size !== chunk.sourceKeys.length) {
      warnings.push(warning('CHUNK_SOURCE_OVERLAP', 'warning', 'diagnostics.suggestedChunks.sourceKeys', chunk.title, 'A suggested study chunk repeats a sourceKey inside the same chunk.'));
    }
    if (chunk.estimatedRubricItems === 0) {
      warnings.push(warning('CHUNK_ESTIMATE_ZERO', 'warning', 'diagnostics.suggestedChunks.estimatedRubricItems', chunk.title, 'A suggested study chunk has a zero rubric-item estimate.'));
    }
  }
  for (const [signature, count] of signatures) {
    if (count > 1) {
      warnings.push(warning('DUPLICATE_CHUNK_SUGGESTION', 'warning', 'diagnostics.suggestedChunks.sourceKeys', signature, 'Two or more suggested chunks cover the same sourceKeys.'));
    }
  }
  return warnings;
};

const amendmentHistoryPattern =
  /(?:^|\n)\s*(?:R\.S\.|R\.S\.,|S\.N\.B\.|O\.C\.|(?:19|20)\d{2},\s*c\.|(?:19|20)\d{2}\s+\([^)]+\),\s*c\.|\d{2,4}-\d{1,3}(?:\s*;\s*\d{2,4}-\d{1,3})+)/i;

const sourceCopyFragment = (question: string, sourceText: string): boolean => {
  const words = normalizeSpaces(question.replace(/[?]/g, '')).toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  if (words.length < 16) return false;
  const source = normalizeSpaces(sourceText).toLowerCase();
  for (let index = 0; index <= words.length - 10; index += 1) {
    if (source.includes(words.slice(index, index + 10).join(' '))) return true;
  }
  return false;
};

const isSubstantive = (component: ImportedLegalComponent): boolean =>
  component.extractionStatus !== 'reference-only' && !/^\s*(?:[\w().\s-]+)?Repealed\.?\s*$/i.test(component.text);

const sourceTextByKey = (component: ImportedLegalComponent): Map<string, string> => {
  const entries: Array<[string, string]> = [[component.sourceKey, component.text]];
  for (const subsection of component.subsections ?? []) entries.push([subsection.sourceKey, subsection.text]);
  return new Map(entries);
};

const normalizedTokens = (value: string): string[] =>
  normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !['section', 'subsection', 'under', 'this', 'that', 'with', 'from', 'must', 'shall', 'person'].includes(token));

const hasSourceOverlap = (answer: string, sourceText: string): boolean => {
  const answerTokens = [...new Set(normalizedTokens(answer))];
  if (answerTokens.length < 3) return true;
  const sourceTokens = new Set(normalizedTokens(sourceText));
  const overlap = answerTokens.filter((token) => sourceTokens.has(token)).length;
  return overlap >= 2 && overlap / answerTokens.length >= 0.35;
};

const isStudyNoteRubric = (item: { category: StudyRubricCategory; referenceAnswer: string }): boolean =>
  item.category === 'survey-relevance' && /^Study note:/i.test(item.referenceAnswer);

const isConceptFragment = (label: string): boolean => {
  const words = normalizeSpaces(label).split(/\s+/);
  if (words.length < 4) return false;
  if (/\b(?:under|pursuant|if|when|where|unless|subsection|paragraph|section)\b$/i.test(label)) return true;
  if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){3,}$/.test(label) && !/\b(?:and|of|for|to|in|on|under)\b/i.test(label)) return true;
  return false;
};

const normalizeActorForComparison = (value: string): string =>
  normalizeSpaces(value)
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const inferQuestionModality = (question: string): LegalModality => {
  if (/\bprohibit|prohibited|must .+ not |shall .+ not |may .+ not |not accept\b/i.test(question)) return 'shall-not';
  if (/^When may (?:an?\s+)?(?:instrument|plan|document|application|certificate|notice|record|deed|transfer|mortgage|registration|by-law)\s+be\s+(?:received|accepted|filed|registered)\b/i.test(question)) return 'shall-not';
  if (/\bmay\b|\bauthority\b|\bpower\b|\bempowered\b/i.test(question)) return 'may';
  if (/\bmust\b|\brequired\b|\bduty\b|\bshall\b/i.test(question)) return 'must';
  if (/\bdeemed\b|\blegal effect\b/i.test(question)) return 'deemed';
  if (/\bentitled\b/i.test(question)) return 'entitled';
  return 'none';
};

const modalityMatchesFact = (question: string, facts: ExtractedLegalFact[]): boolean => {
  const questionModality = inferQuestionModality(question);
  if (questionModality === 'none') return true;
  return facts.some((fact) => {
    if (questionModality === 'must') return fact.modality === 'shall' || fact.modality === 'must';
    if (questionModality === 'shall-not') return fact.modality === 'shall-not' || fact.modality === 'may-not';
    if (questionModality === 'may') return fact.modality === 'may';
    return fact.modality === questionModality;
  });
};

const modalityMatchesSingleFact = (questionModality: LegalModality, fact: ExtractedLegalFact): boolean => {
  if (questionModality === 'none') return true;
  if (questionModality === 'must') return fact.modality === 'shall' || fact.modality === 'must';
  if (questionModality === 'shall-not') return fact.modality === 'shall-not' || fact.modality === 'may-not';
  if (questionModality === 'may') return fact.modality === 'may';
  return fact.modality === questionModality;
};

const actorMatchesSingleFact = (question: string, fact: ExtractedLegalFact): boolean => {
  const actor = fact.operativeActor ?? fact.actor;
  if (!actor) return true;
  const normalizedQuestion = normalizeActorForComparison(question);
  const normalizedActor = normalizeActorForComparison(actor);
  if (normalizedQuestion.includes(normalizedActor)) return true;
  if (/\binstrument\b/i.test(actor) && /\binstrument\b/i.test(question)) return true;
  if (/persons or authorities/i.test(actor) && /\bwho may make an application\b/i.test(question)) return true;
  return false;
};

const actorMatchesFact = (question: string, facts: ExtractedLegalFact[]): boolean => {
  return facts.some((fact) => actorMatchesSingleFact(question, fact));
};

const semanticMatchesSingleFact = (question: string, facts: ExtractedLegalFact[]): boolean => {
  const questionModality = inferQuestionModality(question);
  return facts.some((fact) => actorMatchesSingleFact(question, fact) && modalityMatchesSingleFact(questionModality, fact));
};

const semanticFactsForItem = (
  item: { sourceKeys?: string[]; generatedFromFacts?: unknown[] },
  extractedFacts: ExtractedLegalFact[],
): ExtractedLegalFact[] => {
  const fromFacts = (item.generatedFromFacts ?? []).filter((fact): fact is ExtractedLegalFact =>
    Boolean(fact && typeof fact === 'object' && 'sourceKey' in fact),
  );
  if (fromFacts.length) return fromFacts;
  const sourceKeys = item.sourceKeys ?? [];
  return extractedFacts.filter((fact) => sourceKeys.includes(fact.sourceKey));
};

export const collectStudyGenerationWarnings = (section: {
  source: ImportedLegalComponent;
  detectedTopic: string;
  mainQuestion: string;
  mainQuestionTier?: StudyQuestionTier;
  referenceAnswer: string;
  rubricItems: Array<{
    category?: StudyRubricCategory;
    prompt: string;
    referenceAnswer: string;
    sourceKeys?: string[];
    questionTier?: StudyQuestionTier;
    generatedFromFacts?: unknown[];
  }>;
  concepts: Array<{ label: string }>;
  extractedFacts: ExtractedLegalFact[];
  suggestedChunks?: SuggestedStudyChunk[];
}): StudyGenerationWarning[] => {
  const warnings: StudyGenerationWarning[] = [];
  const sourceTexts = sourceTextByKey(section.source);
  if (hasMalformedQuestionText(section.mainQuestion)) {
    warnings.push(warning('MALFORMED_QUESTION', 'critical', 'generated.mainQuestion', section.mainQuestion, 'The main question appears to have malformed punctuation or a truncated ending.'));
  }
  if (hasDuplicatedConnectorWord(section.mainQuestion)) {
    warnings.push(warning('DUPLICATED_CONNECTOR_WORD', 'warning', 'generated.mainQuestion', section.mainQuestion, 'The main question contains duplicated connector wording.'));
  }
  if (hasInanimateActorQuestion(section.mainQuestion)) {
    warnings.push(warning('INANIMATE_ACTOR_QUESTION', 'warning', 'generated.mainQuestion', section.mainQuestion, 'The question asks an inanimate legal object what it must or may do.'));
  }
  if (section.mainQuestion.length > QUESTION_TOO_LONG_THRESHOLD) {
    warnings.push(warning('QUESTION_TOO_LONG', 'warning', 'generated.mainQuestion', section.mainQuestion, `The main question is longer than ${QUESTION_TOO_LONG_THRESHOLD} characters.`));
  }
  if (sourceCopyFragment(section.mainQuestion, section.source.text)) {
    warnings.push(warning('QUESTION_FRAGMENT_TOO_LONG', 'warning', 'generated.mainQuestion', section.mainQuestion, 'The question appears to copy a long source-text fragment instead of using a concise subject.'));
  }
  if (hasMissingSubject(section.mainQuestion)) {
    warnings.push(warning('QUESTION_MISSING_SUBJECT', 'critical', 'generated.mainQuestion', section.mainQuestion, 'The question ends with a weak or missing subject.'));
  }
  if (hasTopicMismatch(section.source, section.detectedTopic, section.mainQuestion)) {
    warnings.push(warning('MAIN_QUESTION_TOPIC_MISMATCH', 'warning', 'generated.mainQuestion', section.mainQuestion, 'The main question topic does not match the section heading or detected topic.'));
  }
  if (strongHeadingTopicMismatch(section.source.heading, section.mainQuestion)) {
    warnings.push(warning('STRONG_HEADING_TOPIC_MISMATCH', 'critical', 'generated.mainQuestion', section.mainQuestion, 'The main question does not preserve a highly explicit section-heading topic.'));
  }
  if (questionHasUnsupportedTopic([section.source], section.mainQuestion)) {
    warnings.push(warning('MAIN_QUESTION_UNSUPPORTED_TOPIC', 'critical', 'generated.mainQuestion', section.mainQuestion, 'The main question asks about a specialized topic that is not supported by the section heading or operative source text.'));
  }
  if (section.mainQuestionTier === 'A' && hasTierASurfaceQualityFailure(section.mainQuestion)) {
    warnings.push(warning('TIER_A_SURFACE_QUALITY_FAILURE', 'warning', 'generated.mainQuestion', section.mainQuestion, 'A Tier A main question failed the grammatical surface-quality gate.'));
  }
  if (amendmentHistoryPattern.test(section.referenceAnswer)) {
    warnings.push(warning('AMENDMENT_HISTORY_LEAK', 'critical', 'generated.referenceAnswer', section.referenceAnswer.match(amendmentHistoryPattern)?.[0] ?? section.referenceAnswer, 'The generated reference answer appears to contain amendment history or citation residue.'));
  }
  const referenceHeadingLeak = trailingStructuralHeadingLeak(section.source, section.referenceAnswer);
  if (referenceHeadingLeak) {
    warnings.push(warning('TRAILING_STRUCTURAL_HEADING', 'warning', 'generated.referenceAnswer', referenceHeadingLeak, 'The generated reference answer includes a trailing structural heading that belongs to the next division.'));
  }
  const promptCounts = new Map<string, string[]>();
  for (const item of section.rubricItems) {
    const sourceKeys = item.sourceKeys ?? [];
    const studyNote = isStudyNoteRubric({
      category: item.category ?? 'custom',
      referenceAnswer: item.referenceAnswer,
    });
    if (!studyNote && (sourceKeys.length === 0 || (item.generatedFromFacts?.length ?? 0) === 0)) {
      warnings.push(warning('UNGROUNDED_RUBRIC_ITEM', 'critical', 'generated.rubricItems', item.prompt, 'Generated rubric has no source fact provenance.'));
    }
    for (const sourceKey of sourceKeys) {
      if (!sourceTexts.has(sourceKey)) {
        warnings.push(warning('RUBRIC_SOURCE_KEY_NOT_FOUND', 'critical', 'generated.rubricItems.sourceKeys', sourceKey, 'A generated rubric references a sourceKey that does not exist in the selected source.'));
      }
    }
    if (!studyNote && sourceKeys.length > 0) {
      const sourceText = sourceKeys.map((sourceKey) => sourceTexts.get(sourceKey) ?? '').join('\n');
      if (sourceText && !hasSourceOverlap(item.referenceAnswer, sourceText)) {
        warnings.push(warning('REFERENCE_ANSWER_SOURCE_MISMATCH', 'critical', 'generated.rubricItems.referenceAnswer', item.referenceAnswer, 'The source-derived reference answer is not sufficiently grounded in the referenced official source.'));
      }
    }
    if (isGenericRubricPrompt(item.prompt) && hasSpecificFact(section.extractedFacts)) {
      warnings.push(warning('GENERIC_RUBRIC_PROMPT', 'warning', 'generated.rubricItems.prompt', item.prompt, 'A generic fallback prompt was used even though structured legal facts were extracted.'));
    }
    if (hasMissingSubject(item.prompt)) {
      warnings.push(warning('QUESTION_MISSING_SUBJECT', 'critical', 'generated.rubricItems.prompt', item.prompt, 'The rubric prompt ends with a weak or missing subject.'));
    }
    if (hasMalformedQuestionText(item.prompt)) {
      warnings.push(warning('MALFORMED_QUESTION', 'critical', 'generated.rubricItems.prompt', item.prompt, 'The rubric prompt appears to have malformed punctuation or a truncated ending.'));
    }
    if (hasDuplicatedConnectorWord(item.prompt)) {
      warnings.push(warning('DUPLICATED_CONNECTOR_WORD', 'warning', 'generated.rubricItems.prompt', item.prompt, 'The rubric prompt contains duplicated connector wording.'));
    }
    if (hasInanimateActorQuestion(item.prompt)) {
      warnings.push(warning('INANIMATE_ACTOR_QUESTION', 'warning', 'generated.rubricItems.prompt', item.prompt, 'The prompt asks an inanimate legal object what it must or may do.'));
    }
    if (item.questionTier === 'A' && hasTierASurfaceQualityFailure(item.prompt)) {
      warnings.push(warning('TIER_A_SURFACE_QUALITY_FAILURE', 'warning', 'generated.rubricItems.prompt', item.prompt, 'A Tier A rubric prompt failed the grammatical surface-quality gate.'));
    }
    if (item.questionTier === 'A') {
      const semanticFacts = semanticFactsForItem(item, section.extractedFacts);
      if (semanticFacts.length > 0 && !actorMatchesFact(item.prompt, semanticFacts)) {
        warnings.push(warning('ACTOR_MISMATCH', 'critical', 'generated.rubricItems.prompt', item.prompt, 'The Tier A prompt names an actor that is not the operative actor of the grounded fact.'));
      }
      if (semanticFacts.length > 0 && !modalityMatchesFact(item.prompt, semanticFacts)) {
        warnings.push(warning('MODALITY_MISMATCH', 'critical', 'generated.rubricItems.prompt', item.prompt, 'The Tier A prompt modality does not match the grounded source fact modality.'));
      }
      if (semanticFacts.length > 1 && !semanticMatchesSingleFact(item.prompt, semanticFacts)) {
        warnings.push(warning('CLAUSE_BINDING_AMBIGUOUS', 'warning', 'generated.rubricItems.prompt', item.prompt, 'The prompt actor and modality do not bind to the same extracted source fact.'));
      }
      if (semanticFacts.length > 2 || semanticFacts.some((fact) => fact.confidence === 'medium' && /multiple modal clauses/i.test(fact.sourceClause ?? ''))) {
        warnings.push(warning('CLAUSE_BINDING_AMBIGUOUS', 'warning', 'generated.rubricItems.prompt', item.prompt, 'Multiple actors or modal clauses exist and deterministic parsing cannot safely bind the prompt as Tier A.'));
      }
    }
    if (amendmentHistoryPattern.test(item.referenceAnswer)) {
      warnings.push(warning('AMENDMENT_HISTORY_LEAK', 'critical', 'generated.rubricItems.referenceAnswer', item.referenceAnswer.match(amendmentHistoryPattern)?.[0] ?? item.referenceAnswer, 'The rubric answer appears to contain amendment history or citation residue.'));
    }
    const rubricHeadingLeak = trailingStructuralHeadingLeak(section.source, item.referenceAnswer);
    if (rubricHeadingLeak) {
      warnings.push(warning('TRAILING_STRUCTURAL_HEADING', 'warning', 'generated.rubricItems.referenceAnswer', rubricHeadingLeak, 'The rubric answer includes a trailing structural heading that belongs to the next division.'));
    }
    if (item.referenceAnswer.length > RUBRIC_ANSWER_TOO_LONG_THRESHOLD && /\(\d+(?:\.\d+)?\)/.test(item.referenceAnswer)) {
      warnings.push(warning('RUBRIC_ANSWER_TOO_LONG', 'warning', 'generated.rubricItems.referenceAnswer', item.referenceAnswer.slice(0, 220), 'A rubric answer is long and appears to contain several independent subsection units.'));
    }
    const key = normalizePromptKey(item.prompt);
    promptCounts.set(key, [...(promptCounts.get(key) ?? []), item.prompt]);
  }
  for (const prompts of promptCounts.values()) {
    if (prompts.length > 1) {
      warnings.push(warning('DUPLICATE_RUBRIC_PROMPT', 'warning', 'generated.rubricItems.prompt', prompts.join(' | '), 'Two or more rubric prompts are identical or near-identical after normalization.'));
    }
  }
  if (section.rubricItems.length > TOO_MANY_RUBRIC_ITEMS_THRESHOLD) {
    warnings.push(warning('TOO_MANY_RUBRIC_ITEMS', 'warning', 'generated.rubricItems', String(section.rubricItems.length), `The section produced more than ${TOO_MANY_RUBRIC_ITEMS_THRESHOLD} rubric items.`));
  }
  if (isSubstantive(section.source) && section.rubricItems.length === 0) {
    warnings.push(warning('NO_RUBRIC_ITEMS', 'critical', 'generated.rubricItems', '', 'A substantive non-repealed section produced no rubric items.'));
  }
  if (isSubstantive(section.source) && (section.source.subsections?.length ?? 0) > 1 && section.rubricItems.length === 1 && isGenericRubricPrompt(section.rubricItems[0].prompt)) {
    warnings.push(warning('TOO_FEW_RUBRIC_ITEMS', 'warning', 'generated.rubricItems', section.rubricItems[0].prompt, 'A multi-subsection substantive section produced only one generic rubric item.'));
  }
  for (const concept of section.concepts) {
    if (isConceptFragment(concept.label)) {
      warnings.push(warning('CONCEPT_FRAGMENT', 'info', 'generated.concepts.label', concept.label, 'The concept label looks like an incomplete source-text fragment.'));
    }
  }
  warnings.push(...collectChunkWarnings(section.suggestedChunks ?? []));
  return warnings;
};

export const scoreStudyGenerationWarnings = (warnings: StudyGenerationWarning[]): number => {
  const penalties: Record<string, number> = {
    MALFORMED_QUESTION: 20,
    MAIN_QUESTION_TOPIC_MISMATCH: 15,
    STRONG_HEADING_TOPIC_MISMATCH: 50,
    MAIN_QUESTION_UNSUPPORTED_TOPIC: 25,
    AMENDMENT_HISTORY_LEAK: 15,
    UNGROUNDED_RUBRIC_ITEM: 100,
    RUBRIC_SOURCE_KEY_NOT_FOUND: 100,
    REFERENCE_ANSWER_SOURCE_MISMATCH: 100,
    SPECIAL_CASE_SCOPE_VIOLATION: 100,
    RAW_CLAUSE_TRUNCATED: 20,
    DEFINITION_SECTION_WRONG_RUBRIC_TYPE: 20,
    CROSS_DOCUMENT_TEMPLATE_COLLISION: 100,
    ACTOR_MISMATCH: 100,
    MODALITY_MISMATCH: 100,
    CLAUSE_BINDING_AMBIGUOUS: 20,
    INANIMATE_ACTOR_QUESTION: 10,
    DUPLICATED_CONNECTOR_WORD: 10,
    TRAILING_STRUCTURAL_HEADING: 10,
    DUPLICATE_RUBRIC_PROMPT: 10,
    QUESTION_MISSING_SUBJECT: 10,
    GENERIC_RUBRIC_PROMPT: 5,
    CONCEPT_FRAGMENT: 5,
    QUESTION_TOO_LONG: 5,
    QUESTION_FRAGMENT_TOO_LONG: 5,
    TIER_A_SURFACE_QUALITY_FAILURE: 10,
    RUBRIC_ANSWER_TOO_LONG: 5,
    TOO_MANY_RUBRIC_ITEMS: 5,
    TOO_FEW_RUBRIC_ITEMS: 10,
    NO_RUBRIC_ITEMS: 20,
    DUPLICATE_CHUNK_SUGGESTION: 10,
    CHUNK_SOURCE_OVERLAP: 10,
    CHUNK_ESTIMATE_ZERO: 5,
  };
  const score = warnings.reduce((total, entry) => total - (penalties[entry.code] ?? 5), 100);
  return Math.max(0, Math.min(100, score));
};

const buildSectionAudit = (
  document: ImportedLegalDocument,
  source: ImportedLegalComponent,
): StudyGenerationAuditSection => {
  const selectedSources = [source];
  const rubric = generateStudyRubricWithDiagnostics({ document, selectedSources, unitType: 'section' });
  const question = generateStudyQuestion({
    documentTitle: document.officialTitle,
    officialCitation: document.officialCitationDisplay,
    selectedSources,
    rubricCategories: rubric.items.map((item) => item.category),
  });
  const referenceAnswer = generateReferenceAnswer({
    document,
    selectedSources,
    options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
  });
  const concepts = generateRequiredConcepts({ document, selectedSources });
  const title = generateStudyTitle({ documentTitle: document.officialTitle, selectedSources });
  const generatedRubricItems = rubric.items.map((item, index) => ({
    id: `${componentRecordKey(source)}::rubric:${index + 1}`,
    category: item.category,
    prompt: item.prompt,
    questionTier: item.questionTier ?? 'C',
    referenceAnswer: item.referenceAnswer,
    sourceKeys: item.sourceReferences?.map((reference) => reference.sourceKey) ?? [source.sourceKey],
    generatedFromFacts: rubric.diagnostic.extractedFacts.filter((fact) =>
      item.sourceReferences?.some((reference) =>
        reference.sourceKey === fact.sourceKey ||
        (reference.sourceKey === source.sourceKey && fact.sourceKey.startsWith(`${source.sourceKey}/`)),
      ),
    ),
  }));
  const detectedTopic = rubric.diagnostic.sectionTopic || classifyStudyRubricSectionTopic(source);
  const suggestedChunks = suggestStudyChunks(source);
  const warnings = collectStudyGenerationWarnings({
    source,
    detectedTopic,
    mainQuestion: question.question,
    mainQuestionTier: question.questionTier,
    referenceAnswer: referenceAnswer.text,
    rubricItems: generatedRubricItems,
    concepts,
    extractedFacts: rubric.diagnostic.extractedFacts,
    suggestedChunks,
  });
  return {
    documentId: document.id,
    documentTitle: document.officialTitle,
    documentCitation: document.officialCitationDisplay,
    sourceKey: source.sourceKey,
    sectionLabel: source.label,
    sectionHeading: source.heading,
    sourceText: source.text,
    detectedTopic,
    generated: {
      title,
      mainQuestion: question.question,
      mainQuestionTier: question.questionTier,
      referenceAnswer: referenceAnswer.text,
      rubricItems: generatedRubricItems,
      concepts: concepts.map((concept) => ({
        label: concept.label,
        reason: concept.reason,
        confidence: concept.confidence,
      })),
    },
    diagnostics: {
      extractedFacts: rubric.diagnostic.extractedFacts,
      questionTemplate: question.template,
      suggestedChunks,
      rejectedRubricItems: rubric.diagnostic.rejectedDuplicatePrompts,
      removedAmendmentHistory: rubric.diagnostic.removedSourceText,
      removedConsolidationText: referenceAnswer.warnings,
      tierAQualityDowngrades: rubric.diagnostic.tierAQualityDowngrades,
      semanticQualityDowngrades: rubric.diagnostic.semanticQualityDowngrades,
    },
    quality: {
      score: scoreStudyGenerationWarnings(warnings),
      warnings,
    },
  };
};

const rubricSignature = (section: StudyGenerationAuditSection): string =>
  section.generated.rubricItems
    .map((item) => `${item.category}|${normalizePromptKey(item.prompt)}|${normalizePromptKey(item.referenceAnswer)}`)
    .join('\n');

const hasIndependentGrounding = (section: StudyGenerationAuditSection): boolean =>
  section.generated.rubricItems.every((item) => item.sourceKeys.length > 0 && (item.generatedFromFacts?.length ?? 0) > 0);

const withCrossDocumentCollisionWarnings = (
  documents: StudyGenerationAuditDocument[],
): StudyGenerationAuditDocument[] => {
  const sections = documents.flatMap((document) => document.sections);
  const groups = new Map<string, StudyGenerationAuditSection[]>();
  for (const section of sections) {
    const signature = rubricSignature(section);
    if (!signature) continue;
    const key = `${section.sectionLabel}::${signature}`;
    groups.set(key, [...(groups.get(key) ?? []), section]);
  }
  const collided = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((section) => section.documentId)).size < 2) continue;
    for (const section of group) {
      if (!hasIndependentGrounding(section)) collided.add(`${section.documentId}::${section.sourceKey}`);
    }
  }
  if (collided.size === 0) return documents;
  return documents.map((document) => ({
    ...document,
    sections: document.sections.map((section) => {
      if (!collided.has(`${section.documentId}::${section.sourceKey}`)) return section;
      const warnings = [
        ...section.quality.warnings,
        warning('CROSS_DOCUMENT_TEMPLATE_COLLISION', 'critical', 'generated.rubricItems', section.generated.rubricItems.map((item) => item.prompt).join(' | '), 'Two unrelated documents with the same section number received the same specialized rubric set without independent grounding.'),
      ];
      return { ...section, quality: { score: scoreStudyGenerationWarnings(warnings), warnings } };
    }),
  }));
};

const summarizeAudit = (documents: StudyGenerationAuditDocument[]): StudyGenerationAuditSummary => {
  const sections = documents.flatMap((document) => document.sections);
  const warningsByType: Record<string, number> = {};
  const warningsByDocument: Record<string, number> = {};
  for (const section of sections) {
    for (const entry of section.quality.warnings) {
      warningsByType[entry.code] = (warningsByType[entry.code] ?? 0) + 1;
      warningsByDocument[section.documentId] = (warningsByDocument[section.documentId] ?? 0) + 1;
    }
  }
  const average = sections.length
    ? sections.reduce((sum, section) => sum + section.quality.score, 0) / sections.length
    : 0;
  const questionTierCounts: Record<StudyQuestionTier, number> = { A: 0, B: 0, C: 0 };
  for (const section of sections) {
    questionTierCounts[section.generated.mainQuestionTier] += 1;
    for (const item of section.generated.rubricItems) questionTierCounts[item.questionTier] += 1;
  }
  const allChunks = sections.flatMap((section) => section.diagnostics.suggestedChunks ?? []);
  const uniqueChunkCount = new Set(sections.flatMap((section) =>
    (section.diagnostics.suggestedChunks ?? []).map((chunk) => auditChunkSignature(section, chunk)),
  )).size;
  const sectionsWhereChunkPlanningFailed = sections.filter((section) =>
    estimateRubricFacts({
      documentId: section.documentId,
      id: section.sourceKey,
      sourceKey: section.sourceKey,
      componentType: 'section',
      label: section.sectionLabel,
      heading: section.sectionHeading,
      text: section.sourceText,
      contentHash: '',
      subsections: [],
      extractionStatus: 'complete',
    }) > 8 && (section.diagnostics.suggestedChunks?.length ?? 0) === 0,
  ).length;
  return {
    totalSections: sections.length,
    totalRubricItems: sections.reduce((sum, section) => sum + section.generated.rubricItems.length, 0),
    sectionsWithNoWarnings: sections.filter((section) => section.quality.warnings.length === 0).length,
    sectionsWithWarnings: sections.filter((section) => section.quality.warnings.length > 0).length,
    warningsByType,
    warningsByDocument,
    averageQaScore: Number(average.toFixed(2)),
    questionTierCounts,
    sectionsWithChunkSuggestions: sections.filter((section) => (section.diagnostics.suggestedChunks?.length ?? 0) > 0).length,
    suggestedChunkCount: allChunks.length,
    uniqueSuggestedChunkCount: uniqueChunkCount,
    tierAQualityDowngradeCount: sections.reduce((sum, section) => sum + (section.diagnostics.tierAQualityDowngrades?.length ?? 0), 0),
    semanticQualityDowngradeCount: sections.reduce((sum, section) => sum + (section.diagnostics.semanticQualityDowngrades?.length ?? 0), 0),
    genuineTopicMismatchCount: sections.reduce((sum, section) => sum + section.quality.warnings.filter((entry) => entry.code === 'MAIN_QUESTION_TOPIC_MISMATCH').length, 0),
    actorMismatchCount: sections.reduce((sum, section) => sum + section.quality.warnings.filter((entry) => entry.code === 'ACTOR_MISMATCH').length, 0),
    modalityMismatchCount: sections.reduce((sum, section) => sum + section.quality.warnings.filter((entry) => entry.code === 'MODALITY_MISMATCH').length, 0),
    clauseBindingAmbiguousCount: sections.reduce((sum, section) => sum + section.quality.warnings.filter((entry) => entry.code === 'CLAUSE_BINDING_AMBIGUOUS').length, 0),
    chunkGranularityLimitedSections: sections.filter((section) =>
      (section.diagnostics.suggestedChunks ?? []).some((chunk) => chunk.chunkGranularityLimited),
    ).length,
    chunkPlanningFailedSections: sectionsWhereChunkPlanningFailed,
    averageEstimatedRubricItemsPerChunk: allChunks.length
      ? Number((allChunks.reduce((sum, chunk) => sum + chunk.estimatedRubricItems, 0) / allChunks.length).toFixed(2))
      : 0,
    lowestScoringSections: sections
      .slice()
      .sort((a, b) => a.quality.score - b.quality.score || a.documentTitle.localeCompare(b.documentTitle) || compareLabels(a.sectionLabel, b.sectionLabel))
      .slice(0, 10)
      .map((section) => ({
        documentId: section.documentId,
        documentTitle: section.documentTitle,
        sectionLabel: section.sectionLabel,
        sectionHeading: section.sectionHeading,
        score: section.quality.score,
        warnings: section.quality.warnings.map((entry) => entry.code),
      })),
  };
};

export const buildStudyGenerationAudit = (
  contentPackage: NbLawContentPackage,
  options: StudyGenerationAuditOptions = {},
): StudyGenerationAudit => {
  const importedAt = options.createdAt ?? new Date().toISOString();
  const documents = toImportedLegalDocuments(contentPackage, importedAt);
  const components = toImportedLegalComponents(contentPackage);
  const componentsByDocument = new Map<string, ImportedLegalComponent[]>();
  for (const component of components) {
    if (!isIncludedComponent(component, options)) continue;
    componentsByDocument.set(component.documentId, [...(componentsByDocument.get(component.documentId) ?? []), component]);
  }
  const auditDocuments = withCrossDocumentCollisionWarnings(documents
    .filter((document) => !options.documentId || document.id === options.documentId)
    .map((document): StudyGenerationAuditDocument => ({
      documentId: document.id,
      documentTitle: document.officialTitle,
      documentCitation: document.officialCitationDisplay,
      sections: (componentsByDocument.get(document.id) ?? [])
        .slice()
        .sort((a, b) => compareLabels(a.label, b.label))
        .map((component) => buildSectionAudit(document, component)),
    }))
    .filter((document) => document.sections.length > 0));
  return {
    schemaVersion: STUDY_GENERATION_AUDIT_SCHEMA_VERSION,
    createdAt: importedAt,
    contentPackageId: contentPackage.id,
    generatorVersion: STUDY_GENERATION_AUDIT_GENERATOR_VERSION,
    summary: summarizeAudit(auditDocuments),
    documents: auditDocuments,
  };
};

const severitySortValue = (warnings: StudyGenerationWarning[]): number =>
  Math.max(0, ...warnings.map((entry) => severityRank[entry.severity]));

export const flattenAuditSections = (audit: StudyGenerationAudit): StudyGenerationAuditSection[] =>
  audit.documents.flatMap((document) => document.sections);

const renderWarnings = (warnings: StudyGenerationWarning[]): string[] =>
  warnings.length === 0
    ? ['Warnings: none']
    : [
        'Warnings:',
        ...warnings.map((entry) => `- [${entry.severity.toUpperCase()}] ${entry.code} (${entry.field}): ${entry.explanation} Text: ${entry.text}`),
      ];

export const renderStudyGenerationAuditMarkdown = (audit: StudyGenerationAudit): string => {
  const lines = [
    '# Study Generation Audit',
    '',
    `Created: ${audit.createdAt}`,
    `Content package: ${audit.contentPackageId}`,
    `Generator: ${audit.generatorVersion}`,
    '',
    '## Summary',
    '',
    `Total sections: ${audit.summary.totalSections}`,
    `Total rubric items: ${audit.summary.totalRubricItems}`,
    `Sections with warnings: ${audit.summary.sectionsWithWarnings}`,
    `Average QA score: ${audit.summary.averageQaScore}`,
    `Tier A questions: ${audit.summary.questionTierCounts.A}`,
    `Tier B questions: ${audit.summary.questionTierCounts.B}`,
    `Tier C questions: ${audit.summary.questionTierCounts.C}`,
    `Sections with chunk suggestions: ${audit.summary.sectionsWithChunkSuggestions}`,
    `Suggested chunks: ${audit.summary.suggestedChunkCount}`,
    `Unique suggested chunks: ${audit.summary.uniqueSuggestedChunkCount}`,
    `Tier A questions downgraded by quality gate: ${audit.summary.tierAQualityDowngradeCount}`,
    `Tier A questions downgraded by semantic gate: ${audit.summary.semanticQualityDowngradeCount}`,
    `Genuine topic mismatches: ${audit.summary.genuineTopicMismatchCount}`,
    `Actor mismatches: ${audit.summary.actorMismatchCount}`,
    `Modality mismatches: ${audit.summary.modalityMismatchCount}`,
    `Ambiguous clause bindings: ${audit.summary.clauseBindingAmbiguousCount}`,
    `Chunk granularity limited sections: ${audit.summary.chunkGranularityLimitedSections}`,
    `Sections where chunk planning failed: ${audit.summary.chunkPlanningFailedSections}`,
    `Average estimated rubric items per chunk: ${audit.summary.averageEstimatedRubricItemsPerChunk}`,
    '',
    'Warnings by type:',
    ...Object.entries(audit.summary.warningsByType).map(([code, count]) => `- ${code}: ${count}`),
    '',
  ];
  for (const document of audit.documents) {
    lines.push(`## ${document.documentTitle}`, '', `Citation: ${document.documentCitation}`, '');
    for (const section of document.sections) {
      lines.push(`### Section ${section.sectionLabel}${section.sectionHeading ? ` - ${section.sectionHeading}` : ''}`, '');
      if (section.sourceText.length > 1000) {
        lines.push('<details>', '<summary>Source</summary>', '', section.sourceText, '', '</details>', '');
      } else {
        lines.push('Source:', '', section.sourceText, '');
      }
      lines.push(
        `Detected topic: ${section.detectedTopic ?? ''}`,
        `Main question tier: ${section.generated.mainQuestionTier}`,
        '',
        'Main question:',
        section.generated.mainQuestion,
        '',
        'Reference answer:',
        section.generated.referenceAnswer,
        '',
        'Rubric:',
        '',
      );
      section.generated.rubricItems.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.category}] [Tier ${item.questionTier}]`, `   Question: ${item.prompt}`, `   Answer: ${item.referenceAnswer}`, '');
      });
      if (section.diagnostics.suggestedChunks?.length) {
        lines.push('Suggested chunks:', '');
        section.diagnostics.suggestedChunks.forEach((chunk) => {
          lines.push(`- ${chunk.title} (${chunk.reasons.join(', ')}, estimated rubric items: ${chunk.estimatedRubricItems}; sources: ${chunk.sourceKeys.join(', ')}${chunk.chunkGranularityLimited ? '; chunkGranularityLimited: true' : ''})`);
        });
        lines.push('');
      }
      lines.push('Concepts:', section.generated.concepts.map((concept) => `- ${concept.label}`).join('\n') || 'none', '', ...renderWarnings(section.quality.warnings), '');
    }
  }
  return `${lines.join('\n')}\n`;
};

export const renderStudyGenerationWarningsMarkdown = (audit: StudyGenerationAudit): string => {
  const sections = flattenAuditSections(audit)
    .filter((section) => section.quality.warnings.length > 0)
    .sort((a, b) =>
      a.quality.score - b.quality.score ||
      severitySortValue(b.quality.warnings) - severitySortValue(a.quality.warnings) ||
      a.documentTitle.localeCompare(b.documentTitle) ||
      compareLabels(a.sectionLabel, b.sectionLabel),
    );
  return `${[
    '# Study Generation Warnings',
    '',
    `Created: ${audit.createdAt}`,
    `Sections with warnings: ${sections.length}`,
    '',
    ...sections.flatMap((section) => [
      `## ${section.documentTitle} section ${section.sectionLabel}${section.sectionHeading ? ` - ${section.sectionHeading}` : ''}`,
      '',
      `QA score: ${section.quality.score}`,
      `Main question: ${section.generated.mainQuestion}`,
      '',
      ...renderWarnings(section.quality.warnings),
      '',
    ]),
  ].join('\n')}\n`;
};

const csvEscape = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const renderStudyGenerationAuditCsv = (audit: StudyGenerationAudit): string => {
  const rows = [
    ['Document', 'Section', 'Heading', 'Main Question', 'Main Question Tier', 'Rubric Count', 'Concept Count', 'Chunk Suggestions', 'QA Score', 'Warning Count', 'Warning Codes'],
    ...flattenAuditSections(audit).map((section) => [
      section.documentTitle,
      section.sectionLabel,
      section.sectionHeading ?? '',
      section.generated.mainQuestion,
      section.generated.mainQuestionTier,
      section.generated.rubricItems.length,
      section.generated.concepts.length,
      section.diagnostics.suggestedChunks?.length ?? 0,
      section.quality.score,
      section.quality.warnings.length,
      section.quality.warnings.map((entry) => entry.code).join(';'),
    ]),
  ];
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
};

export const compareStudyGenerationAuditBaseline = (
  before: StudyGenerationAudit,
  after: StudyGenerationAudit,
): StudyGenerationBaselineDiff[] => {
  const beforeByKey = new Map(flattenAuditSections(before).map((section) => [`${section.documentId}::${section.sourceKey}`, section]));
  return flattenAuditSections(after).flatMap((afterSection) => {
    const key = `${afterSection.documentId}::${afterSection.sourceKey}`;
    const beforeSection = beforeByKey.get(key);
    if (!beforeSection) return [];
    const beforePrompts = beforeSection.generated.rubricItems.map((item) => item.prompt);
    const afterPrompts = afterSection.generated.rubricItems.map((item) => item.prompt);
    const beforeWarnings = beforeSection.quality.warnings.map((entry) => entry.code);
    const afterWarnings = afterSection.quality.warnings.map((entry) => entry.code);
    const changed =
      beforeSection.generated.mainQuestion !== afterSection.generated.mainQuestion ||
      beforePrompts.join('\n') !== afterPrompts.join('\n') ||
      beforeWarnings.join('\n') !== afterWarnings.join('\n') ||
      beforeSection.quality.score !== afterSection.quality.score;
    if (!changed) return [];
    return [{
      sectionKey: key,
      documentTitle: afterSection.documentTitle,
      sectionLabel: afterSection.sectionLabel,
      beforeMainQuestion: beforeSection.generated.mainQuestion,
      afterMainQuestion: afterSection.generated.mainQuestion,
      beforeRubricPrompts: beforePrompts,
      afterRubricPrompts: afterPrompts,
      warningsRemoved: beforeWarnings.filter((entry) => !afterWarnings.includes(entry)),
      warningsAdded: afterWarnings.filter((entry) => !beforeWarnings.includes(entry)),
      beforeScore: beforeSection.quality.score,
      afterScore: afterSection.quality.score,
    }];
  });
};

export const renderStudyGenerationBaselineDiffMarkdown = (diffs: StudyGenerationBaselineDiff[]): string =>
  `${[
    '# Study Generation Baseline Diff',
    '',
    `Changed sections: ${diffs.length}`,
    '',
    ...diffs.flatMap((diff) => [
      `## ${diff.documentTitle} section ${diff.sectionLabel}`,
      '',
      `QA score: ${diff.beforeScore} -> ${diff.afterScore}`,
      '',
      'Before main question:',
      diff.beforeMainQuestion,
      '',
      'After main question:',
      diff.afterMainQuestion,
      '',
      'Before rubric prompts:',
      ...diff.beforeRubricPrompts.map((prompt) => `- ${prompt}`),
      '',
      'After rubric prompts:',
      ...diff.afterRubricPrompts.map((prompt) => `- ${prompt}`),
      '',
      `Warnings removed: ${diff.warningsRemoved.join(', ') || 'none'}`,
      `Warnings added: ${diff.warningsAdded.join(', ') || 'none'}`,
      '',
    ]),
  ].join('\n')}\n`;
