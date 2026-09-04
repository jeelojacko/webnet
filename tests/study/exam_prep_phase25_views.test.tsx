/** @vitest-environment jsdom */

// Exam Prep Phase 2.5 — learner-workflow / readiness UX view tests.
//
// Component-level coverage for the Phase 2.5 UI pass:
//  - Home: Suggested study flow, five independent readiness dimensions
//    (Learn X/133, Recall due + introduced X/57, Recognition coverage X/317 +
//    accuracy, Locate coverage X/452 + accuracy, Drills exam-ready X/24 +
//    attempted X/24), Today's Activity (zero and populated states), the
//    all-studied Curriculum coverage note, the "What these measure" help
//    block, and Recommended Now CTAs routing to each mode.
//  - Recognition/Locate start screens carry honest full-curriculum copy.
//  - Locate document-level targets reveal the statute title + document-level
//    note and never render "Open exact provision"; pinned targets do.
//  - Lookup Drills: readiness summary, exam-ready definition note, status +
//    difficulty filters (Needs Work = Developing + Accurate), Recommended
//    drill block with a filter-resetting Go to drill, and M:SS target badges.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepHomeView } from '../../src/study/examPrep/components/ExamPrepHome';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import { ExamPrepRecognitionView } from '../../src/study/examPrep/components/ExamPrepRecognition';
import { ExamPrepDrillsView } from '../../src/study/examPrep/components/ExamPrepDrills';
import { buildExamPrepHomeMetrics } from '../../src/study/examPrep/examPrepSelectors';
import {
  EXAM_PREP_RECALL_TASKS,
  EXAM_PREP_LEARN_UNITS,
} from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_LOCATE_TASKS } from '../../src/study/examPrep/examPrepLocateTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../../src/study/examPrep/examPrepRecognitionTasks';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import { EXAM_PREP_DOCUMENT_TITLES } from '../../src/study/examPrep/examPrepDocTitles';
import { examPrepDrillTaskId } from '../../src/study/examPrep/examPrepDrillFilters';
import { formatExamPrepLocalDate } from '../../src/study/examPrep/examPrepLocalDate';
import type {
  ExamPrepAttempt,
  ExamPrepDrillAttempt,
  ExamPrepRecallProgress,
  ExamPrepUnitProgress,
} from '../../src/study/examPrep/examPrepTypes';
import {
  makeDrillAttempt,
  makeLocateAttempt,
  makeRecallAttempt,
  makeRecallProgress,
  makeRecognitionAttempt,
  makeUnitProgress,
  testCard,
} from './exam_prep_test_support';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const PAST = '2020-06-01T00:00:00.000Z';

const recognitionTaskIds = EXAM_PREP_RECOGNITION_TASKS.map((task) => task.id);
const locateTaskIds = EXAM_PREP_LOCATE_TASKS.map((task) => task.id);
if (recognitionTaskIds.length !== 317 || locateTaskIds.length !== 452)
  throw new Error('expected frozen Recognition/Locate pools');

const firstUnit = EXAM_PREP_LEARN_UNITS[0];
if (!firstUnit) throw new Error('expected learn units');

const qualifyingDrill = (
  id: string,
  unitId: string,
  practiceDate: string,
): ExamPrepDrillAttempt =>
  makeDrillAttempt({
    id,
    taskId: examPrepDrillTaskId(unitId),
    unitId,
    elapsedSeconds: 45,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: true,
    practiceDate,
    completedAt: `${practiceDate}T12:00:00.000Z`,
  });

const developingDrill = (id: string, unitId: string): ExamPrepDrillAttempt =>
  makeDrillAttempt({
    id,
    taskId: examPrepDrillTaskId(unitId),
    unitId,
    elapsedSeconds: 90,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: false,
    practiceDate: '2020-06-01',
    completedAt: '2020-06-01T12:00:00.000Z',
  });

const recallAttemptLike = (id: string, taskId: string, unitId: string, reviewedAt: string): ExamPrepAttempt =>
  makeRecallAttempt({ id, taskId, unitId, reviewedAt });

describe('Exam Prep Phase 2.5 views', () => {
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

  const bodyText = (): string => document.body.textContent ?? '';

  const clickButton = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const clickButtonInSection = async (sectionText: string, buttonText: string) => {
    const section = Array.from(document.querySelectorAll('section')).find((entry) =>
      entry.textContent?.includes(sectionText),
    );
    expect(section).toBeTruthy();
    const button = section
      ? Array.from(section.querySelectorAll('button')).find((entry) =>
          entry.textContent?.trim().startsWith(buttonText),
        )
      : null;
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const renderHome = async ({
    unitProgress = [],
    recallProgress = [],
    attempts = [],
  }: {
    unitProgress?: ExamPrepUnitProgress[];
    recallProgress?: ExamPrepRecallProgress[];
    attempts?: ExamPrepAttempt[];
  }) => {
    const metrics = buildExamPrepHomeMetrics(unitProgress, recallProgress, NOW, attempts);
    const onNavigate = vi.fn();
    await render(
      <ExamPrepHomeView
        metrics={metrics}
        unitProgress={unitProgress}
        recallProgress={recallProgress}
        attempts={attempts}
        now={NOW}
        newRecallCardsPerSession={8}
        maxRecallCardsPerSession={20}
        onNavigate={onNavigate}
      />,
    );
    return onNavigate;
  };

  describe('Home learner workflow', () => {
    it('shows the Suggested study flow and What-these-measure help block', async () => {
      await renderHome({});
      const text = bodyText();
      expect(text).toContain('Suggested study flow');
      expect(text).toContain('Understand the topic and where its law lives.');
      expect(text).toContain('Memorize only the 57 curated REMEMBER rules.');
      expect(text).toContain('Practice identifying which law/topic applies.');
      expect(text).toContain('Practice finding the correct statute or provision.');
      expect(text).toContain('Combine recognition, retrieval, and application.');
      expect(text).toContain('What these measure');
      expect(text).toContain('You have worked through the curriculum unit.');
      expect(text).toContain('You scored 3/3 within the target time on two different practice dates.');
      expect(text).toContain('Studied ≠ mastered');
      expect(text).toContain('Accuracy ≠ complete curriculum coverage');
      expect(text).toContain('Exam-ready drills ≠ guarantee of exam success');
    });

    it('shows all five independent readiness dimensions with accuracy + coverage', async () => {
      const learnProgress = EXAM_PREP_LEARN_UNITS.slice(0, 17).map((unit) =>
        makeUnitProgress(unit.id, PAST),
      );
      const recallTasks = EXAM_PREP_RECALL_TASKS.slice(0, 20);
      if (recallTasks.length !== 20) throw new Error('expected 20 recall tasks');
      const recallProgress = recallTasks.map((task, index) =>
        makeRecallProgress({
          taskId: task.id,
          unitId: task.unitId,
          card: testCard({
            state: 'Review',
            due: index < 5 ? '2026-09-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
          }),
        }),
      );
      const recognitionAttempts = recognitionTaskIds.slice(0, 40).map((taskId, index) =>
        makeRecognitionAttempt({
          id: `rec-${index}`,
          taskId,
          unitId: taskId.split(':')[1] ?? 'A-NBLS-01',
          result: index < 32 ? 'got_it' : 'missed', // 80%
          completedAt: PAST,
        }),
      );
      const locateAttempts = locateTaskIds.slice(0, 20).map((taskId, index) =>
        makeLocateAttempt({
          id: `loc-${index}`,
          taskId,
          unitId: taskId.split(':')[1] ?? 'A-NBLS-02',
          result: index < 15 ? 'found' : 'missed', // 75%
          completedAt: PAST,
        }),
      );
      const drillAttempts: ExamPrepDrillAttempt[] = [
        // three exam-ready drills (two qualifying practice dates each)
        ...['DRILL-01', 'DRILL-02', 'DRILL-03'].flatMap((unitId) => [
          qualifyingDrill(`a-${unitId}-1`, unitId, '2020-06-01'),
          qualifyingDrill(`a-${unitId}-2`, unitId, '2020-06-02'),
        ]),
        // four more attempted-but-not-ready drills
        developingDrill('d-04', 'DRILL-04'),
        developingDrill('d-05', 'DRILL-05'),
        qualifyingDrill('q-06', 'DRILL-06', '2020-06-01'),
        qualifyingDrill('q-07', 'DRILL-07', '2020-06-01'),
      ];

      await renderHome({
        unitProgress: learnProgress,
        recallProgress,
        attempts: [...recognitionAttempts, ...locateAttempts, ...drillAttempts],
      });

      const text = bodyText();
      expect(text).toContain('17 / 133'); // Learn coverage
      const recallCard = Array.from(document.querySelectorAll('section')).find((section) =>
        section.textContent?.includes('Recall due now'),
      );
      expect(recallCard?.textContent).toContain('5'); // five due now
      expect(text).toContain('20 / 57'); // introduced
      expect(text).toContain('80%'); // Recognition latest accuracy
      expect(text).toContain('40 / 317 cues attempted'); // Recognition coverage
      expect(text).toContain('75%'); // Locate latest accuracy
      expect(text).toContain('20 / 452 targets attempted'); // Locate coverage
      expect(text).toContain('3 / 24 exam-ready'); // drill readiness
      expect(text).toContain('7 / 24 attempted'); // drill attempted
      // five independent dimensions only — never a combined mastery score
      expect(text).not.toContain('Mastery');
      expect(text).not.toContain('You are behind');
    });

    it('says No attempts yet when Recognition/Locate history is empty', async () => {
      await renderHome({});
      expect(bodyText()).toContain('No attempts yet');
    });

    it('shows the all-studied Curriculum coverage note (without mastery wording)', async () => {
      const allProgress = EXAM_PREP_LEARN_UNITS.map((unit) => makeUnitProgress(unit.id, PAST));
      await renderHome({ unitProgress: allProgress });
      const text = bodyText();
      expect(text).toContain('Curriculum coverage');
      expect(text).toContain('All 133 curriculum units are marked studied.');
      // the coverage note itself never calls the units mastered (the help
      // block legitimately says “Studied ≠ mastered”, so scope the check)
      const coverage = Array.from(document.querySelectorAll('section')).find((section) =>
        section.textContent?.includes('Curriculum coverage'),
      );
      expect(coverage?.textContent).not.toContain('mastered');
      expect(coverage?.textContent).not.toContain('Master this');
    });

    it('Today activity panel shows the empty message and derived current-day counts', async () => {
      await renderHome({});
      expect(bodyText()).toContain("Today's activity");
      expect(bodyText()).toContain('No Exam Prep activity recorded today yet.');

      // Populated panel on a fixed local date.
      const todayIso = NOW.toISOString();
      const today = formatExamPrepLocalDate(NOW);
      const unitProgress = [
        makeUnitProgress('A-NBLS-01', todayIso),
        makeUnitProgress('A-NBLS-02', todayIso),
      ];
      const attempts: ExamPrepAttempt[] = [
        recallAttemptLike('recall-0', 'recall:A-NBLS-01:1', 'A-NBLS-01', todayIso),
        recallAttemptLike('recall-1', 'recall:A-NBLS-02:1', 'A-NBLS-02', todayIso),
        recallAttemptLike('recall-2', 'recall:A-REG-01:1', 'A-REG-01', todayIso),
        ...recognitionTaskIds.slice(0, 10).map((taskId, index) =>
          makeRecognitionAttempt({
            id: `rt-${index}`,
            taskId,
            unitId: taskId.split(':')[1] ?? 'A-NBLS-01',
            completedAt: todayIso,
          }),
        ),
        ...locateTaskIds.slice(0, 10).map((taskId, index) =>
          makeLocateAttempt({
            id: `lt-${index}`,
            taskId,
            unitId: taskId.split(':')[1] ?? 'A-NBLS-02',
            completedAt: todayIso,
          }),
        ),
        qualifyingDrill('drill-today', 'DRILL-01', today),
      ];
      await renderHome({ unitProgress, attempts });
      const populated = bodyText();
      expect(populated).not.toContain('No Exam Prep activity recorded today yet.');
      expect(populated).toContain('2 units');
      expect(populated).toContain('3 reviews');
      expect(populated).toContain('10 questions');
      expect(populated).toContain('10 lookups');
      expect(populated).toContain('1 attempt');
    });

    it('Recommended Now routes to each mode with neutral copy', async () => {
      // Recall due -> /study/review
      let onNavigate = await renderHome({
        recallProgress: [
          makeRecallProgress({
            taskId: EXAM_PREP_RECALL_TASKS[0]?.id ?? 'recall:A-NBLS-01:1',
            unitId: 'A-NBLS-01',
            card: testCard({ state: 'Review', due: '2026-09-01T00:00:00.000Z' }),
          }),
        ],
      });
      expect(bodyText()).toContain('1 recall card is due.');
      expect(bodyText()).toContain('Reviewing due memory is the highest-priority task.');
      await clickButtonInSection('Recommended now', 'Start Recall Review');
      expect(onNavigate).toHaveBeenCalledWith('/study/review');

      // Unstudied Learn unit -> /study/learn
      onNavigate = await renderHome({});
      expect(bodyText()).toContain(firstUnit.id);
      expect(bodyText()).toContain(firstUnit.title);
      expect(bodyText()).toContain('Next high-priority unstudied curriculum unit.');
      await clickButtonInSection('Recommended now', 'Open Learn');
      expect(onNavigate).toHaveBeenCalledWith('/study/learn');

      // Missed Recognition -> /study/recognition
      const allStudied = EXAM_PREP_LEARN_UNITS.map((unit) => makeUnitProgress(unit.id, PAST));
      const missedRecognition = makeRecognitionAttempt({
        id: 'miss-r',
        taskId: recognitionTaskIds[0] ?? 'recognition:A-NBLS-01:1',
        unitId: 'A-NBLS-01',
        result: 'missed',
        completedAt: PAST,
      });
      onNavigate = await renderHome({ unitProgress: allStudied, attempts: [missedRecognition] });
      expect(bodyText()).toContain('Recognition practice');
      await clickButtonInSection('Recommended now', 'Start Recognition Sprint');
      expect(onNavigate).toHaveBeenCalledWith('/study/recognition');

      // Missed Locate -> /study/locate
      const missedLocate = makeLocateAttempt({
        id: 'miss-l',
        taskId: locateTaskIds[0] ?? 'locate:A-NBLS-02:1',
        unitId: 'A-NBLS-02',
        result: 'missed',
        completedAt: PAST,
      });
      onNavigate = await renderHome({ unitProgress: allStudied, attempts: [missedLocate] });
      expect(bodyText()).toContain('Locate practice');
      await clickButtonInSection('Recommended now', 'Start Locate Sprint');
      expect(onNavigate).toHaveBeenCalledWith('/study/locate');

      // Developing drill -> /study/drills
      onNavigate = await renderHome({
        unitProgress: allStudied,
        attempts: [developingDrill('dev-01', 'DRILL-01')],
      });
      expect(bodyText()).toContain('DRILL-01');
      expect(bodyText()).toContain('Status: Developing');
      await clickButtonInSection('Recommended now', 'Open Lookup Drills');
      expect(onNavigate).toHaveBeenCalledWith('/study/drills');
    });
  });

  describe('Recognition/Locate start screens', () => {
    it('Recognition start copy explains the full-curriculum sampling and reveal gate', async () => {
      await render(
        <ExamPrepRecognitionView
          attempts={[]}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
          onNavigate={vi.fn()}
        />,
      );
      const text = bodyText();
      expect(text).toContain('10 questions.');
      expect(text).toContain('Practice identifying which law or legal topic a fact or cue points to.');
      expect(text).toContain('The expected topic and likely source documents remain hidden until Reveal.');
      expect(text).toContain('This sprint samples the full exam curriculum.');
      expect(text).toContain('Start Recognition Sprint');
    });

    it('Locate start copy is honest about statute-vs-provision scope and sampling', async () => {
      await render(
        <ExamPrepLocateView
          attempts={[]}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
          onOpenProvision={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
      const text = bodyText();
      expect(text).toContain('10 questions.');
      expect(text).toContain('Practice finding the correct statute or controlling provision.');
      expect(text).toContain('The answer remains hidden until Check Answer.');
      expect(text).toContain('This sprint samples the full exam curriculum.');
      expect(text).toContain('Start Locate Sprint');
      // no universal claim that every task pins an exact provision
      expect(text).not.toContain('Find the exact controlling provision');
    });
  });

  describe('Locate reveal honesty (document-level vs pinned)', () => {
    it('preserves the frozen 390 pinned / 62 document-level split', () => {
      const pinned = EXAM_PREP_LOCATE_TASKS.filter((task) => task.expectedSourceKey !== null);
      const documentLevel = EXAM_PREP_LOCATE_TASKS.filter((task) => task.expectedSourceKey === null);
      expect(pinned).toHaveLength(390);
      expect(documentLevel).toHaveLength(62);
      expect(pinned.length + documentLevel.length).toBe(452);
    });
    const renderLocate = async (attempts: ExamPrepAttempt[]) => {
      await render(
        <ExamPrepLocateView
          attempts={attempts}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
          onOpenProvision={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    };

    it('pinned targets reveal the provision and render Open exact provision', async () => {
      await renderLocate([]);
      const session = buildExamPrepLocateQueue([]);
      const first = session[0];
      expect(first?.expectedSourceKey).not.toBeNull();
      await clickButton('Start Locate Sprint');
      expect(bodyText()).toContain('Question 1 of 10');
      await clickButton('Check Answer');
      const docTitle = EXAM_PREP_DOCUMENT_TITLES[first?.expectedDocumentId ?? ''] ?? '';
      expect(bodyText()).toContain('Expected location');
      expect(bodyText()).toContain(docTitle);
      expect(bodyText()).toContain('s.15(1)'); // provision label for the pinned first target
      expect(bodyText()).toContain('Open exact provision');
      expect(bodyText()).not.toContain('Document-level target');
    });

    it('document-level targets reveal only the statute and the document-level note', async () => {
      const docLevel = EXAM_PREP_LOCATE_TASKS.find((task) => task.expectedSourceKey === null);
      expect(docLevel).toBeTruthy();
      const target = docLevel as NonNullable<typeof docLevel>;

      // Mark every other locate target found so the frozen 10-item sprint
      // opens on the document-level target.
      const seeded: ExamPrepAttempt[] = EXAM_PREP_LOCATE_TASKS.filter(
        (task) => task.id !== target.id,
      ).map((task) =>
        makeLocateAttempt({
          id: `seed-${task.id}`,
          taskId: task.id,
          unitId: task.unitId,
          expectedDocumentId: task.expectedDocumentId,
          expectedSourceKey: task.expectedSourceKey,
          result: 'found',
          elapsedSeconds: 8,
          completedAt: PAST,
        }),
      );
      expect(seeded).toHaveLength(451);
      const session = buildExamPrepLocateQueue(seeded);
      expect(session[0]?.id).toBe(target.id);
      expect(session[0]?.expectedSourceKey).toBeNull();

      await renderLocate(seeded);
      await clickButton('Start Locate Sprint');
      expect(bodyText()).toContain('Question 1 of 10');
      await clickButton('Check Answer');
      const docTitle =
        EXAM_PREP_DOCUMENT_TITLES[target.expectedDocumentId] ?? target.expectedDocumentId;
      expect(bodyText()).toContain('Expected location');
      expect(bodyText()).toContain(docTitle);
      expect(bodyText()).toContain(
        'Document-level target — no single provision is pinned in the curriculum.',
      );
      expect(bodyText()).not.toContain('Open exact provision');
    });
  });

  describe('Lookup Drills summary, filters, and recommended drill', () => {
    const renderDrills = async (attempts: ExamPrepAttempt[]) => {
      await render(
        <ExamPrepDrillsView
          attempts={attempts}
          onOpenProvision={vi.fn()}
          onSaveDrillAttempt={vi.fn(async () => undefined)}
        />,
      );
    };

    const startButtonCount = (): number =>
      Array.from(document.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Start',
      ).length;

    it('shows summary counts, the exam-ready definition note, and M:SS target badges', async () => {
      await renderDrills([
        qualifyingDrill('a-01-1', 'DRILL-01', '2020-06-01'),
        qualifyingDrill('a-01-2', 'DRILL-01', '2020-06-02'),
      ]);
      const text = bodyText();
      expect(text).toContain('Exam-ready 1');
      expect(text).toContain('Accurate 0');
      expect(text).toContain('Developing 0');
      expect(text).toContain('Unattempted 23');
      expect(text).toContain('1 / 24 attempted');
      expect(text).toContain('Exam-ready = 3/3 within the target time on two different practice dates.');
      expect(text).toContain('Recommended drill');
      expect(text).toContain('DRILL-02');
      expect(text).toContain('Go to drill');
      // drill target header badges use M:SS (150s target -> 2:30)
      expect(text).toContain('2:30');
      expect(text).not.toContain('150s');
      expect(text).not.toContain('60s');
    });

    it('status and difficulty filters combine and filter the canonical list', async () => {
      const attempts: ExamPrepAttempt[] = [
        // DRILL-01 exam-ready, DRILL-02 accurate, DRILL-03 developing
        qualifyingDrill('a1', 'DRILL-01', '2020-06-01'),
        qualifyingDrill('a2', 'DRILL-01', '2020-06-02'),
        qualifyingDrill('a3', 'DRILL-02', '2020-06-01'),
        developingDrill('a4', 'DRILL-03'),
      ];
      await renderDrills(attempts);
      const text = bodyText();
      expect(text).toContain('Exam-ready 1');
      expect(text).toContain('Accurate 1');
      expect(text).toContain('Developing 1');
      expect(text).toContain('Needs Work (2)');
      expect(text).toContain('All (24)');
      expect(text).toContain('Direct (8)');
      expect(text).toContain('Routing (8)');
      expect(text).toContain('Cross-document (8)');

      // status filter
      await clickButton('Exam-ready (1)');
      expect(startButtonCount()).toBe(1);
      await clickButton('Developing (1)');
      expect(startButtonCount()).toBe(1);
      await clickButton('Needs Work (2)');
      expect(startButtonCount()).toBe(2); // DRILL-02 + DRILL-03, never Exam-ready
      // combined with difficulty (DRILL-01..08 are Direct, 09+ are not)
      await clickButton('Cross-document (8)');
      expect(startButtonCount()).toBe(0);
      expect(bodyText()).toContain('No drills match the current filters.');
      // All (24) resets the status filter; All difficulties resets difficulty
      await clickButton('All (24)');
      expect(startButtonCount()).toBe(8); // difficulty filter still Cross-document
      await clickButton('All difficulties (24)');
      expect(startButtonCount()).toBe(24); // every drill reachable from All
      // difficulty-only filter
      await clickButton('Routing (8)');
      expect(startButtonCount()).toBe(8);
      await clickButton('All (24)');
      expect(startButtonCount()).toBe(8); // routing filter persists
      await clickButton('All difficulties (24)');
      expect(startButtonCount()).toBe(24);
    });

    it('Go to drill clears filters that would hide the recommended card', async () => {
      const attempts: ExamPrepAttempt[] = [
        qualifyingDrill('a1', 'DRILL-01', '2020-06-01'),
        qualifyingDrill('a2', 'DRILL-01', '2020-06-02'),
      ];
      await renderDrills(attempts);
      // recommended = DRILL-02; hide it behind the Exam-ready filter
      await clickButton('Exam-ready (1)');
      expect(startButtonCount()).toBe(1);
      expect(bodyText()).toContain('DRILL-02'); // Recommended block still on top
      await clickButtonInSection('Recommended drill', 'Go to drill');
      // filters reset -> every drill visible again
      expect(startButtonCount()).toBe(24);
    });
  });
});
