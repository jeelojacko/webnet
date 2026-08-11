import type {
  StudySearchDiagnostics,
  StudySearchIndexKind,
  StudySearchIndexMetadata,
} from './studySearchTypes';

const DB_NAME = 'webnet.study.v1';
const DB_VERSION = 6;

type SearchArtifactRecord = {
  id: string;
  kind: StudySearchIndexKind;
  serialized: string;
  updatedAt: string;
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

export const openStudySearchDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof globalThis.indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open Study database.'));
  });

export const readSearchMetadata = async (
  db: IDBDatabase,
): Promise<StudySearchIndexMetadata | null> => {
  const transaction = db.transaction('searchIndexMetadata', 'readonly');
  const record = (await requestToPromise(
    transaction.objectStore('searchIndexMetadata').get('current'),
  )) as (StudySearchIndexMetadata & { id: string }) | undefined;
  await transactionDone(transaction);
  if (!record) return null;
  const { id: _id, ...metadata } = record;
  return metadata;
};

export const writeSearchMetadata = async (
  db: IDBDatabase,
  metadata: StudySearchIndexMetadata,
): Promise<void> => {
  const transaction = db.transaction('searchIndexMetadata', 'readwrite');
  transaction.objectStore('searchIndexMetadata').put({ id: 'current', ...metadata });
  await transactionDone(transaction);
};

export const readSearchArtifact = async (
  db: IDBDatabase,
  kind: StudySearchIndexKind,
): Promise<SearchArtifactRecord | null> => {
  const transaction = db.transaction('searchIndexArtifacts', 'readonly');
  const record = (await requestToPromise(
    transaction.objectStore('searchIndexArtifacts').get(`${kind}-fulltext`),
  )) as SearchArtifactRecord | undefined;
  await transactionDone(transaction);
  return record ?? null;
};

export const writeSearchArtifact = async (
  db: IDBDatabase,
  kind: StudySearchIndexKind,
  serialized: string,
): Promise<void> => {
  const transaction = db.transaction('searchIndexArtifacts', 'readwrite');
  transaction.objectStore('searchIndexArtifacts').put({
    id: `${kind}-fulltext`,
    kind,
    serialized,
    updatedAt: new Date().toISOString(),
  });
  await transactionDone(transaction);
};

export const clearSearchArtifacts = async (db: IDBDatabase): Promise<void> => {
  const transaction = db.transaction(['searchIndexMetadata', 'searchIndexArtifacts'], 'readwrite');
  transaction.objectStore('searchIndexMetadata').clear();
  transaction.objectStore('searchIndexArtifacts').clear();
  await transactionDone(transaction);
};

export const readSearchDiagnostics = async (db: IDBDatabase): Promise<StudySearchDiagnostics> => {
  const metadata = await readSearchMetadata(db);
  const official = await readSearchArtifact(db, 'official');
  const study = await readSearchArtifact(db, 'study');
  const officialArtifactBytes = official?.serialized.length ?? 0;
  const studyArtifactBytes = study?.serialized.length ?? 0;
  return {
    metadata,
    officialArtifactBytes,
    studyArtifactBytes,
    totalArtifactBytes: officialArtifactBytes + studyArtifactBytes,
  };
};
