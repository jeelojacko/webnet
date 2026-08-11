export type SitCorpusDocumentType = 'act' | 'regulation';

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
  sourceIdentifier?: string;
  sourceCorpus?: 'cs' | 'cr' | 'ar';
  examScope: SitCorpusExamScope;
  examSource?: SitCorpusExamSource;
  parentActId?: string;
  expectedEnablingAct?: string;
  existingPilot?: boolean;
};

export type SitCorpusManifest = {
  schemaVersion: 1;
  corpusId: string;
  title: string;
  sourceAuthority: string;
  expectedRequiredActCount: number;
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
