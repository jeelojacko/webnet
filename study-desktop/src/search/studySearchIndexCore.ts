// Study search — pure index build/validate core (Phase 2G).
//
// Shared by the browser worker path (IndexedDB-sourced records) and the
// Tauri native bootstrap path (main-thread-supplied records). No IndexedDB,
// no IPC, no worker globals here, so this module runs in Node tests and is
// safe on either backend. The MiniSearch algorithm/options live only in
// `studySearchMiniSearch.ts` and are NOT duplicated.

import type MiniSearch from 'minisearch';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyDataSnapshot,
} from '../studyTypes';
import {
  buildDocumentSearchRecords,
  buildOfficialProvisionSearchRecord,
  buildStudyUnitSearchRecord,
  corpusContentHashFor,
  studyContentRevisionFor,
} from './studySearchDocuments';
import type {
  StudySearchNativeBootstrapMessage,
  StudySearchNativeStudyUpdateMessage,
  StudySearchWorkerResponse,
} from './studySearchMessages';
import {
  createMiniSearch,
  deserializeMiniSearch,
  MINISEARCH_VERSION,
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_INDEX_VERSION,
  serializeMiniSearch,
} from './studySearchMiniSearch';
import type {
  StudySearchIndexMetadata,
  StudySearchRecord,
} from './studySearchTypes';

export type StudySearchIndexState = {
  officialIndex: MiniSearch<StudySearchRecord> | null;
  studyIndex: MiniSearch<StudySearchRecord> | null;
  searchMetadata: StudySearchIndexMetadata | null;
};

export const createStudySearchIndexState = (): StudySearchIndexState => ({
  officialIndex: null,
  studyIndex: null,
  searchMetadata: null,
});

export const buildOfficialSearchIndex = async ({
  legalDocuments,
  legalComponents,
  requestId,
  onProgress,
}: {
  legalDocuments: ImportedLegalDocument[];
  legalComponents: ImportedLegalComponent[];
  requestId: string;
  onProgress?: (_message: Extract<StudySearchWorkerResponse, { type: 'progress' }>) => void;
}): Promise<{ index: MiniSearch<StudySearchRecord>; corpusContentHash: string; recordCount: number }> => {
  const documentsById = new Map(legalDocuments.map((document) => [document.id, document]));
  const index = createMiniSearch();
  index.addAll(buildDocumentSearchRecords(legalDocuments));
  let indexed = legalDocuments.length;
  const total = legalDocuments.length + legalComponents.length;
  for (const component of legalComponents) {
    index.add(
      buildOfficialProvisionSearchRecord({
        document: documentsById.get(component.documentId),
        component,
      }),
    );
    indexed += 1;
    if (indexed % 250 === 0) {
      onProgress?.({
        type: 'progress',
        requestId,
        status: {
          ready: false,
          phase: 'building',
          message: `Indexing official legislation ${indexed} / ${total}`,
          indexed,
          total,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { index, corpusContentHash: corpusContentHashFor(legalDocuments), recordCount: indexed };
};

export const buildStudySearchIndex = (
  snapshot: StudyDataSnapshot,
): { index: MiniSearch<StudySearchRecord>; contentRevision: number; recordCount: number } => {
  const index = createMiniSearch();
  const records = snapshot.units.map((unit) => buildStudyUnitSearchRecord(snapshot, unit));
  index.addAll(records);
  return {
    index,
    contentRevision: studyContentRevisionFor(snapshot),
    recordCount: records.length,
  };
};

export const searchIndexMetadataIsCurrent = ({
  metadata,
  corpusContentHash,
  studyContentRevision,
  dbVersion,
}: {
  metadata: StudySearchIndexMetadata | null;
  corpusContentHash: string;
  studyContentRevision: number;
  dbVersion: number;
}): boolean =>
  Boolean(
    metadata &&
      metadata.schemaVersion === SEARCH_INDEX_SCHEMA_VERSION &&
      // Storage-version drift guard: the index is current only when it was
      // built against the SAME backing-store version the reader uses
      // (IndexedDB open version on browser, native schema on Tauri).
      metadata.dbVersion === dbVersion &&
      metadata.indexVersion === SEARCH_INDEX_VERSION &&
      metadata.engine === 'minisearch' &&
      metadata.engineVersion === MINISEARCH_VERSION &&
      metadata.officialIndex.corpusContentHash === corpusContentHash &&
      metadata.studyIndex.contentRevision === studyContentRevision,
  );

export const buildSearchIndexMetadata = ({
  dbVersion,
  corpusContentHash,
  officialRecordCount,
  studyContentRevision,
  studyRecordCount,
}: {
  dbVersion: number;
  corpusContentHash: string;
  officialRecordCount: number;
  studyContentRevision: number;
  studyRecordCount: number;
}): StudySearchIndexMetadata => ({
  schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  dbVersion,
  indexVersion: SEARCH_INDEX_VERSION,
  engine: 'minisearch',
  engineVersion: MINISEARCH_VERSION,
  officialIndex: {
    corpusContentHash,
    builtAt: new Date().toISOString(),
    recordCount: officialRecordCount,
  },
  studyIndex: {
    contentRevision: studyContentRevision,
    builtAt: new Date().toISOString(),
    recordCount: studyRecordCount,
  },
});

const postReady = (
  post: (_message: StudySearchWorkerResponse) => void,
  requestId: string,
  message: string,
): void => {
  post({ type: 'ready', requestId, status: { ready: true, phase: 'ready', message } });
};

/**
 * Tauri native bootstrap handler. Builds or restores both indexes purely
 * from the supplied records — never touches IndexedDB. Emits
 * `native-persist` (for the service to write back over native IPC) only when
 * fresh artifacts were built; a valid cache restores silently.
 */
export const applyNativeSearchBootstrap = async ({
  state,
  message,
  post,
}: {
  state: StudySearchIndexState;
  message: StudySearchNativeBootstrapMessage;
  post: (_message: StudySearchWorkerResponse) => void;
}): Promise<void> => {
  post({
    type: 'progress',
    requestId: message.requestId,
    status: { ready: false, phase: 'loading', message: 'Preparing search index...' },
  });
  const corpusContentHash = corpusContentHashFor(message.legalDocuments);
  const studyContentRevision = studyContentRevisionFor(message.snapshot);

  if (
    !message.forceRebuild &&
    searchIndexMetadataIsCurrent({
      metadata: message.cachedMetadata,
      corpusContentHash,
      studyContentRevision,
      dbVersion: message.expectedDbVersion,
    }) &&
    message.cachedMetadata &&
    message.cachedOfficialSerialized &&
    message.cachedStudySerialized
  ) {
    try {
      state.officialIndex = await deserializeMiniSearch(message.cachedOfficialSerialized);
      state.studyIndex = await deserializeMiniSearch(message.cachedStudySerialized);
      state.searchMetadata = message.cachedMetadata;
      postReady(post, message.requestId, 'Search index ready.');
      return;
    } catch {
      // Corrupt cache falls through to a deterministic rebuild; the fresh
      // `native-persist` below overwrites the bad stored artifacts.
    }
  }

  const official = await buildOfficialSearchIndex({
    legalDocuments: message.legalDocuments,
    legalComponents: message.legalComponents,
    requestId: message.requestId,
    onProgress: post,
  });
  const study = buildStudySearchIndex(message.snapshot);
  state.officialIndex = official.index;
  state.studyIndex = study.index;
  const metadata = buildSearchIndexMetadata({
    dbVersion: message.expectedDbVersion,
    corpusContentHash: official.corpusContentHash,
    officialRecordCount: official.recordCount,
    studyContentRevision: study.contentRevision,
    studyRecordCount: study.recordCount,
  });
  state.searchMetadata = metadata;
  post({
    type: 'native-persist',
    requestId: message.requestId,
    metadata,
    officialSerialized: serializeMiniSearch(official.index),
    studySerialized: serializeMiniSearch(study.index),
  });
  postReady(post, message.requestId, 'Search index ready.');
};

/**
 * Tauri native study-only refresh. Requires a prior `native-bootstrap` in
 * the same worker lifetime and matching cached metadata (fail-closed
 * otherwise — never falls back to IndexedDB).
 */
export const applyNativeStudyUpdate = async ({
  state,
  message,
  post,
}: {
  state: StudySearchIndexState;
  message: StudySearchNativeStudyUpdateMessage;
  post: (_message: StudySearchWorkerResponse) => void;
}): Promise<void> => {
  if (!state.officialIndex || !message.cachedMetadata) {
    throw new Error('Study search is not bootstrapped; rebuild the search index first.');
  }
  if (message.cachedMetadata.dbVersion !== message.expectedDbVersion) {
    throw new Error('Study search metadata is stale; rebuild the search index first.');
  }
  const study = buildStudySearchIndex(message.snapshot);
  state.studyIndex = study.index;
  const metadata: StudySearchIndexMetadata = {
    ...message.cachedMetadata,
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    indexVersion: SEARCH_INDEX_VERSION,
    engineVersion: MINISEARCH_VERSION,
    studyIndex: {
      contentRevision: study.contentRevision,
      builtAt: new Date().toISOString(),
      recordCount: study.recordCount,
    },
  };
  state.searchMetadata = metadata;
  post({
    type: 'native-persist',
    requestId: message.requestId,
    metadata,
    officialSerialized: null,
    studySerialized: serializeMiniSearch(study.index),
  });
  postReady(post, message.requestId, 'Study search index updated.');
};
