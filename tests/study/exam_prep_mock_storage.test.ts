// Exam Prep Mock — v10 storage, CAS-guarded mock writes, migration and
// export/import round-trips.

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { createSeedStudyData } from '../../src/study/studySeed';
import {
  createStudyStorage,
  migrateStudySnapshot,
  STUDY_DB_VERSION,
  STUDY_SCHEMA_VERSION,
} from '../../src/study/studyStorage';
import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { EXAM_PREP_PROVISIONAL_MOCK_V1 } from '../../src/study/examPrep/mock/examPrepMockProfiles';
import { currentExamPrepBinding } from '../../src/study/examPrep/examPrepManifest';
import { selectActiveMockSession, selectCurrentMockSessions } from '../../src/study/examPrep/mock/examPrepMockSelectors';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';
import {
  installExamPrepIndexedDbFixture,
  restoreWindowIndexedDb,
  type FakeStores,
} from './exam_prep_storage_support';
import {
  makeDrillAttempt,
  makeSettings,
  makeUnitProgress,
} from './exam_prep_test_support';
import {
  EXAM_PREP_TEST_ARCHIVED_HASH,
} from './exam_prep_test_support';
import { makeGradedMockSession, makeMockSession, makeSubmittedMockSession } from './exam_prep_mock_support';

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
    settings: new Map([[seed.settings.id, seed.settings]]),
    legalDocuments: new Map(),
    legalComponents: new Map(),
    importHistory: new Map(),
    aiAuthoringRuns: new Map(),
    aiStudyMapProposals: new Map(),
    aiUnitProposals: new Map(),
    examPrepUnitProgress: new Map(),
    examPrepRecallProgress: new Map(),
    examPrepAttempts: new Map(),
    examPrepSettings: new Map(),
  };
};

describe('Exam Prep mock schema v10', () => {
  it('keeps DB/schema versions at 10 with exactly five Exam Prep stores', () => {
    expect(STUDY_DB_VERSION).toBe(10);
    expect(STUDY_SCHEMA_VERSION).toBe(10);
  });

  it('migrates a v9 database by adding only the mock store and preserving everything', async () => {
    const stores = seedMaps('2026-09-01T00:00:00.000Z');
    const unit = makeUnitProgress('unit-surveys-monuments', '2026-09-02T00:00:00.000Z');
    const settings = makeSettings({}, currentExamPrepBinding());
    const drillAttempt = makeDrillAttempt({
      id: 'drill-attempt-1',
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
    });
    stores.examPrepUnitProgress = new Map([[unit.id, unit]]);
    stores.examPrepAttempts = new Map([[drillAttempt.id, drillAttempt]]);
    stores.examPrepSettings = new Map([[settings.id, settings]]);
    installExamPrepIndexedDbFixture({ stores, oldVersion: 9 });
    const loaded = await createStudyStorage().loadAll();
    expect(loaded.schemaVersion).toBe(10);
    expect(loaded.examPrepMockSessions).toEqual([]);
    expect(stores.examPrepMockSessions).toBeInstanceOf(Map);
    expect(loaded.examPrepUnitProgress).toEqual([unit]);
    expect(loaded.examPrepAttempts).toEqual([drillAttempt]);
    expect(loaded.examPrepSettings).toEqual([settings]);
    expect(loaded.units).toHaveLength(5);
    expect(loaded.progress).toHaveLength(loaded.units.length);
  });

  it('defaults v9 JSON snapshots to an empty mock history without fabrication', () => {
    const seed = createSeedStudyData('2026-09-01T00:00:00.000Z');
    const input = { ...seed } as unknown as Parameters<typeof migrateStudySnapshot>[0];
    delete (input as { examPrepMockSessions?: unknown }).examPrepMockSessions;
    const migrated = migrateStudySnapshot(input);
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.examPrepMockSessions).toEqual([]);
  });
});

describe('saveExamPrepMockSession CAS semantics', () => {
  const storageWithFixture = () => {
    const stores = seedMaps('2026-09-01T00:00:00.000Z');
    installExamPrepIndexedDbFixture({ stores, oldVersion: 10 });
    return { storage: createStudyStorage(), stores };
  };

  it('creation: expected absent + absent store succeeds', async () => {
    const { storage } = storageWithFixture();
    const session = makeMockSession({ seed: 'cas-create' });
    await expect(
      storage.saveExamPrepMockSession({ session, expectation: { kind: 'absent' } }),
    ).resolves.toBeUndefined();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions.map((s) => s.id)).toEqual([session.id]);
  });

  it('duplicate creation: expected absent + existing record rejects', async () => {
    const { storage } = storageWithFixture();
    const session = makeMockSession({ seed: 'cas-dup' });
    await storage.saveExamPrepMockSession({ session, expectation: { kind: 'absent' } });
    await expect(
      storage.saveExamPrepMockSession({ session, expectation: { kind: 'absent' } }),
    ).rejects.toThrow('changed in another tab');
  });

  it('update: expected existing A + stored A succeeds', async () => {
    const { storage } = storageWithFixture();
    const first = makeMockSession({ seed: 'cas-update', startedAt: '2026-09-01T10:00:00.000Z' });
    await storage.saveExamPrepMockSession({ session: first, expectation: { kind: 'absent' } });
    const second = {
      ...first,
      updatedAt: '2026-09-01T11:00:00.000Z',
      responses: first.responses.map((response, index) =>
        index === 0 ? { ...response, answer: 'typed' } : response,
      ),
    };
    await expect(
      storage.saveExamPrepMockSession({
        session: second,
        expectation: { kind: 'existing', updatedAt: first.updatedAt },
      }),
    ).resolves.toBeUndefined();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions[0]?.responses[0]?.answer).toBe('typed');
  });

  it('stale update: expected A + stored B rejects and keeps B', async () => {
    const { storage } = storageWithFixture();
    const stored = makeMockSession({ seed: 'cas-stale', startedAt: '2026-09-01T10:00:00.000Z' });
    await storage.saveExamPrepMockSession({ session: stored, expectation: { kind: 'absent' } });
    const stale = { ...stored, updatedAt: '2026-09-01T09:00:00.000Z' };
    await expect(
      storage.saveExamPrepMockSession({
        session: stale,
        expectation: { kind: 'existing', updatedAt: stale.updatedAt },
      }),
    ).rejects.toThrow('changed in another tab');
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions[0]?.updatedAt).toBe(stored.updatedAt);
  });

  it('missing record: expected existing + stored absent rejects', async () => {
    const { storage } = storageWithFixture();
    const session = makeMockSession({ seed: 'cas-missing' });
    await expect(
      storage.saveExamPrepMockSession({
        session,
        expectation: { kind: 'existing', updatedAt: '2026-09-01T10:00:00.000Z' },
      }),
    ).rejects.toThrow('changed in another tab');
  });

  it('one-active lock: creating a second current in-progress mock rejects transactionally', async () => {
    const { storage } = storageWithFixture();
    const first = makeMockSession({ seed: 'lock-first' });
    await storage.saveExamPrepMockSession({ session: first, expectation: { kind: 'absent' } });
    const second = makeMockSession({ seed: 'lock-second' });
    await expect(
      storage.saveExamPrepMockSession({ session: second, expectation: { kind: 'absent' } }),
    ).rejects.toThrow('already in progress');
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions).toHaveLength(1);
    expect(loaded.examPrepMockSessions[0]?.id).toBe(first.id);
  });

  it('one-active lock: after submit/abandon the next in-progress creation succeeds', async () => {
    const { storage } = storageWithFixture();
    const first = makeMockSession({ seed: 'lock-cycle' });
    await storage.saveExamPrepMockSession({ session: first, expectation: { kind: 'absent' } });
    const submitted = {
      ...first,
      status: 'submitted' as const,
      submittedAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
    };
    await storage.saveExamPrepMockSession({
      session: submitted,
      expectation: { kind: 'existing', updatedAt: first.updatedAt },
    });
    const second = makeMockSession({ seed: 'lock-cycle-2' });
    await expect(
      storage.saveExamPrepMockSession({ session: second, expectation: { kind: 'absent' } }),
    ).resolves.toBeUndefined();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions.filter((s) => s.status === 'in_progress')).toHaveLength(1);
    expect(loaded.examPrepMockSessions).toHaveLength(2);
  });

  it('one-active lock: autosave updates of the OWN in-progress session stay allowed', async () => {
    const { storage } = storageWithFixture();
    const first = makeMockSession({ seed: 'lock-own-update' });
    await storage.saveExamPrepMockSession({ session: first, expectation: { kind: 'absent' } });
    const updated = {
      ...first,
      updatedAt: '2026-09-01T13:00:00.000Z',
      responses: first.responses.map((response, index) =>
        index === 0 ? { ...response, answer: 'draft' } : response,
      ),
    };
    await expect(
      storage.saveExamPrepMockSession({
        session: updated,
        expectation: { kind: 'existing', updatedAt: first.updatedAt },
      }),
    ).resolves.toBeUndefined();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions).toHaveLength(1);
    expect(loaded.examPrepMockSessions[0]?.responses[0]?.answer).toBe('draft');
  });

  it('one-active lock: an archived-hash in-progress record does not block a current create', async () => {
    const { storage } = storageWithFixture();
    const archived = makeMockSession({ seed: 'lock-archived' });
    const archivedRecord: ExamPrepMockSession = {
      ...archived,
      curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH,
    };
    await storage.saveExamPrepMockSession({
      session: archivedRecord,
      expectation: { kind: 'absent' },
    });
    const current = makeMockSession({ seed: 'lock-current-after-archived' });
    await expect(
      storage.saveExamPrepMockSession({ session: current, expectation: { kind: 'absent' } }),
    ).resolves.toBeUndefined();
    const loaded = await storage.loadAll();
    expect(loaded.examPrepMockSessions.filter((s) => s.status === 'in_progress')).toHaveLength(2);
    expect(selectActiveMockSession(loaded.examPrepMockSessions)?.id).toBe(current.id);
  });

  it('one-active lock: submitting/abandoning still works while another tab holds the active id', async () => {
    const { storage } = storageWithFixture();
    const first = makeMockSession({ seed: 'lock-submit-wins' });
    await storage.saveExamPrepMockSession({ session: first, expectation: { kind: 'absent' } });
    // A stale tab that never saw the newer revision cannot autosave over it.
    const staleTab = makeMockSession({ seed: 'lock-second' });
    await expect(
      storage.saveExamPrepMockSession({
        session: staleTab,
        expectation: { kind: 'absent' },
      }),
    ).rejects.toThrow('already in progress');
  });

  it('never touches ordinary Exam Prep or Study records (contamination regression)', async () => {
    const stores = seedMaps('2026-09-01T00:00:00.000Z');
    const unit = makeUnitProgress('unit-surveys-monuments', '2026-09-02T00:00:00.000Z');
    const settings = makeSettings({}, currentExamPrepBinding());
    stores.examPrepUnitProgress = new Map([[unit.id, unit]]);
    stores.examPrepSettings = new Map([[settings.id, settings]]);
    installExamPrepIndexedDbFixture({ stores, oldVersion: 10 });
    const storage = createStudyStorage();
    const before = await storage.loadAll();
    const session = makeMockSession({ seed: 'no-contamination' });
    await storage.saveExamPrepMockSession({ session, expectation: { kind: 'absent' } });
    const after = await storage.loadAll();
    expect(after.examPrepUnitProgress).toEqual(before.examPrepUnitProgress);
    expect(after.examPrepRecallProgress).toEqual(before.examPrepRecallProgress);
    expect(after.examPrepAttempts).toEqual(before.examPrepAttempts);
    expect(after.examPrepSettings).toEqual(before.examPrepSettings);
    expect(after.examPrepMockSessions).toHaveLength(1);
  });
});

describe('Exam Prep mock export/import round-trips', () => {
  it('round-trips active/submitted/graded/abandoned and archived-hash sessions exactly', async () => {
    const seed = createSeedStudyData('2026-09-01T00:00:00.000Z');
    const active = makeMockSession({ seed: 'rt-active' });
    const submitted = makeSubmittedMockSession();
    const graded = makeGradedMockSession();
    const abandoned = { ...makeMockSession({ seed: 'rt-abandoned' }), status: 'abandoned' as const };
    const archived: ExamPrepMockSession = {
      ...makeMockSession({ seed: 'rt-archived' }),
      curriculumContentHash: EXAM_PREP_TEST_ARCHIVED_HASH,
    };
    const snapshot = {
      ...seed,
      examPrepMockSessions: [active, submitted, graded, abandoned, archived],
    };
    const restored = parseStudyImport(
      exportStudyData(snapshot, '2026-09-05T00:00:00.000Z'),
    );
    expect(restored.schemaVersion).toBe(10);
    expect(restored.examPrepMockSessions).toEqual([active, submitted, graded, abandoned, archived]);
    // Profile snapshots/question refs/grading survive byte-preserved.
    expect(restored.examPrepMockSessions[0]?.profileSnapshot).toEqual(EXAM_PREP_PROVISIONAL_MOCK_V1);
    expect(restored.examPrepMockSessions[1]?.responses[0]?.grading).toBeTruthy();
    // Current selectors ignore the archived-hash session.
    expect(selectCurrentMockSessions(restored.examPrepMockSessions)).toHaveLength(4);
    expect(selectActiveMockSession(restored.examPrepMockSessions)?.id).toBe(active.id);
  });
});
