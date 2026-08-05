import { createSeedStudyData, createDefaultStudySettings } from './studySeed';
import type { NbLawContentPackage } from './content/nbLawTypes';
import {
  applyOfficialContentPackageToSnapshot,
  upsertStudyDocumentsWithOfficialMetadata,
} from './studyOfficialContent';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyAttempt,
  StudyConcept,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  StudyOfficialImportHistory,
  StudyProgress,
  StudyPrompt,
  StudySettings,
  StudyUnit,
} from './studyTypes';

export const STUDY_DB_NAME = 'webnet.study.v1';
export const STUDY_DB_VERSION = 2;
export const STUDY_SCHEMA_VERSION = 2;

const STORES = [
  'documents',
  'units',
  'prompts',
  'concepts',
  'progress',
  'attempts',
  'drafts',
  'settings',
  'legalDocuments',
  'legalComponents',
  'importHistory',
] as const;

type StudyStoreName = (typeof STORES)[number];

const STORE_KEYS: Record<StudyStoreName, string> = {
  documents: 'id',
  units: 'id',
  prompts: 'id',
  concepts: 'id',
  progress: 'unitId',
  attempts: 'id',
  drafts: 'id',
  settings: 'id',
  legalDocuments: 'id',
  legalComponents: 'recordKey',
  importHistory: 'id',
};

type StudyStorePayloads = {
  documents: StudyDocument;
  units: StudyUnit;
  prompts: StudyPrompt;
  concepts: StudyConcept;
  progress: StudyProgress;
  attempts: StudyAttempt;
  drafts: StudyDraft;
  settings: StudySettings;
  legalDocuments: ImportedLegalDocument;
  legalComponents: ImportedLegalComponent & { recordKey: string };
  importHistory: StudyOfficialImportHistory;
};

export interface StudyStorage {
  loadAll: () => Promise<StudyDataSnapshot>;
  saveDocument: (_document: StudyDocument) => Promise<void>;
  saveUnit: (_unit: StudyUnit) => Promise<void>;
  saveProgress: (_progress: StudyProgress) => Promise<void>;
  saveAttempt: (_attempt: StudyAttempt) => Promise<void>;
  saveDraft: (_draft: StudyDraft) => Promise<void>;
  clearDraft: (_draftId: string) => Promise<void>;
  saveSettings: (_settings: StudySettings) => Promise<void>;
  replaceAll: (_snapshot: StudyDataSnapshot) => Promise<void>;
  importOfficialContentPackage: (_contentPackage: NbLawContentPackage) => Promise<StudyDataSnapshot>;
}

const hasIndexedDb = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });

const openStudyDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = window.indexedDB.open(STUDY_DB_NAME, STUDY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: STORE_KEYS[storeName] });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open study database.'));
  });

const readStore = async <TStore extends StudyStoreName>(
  db: IDBDatabase,
  storeName: TStore,
): Promise<StudyStorePayloads[TStore][]> => {
  const transaction = db.transaction(storeName, 'readonly');
  const records = (await requestToPromise(transaction.objectStore(storeName).getAll())) as StudyStorePayloads[TStore][];
  await transactionDone(transaction);
  return records;
};

const putRecord = async <TStore extends StudyStoreName>(
  db: IDBDatabase,
  storeName: TStore,
  value: StudyStorePayloads[TStore],
): Promise<void> => {
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
};

const putMany = <TStore extends StudyStoreName>(
  transaction: IDBTransaction,
  storeName: TStore,
  values: StudyStorePayloads[TStore][],
): void => {
  const store = transaction.objectStore(storeName);
  values.forEach((value) => store.put(value));
};

const legalComponentRecord = (
  component: ImportedLegalComponent,
): ImportedLegalComponent & { recordKey: string } => ({
  ...component,
  recordKey: `${component.documentId}::${component.sourceKey}`,
});

const legalComponentFromRecord = (
  component: ImportedLegalComponent & { recordKey?: string },
): ImportedLegalComponent => {
  const { recordKey: _recordKey, ...rest } = component;
  return rest;
};

export const migrateStudySnapshot = (input: Partial<StudyDataSnapshot>): StudyDataSnapshot => {
  const nowIso = new Date().toISOString();
  const seed = createSeedStudyData(nowIso);
  const settings = {
    ...createDefaultStudySettings(nowIso),
    ...(input.settings ?? {}),
    schemaVersion: STUDY_SCHEMA_VERSION,
  };
  const legalDocuments = input.legalDocuments ?? [];
  const documents = upsertStudyDocumentsWithOfficialMetadata(input.documents ?? seed.documents, legalDocuments);
  return {
    schemaVersion: STUDY_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? nowIso,
    documents,
    units: input.units ?? seed.units,
    prompts: input.prompts ?? seed.prompts,
    concepts: input.concepts ?? seed.concepts,
    progress: input.progress ?? seed.progress,
    attempts: input.attempts ?? [],
    drafts: input.drafts ?? [],
    settings,
    legalDocuments,
    legalComponents: input.legalComponents ?? [],
    importHistory: input.importHistory ?? [],
  };
};

const seedIfEmpty = async (db: IDBDatabase): Promise<void> => {
  const documents = await readStore(db, 'documents');
  if (documents.length > 0) return;
  const seed = createSeedStudyData(new Date().toISOString());
  const transaction = db.transaction(STORES, 'readwrite');
  putMany(transaction, 'documents', seed.documents);
  putMany(transaction, 'units', seed.units);
  putMany(transaction, 'prompts', seed.prompts);
  putMany(transaction, 'concepts', seed.concepts);
  putMany(transaction, 'progress', seed.progress);
  putMany(transaction, 'settings', [seed.settings]);
  await transactionDone(transaction);
};

export const createStudyStorage = (): StudyStorage => ({
  async loadAll() {
    if (!hasIndexedDb()) return createSeedStudyData(new Date().toISOString());
    const db = await openStudyDatabase();
    try {
      await seedIfEmpty(db);
      const [documents, units, prompts, concepts, progress, attempts, drafts, settings] =
        await Promise.all([
          readStore(db, 'documents'),
          readStore(db, 'units'),
          readStore(db, 'prompts'),
          readStore(db, 'concepts'),
          readStore(db, 'progress'),
          readStore(db, 'attempts'),
          readStore(db, 'drafts'),
          readStore(db, 'settings'),
        ]);
      const [legalDocuments, legalComponents, importHistory] =
        await Promise.all([
          readStore(db, 'legalDocuments'),
          readStore(db, 'legalComponents'),
          readStore(db, 'importHistory'),
        ]);
      return migrateStudySnapshot({
        documents,
        units,
        prompts,
        concepts,
        progress,
        attempts,
        drafts,
        settings: settings[0],
        legalDocuments,
        legalComponents: legalComponents.map(legalComponentFromRecord),
        importHistory,
      });
    } finally {
      db.close();
    }
  },
  async saveDocument(document) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'documents', document);
    } finally {
      db.close();
    }
  },
  async saveUnit(unit) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'units', unit);
    } finally {
      db.close();
    }
  },
  async saveProgress(progress) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'progress', progress);
    } finally {
      db.close();
    }
  },
  async saveAttempt(attempt) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'attempts', attempt);
    } finally {
      db.close();
    }
  },
  async saveDraft(draft) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'drafts', draft);
    } finally {
      db.close();
    }
  },
  async clearDraft(draftId) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').delete(draftId);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async saveSettings(settings) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'settings', settings);
    } finally {
      db.close();
    }
  },
  async replaceAll(snapshot) {
    const next = migrateStudySnapshot(snapshot);
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction(STORES, 'readwrite');
      STORES.forEach((storeName) => transaction.objectStore(storeName).clear());
      putMany(transaction, 'documents', next.documents);
      putMany(transaction, 'units', next.units);
      putMany(transaction, 'prompts', next.prompts);
      putMany(transaction, 'concepts', next.concepts);
      putMany(transaction, 'progress', next.progress);
      putMany(transaction, 'attempts', next.attempts);
      putMany(transaction, 'drafts', next.drafts);
      putMany(transaction, 'settings', [next.settings]);
      putMany(transaction, 'legalDocuments', next.legalDocuments);
      putMany(transaction, 'legalComponents', next.legalComponents.map(legalComponentRecord));
      putMany(transaction, 'importHistory', next.importHistory);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async importOfficialContentPackage(contentPackage) {
    const db = await openStudyDatabase();
    try {
      const [documents, units, prompts, concepts, progress, attempts, drafts, settings, legalDocuments, legalComponents, importHistory] =
        await Promise.all([
          readStore(db, 'documents'),
          readStore(db, 'units'),
          readStore(db, 'prompts'),
          readStore(db, 'concepts'),
          readStore(db, 'progress'),
          readStore(db, 'attempts'),
          readStore(db, 'drafts'),
          readStore(db, 'settings'),
          readStore(db, 'legalDocuments'),
          readStore(db, 'legalComponents'),
          readStore(db, 'importHistory'),
        ]);
      const current = migrateStudySnapshot({
        documents,
        units,
        prompts,
        concepts,
        progress,
        attempts,
        drafts,
        settings: settings[0],
        legalDocuments,
        legalComponents: legalComponents.map(legalComponentFromRecord),
        importHistory,
      });
      const { snapshot } = applyOfficialContentPackageToSnapshot({
        snapshot: current,
        contentPackage,
      });
      const transaction = db.transaction(
        ['documents', 'units', 'legalDocuments', 'legalComponents', 'importHistory'],
        'readwrite',
      );
      ['documents', 'units', 'legalDocuments', 'legalComponents', 'importHistory'].forEach((storeName) =>
        transaction.objectStore(storeName).clear(),
      );
      putMany(transaction, 'documents', snapshot.documents);
      putMany(transaction, 'units', snapshot.units);
      putMany(transaction, 'legalDocuments', snapshot.legalDocuments);
      putMany(transaction, 'legalComponents', snapshot.legalComponents.map(legalComponentRecord));
      putMany(transaction, 'importHistory', snapshot.importHistory);
      await transactionDone(transaction);
      return snapshot;
    } finally {
      db.close();
    }
  },
});
