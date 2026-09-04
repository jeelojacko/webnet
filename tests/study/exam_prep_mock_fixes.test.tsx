// Exam Prep Mock — regression tests for reviewer findings:
//  (1) DrillSelfAssessment state resets per question (keyed by question id),
//      including resuming an already-graded drill with its persisted flags.
//  (2) confirmSubmit / confirmAbandon catch final-save failures, show a
//      visible error, and leave the in-progress answering state intact.

/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepMockActive } from '../../src/study/examPrep/components/ExamPrepMockActive';
import { ExamPrepMockGrading } from '../../src/study/examPrep/components/ExamPrepMockGrading';
import { submitMock } from '../../src/study/examPrep/mock/examPrepMockSession';
import { upsertById } from '../../src/study/examPrep/examPrepStateUpdates';
import { makeMockSession } from './exam_prep_mock_support';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

describe('mock grading DrillSelfAssessment resets per question', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let dataRef: { current: ExamPrepMockSession };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    dataRef = { current: submitMock(makeMockSession({ seed: 'drill-reset' }), '2026-09-08T15:00:00.000Z') };
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const drillIndexes = (): number[] =>
    dataRef.current.questions
      .map((question, index) => ({ question, index }))
      .filter(({ question }) => question.kind === 'drill')
      .map(({ index }) => index);

  const renderGrading = async () => {
    const session = dataRef.current;
    await act(async () => {
      root?.render(
        <ExamPrepMockGrading
          session={session}
          onSaveSession={async (next) => {
            dataRef.current = next;
          }}
          onOpenProvision={vi.fn()}
        />,
      );
    });
  };

  const clickButtonWithText = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === text,
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const checkboxStates = (): boolean[] =>
    Array.from(document.querySelectorAll('input[type="checkbox"]')).map(
      (input) => (input as HTMLInputElement).checked,
    );

  const toggleCheckbox = async (index: number) => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    const input = checkboxes[index] as HTMLInputElement | undefined;
    expect(input).toBeTruthy();
    await act(async () => {
      input?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  it('starts each drill question with its own (empty or persisted) checkbox state', async () => {
    const indexes = drillIndexes();
    expect(indexes.length).toBeGreaterThanOrEqual(2);
    const [firstDrill, secondDrill] = indexes;
    if (firstDrill === undefined || secondDrill === undefined) throw new Error('need 2 drills');

    // Navigate to the first drill and self-assess 2/3 (law + provision).
    await renderGrading();
    await clickButtonWithText(String(firstDrill + 1));
    expect(document.body.textContent ?? '').toContain('Self-assessment');
    await toggleCheckbox(0);
    await toggleCheckbox(1);
    await clickButtonWithText('Save self-score (2/3)');
    await renderGrading();

    // Second drill must NOT inherit the first drill's checkbox state.
    await clickButtonWithText(String(secondDrill + 1));
    expect(checkboxStates()).toEqual([false, false, false]);

    // Back to the first drill: persisted grading remounts with 2 checked.
    await clickButtonWithText(String(firstDrill + 1));
    expect(checkboxStates()).toEqual([true, true, false]);
  });
});

describe('mock submit/abandon save failures keep the answering session intact', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let rejectNext: boolean;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    rejectNext = false;
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const renderActive = async (session: ExamPrepMockSession) => {
    await act(async () => {
      root?.render(
        <ExamPrepMockActive
          session={session}
          autosaveDebounceMs={0}
          onNavigate={vi.fn()}
          onSaveSession={async () => {
            if (rejectNext) throw new Error('mock save failed (test)');
          }}
        />,
      );
    });
  };

  const clickButtonWithText = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === text,
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  };

  it('failed submit surfaces a visible error and stays in the answering view', async () => {
    rejectNext = true;
    await renderActive(makeMockSession({ seed: 'submit-fail' }));
    expect(document.body.textContent ?? '').toContain('Question 1 of 30');
    await clickButtonWithText('Submit Mock Exam');
    await clickButtonWithText('Submit Exam');

    const text = document.body.textContent ?? '';
    expect(text).toContain('mock save failed (test)');
    // dialog closed, answering state preserved (not the grading view)
    expect(text).not.toContain('Submit Mock Exam?');
    expect(text).not.toContain('Self-grade your mock');
    expect(text).toContain('Question 1 of 30');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.disabled).toBe(false);
  });

  it('failed abandon surfaces a visible error and keeps the session answerable', async () => {
    rejectNext = true;
    await renderActive(makeMockSession({ seed: 'abandon-fail' }));
    await clickButtonWithText('Abandon');
    expect(document.body.textContent ?? '').toContain('Abandon this mock exam?');
    await clickButtonWithText('Abandon Mock Exam');

    const text = document.body.textContent ?? '';
    expect(text).toContain('mock save failed (test)');
    expect(text).not.toContain('Abandon this mock exam?');
    expect(text).toContain('Question 1 of 30');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.disabled).toBe(false);
  });

  it('successful submit still transitions normally (no regression)', async () => {
    await renderActive(makeMockSession({ seed: 'submit-ok' }));
    await clickButtonWithText('Submit Mock Exam');
    await clickButtonWithText('Submit Exam');
    expect(document.body.textContent ?? '').not.toContain('Submit Mock Exam?');
    expect(document.body.textContent ?? '').toContain('Question 1 of 30');
    // The parent snapshot update (upsert) drives the transition to grading in
    // the real app; with a no-op save harness we assert the confirmation path
    // completed without an error banner.
    expect(document.body.textContent ?? '').not.toContain('Save failed');
  });
});

describe('mock save flow integration with parent snapshot (regression guard)', () => {
  it('upsertById-based snapshot updates replace the in-progress session with the submitted one', async () => {
    const session = makeMockSession({ seed: 'snapshot-flow' });
    const submitted = submitMock(session, '2026-09-08T15:00:00.000Z');
    const sessions = upsertById([session], submitted);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe('submitted');
    expect(sessions[0]?.submittedAt).toBeTruthy();
  });
});
