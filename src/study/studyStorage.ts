import { createSeedStudyData, createDefaultStudySettings } from './studySeed';
import { createStudyFsrsConfigRecord, migrateStudyFsrsSchedule } from './fsrs/studyFsrsMigration';
import {
  applyOfficialContentPackageToSnapshot,
  previewOfficialContentPackage as previewOfficialContentPackageForSnapshot,
  upsertStudyDocumentsWithOfficialMetadata,
} from './studyOfficialContent';
import type { StudyStorage } from './studyStorageTypes';
import type {
  AiAuthoringRun,
  AiStoredUnitProposal,
  AiStudyMapProposal,
} from './ai/studyAiTypes';
import { applyAiProposalApprovalToSnapshot } from './ai/studyAiApproval';
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
import type {
  ExamPrepAttempt,
  ExamPrepRecallAttempt,
  ExamPrepRecallProgress,
  ExamPrepSettings,
  ExamPrepUnitProgress,
} from './examPrep/examPrepTypes';
import {
  EXAM_PREP_STORE_INDEXES,
  EXAM_PREP_STORE_KEYS,
  EXAM_PREP_STORE_NAMES,
  type ExamPrepIndexSpec,
  type ExamPrepStoreName,
} from './examPrep/examPrepStorageConfig';

export const STUDY_DB_NAME = 'webnet.study.v1';
export const STUDY_DB_VERSION = 9;
export const STUDY_SCHEMA_VERSION = 9;

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
  'searchIndexMetadata',
  'searchIndexArtifacts',
  'aiAuthoringRuns',
  'aiStudyMapProposals',
  'aiUnitProposals',
  ...EXAM_PREP_STORE_NAMES,
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
  searchIndexMetadata: 'id',
  searchIndexArtifacts: 'id',
  aiAuthoringRuns: 'runId',
  aiStudyMapProposals: 'id',
  aiUnitProposals: 'proposalId',
  ...EXAM_PREP_STORE_KEYS,
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
  searchIndexMetadata: { id: string; [key: string]: unknown };
  searchIndexArtifacts: { id: string; [key: string]: unknown };
  aiAuthoringRuns: AiAuthoringRun;
  aiStudyMapProposals: AiStudyMapProposal;
  aiUnitProposals: AiStoredUnitProposal;
  examPrepUnitProgress: ExamPrepUnitProgress;
  examPrepRecallProgress: ExamPrepRecallProgress;
  examPrepAttempts: ExamPrepAttempt;
  examPrepSettings: ExamPrepSettings;
};

const hasIndexedDb = (): boolean =>
  typeof globalThis.indexedDB !== 'undefined';

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
    const request = globalThis.indexedDB.open(STUDY_DB_NAME, STUDY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: STORE_KEYS[storeName] });
          createIndexesForStore(storeName, store);
          return;
        }
        const transaction = request.transaction;
        if (!transaction) return;
        if (storeName === 'legalComponents') {
          const store = transaction.objectStore(storeName);
          if (store.keyPath !== STORE_KEYS.legalComponents) {
            db.deleteObjectStore(storeName);
            createIndexesForStore(
              storeName,
              db.createObjectStore(storeName, { keyPath: STORE_KEYS[storeName] }),
            );
            return;
          }
        }
        createMissingIndexes(storeName, transaction.objectStore(storeName));
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open study database.'));
  });

const hasIndex = (store: IDBObjectStore, indexName: string): boolean =>
  'indexNames' in store && Array.from(store.indexNames).includes(indexName);

const createMissingIndex = (
  store: IDBObjectStore,
  indexName: string,
  keyPath: string | string[],
): void => {
  if ('createIndex' in store && !hasIndex(store, indexName)) store.createIndex(indexName, keyPath);
};

/**
 * Data-driven index creation for the Exam Prep stores. Both the fresh-create
 * path (createIndexesForStore) and the migration/missing path
 * (createMissingIndexes) consume the same spec table so they cannot drift.
 */
const examPrepIndexSpecsFor = (storeName: StudyStoreName): ExamPrepIndexSpec[] | null => {
  if (!(storeName in EXAM_PREP_STORE_KEYS)) return null;
  return EXAM_PREP_STORE_INDEXES[storeName as ExamPrepStoreName];
};

const createIndexesForStore = (storeName: StudyStoreName, store: IDBObjectStore): void => {
  if (!('createIndex' in store)) return;
  if (storeName === 'legalComponents') {
    store.createIndex('byDocumentId', 'documentId');
    store.createIndex('bySourceKey', ['documentId', 'sourceKey'], { unique: true });
    store.createIndex('byType', 'componentType');
  }
  if (storeName === 'units') {
    store.createIndex('bySourceMode', 'sourceMode');
  }
  if (storeName === 'prompts' || storeName === 'rubrics' || storeName === 'concepts') {
    store.createIndex('byUnitId', 'unitId');
  }
  if (storeName === 'attempts') {
    store.createIndex('byUnitId', 'unitId');
    store.createIndex('byUnitReviewedAt', ['unitId', 'completedAt']);
  }
  if (storeName === 'aiStudyMapProposals' || storeName === 'aiUnitProposals') {
    store.createIndex('byRunId', 'runId');
    store.createIndex('byReviewStatus', 'reviewStatus');
    store.createIndex('byValidationStatus', 'validationStatus');
  }
  const examPrepSpecs = examPrepIndexSpecsFor(storeName);
  if (examPrepSpecs) {
    examPrepSpecs.forEach((spec) =>
      store.createIndex(spec.name, spec.keyPath, spec.unique ? { unique: true } : undefined),
    );
  }
};

const createMissingIndexes = (storeName: StudyStoreName, store: IDBObjectStore): void => {
  if (storeName === 'legalComponents') {
    createMissingIndex(store, 'byDocumentId', 'documentId');
    createMissingIndex(store, 'bySourceKey', ['documentId', 'sourceKey']);
    createMissingIndex(store, 'byType', 'componentType');
  }
  if (storeName === 'units') {
    createMissingIndex(store, 'bySourceMode', 'sourceMode');
  }
  if (storeName === 'prompts' || storeName === 'rubrics' || storeName === 'concepts') {
    createMissingIndex(store, 'byUnitId', 'unitId');
  }
  if (storeName === 'attempts') {
    createMissingIndex(store, 'byUnitId', 'unitId');
    createMissingIndex(store, 'byUnitReviewedAt', ['unitId', 'completedAt']);
  }
  if (storeName === 'aiStudyMapProposals' || storeName === 'aiUnitProposals') {
    createMissingIndex(store, 'byRunId', 'runId');
    createMissingIndex(store, 'byReviewStatus', 'reviewStatus');
    createMissingIndex(store, 'byValidationStatus', 'validationStatus');
  }
  const examPrepSpecs = examPrepIndexSpecsFor(storeName);
  if (examPrepSpecs) {
    examPrepSpecs.forEach((spec) => createMissingIndex(store, spec.name, spec.keyPath));
  }
};

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

const readByIndex = async <TStore extends StudyStoreName>(
  db: IDBDatabase,
  storeName: TStore,
  indexName: string,
  query: string,
): Promise<StudyStorePayloads[TStore][]> => {
  const transaction = db.transaction(storeName, 'readonly');
  const records = (await requestToPromise(
    transaction.objectStore(storeName).index(indexName).getAll(query),
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

const clearDerivedSearchStores = async (db: IDBDatabase): Promise<void> => {
  const transaction = db.transaction(['searchIndexMetadata', 'searchIndexArtifacts'], 'readwrite');
  transaction.objectStore('searchIndexMetadata').clear();
  transaction.objectStore('searchIndexArtifacts').clear();
  await transactionDone(transaction);
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
    aiAuthoringRuns: input.aiAuthoringRuns ?? [],
    aiStudyMapProposals: input.aiStudyMapProposals ?? [],
    aiUnitProposals: input.aiUnitProposals ?? [],
    examPrepUnitProgress: input.examPrepUnitProgress ?? [],
    examPrepRecallProgress: input.examPrepRecallProgress ?? [],
    examPrepAttempts: input.examPrepAttempts ?? [],
    examPrepSettings: input.examPrepSettings ?? [],
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

const loadAuthoritativeSnapshot = async (db: IDBDatabase): Promise<StudyDataSnapshot> => {
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
    aiAuthoringRuns,
    aiStudyMapProposals,
    aiUnitProposals,
    examPrepUnitProgress,
    examPrepRecallProgress,
    examPrepAttempts,
    examPrepSettings,
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
    readStore(db, 'aiAuthoringRuns'),
    readStore(db, 'aiStudyMapProposals'),
    readStore(db, 'aiUnitProposals'),
    readStore(db, 'examPrepUnitProgress'),
    readStore(db, 'examPrepRecallProgress'),
    readStore(db, 'examPrepAttempts'),
    readStore(db, 'examPrepSettings'),
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
    aiAuthoringRuns,
    aiStudyMapProposals,
    aiUnitProposals,
    examPrepUnitProgress,
    examPrepRecallProgress,
    examPrepAttempts,
    examPrepSettings,
  });
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
        Promise.resolve([] as StudyStorePayloads['legalComponents'][]),
        readStore(db, 'importHistory'),
      ]);
      const [aiAuthoringRuns, aiStudyMapProposals, aiUnitProposals] = await Promise.all([
        readStore(db, 'aiAuthoringRuns'),
        readStore(db, 'aiStudyMapProposals'),
        readStore(db, 'aiUnitProposals'),
      ]);
      const [examPrepUnitProgress, examPrepRecallProgress, examPrepAttempts, examPrepSettings] =
        await Promise.all([
          readStore(db, 'examPrepUnitProgress'),
          readStore(db, 'examPrepRecallProgress'),
          readStore(db, 'examPrepAttempts'),
          readStore(db, 'examPrepSettings'),
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
        aiAuthoringRuns,
        aiStudyMapProposals,
        aiUnitProposals,
        examPrepUnitProgress,
        examPrepRecallProgress,
        examPrepAttempts,
        examPrepSettings,
      });
    } finally {
      db.close();
    }
  },
  async getLegalComponent(documentId, sourceKey) {
    if (!hasIndexedDb()) return null;
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction('legalComponents', 'readonly');
      const record = (await requestToPromise(
        transaction.objectStore('legalComponents').get(`${documentId}::${sourceKey}`),
      )) as StudyStorePayloads['legalComponents'] | undefined;
      await transactionDone(transaction);
      return record ? legalComponentFromRecord(record) : null;
    } finally {
      db.close();
    }
  },
  async getLegalComponentsByDocument(documentId) {
    if (!hasIndexedDb()) return [];
    const db = await openStudyDatabase();
    try {
      const records = await readByIndex(db, 'legalComponents', 'byDocumentId', documentId);
      return records.map(legalComponentFromRecord);
    } finally {
      db.close();
    }
  },
  async getLegalComponentsBySourceKeys(documentId, sourceKeys) {
    if (!hasIndexedDb() || sourceKeys.length === 0) return [];
    const db = await openStudyDatabase();
    try {
      const records = await Promise.all(
        sourceKeys.map(async (sourceKey) => {
          const transaction = db.transaction('legalComponents', 'readonly');
          const record = (await requestToPromise(
            transaction.objectStore('legalComponents').get(`${documentId}::${sourceKey}`),
          )) as StudyStorePayloads['legalComponents'] | undefined;
          await transactionDone(transaction);
          return record;
        }),
      );
      return records
        .filter((record): record is StudyStorePayloads['legalComponents'] => Boolean(record))
        .map(legalComponentFromRecord);
    } finally {
      db.close();
    }
  },
  async getLegalDocumentComponentSummary(documentId) {
    const components = await this.getLegalComponentsByDocument(documentId);
    return {
      documentId,
      componentCount: components.length,
      sectionCount: components.filter((component) => component.componentType === 'section').length,
      subsectionCount: components.reduce(
        (sum, component) => sum + (component.subsections?.length ?? 0),
        0,
      ),
      scheduleCount: components.filter((component) => component.componentType === 'schedule')
        .length,
      formCount: components.filter((component) => component.componentType === 'form').length,
      referenceOnlyFormCount: components.filter(
        (component) =>
          component.componentType === 'form' && component.extractionStatus === 'reference-only',
      ).length,
    };
  },
  async getLegalComponentCount(documentId) {
    return (await this.getLegalComponentsByDocument(documentId)).length;
  },
  async previewOfficialContentPackage(contentPackage) {
    const db = await openStudyDatabase();
    try {
      const snapshot = await loadAuthoritativeSnapshot(db);
      return previewOfficialContentPackageForSnapshot(snapshot, contentPackage);
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
  async deleteUnitCascade(unitId) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction(
        ['units', 'prompts', 'concepts', 'rubrics', 'progress', 'attempts', 'drafts'],
        'readwrite',
      );
      transaction.objectStore('units').delete(unitId);
      transaction.objectStore('progress').delete(unitId);
      const deleteByUnitId = async (storeName: 'prompts' | 'concepts' | 'rubrics' | 'attempts') => {
        const records = (await requestToPromise(
          transaction.objectStore(storeName).index('byUnitId').getAll(unitId),
        )) as Array<{ id: string }>;
        records.forEach((record) => transaction.objectStore(storeName).delete(record.id));
      };
      await Promise.all([
        deleteByUnitId('prompts'),
        deleteByUnitId('concepts'),
        deleteByUnitId('rubrics'),
        deleteByUnitId('attempts'),
      ]);
      const drafts = (await requestToPromise(
        transaction.objectStore('drafts').getAll(),
      )) as StudyDraft[];
      drafts
        .filter((draft) => draft.unitId === unitId)
        .forEach((draft) => transaction.objectStore('drafts').delete(draft.id));
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
  async saveExamPrepUnitProgress(record) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'examPrepUnitProgress', record);
    } finally {
      db.close();
    }
  },
  async deleteExamPrepUnitProgress(recordId) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction('examPrepUnitProgress', 'readwrite');
      transaction.objectStore('examPrepUnitProgress').delete(recordId);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async saveExamPrepRecallRating({ attempt, progress, expectation }) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction(
        ['examPrepRecallProgress', 'examPrepAttempts'],
        'readwrite',
      );
      const progressStore = transaction.objectStore('examPrepRecallProgress');
      const existing = await requestToPromise(
        progressStore.get(progress.id) as IDBRequest<ExamPrepRecallProgress | undefined>,
      );
      const stale =
        expectation.kind === 'absent'
          ? existing !== undefined
          : !existing || existing.updatedAt !== expectation.updatedAt;
      if (stale) {
        transaction.abort();
        throw new Error('Exam Prep recall progress changed before the rating could be saved.');
      }
      progressStore.put(progress);
      transaction.objectStore('examPrepAttempts').put(attempt);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  /** Immutable generic attempt write (recognition/locate/drill). */
  async saveExamPrepAttempt(attempt) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction('examPrepAttempts', 'readwrite');
      transaction.objectStore('examPrepAttempts').add(attempt);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async saveExamPrepSettings(record) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'examPrepSettings', record);
    } finally {
      db.close();
    }
  },
  async saveAiAuthoringRun(run) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'aiAuthoringRuns', run);
    } finally {
      db.close();
    }
  },
  async saveAiStudyMapProposal(proposal) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'aiStudyMapProposals', proposal);
    } finally {
      db.close();
    }
  },
  async saveAiUnitProposal(proposal) {
    const db = await openStudyDatabase();
    try {
      await putRecord(db, 'aiUnitProposals', proposal);
    } finally {
      db.close();
    }
  },
  async replaceAiAuthoringArtifacts({ runs, mapProposals, unitProposals }) {
    const db = await openStudyDatabase();
    try {
      const transaction = db.transaction(
        ['aiAuthoringRuns', 'aiStudyMapProposals', 'aiUnitProposals'],
        'readwrite',
      );
      if (runs) putMany(transaction, 'aiAuthoringRuns', runs);
      if (mapProposals) putMany(transaction, 'aiStudyMapProposals', mapProposals);
      if (unitProposals) putMany(transaction, 'aiUnitProposals', unitProposals);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async approveAiUnitProposal({ proposalId, sourceComponents }) {
    const db = await openStudyDatabase();
    try {
      const current = await loadAuthoritativeSnapshot(db);
      const proposal = current.aiUnitProposals.find((entry) => entry.proposalId === proposalId);
      if (!proposal) throw new Error(`AI unit proposal not found: ${proposalId}`);
      if (proposal.reviewStatus === 'approved') {
        throw new Error(`AI unit proposal is already approved: ${proposalId}`);
      }
      if (proposal.validationStatus === 'invalid') {
        throw new Error(`AI unit proposal is invalid and cannot be approved: ${proposalId}`);
      }
      const snapshot = applyAiProposalApprovalToSnapshot({
        snapshot: current,
        proposal,
        sourceComponents,
      });
      const transaction = db.transaction(
        ['units', 'prompts', 'concepts', 'rubrics', 'progress', 'aiUnitProposals'],
        'readwrite',
      );
      const approvedUnit = snapshot.units.at(-1);
      const approvedProgress = snapshot.progress.at(-1);
      if (!approvedUnit || !approvedProgress) throw new Error('AI proposal approval failed.');
      transaction.objectStore('units').put(approvedUnit);
      snapshot.prompts
        .filter((prompt) => prompt.unitId === approvedUnit.id)
        .forEach((prompt) => transaction.objectStore('prompts').put(prompt));
      snapshot.concepts
        .filter((concept) => concept.unitId === approvedUnit.id)
        .forEach((concept) => transaction.objectStore('concepts').put(concept));
      snapshot.rubrics
        .filter((rubric) => rubric.unitId === approvedUnit.id)
        .forEach((rubric) => transaction.objectStore('rubrics').put(rubric));
      transaction.objectStore('progress').put(approvedProgress);
      transaction.objectStore('aiUnitProposals').put(
        snapshot.aiUnitProposals.find((entry) => entry.proposalId === proposalId) ?? proposal,
      );
      await transactionDone(transaction);
      return snapshot;
    } finally {
      db.close();
    }
  },
  async replaceAll(snapshot) {
    const next = migrateStudySnapshot(snapshot);
    const db = await openStudyDatabase();
    try {
      const authoritativeStores = STORES.filter(
        (storeName) => storeName !== 'searchIndexMetadata' && storeName !== 'searchIndexArtifacts',
      );
      const transaction = db.transaction(authoritativeStores, 'readwrite');
      authoritativeStores.forEach((storeName) => transaction.objectStore(storeName).clear());
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
      putMany(transaction, 'aiAuthoringRuns', next.aiAuthoringRuns);
      putMany(transaction, 'aiStudyMapProposals', next.aiStudyMapProposals);
      putMany(transaction, 'aiUnitProposals', next.aiUnitProposals);
      putMany(transaction, 'examPrepUnitProgress', next.examPrepUnitProgress);
      putMany(transaction, 'examPrepRecallProgress', next.examPrepRecallProgress);
      putMany(transaction, 'examPrepAttempts', next.examPrepAttempts);
      putMany(transaction, 'examPrepSettings', next.examPrepSettings);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
  async importOfficialContentPackage(contentPackage) {
    const db = await openStudyDatabase();
    try {
      const current = await loadAuthoritativeSnapshot(db);
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
      await clearDerivedSearchStores(db);
      return snapshot;
    } finally {
      db.close();
    }
  },
});
