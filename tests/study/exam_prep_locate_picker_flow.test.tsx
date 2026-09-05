/** @vitest-environment jsdom */

// Exam Prep Locate — ephemeral picker objective-result flow.
//
// Opening the Locate picker while an item is active opens a NEW tab (popup
// stub) whose URL carries only the prompt + a session token. A pick posted on
// the token-scoped BroadcastChannel is checked OBJECTIVELY against the frozen
// expected location and shown as feedback BEFORE anything persists: the
// learner presses Continue to save the immutable attempt (correct → `found`,
// incorrect → `missed`) and advance. Stale tokens, malformed messages, and
// duplicate deliveries never double-apply; the channel closes after one valid
// pick; save failures keep the feedback screen for retry; and the sprint's
// own tab never unmounts. Manual Check Answer → Found it / Missed it remains
// the always-available fallback.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import { EXAM_PREP_LOCATE_TASKS } from '../../src/study/examPrep/examPrepLocateTasks';
import { buildLocateAttempt } from '../../src/study/examPrep/examPrepAttemptBuilders';
import {
  EXAM_PREP_PICK_MESSAGE_TYPE,
  EXAM_PREP_PICKER_TOKEN_PARAM,
  examPrepLocatePickerChannelName,
} from '../../src/study/examPrep/examPrepLocatePicker';
import {
  installFakeBroadcastChannel,
  openFakeBroadcastChannelNames,
  publishToFakeBroadcastChannel,
  restoreGlobalBroadcastChannel,
} from './exam_prep_broadcast_channel_support';
import type { ExamPrepAttempt } from '../../src/study/examPrep/examPrepTypes';

const locateSession = buildExamPrepLocateQueue([]);
if (locateSession.length !== 10) throw new Error('expected 10-item frozen locate sprint');

const pickerTokenFromOpenedUrl = (openedPath: string): string => {
  const search = openedPath.slice(openedPath.indexOf('?'));
  const token = new URLSearchParams(search).get(EXAM_PREP_PICKER_TOKEN_PARAM);
  if (!token) throw new Error(`expected picker token in ${openedPath}`);
  return token;
};

describe('Exam Prep Locate picker flow', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let previousBroadcastChannel: unknown;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previousBroadcastChannel = installFakeBroadcastChannel();
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
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

  const openPicker = async (): Promise<{ token: string; openedPath: string }> => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await clickButton('Open Locate Picker');
    expect(openSpy).toHaveBeenCalledTimes(1);
    const openedPath = openSpy.mock.calls[0]?.[0];
    expect(openedPath).toBeTruthy();
    expect(String(openedPath)).toContain('/study/library?');
    return { token: pickerTokenFromOpenedUrl(String(openedPath)), openedPath: String(openedPath) };
  };

  const postPick = (
    token: string,
    documentId: string,
    sourceKey: string | null,
    messageType: string = EXAM_PREP_PICK_MESSAGE_TYPE,
  ) =>
    act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(token), {
        type: messageType,
        token,
        documentId,
        sourceKey,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

  const continueButton = (): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith('Continue'),
    );

  it('pinned correct pick: feedback shown, no persistence, Continue saves found and advances', async () => {
    const first = locateSession[0];
    if (!first || !first.expectedSourceKey)
      throw new Error('expected a pinned first locate target');
    const saved: ExamPrepAttempt[] = [];
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={async (attempt) => {
          saved.push(attempt);
        }}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    expect(bodyText()).toContain('Question 1 of 10');

    const { token, openedPath } = await openPicker();
    expect(bodyText()).toContain('Locate picker opened in a new tab.');

    // Leak guard: the picker URL and channel carry no expected location.
    expect(openedPath).not.toContain(first.expectedSourceKey);
    expect(openedPath).not.toContain(first.expectedDocumentId);
    expect(examPrepLocatePickerChannelName(token)).not.toContain(first.expectedSourceKey);
    expect(examPrepLocatePickerChannelName(token)).not.toContain(first.expectedDocumentId);

    await postPick(token, first.expectedDocumentId, first.expectedSourceKey);

    // Feedback pauses BEFORE persistence/advance.
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Your selection');
    expect(bodyText()).toContain('Correct location');
    expect(bodyText()).toContain('Expected location');
    expect(saved).toHaveLength(0);
    expect(continueButton()).toBeTruthy();
    // The item pick channel closes; the sprint control channel remains alive
    // for the persistent picker heartbeat/context handshake.
    expect(openFakeBroadcastChannelNames()).toEqual([
      expect.stringMatching(/^webnet-study-locate-picker-control:/),
    ]);

    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.kind).toBe('locate');
    expect(saved[0]?.taskId).toBe(first.id);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('found');
    expect(bodyText()).toContain('Question 2 of 10');
    expect(bodyText()).not.toContain('Your selection');
    expect(bodyText()).not.toContain('Locate picker opened in a new tab.');
  });

  it('pinned wrong pick: Not quite with selection + expected shown; Continue persists missed', async () => {
    const first = locateSession[0];
    if (!first || !first.expectedSourceKey)
      throw new Error('expected a pinned first locate target');
    const saved: ExamPrepAttempt[] = [];
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={async (attempt) => {
          saved.push(attempt);
        }}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');

    // A stale token from a previous sprint/item is ignored entirely.
    await postPick('locate-pick-stale', first.expectedDocumentId, first.expectedSourceKey);
    expect(saved).toHaveLength(0);
    expect(bodyText()).toContain('Question 1 of 10');

    const { token } = await openPicker();
    // wrong document for the first target => objective missed
    await postPick(token, 'doc-some-other-act', null);

    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Your selection');
    expect(bodyText()).toContain('Not quite');
    expect(bodyText()).toContain('Expected location');
    expect(saved).toHaveLength(0);

    // A duplicate delivery of the same token must not double-apply or advance.
    await postPick(token, 'doc-some-other-act', null);
    expect(saved).toHaveLength(0);
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Not quite');

    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('missed');
    expect(bodyText()).toContain('Question 2 of 10');
  });

  it('document-level target: the right document counts correct with or without a provision pin', async () => {
    const documentLevel = EXAM_PREP_LOCATE_TASKS.find((task) => task.expectedSourceKey === null);
    if (!documentLevel) throw new Error('expected a document-level locate target');
    // Give the target a missed attempt so the frozen queue ranks it first.
    const attempts = [
      buildLocateAttempt({
        attemptId: `locate-attempt-${documentLevel.id}-doc-level`,
        task: documentLevel,
        result: 'missed',
        elapsedSeconds: 4,
        completedAt: '2026-09-08T10:00:00.000Z',
      }),
    ];
    const saved: ExamPrepAttempt[] = [];
    await render(
      <ExamPrepLocateView
        attempts={attempts}
        onSaveExamPrepAttempt={async (attempt) => {
          saved.push(attempt);
        }}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    expect(bodyText()).toContain('Question 1 of 10');

    const { token } = await openPicker();
    // Correct document with a document-level selection counts correct…
    await postPick(token, documentLevel.expectedDocumentId, null);
    expect(bodyText()).toContain('Correct location');
    expect(saved).toHaveLength(0);
    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('found');
    expect(bodyText()).toContain('Question 2 of 10');
  });

  it('save failure after Continue keeps the feedback screen; retry succeeds exactly once', async () => {
    const first = locateSession[0];
    if (!first || !first.expectedSourceKey)
      throw new Error('expected a pinned first locate target');
    let calls = 0;
    const saved: ExamPrepAttempt[] = [];
    const saveImpl = async (attempt: ExamPrepAttempt): Promise<void> => {
      calls += 1;
      if (calls === 1) throw new Error('storage full');
      saved.push(attempt);
    };
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={saveImpl}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    const { token } = await openPicker();
    await postPick(token, first.expectedDocumentId, first.expectedSourceKey);

    expect(bodyText()).toContain('Correct location');
    await clickButton('Continue');

    // Persistence rejected: same question, feedback + expected stay visible.
    expect(bodyText()).toContain('storage full');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Your selection');
    expect(bodyText()).toContain('Correct location');
    expect(bodyText()).toContain('Expected location');
    expect(saved).toHaveLength(0);

    // Retry succeeds and advances exactly once (no duplicate attempt).
    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('found');
    expect(bodyText()).toContain('Question 2 of 10');
  });

  it('keeps the manual Check Answer fallback when no picker is open', async () => {
    const first = locateSession[0];
    if (!first) throw new Error('expected frozen item');
    const saved: ExamPrepAttempt[] = [];
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={async (attempt) => {
          saved.push(attempt);
        }}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    expect(bodyText()).toContain('Open Locate Picker');
    expect(bodyText()).toContain('Open Statute Library');
    await clickButton('Check Answer');
    expect(bodyText()).toContain('Expected location');
    await clickButton('Missed it');
    expect(saved).toHaveLength(1);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('missed');
    expect(bodyText()).toContain('Question 2 of 10');
  });

  it('does not treat a null WindowProxy as a popup failure and keeps the sprint running', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={vi.fn(async () => undefined)}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    await clickButton('Open Locate Picker');
    // noopener,noreferrer legitimately yields a null WindowProxy — this is
    // NOT a failure: no error banner, sprint still on question 1.
    expect(bodyText()).not.toContain('Could not open');
    expect(bodyText()).toContain('Locate picker opened in a new tab.');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Check Answer');
  });
});
