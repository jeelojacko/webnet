export type StudySearchEntityType =
  | 'document'
  | 'official-provision'
  | 'study-unit'
  | 'custom-unit';

export type StudySearchScope = 'all' | 'documents' | 'official-provisions' | 'study-units';

export type StudySearchRecord = {
  id: string;
  entityType: StudySearchEntityType;
  entityId: string;
  documentId?: string;
  sourceKey?: string;
  unitId?: string;
  title?: string;
  citation?: string;
  heading?: string;
  metadataText?: string;
  fullText?: string;
  excerpt?: string;
};

export type StudySearchResultSummary = {
  id: string;
  entityType: StudySearchEntityType;
  entityId: string;
  title: string;
  subtitle?: string;
  citation?: string;
  documentId?: string;
  sourceKey?: string;
  unitId?: string;
  snippet?: string;
  score: number;
};

export type StudySearchIndexKind = 'official' | 'study';

export type StudySearchIndexMetadata = {
  schemaVersion: number;
  indexVersion: number;
  engine: 'minisearch';
  engineVersion: string;
  officialIndex: {
    corpusContentHash: string;
    builtAt: string;
    recordCount: number;
  };
  studyIndex: {
    contentRevision: number;
    builtAt: string;
    recordCount: number;
  };
};

export type StudySearchStatus = {
  ready: boolean;
  phase: 'idle' | 'loading' | 'building' | 'ready' | 'error';
  message: string;
  indexed?: number;
  total?: number;
};
