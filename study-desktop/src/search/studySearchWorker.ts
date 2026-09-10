/// <reference lib="webworker" />

import type MiniSearch from 'minisearch';
import type { ImportedLegalComponent, ImportedLegalDocument, StudyDataSnapshot } from '../studyTypes';
import { corpusContentHashFor, studyContentRevisionFor } from './studySearchDocuments';
import {
  applyNativeSearchBootstrap,
  applyNativeStudyUpdate,
  buildOfficialSearchIndex,
  buildSearchIndexMetadata,
  buildStudySearchIndex,
  createStudySearchIndexState,
  searchIndexMetadataIsCurrent,
} from './studySearchIndexCore';
import { deserializeMiniSearch, serializeMiniSearch } from './studySearchMiniSearch';
import {
  clearSearchArtifacts,
  openStudySearchDatabase,
  readSearchArtifact,
  readSearchDiagnostics,
  readSearchMetadata,
  writeSearchArtifact,
  writeSearchMetadata,
} from './studySearchPersistence';
import { buildMatchedSnippet, exactSearchBoost, meaningfulSearchTokensFor } from './studySearchRanking';
import { STUDY_DB_VERSION, STUDY_SCHEMA_VERSION } from '../studyDbConfig';
import type { StudySearchWorkerRequest, StudySearchWorkerResponse } from './studySearchMessages';
import type {
  StudySearchIndexMetadata,
  StudySearchRecord,
  StudySearchResultSummary,
} from './studySearchTypes';

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
  | 'aiUnitProposals'
  | 'examPrepUnitProgress'
  | 'examPrepRecallProgress'
  | 'examPrepAttempts'
  | 'examPrepSettings'
  | 'examPrepMockSessions';

type WorkerState = {
  officialIndex: MiniSearch<StudySearchRecord> | null;
  studyIndex: MiniSearch<StudySearchRecord> | null;
  searchMetadata: StudySearchIndexMetadata | null;
  latestSearchRequestId: string | null;
  /**
   * Set synchronously by the `native-arm` message the service posts on
   * worker creation (before the async bootstrap resolves). Once armed, this
   * worker lifetime is native-only and must never open IndexedDB.
   */
  nativeArmed: boolean;
  /** Set once a native bootstrap arrives; the IDB auto-load below then stays off. */
  nativeBootstrapped: boolean;
};

const state: WorkerState = {
  ...createStudySearchIndexState(),
  latestSearchRequestId: null,
  nativeArmed: false,
  nativeBootstrapped: false,
};

const NATIVE_NOT_BOOTSTRAPPED_MESSAGE =
  'Study search is not bootstrapped; rebuild the search index first.';

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
  const [
    documents,
    units,
    prompts,
    concepts,
    rubrics,
    progress,
    attempts,
    drafts,
    settings,
    legalDocuments,
    importHistory,
    examPrepUnitProgress,
    examPrepRecallProgress,
    examPrepAttempts,
    examPrepSettings,
    examPrepMockSessions,
  ] = await Promise.all([
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
    readStore(db, 'examPrepUnitProgress'),
    readStore(db, 'examPrepRecallProgress'),
    readStore(db, 'examPrepAttempts'),
    readStore(db, 'examPrepSettings'),
    readStore(db, 'examPrepMockSessions'),
  ]);
  return {
    // v10-shaped snapshot (schema + the five Exam Prep stores) so the worker's
    // study content revision never reflects an outdated shape.
    schemaVersion: STUDY_SCHEMA_VERSION,
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
    examPrepUnitProgress,
    examPrepRecallProgress,
    examPrepAttempts,
    examPrepSettings,
    examPrepMockSessions,
  } as StudyDataSnapshot;
};

const buildOfficialIndex = async (
  db: IDBDatabase,
  requestId: string,
): Promise<{ index: MiniSearch<StudySearchRecord>; corpusContentHash: string; recordCount: number }> => {
  const legalDocuments = await readStore<ImportedLegalDocument>(db, 'legalDocuments');
  const legalComponents = await readStore<ImportedLegalComponent & { recordKey?: string }>(
    db,
    'legalComponents',
  );
  return buildOfficialSearchIndex({
    legalDocuments,
    legalComponents,
    requestId,
    onProgress: post,
  });
};

const buildStudyIndex = async (
  db: IDBDatabase,
): Promise<{ index: MiniSearch<StudySearchRecord>; contentRevision: number; recordCount: number }> =>
  buildStudySearchIndex(await readSnapshotWithoutLegalText(db));

const metadataIsCurrent = (
  metadata: Awaited<ReturnType<typeof readSearchMetadata>>,
  corpusContentHash: string,
  studyContentRevision: number,
): boolean =>
  searchIndexMetadataIsCurrent({
    metadata,
    corpusContentHash,
    studyContentRevision,
    // DB-version drift guard: the index is current only when it was built
    // against the SAME IndexedDB open version the Study storage layer uses.
    dbVersion: STUDY_DB_VERSION,
  });

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
    const freshMetadata = buildSearchIndexMetadata({
      dbVersion: STUDY_DB_VERSION,
      corpusContentHash: official.corpusContentHash,
      officialRecordCount: official.recordCount,
      studyContentRevision: study.contentRevision,
      studyRecordCount: study.recordCount,
    });
    state.searchMetadata = freshMetadata;
    await writeSearchMetadata(db, freshMetadata);
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
    const refreshed: typeof metadata = {
      ...metadata,
      ...buildSearchIndexMetadata({
        dbVersion: STUDY_DB_VERSION,
        corpusContentHash: metadata.officialIndex.corpusContentHash,
        officialRecordCount: metadata.officialIndex.recordCount,
        studyContentRevision: study.contentRevision,
        studyRecordCount: study.recordCount,
      }),
      officialIndex: metadata.officialIndex,
    };
    state.searchMetadata = refreshed;
    await writeSearchMetadata(db, refreshed);
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
    const meaningfulTokens = meaningfulSearchTokensFor(query);
    const fallbackQuery = meaningfulTokens.length > 0 ? meaningfulTokens.join(' ') : '';
    if (!fallbackQuery) return andResults;
    const orResults = index
      .search(fallbackQuery, searchOptions)
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
      if (message.type === 'native-arm') {
        // Synchronous fail-closed latch: this worker lifetime is native-only
        // from here on, even if the async bootstrap is still pending or fails.
        state.nativeArmed = true;
        return;
      }
      if (
        state.nativeArmed &&
        (message.type === 'initialize' ||
          message.type === 'rebuild' ||
          message.type === 'study-bulk-update' ||
          message.type === 'diagnostics')
      ) {
        // Browser-path messages on a native-armed worker: fail closed, never
        // open IndexedDB. The service owns the native bootstrap instead.
        throw new Error(NATIVE_NOT_BOOTSTRAPPED_MESSAGE);
      }
      if (message.type === 'initialize') await loadOrBuildIndexes(message.requestId);
      if (message.type === 'rebuild') await loadOrBuildIndexes(message.requestId, true);
      if (message.type === 'study-bulk-update') await rebuildStudyIndexOnly(message.requestId);
      if (message.type === 'diagnostics') await postDiagnostics(message.requestId);
      if (message.type === 'native-bootstrap') {
        state.nativeBootstrapped = true;
        await applyNativeSearchBootstrap({ state, message, post });
      }
      if (message.type === 'native-study-update') {
        state.nativeBootstrapped = true;
        await applyNativeStudyUpdate({ state, message, post });
      }
      if (message.type === 'search') {
        if (!state.officialIndex || !state.studyIndex) {
          // Native-armed/bootstrapped workers never touch IndexedDB, even
          // lazily: the service owns a fresh bootstrap instead (fail-closed
          // here). `nativeArmed` covers the pre-bootstrap race where a search
          // arrives before (or after a failed) async bootstrap.
          if (state.nativeArmed || state.nativeBootstrapped) {
            throw new Error(NATIVE_NOT_BOOTSTRAPPED_MESSAGE);
          }
          await loadOrBuildIndexes(message.requestId);
        }
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
