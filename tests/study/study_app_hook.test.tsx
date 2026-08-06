/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyAttempt, StudyDataSnapshot, StudyDraft, StudyProgress } from '../../src/study/studyTypes';
import { useStudyApp } from '../../src/study/useStudyApp';

const storageState = vi.hoisted<{
  snapshot: StudyDataSnapshot | null;
  drafts: StudyDraft[];
  attempts: StudyAttempt[];
  progress: StudyProgress[];
}>(() => ({
  snapshot: null,
  drafts: [],
  attempts: [],
  progress: [],
}));

vi.mock('../../src/study/studyStorage', () => ({
  createStudyStorage: () => ({
    loadAll: vi.fn(async () => ({
      ...(storageState.snapshot as StudyDataSnapshot),
      drafts: storageState.drafts,
      attempts: storageState.attempts,
      progress: storageState.progress.length
        ? storageState.progress
        : (storageState.snapshot as StudyDataSnapshot).progress,
    })),
    saveDocument: vi.fn(),
    saveUnit: vi.fn(),
  savePrompt: vi.fn(),
  replaceUnitConcepts: vi.fn(),
  replaceUnitRubrics: vi.fn(),
    saveProgress: vi.fn(async (progress: StudyProgress) => {
      storageState.progress = [
        ...storageState.progress.filter((entry) => entry.unitId !== progress.unitId),
        progress,
      ];
    }),
    saveAttempt: vi.fn(async (attempt: StudyAttempt) => {
      storageState.attempts = [...storageState.attempts, attempt];
    }),
    saveDraft: vi.fn(async (draft: StudyDraft) => {
      storageState.drafts = [
        ...storageState.drafts.filter((entry) => entry.id !== draft.id),
        draft,
      ];
    }),
    clearDraft: vi.fn(async (draftId: string) => {
      storageState.drafts = storageState.drafts.filter((entry) => entry.id !== draftId);
    }),
    saveSettings: vi.fn(),
    replaceAll: vi.fn(async (snapshot: StudyDataSnapshot) => {
      storageState.snapshot = snapshot;
    }),
  }),
  STUDY_SCHEMA_VERSION: 4,
  STUDY_DB_NAME: 'webnet.study.v1',
  STUDY_DB_VERSION: 1,
  migrateStudySnapshot: (input: Partial<StudyDataSnapshot>) => ({ ...input, schemaVersion: 4 }),
}));

type HookValue = ReturnType<typeof useStudyApp>;

const HookHarness = ({ onValue }: { onValue: (_value: HookValue) => void }) => {
  const value = useStudyApp();
  React.useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
};

describe('study app hook persistence', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    storageState.snapshot = createSeedStudyData('2026-08-01T10:00:00.000Z');
    storageState.drafts = [];
    storageState.attempts = [];
    storageState.progress = [];
    window.history.replaceState(null, '', '/study/session');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  it('autosaves typed answers and clears the draft after rating', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(<HookHarness onValue={(value) => { hookValue.current = value; }} />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(hookValue.current?.activeItem).not.toBeNull();

    await act(async () => {
      hookValue.current?.setAnswer('Long typed recall answer.');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(storageState.drafts[0]?.answer).toBe('Long typed recall answer.');

    const currentHookValue = hookValue.current;
    expect(currentHookValue).not.toBeNull();
    await act(async () => {
      currentHookValue?.setRevealed(true);
      currentHookValue?.toggleConcept(currentHookValue.activeItem?.concepts[0]?.id ?? '');
    });
    await act(async () => {
      await hookValue.current?.rateActiveItem('good');
    });

    expect(storageState.attempts).toHaveLength(1);
    expect(storageState.attempts[0]?.answer).toBe('Long typed recall answer.');
    expect(storageState.drafts).toEqual([]);
  });

  it('persists guided responses and rubric coverage with attempts', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(<HookHarness onValue={(value) => { hookValue.current = value; }} />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const rubricId = hookValue.current?.activeItem?.rubrics[0]?.id ?? '';
    await act(async () => {
      hookValue.current?.setGuidedResponses({ [rubricId]: 'Guided answer.' });
      hookValue.current?.setRubricCoverage([{ rubricItemId: rubricId, status: 'covered' }]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(storageState.drafts[0]?.guidedResponses?.[rubricId]).toBe('Guided answer.');

    await act(async () => {
      await hookValue.current?.rateActiveItem('good');
    });

    expect(storageState.attempts.at(-1)?.guidedResponses?.[rubricId]).toBe('Guided answer.');
    expect(storageState.attempts.at(-1)?.rubricCoverage).toEqual([
      { rubricItemId: rubricId, status: 'covered' },
    ]);
  });
});
