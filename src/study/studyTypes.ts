export type StudyDocumentKind =
  | 'act'
  | 'regulation'
  | 'anbls-bylaw'
  | 'standard'
  | 'case'
  | 'reading';

export type StudyPriority = 1 | 2 | 3 | 4 | 5;

export type StudyPhase =
  | 'unread'
  | 'guided-recall'
  | 'free-recall'
  | 'application'
  | 'maintenance';

export type StudyPromptKind =
  | 'guided-recall'
  | 'free-recall'
  | 'identification'
  | 'scenario'
  | 'comparison';

export type StudyRating = 'again' | 'hard' | 'good' | 'easy';

export type StudyFileRole = 'raw-html' | 'pdf' | 'imported-source' | 'normalized-markdown' | 'backup';

export type StudyGeneratedFieldState = 'empty' | 'generated' | 'user-edited';

export type StudyReferenceAnswerFormat = 'structured-exact' | 'complete-exact-text' | 'empty';

export type StudyRubricCategory =
  | 'purpose'
  | 'scope-trigger'
  | 'actor'
  | 'power-duty'
  | 'required-material'
  | 'procedure'
  | 'notice'
  | 'deadline-number'
  | 'limit-exception'
  | 'legal-effect'
  | 'filing-record'
  | 'survey-relevance'
  | 'related-provision'
  | 'custom';

export type StudyUnitType = 'section' | 'whole-act' | 'survey-law-case' | 'custom-principle' | 'custom';

export type StudyResponseMode = 'guided' | 'free-recall' | 'hybrid';

export type StudyGeneratedContentState = {
  title: StudyGeneratedFieldState;
  question: StudyGeneratedFieldState;
  referenceAnswer: StudyGeneratedFieldState;
  editableSummary: StudyGeneratedFieldState;
  concepts: StudyGeneratedFieldState;
  rubrics?: StudyGeneratedFieldState;
};

export type StudySourceMode = 'official' | 'custom';

export type StudySourceCitationSummary = {
  text: string;
  officialSource?: string;
  consolidatedTo?: string;
};

export type StudyFileAsset = {
  id: string;
  role: StudyFileRole;
  label: string;
  storagePath: string;
  mediaType: string;
  byteLength: number;
  createdAt: string;
};

export type StudyDocument = {
  id: string;
  title: string;
  kind: StudyDocumentKind;
  jurisdiction: string;
  category: string;
  priority: StudyPriority;
  citation?: string;
  summary: string;
  sourceFiles: StudyFileAsset[];
  createdAt: string;
  updatedAt: string;
};

export type StudySectionRef = {
  documentId: string;
  label: string;
  anchor?: string;
};

export type StudyUnit = {
  id: string;
  title: string;
  sourceMode: StudySourceMode;
  documentIds: string[];
  sectionRefs: StudySectionRef[];
  sourceReferences?: StudySourceReference[];
  sourceCitationSummary?: StudySourceCitationSummary;
  generatedContentState?: StudyGeneratedContentState;
  sourceReviewRequired?: boolean;
  sourceReferenceMissing?: boolean;
  sourceReviewAcknowledgedAt?: string;
  category: string;
  priority: StudyPriority;
  promptKind?: StudyPromptKind;
  phase?: StudyPhase;
  unitType?: StudyUnitType;
  responseModeOverride?: StudyResponseMode;
  tags?: string[];
  notesCitationText?: string;
  customSourceUrl?: string;
  editableSummary: string;
  referenceAnswer: string;
  createdAt: string;
  updatedAt: string;
};

export type StudyPrompt = {
  id: string;
  unitId: string;
  kind: StudyPromptKind;
  question: string;
  referenceAnswer: string;
  conceptIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudyConcept = {
  id: string;
  unitId: string;
  label: string;
  explanation?: string;
  required: boolean;
  origin: 'generated' | 'manual';
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyRubricItem = {
  id: string;
  unitId: string;
  category: StudyRubricCategory;
  prompt: string;
  referenceAnswer: string;
  required: boolean;
  origin: 'generated' | 'manual';
  order: number;
  sourceReferences?: StudySourceReference[];
  createdAt: string;
  updatedAt: string;
};

export type StudyRubricCoverageStatus = 'covered' | 'partially-covered' | 'missed';

export type StudyRubricCoverage = {
  rubricItemId: string;
  status: StudyRubricCoverageStatus;
};

export type StudyProgress = {
  unitId: string;
  phase: StudyPhase;
  dueAt: string;
  lastStudiedAt: string | null;
  successfulGuidedRecallDays: string[];
  successfulFreeRecallDays: string[];
  applicationSuccessCount: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyAttempt = {
  id: string;
  unitId: string;
  promptId: string;
  phase: StudyPhase;
  answer: string;
  responseMode?: StudyResponseMode;
  guidedResponses?: Record<string, string>;
  coveredConceptIds: string[];
  rubricCoverage?: StudyRubricCoverage[];
  rating: StudyRating;
  startedAt: string;
  revealedAt: string;
  completedAt: string;
};

export type StudyDraft = {
  id: string;
  unitId: string;
  promptId: string;
  answer: string;
  responseMode?: StudyResponseMode;
  guidedResponses?: Record<string, string>;
  startedAt: string;
  updatedAt: string;
};

export type StudyPhaseRules = {
  guidedRecallSuccessDaysToFreeRecall: number;
  freeRecallSuccessDaysToApplication: number;
  applicationSuccessesToMaintenance: number;
};

export type StudySettings = {
  id: 'default';
  schemaVersion: number;
  phaseRules: StudyPhaseRules;
  newUnitPriorityLimit: StudyPriority;
  includeMaintenanceReviews: boolean;
  studySidebarCollapsed?: boolean;
  updatedAt: string;
};

export type StudySourceReference = {
  documentId: string;
  sourceKey: string;
  contentHashAtLinkTime: string;
};

export type ImportedLegalDocument = {
  id: string;
  packageId: string;
  manifestId: string;
  officialTitle: string;
  officialCitationDisplay: string;
  officialCitationNormalized: string;
  officialNumberDisplay?: string;
  officialNumberNormalized?: string;
  documentType: 'act' | 'regulation';
  parentActId?: string;
  enablingActs?: Array<{ title: string; citation?: string }>;
  sourceUrl: string;
  fetchDate: string;
  consolidatedTo?: string;
  contentHash: string;
  importedAt: string;
  packageCreatedAt: string;
};

export type ImportedLegalSubsection = {
  id: string;
  sourceKey: string;
  label: string;
  text: string;
  contentHash: string;
};

export type ImportedLegalComponent = {
  documentId: string;
  id: string;
  sourceKey: string;
  componentType: 'section' | 'schedule' | 'form' | 'appendix' | 'part-heading' | 'division-heading';
  label: string;
  heading?: string;
  text: string;
  contentHash: string;
  subsections?: ImportedLegalSubsection[];
  extractionStatus: 'complete' | 'reference-only' | 'unknown';
};

export type StudyOfficialImportHistory = {
  id: string;
  packageId: string;
  manifestId: string;
  packageCreatedAt: string;
  importedAt: string;
  addedDocuments: number;
  changedDocuments: number;
  addedComponents: number;
  changedComponents: number;
  removedComponents: number;
  referenceOnlyForms: number;
  unitsFlaggedForReview: number;
  result: 'success' | 'failed';
  message: string;
};

export type StudyDataSnapshot = {
  schemaVersion: number;
  exportedAt: string;
  documents: StudyDocument[];
  units: StudyUnit[];
  prompts: StudyPrompt[];
  concepts: StudyConcept[];
  rubrics: StudyRubricItem[];
  progress: StudyProgress[];
  attempts: StudyAttempt[];
  drafts: StudyDraft[];
  settings: StudySettings;
  legalDocuments: ImportedLegalDocument[];
  legalComponents: ImportedLegalComponent[];
  importHistory: StudyOfficialImportHistory[];
};

export type StudySessionItem = {
  unit: StudyUnit;
  prompt: StudyPrompt;
  progress: StudyProgress;
  concepts: StudyConcept[];
  rubrics: StudyRubricItem[];
  due: boolean;
};
