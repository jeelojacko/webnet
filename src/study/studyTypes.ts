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

export type StudyGeneratedContentState = {
  title: StudyGeneratedFieldState;
  question: StudyGeneratedFieldState;
  referenceAnswer: StudyGeneratedFieldState;
  editableSummary: StudyGeneratedFieldState;
  concepts: StudyGeneratedFieldState;
};

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
  required: boolean;
  createdAt: string;
  updatedAt: string;
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
  coveredConceptIds: string[];
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
  due: boolean;
};
