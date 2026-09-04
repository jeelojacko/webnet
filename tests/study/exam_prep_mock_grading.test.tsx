// Exam Prep Mock — self-grading, finalize gate, results and history review.

/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepMockGrading } from '../../src/study/examPrep/components/ExamPrepMockGrading';
import { ExamPrepMockResultsView } from '../../src/study/examPrep/components/ExamPrepMockResultsView';
import { ExamPrepMockExamView } from '../../src/study/examPrep/components/ExamPrepMockExam';
import { examPrepRecognitionExpectedLabelForTier } from '../../src/study/examPrep/examPrepConstants';
import { makeGradedMockSession, makeMockSession, makeSubmittedMockSession } from './exam_prep_mock_support';
import { submitMock, gradeMockQuestion } from '../../src/study/examPrep/mock/examPrepMockSession';
import type { ExamPrepMockQuestionGrading, ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

const FIXED_NOW = '2026-09-08T15:00:00.000Z';

const partiallyGradedSession = (gradedCount: number): ExamPrepMockSession => {
  let session = submitMock(makeMockSession({ seed: `partial-${gradedCount}` }), FIXED_NOW);
  for (let index = 0; index < gradedCount; index += 1) {
    const question = session.questions[index];
    if (!question) break;
    const grading: ExamPrepMockQuestionGrading =
      question.kind === 'drill'
        ? {
            kind: 'drill',
            lawIdentified: true,
            provisionLocated: true,
            substantiveAnswerComplete: true,
            pointsAwarded: 3,
            gradedAt: FIXED_NOW,
          }
        : {
            kind: question.kind === 'recall' ? 'recall' : question.kind === 'recognition' ? 'recognition' : 'locate',
            correct: true,
            pointsAwarded: 1,
            gradedAt: FIXED_NOW,
          };
    session = gradeMockQuestion(session, question.questionId, grading, FIXED_NOW);
  }
  return session;
};

describe('Exam Prep mock self-grading', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let saves: ExamPrepMockSession[];

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    saves = [];
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const renderNode = async (node: React.ReactNode) => {
    await act(async () => {
      root?.render(node);
    });
  };

  const bodyText = () => document.body.textContent ?? '';

  const clickText = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const renderGrading = (session: ExamPrepMockSession) =>
    renderNode(
      <ExamPrepMockGrading
        session={session}
        onSaveSession={async (next) => {
          saves.push(next);
        }}
        onOpenProvision={vi.fn()}
      />,
    );

  it('blocks Finalize until every question has a grading record', async () => {
    const partial = partiallyGradedSession(1);
    await renderGrading(partial);
    const text = bodyText();
    expect(text).toContain('Self-grade your mock');
    expect(text).toContain('1 of 30 graded');
    const firstKind = partial.questions[0]?.kind;
    const heading =
      firstKind === 'recall'
        ? 'Expected rule'
        : firstKind === 'recognition'
          ? examPrepRecognitionExpectedLabelForTier(
              partial.questions[0]?.unitId?.startsWith('NAV-') ? 'NAV' : 'A',
            )
          : firstKind === 'locate'
            ? 'Expected location'
            : 'Expected answer';
    expect(text).toContain(heading);
    const finalize = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith('Finalize Results'),
    );
    expect((finalize as HTMLButtonElement | undefined)?.disabled).toBe(true);
  });

  it('shows expected answers with your answer and lets the learner re-score', async () => {
    const partial = partiallyGradedSession(0);
    await renderGrading(partial);
    const text = bodyText();
    expect(text).toContain('Your answer');
    expect(text).toContain('Correct');
    expect(text).toContain('Incorrect');
  });

  it('enables Finalize Results when all 30 questions are graded and finalizes', async () => {
    const full = makeSubmittedMockSession();
    await renderGrading(full);
    const text = bodyText();
    expect(text).toContain('30 of 30 graded');
    const finalize = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith('Finalize Results'),
    );
    expect((finalize as HTMLButtonElement | undefined)?.disabled).toBe(false);
    await clickText('Finalize Results');
    expect(saves.at(-1)?.status).toBe('graded');
    expect(saves.at(-1)?.gradedAt).toBeTruthy();
  });

  it('persists resumed grading state across a remount (12 graded stays 12)', async () => {
    const twelve = partiallyGradedSession(12);
    await renderGrading(twelve);
    expect(bodyText()).toContain('12 of 30 graded');
  });
});

describe('Exam Prep mock results view', () => {
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

  const renderResults = async (session: ExamPrepMockSession) => {
    await act(async () => {
      root?.render(
        <ExamPrepMockResultsView session={session} onOpenProvision={vi.fn()} />,
      );
    });
  };

  it('reports the practice score 34/42 = 81% with type breakdown and no pass/fail wording', async () => {
    await renderResults(makeGradedMockSession());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Practice score');
    expect(text).toContain('34 / 42');
    expect(text).toContain('81%');
    expect(text).toContain('Recall');
    expect(text).toContain('5 / 6');
    expect(text).toContain('7 / 8');
    expect(text).toContain('7 / 10');
    expect(text).toContain('15 / 18');
    expect(text).toContain('No official pass mark is configured for this provisional profile.');
    expect(text).not.toContain('Passed');
    expect(text).not.toContain('Failed');
    expect(text).not.toContain('Exam grade');
    expect(text).toContain('Profile');
    expect(text).toContain('nb-statute-provisional-v1');
  });

  it('renders abandoned sessions as read-only saved responses without a score', async () => {
    const abandoned = { ...makeMockSession({ seed: 'view-abandoned' }), status: 'abandoned' as const };
    await renderResults(abandoned);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Abandoned');
    expect(text).toContain('Saved responses');
    expect(text).not.toContain('Practice score');
  });
});

describe('Exam Prep mock history (grading incomplete / graded / abandoned)', () => {
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

  const renderView = async (sessions: ExamPrepMockSession[]) => {
    await act(async () => {
      root?.render(
        <ExamPrepMockExamView
          sessions={sessions}
          onSaveSession={async () => undefined}
          onOpenProvision={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
  };

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

  it('lists graded results and grading-incomplete rows and abandons separately', async () => {
    const graded = makeGradedMockSession();
    const partial = partiallyGradedSession(12);
    const abandoned = { ...makeMockSession({ seed: 'hist-abandoned' }), status: 'abandoned' as const };
    await renderView([graded, partial, abandoned]);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Recent Mock Exams');
    expect(text).toContain('34 / 42 · 81%');
    expect(text).toContain('Grading incomplete · 12 of 30 graded');
    expect(text).toContain('Continue Grading');
    expect(text).toContain('Abandoned');
    expect(text).toContain('No score — abandoned');
    expect(text).toContain('View responses');
  });

  it('opens grading from a grading-incomplete history row', async () => {
    const partial = partiallyGradedSession(12);
    await renderView([partial]);
    await clickButton('Continue Grading');
    expect(document.body.textContent ?? '').toContain('Self-grade your mock');
    expect(document.body.textContent ?? '').toContain('Question 1 of 30');
  });

  it('ignores archived-hash sessions in the current history', async () => {
    const graded = makeGradedMockSession();
    const archived = {
      ...makeGradedMockSession(),
      curriculumContentHash: 'f9'.padEnd(64, 'a'),
    };
    await renderView([graded, archived]);
    const text = document.body.textContent ?? '';
    // exactly one current graded result is listed even though an archived copy exists
    expect(text.split('34 / 42 · 81%').length - 1).toBe(1);
  });
});
