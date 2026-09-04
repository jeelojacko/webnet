/// <reference lib="webworker" />

import type MiniSearch from 'minisearch';
import type { ImportedLegalComponent, ImportedLegalDocument, StudyDataSnapshot } from '../studyTypes';
import {
  buildDocumentSearchRecords,
  buildOfficialProvisionSearchRecord,
  buildStudyUnitSearchRecord,
  corpusContentHashFor,
  studyContentRevisionFor,
} from './studySearchDocuments';
import {
  createMiniSearch,
  deserializeMiniSearch,
  MINISEARCH_VERSION,
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_INDEX_VERSION,
  serializeMiniSearch,
} from './studySearchMiniSearch';
import {
  clearSearchArtifacts,
  openStudySearchDatabase,
  readSearchArtifact,
  readSearchDiagnostics,
  readSearchMetadata,
  writeSearchArtifact,
  writeSearchMetadata,
} from './studySearchPersistence';
import { buildMatchedSnippet, exactSearchBoost } from './studySearchRanking';
import type { StudySearchWorkerRequest, StudySearchWorkerResponse } from './studySearchMessages';
import type { StudySearchRecord, StudySearchResultSummary, StudySearchScope } from './studySearchTypes';

type StoreName =
  | 'documents'
  | 'units'
  | 'prompts'
  | 'concepts'
  | 'rubrics'
  | 'progress'
  | 'attempts'
  | 'drafts'
  | 'settings'
  | 'legalDocuments'
  | 'legalComponents'
  | 'importHistory'
  | 'aiAuthoringRuns'
  | 'aiStudyMapProposals'
  | 'aiUnitProposals';

type WorkerState = {
  officialIndex: MiniSearch<StudySearchRecord> | null;
  studyIndex: MiniSearch<StudySearchRecord> | null;
  latestSearchRequestId: string | null;
};

const state: WorkerState = {
  officialIndex: null,
  studyIndex: null,
  latestSearchRequestId: null,
};

const post = (message: StudySearchWorkerResponse): void => {
  self.postMessage(message);
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });

const readStore = async <T>(db: IDBDatabase, storeName: StoreName): Promise<T[]> => {
  const transaction = db.transaction(storeName, 'readonly');
  const records = (await requestToPromise(transaction.objectStore(storeName).getAll())) as T[];
  await transactionDone(transaction);
  return records;
};

const readSnapshotWithoutLegalText = async (db: IDBDatabase): Promise<StudyDataSnapshot> => {
  const [documents, units, prompts, concepts, rubrics, progress, attempts, drafts, settings, legalDocuments, importHistory] =
    await Promise.all([
      readStore(db, 'documents'),
      readStore(db, 'units'),
      readStore(db, 'prompts'),
      readStore(db, 'concepts'),
      readStore(db, 'rubrics'),
      readStore(db, 'progress'),
      readStore(db, 'attempts'),
      readStore(db, 'drafts'),
      readStore(db, 'settings'),
      readStore(db, 'legalDocuments'),
      readStore(db, 'importHistory'),
    ]);
  return {
    schemaVersion: 8,
    exportedAt: new Date().toISOString(),
    documents,
    units,
    prompts,
    concepts,
    rubrics,
    progress,
    attempts,
    drafts,
    settings: settings[0],
    legalDocuments,
    legalComponents: [],
    importHistory,
    aiAuthoringRuns: [],
    aiStudyMapProposals: [],
    aiUnitProposals: [],
    examPrepUnitProgress: [],
    examPrepRecallProgress: [],
    examPrepAttempts: [],
    examPrepSettings: [],
  } as StudyDataSnapshot;
};

const buildOfficialIndex = async (
  db: IDBDatabase,
  requestId: string,
): Promise<{ index: MiniSearch<StudySearchRecord>; corpusContentHash: string; recordCount: number }> => {
  const legalDocuments = await readStore<ImportedLegalDocument>(db, 'legalDocuments');
  const documentsById = new Map(legalDocuments.map((document) => [document.id, document]));
  const legalComponents = await readStore<ImportedLegalComponent & { recordKey?: string }>(
    db,
    'legalComponents',
  );
  const index = createMiniSearch();
  index.addAll(buildDocumentSearchRecords(legalDocuments));
  let indexed = legalDocuments.length;
  for (const component of legalComponents) {
    index.add(
      buildOfficialProvisionSearchRecord({
        document: documentsById.get(component.documentId),
        component,
      }),
    );
    indexed += 1;
    if (indexed % 250 === 0) {
      post({
        type: 'progress',
        requestId,
        status: {
          ready: false,
          phase: 'building',
          message: `Indexing official legislation ${indexed} / ${legalDocuments.length + legalComponents.length}`,
          indexed,
          total: legalDocuments.length + legalComponents.length,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { index, corpusContentHash: corpusContentHashFor(legalDocuments), recordCount: indexed };
};

const buildStudyIndex = async (
  db: IDBDatabase,
): Promise<{ index: MiniSearch<StudySearchRecord>; contentRevision: number; recordCount: number }> => {
  const snapshot = await readSnapshotWithoutLegalText(db);
  const index = createMiniSearch();
  const records = snapshot.units.map((unit) => buildStudyUnitSearchRecord(snapshot, unit));
  index.addAll(records);
  return {
    index,
    contentRevision: studyContentRevisionFor(snapshot),
    recordCount: records.length,
  };
};

const metadataIsCurrent = (
  metadata: Awaited<ReturnType<typeof readSearchMetadata>>,
  corpusContentHash: string,
  studyContentRevision: number,
): boolean =>
  Boolean(
    metadata &&
      metadata.schemaVersion === SEARCH_INDEX_SCHEMA_VERSION &&
      metadata.indexVersion === SEARCH_INDEX_VERSION &&
      metadata.engine === 'minisearch' &&
      metadata.engineVersion === MINISEARCH_VERSION &&
      metadata.officialIndex.corpusContentHash === corpusContentHash &&
      metadata.studyIndex.contentRevision === studyContentRevision,
  );

const loadOrBuildIndexes = async (requestId: string, forceRebuild = false): Promise<void> => {
  post({
    type: 'progress',
    requestId,
    status: { ready: false, phase: 'loading', message: 'Preparing search index...' },
  });
  const db = await openStudySearchDatabase();
  try {
    const legalDocuments = await readStore<ImportedLegalDocument>(db, 'legalDocuments');
    const snapshot = await readSnapshotWithoutLegalText(db);
    const corpusContentHash = corpusContentHashFor(legalDocuments);
    const studyContentRevision = studyContentRevisionFor(snapshot);
    const metadata = await readSearchMetadata(db);
    const officialArtifact = await readSearchArtifact(db, 'official');
    const studyArtifact = await readSearchArtifact(db, 'study');

    if (
      !forceRebuild &&
      metadataIsCurrent(metadata, corpusContentHash, studyContentRevision) &&
      officialArtifact &&
      studyArtifact
    ) {
      try {
        state.officialIndex = await deserializeMiniSearch(officialArtifact.serialized);
        state.studyIndex = await deserializeMiniSearch(studyArtifact.serialized);
        post({
          type: 'ready',
          requestId,
          status: { ready: true, phase: 'ready', message: 'Search index ready.' },
        });
        return;
      } catch (error) {
        console.warn('Study search index could not be deserialized; rebuilding.', error);
        await clearSearchArtifacts(db);
      }
    }

    const official = await buildOfficialIndex(db, requestId);
    const study = await buildStudyIndex(db);
    state.officialIndex = official.index;
    state.studyIndex = study.index;
    await writeSearchArtifact(db, 'official', serializeMiniSearch(official.index));
    await writeSearchArtifact(db, 'study', serializeMiniSearch(study.index));
    await writeSearchMetadata(db, {
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      indexVersion: SEARCH_INDEX_VERSION,
      engine: 'minisearch',
      engineVersion: MINISEARCH_VERSION,
      officialIndex: {
        corpusContentHash: official.corpusContentHash,
        builtAt: new Date().toISOString(),
        recordCount: official.recordCount,
      },
      studyIndex: {
        contentRevision: study.contentRevision,
        builtAt: new Date().toISOString(),
        recordCount: study.recordCount,
      },
    });
    post({
      type: 'ready',
      requestId,
      status: { ready: true, phase: 'ready', message: 'Search index ready.' },
    });
  } finally {
    db.close();
  }
};

const rebuildStudyIndexOnly = async (requestId: string): Promise<void> => {
  const db = await openStudySearchDatabase();
  try {
    let metadata = await readSearchMetadata(db);
    const officialArtifact = await readSearchArtifact(db, 'official');
    if (!metadata || !officialArtifact || !state.officialIndex) {
      await loadOrBuildIndexes(requestId);
      metadata = await readSearchMetadata(db);
    }
    if (!metadata) return;
    const study = await buildStudyIndex(db);
    state.studyIndex = study.index;
    await writeSearchArtifact(db, 'study', serializeMiniSearch(study.index));
    await writeSearchMetadata(db, {
      ...metadata,
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      indexVersion: SEARCH_INDEX_VERSION,
      engineVersion: MINISEARCH_VERSION,
      studyIndex: {
        contentRevision: study.contentRevision,
        builtAt: new Date().toISOString(),
        recordCount: study.recordCount,
      },
    });
    post({
      type: 'ready',
      requestId,
      status: { ready: true, phase: 'ready', message: 'Study search index updated.' },
    });
  } finally {
    db.close();
  }
};

const postDiagnostics = async (requestId: string): Promise<void> => {
  const db = await openStudySearchDatabase();
  try {
    post({
      type: 'diagnostics',
      requestId,
      diagnostics: await readSearchDiagnostics(db),
    });
  } finally {
    db.close();
  }
};

const exactBoost = (query: string, result: StudySearchResultSummary): number => {
  return exactSearchBoost({
    query,
    result,
    snippetText: result.snippet ?? '',
  });
};

const toSummary = (
  result: Record<string, unknown> & { id: string; score: number },
): StudySearchResultSummary => ({
  id: result.id,
  entityType: result.entityType as StudySearchResultSummary['entityType'],
  entityId: String(result.entityId),
  title: String(result.title || result.id),
  subtitle: String(result.citation || result.heading || ''),
  citation: typeof result.citation === 'string' ? result.citation : undefined,
  documentId: typeof result.documentId === 'string' ? result.documentId : undefined,
  sourceKey: typeof result.sourceKey === 'string' ? result.sourceKey : undefined,
  unitId: typeof result.unitId === 'string' ? result.unitId : undefined,
  snippet:
    typeof result.snippetText === 'string'
      ? result.snippetText
      : typeof result.excerpt === 'string'
        ? result.excerpt
        : undefined,
  score: result.score,
});

const limitByCategory = (
  query: string,
  results: StudySearchResultSummary[],
  limitPerCategory: number,
): StudySearchResultSummary[] => {
  const byType = new Map<string, StudySearchResultSummary[]>();
  for (const result of results) {
    const snippetSource = result.snippet ?? '';
    const boosted = {
      ...result,
      snippet: buildMatchedSnippet({ text: snippetSource, query }),
      score: result.score + exactBoost(query, result),
    };
    byType.set(boosted.entityType, [...(byType.get(boosted.entityType) ?? []), boosted]);
  }
  return Array.from(byType.values())
    .flatMap((categoryResults) =>
      categoryResults.sort((left, right) => right.score - left.score).slice(0, limitPerCategory),
    )
    .sort((left, right) => right.score - left.score);
};

const runSearch = (message: Extract<StudySearchWorkerRequest, { type: 'search' }>): void => {
  state.latestSearchRequestId = message.requestId;
  const startedAt = performance.now();
  const query = message.query.trim();
  if (!query) {
    post({ type: 'results', requestId: message.requestId, results: [], elapsedMs: 0 });
    return;
  }
  const results: StudySearchResultSummary[] = [];
  const searchOptions = {
    prefix: (term: string) => term.length >= 3,
    fuzzy: (term: string) => (term.length >= 5 ? 0.16 : false),
    boost: {
      title: 8,
      citation: 10,
      heading: 6,
      metadataText: 4,
      fullText: 1,
    },
  };
  const collect = (index: MiniSearch<StudySearchRecord> | null) => {
    if (!index) return [];
    const andResults = index.search(query, { ...searchOptions, combineWith: 'AND' }).map(toSummary);
    const seen = new Set(andResults.map((result) => result.id));
    const orResults = index
      .search(query, searchOptions)
      .map(toSummary)
      .filter((result) => !seen.has(result.id));
    return [...andResults, ...orResults];
  };
  if (message.scope === 'all' || message.scope === 'documents' || message.scope === 'official-provisions') {
    results.push(
      ...collect(state.officialIndex).filter(
        (result) =>
          message.scope === 'all' ||
          (message.scope === 'documents' && result.entityType === 'document') ||
          (message.scope === 'official-provisions' && result.entityType === 'official-provision'),
      ),
    );
  }
  if (message.scope === 'all' || message.scope === 'study-units') {
    results.push(...collect(state.studyIndex));
  }
  if (state.latestSearchRequestId !== message.requestId) return;
  post({
    type: 'results',
    requestId: message.requestId,
    results: limitByCategory(query, results, message.limitPerCategory ?? 8),
    elapsedMs: Math.round(performance.now() - startedAt),
  });
};

self.onmessage = (event: MessageEvent<StudySearchWorkerRequest>) => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === 'initialize') await loadOrBuildIndexes(message.requestId);
      if (message.type === 'rebuild') await loadOrBuildIndexes(message.requestId, true);
      if (message.type === 'study-bulk-update') await rebuildStudyIndexOnly(message.requestId);
      if (message.type === 'diagnostics') await postDiagnostics(message.requestId);
      if (message.type === 'search') {
        if (!state.officialIndex || !state.studyIndex) await loadOrBuildIndexes(message.requestId);
        runSearch(message);
      }
    } catch (error) {
      post({
        type: 'error',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
