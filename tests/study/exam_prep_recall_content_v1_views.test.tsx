// Exam Prep — Recall Content V1 view regression (jsdom).
//
// Learn renders the same learner-facing rule text the Recall resolver
// reveals later, Recall asks the authored V1 questions (never the generic
// prompt), and the Mock exam shows the authored prompt while answering but
// keeps every expected answer hidden until grading.

/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamUnitCard } from '../../src/study/examPrep/components/examUnitCard';
import { ExamPrepMockActive } from '../../src/study/examPrep/components/ExamPrepMockActive';
import { ExamPrepMockGrading } from '../../src/study/examPrep/components/ExamPrepMockGrading';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import {
  EXAM_PREP_RECALL_CONTENT_V1,
  resolveExamPrepRecallLearnerContent,
} from '../../src/study/examPrep/examPrepRecallContentV1';
import { EXAM_PREP_RECALL_PROMPT } from '../../src/study/examPrep/examPrepConstants';
import { submitMock } from '../../src/study/examPrep/mock/examPrepMockSession';
import type {
  ExamPrepMockQuestionRef,
  ExamPrepMockSession,
} from '../../src/study/examPrep/mock/examPrepMockTypes';
import { makeMockSession } from './exam_prep_mock_support';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

const bodyText = (): string => document.body.textContent ?? '';

const taskById = new Map(EXAM_PREP_RECALL_TASKS.map((task) => [task.id, task]));

/** Single-question in-progress session over one frozen Recall task. */
const makeRecallOnlySession = (sourceTaskId: string, unitId: string): ExamPrepMockSession => {
  const base = makeMockSession({ seed: `recall-v1-${sourceTaskId}` });
  const question: ExamPrepMockQuestionRef = {
    questionId: 'q01',
    kind: 'recall',
    sourceTaskId,
    unitId,
    pointsPossible: 1,
  };
  return {
    ...base,
    currentQuestionIndex: 0,
    questions: [question],
    responses: [
      {
        questionId: 'q01',
        answer: '',
        visited: true,
        flagged: false,
        responseUpdatedAt: null,
        grading: null,
      },
    ],
  };
};

describe('Exam Prep Recall Content V1 Learn alignment (A-SURV-03)', () => {
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

  it('renders the resolver expected answer for each of the 3 REMEMBER entries', async () => {
    const unit = EXAM_PREP_MANIFEST.units.find((entry) => entry.id === 'A-SURV-03');
    expect(unit).toBeTruthy();
    await renderIntoRoot(<ExamUnitCard unit={unit!} onOpenProvision={vi.fn()} />, root);
    const text = bodyText();
    expect(text).toContain('Remember');
    for (const index of [1, 2, 3]) {
      const task = taskById.get(`recall:A-SURV-03:${index}`);
      expect(task).toBeTruthy();
      const resolved = resolveExamPrepRecallLearnerContent(task!);
      // The override text (when present) is what Learn shows, not raw mustRecall.
      expect(text).toContain(resolved.expectedAnswer);
    }
  });

  it('asks the three authored A-SURV-03 questions, never the generic prompt', () => {
    const prompts = [1, 2, 3].map((index) => {
      const task = taskById.get(`recall:A-SURV-03:${index}`);
      expect(task).toBeTruthy();
      return resolveExamPrepRecallLearnerContent(task!).prompt;
    });
    expect(prompts).toEqual(
      EXAM_PREP_RECALL_CONTENT_V1.filter((record) =>
        record.taskId.startsWith('recall:A-SURV-03:'),
      ).map((record) => record.prompt),
    );
    expect(prompts).toContain(
      'In an integrated survey area, which legal monuments established by a surveyor must be tied to coordinate monuments?',
    );
    expect(prompts).toContain(
      'When is subdivision work included in the integrated-survey-area coordinate-monument tie requirement?',
    );
    expect(prompts).toContain(
      'When may a surveyor certify the correctness of a subdivision or other plan prepared under s.7 in an integrated survey area?',
    );
    for (const prompt of prompts) expect(prompt).not.toBe(EXAM_PREP_RECALL_PROMPT);
  });
});

describe('Exam Prep Recall Content V1 mock regression', () => {
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

  it('shows the authored prompt while answering and leaks no expected answer', async () => {
    const task = taskById.get('recall:B-EASE-02:1');
    expect(task).toBeTruthy();
    const learner = resolveExamPrepRecallLearnerContent(task!);
    const session = makeRecallOnlySession('recall:B-EASE-02:1', 'B-EASE-02');
    await renderIntoRoot(
      <ExamPrepMockActive
        session={session}
        autosaveDebounceMs={0}
        onNavigate={vi.fn()}
        onSaveSession={async () => undefined}
      />,
      root,
    );
    const text = bodyText();
    // Authored V1 question is asked …
    expect(text).toContain(learner.prompt);
    expect(text).toContain('two key prescriptive periods');
    // … while both the override and the canonical frozen answer stay hidden.
    expect(text).not.toContain(learner.expectedAnswer);
    expect(text).not.toContain(task!.expectedAnswer);
  });

  it('reveals the override expected answer in grading', async () => {
    const task = taskById.get('recall:B-EASE-02:1');
    expect(task).toBeTruthy();
    const learner = resolveExamPrepRecallLearnerContent(task!);
    const submitted = submitMock(
      makeRecallOnlySession('recall:B-EASE-02:1', 'B-EASE-02'),
      '2026-09-08T15:00:00.000Z',
    );
    expect(submitted.status).toBe('submitted');
    await renderIntoRoot(
      <ExamPrepMockGrading
        session={submitted}
        onSaveSession={async () => undefined}
        onOpenProvision={vi.fn()}
      />,
      root,
    );
    const text = bodyText();
    expect(text).toContain('Expected rule');
    expect(text).toContain(learner.expectedAnswer);
    expect(text).toContain('20 years protects qualifying enjoyment');
  });
});
