/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepPage } from '../../src/study/examPrep/ExamPrepPage';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { buildExamPrepRatedRecallAttempt } from '../../src/study/examPrep/examPrepReview';
import {
  appendImmutableAttempt,
  upsertById,
} from '../../src/study/examPrep/examPrepStateUpdates';
import type { ExamPrepQueueItem } from '../../src/study/examPrep/examPrepQueue';
import type { ExamPrepRecallRating } from '../../src/study/examPrep/examPrepTypes';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import {
  makeRecallProgress,
  makeSettings,
  testCard,
} from './exam_prep_test_support';

const seed = createSeedStudyData('2026-09-01T00:00:00.000Z');
const emptyData = (): StudyDataSnapshot => ({ ...seed });

type RateOptions = {
  item: ExamPrepQueueItem;
  rating: ExamPrepRecallRating;
  now: Date;
  answer?: string;
};

describe('Exam Prep frozen recall sessions (parent snapshot updates)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root?.render(node);
    });
  };

  const bodyText = () => document.body.textContent ?? '';

  const clickButton = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // let async rating handlers settle inside the act flush
      await Promise.resolve();
    });
  };

  const currentCardTaskId = (): string => {
    const mono = document.querySelector('span.font-mono');
    return mono?.textContent?.trim() ?? '';
  };

  const page = (data: StudyDataSnapshot, onRate: (_options: RateOptions) => Promise<void>) => (
    <ExamPrepPage
      view="recall"
      data={data}
      onNavigate={vi.fn()}
      onOpenProvision={vi.fn()}
      onToggleUnitStudied={vi.fn(async () => undefined)}
      onRateRecallTask={onRate}
    />
  );

  const rateThroughFrozenSession = async ({
    seen,
    renderPage,
    expectedTotal,
  }: {
    seen: string[];
    renderPage: () => Promise<void>;
    expectedTotal: number;
  }) => {
    for (let step = 0; step < expectedTotal; step += 1) {
      const expectedPosition = seen.length;
      expect(bodyText()).toContain(`Card ${step + 1} of ${expectedTotal}`);
      expect(currentCardTaskId()).toBe(EXAM_PREP_RECALL_TASKS[expectedPosition].id);
      await clickButton('Reveal');
      await clickButton('Good ·');
      await renderPage();
    }
  };

  it('freezes exactly 8 of 57 new cards (new=8 max=20), ends at 8, and the next session starts the next batch', async () => {
    const dataRef: { current: StudyDataSnapshot } = {
      current: {
        ...emptyData(),
        examPrepSettings: [
          makeSettings({ newRecallCardsPerSession: 8, maxRecallCardsPerSession: 20 }),
        ],
      },
    };
    const seen: string[] = [];
    const rateImpl = async (options: RateOptions) => {
      seen.push(options.item.task.id);
      const result = buildExamPrepRatedRecallAttempt({
        data: dataRef.current,
        item: options.item,
        rating: options.rating,
        now: options.now,
        attemptId: `session-a-${seen.length}`,
        answer: options.answer,
      });
      dataRef.current = {
        ...dataRef.current,
        examPrepAttempts: appendImmutableAttempt(
          dataRef.current.examPrepAttempts,
          result.attempt,
        ),
        examPrepRecallProgress: upsertById(
          dataRef.current.examPrepRecallProgress,
          result.progress,
        ),
      };
    };
    const renderPage = () => render(page(dataRef.current, rateImpl));

    await renderPage();
    expect(bodyText()).toContain('Ready for a recall session');
    expect(bodyText()).toContain('Session candidates: 8');
    await clickButton('Start Recall Session');
    expect(bodyText()).toContain('Card 1 of 8');
    expect(bodyText()).toContain('Reviewed this session: 0');

    await rateThroughFrozenSession({
      seen,
      renderPage,
      expectedTotal: 8,
    });

    // completed after exactly 8: nothing refilled from the 49 remaining new cards
    expect(seen).toEqual(EXAM_PREP_RECALL_TASKS.slice(0, 8).map((task) => task.id));
    expect(bodyText()).toContain('Session complete');
    expect(bodyText()).toContain('Reviewed this session: 8');
    expect(bodyText()).toContain('Start Another Session');

    // next session starts the NEXT batch from the updated snapshot
    await clickButton('Start Another Session');
    expect(bodyText()).toContain('Card 1 of 8');
    expect(currentCardTaskId()).toBe(EXAM_PREP_RECALL_TASKS[8].id);
    await rateThroughFrozenSession({
      seen,
      renderPage,
      expectedTotal: 8,
    });
    expect(seen).toEqual(EXAM_PREP_RECALL_TASKS.slice(0, 16).map((task) => task.id));
    expect(bodyText()).toContain('Session complete');
    expect(bodyText()).toContain('Reviewed this session: 8');
  });

  it('freezes 15 (12 due + 3 new, new=8 max=15) despite parent-snapshot mutations', async () => {
    const dueRecords = EXAM_PREP_RECALL_TASKS.slice(0, 12).map((task, index) =>
      makeRecallProgress({
        taskId: task.id,
        unitId: task.unitId,
        card: testCard({
          state: 'Review',
          due: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          last_review: '2026-07-31T00:00:00.000Z',
        }),
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const dataRef: { current: StudyDataSnapshot } = {
      current: {
        ...emptyData(),
        examPrepSettings: [
          makeSettings({ newRecallCardsPerSession: 8, maxRecallCardsPerSession: 15 }),
        ],
        examPrepRecallProgress: dueRecords,
      },
    };
    const seen: string[] = [];
    const rateImpl = async (options: RateOptions) => {
      seen.push(options.item.task.id);
      const result = buildExamPrepRatedRecallAttempt({
        data: dataRef.current,
        item: options.item,
        rating: options.rating,
        now: options.now,
        attemptId: `session-b-${seen.length}`,
        answer: options.answer,
      });
      dataRef.current = {
        ...dataRef.current,
        examPrepAttempts: appendImmutableAttempt(
          dataRef.current.examPrepAttempts,
          result.attempt,
        ),
        examPrepRecallProgress: upsertById(
          dataRef.current.examPrepRecallProgress,
          result.progress,
        ),
      };
    };
    const renderPage = () => render(page(dataRef.current, rateImpl));

    await renderPage();
    expect(bodyText()).toContain('Session candidates: 15');
    await clickButton('Start Recall Session');
    expect(bodyText()).toContain('Card 1 of 15');

    for (let step = 0; step < 15; step += 1) {
      expect(bodyText()).toContain(`Card ${step + 1} of 15`);
      expect(currentCardTaskId()).toBe(EXAM_PREP_RECALL_TASKS[step].id);
      await clickButton('Reveal');
      await clickButton('Good ·');
      await renderPage();
      // simulate unrelated external mutations (another tab/new progress) that
      // would change a live recomputed queue: they must not reshape the session
      if (step === 2 || step === 6) {
        const external = EXAM_PREP_RECALL_TASKS[step === 2 ? 40 : 50];
        const injected = makeRecallProgress({
          taskId: external.id,
          unitId: external.unitId,
          card: testCard({
            state: 'Review',
            due: '2026-08-01T00:00:00.000Z',
            last_review: '2026-07-31T00:00:00.000Z',
          }),
          createdAt: '2026-09-03T00:00:00.000Z',
          updatedAt: '2026-09-04T00:00:00.000Z',
        });
        dataRef.current = {
          ...dataRef.current,
          examPrepRecallProgress: upsertById(
            dataRef.current.examPrepRecallProgress,
            injected,
          ),
        };
        await renderPage();
        // still exactly the frozen item: no refill, no reshuffle
        expect(bodyText()).toContain(`Card ${step + 2} of 15`);
        expect(currentCardTaskId()).toBe(EXAM_PREP_RECALL_TASKS[step + 1].id);
      }
    }

    // exactly the frozen 15 (12 due + 3 new) were reviewed despite the injected
    // extra due cards and the rated cards leaving the due pool.
    expect(seen).toEqual(EXAM_PREP_RECALL_TASKS.slice(0, 15).map((task) => task.id));
    expect(bodyText()).toContain('Session complete');
    expect(bodyText()).toContain('Reviewed this session: 15');
    expect(bodyText()).toContain('Start Another Session');
  });
});
