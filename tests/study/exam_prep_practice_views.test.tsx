/** @vitest-environment jsdom */

// Exam Prep Phase 2 — Recognition and Locate sprint view behavior.
//
// Component-level coverage over the frozen-sprint views: no answer leakage
// before Reveal / Check Answer, a session frozen at Start that parent
// attempt-snapshot updates never reshape, persistence failures that keep the
// revealed card + typed answer + question index for retry, and completion
// with an explicit Start Another gate.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepRecognitionView } from '../../src/study/examPrep/components/ExamPrepRecognition';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import { buildExamPrepRecognitionQueue } from '../../src/study/examPrep/examPrepRecognitionQueue';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import { EXAM_PREP_DOCUMENT_TITLES } from '../../src/study/examPrep/examPrepDocTitles';
import { appendImmutableAttempt } from '../../src/study/examPrep/examPrepStateUpdates';
import type { ExamPrepAttempt } from '../../src/study/examPrep/examPrepTypes';
import {
  makeLocateAttempt,
  makeRecognitionAttempt,
} from './exam_prep_test_support';

const recognitionSession = buildExamPrepRecognitionQueue([]);
const locateSession = buildExamPrepLocateQueue([]);
if (recognitionSession.length !== 10 || locateSession.length !== 10)
  throw new Error('expected 10-item frozen sprints');

const firstRecognitionDocTitle = (): string =>
  recognitionSession[0]?.expectedDocumentIds
    .map((documentId) => EXAM_PREP_DOCUMENT_TITLES[documentId] ?? documentId)
    .join(', ') ?? '';

describe('Exam Prep Recognition sprint view', () => {
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

  const revealedTaskId = (): string => {
    const mono = document.querySelector('span.font-mono');
    return mono?.textContent?.trim() ?? '';
  };

  const typeAnswer = async (text: string) => {
    const textarea = document.querySelector('textarea');
    expect(textarea).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(textarea, text);
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const renderView = (attempts: ExamPrepAttempt[], onSave: (_a: ExamPrepAttempt) => Promise<void>) =>
    render(
      <ExamPrepRecognitionView
        attempts={attempts}
        onSaveExamPrepAttempt={onSave}
        onNavigate={vi.fn()}
      />,
    );

  it('does not leak the expected topic before Reveal and shows it after', async () => {
    const first = recognitionSession[0];
    if (!first) throw new Error('expected recognition task');
    const docTitle = firstRecognitionDocTitle();
    await renderView([], vi.fn(async () => undefined));

    expect(bodyText()).toContain('Start Recognition Sprint');
    await clickButton('Start Recognition Sprint');

    // pre-reveal: only the frozen cue is visible (the footer hint does use
    // the words “Expected topic”, so identity must come from id/title/sources)
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain(first.cue);
    expect(bodyText()).not.toContain('Likely sources');
    expect(bodyText()).not.toContain(first.id);
    expect(bodyText()).not.toContain(first.unitTitle);
    expect(bodyText()).not.toContain(docTitle);

    await typeAnswer('the surveying statute');
    await clickButton('Reveal');

    // post-reveal: expected id/title and sources appear, answer preserved
    expect(bodyText()).toContain('Expected topic');
    expect(revealedTaskId()).toBe(first.id);
    expect(bodyText()).toContain(first.unitTitle);
    expect(bodyText()).toContain(docTitle);
    expect(bodyText()).toContain('Your answer');
    expect(bodyText()).toContain('the surveying statute');
    expect(bodyText()).toContain('Got it');
    expect(bodyText()).toContain('Missed it');
  });

  it('freezes the sprint at Start; parent attempts never reshape it and completion gates Start Another', async () => {
    const seen: string[] = [];
    const attemptsRef: { current: ExamPrepAttempt[] } = { current: [] };
    const saveImpl = async (attempt: ExamPrepAttempt) => {
      seen.push(attempt.taskId);
      attemptsRef.current = appendImmutableAttempt(attemptsRef.current, attempt);
    };
    const renderViewStep = () => renderView(attemptsRef.current, saveImpl);

    await renderViewStep();
    await clickButton('Start Recognition Sprint');
    expect(bodyText()).toContain('Question 1 of 10');

    for (let step = 0; step < 10; step += 1) {
      const expected = recognitionSession[step];
      if (!expected) throw new Error('expected frozen item');
      expect(bodyText()).toContain(`Question ${step + 1} of 10`);
      await clickButton('Reveal');
      // a live recomputed queue would re-rank the just-missed leader to the
      // front; the frozen session must keep showing the original order.
      expect(revealedTaskId()).toBe(expected.id);
      await clickButton('Missed it');
      // simulate an unrelated external attempt landing mid-session
      if (step === 3 || step === 7) {
        const external = makeRecognitionAttempt({
          id: `external-${step}`,
          taskId: 'recognition:A-NBLS-01:2',
          unitId: 'A-NBLS-01',
          result: 'missed',
        });
        attemptsRef.current = appendImmutableAttempt(attemptsRef.current, external);
      }
      await renderViewStep();
    }

    expect(seen).toHaveLength(10);
    expect(bodyText()).toContain('Recognition Sprint complete');
    expect(bodyText()).toContain('Correct: 0 / 10');
    expect(bodyText()).toContain('Start Another Sprint');
    expect(bodyText()).toContain('Browse Learn units');

    await clickButton('Start Another Sprint');
    expect(bodyText()).toContain('Question 1 of 10');
  });

  it('keeps the revealed card, typed answer, and index when persistence fails, then advances on retry', async () => {
    const first = recognitionSession[0];
    const second = recognitionSession[1];
    if (!first || !second) throw new Error('expected frozen items');
    let calls = 0;
    // a non-Error rejection exercises the generic fallback message
    const saveImpl = async (): Promise<void> => {
      calls += 1;
      if (calls === 1) throw 'quota exceeded';
    };
    await renderView([], saveImpl);
    await clickButton('Start Recognition Sprint');
    expect(bodyText()).toContain(first.cue);
    await typeAnswer('my answer');
    await clickButton('Reveal');
    expect(revealedTaskId()).toBe(first.id);

    await clickButton('Missed it');
    // persistence failure: nothing advanced, card stays revealed with answer
    expect(bodyText()).toContain('The recognition result could not be saved. Try again.');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(revealedTaskId()).toBe(first.id);
    expect(bodyText()).toContain('Expected topic');
    expect(bodyText()).toContain('Your answer');
    expect(bodyText()).toContain('my answer');

    await clickButton('Missed it');
    expect(bodyText()).toContain('Question 2 of 10');
    await clickButton('Reveal');
    expect(revealedTaskId()).toBe(second.id);
  });
});

describe('Exam Prep Locate sprint view', () => {
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

  const promptText = (): string => {
    const prompt = document.querySelector('.locate-prompt');
    return prompt?.textContent?.trim() ?? '';
  };

  const renderView = (
    attempts: ExamPrepAttempt[],
    onSave: (_a: ExamPrepAttempt) => Promise<void>,
  ) =>
    render(
      <ExamPrepLocateView
        attempts={attempts}
        onSaveExamPrepAttempt={onSave}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

  it('does not leak the expected location before Check Answer and shows it after', async () => {
    const first = locateSession[0];
    if (!first) throw new Error('expected locate task');
    const docTitle = EXAM_PREP_DOCUMENT_TITLES[first.expectedDocumentId] ?? first.expectedDocumentId;
    await renderView([], vi.fn(async () => undefined));

    expect(bodyText()).toContain('Start Locate Sprint');
    await clickButton('Start Locate Sprint');

    // pre-check: only the frozen lookup prompt is visible
    expect(bodyText()).toContain('Question 1 of 10');
    expect(promptText()).toBe(first.prompt);
    expect(bodyText()).not.toContain('Expected location');
    expect(bodyText()).not.toContain(docTitle);
    expect(bodyText()).not.toContain('Open exact provision');

    await clickButton('Check Answer');

    // post-check: expected document and pinned provision label appear
    expect(bodyText()).toContain('Expected location');
    expect(bodyText()).toContain(docTitle);
    expect(bodyText()).toContain('Found it');
    expect(bodyText()).toContain('Missed it');
  });

  it('freezes the sprint at Start; parent attempts never reshape it and completion gates Start Another', async () => {
    const seen: string[] = [];
    const attemptsRef: { current: ExamPrepAttempt[] } = { current: [] };
    const saveImpl = async (attempt: ExamPrepAttempt) => {
      seen.push(attempt.taskId);
      attemptsRef.current = appendImmutableAttempt(attemptsRef.current, attempt);
    };
    const renderViewStep = () => renderView(attemptsRef.current, saveImpl);

    await renderViewStep();
    await clickButton('Start Locate Sprint');
    expect(bodyText()).toContain('Question 1 of 10');

    for (let step = 0; step < 10; step += 1) {
      const expected = locateSession[step];
      if (!expected) throw new Error('expected frozen item');
      expect(bodyText()).toContain(`Question ${step + 1} of 10`);
      // a live recomputed queue would re-rank the just-missed leader to the
      // front; the frozen session must keep showing the original prompt.
      expect(promptText()).toBe(expected.prompt);
      await clickButton('Check Answer');
      await clickButton('Missed it');
      if (step === 3 || step === 7) {
        const external = makeLocateAttempt({
          id: `external-${step}`,
          taskId: 'locate:A-NBLS-02:2',
          unitId: 'A-NBLS-02',
          result: 'missed',
        });
        attemptsRef.current = appendImmutableAttempt(attemptsRef.current, external);
      }
      await renderViewStep();
    }

    expect(seen).toHaveLength(10);
    expect(bodyText()).toContain('Locate Sprint complete');
    expect(bodyText()).toContain('Found: 0 / 10');
    expect(bodyText()).toContain('Start Another Sprint');
    expect(bodyText()).toContain('Browse Learn units');

    await clickButton('Start Another Sprint');
    expect(bodyText()).toContain('Question 1 of 10');
  });

  it('keeps the checked reveal and index when persistence fails, then advances on retry', async () => {
    const first = locateSession[0];
    const second = locateSession[1];
    if (!first || !second) throw new Error('expected locate tasks');
    const docTitle = EXAM_PREP_DOCUMENT_TITLES[first.expectedDocumentId] ?? first.expectedDocumentId;
    let calls = 0;
    // a non-Error rejection exercises the generic fallback message
    const saveImpl = async (): Promise<void> => {
      calls += 1;
      if (calls === 1) throw 'offline';
    };
    await renderView([], saveImpl);
    await clickButton('Start Locate Sprint');
    expect(promptText()).toBe(first.prompt);
    await clickButton('Check Answer');
    expect(bodyText()).toContain('Expected location');
    expect(bodyText()).toContain(docTitle);

    await clickButton('Found it');
    // persistence failure: nothing advanced, reveal stays checked on item 1
    expect(bodyText()).toContain('The locate result could not be saved. Try again.');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Expected location');
    expect(bodyText()).toContain(docTitle);

    await clickButton('Missed it');
    expect(bodyText()).toContain('Question 2 of 10');
    expect(promptText()).toBe(second.prompt);
  });
});
