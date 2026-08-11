/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeedStudyData } from '../../src/study/studySeed';
import type {
  StudyAttempt,
  StudyDataSnapshot,
  StudyDraft,
  StudyProgress,
} from '../../src/study/studyTypes';
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
    saveUnit: vi.fn(async (unit: StudyDataSnapshot['units'][number]) => {
      if (!storageState.snapshot) return;
      storageState.snapshot = {
        ...storageState.snapshot,
        units: [...storageState.snapshot.units.filter((entry) => entry.id !== unit.id), unit],
      };
    }),
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
    saveRatedAttempt: vi.fn(
      async ({
        attempt,
        progress,
        draftId,
      }: {
        attempt: StudyAttempt;
        progress: StudyProgress;
        draftId: string;
      }) => {
        storageState.attempts = [...storageState.attempts, attempt];
        storageState.progress = [
          ...storageState.progress.filter((entry) => entry.unitId !== progress.unitId),
          progress,
        ];
        storageState.drafts = storageState.drafts.filter((entry) => entry.id !== draftId);
      },
    ),
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
  STUDY_SCHEMA_VERSION: 5,
  STUDY_DB_NAME: 'webnet.study.v1',
  STUDY_DB_VERSION: 1,
  migrateStudySnapshot: (input: Partial<StudyDataSnapshot>) => ({ ...input, schemaVersion: 5 }),
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
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
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
    expect(hookValue.current?.ratingPreviews.map((preview) => preview.rating)).toEqual([
      'again',
      'hard',
      'good',
      'easy',
    ]);
    expect(storageState.attempts).toEqual([]);
    await act(async () => {
      await hookValue.current?.rateActiveItem('good');
    });

    expect(storageState.attempts).toHaveLength(1);
    expect(storageState.attempts[0]?.answer).toBe('Long typed recall answer.');
    expect(storageState.drafts).toEqual([]);
  });

  it('summarizes completed scheduled ratings when the session queue is exhausted', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    storageState.snapshot = {
      ...seed,
      units: seed.units.slice(0, 1),
      prompts: seed.prompts.filter((prompt) => prompt.unitId === seed.units[0].id),
      concepts: seed.concepts.filter((concept) => concept.unitId === seed.units[0].id),
      rubrics: seed.rubrics.filter((rubric) => rubric.unitId === seed.units[0].id),
      progress: seed.progress.filter((progress) => progress.unitId === seed.units[0].id),
    };
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      hookValue.current?.setRevealed(true);
    });
    await act(async () => {
      await hookValue.current?.rateActiveItem('good');
    });

    expect(hookValue.current?.activeItem).toBeNull();
    expect(hookValue.current?.sessionCompletionSummary).toMatchObject({
      reviewed: 1,
      newLearned: 1,
      ratings: { again: 0, hard: 0, good: 1, easy: 0 },
    });
  });

  it('persists guided responses and rubric coverage with attempts', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
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

  it('ignores duplicate rating submissions while a rating is being saved', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      hookValue.current?.setAnswer('One answer.');
    });
    await act(async () => {
      const first = hookValue.current?.rateActiveItem('good');
      const second = hookValue.current?.rateActiveItem('good');
      await Promise.all([first, second]);
    });

    expect(storageState.attempts).toHaveLength(1);
    expect(storageState.progress).toHaveLength(1);
    expect(storageState.attempts[0]?.scheduling?.cardAfter?.reps).toBe(1);
  });

  it('surfaces source-review items first without allowing memory ratings', async () => {
    storageState.snapshot = {
      ...createSeedStudyData('2026-08-01T10:00:00.000Z'),
      units: createSeedStudyData('2026-08-01T10:00:00.000Z').units.map((unit, index) =>
        index === 2 ? { ...unit, sourceReviewRequired: true, priority: 5 as const } : unit,
      ),
    };
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(hookValue.current?.activeItem?.reason).toBe('source-review-required');
    await act(async () => {
      await hookValue.current?.rateActiveItem('good');
    });

    expect(storageState.attempts).toEqual([]);
    expect(hookValue.current?.statusMessage).toBe(
      'Review the changed source before rating this study unit.',
    );
  });

  it('saves surprise practice without mutating progress scheduling', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const item = hookValue.current?.activeItem;
    expect(item).toBeTruthy();
    const progressBefore = JSON.stringify(storageState.progress);
    await act(async () => {
      if (!item) return;
      await hookValue.current?.savePracticeAttempt({
        item,
        rating: 'hard',
        reason: 'surprise-practice',
        answer: 'Surprise answer.',
        responseMode: hookValue.current.responseMode,
        guidedResponses: {},
        coveredConceptIds: [],
        rubricCoverage: [],
        startedAt: '2026-08-01T10:00:00.000Z',
        revealedAt: '2026-08-01T10:05:00.000Z',
      });
    });

    expect(storageState.attempts).toHaveLength(1);
    expect(storageState.attempts[0]?.scheduling).toMatchObject({
      schedulingApplied: false,
      reason: 'surprise-practice',
      rating: 'hard',
    });
    expect(JSON.stringify(storageState.progress)).toBe(progressBefore);
    expect(hookValue.current?.statusMessage).toBe(
      'Surprise practice saved without changing scheduling.',
    );
  });

  it('acknowledges source review without mutating FSRS progress or attempts', async () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const reviewedUnit = { ...seed.units[0], sourceReviewRequired: true };
    storageState.snapshot = {
      ...seed,
      units: [reviewedUnit, ...seed.units.slice(1)],
    };
    storageState.progress = seed.progress;
    storageState.drafts = [];
    const progressBefore = JSON.stringify(storageState.progress);
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await hookValue.current?.acknowledgeSourceReview(reviewedUnit.id);
    });

    const updatedUnit = hookValue.current?.data?.units.find((unit) => unit.id === reviewedUnit.id);
    expect(updatedUnit?.sourceReviewRequired).toBe(false);
    expect(updatedUnit?.sourceReviewAcknowledgedAt).toBeTruthy();
    expect(JSON.stringify(storageState.progress)).toBe(progressBefore);
    expect(storageState.attempts).toEqual([]);
  });

  it('deletes all study data when requested', async () => {
    const hookValue: { current: HookValue | null } = { current: null };
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(value) => {
            hookValue.current = value;
          }}
        />,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await hookValue.current?.deleteAllData();
    });

    expect(storageState.snapshot?.documents).toEqual([]);
    expect(storageState.snapshot?.units).toEqual([]);
    expect(storageState.snapshot?.prompts).toEqual([]);
    expect(storageState.snapshot?.concepts).toEqual([]);
    expect(storageState.snapshot?.rubrics).toEqual([]);
    expect(storageState.snapshot?.attempts).toEqual([]);
    expect(storageState.snapshot?.legalDocuments).toEqual([]);
    expect(hookValue.current?.data?.documents).toEqual([]);
    expect(hookValue.current?.statusMessage).toBe('All Study data deleted. Clean slate ready.');
  });
});
