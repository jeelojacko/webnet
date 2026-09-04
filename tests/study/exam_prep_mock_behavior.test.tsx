// Exam Prep Mock — focused answering behavior (autosave/reload, timer expiry
// lock, submit confirmation, abandon) tested through the ExamPrepMockActive
// component with a serialized in-memory save harness.

/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepMockActive } from '../../src/study/examPrep/components/ExamPrepMockActive';
import { makeMockSession } from './exam_prep_mock_support';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

describe('Exam Prep mock focused answering behavior', () => {
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

  const renderActive = async (session: ExamPrepMockSession) => {
    await act(async () => {
      root?.render(
        <ExamPrepMockActive
          session={session}
          autosaveDebounceMs={0}
          onNavigate={vi.fn()}
          onSaveSession={async (next) => {
            saves.push(next);
          }}
        />,
      );
    });
  };

  const remountWith = async (session: ExamPrepMockSession) => {
    await act(async () => {
      root?.render(
        <ExamPrepMockActive
          session={session}
          autosaveDebounceMs={0}
          onNavigate={vi.fn()}
          onSaveSession={async (next) => {
            saves.push(next);
          }}
        />,
      );
    });
  };

  const waitFlush = async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  };

  const bodyText = () => document.body.textContent ?? '';

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
    await waitFlush();
  };

  const clickText = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === text,
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFlush();
  };

  const lastSaved = (): ExamPrepMockSession => {
    const last = saves.at(-1);
    if (!last) throw new Error('expected a saved session');
    return last;
  };

  it('autosaves a typed answer and reload restores it', async () => {
    const session = makeMockSession({ seed: 'autosave' });
    await renderActive(session);
    await typeAnswer('Temporary boundary evidence is persuasive.');
    const saved = lastSaved();
    expect(saved.responses[0]?.answer).toBe('Temporary boundary evidence is persuasive.');
    // reload: new component instance over the persisted session restores the answer
    await remountWith(saved);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe('Temporary boundary evidence is persuasive.');
  });

  it('persists the flag state and restores it after reload', async () => {
    const session = makeMockSession({ seed: 'flag' });
    await renderActive(session);
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFlush();
    const saved = lastSaved();
    expect(saved.responses[0]?.flagged).toBe(true);
    await remountWith(saved);
    const restored = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(restored?.checked).toBe(true);
  });

  it('persists the current question index via palette navigation and restores it', async () => {
    const session = makeMockSession({ seed: 'index' });
    await renderActive(session);
    expect(bodyText()).toContain('Question 1 of 30');
    await clickText('5');
    expect(bodyText()).toContain('Question 5 of 30');
    const saved = lastSaved();
    expect(saved.currentQuestionIndex).toBe(4);
    await remountWith(saved);
    expect(bodyText()).toContain('Question 5 of 30');
  });

  it('locks responses once the persisted deadline has passed (hard stop)', async () => {
    const session = makeMockSession({ seed: 'expired', startedAt: '2020-01-01T00:00:00.000Z' });
    await renderActive(session);
    const text = bodyText();
    expect(text).toContain('Time expired.');
    expect(text).toContain('Responses are locked.');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.disabled).toBe(true);
    expect(saves).toHaveLength(0);
    // expired answers cannot be edited
    const before = saves.length;
    await typeAnswer('should not persist');
    expect(saves).toHaveLength(before);
  });

  it('shows exact submit-confirmation counts then submits with editing locked', async () => {
    const session = makeMockSession({ seed: 'submit' });
    await renderActive(session);
    await typeAnswer('answer text');
    await clickText('Submit Mock Exam');
    const dialog = bodyText();
    expect(dialog).toContain('Submit Mock Exam?');
    expect(dialog).toContain('Answered: 1 / 30');
    expect(dialog).toContain('Unanswered: 29');
    expect(dialog).toContain('Flagged: 0');
    expect(dialog).toContain('You will not be able to edit responses after submission.');
    await clickText('Submit Exam');
    expect(lastSaved().status).toBe('submitted');
    expect(lastSaved().submittedAt).toBeTruthy();
    expect(lastSaved().responses[0]?.answer).toBe('answer text');
  });

  it('requires confirmation to abandon and persists the abandoned status', async () => {
    const session = makeMockSession({ seed: 'abandon' });
    await renderActive(session);
    await clickText('Abandon');
    const dialog = bodyText();
    expect(dialog).toContain('Abandon this mock exam?');
    expect(dialog).toContain(
      'Your saved responses will remain in history, but the exam will not receive a score.',
    );
    await clickText('Abandon Mock Exam');
    expect(lastSaved().status).toBe('abandoned');
    expect(lastSaved().abandonedAt).toBeTruthy();
  });
});
