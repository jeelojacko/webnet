/** @vitest-environment jsdom */

// Exam Prep Locate — ephemeral picker objective-result flow.
//
// Opening the Locate picker while an item is active opens a NEW tab (popup
// stub) whose URL carries only the prompt + a session token. A same-origin
// pick message for that token is checked OBJECTIVELY against the frozen
// expected location: a correct pick persists `found` and advances the frozen
// sprint; a wrong pick persists `missed`; stale tokens and duplicate
// deliveries never double-apply; and the sprint's own tab never unmounts.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import { EXAM_PREP_PICKER_TOKEN_PARAM } from '../../src/study/examPrep/examPrepLocatePicker';
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

  const openPicker = async (): Promise<string> => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await clickButton('Open Locate Picker');
    expect(openSpy).toHaveBeenCalledTimes(1);
    const openedPath = openSpy.mock.calls[0]?.[0];
    expect(openedPath).toBeTruthy();
    expect(String(openedPath)).toContain('/study/library?');
    return pickerTokenFromOpenedUrl(String(openedPath));
  };

  const postPick = (token: string, documentId: string, sourceKey: string | null) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: 'study-locate-pick', token, documentId, sourceKey },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

  it('objective correct pick persists found and advances the frozen sprint', async () => {
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

    const token = await openPicker();
    expect(bodyText()).toContain('Locate picker open');

    // The picker URL leaks no expected location.
    const openedPath = (vi.spyOn(window, 'open').mock.calls[0]?.[0] as string) ?? '';
    expect(openedPath).not.toContain(first.expectedSourceKey);

    await postPick(token, first.expectedDocumentId, first.expectedSourceKey);
    // objective result: found, immutable attempt saved, sprint advanced
    expect(saved).toHaveLength(1);
    expect(saved[0]?.kind).toBe('locate');
    expect(saved[0]?.taskId).toBe(first.id);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('found');
    expect(bodyText()).toContain('Question 2 of 10');
    expect(bodyText()).not.toContain('Locate picker open');
  });

  it('objective wrong pick persists missed; stale tokens are ignored', async () => {
    const first = locateSession[0];
    const second = locateSession[1];
    if (!first || !second) throw new Error('expected frozen items');
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

    // Stale token from a picker of a PREVIOUS sprint/item is ignored.
    await postPick('locate-pick-stale', first.expectedDocumentId, first.expectedSourceKey);
    expect(saved).toHaveLength(0);
    expect(bodyText()).toContain('Question 1 of 10');

    const token = await openPicker();
    // wrong document for the first target => objective missed
    await postPick(token, 'doc-some-other-act', null);
    expect(saved).toHaveLength(1);
    if (saved[0]?.kind === 'locate') expect(saved[0].result).toBe('missed');
    expect(bodyText()).toContain('Question 2 of 10');

    // A late duplicate delivery of the same token must not double-apply.
    await postPick(token, 'doc-some-other-act', null);
    expect(saved).toHaveLength(1);
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

  it('surfaces a popup-blocked picker as an error and keeps the sprint running', async () => {
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
    expect(bodyText()).toContain('Could not open the Locate picker.');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Check Answer');
  });
});
