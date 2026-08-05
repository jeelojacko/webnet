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
  label: string;
  heading?: string;
};

export type NbLawSubsection = {
  id: string;
  label: string;
  text: string;
};

export type NbLawSection = {
  id: string;
  label: string;
  heading?: string;
  text: string;
  subsections: NbLawSubsection[];
  contentHash: string;
};

export type NbLawNormalizedDocument = {
  schemaVersion: 1;
  id: string;
  officialTitle: string;
  officialCitation?: string;
  documentType: NbLawSourceType;
  parentActId?: string;
  sourceUrl: string;
  fetchDate: string;
  consolidatedTo?: string;
  contentHash: string;
  tableOfContents: NbLawTableOfContentsItem[];
  sections: NbLawSection[];
  notes: string[];
};

export type NbLawContentPackage = {
  schemaVersion: 1;
  id: string;
  manifestId: string;
  createdAt: string;
  documents: NbLawNormalizedDocument[];
  relationships: {
    parentActId: string;
    regulationId: string;
  }[];
  sourceHashes: Record<string, string>;
};
