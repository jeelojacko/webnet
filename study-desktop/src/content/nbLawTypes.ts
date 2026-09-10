export type NbLawSourceType = 'act' | 'regulation';

export type NbLawManifestEntry = {
  id: string;
  manualTitle: string;
  currentTitle: string;
  sourceType: NbLawSourceType;
  sourceCorpus?: 'cs' | 'cr' | 'ar';
  sourceIdentifier: string;
  parentActId?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  categories: string[];
  tags: string[];
  expectedCitation?: string;
  enabled: boolean;
};

export type NbLawManifest = {
  schemaVersion: 1;
  id: string;
  title: string;
  sourceBaseUrl: string;
  createdAt: string;
  documents: NbLawManifestEntry[];
};

export type NbLawRawFetchMetadata = {
  documentId: string;
  sourceUrl: string;
  httpStatus: number;
  fetchedAt: string;
  contentHash: string;
};

export type NbLawTableOfContentsItem = {
  id: string;
  sourceKey?: string;
  label: string;
  heading?: string;
};

export type NbLawSubsection = {
  id: string;
  sourceKey: string;
  label: string;
  text: string;
  contentHash: string;
};

export type NbLawSection = {
  id: string;
  sourceKey: string;
  componentType: 'section';
  label: string;
  heading?: string;
  text: string;
  subsections: NbLawSubsection[];
  contentHash: string;
};

export type NbLawSupplementalComponentType = 'schedule' | 'form' | 'appendix' | 'part-heading' | 'division-heading';

export type NbLawSupplementalComponent = {
  id: string;
  sourceKey: string;
  componentType: NbLawSupplementalComponentType;
  label: string;
  heading?: string;
  text: string;
  contentHash: string;
};

export type NbLawDocumentComponent = NbLawSection | NbLawSupplementalComponent;

export type NbLawEnablingAct = {
  title: string;
  citation?: string;
};

export type NbLawNormalizedDocument = {
  schemaVersion: 1;
  id: string;
  officialTitle: string;
  officialCitation?: string;
  officialCitationDisplay?: string;
  officialCitationNormalized?: string;
  officialNumberDisplay?: string;
  officialNumberNormalized?: string;
  documentType: NbLawSourceType;
  parentActId?: string;
  enablingActs?: NbLawEnablingAct[];
  sourceUrl: string;
  fetchDate: string;
  consolidatedTo?: string;
  contentHash: string;
  tableOfContents: NbLawTableOfContentsItem[];
  components: NbLawDocumentComponent[];
  sections: NbLawSection[];
  notes: string[];
};

export type NbLawDocumentIntegrityReport = {
  documentId: string;
  officialTitle: string;
  officialCitation?: string;
  documentType: NbLawSourceType;
  expectedParentAct?: string;
  extractedEnablingActs: NbLawEnablingAct[];
  sourceUrl: string;
  consolidationDate?: string;
  sectionCount: number;
  subsectionCount: number;
  scheduleCount: number;
  formCount: number;
  parsingWarnings: string[];
  boilerplateContamination: {
    ok: boolean;
    markers: string[];
  };
  duplicateSourceKeys: {
    ok: boolean;
    keys: string[];
  };
  tableOfContentsReferences: {
    ok: boolean;
    missingSourceKeys: string[];
  };
  contentHash: string;
  errors: string[];
  warnings: string[];
};

export type NbLawContentPackage = {
  schemaVersion: 1;
  id: string;
  manifestId: string;
  createdAt: string;
  documents: NbLawNormalizedDocument[];
  integrityReport?: {
    createdAt: string;
    documents: NbLawDocumentIntegrityReport[];
    errors: string[];
    warnings: string[];
  };
  relationships: {
    parentActId: string;
    regulationId: string;
  }[];
  sourceHashes: Record<string, string>;
};
