/** @vitest-environment jsdom */

// Exam Prep Phase 2 — generic immutable attempt persistence, explicit recall
// CAS expectations, and export/import of the widened `examPrepAttempts`
// union (recall | recognition | locate | drill).
//
// Storage writes go through the fake IndexedDB fixture shared with the
// schema-v9 suite; recognition/locate/drill writes use immutable `add` and
// must fail closed on duplicate attempt ids. Recall ratings keep their
// stale-`updatedAt` CAS: absent expectation rejects when a progress record
// already exists and succeeds only when the expectation matches the store.

import { afterEach, describe, expect, it } from 'vitest';
import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { createSeedStudyData } from '../../src/study/studySeed';
import { createStudyStorage } from '../../src/study/studyStorage';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import {
  archivedBinding,
  currentBinding,
  makeDrillAttempt,
  makeLocateAttempt,
  makeRecallAttempt,
  makeRecallProgress,
  makeRecognitionAttempt,
  testCard,
} from './exam_prep_test_support';
import {
  installExamPrepIndexedDbFixture,
  restoreWindowIndexedDb,
  type FakeStores,
} from './exam_prep_storage_support';

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

describe('Exam Prep generic immutable attempt persistence', () => {
  it('saves recognition, locate, and drill attempts through saveExamPrepAttempt and reloads them', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const recognition = makeRecognitionAttempt({
      id: 'attempt-recognition-1',
      taskId: 'recognition:A-NBLS-01:1',
      unitId: 'A-NBLS-01',
      result: 'got_it',
      answer: 'law',
    });
    const locate = makeLocateAttempt({
      id: 'attempt-locate-1',
      taskId: 'locate:A-NBLS-02:1',
      unitId: 'A-NBLS-02',
      result: 'missed',
      elapsedSeconds: 42,
      expectedSourceKey: 'section:1',
    });
    const drill = makeDrillAttempt({
      id: 'attempt-drill-1',
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
      difficulty: 'routing',
      elapsedSeconds: 120,
      targetSeconds: 150,
    });
    await storage.saveExamPrepAttempt(recognition);
    await storage.saveExamPrepAttempt(locate);
    await storage.saveExamPrepAttempt(drill);
    const loaded = await storage.loadAll();
    expect(loaded.examPrepAttempts).toEqual([recognition, locate, drill]);
    // kind discriminators survive storage untouched
    expect(loaded.examPrepAttempts.map((attempt) => attempt.kind)).toEqual([
      'recognition',
      'locate',
      'drill',
    ]);
  });

  it('rejects a duplicate generic attempt id without rewriting the stored record', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const drill = makeDrillAttempt({
      id: 'attempt-drill-same',
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
    });
    await storage.saveExamPrepAttempt(drill);
    const duplicate = makeDrillAttempt({
      id: 'attempt-drill-same',
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
      completedAt: '2026-09-06T00:00:00.000Z',
    });
    await expect(storage.saveExamPrepAttempt(duplicate)).rejects.toThrow();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepAttempts).toEqual([drill]);
  });

  it('keeps recognition/locate/drill attempts immutable when a recall rating is also saved', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const recallAttempt = makeRecallAttempt({
      id: 'attempt-recall-1',
      taskId: task.id,
      unitId: task.unitId,
    });
    const recognition = makeRecognitionAttempt({
      id: 'attempt-recognition-2',
      taskId: 'recognition:A-BYL-01:1',
      unitId: 'A-BYL-01',
      result: 'missed',
    });
    await storage.saveExamPrepAttempt(recognition);
    await storage.saveExamPrepRecallRating({
      attempt: recallAttempt,
      progress: makeRecallProgress({ taskId: task.id, unitId: task.unitId, card: testCard() }),
      expectation: { kind: 'absent' },
    });
    const loaded = await storage.loadAll();
    expect(loaded.examPrepAttempts).toEqual([recognition, recallAttempt]);
  });
});

describe('Exam Prep recall CAS expectations', () => {
  it('rejects an absent expectation when a progress record already exists', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const progress = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard(),
      updatedAt: '2026-09-05T00:00:00.000Z',
    });
    await storage.saveExamPrepRecallRating({
      attempt: makeRecallAttempt({ id: 'attempt-1', taskId: task.id, unitId: task.unitId }),
      progress,
      expectation: { kind: 'absent' },
    });
    // second writer believes there is no progress yet: stale and must fail closed
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: makeRecallAttempt({ id: 'attempt-2', taskId: task.id, unitId: task.unitId }),
        progress,
        expectation: { kind: 'absent' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');
    const loaded = await storage.loadAll();
    expect(loaded.examPrepAttempts).toHaveLength(1);
    expect(loaded.examPrepRecallProgress).toEqual([progress]);
  });

  it('accepts an existing expectation only when updatedAt matches the store', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const first = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard({ state: 'Learning', due: '2026-09-05T00:00:00.000Z' }),
      updatedAt: '2026-09-05T00:00:00.000Z',
    });
    await storage.saveExamPrepRecallRating({
      attempt: makeRecallAttempt({ id: 'attempt-1', taskId: task.id, unitId: task.unitId }),
      progress: first,
      expectation: { kind: 'absent' },
    });

    // stale updatedAt: reject
    const stale = { ...first, updatedAt: '2026-09-05T00:00:00.001Z' };
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: makeRecallAttempt({ id: 'attempt-2', taskId: task.id, unitId: task.unitId }),
        progress: stale,
        expectation: { kind: 'existing', updatedAt: '2026-09-05T00:00:00.001Z' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');

    // matching updatedAt: succeed and store the follow-up rating
    const followUp = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard({ state: 'Review', due: '2026-09-20T00:00:00.000Z' }),
      reviewCount: 2,
      createdAt: first.createdAt,
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
    await storage.saveExamPrepRecallRating({
      attempt: makeRecallAttempt({ id: 'attempt-3', taskId: task.id, unitId: task.unitId }),
      progress: followUp,
      expectation: { kind: 'existing', updatedAt: first.updatedAt },
    });
    const loaded = await storage.loadAll();
    expect(loaded.examPrepRecallProgress[0]?.updatedAt).toBe('2026-09-06T00:00:00.000Z');
    expect(loaded.examPrepAttempts).toHaveLength(2);
  });

  it('rejects an existing expectation when no record is stored at all', async () => {
    const stores = seedMaps('2026-08-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 8 });
    const storage = createStudyStorage();
    const task = EXAM_PREP_RECALL_TASKS[0];
    if (!task) throw new Error('expected task');
    const progress = makeRecallProgress({
      taskId: task.id,
      unitId: task.unitId,
      card: testCard(),
      updatedAt: '2026-09-05T00:00:00.000Z',
    });
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: makeRecallAttempt({ id: 'attempt-1', taskId: task.id, unitId: task.unitId }),
        progress,
        expectation: { kind: 'existing', updatedAt: '2026-09-05T00:00:00.000Z' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');
    const loaded = await storage.loadAll();
    expect(loaded.examPrepAttempts).toEqual([]);
  });
});

describe('Exam Prep export/import of the widened attempts union', () => {
  it('round-trips recognition/locate/drill attempts (current + archived hashes) byte-preserved', () => {
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const attempts = [
      makeRecallAttempt({
        id: 'export-recall',
        taskId: EXAM_PREP_RECALL_TASKS[0]?.id ?? 'recall:x:1',
        unitId: 'unit-1',
      }),
      makeRecognitionAttempt({
        id: 'export-recognition',
        taskId: 'recognition:A-NBLS-01:1',
        unitId: 'A-NBLS-01',
        result: 'got_it',
        cue: 'cue',
        expectedDocumentIds: ['doc-a'],
        answer: 'typed',
      }),
      makeLocateAttempt({
        id: 'export-locate',
        taskId: 'locate:A-NBLS-02:1',
        unitId: 'A-NBLS-02',
        result: 'found',
        elapsedSeconds: 33,
        expectedSourceKey: 'section:2',
      }),
      makeDrillAttempt({
        id: 'export-drill',
        taskId: 'drill:DRILL-01',
        unitId: 'DRILL-01',
        difficulty: 'direct',
        elapsedSeconds: 70,
        targetSeconds: 90,
        practiceDate: '2026-09-05',
      }),
      makeRecognitionAttempt({
        id: 'export-recognition-archived',
        taskId: 'recognition:A-NBLS-01:1',
        unitId: 'A-NBLS-01',
        result: 'missed',
        binding: archivedBinding,
      }),
    ];
    const snapshot: StudyDataSnapshot = { ...seed, examPrepAttempts: attempts };
    const restored = parseStudyImport(exportStudyData(snapshot, '2026-09-05T00:00:00.000Z'));
    expect(restored.schemaVersion).toBe(9);
    expect(restored.examPrepAttempts).toEqual(attempts);
    expect(restored.examPrepAttempts.map((attempt) => attempt.kind)).toEqual([
      'recall',
      'recognition',
      'locate',
      'drill',
      'recognition',
    ]);
    // current-hash selector sees exactly the current-binding attempts
    const current = restored.examPrepAttempts.filter(
      (attempt) =>
        attempt.curriculumId === currentBinding.curriculumId &&
        attempt.curriculumContentHash === currentBinding.curriculumContentHash,
    );
    expect(current).toHaveLength(4);
  });

  it('migration leaves widened-union attempts from unknown future hashes intact', () => {
    const seed = createSeedStudyData('2026-08-01T00:00:00.000Z');
    const futureDrill = makeDrillAttempt({
      id: 'future-drill',
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
      binding: {
        curriculumId: currentBinding.curriculumId,
        curriculumContentHash: 'unknown-future-hash',
      },
    });
    const snapshot = { ...seed, examPrepAttempts: [futureDrill] };
    const restored = parseStudyImport(exportStudyData(snapshot, '2026-09-05T00:00:00.000Z'));
    expect(restored.examPrepAttempts).toEqual([futureDrill]);
  });
});
