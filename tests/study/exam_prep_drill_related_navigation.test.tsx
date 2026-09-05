/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamDrillCard } from '../../src/study/examPrep/components/examDrillCard';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';

describe('active drill related-unit navigation', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    vi.restoreAllMocks();
  });

  it('opens related Learn units in a new tab without resetting revealed local state', async () => {
    const unit = EXAM_PREP_MANIFEST.units.find((entry) => entry.id === 'DRILL-01');
    expect(unit?.drill).toBeTruthy();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => {
      root?.render(<ExamDrillCard unit={unit!} onOpenProvision={vi.fn()} />);
    });
    const button = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((entry) =>
        entry.textContent?.trim().startsWith(label),
      );
    await act(async () => button('Start')?.click());
    const answer = 'typed answer stays';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(textarea, answer);
      (textarea as HTMLTextAreaElement & { _valueTracker?: { setValue: (_value: string) => void } })._valueTracker?.setValue('');
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: answer,
      }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      button('Reveal')?.click();
    });
    expect(document.body.textContent).toContain('Time frozen:');
    const related = button('A-REG-03');
    expect(related).toBeTruthy();
    await act(async () => related?.click());
    expect(open).toHaveBeenCalledWith('/study/learn#exam-unit-A-REG-03', '_blank', 'noopener,noreferrer');
    expect(document.body.textContent).toContain('Time frozen:');
  });
});
