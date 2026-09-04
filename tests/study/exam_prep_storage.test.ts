/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { createSeedStudyData } from '../../src/study/studySeed';
import {
  createStudyStorage,
  migrateStudySnapshot,
  STUDY_DB_VERSION,
  STUDY_SCHEMA_VERSION,
} from '../../src/study/studyStorage';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { normalizeExamPrepSettings } from '../../src/study/examPrep/examPrepSettings';
import {
  installExamPrepIndexedDbFixture,
  restoreWindowIndexedDb,
  type FakeStores,
} from './exam_prep_storage_support';
import {
  archivedBinding,
  currentBinding,
  makeRecallAttempt,
  makeRecallProgress,
  makeSettings,
  makeUnitProgress,
  testCard,
} from './exam_prep_test_support';

const originalIndexedDb = window.indexedDB;

afterEach(() => {
  restoreWindowIndexedDb(originalIndexedDb);
});

const seedMaps = (nowIso: string): FakeStores => {
  const seed = createSeedStudyData(nowIso);
  return {
    documents: new Map(seed.documents.map((entry) => [entry.id, entry])),
    units: new Map(seed.units.map((entry) => [entry.id, entry])),
    prompts: new Map(seed.prompts.map((entry) => [entry.id, entry])),
    concepts: new Map(seed.concepts.map((entry) => [entry.id, entry])),
    rubrics: new Map(seed.rubrics.map((entry) => [entry.id, entry])),
    progress: new Map(seed.progress.map((entry) => [entry.unitId, entry])),
    attempts: new Map(),
    drafts: new Map(),
    settings: new Map([[seed.settings.id, { ...seed.settings, schemaVersion: 8 }]]),
    legalDocuments: new Map(),
    legalComponents: new Map(),
    importHistory: new Map(),
    aiAuthoringRuns: new Map(),
    aiStudyMapProposals: new Map(),
    aiUnitProposals: new Map(),
  };
};

describe('Exam Prep schema v9 migration and storage', () => {
  it('bumps DB and Study schema versions to 9', () => {
    expect(STUDY_DB_VERSION).toBe(9);
    expect(STUDY_SCHEMA_VERSION).toBe(9);
  });

  it('migrates v8 snapshots with empty Exam Prep defaults, preserving all Study data', () => {
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const input = { ...seed } as unknown as Parameters<typeof migrateStudySnapshot>[0];
    delete (input as { examPrepUnitProgress?: unknown }).examPrepUnitProgress;
    delete (input as { examPrepRecallProgress?: unknown }).examPrepRecallProgress;
    delete (input as { examPrepAttempts?: unknown }).examPrepAttempts;
    delete (input as { examPrepSettings?: unknown }).examPrepSettings;
    const migrated = migrateStudySnapshot(input);
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.settings.schemaVersion).toBe(9);
    expect(migrated.examPrepUnitProgress).toEqual([]);
    expect(migrated.examPrepRecallProgress).toEqual([]);
    expect(migrated.examPrepAttempts).toEqual([]);
    expect(migrated.examPrepSettings).toEqual([]);
    expect(migrated.documents).toHaveLength(seed.documents.length);
    expect(migrated.units).toHaveLength(seed.units.length);
    expect(migrated.progress).toHaveLength(seed.progress.length);
  });

  it('upgrades v8 IndexedDB to v9 by adding four Exam Prep stores while preserving existing data', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    expect(stores.examPrepUnitProgress).toBeUndefined();
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const loaded = await createStudyStorage().loadAll();
    expect(loaded.schemaVersion).toBe(9);
    expect(stores.examPrepUnitProgress).toBeInstanceOf(Map);
    expect(stores.examPrepRecallProgress).toBeInstanceOf(Map);
    expect(stores.examPrepAttempts).toBeInstanceOf(Map);
    expect(stores.examPrepSettings).toBeInstanceOf(Map);
    expect(loaded.units).toHaveLength(5);
    expect(loaded.attempts).toEqual([]);
    expect(loaded.examPrepUnitProgress).toEqual([]);
    expect(loaded.examPrepRecallProgress).toEqual([]);
  });

  it('persists and deletes unit studied progress', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const record = makeUnitProgress('unit-surveys-monuments', '2026-09-05T00:00:00.000Z');
    await storage.saveExamPrepUnitProgress(record);
    let loaded = await storage.loadAll();
    expect(loaded.examPrepUnitProgress).toEqual([record]);
    await storage.deleteExamPrepUnitProgress(record.id);
    loaded = await storage.loadAll();
    expect(loaded.examPrepUnitProgress).toEqual([]);
  });

  it('persists settings records including archived hashes', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const current = makeSettings(
      { newRecallCardsPerSession: 4, maxRecallCardsPerSession: 9 },
      currentBinding,
    );
    const archived = makeSettings(
      { newRecallCardsPerSession: 1, maxRecallCardsPerSession: 3 },
      archivedBinding,
    );
    await storage.saveExamPrepSettings(current);
    await storage.saveExamPrepSettings(archived);
    const loaded = await storage.loadAll();
    expect(loaded.examPrepSettings).toEqual([current, archived]);
  });

  it('atomically saves a recall rating (attempt + progress) and reloads both', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const progress = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard(),
    });
    const attempt = makeRecallAttempt({
      id: 'attempt-1',
      taskId: task.id,
      unitId: task.unitId,
    });
    await storage.saveExamPrepRecallRating({
      attempt,
      progress,
      expectedProgressUpdatedAt: undefined,
    });
    const loaded = await storage.loadAll();
    expect(loaded.examPrepRecallProgress).toEqual([progress]);
    expect(loaded.examPrepAttempts).toEqual([attempt]);
    // existing Study attempts are untouched
    expect(loaded.attempts).toEqual([]);
  });

  it('rejects stale recall ratings without writing the attempt', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[1];
    if (!task) throw new Error('expected task');
    const firstProgress = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard({ state: 'Learning', due: '2026-09-10T00:00:00.000Z' }),
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    await storage.saveExamPrepRecallRating({
      attempt: makeRecallAttempt({ id: 'attempt-1', taskId: task.id, unitId: task.unitId }),
      progress: firstProgress,
    });
    const stored = await storage.loadAll();
    expect(stored.examPrepAttempts).toHaveLength(1);

    // a rating built from stale progress must fail closed
    const staleProgress = { ...firstProgress, updatedAt: '2026-09-10T00:00:00.001Z' };
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: makeRecallAttempt({ id: 'attempt-2', taskId: task.id, unitId: task.unitId }),
        progress: staleProgress,
        expectedProgressUpdatedAt: '2026-09-10T00:00:00.001Z',
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');
    const after = await storage.loadAll();
    expect(after.examPrepAttempts).toHaveLength(1);
    expect(after.examPrepRecallProgress[0]?.updatedAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('replaceAll replaces Exam Prep stores and keeps clean-slate resets empty', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const progress = makeRecallProgress({ taskId: task.id, unitId: task.unitId, card: testCard() });
    const attempt = makeRecallAttempt({ id: 'attempt-replace', taskId: task.id, unitId: task.unitId });
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const snapshot: StudyDataSnapshot = {
      ...seed,
      examPrepUnitProgress: [makeUnitProgress('unit-surveys-monuments')],
      examPrepRecallProgress: [progress],
      examPrepAttempts: [attempt],
      examPrepSettings: [makeSettings({}, currentBinding)],
    };
    await storage.replaceAll(snapshot);
    let loaded = await storage.loadAll();
    expect(loaded.examPrepUnitProgress).toHaveLength(1);
    expect(loaded.examPrepRecallProgress).toEqual([progress]);
    expect(loaded.examPrepAttempts).toEqual([attempt]);

    await storage.replaceAll({ ...createSeedStudyData('2026-08-01T00:00:00.000Z') });
    loaded = await storage.loadAll();
    expect(loaded.examPrepUnitProgress).toEqual([]);
    expect(loaded.examPrepRecallProgress).toEqual([]);
    expect(loaded.examPrepAttempts).toEqual([]);
    expect(loaded.examPrepSettings).toEqual([]);
  });
});

describe('Exam Prep export/import round-trips', () => {
  it('round-trips current- and archived-hash Exam Prep arrays byte-preserved', () => {
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const currentUnit = makeUnitProgress('unit-surveys-monuments', '2026-09-05T00:00:00.000Z');
    const archivedUnit = makeUnitProgress(
      'unit-boundaries-confirmation-process',
      '2026-09-01T00:00:00.000Z',
      archivedBinding,
    );
    const task0 = EXAM_PREP_RECALL_TASKS[0];
    const task1 = EXAM_PREP_RECALL_TASKS[1];
    if (!task0 || !task1) throw new Error('expected tasks');
    const currentProgress = makeRecallProgress({
      taskId: task0.id,
      unitId: task0.unitId,
      card: testCard(),
    });
    const archivedProgress = makeRecallProgress({
      taskId: task1.id,
      unitId: task1.unitId,
      card: testCard({ state: 'Review', due: '2026-10-01T00:00:00.000Z' }),
      binding: archivedBinding,
    });
    const snapshot: StudyDataSnapshot = {
      ...seed,
      examPrepUnitProgress: [currentUnit, archivedUnit],
      examPrepRecallProgress: [currentProgress, archivedProgress],
      examPrepAttempts: [
        makeRecallAttempt({ id: 'attempt-export', taskId: task0.id, unitId: task0.unitId }),
        makeRecallAttempt({
          id: 'attempt-export-archived',
          taskId: task1.id,
          unitId: task1.unitId,
          binding: archivedBinding,
        }),
      ],
      examPrepSettings: [
        makeSettings({}, currentBinding),
        makeSettings({ newRecallCardsPerSession: 1, maxRecallCardsPerSession: 3 }, archivedBinding),
      ],
    };
    const restored = parseStudyImport(
      exportStudyData(snapshot, '2026-09-05T00:00:00.000Z'),
    );
    expect(restored.examPrepUnitProgress).toEqual([currentUnit, archivedUnit]);
    expect(restored.examPrepRecallProgress).toEqual([currentProgress, archivedProgress]);
    expect(restored.examPrepAttempts).toEqual(snapshot.examPrepAttempts);
    expect(restored.examPrepSettings).toEqual([
      normalizeExamPrepSettings(makeSettings({}, currentBinding)),
      normalizeExamPrepSettings(
        makeSettings({ newRecallCardsPerSession: 1, maxRecallCardsPerSession: 3 }, archivedBinding),
      ),
    ]);
    expect(restored.schemaVersion).toBe(9);
    // other Study data intact
    expect(restored.units).toHaveLength(snapshot.units.length);
    expect(restored.progress).toEqual(snapshot.progress);
  });

  it('migration keeps records from unknown future hashes (no deletion)', () => {
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const unit = makeUnitProgress('unit-land-titles-parcel', '2026-09-02T00:00:00.000Z', {
      curriculumId: EXAM_PREP_MANIFEST.curriculumId,
      curriculumContentHash: 'unknown-future-hash',
    });
    const migrated = migrateStudySnapshot({
      ...seed,
      examPrepUnitProgress: [unit],
    });
    expect(migrated.examPrepUnitProgress).toEqual([unit]);
    // but selectors never surface it as current
    expect(
      migrated.examPrepUnitProgress.some((record) => record.curriculumContentHash === EXAM_PREP_MANIFEST.contentHash),
    ).toBe(false);
  });
});
