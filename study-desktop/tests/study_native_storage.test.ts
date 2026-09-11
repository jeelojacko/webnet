/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import { createNativeStudyStorage } from '../src/studyNativeStorage';
import type { NativeStudyBatch, NativeStudyPut } from '../src/studyNativeIpc';
import { createStudyStorage } from '../src/studyStorage';
import { resolveStudyStoragePlatform } from '../src/studyStoragePlatform';

// Phase 2E+2F: the Tauri native adapter speaks ONLY through the injected IPC
// surface (mocked here with an in-memory backend that enforces conditions and
// the uniqueness guard atomically, like the Rust transaction). No IndexedDB,
// no Tauri runtime, no SQL in these tests.

type Row = Record<string, unknown>;

const createFakeIpc = (statusImpl?: () => Promise<{ schema_version: number }>) => {
  const stores = new Map<string, Map<string, unknown>>();
  const batches: NativeStudyBatch[] = [];
  const puts: NativeStudyPut[] = [];
  const table = (store: string): Map<string, unknown> => {
    let t = stores.get(store);
    if (!t) {
      t = new Map();
      stores.set(store, t);
    }
    return t;
  };
  const checkCondition = (c: NonNullable<NativeStudyBatch['conditions']>[number]): void => {
    const existing = table(c.store).get(c.key) as Row | undefined;
    const ok =
      c.expected.kind === 'absent'
        ? existing === undefined
        : c.expected.kind === 'updated_at_equals'
          ? existing?.['updatedAt'] === undefined || existing['updatedAt'] === c.expected.updated_at
          : existing?.['updatedAt'] === c.expected.updated_at;
    if (!ok) throw new Error(c.message);
  };
  return {
    batches,
    puts,
    stores,
    status: statusImpl ?? (async () => ({ schema_version: 1 })),
    batch: async (batch: NativeStudyBatch): Promise<void> => {
      batches.push(batch);
      // Conditions first (fail-closed, before any write — mirrors Rust).
      for (const c of batch.conditions ?? []) checkCondition(c);
      const guard = batch.uniqueness_guard;
      if (guard) {
        for (const [key, value] of table(guard.store)) {
          const row = value as Row;
          if (
            key !== guard.except_key &&
            row['status'] === guard.active_status &&
            Object.entries(guard.field_equals).every(([f, v]) => row[f] === v)
          ) {
            throw new Error(guard.message);
          }
        }
      }
      for (const store of batch.clears ?? []) table(store).clear();
      for (const put of batch.puts ?? []) table(put.store).set(put.key, put.payload);
      for (const del of batch.deletes ?? []) table(del.store).delete(del.key);
    },
    loadAll: async (): Promise<Record<string, unknown[]>> => {
      const out: Record<string, unknown[]> = {};
      for (const [store, t] of stores) out[store] = [...t.values()];
      return out;
    },
    get: async (store: string, key: string): Promise<unknown | null> =>
      table(store).get(key) ?? null,
    put: async (put: NativeStudyPut): Promise<void> => {
      puts.push(put);
      table(put.store).set(put.key, put.payload);
    },
    queryField: async (store: string, field: string, value: string): Promise<unknown[]> =>
      [...table(store).values()].filter((v) => (v as Row)[field] === value),
  };
};

const progressAt = (unitId: string, updatedAt: string): Row => ({
  unitId,
  phase: 'learning',
  dueAt: '2026-09-10T00:00:00.000Z',
  lastStudiedAt: null,
  successfulGuidedRecallDays: [],
  successfulFreeRecallDays: [],
  applicationSuccessCount: 0,
  reviewCount: 0,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt,
});

const attemptFor = (id: string, unitId: string): Row => ({
  id,
  unitId,
  promptId: 'p1',
  phase: 'learning',
  answer: 'a',
  coveredConceptIds: [],
  rating: 'good',
  startedAt: '2026-09-10T00:00:00.000Z',
  revealedAt: '2026-09-10T00:00:00.000Z',
  completedAt: '2026-09-10T00:00:00.000Z',
});

const mockSession = (id: string, overrides: Row = {}): Row => ({
  id,
  status: 'in_progress',
  curriculumId: 'cur1',
  curriculumContentHash: 'h1',
  updatedAt: 't1',
  ...overrides,
});

const TAURI_FLAG = '__TAURI_INTERNALS__';

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>)[TAURI_FLAG];
});

describe('study storage platform selection (2F)', () => {
  it('resolves browser by default and tauri under the Tauri runtime', () => {
    expect(resolveStudyStoragePlatform()).toBe('browser');
    (globalThis.window as unknown as Record<string, unknown>)[TAURI_FLAG] = {};
    expect(resolveStudyStoragePlatform()).toBe('tauri');
  });

  it('routes the composition root to the browser adapter off-runtime', async () => {
    const storage = createStudyStorage();
    // jsdom has no IndexedDB: the browser adapter serves the seed fallback.
    const snapshot = await storage.loadAll();
    expect(snapshot.schemaVersion).toBe(10);
    expect(snapshot.documents.length).toBeGreaterThan(0);
  });

  it('never silently falls back when native IPC fails under Tauri', async () => {
    (globalThis.window as unknown as Record<string, unknown>)[TAURI_FLAG] = {};
    const storage = createStudyStorage();
    // No real Tauri runtime in jsdom: `invoke` rejects. The failure must
    // surface — never resolve with seed/IndexedDB data instead.
    await expect(storage.loadAll()).rejects.toThrow();
  });
});

describe('native adapter initialization errors (fail-closed)', () => {
  it('throws when native status IPC fails', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage({
      ...ipc,
      status: async () => {
        throw new Error('IPC unavailable');
      },
    });
    await expect(storage.loadAll()).rejects.toThrow('IPC unavailable');
  });

  it('throws on native schema version mismatch', async () => {
    const ipc = createFakeIpc(async () => ({ schema_version: 999 }));
    const storage = createNativeStudyStorage(ipc);
    await expect(storage.loadAll()).rejects.toThrow('schema version');
  });

  it('still throws (no IndexedDB fallback) even though the browser path would seed', async () => {
    const ipc = createFakeIpc(async () => {
      throw new Error('native db locked');
    });
    const storage = createNativeStudyStorage(ipc);
    await expect(storage.getLegalComponentCount('doc1')).rejects.toThrow('native db locked');
  });
});

describe('native adapter CRUD over IPC', () => {
  it('round-trips representative single puts through loadAll', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    // Empty backend seeds exactly like the browser adapter.
    const seeded = await storage.loadAll();
    expect(seeded.documents.length).toBeGreaterThan(0);
    expect(ipc.batches.length).toBe(1);

    await storage.saveDocument({ id: 'd1', title: 'Doc' } as never);
    expect(ipc.puts.at(-1)).toMatchObject({ store: 'documents', key: 'd1' });
    await storage.saveUnit({ id: 'u1', title: 'Unit' } as never);
    await storage.saveProgress(progressAt('u1', 't1') as never);
    await storage.saveAttempt(attemptFor('a1', 'u1') as never);
    await storage.saveDraft({ id: 'draft-u1', unitId: 'u1' } as never);
    const reloaded = await storage.loadAll();
    expect(reloaded.documents.some((d) => d.id === 'd1')).toBe(true);
    expect(reloaded.units.some((u) => u.id === 'u1')).toBe(true);
    expect(reloaded.progress.some((p) => p.unitId === 'u1')).toBe(true);
    expect(reloaded.attempts.some((a) => a.id === 'a1')).toBe(true);
    expect(reloaded.drafts.some((d) => d.id === 'draft-u1')).toBe(true);
  });

  it('lazy legal-component reads map recordKey without a full load', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    const snapshot = await storage.loadAll();
    const withDocs = {
      ...snapshot,
      legalDocuments: [{ id: 'doc1' }] as never,
      legalComponents: [
        {
          documentId: 'doc1',
          sourceKey: 's1',
          componentType: 'section',
          subsections: [{ sourceKey: 's1(1)' }],
        },
        { documentId: 'doc1', sourceKey: 's2', componentType: 'form' },
      ] as never,
    };
    await storage.replaceAll(withDocs as never);
    const one = await storage.getLegalComponent('doc1', 's1');
    expect(one).toMatchObject({ documentId: 'doc1', sourceKey: 's1' });
    expect(one).not.toHaveProperty('recordKey');
    expect(await storage.getLegalComponent('doc1', 'missing')).toBeNull();
    const byDoc = await storage.getLegalComponentsByDocument('doc1');
    expect(byDoc).toHaveLength(2);
    expect(await storage.getLegalComponentCount('doc1')).toBe(2);
    const summary = await storage.getLegalDocumentComponentSummary('doc1');
    expect(summary).toMatchObject({ componentCount: 2, sectionCount: 1, formCount: 1 });
    const byKeys = await storage.getLegalComponentsBySourceKeys('doc1', ['s2']);
    expect(byKeys.map((c) => c.sourceKey)).toEqual(['s2']);
    expect(await storage.getLegalComponentsBySourceKeys('doc1', [])).toEqual([]);
  });

  it('replaceUnitConcepts deletes-then-puts in one batch', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.replaceUnitConcepts('u-native-1', [
      { id: 'c1', unitId: 'u-native-1', label: 'C1' },
      { id: 'c2', unitId: 'u-native-1', label: 'C2' },
    ] as never);
    await storage.replaceUnitConcepts('u-native-1', [{ id: 'c3', unitId: 'u-native-1', label: 'C3' }] as never);
    const last = ipc.batches.at(-1);
    expect(last?.deletes).toHaveLength(2);
    expect(last?.puts?.map((p) => p.key)).toEqual(['c3']);
    const snapshot = await storage.loadAll();
    expect(snapshot.concepts.filter((c) => c.unitId === 'u-native-1').map((c) => c.id)).toEqual(['c3']);
  });
});

describe('native adapter atomic batch payloads', () => {
  it('saveRatedAttempt writes attempt+progress and deletes the draft in ONE batch', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveDraft({ id: 'draft-u1', unitId: 'u1' } as never);
    ipc.batches.length = 0;
    await storage.saveRatedAttempt({
      attempt: attemptFor('a1', 'u1') as never,
      progress: progressAt('u1', 't2') as never,
      draftId: 'draft-u1',
      expectedProgressUpdatedAt: 't1',
    });
    // No existing progress: the equals-or-absent condition passes.
    expect(ipc.batches).toHaveLength(1);
    expect(ipc.batches[0]).toMatchObject({
      puts: [
        { store: 'attempts', key: 'a1' },
        { store: 'progress', key: 'u1' },
      ],
      deletes: [{ store: 'drafts', key: 'draft-u1' }],
      conditions: [
        {
          store: 'progress',
          key: 'u1',
          expected: { kind: 'updated_at_equals', updated_at: 't1' },
          message: 'Study progress changed before the rating could be saved.',
        },
      ],
    });
    const snapshot = await storage.loadAll();
    expect(snapshot.attempts.some((a) => a.id === 'a1')).toBe(true);
    expect(snapshot.drafts.some((d) => d.id === 'draft-u1')).toBe(false);
  });

  it('saveRatedAttempt CAS failure keeps the browser message and writes nothing', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveProgress(progressAt('u1', 't-current') as never);
    ipc.batches.length = 0;
    await expect(
      storage.saveRatedAttempt({
        attempt: attemptFor('a-stale', 'u1') as never,
        progress: progressAt('u1', 't-new') as never,
        draftId: 'draft-u1',
        expectedProgressUpdatedAt: 't-stale',
      }),
    ).rejects.toThrow('Study progress changed before the rating could be saved.');
    const snapshot = await storage.loadAll();
    expect(snapshot.attempts.some((a) => a.id === 'a-stale')).toBe(false);
    expect(snapshot.progress.find((p) => p.unitId === 'u1')?.updatedAt).toBe('t-current');
  });

  it('deleteUnitCascade removes the unit graph in ONE batch', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveUnit({ id: 'u9', title: 'U9' } as never);
    await storage.savePrompt({ id: 'p9', unitId: 'u9' } as never);
    await storage.replaceUnitConcepts('u9', [{ id: 'c9', unitId: 'u9', label: 'C9' }] as never);
    await storage.replaceUnitRubrics('u9', [{ id: 'r9', unitId: 'u9' }] as never);
    await storage.saveProgress(progressAt('u9', 't1') as never);
    await storage.saveAttempt(attemptFor('a9', 'u9') as never);
    await storage.saveDraft({ id: 'draft-u9', unitId: 'u9' } as never);
    ipc.batches.length = 0;
    await storage.deleteUnitCascade('u9');
    expect(ipc.batches).toHaveLength(1);
    const deleted = ipc.batches[0].deletes ?? [];
    expect(deleted).toEqual(
      expect.arrayContaining([
        { store: 'units', key: 'u9' },
        { store: 'progress', key: 'u9' },
        { store: 'prompts', key: 'p9' },
        { store: 'concepts', key: 'c9' },
        { store: 'rubrics', key: 'r9' },
        { store: 'attempts', key: 'a9' },
        { store: 'drafts', key: 'draft-u9' },
      ]),
    );
    const snapshot = await storage.loadAll();
    expect(snapshot.units.some((u) => u.id === 'u9')).toBe(false);
    expect(snapshot.progress.some((p) => p.unitId === 'u9')).toBe(false);
  });

  it('saveExamPrepAttempt preserves immutable-add semantics', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    const attempt = { id: 'e1', taskId: 't', curriculumContentHash: 'h' };
    await storage.saveExamPrepAttempt(attempt as never);
    expect(ipc.batches.at(-1)?.conditions).toEqual([
      { store: 'examPrepAttempts', key: 'e1', expected: { kind: 'absent' }, message: expect.any(String) },
    ]);
    await expect(storage.saveExamPrepAttempt(attempt as never)).rejects.toThrow();
    const snapshot = await storage.loadAll();
    expect(snapshot.examPrepAttempts.filter((a) => a.id === 'e1')).toHaveLength(1);
  });

  it('saveExamPrepRecallRating enforces absent/present expectations', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    const progress = { id: 'rp1', updatedAt: 't1' };
    const attempt = { id: 'ra1' };
    await storage.saveExamPrepRecallRating({
      attempt: attempt as never,
      progress: progress as never,
      expectation: { kind: 'absent' },
    });
    // Second absent-expectation write must fail closed like the browser.
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: attempt as never,
        progress: progress as never,
        expectation: { kind: 'absent' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');
    await storage.saveExamPrepRecallRating({
      attempt: { id: 'ra2' } as never,
      progress: { id: 'rp1', updatedAt: 't2' } as never,
      expectation: { kind: 'existing', updatedAt: 't1' },
    });
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: { id: 'ra3' } as never,
        progress: { id: 'rp1', updatedAt: 't3' } as never,
        expectation: { kind: 'existing', updatedAt: 't1' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed before the rating could be saved.');
  });

  it('saveExamPrepMockSession carries the one-active-mock lock in the same batch', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveExamPrepMockSession({
      session: mockSession('m1') as never,
      expectation: { kind: 'absent' },
    });
    const first = ipc.batches.at(-1);
    expect(first?.uniqueness_guard).toMatchObject({
      store: 'examPrepMockSessions',
      except_key: 'm1',
      active_status: 'in_progress',
      field_equals: { curriculumId: 'cur1', curriculumContentHash: 'h1' },
    });
    // A second current-binding in-progress session fails closed atomically.
    await expect(
      storage.saveExamPrepMockSession({
        session: mockSession('m2') as never,
        expectation: { kind: 'absent' },
      }),
    ).rejects.toThrow('A mock exam is already in progress');
    const snapshot = await storage.loadAll();
    expect(snapshot.examPrepMockSessions.some((s) => s.id === 'm2')).toBe(false);
    // Updating the existing session skips the creation lock but keeps CAS.
    await storage.saveExamPrepMockSession({
      session: mockSession('m1', { updatedAt: 't2' }) as never,
      expectation: { kind: 'existing', updatedAt: 't1' },
    });
    expect(ipc.batches.at(-1)?.uniqueness_guard).toBeUndefined();
    await expect(
      storage.saveExamPrepMockSession({
        session: mockSession('m1', { updatedAt: 't3' }) as never,
        expectation: { kind: 'existing', updatedAt: 't1' },
      }),
    ).rejects.toThrow('changed in another tab');
  });

  it('replaceAll rewrites every authoritative store in ONE batch', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    const seeded = await storage.loadAll();
    ipc.batches.length = 0;
    await storage.replaceAll({ ...seeded, documents: [] } as never);
    expect(ipc.batches).toHaveLength(1);
    expect(ipc.batches[0].clears).toContain('documents');
    expect(ipc.batches[0].clears).toContain('examPrepMockSessions');
    expect(ipc.batches[0].clears).not.toContain('searchIndexMetadata');
    const reloaded = await storage.loadAll();
    expect(reloaded.documents).toHaveLength(0);
    expect(reloaded.units.length).toBe(seeded.units.length);
  });

  it('replaceAiAuthoringArtifacts batches all three artifact kinds', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    ipc.batches.length = 0;
    await storage.replaceAiAuthoringArtifacts({
      runs: [{ runId: 'run1' }] as never,
      mapProposals: [{ id: 'mp1', runId: 'run1' }] as never,
      unitProposals: [{ proposalId: 'up1', runId: 'run1' }] as never,
    });
    expect(ipc.batches).toHaveLength(1);
    expect(ipc.batches[0].puts?.map((p) => `${p.store}:${p.key}`)).toEqual([
      'aiAuthoringRuns:run1',
      'aiStudyMapProposals:mp1',
      'aiUnitProposals:up1',
    ]);
    const snapshot = await storage.loadAll();
    expect(snapshot.aiAuthoringRuns.some((r) => r.runId === 'run1')).toBe(true);
  });

  it('approveAiUnitProposal fails closed without IPC when the proposal is missing', async () => {
    const ipc = createFakeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    ipc.batches.length = 0;
    await expect(
      storage.approveAiUnitProposal({ proposalId: 'nope', sourceComponents: [] }),
    ).rejects.toThrow('AI unit proposal not found: nope');
    expect(ipc.batches).toHaveLength(0);
  });
});
