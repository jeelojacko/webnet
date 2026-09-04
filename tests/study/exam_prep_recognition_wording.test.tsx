/** @vitest-environment jsdom */

// Exam Prep — task-aware Recognition wording (normal vs NAV), shared by the
// Recognition sprint and the provisional Mock exam.
//
// Ordinary A/B/C/D cues ask "Which statute, regulation, bylaw, or legal topic
// should you check first?"; tier-NAV routing cues (e.g. `deed`) ask "What
// routing issue should this cue make you resolve first?" and reveal under an
// "Expected routing issue" heading. Mock active/grading/review echo the same
// helper so normal / NAV / Mock copy cannot drift. Cue content itself is
// untouched.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepRecognitionView } from '../../src/study/examPrep/components/ExamPrepRecognition';
import { ExamPrepMockGrading } from '../../src/study/examPrep/components/ExamPrepMockGrading';
import { buildExamPrepRecognitionQueue } from '../../src/study/examPrep/examPrepRecognitionQueue';
import {
  EXAM_PREP_RECOGNITION_ASK_NORMAL,
  EXAM_PREP_RECOGNITION_ASK_NAV,
  examPrepRecognitionAskForTier,
  examPrepRecognitionExpectedLabelForTier,
} from '../../src/study/examPrep/examPrepConstants';
import { examPrepMockQuestionPromptText } from '../../src/study/examPrep/mock/examPrepMockQuestionPrompt';
import { resolveExamPrepMockQuestionContent } from '../../src/study/examPrep/mock/examPrepMockQuestionContent';
import { submitMock } from '../../src/study/examPrep/mock/examPrepMockSession';
import { makeMockSession } from './exam_prep_mock_support';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

const recognitionSession = buildExamPrepRecognitionQueue([]);
if (recognitionSession.length !== 10) throw new Error('expected 10-item frozen recognition sprint');

describe('Exam Prep task-aware Recognition wording', () => {
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
      await Promise.resolve();
    });
  };

  it('helper: ordinary tiers get the statute/regulation/bylaw ask; NAV gets the routing ask', () => {
    expect(examPrepRecognitionAskForTier('A')).toBe(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(examPrepRecognitionAskForTier('B')).toBe(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(examPrepRecognitionAskForTier('C')).toBe(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(examPrepRecognitionAskForTier('D')).toBe(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(examPrepRecognitionAskForTier('NAV')).toBe(EXAM_PREP_RECOGNITION_ASK_NAV);
    expect(EXAM_PREP_RECOGNITION_ASK_NORMAL).toContain(
      'Which statute, regulation, bylaw, or legal topic should you check first?',
    );
    expect(EXAM_PREP_RECOGNITION_ASK_NAV).toBe(
      'What routing issue should this cue make you resolve first?',
    );
    // Reveal labels: NAV exposes a routing issue; others expose the topic.
    expect(examPrepRecognitionExpectedLabelForTier('A')).toBe('Expected topic');
    expect(examPrepRecognitionExpectedLabelForTier('NAV')).toBe('Expected routing issue');
  });

  it('Recognition sprint: NAV cue is asked as a routing question and revealed as a routing issue', async () => {
    await render(
      <ExamPrepRecognitionView
        attempts={[]}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Recognition Sprint');

    // Question 8 is the first frozen NAV item (NAV-01 cue `deed`).
    const navTask = recognitionSession[7];
    if (!navTask || navTask.tier !== 'NAV')
      throw new Error('expected frozen NAV item at index 7');
    for (let step = 0; step < 7; step += 1) {
      await clickButton('Reveal');
      await clickButton('Missed it');
    }
    expect(bodyText()).toContain('Question 8 of 10');
    expect(bodyText()).toContain(navTask.cue);
    // Pre-reveal ask is the routing question; answer identity stays hidden.
    expect(bodyText()).toContain(EXAM_PREP_RECOGNITION_ASK_NAV);
    expect(bodyText()).not.toContain('Expected routing issue');
    expect(bodyText()).not.toContain(navTask.unitTitle);
    await clickButton('Reveal');
    expect(bodyText()).toContain('Expected routing issue');
    expect(bodyText()).toContain(navTask.unitId);
  });

  it('Recognition sprint: ordinary A cue uses the statute/regulation/bylaw ask and Expected topic reveal', async () => {
    const first = recognitionSession[0];
    if (!first || first.tier === 'NAV') throw new Error('expected an ordinary first item');
    await render(
      <ExamPrepRecognitionView
        attempts={[]}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Recognition Sprint');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(bodyText()).not.toContain(EXAM_PREP_RECOGNITION_ASK_NAV);
    await clickButton('Reveal');
    expect(bodyText()).toContain('Expected topic');
    expect(bodyText()).not.toContain('Expected routing issue');
  });

  const recognitionQuestionIndexes = (session: ExamPrepMockSession) => {
    const indexes: Array<{ index: number; unitId: string }> = [];
    session.questions.forEach((question, index) => {
      if (question.kind === 'recognition') {
        indexes.push({ index, unitId: question.unitId });
      }
    });
    return indexes;
  };

  const firstNavRecognitionIndex = (session: ExamPrepMockSession): number => {
    const nav = recognitionQuestionIndexes(session).find(
      ({ unitId }) => unitId === 'NAV-01' || unitId.startsWith('NAV-'),
    );
    if (!nav) throw new Error('expected a NAV recognition question in the mock paper');
    return nav.index;
  };

  const firstNormalRecognitionIndex = (session: ExamPrepMockSession): number => {
    const normal = recognitionQuestionIndexes(session).find(
      ({ unitId }) => !unitId.startsWith('NAV-'),
    );
    if (!normal) throw new Error('expected a normal recognition question in the mock paper');
    return normal.index;
  };

  const mockAtQuestion = (index: number): ExamPrepMockSession => {
    const submitted = submitMock(makeMockSession({ seed: 'wording-seed' }), '2026-09-08T15:00:00.000Z');
    return { ...submitted, currentQuestionIndex: index };
  };

  it('Mock grading echoes the task-aware wording and expected labels for a NAV question', async () => {
    const navSession = mockAtQuestion(firstNavRecognitionIndex(makeMockSession({ seed: 'wording-seed' })));
    await render(
      <ExamPrepMockGrading
        session={navSession}
        onSaveSession={vi.fn(async () => undefined)}
        onOpenProvision={vi.fn()}
      />,
    );
    const navQuestion = navSession.questions[navSession.currentQuestionIndex];
    const navContent = resolveExamPrepMockQuestionContent(navQuestion);
    if (navContent.kind !== 'recognition') throw new Error('expected recognition content');
    expect(bodyText()).toContain(navContent.cue);
    expect(bodyText()).toContain(EXAM_PREP_RECOGNITION_ASK_NAV);
    expect(bodyText()).toContain('Expected routing issue');
  });

  it('Mock grading echoes the task-aware wording and expected labels for an ordinary question', async () => {
    const normalSession = mockAtQuestion(
      firstNormalRecognitionIndex(makeMockSession({ seed: 'wording-seed' })),
    );
    await render(
      <ExamPrepMockGrading
        session={normalSession}
        onSaveSession={vi.fn(async () => undefined)}
        onOpenProvision={vi.fn()}
      />,
    );
    const normalContent = resolveExamPrepMockQuestionContent(
      normalSession.questions[normalSession.currentQuestionIndex],
    );
    if (normalContent.kind !== 'recognition') throw new Error('expected recognition content');
    expect(bodyText()).toContain(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(bodyText()).toContain('Expected topic');
    expect(bodyText()).not.toContain('Expected routing issue');
  });

  it('Mock active prompt helper uses the same task-aware wording (pure check)', () => {
    const session = makeMockSession({ seed: 'wording-seed' });
    const navIndex = firstNavRecognitionIndex(session);
    const normalIndex = firstNormalRecognitionIndex(session);
    const navText = examPrepMockQuestionPromptText(session.questions[navIndex]);
    const normalText = examPrepMockQuestionPromptText(session.questions[normalIndex]);
    expect(navText).toContain(EXAM_PREP_RECOGNITION_ASK_NAV);
    expect(navText).not.toContain(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(normalText).toContain(EXAM_PREP_RECOGNITION_ASK_NORMAL);
    expect(normalText).not.toContain(EXAM_PREP_RECOGNITION_ASK_NAV);
  });
});
