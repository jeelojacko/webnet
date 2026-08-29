import type { StudyPriority } from '../studyTypes';

export type AiAuthoringProviderKind =
  | 'external-codex'
  | 'external-chatgpt'
  | 'openai-api'
  | 'local-openai-compatible'
  | 'manual-import';

export type AiAuthoringJobType = 'study-map' | 'unit-authoring';

export type AiStudyDisposition =
  | 'standalone'
  | 'combine'
  | 'split'
  | 'reference-only'
  | 'skip'
  | 'needs-human-review';

export type AiConfidence = 'high' | 'medium' | 'low';
export type AiSuggestedPriority = 'P1' | 'P2' | 'P3' | 'P4';

export type AiProposalReviewStatus =
  | 'generated'
  | 'validated'
  | 'needs-review'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'superseded'
  | 'stale';

export type AiProposalValidationStatus = 'not-validated' | 'valid' | 'warnings' | 'invalid';

export type PilotMapEvaluation = 'good-as-is' | 'minor-edit' | 'major-edit' | 'wrong';

export type PilotUnitEvaluation =
  | 'excellent'
  | 'good'
  | 'needs-minor-edit'
  | 'needs-major-edit'
  | 'reject';

export type PilotUnitEvaluationDetail = {
  mainQuestion?: PilotUnitEvaluation;
  learningObjectives?: PilotUnitEvaluation;
  guidedQuestions?: PilotUnitEvaluation;
  studyAnswers?: PilotUnitEvaluation;
  sourceCoverage?: PilotUnitEvaluation;
  grounding?: PilotUnitEvaluation;
  studyUnitGrouping?: PilotUnitEvaluation;
};

export type AiLearningObjectiveType =
  | 'definition'
  | 'scope'
  | 'trigger'
  | 'actor'
  | 'authority'
  | 'duty'
  | 'prohibition'
  | 'procedure'
  | 'required-information'
  | 'notice'
  | 'deadline'
  | 'hearing'
  | 'evidence'
  | 'filing'
  | 'exception'
  | 'legal-effect'
  | 'appeal'
  | 'offence'
  | 'penalty'
  | 'relationship'
  | 'surveying-practice'
  | 'other';

export type AiStudyNoteKind = 'surveying-relevance' | 'memory-aid' | 'relationship' | 'other';
export type AiStudyNoteBasis = 'source-derived' | 'inference';

export type AiSourceContext = {
  sourceKey: string;
  sectionLabel: string;
  heading?: string;
  text: string;
  operativeText?: string;
  sourceHash: string;
  contextRole?: 'previous' | 'next' | 'definition' | 'direct-reference' | 'context-only';
};

export type AiSourceStatus = 'current' | 'repealed' | 'historical';

export type AiSourceContentFlags = {
  containsRepealedSubprovision?: boolean;
  repealOnly?: boolean;
  commencementOnly?: boolean;
  citationOnly?: boolean;
  transitional?: boolean;
};

export type AiSourceMetadata = {
  amendmentHistory?: string[];
  consolidationNotes?: string[];
  citationMetadata?: string[];
  cleaningWarnings?: string[];
};

export type AiSourceDocumentSummary = {
  documentId: string;
  title: string;
  citation?: string;
  type: 'act' | 'regulation' | 'bylaw';
};

export type AiStudyMapJob = {
  schemaVersion: 1;
  jobId: string;
  runId: string;
  promptSpecVersion: string;
  corpusContentHash: string;
  inputHash: string;
  authoringInputFingerprint?: string;
  document: AiSourceDocumentSummary;
  target: {
    sourceKeys: string[];
    sectionLabels: string[];
    componentType?: 'section' | 'schedule' | 'form' | 'appendix' | 'part-heading' | 'division-heading';
    heading?: string;
    exactSourceText: string;
    operativeSourceText: string;
    sourceMetadata: AiSourceMetadata;
    sourceStatus: AiSourceStatus;
    contentFlags?: AiSourceContentFlags;
    approximateInputSize: {
      exactCharacters: number;
      operativeCharacters: number;
      largeSection: boolean;
    };
    sourceFocusOptions?: Array<{
      sourceKey: string;
      label: string;
      childLabels?: string[];
      definedTerms?: string[];
    }>;
    sourceHashes: Record<string, string>;
  };
  context: {
    previous?: AiSourceContext;
    next?: AiSourceContext;
    relevantDefinitions?: AiSourceContext[];
    directlyReferencedProvisions?: AiSourceContext[];
    omittedContextWarnings?: string[];
  };
};

export type AiUnitAuthoringJob = {
  schemaVersion: 1;
  jobId: string;
  runId: string;
  promptSpecVersion: string;
  sourceMapRunId: string;
  sourceMapProposalId: string;
  corpusContentHash: string;
  inputHash: string;
  document: AiSourceDocumentSummary;
  approvedGroup: AiProposedSourceGroup;
  mapDisposition: AiStudyDisposition;
  mapReason: string;
  approximateLearningGoal: string;
  group: AiProposedSourceGroup;
  sourceHashes: Record<string, string>;
  sourceStatuses?: Record<string, AiSourceStatus>;
  contentFlagsBySourceKey?: Record<string, AiSourceContentFlags | undefined>;
  exactSourceText: string;
  operativeSourceText: string;
  sourceMetadata: AiSourceMetadata;
  context: {
    previous?: AiSourceContext;
    next?: AiSourceContext;
    relevantDefinitions?: AiSourceContext[];
    directlyReferencedProvisions?: AiSourceContext[];
    relatedSourceKeys?: string[];
    warnings?: string[];
    omittedContextWarnings?: string[];
  };
};

export type AiProposedSourceGroup = {
  groupId: string;
  titleSuggestion: string;
  sourceKeys: string[];
  focusSelections: AiMapFocusSelection[];
  reason: string;
  approximateLearningGoal: string;
};

export type AiMapFocusSelection = {
  sourceKey: string;
  childLabels?: string[];
  definedTerms?: string[];
  evidenceText?: string[];
};

export type AiStudyMapResult = {
  schemaVersion: 1;
  jobId: string;
  runId: string;
  corpusContentHash: string;
  inputHash?: string;
  authoringInputFingerprint?: string;
  promptSpecVersion?: string;
  disposition: AiStudyDisposition;
  confidence: AiConfidence;
  reason: string;
  suggestedPriority?: AiSuggestedPriority | null;
  proposedGroups: AiProposedSourceGroup[];
  warnings: string[];
};

export type AiGroundingEvidence = {
  sourceKey: string;
  evidenceText: string;
  evidenceHash?: string;
};

export type AiSourceCoverageStatus =
  | 'covered'
  | 'context-only'
  | 'intentionally-omitted'
  | 'not-assessed';

export type AiSourceCoverage = {
  sourceKey: string;
  childLabels?: Array<{
    label: string;
    status: AiSourceCoverageStatus;
    objectiveIds?: string[];
    reason?: string;
  }>;
};

export type AiMapRevisionSuggestion = {
  reason: string;
  proposedGroups: Array<{
    title: string;
    sourceKeys: string[];
    focusSelections: AiMapFocusSelection[];
    approximateLearningGoal: string;
  }>;
};

export type AiLearningObjective = {
  id: string;
  type: AiLearningObjectiveType;
  objective: string;
  guidedQuestion: string;
  studyAnswer: string;
  required: boolean;
  sourceKeys: string[];
  evidence: AiGroundingEvidence[];
  confidence: AiConfidence;
};

export type AiStudyNote = {
  id: string;
  kind: AiStudyNoteKind;
  text: string;
  basis: AiStudyNoteBasis;
  sourceKeys?: string[];
};

export type AiGenerationMetadata = {
  providerKind: AiAuthoringProviderKind;
  promptSpecVersion: string;
  generatedAt: string;
  sourceJobId?: string;
  sourceJobInputHash?: string;
  rawResultFile?: string;
  rawResultFileHash?: string;
};

export type AiStudyUnitProposal = {
  schemaVersion: 1;
  proposalId: string;
  runId: string;
  corpusContentHash: string;
  sourceDocumentId: string;
  sourceKeys: string[];
  sourceHashes: Record<string, string>;
  title: string;
  mainQuestion: string;
  studySummary: string;
  objectives: AiLearningObjective[];
  relatedSourceKeys?: string[];
  studyNotes?: AiStudyNote[];
  sourceCoverage?: AiSourceCoverage[];
  approvedGroup?: AiProposedSourceGroup;
  mapDisposition?: AiStudyDisposition;
  mapReason?: string;
  approximateLearningGoal?: string;
  suggestedPriority?: AiSuggestedPriority | null;
  authoringStatus?: 'generated' | 'needs-map-revision';
  mapRevisionSuggestion?: AiMapRevisionSuggestion;
  confidence: AiConfidence;
  warnings: string[];
  generationMetadata: AiGenerationMetadata;
};

export type AiAuthoringRun = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  providerKind: AiAuthoringProviderKind;
  jobType: AiAuthoringJobType;
  promptSpecVersion: string;
  corpusContentHash: string;
  sourcePackageId?: string;
  status: 'prepared' | 'partially-complete' | 'validated' | 'imported' | 'complete';
  jobCount: number;
  completedCount: number;
  invalidCount: number;
  notes?: string;
};

export type AiStudyMapProposal = {
  id: string;
  schemaVersion: 1;
  runId: string;
  jobId: string;
  corpusContentHash: string;
  inputHash?: string;
  document: AiSourceDocumentSummary;
  targetSourceKeys: string[];
  targetSectionLabels: string[];
  targetHeading?: string;
  exactSourceText?: string;
  operativeSourceText?: string;
  context?: AiStudyMapJob['context'];
  disposition: AiStudyDisposition;
  confidence: AiConfidence;
  reason: string;
  suggestedPriority?: AiSuggestedPriority | null;
  proposedGroups: AiProposedSourceGroup[];
  warnings: string[];
  conflictCodes: string[];
  reviewStatus: AiProposalReviewStatus;
  validationStatus: AiProposalValidationStatus;
  validationMessages: string[];
  pilotEvaluation?: PilotMapEvaluation;
  pilotEvaluationNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiStoredUnitProposal = AiStudyUnitProposal & {
  reviewStatus: AiProposalReviewStatus;
  validationStatus: AiProposalValidationStatus;
  validationMessages: string[];
  conflictCodes: string[];
  pilotEvaluation?: PilotUnitEvaluation;
  pilotEvaluationDetails?: PilotUnitEvaluationDetail;
  pilotEvaluationNotes?: string;
  approvedUnitId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiValidationIssueSeverity = 'error' | 'warning';

export type AiValidationIssue = {
  code: string;
  severity: AiValidationIssueSeverity;
  message: string;
  jobId?: string;
  proposalId?: string;
  objectiveId?: string;
  sourceKey?: string;
  guidedQuestion?: string;
  answerFragment?: string;
  sourceFragment?: string;
  trigger?: string;
};

export type AiValidationReport = {
  valid: boolean;
  issues: AiValidationIssue[];
};

export const aiPriorityToStudyPriority = (
  priority: AiSuggestedPriority | null | undefined,
): StudyPriority => {
  if (priority === 'P1') return 1;
  if (priority === 'P2') return 2;
  if (priority === 'P4') return 4;
  return 3;
};
