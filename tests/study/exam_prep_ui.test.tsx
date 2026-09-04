/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepPage } from '../../src/study/examPrep/ExamPrepPage';
import { decodeExamPrepView } from '../../src/study/examPrep/examPrepRoutes';
import { EXAM_PREP_RECALL_TASKS, EXAM_PREP_LEARN_UNITS } from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import { formatExamDrillTime } from '../../src/study/examPrep/examPrepFormat';
import { ExamDrillCard } from '../../src/study/examPrep/components/examDrillCard';
import StudyLayout from '../../src/study/components/StudyLayout';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import type { ExamPrepQueueItem } from '../../src/study/examPrep/examPrepQueue';
import {
  makeRecallProgress,
  makeUnitProgress,
  testCard,
} from './exam_prep_test_support';

const seed = createSeedStudyData('2026-09-01T00:00:00.000Z');

const firstTask = EXAM_PREP_RECALL_TASKS[0];
if (!firstTask) throw new Error('expected tasks');

const firstUnit = EXAM_PREP_LEARN_UNITS[0];
if (!firstUnit) throw new Error('expected learn units');
const firstUnitTitle = firstUnit.title;

const emptyData = (): StudyDataSnapshot => ({ ...seed });

describe('Exam Prep UI', () => {
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

  const clickButton = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim().startsWith(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('Home shows studied X/133, due, introduced X/57, and 57 cards', async () => {
    const data = {
      ...emptyData(),
      examPrepUnitProgress: [makeUnitProgress('A-NBLS-01', '2026-09-05T00:00:00.000Z')],
      examPrepRecallProgress: [
        makeRecallProgress({
          taskId: firstTask.id,
          unitId: firstTask.unitId,
          card: testCard({ state: 'Review', due: '2020-01-01T00:00:00.000Z' }),
        }),
      ],
    };
    await render(
      <ExamPrepPage
        view="home"
        data={data}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn(async () => undefined)}
        onRateRecallTask={vi.fn(async () => undefined)}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('Studied units');
    expect(text).toContain('133');
    expect(text).toContain('Recall due now');
    expect(text).toContain('Introduced cards');
    expect(text).toContain('57');
    expect(text).toContain('Open Learn');
    expect(text).toContain('Open Recall Review');
  });

  it('Learn renders the 133 A-D/NAV units with independent studied toggles and no drills', async () => {
    const onToggle = vi.fn(async (_unitId: string) => undefined);
    const data = {
      ...emptyData(),
      examPrepUnitProgress: [makeUnitProgress(firstTask.unitId, '2026-09-05T00:00:00.000Z')],
    };
    await render(
      <ExamPrepPage
        view="learn"
        data={data}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={onToggle}
        onRateRecallTask={vi.fn(async () => undefined)}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('All (133)');
    expect(text).toContain('Tier A (51)');
    expect(text).toContain('Navigation (12)');
    // one unit marked studied (first unit has recall tasks from the same manifest)
    const studiedButtons = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Studied',
    );
    expect(studiedButtons).toHaveLength(1);
    expect(text).not.toContain('DRILL-01');
    // toggle another unit
    const notStudied = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Not studied',
    );
    expect(notStudied).toBeTruthy();
    await act(async () => {
      notStudied?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Recall gates cards behind Start Recall Session, hides expected text until Reveal, then rates', async () => {
    const onRate = vi.fn(async (_options: unknown) => undefined);
    await render(
      <ExamPrepPage
        view="recall"
        data={emptyData()}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn(async () => undefined)}
        onRateRecallTask={onRate}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    // idle: no card content, no answer leakage, explicit start gate
    expect(document.body.textContent).toContain('Ready for a recall session');
    expect(document.body.textContent).toContain('Start Recall Session');
    expect(document.querySelector('textarea')).toBeNull();
    const prompt = 'State the key rule you should remember for this curriculum unit.';
    expect(document.body.textContent).not.toContain(firstTask.expectedAnswer);
    await clickButton('Start Recall Session');
    expect(document.body.textContent).toContain('Card 1 of 8');
    expect(document.body.textContent).toContain(prompt);
    // no expected answer or rating buttons before Reveal
    expect(document.body.textContent).not.toContain('Expected answer');
    expect(document.body.textContent).not.toContain(firstTask.expectedAnswer);
    expect(document.body.textContent).not.toContain('Again ·');
    // type an answer and reveal
    const textarea = document.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await act(async () => {
      if (textarea instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'my recall attempt');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await clickButton('Reveal');
    expect(document.body.textContent).toContain('Expected answer');
    expect(document.body.textContent).toContain(firstTask.expectedAnswer);
    await clickButton('Good ·');
    expect(onRate).toHaveBeenCalledTimes(1);
    const options = onRate.mock.calls[0]?.[0] as {
      item: ExamPrepQueueItem;
      rating: string;
      now: Date;
      answer?: string;
    };
    expect(options.item.task.id).toBe(firstTask.id);
    expect(options.rating).toBe('good');
    expect(options.answer).toBe('my recall attempt');
    expect(options.now).toBeInstanceOf(Date);
  });

  it('surfaces recall rating persistence failures without advancing the card', async () => {
    const onRate = vi.fn(async () => {
      throw new Error('Exam Prep recall progress changed before the rating could be saved.');
    });
    await render(
      <ExamPrepPage
        view="recall"
        data={emptyData()}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn(async () => undefined)}
        onRateRecallTask={onRate}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    await clickButton('Start Recall Session');
    await clickButton('Reveal');
    expect(document.body.textContent).toContain('Expected answer');
    await clickButton('Good ·');
    // error surfaced, card still revealed, rating not consumed, session count unchanged
    expect(document.body.textContent).toContain(
      'Exam Prep recall progress changed before the rating could be saved.',
    );
    expect(document.body.textContent).toContain('Expected answer');
    expect(document.body.textContent).toContain('Card 1 of 8');
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Reviewed this session: 0');
    expect(document.body.textContent).not.toContain('Session complete');
  });

  it('Home recommends a deterministic unstudied Learn unit without auto-marking it', async () => {
    const onToggle = vi.fn(async (_unitId: string) => undefined);
    const onNavigate = vi.fn();
    await render(
      <ExamPrepPage
        view="home"
        data={emptyData()}
        onNavigate={onNavigate}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={onToggle}
        onRateRecallTask={vi.fn(async () => undefined)}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('Recommended next unit');
    expect(text).toContain(firstUnitTitle);
    // the recommendation's Open Learn navigates but never marks studied
    const recommendedSection = Array.from(document.querySelectorAll('section')).find((section) =>
      section.textContent?.includes('Recommended next unit'),
    );
    const openLearn = recommendedSection
      ? Array.from(recommendedSection.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === 'Open Learn',
        )
      : null;
    expect(openLearn).toBeTruthy();
    await act(async () => {
      openLearn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('/study/learn');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('Home hides the recommendation once every Learn unit is studied', async () => {
    const data = {
      ...emptyData(),
      examPrepUnitProgress: EXAM_PREP_LEARN_UNITS.map((unit) => makeUnitProgress(unit.id)),
    };
    await render(
      <ExamPrepPage
        view="home"
        data={data}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn(async () => undefined)}
        onRateRecallTask={vi.fn(async () => undefined)}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    expect(document.body.textContent).not.toContain('Recommended next unit');
  });

  it('drills render session-only cards, freeze on Reveal, and format M:SS', async () => {
    const data = emptyData();
    await render(
      <ExamPrepPage
        view="drills"
        data={data}
        onNavigate={vi.fn()}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn(async () => undefined)}
        onRateRecallTask={vi.fn(async () => undefined)}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
      />,
    );
    const startButtons = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Start',
    );
    expect(startButtons).toHaveLength(24);
    expect(document.body.textContent).not.toContain('Answer points');
    expect(formatExamDrillTime(150)).toBe('2:30');
    expect(formatExamDrillTime(0)).toBe('0:00');
    expect(formatExamDrillTime(65)).toBe('1:05');
  });

  it('a drill card hides the answer key before Reveal and shows it after', async () => {
    const drillUnit = EXAM_PREP_MANIFEST.units.find((unit) => unit.id === 'DRILL-01');
    expect(drillUnit).toBeTruthy();
    await render(<ExamDrillCard unit={drillUnit as never} onOpenProvision={vi.fn()} />);
    const answerPoint = drillUnit?.drill?.answerKey.requiredAnswerPoints[0];
    expect(answerPoint).toBeTruthy();
    expect(document.body.textContent).not.toContain(answerPoint);
    await clickButton('Start');
    await clickButton('Reveal');
    expect(document.body.textContent).toContain('Answer points');
    expect(document.body.textContent).toContain(answerPoint ?? '');
  });

  it('sidebar names the item Exam Prep and highlights the recall route', async () => {
    await render(
      <StudyLayout
        activePath="/study/review"
        sidebarCollapsed={false}
        onSidebarCollapsedChange={vi.fn()}
        onNavigate={vi.fn()}
      >
        <div>Content</div>
      </StudyLayout>,
    );
    const examPrep = document.querySelector('nav button[aria-label="Exam Prep"]');
    expect(examPrep).toBeTruthy();
    expect(examPrep?.getAttribute('aria-current')).toBe('page');
    expect(document.body.textContent).not.toContain('Exam Curriculum');
    const dashboard = document.querySelector('nav button[aria-label="Dashboard"]');
    expect(dashboard?.getAttribute('aria-current')).toBeNull();
  });

  it('maps routes to views including the legacy exam-curriculum alias', () => {
    expect(decodeExamPrepView('/study/exam-prep')).toBe('home');
    expect(decodeExamPrepView('/study/learn')).toBe('learn');
    expect(decodeExamPrepView('/study/exam-curriculum')).toBe('learn');
    expect(decodeExamPrepView('/study/review')).toBe('recall');
    expect(decodeExamPrepView('/study/drills')).toBe('drills');
    expect(decodeExamPrepView('/study/session')).toBeNull();
  });
});
