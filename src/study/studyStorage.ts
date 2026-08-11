import { createSeedStudyData, createDefaultStudySettings } from './studySeed';
import { createStudyFsrsConfigRecord, migrateStudyFsrsSchedule } from './fsrs/studyFsrsMigration';
import {
  applyOfficialContentPackageToSnapshot,
  upsertStudyDocumentsWithOfficialMetadata,
} from './studyOfficialContent';
import type { StudyStorage } from './studyStorageTypes';
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
  StudyRubricItem,
  StudySettings,
  StudyUnit,
} from './studyTypes';

export const STUDY_DB_NAME = 'webnet.study.v1';
export const STUDY_DB_VERSION = 5;
export const STUDY_SCHEMA_VERSION = 5;

const STORES = [
  'documents',
  'units',
  'prompts',
  'concepts',
  'rubrics',
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
  rubrics: 'id',
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
  rubrics: StudyRubricItem;
  progress: StudyProgress;
  attempts: StudyAttempt;
  drafts: StudyDraft;
  settings: StudySettings;
  legalDocuments: ImportedLegalDocument;
  legalComponents: ImportedLegalComponent & { recordKey: string };
  importHistory: StudyOfficialImportHistory;
};

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
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
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
  const records = (await requestToPromise(
    transaction.objectStore(storeName).getAll(),
  )) as StudyStorePayloads[TStore][];
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

export const shouldSeedStudyData = ({
  documentCount,
  settingsCount,
}: {
  documentCount: number;
  settingsCount: number;
}): boolean => documentCount === 0 && settingsCount === 0;

export const migrateStudySnapshot = (input: Partial<StudyDataSnapshot>): StudyDataSnapshot => {
  const nowIso = new Date().toISOString();
  const seed = createSeedStudyData(nowIso);
  const existingConfigVersion = input.settings?.fsrsConfig?.configVersion;
  const fsrsConfig =
    input.settings?.fsrsConfig ??
    createStudyFsrsConfigRecord({
      now: new Date(nowIso),
      configVersion: typeof existingConfigVersion === 'number' ? existingConfigVersion : 1,
    });
  const settings = {
    ...createDefaultStudySettings(nowIso),
    ...(input.settings ?? {}),
    schemaVersion: STUDY_SCHEMA_VERSION,
    fsrsConfig,
  };
  const legalDocuments = input.legalDocuments ?? [];
  const documents = upsertStudyDocumentsWithOfficialMetadata(
    input.documents ?? seed.documents,
    legalDocuments,
  );
  const incomingUnits = input.units ?? seed.units;
  const units = incomingUnits.map((unit) => ({
    ...unit,
    sourceMode:
      unit.sourceMode ??
      ((unit.sourceReferences?.length ?? 0) > 0 || (unit.documentIds?.length ?? 0) > 0
        ? 'official'
        : 'custom'),
    documentIds: unit.documentIds ?? [],
    sectionRefs: unit.sectionRefs ?? [],
    tags: unit.tags ?? [],
  }));
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const orderByUnit = new Map<string, number>();
  const concepts = (input.concepts ?? seed.concepts).map((concept) => {
    const order = concept.order ?? orderByUnit.get(concept.unitId) ?? 0;
    orderByUnit.set(concept.unitId, order + 1);
    const unit = unitById.get(concept.unitId);
    return {
      ...concept,
      label: concept.label.replace(/\s+/g, ' ').trim(),
      required: concept.required ?? true,
      origin:
        concept.origin ??
        (unit?.generatedContentState?.concepts === 'generated' ? 'generated' : 'manual'),
      order,
    };
  });
  const rubrics =
    input.rubrics ??
    concepts.map(
      (concept): StudyRubricItem => ({
        id: `${concept.id}-rubric`,
        unitId: concept.unitId,
        category: 'custom',
        prompt: concept.label,
        referenceAnswer: concept.explanation ?? '',
        required: concept.required,
        origin: concept.origin,
        order: concept.order,
        createdAt: concept.createdAt,
        updatedAt: concept.updatedAt,
      }),
    );
  const progress = (input.progress ?? seed.progress).map((entry) => ({
    ...entry,
    scheduling: migrateStudyFsrsSchedule({
      schedule: entry.scheduling,
      legacyDueAt: entry.dueAt,
      configVersion: settings.fsrsConfig.configVersion,
    }),
  }));
  return {
    schemaVersion: STUDY_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? nowIso,
    documents,
    units,
    prompts: input.prompts ?? seed.prompts,
    concepts,
    rubrics,
    progress,
    attempts: input.attempts ?? [],
    drafts: input.drafts ?? [],
    settings,
    legalDocuments,
    legalComponents: input.legalComponents ?? [],
    importHistory: input.importHistory ?? [],
  };
};

const seedIfEmpty = async (db: IDBDatabase): Promise<void> => {
  const settings = await readStore(db, 'settings');
  const documents = await readStore(db, 'documents');
  if (!shouldSeedStudyData({ documentCount: documents.length, settingsCount: settings.length }))
    return;
  const seed = createSeedStudyData(new Date().toISOString());
  const transaction = db.transaction(STORES, 'readwrite');
  putMany(transaction, 'documents', seed.documents);
  putMany(transaction, 'units', seed.units);
  putMany(transaction, 'prompts', seed.prompts);
  putMany(transaction, 'concepts', seed.concepts);
  putMany(transaction, 'rubrics', seed.rubrics);
  putMany(transaction, 'progress', seed.progress);
  putMany(transaction, 'settings', [seed.settings]);
  await transactionDone(transaction);
};

const saveAttemptProgressTransaction = async ({
  attempt,
  progress,
  expectedProgressUpdatedAt,
  staleMessage,
}: {
  attempt: StudyAttempt;
  progress: StudyProgress;
  expectedProgressUpdatedAt?: string;
  staleMessage: string;
}): Promise<void> => {
  const db = await openStudyDatabase();
  try {
    const transaction = db.transaction(['attempts', 'progress'], 'readwrite');
    const progressStore = transaction.objectStore('progress');
    const existing = await requestToPromise(
      progressStore.get(progress.unitId) as IDBRequest<StudyProgress | undefined>,
    );
    if (expectedProgressUpdatedAt && existing && existing.updatedAt !== expectedProgressUpdatedAt) {
      transaction.abort();
      throw new Error(staleMessage);
    }
    transaction.objectStore('attempts').put(attempt);
    progressStore.put(progress);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

export const createStudyStorage = (): StudyStorage => ({
  async loadAll() {
    if (!hasIndexedDb()) return createSeedStudyData(new Date().toISOString());
    const db = await openStudyDatabase();
    try {
      await seedIfEmpty(db);
      const [documents, units, prompts, concepts, rubrics, progress, attempts, drafts, settings] =
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
        ]);
      const [legalDocuments, legalComponents, importHistory] = await Promise.all([
        readStore(db, 'legalDocuments'),
        readStore(db, 'legalComponents'),
        readStore(db, 'importHistory'),
      ]);
      return migrateStudySnapshot({
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
  async savePrompt(prompt) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'prompts', prompt);
    } finally {
      db.close();
    }
  },
  async replaceUnitConcepts(unitId, concepts) {
    const db = await openStudyDatabase();
    try {
      const existing = await readStore(db, 'concepts');
      const transaction = db.transaction('concepts', 'readwrite');
      const store = transaction.objectStore('concepts');
      existing
        .filter((concept) => concept.unitId === unitId)
        .forEach((concept) => store.delete(concept.id));
      concepts.forEach((concept) => store.put(concept));
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async replaceUnitRubrics(unitId, rubrics) {
    const db = await openStudyDatabase();
    try {
      const existing = await readStore(db, 'rubrics');
      const transaction = db.transaction('rubrics', 'readwrite');
      const store = transaction.objectStore('rubrics');
      existing
        .filter((rubric) => rubric.unitId === unitId)
        .forEach((rubric) => store.delete(rubric.id));
      rubrics.forEach((rubric) => store.put(rubric));
      await transactionDone(transaction);
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
  async saveRatedAttempt({ attempt, progress, draftId, expectedProgressUpdatedAt }) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction(['attempts', 'progress', 'drafts'], 'readwrite');
      const progressStore = transaction.objectStore('progress');
      const existing = await requestToPromise(
        progressStore.get(progress.unitId) as IDBRequest<StudyProgress | undefined>,
      );
      if (
        expectedProgressUpdatedAt &&
        existing &&
        existing.updatedAt !== expectedProgressUpdatedAt
      ) {
        transaction.abort();
        throw new Error('Study progress changed before the rating could be saved.');
      }
      transaction.objectStore('attempts').put(attempt);
      progressStore.put(progress);
      transaction.objectStore('drafts').delete(draftId);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async saveSchedulingUndo({ attempt, progress, expectedProgressUpdatedAt }) {
    await saveAttemptProgressTransaction({
      attempt,
      progress,
      expectedProgressUpdatedAt,
      staleMessage: 'Study progress changed before the rating could be undone.',
    });
  },
  async saveAttemptProgress({ attempt, progress, expectedProgressUpdatedAt }) {
    await saveAttemptProgressTransaction({
      attempt,
      progress,
      expectedProgressUpdatedAt,
      staleMessage: 'Study progress changed before the practice rating could be saved.',
    });
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
      putMany(transaction, 'rubrics', next.rubrics);
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
        legalComponents,
        importHistory,
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
        readStore(db, 'legalComponents'),
        readStore(db, 'importHistory'),
      ]);
      const current = migrateStudySnapshot({
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
      ['documents', 'units', 'legalDocuments', 'legalComponents', 'importHistory'].forEach(
        (storeName) => transaction.objectStore(storeName).clear(),
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
