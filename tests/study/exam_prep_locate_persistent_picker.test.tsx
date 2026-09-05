/** @vitest-environment jsdom */

// Exam Prep Locate — persistent picker tab per sprint.
//
// One picker tab serves the whole 10-question sprint: the first open carries
// sprint id + item token/prompt in the URL, the picker announces
// `picker-ready` on the sprint-scoped control channel, and later items arrive
// as `picker-context` messages with a FRESH token (no second window.open).
// Covers handshake/reuse/stale/duplicate/reopen/leak/security. The
// Library-side adoption (banner/search-clear/sent-notice) is covered by
// `study_library_picker_patch.test.tsx`.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import {
  EXAM_PREP_PICK_MESSAGE_TYPE,
  EXAM_PREP_PICKER_CONNECTION_TIMEOUT_MS,
  EXAM_PREP_PICKER_CONTEXT_TYPE,
  EXAM_PREP_PICKER_HEARTBEAT_INTERVAL_MS,
  EXAM_PREP_PICKER_READY_TYPE,
  EXAM_PREP_PICKER_SPRINT_ENDED_TYPE,
  buildExamPrepLocatePickerPath,
  createExamPrepLocatePickerSprintId,
  examPrepLocatePickerChannelName,
  examPrepLocatePickerControlChannelName,
  isExamPrepLocatePickerControlMessage,
  parseExamPrepLocatePickerSearch,
  postExamPrepLocatePickerControl,
  subscribeExamPrepLocatePickerControl,
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

const urlParamsOf = (openedPath: string): URLSearchParams => {
  const search = openedPath.slice(openedPath.indexOf('?'));
  return new URLSearchParams(search);
};

describe('persistent picker protocol', () => {
  let previousBroadcastChannel: unknown;

  beforeEach(() => {
    previousBroadcastChannel = installFakeBroadcastChannel();
  });

  afterEach(() => {
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
    vi.restoreAllMocks();
  });

  it('first-open URL carries sprint id + token + prompt, and parses back', () => {
    const sprintId = createExamPrepLocatePickerSprintId();
    const path = buildExamPrepLocatePickerPath('Find the Appeals Tribunal', 'locate-pick-abc', sprintId);
    expect(path).toContain('sprint=');
    const parsed = parseExamPrepLocatePickerSearch(path.slice(path.indexOf('?')));
    expect(parsed).toEqual({
      kind: 'locate',
      prompt: 'Find the Appeals Tribunal',
      token: 'locate-pick-abc',
      sprintId,
    });
  });

  it('legacy URLs without a sprint param still parse (sprintId null)', () => {
    const path = buildExamPrepLocatePickerPath('Find it', 'locate-pick-abc');
    const parsed = parseExamPrepLocatePickerSearch(path.slice(path.indexOf('?')));
    expect(parsed?.sprintId).toBeNull();
    expect(parsed?.token).toBe('locate-pick-abc');
  });

  it('control channel handshake: ready announces, context validates, wrong-sprint ignored', async () => {
    const sprintId = createExamPrepLocatePickerSprintId();
    const received: unknown[] = [];
    const cleanup = subscribeControlForTest(sprintId, received);
    try {
      // Wrong-sprint + malformed messages never surface.
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName('locate-sprint-other'), {
        type: EXAM_PREP_PICKER_READY_TYPE,
        sprintId: 'locate-sprint-other',
      });
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName(sprintId), {
        type: 'picker-bogus',
        sprintId,
      });
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName(sprintId), {
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: '',
        prompt: '',
      });
      expect(received).toHaveLength(0);

      expect(
        postExamPrepLocatePickerControl({ type: EXAM_PREP_PICKER_READY_TYPE, sprintId }),
      ).toBe('sent');
      expect(
        postExamPrepLocatePickerControl({
          type: EXAM_PREP_PICKER_CONTEXT_TYPE,
          sprintId,
          token: 'locate-pick-q2',
          prompt: 'Find the next target',
        }),
      ).toBe('sent');
      expect(received).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('heartbeat bounds are sane (interval < timeout)', () => {
    expect(EXAM_PREP_PICKER_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    expect(EXAM_PREP_PICKER_CONNECTION_TIMEOUT_MS).toBeGreaterThan(
      EXAM_PREP_PICKER_HEARTBEAT_INTERVAL_MS,
    );
  });

  it('control names/messages never carry expected answers', () => {
    const first = locateSession[0];
    if (!first) throw new Error('expected frozen item');
    const sprintId = createExamPrepLocatePickerSprintId();
    const path = buildExamPrepLocatePickerPath(first.prompt, 'locate-pick-abc', sprintId);
    expect(path).not.toContain(first.expectedDocumentId);
    if (first.expectedSourceKey) expect(path).not.toContain(first.expectedSourceKey);
    expect(examPrepLocatePickerControlChannelName(sprintId)).not.toContain(
      first.expectedDocumentId,
    );
    expect(
      isExamPrepLocatePickerControlMessage({
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: 'locate-pick-abc',
        prompt: first.prompt,
      }),
    ).toBe(true);
    // The prompt is the lookup question (already visible in the picker URL);
    // expected document/sourceKey have no field in any control message.
    expect(
      isExamPrepLocatePickerControlMessage({
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: 'locate-pick-abc',
        prompt: first.prompt,
        expectedDocumentId: first.expectedDocumentId,
      }),
    ).toBe(true); // shape guard passes; extra fields are simply never read
  });
});

const subscribeControlForTest = (sprintId: string, received: unknown[]) =>
  subscribeExamPrepLocatePickerControl(sprintId, (message) => {
    received.push(message);
  });

describe('sprint reuse over one picker tab', () => {
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

  it('Q2 reuse mints a fresh token + sends picker-context with no second window.open', async () => {
    const first = locateSession[0];
    const second = locateSession[1];
    if (!first?.expectedSourceKey || !second) throw new Error('expected frozen items');
    const saved: ExamPrepAttempt[] = [];
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const seenContexts: Array<{ token: string; prompt: string }> = [];
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
    await clickButton('Open Locate Picker');
    expect(openSpy).toHaveBeenCalledTimes(1);
    const params = urlParamsOf(String(openSpy.mock.calls[0]?.[0]));
    const sprintId = params.get('sprint');
    const tokenQ1 = params.get('token');
    expect(sprintId).toBeTruthy();
    expect(tokenQ1).toBeTruthy();

    // Picker tab announces ready; sprint resends current context.
    const controlName = examPrepLocatePickerControlChannelName(sprintId ?? '');
    const controlHandle: { cleanup: (() => void) | null } = { cleanup: null };
    await act(async () => {
      controlHandle.cleanup = subscribeExamPrepLocatePickerControl(sprintId ?? '', (message) => {
        if (message.type === EXAM_PREP_PICKER_CONTEXT_TYPE) {
          seenContexts.push({ token: message.token, prompt: message.prompt });
        }
      });
      publishToFakeBroadcastChannel(controlName, {
        type: EXAM_PREP_PICKER_READY_TYPE,
        sprintId,
      });
      await Promise.resolve();
    });

    // Q1 objective pick on the Q1 token channel, then Continue.
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(tokenQ1 ?? ''), {
        type: EXAM_PREP_PICK_MESSAGE_TYPE,
        token: tokenQ1,
        documentId: first.expectedDocumentId,
        sourceKey: first.expectedSourceKey,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bodyText()).toContain('Correct location');
    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    expect(bodyText()).toContain('Question 2 of 10');

    // Reuse: exactly one window.open total; a FRESH Q2 token was pushed.
    expect(openSpy).toHaveBeenCalledTimes(1);
    const q2Contexts = seenContexts.filter((entry) => entry.prompt === second.prompt);
    expect(q2Contexts).toHaveLength(1);
    expect(q2Contexts[0]?.token).toBeTruthy();
    expect(q2Contexts[0]?.token).not.toBe(tokenQ1);

    // Stale Q1-token delivery can never answer Q2.
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(tokenQ1 ?? ''), {
        type: EXAM_PREP_PICK_MESSAGE_TYPE,
        token: tokenQ1,
        documentId: second.expectedDocumentId,
        sourceKey: second.expectedSourceKey,
      });
      await Promise.resolve();
    });
    expect(saved).toHaveLength(1);
    expect(bodyText()).toContain('Question 2 of 10');
    expect(bodyText()).not.toContain('Correct location');
    expect(bodyText()).not.toContain('Not quite');

    // Duplicate Q2 delivery double-applies nothing: one pick → Continue once.
    const q2Token = q2Contexts[0]?.token ?? '';
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(q2Token), {
        type: EXAM_PREP_PICK_MESSAGE_TYPE,
        token: q2Token,
        documentId: second.expectedDocumentId,
        sourceKey: second.expectedSourceKey,
      });
      publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(q2Token), {
        type: EXAM_PREP_PICK_MESSAGE_TYPE,
        token: q2Token,
        documentId: second.expectedDocumentId,
        sourceKey: second.expectedSourceKey,
      });
      await Promise.resolve();
    });
    expect(bodyText()).toContain('Question 2 of 10');
    await clickButton('Continue');
    expect(saved).toHaveLength(2);
    expect(bodyText()).toContain('Question 3 of 10');
    if (controlHandle.cleanup) controlHandle.cleanup();
  });

  it('sprint end posts picker-sprint-ended and closes pick channels', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={async () => undefined}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    await clickButton('Start Locate Sprint');
    await clickButton('Open Locate Picker');
    const params = urlParamsOf(String(openSpy.mock.calls[0]?.[0]));
    const sprintId = params.get('sprint') ?? '';
    expect(sprintId).toBeTruthy();
    const ended: unknown[] = [];
    const endHandle: { cleanup: (() => void) | null } = { cleanup: null };
    await act(async () => {
      endHandle.cleanup = subscribeExamPrepLocatePickerControl(sprintId, (message) => {
        if (message.type === EXAM_PREP_PICKER_SPRINT_ENDED_TYPE) ended.push(message);
      });
      await Promise.resolve();
    });
    // Answer all 10 manually to end the sprint.
    for (let question = 0; question < 10; question += 1) {
      await clickButton('Check Answer');
      await clickButton('Found it');
    }
    expect(bodyText()).toContain('Locate Sprint complete');
    expect(ended).toHaveLength(1);
    if (endHandle.cleanup) endHandle.cleanup();
    expect(openFakeBroadcastChannelNames()).toEqual([]);
  });
});
