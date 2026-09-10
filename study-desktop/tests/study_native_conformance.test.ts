/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { exportStudyData } from '../src/studyExportImport';
import { saveStudyTextAsset } from '../src/studyFileAssets';
import { createNativeStudyStorage } from '../src/studyNativeStorage';
import { createSeedStudyData } from '../src/studySeed';
import {
  createFakeNativeFiles,
  createFakeNativeIpc,
} from './study_native_conformance_support';

// Phase 2I: native conformance — empty/seed, CRUD, delete cascade, CAS
// rollback/error, restart-like persistence, and asset roundtrip/traversal
// propagation over the mocked native backend. Existing suites are untouched.

type Row = Record<string, unknown>;

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

describe('native conformance', () => {
  it('empty backend seeds exactly once, then never reseeds', async () => {
    const ipc = createFakeNativeIpc();
    const storage = createNativeStudyStorage(ipc);
    const seeded = await storage.loadAll();
    expect(seeded.documents.length).toBeGreaterThan(0);
    expect(seeded.settings).toBeTruthy();
    expect(ipc.batches).toHaveLength(1);
    const again = await storage.loadAll();
    expect(again.documents).toHaveLength(seeded.documents.length);
    expect(ipc.batches).toHaveLength(1);
  });

  it('CRUD round-trips single records through loadAll', async () => {
    const ipc = createFakeNativeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveDocument({ id: 'd-conf', title: 'Doc' } as never);
    await storage.saveUnit({ id: 'u-conf', title: 'Unit' } as never);
    await storage.savePrompt({ id: 'p-conf', unitId: 'u-conf' } as never);
    await storage.saveProgress(progressAt('u-conf', 't1') as never);
    await storage.saveAttempt(attemptFor('a-conf', 'u-conf') as never);
    await storage.saveDraft({ id: 'draft-u-conf', unitId: 'u-conf' } as never);
    await storage.saveSettings({ ...(await storage.loadAll()).settings, id: 'study-settings' } as never);
    const reloaded = await storage.loadAll();
    expect(reloaded.documents.some((d) => d.id === 'd-conf')).toBe(true);
    expect(reloaded.units.some((u) => u.id === 'u-conf')).toBe(true);
    expect(reloaded.prompts.some((p) => p.id === 'p-conf')).toBe(true);
    expect(reloaded.progress.some((p) => p.unitId === 'u-conf')).toBe(true);
    expect(reloaded.attempts.some((a) => a.id === 'a-conf')).toBe(true);
    expect(reloaded.drafts.some((d) => d.id === 'draft-u-conf')).toBe(true);
  });

  it('delete removes one draft and the unit cascade removes the whole graph', async () => {
    const ipc = createFakeNativeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveDraft({ id: 'draft-gone', unitId: 'u-del' } as never);
    await storage.clearDraft('draft-gone');
    expect((await storage.loadAll()).drafts.some((d) => d.id === 'draft-gone')).toBe(false);

    await storage.saveUnit({ id: 'u-del', title: 'U' } as never);
    await storage.savePrompt({ id: 'p-del', unitId: 'u-del' } as never);
    await storage.replaceUnitConcepts('u-del', [{ id: 'c-del', unitId: 'u-del' }] as never);
    await storage.replaceUnitRubrics('u-del', [{ id: 'r-del', unitId: 'u-del' }] as never);
    await storage.saveProgress(progressAt('u-del', 't1') as never);
    await storage.saveAttempt(attemptFor('a-del', 'u-del') as never);
    await storage.saveDraft({ id: 'draft-u-del', unitId: 'u-del' } as never);
    await storage.deleteUnitCascade('u-del');
    const after = await storage.loadAll();
    expect(after.units.some((u) => u.id === 'u-del')).toBe(false);
    expect(after.progress.some((p) => p.unitId === 'u-del')).toBe(false);
    expect(after.prompts.some((p) => p.id === 'p-del')).toBe(false);
    expect(after.concepts.some((c) => c.id === 'c-del')).toBe(false);
    expect(after.rubrics.some((r) => r.id === 'r-del')).toBe(false);
    expect(after.attempts.some((a) => a.id === 'a-del')).toBe(false);
    expect(after.drafts.some((d) => d.id === 'draft-u-del')).toBe(false);
  });

  it('stale CAS writes fail with the browser message and roll back everything', async () => {
    const ipc = createFakeNativeIpc();
    const storage = createNativeStudyStorage(ipc);
    await storage.loadAll();
    await storage.saveProgress(progressAt('u-cas', 't-current') as never);
    await expect(
      storage.saveRatedAttempt({
        attempt: attemptFor('a-cas-stale', 'u-cas') as never,
        progress: progressAt('u-cas', 't-new') as never,
        draftId: 'draft-u-cas',
        expectedProgressUpdatedAt: 't-stale',
      }),
    ).rejects.toThrow('Study progress changed before the rating could be saved.');
    const after = await storage.loadAll();
    expect(after.attempts.some((a) => a.id === 'a-cas-stale')).toBe(false);
    expect(after.progress.find((p) => p.unitId === 'u-cas')?.updatedAt).toBe('t-current');

    await storage.saveExamPrepRecallRating({
      attempt: { id: 'ra-conf-1' } as never,
      progress: { id: 'rp-conf-1', updatedAt: 't1' } as never,
      expectation: { kind: 'absent' },
    });
    await expect(
      storage.saveExamPrepRecallRating({
        attempt: { id: 'ra-conf-2' } as never,
        progress: { id: 'rp-conf-1', updatedAt: 't2' } as never,
        expectation: { kind: 'absent' },
      }),
    ).rejects.toThrow('Exam Prep recall progress changed');
    expect(
      (await storage.loadAll()).examPrepRecallProgress.find((p) => p.id === 'rp-conf-1')
        ?.updatedAt,
    ).toBe('t1');

    const dup = { id: 'epa-conf-1', taskId: 't' };
    await storage.saveExamPrepAttempt(dup as never);
    await expect(storage.saveExamPrepAttempt(dup as never)).rejects.toThrow();
    expect(
      (await storage.loadAll()).examPrepAttempts.filter((a) => a.id === 'epa-conf-1'),
    ).toHaveLength(1);
  });

  it('restart-like reuse of the backend loads the identical snapshot', async () => {
    const ipc = createFakeNativeIpc();
    const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const first = createNativeStudyStorage(ipc);
    await first.replaceAll({ ...seed, exportedAt: '2026-09-10T12:00:00.000Z' } as never);
    await first.saveDraft({ id: 'draft-restart', unitId: seed.units[0].id } as never);
    // A fresh adapter over the same backend is the mocked-process-restart.
    const restarted = createNativeStudyStorage(ipc);
    const before = exportStudyData(await first.loadAll(), '2026-09-10T12:00:00.000Z');
    const afterRestart = exportStudyData(await restarted.loadAll(), '2026-09-10T12:00:00.000Z');
    expect(afterRestart).toBe(before);
    expect((await restarted.loadAll()).drafts.some((d) => d.id === 'draft-restart')).toBe(true);
  });

  it('native asset round-trips bytes and traversal errors propagate', async () => {
    const files = createFakeNativeFiles();
    const text = 'native asset body — ✓ monuments';
    const asset = await saveStudyTextAsset(
      {
        documentId: 'doc-restart',
        role: 'backup',
        fileName: 'notes.txt',
        text,
        nowIso: '2026-09-10T10:00:00.000Z',
      },
      { platform: 'tauri', native: files },
    );
    expect(asset?.storagePath).toBe('study/documents/doc-restart/backup/notes.txt');
    const stored = await files.read(asset?.storagePath ?? '');
    expect(new TextDecoder().decode(new Uint8Array(stored))).toBe(text);
    // Restart-like: a fresh boundary call over the same file store reads back.
    const reread = await files.read('study/documents/doc-restart/backup/notes.txt');
    expect(new TextDecoder().decode(new Uint8Array(reread))).toBe(text);
    // Traversal input surfaces the native rejection and stores nothing.
    await expect(
      saveStudyTextAsset(
        { documentId: '..', role: 'backup', fileName: 'x.txt', text: 'x' },
        { platform: 'tauri', native: files },
      ),
    ).rejects.toThrow('rejected study file path');
    expect(files.files.has('study/documents/../backup/x.txt')).toBe(false);
    await expect(files.read('study/documents/missing/nope.txt')).rejects.toThrow('not found');
  });
});
