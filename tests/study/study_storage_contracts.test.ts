/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';

import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { createStudyFsrsScheduler } from '../../src/study/fsrs/studyFsrs';
import { isFsrsReplayableAttempt } from '../../src/study/fsrs/studyFsrsMigration';
import { buildStudyOpfsPath, sanitizeStudyPathSegment } from '../../src/study/studyOpfs';
import { buildRatedStudyAttempt, buildUndoLatestSchedulingRating } from '../../src/study/studyReviewTransaction';
import { buildSessionItems, markReadingComplete } from '../../src/study/studyScheduler';
import { createSeedStudyData } from '../../src/study/studySeed';
import {
  createStudyStorage,
  migrateStudySnapshot,
  shouldSeedStudyData,
  STUDY_DB_NAME,
  STUDY_DB_VERSION,
  STUDY_SCHEMA_VERSION,
} from '../../src/study/studyStorage';

type FakeStudyStores = Record<string, Map<string, unknown>>;
type FakeStudyIndexes = Record<string, Set<string>>;
type FakeStudyKeyPaths = Record<string, string>;

const STUDY_STORE_KEYS: Record<string, string> = {
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

const originalIndexedDb = window.indexedDB;

const createFakeRequest = <T>(resolveValue: () => T, onComplete?: () => void): IDBRequest<T> => {
  const request = {
    result: undefined as T,
    error: null as DOMException | null,
    onsuccess: null as IDBRequest<T>['onsuccess'],
    onerror: null as IDBRequest<T>['onerror'],
  };
  const idbRequest = request as unknown as IDBRequest<T>;
  window.setTimeout(() => {
    try {
      request.result = resolveValue();
      request.onsuccess?.call(idbRequest, new Event('success') as never);
    } catch (error) {
      request.error = error as DOMException;
      request.onerror?.call(idbRequest, new Event('error') as never);
    } finally {
      window.setTimeout(() => onComplete?.(), 0);
    }
  }, 0);
  return idbRequest;
};

const createFakeStudyStore = (
  stores: FakeStudyStores,
  indexes: FakeStudyIndexes,
  keyPaths: FakeStudyKeyPaths,
  storeName: string,
  transaction: IDBTransaction,
) => ({
  keyPath: keyPaths[storeName],
  indexNames: {
    contains: (indexName: string) => indexes[storeName]?.has(indexName) ?? false,
    [Symbol.iterator]: function* () {
      yield* indexes[storeName] ?? [];
    },
  },
  createIndex: (indexName: string) => {
    indexes[storeName] ??= new Set();
    indexes[storeName].add(indexName);
  },
  index: (indexName: string) => ({
    getAll: (query: string) =>
      createFakeRequest(
        () => {
          const records = Array.from((stores[storeName] ?? new Map()).values()) as Array<
            Record<string, unknown>
          >;
          if (indexName === 'byDocumentId') {
            return records.filter((record) => record.documentId === query);
          }
          if (indexName === 'byUnitId') {
            return records.filter((record) => record.unitId === query);
          }
          return records;
        },
        () => transaction.oncomplete?.call(transaction, new Event('complete') as never),
      ),
  }),
  getAll: () =>
    createFakeRequest(
      () => Array.from((stores[storeName] ?? new Map()).values()),
      () => transaction.oncomplete?.call(transaction, new Event('complete') as never),
    ),
  get: (key: string) =>
    createFakeRequest(
      () => stores[storeName]?.get(key),
      () => transaction.oncomplete?.call(transaction, new Event('complete') as never),
    ),
  put: (value: unknown) => {
    const keyPath = keyPaths[storeName] ?? STUDY_STORE_KEYS[storeName];
    const key = (value as Record<string, string>)[keyPath];
    stores[storeName] ??= new Map();
    stores[storeName].set(key, value);
    return createFakeRequest(() => key);
  },
  delete: (key: string) => {
    stores[storeName]?.delete(key);
    return createFakeRequest(() => undefined);
  },
  clear: () => {
    stores[storeName]?.clear();
    return createFakeRequest(() => undefined);
  },
});

const installStudyIndexedDbFixture = ({
  stores,
  oldVersion,
  indexes = {},
  keyPaths = {},
}: {
  stores: FakeStudyStores;
  oldVersion: number;
  indexes?: FakeStudyIndexes;
  keyPaths?: FakeStudyKeyPaths;
}) => {
  Object.keys(stores).forEach((storeName) => {
    keyPaths[storeName] ??= STUDY_STORE_KEYS[storeName];
  });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: (name: string, version?: number) => {
        const request = {
          result: null as IDBDatabase | null,
          error: null as DOMException | null,
          transaction: null as IDBTransaction | null,
          onsuccess: null as IDBOpenDBRequest['onsuccess'],
          onerror: null as IDBOpenDBRequest['onerror'],
          onupgradeneeded: null as IDBOpenDBRequest['onupgradeneeded'],
        };
        const db = {
          objectStoreNames: {
            contains: (storeName: string) => stores[storeName] !== undefined,
          },
          createObjectStore: (storeName: string) => {
            stores[storeName] ??= new Map();
            indexes[storeName] ??= new Set();
            keyPaths[storeName] = STUDY_STORE_KEYS[storeName];
            return createFakeStudyStore(
              stores,
              indexes,
              keyPaths,
              storeName,
              {} as IDBTransaction,
            );
          },
          deleteObjectStore: (storeName: string) => {
            stores[storeName] = new Map();
            indexes[storeName] = new Set();
            delete keyPaths[storeName];
          },
          close: () => undefined,
          transaction: (storeNames: string | string[], _mode?: string) => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            const transaction = {
              oncomplete: null as IDBTransaction['oncomplete'],
              onerror: null as IDBTransaction['onerror'],
              onabort: null as IDBTransaction['onabort'],
              error: null as DOMException | null,
              abort: () => undefined,
              objectStore: (storeName: string) => {
                if (!names.includes(storeName))
                  throw new Error(`Unexpected Study store ${storeName}`);
                indexes[storeName] ??= new Set();
                return createFakeStudyStore(
                  stores,
                  indexes,
                  keyPaths,
                  storeName,
                  transaction as unknown as IDBTransaction,
                );
              },
            };
            return transaction as unknown as IDBTransaction;
          },
        };
        const openRequest = request as unknown as IDBOpenDBRequest;
        window.setTimeout(() => {
          if (name !== STUDY_DB_NAME) {
            request.error = new DOMException('Unexpected database name.');
            request.onerror?.call(openRequest, new Event('error') as never);
            return;
          }
          request.result = db as unknown as IDBDatabase;
          if ((version ?? 0) > oldVersion) {
            request.transaction = db.transaction(Object.keys(stores), 'versionchange');
            request.onupgradeneeded?.call(openRequest, new Event('upgradeneeded') as never);
          }
          request.onsuccess?.call(openRequest, new Event('success') as never);
        }, 0);
        return openRequest;
      },
    },
  });
};

afterEach(() => {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: originalIndexedDb,
  });
});

describe('study storage contracts', () => {
  it('migrates partial imported data to the current schema version', () => {
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [],
      attempts: [],
      drafts: [],
    });

    expect(migrated.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(migrated.settings.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(migrated.settings.phaseRules.guidedRecallSuccessDaysToFreeRecall).toBe(2);
    expect(migrated.settings.fsrsConfig?.schemaVersion).toBe(1);
    expect(migrated.settings.fsrsConfig?.configVersion).toBe(1);
  });

  it('migrates legacy progress to uninitialized FSRS schedules with legacy due dates', () => {
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [
        {
          unitId: 'unit-1',
          phase: 'guided-recall',
          dueAt: '2026-08-11T10:00:00.000Z',
          lastStudiedAt: null,
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 0,
          createdAt: '2026-08-10T10:00:00.000Z',
          updatedAt: '2026-08-10T10:00:00.000Z',
        },
      ],
      attempts: [],
      drafts: [],
    });

    expect(migrated.progress[0]?.scheduling).toMatchObject({
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized: false,
      legacyDueAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('preserves valid FSRS card schedules and sanitizes corrupt ones during migration', () => {
    const scheduler = createStudyFsrsScheduler({
      ...createSeedStudyData().settings.fsrsConfig!.userSettings,
      enableFuzz: false,
    });
    const now = new Date('2026-08-10T10:00:00.000Z');
    const result = scheduler.applyStudyRating(
      {
        schemaVersion: 1,
        algorithm: 'fsrs',
        initialized: false,
        configVersion: 1,
      },
      'good',
      now,
    );
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [
        {
          unitId: 'valid',
          phase: 'guided-recall',
          scheduling: {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: true,
            card: result.card,
            initializedAt: now.toISOString(),
            lastScheduledAt: now.toISOString(),
            configVersion: 1,
          },
          dueAt: '2026-08-11T10:00:00.000Z',
          lastStudiedAt: now.toISOString(),
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          unitId: 'corrupt',
          phase: 'guided-recall',
          scheduling: {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: true,
            card: { due: 'not-a-date' } as never,
            configVersion: 1,
          },
          dueAt: '2026-08-12T10:00:00.000Z',
          lastStudiedAt: null,
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      attempts: [],
      drafts: [],
    });

    expect(migrated.progress.find((entry) => entry.unitId === 'valid')?.scheduling?.card).toEqual(
      result.card,
    );
    expect(migrated.progress.find((entry) => entry.unitId === 'corrupt')?.scheduling).toMatchObject(
      {
        initialized: false,
        legacyDueAt: '2026-08-12T10:00:00.000Z',
      },
    );
  });

  it('loads an old-schema IndexedDB fixture without replaying ambiguous historical attempts', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const legacyProgress = {
      ...seed.progress[0],
      dueAt: '2026-08-11T10:00:00.000Z',
      scheduling: undefined,
    };
    const legacyAttempt = {
      id: 'legacy-attempt-1',
      unitId: seed.units[0].id,
      promptId: seed.prompts[0].id,
      phase: 'guided-recall' as const,
      phaseBefore: 'guided-recall' as const,
      responseMode: 'freeText' as const,
      answer: 'legacy answer',
      guidedResponses: {},
      coveredConceptIds: [seed.concepts[0].id],
      rubricCoverage: [],
      rating: 'good' as const,
      startedAt: '2026-08-10T10:00:00.000Z',
      revealedAt: '2026-08-10T10:05:00.000Z',
      completedAt: '2026-08-10T10:06:00.000Z',
      scheduling: undefined,
    };
    const stores: FakeStudyStores = {
      documents: new Map(seed.documents.map((entry) => [entry.id, entry])),
      units: new Map(seed.units.map((entry) => [entry.id, entry])),
      prompts: new Map(seed.prompts.map((entry) => [entry.id, entry])),
      concepts: new Map(seed.concepts.map((entry) => [entry.id, entry])),
      rubrics: new Map(seed.rubrics.map((entry) => [entry.id, entry])),
      progress: new Map([[legacyProgress.unitId, legacyProgress]]),
      attempts: new Map([[legacyAttempt.id, legacyAttempt]]),
      drafts: new Map(),
      settings: new Map([
        [
          seed.settings.id,
          {
            ...seed.settings,
            schemaVersion: STUDY_DB_VERSION - 1,
            fsrsConfig: undefined,
          },
        ],
      ]),
    };
    installStudyIndexedDbFixture({ stores, oldVersion: STUDY_DB_VERSION - 1 });

    const loaded = await createStudyStorage().loadAll();

    expect(stores.legalDocuments).toBeInstanceOf(Map);
    expect(stores.legalComponents).toBeInstanceOf(Map);
    expect(stores.importHistory).toBeInstanceOf(Map);
    expect(loaded.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(loaded.attempts).toEqual([legacyAttempt]);
    expect(loaded.progress[0]?.scheduling).toMatchObject({
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized: false,
      legacyDueAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('upgrades v5 storage with legal lookup indexes and does not load legal text globally', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const component = {
      documentId: 'doc-surveys-act',
      id: 'section-8',
      sourceKey: 'section-8',
      componentType: 'section' as const,
      label: '8',
      heading: 'Survey plans',
      text: 'Official legal text that should not be in the core snapshot.',
      contentHash: 'hash-section-8',
      extractionStatus: 'complete' as const,
      recordKey: 'doc-surveys-act::section-8',
    };
    const stores: FakeStudyStores = {
      documents: new Map(seed.documents.map((entry) => [entry.id, entry])),
      units: new Map(seed.units.map((entry) => [entry.id, entry])),
      prompts: new Map(seed.prompts.map((entry) => [entry.id, entry])),
      concepts: new Map(seed.concepts.map((entry) => [entry.id, entry])),
      rubrics: new Map(seed.rubrics.map((entry) => [entry.id, entry])),
      progress: new Map(seed.progress.map((entry) => [entry.unitId, entry])),
      attempts: new Map(),
      drafts: new Map(),
      settings: new Map([[seed.settings.id, { ...seed.settings, schemaVersion: 5 }]]),
      legalDocuments: new Map(),
      legalComponents: new Map([[component.recordKey, component]]),
      importHistory: new Map(),
    };
    const indexes: FakeStudyIndexes = {};
    installStudyIndexedDbFixture({ stores, indexes, oldVersion: 5 });

    const storage = createStudyStorage();
    const loaded = await storage.loadAll();
    const byDocument = await storage.getLegalComponentsByDocument('doc-surveys-act');
    const bySourceKey = await storage.getLegalComponent('doc-surveys-act', 'section-8');

    expect(STUDY_DB_VERSION).toBe(7);
    expect(indexes.legalComponents).toEqual(
      new Set(['byDocumentId', 'bySourceKey', 'byType']),
    );
    expect(indexes.prompts).toContain('byUnitId');
    expect(indexes.rubrics).toContain('byUnitId');
    expect(indexes.concepts).toContain('byUnitId');
    expect(indexes.attempts).toEqual(new Set(['byUnitId', 'byUnitReviewedAt']));
    expect(loaded.legalComponents).toEqual([]);
    expect(byDocument).toHaveLength(1);
    expect(bySourceKey?.text).toBe(component.text);
  });

  it('repairs legacy legal component stores keyed by component id before import', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const stores: FakeStudyStores = {
      documents: new Map(seed.documents.map((entry) => [entry.id, entry])),
      units: new Map(seed.units.map((entry) => [entry.id, entry])),
      prompts: new Map(seed.prompts.map((entry) => [entry.id, entry])),
      concepts: new Map(seed.concepts.map((entry) => [entry.id, entry])),
      rubrics: new Map(seed.rubrics.map((entry) => [entry.id, entry])),
      progress: new Map(seed.progress.map((entry) => [entry.unitId, entry])),
      attempts: new Map(),
      drafts: new Map(),
      settings: new Map([[seed.settings.id, { ...seed.settings, schemaVersion: 6 }]]),
      legalDocuments: new Map(),
      legalComponents: new Map([
        [
          'section-1',
          {
            id: 'section-1',
            documentId: 'doc-old',
            sourceKey: 'section:1',
            componentType: 'section',
            label: '1',
            text: 'legacy component keyed by id',
            contentHash: 'old',
            extractionStatus: 'complete',
          },
        ],
      ]),
      importHistory: new Map(),
    };
    const keyPaths: FakeStudyKeyPaths = { legalComponents: 'id' };
    installStudyIndexedDbFixture({ stores, keyPaths, oldVersion: 6 });

    const loaded = await createStudyStorage().loadAll();

    expect(loaded.legalComponents).toEqual([]);
    expect(stores.legalComponents.size).toBe(0);
    expect(keyPaths.legalComponents).toBe('recordKey');
  });

  it('does not auto-seed after an intentional clean-slate reset leaves settings behind', () => {
    expect(shouldSeedStudyData({ documentCount: 0, settingsCount: 0 })).toBe(true);
    expect(shouldSeedStudyData({ documentCount: 0, settingsCount: 1 })).toBe(false);
    expect(shouldSeedStudyData({ documentCount: 5, settingsCount: 0 })).toBe(false);
  });

  it('migrates existing units and concepts to Phase 2D fields', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const legacy = {
      ...seed,
      units: [
        {
          ...seed.units[0],
          sourceMode: undefined,
          tags: undefined,
        },
        {
          ...seed.units[1],
          id: 'legacy-unlinked',
          documentIds: [],
          sectionRefs: [],
          sourceMode: undefined,
        },
      ],
      concepts: [
        {
          ...seed.concepts[0],
          origin: undefined,
          order: undefined,
        },
      ],
    } as unknown as Parameters<typeof migrateStudySnapshot>[0];

    const migrated = migrateStudySnapshot(legacy);

    expect(migrated.units.find((unit) => unit.id === seed.units[0].id)?.sourceMode).toBe(
      'official',
    );
    expect(migrated.units.find((unit) => unit.id === 'legacy-unlinked')?.sourceMode).toBe('custom');
    expect(migrated.units[0].tags).toEqual([]);
    expect(migrated.concepts[0].origin).toBe('manual');
    expect(migrated.concepts[0].order).toBe(0);
    expect(migrated.rubrics[0]).toMatchObject({
      unitId: seed.concepts[0].unitId,
      category: 'custom',
      prompt: seed.concepts[0].label,
      referenceAnswer: '',
    });
  });

  it('round-trips exported study data and preserves exact FSRS schedule and attempt metadata', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const progress = markReadingComplete(seed.progress[0], '2026-08-01T10:00:00.000Z');
    const baseData = {
      ...seed,
      progress: [progress, ...seed.progress.slice(1)],
    };
    const item = buildSessionItems({
      units: baseData.units,
      prompts: baseData.prompts,
      concepts: baseData.concepts,
      rubrics: baseData.rubrics,
      progress: baseData.progress,
      nowIso: '2026-08-01T10:05:00.000Z',
    })[0];
    if (!item) throw new Error('Expected a Study session item.');
    const rated = buildRatedStudyAttempt({
      data: baseData,
      item,
      rating: 'good',
      now: new Date('2026-08-01T10:06:00.000Z'),
      attemptId: 'attempt-1',
      answer: 'typed answer',
      responseMode: 'guided',
      guidedResponses: {},
      coveredConceptIds: [seed.concepts[0].id],
      rubricCoverage: [],
      startedAt: '2026-08-01T10:00:00.000Z',
    });
    const snapshot = {
      ...baseData,
      progress: [rated.progress, ...baseData.progress.slice(1)],
      attempts: [rated.attempt],
      drafts: [
        {
          id: 'active-session',
          unitId: seed.units[0].id,
          promptId: seed.prompts[0].id,
          answer: 'autosaved answer',
          startedAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:02:00.000Z',
        },
      ],
      rubrics: [
        {
          id: 'rubric-1',
          unitId: seed.units[0].id,
          category: 'purpose' as const,
          prompt: 'What is the purpose?',
          referenceAnswer: 'Reference answer.',
          required: true,
          origin: 'manual' as const,
          order: 0,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    };

    const restored = parseStudyImport(exportStudyData(snapshot, '2026-08-01T12:00:00.000Z'));

    expect(restored.attempts).toHaveLength(1);
    expect(restored.drafts[0]?.answer).toBe('autosaved answer');
    expect(restored.rubrics[0]?.prompt).toBe('What is the purpose?');
    expect(restored.settings.fsrsConfig?.resolvedParameters).toBeTruthy();
    expect(restored.progress[0]?.scheduling?.card).toEqual(rated.progress.scheduling?.card);
    expect(restored.attempts[0]?.scheduling).toEqual(rated.attempt.scheduling);
    expect(restored.attempts[0]?.scheduling).toMatchObject({
      schedulingApplied: true,
      cardBefore: rated.attempt.scheduling?.cardBefore,
      cardAfter: rated.attempt.scheduling?.cardAfter,
      fsrsReviewLog: rated.attempt.scheduling?.fsrsReviewLog,
      dueBefore: rated.attempt.scheduling?.dueBefore,
      dueAfter: rated.attempt.scheduling?.dueAfter,
      configVersion: rated.attempt.scheduling?.configVersion,
    });
  });

  it('loads a counted rating from IndexedDB after refresh and atomically undoes it', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const progress = markReadingComplete(seed.progress[0], '2026-08-01T10:00:00.000Z');
    const baseData = {
      ...seed,
      units: seed.units.slice(0, 1),
      prompts: seed.prompts.filter((prompt) => prompt.unitId === seed.units[0].id),
      concepts: seed.concepts.filter((concept) => concept.unitId === seed.units[0].id),
      rubrics: seed.rubrics.filter((rubric) => rubric.unitId === seed.units[0].id),
      progress: [progress],
    };
    const item = buildSessionItems({
      units: baseData.units,
      prompts: baseData.prompts,
      concepts: baseData.concepts,
      rubrics: baseData.rubrics,
      progress: baseData.progress,
      nowIso: '2026-08-01T10:05:00.000Z',
    })[0];
    if (!item) throw new Error('Expected a Study session item.');
    const rated = buildRatedStudyAttempt({
      data: baseData,
      item,
      rating: 'good',
      now: new Date('2026-08-01T10:06:00.000Z'),
      attemptId: 'attempt-persisted-undo',
      answer: 'typed answer',
      responseMode: 'guided',
      guidedResponses: {},
      coveredConceptIds: [],
      rubricCoverage: [],
      startedAt: '2026-08-01T10:00:00.000Z',
    });
    const stores: FakeStudyStores = {
      documents: new Map(baseData.documents.map((entry) => [entry.id, entry])),
      units: new Map(baseData.units.map((entry) => [entry.id, entry])),
      prompts: new Map(baseData.prompts.map((entry) => [entry.id, entry])),
      concepts: new Map(baseData.concepts.map((entry) => [entry.id, entry])),
      rubrics: new Map(baseData.rubrics.map((entry) => [entry.id, entry])),
      progress: new Map([[rated.progress.unitId, rated.progress]]),
      attempts: new Map([[rated.attempt.id, rated.attempt]]),
      drafts: new Map(),
      settings: new Map([[baseData.settings.id, baseData.settings]]),
      legalDocuments: new Map(),
      legalComponents: new Map(),
      importHistory: new Map(),
    };
    installStudyIndexedDbFixture({ stores, oldVersion: STUDY_DB_VERSION });
    const storage = createStudyStorage();

    const reloaded = await storage.loadAll();
    const undo = buildUndoLatestSchedulingRating({
      data: reloaded,
      attemptId: rated.attempt.id,
      now: new Date('2026-08-01T10:07:00.000Z'),
    });
    await storage.saveSchedulingUndo({
      attempt: undo.attempt,
      progress: undo.progress,
      expectedProgressUpdatedAt: rated.progress.updatedAt,
    });
    const afterUndo = await storage.loadAll();

    expect(afterUndo.attempts[0]?.scheduling?.undoneAt).toBe('2026-08-01T10:07:00.000Z');
    expect(afterUndo.progress[0]?.phase).toBe(rated.attempt.phaseBefore);
    expect(afterUndo.progress[0]?.dueAt).toBe(rated.attempt.scheduling?.dueBefore);
    expect(afterUndo.progress[0]?.scheduling).toMatchObject({
      initialized: false,
      legacyDueAt: rated.attempt.scheduling?.dueBefore,
    });
  });

  it('identifies only counted FSRS review attempts as replayable', () => {
    const counted = {
      scheduling: {
        algorithm: 'fsrs' as const,
        schedulingApplied: true,
        rating: 'good' as const,
        reviewedAt: '2026-08-10T10:00:00.000Z',
        reason: 'scheduled-review' as const,
      },
    };

    expect(isFsrsReplayableAttempt(counted)).toBe(true);
    expect(
      isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, schedulingApplied: false } }),
    ).toBe(false);
    expect(
      isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reason: 'preview' } }),
    ).toBe(false);
    expect(
      isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reason: 'source-review' } }),
    ).toBe(false);
    expect(
      isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reviewedAt: 'bad-date' } }),
    ).toBe(false);
    expect(
      isFsrsReplayableAttempt({
        scheduling: { ...counted.scheduling, undoneAt: '2026-08-10T11:00:00.000Z' },
      }),
    ).toBe(false);
  });

  it('generates deterministic OPFS paths for source assets', () => {
    expect(sanitizeStudyPathSegment('Surveys Act / Raw.HTML')).toBe('surveys-act-raw.html');
    expect(
      buildStudyOpfsPath({
        documentId: 'Doc Surveys Act',
        role: 'normalized-markdown',
        fileName: 'Part 1.md',
      }),
    ).toBe('study/documents/doc-surveys-act/normalized-markdown/part-1.md');
  });

  it('keeps raw source file metadata separate from editable study content', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const document = {
      ...seed.documents[0],
      sourceFiles: [
        {
          id: 'asset-1',
          role: 'raw-html' as const,
          label: 'source.html',
          storagePath: 'study/documents/doc-surveys-act/raw-html/source.html',
          mediaType: 'text/html',
          byteLength: 100,
          createdAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    };
    const unit = {
      ...seed.units[0],
      editableSummary: 'learner note',
      referenceAnswer: 'reference answer',
    };

    expect(document.sourceFiles[0]?.storagePath).toContain('/raw-html/');
    expect(unit.editableSummary).not.toBe(unit.referenceAnswer);
    expect(document.summary).not.toBe(unit.editableSummary);
  });
});
