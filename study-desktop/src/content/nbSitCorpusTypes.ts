export type SitCorpusDocumentType = 'act' | 'regulation';

export type SitCorpusSourceType = 'laws-gnb-html' | 'official-pdf';

export type SitCorpusSourceStatus = 'current' | 'legacy-replaced' | 'private-or-professional-act';

export type SitCorpusExamScope = 'required' | 'candidate' | 'excluded';

export type SitCorpusExamSource = {
  source: 'ANBLS-SIT-manual';
  order?: number;
  note?: string;
};

export type SitCorpusManifestDocument = {
  id: string;
  type: SitCorpusDocumentType;
  title: string;
  citation?: string;
  sourceUrl: string;
  sourceType?: SitCorpusSourceType;
  sourceAuthority?: string;
  sourceIdentifier?: string;
  sourceCorpus?: 'cs' | 'cr' | 'ar';
  examScope: SitCorpusExamScope;
  examSource?: SitCorpusExamSource;
  manualSource?: ManualScopeMapping;
  pdfSelector?: {
    language: 'en';
    side?: 'left' | 'right';
    startPage?: number;
    endPage?: number;
    note?: string;
  };
  parentActId?: string;
  expectedEnablingAct?: string;
  existingPilot?: boolean;
};

export type ManualScopeMapping = {
  manualEntryId: string;
  manualTitle: string;
  historicalCitation?: string;
  sourceStatus: SitCorpusSourceStatus;
  currentDocumentId?: string;
  temporarilyStudySuccessor?: boolean;
  duplicateSuccessorContent?: boolean;
  registrarConfirmationRequired?: boolean;
  historicalTextAvailable?: boolean;
  notes?: string;
};

export type SitCorpusManifest = {
  schemaVersion: 1;
  corpusId: string;
  title: string;
  sourceAuthority: string;
  expectedRequiredActCount: number;
  manualScopeMappings?: ManualScopeMapping[];
  documents: SitCorpusManifestDocument[];
};

export type SitCorpusInventoryFinding = {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  documentId?: string;
  message: string;
};

export type SitCorpusInventoryReport = {
  corpusId: string;
  title: string;
  generatedAt: string;
  manifestHash: string;
  expectedActCount: number;
  actualRequiredActCount: number;
  requiredRegulationCount: number;
  candidateRegulationCount: number;
  missingSourceUrls: string[];
  duplicateTitles: string[];
  duplicateIds: string[];
  unresolvedParentActs: string[];
  unknownCitations: string[];
  pilotDocuments: string[];
  awaitingManualConfirmation: string[];
  findings: SitCorpusInventoryFinding[];
};

export type SitCorpusFetchStatusValue =
  | 'success'
  | 'unchanged'
  | 'changed'
  | 'failed'
  | 'not-attempted';

export type SitCorpusFetchStatusEntry = {
  documentId: string;
  sourceUrl: string;
  status: SitCorpusFetchStatusValue;
  fetchedAt?: string;
  sourceHash?: string;
  previousSourceHash?: string;
  error?: string;
  attempts?: number;
};

export type SitCorpusFetchStatusReport = {
  corpusId: string;
  generatedAt: string;
  documents: SitCorpusFetchStatusEntry[];
};

export type SitSourceChangeType = 'unchanged' | 'added' | 'changed' | 'removed';

export type SitSourceChange = {
  documentId: string;
  citation?: string;
  sourceKey: string;
  oldHash?: string;
  newHash?: string;
  changeType: SitSourceChangeType;
};
