/** @vitest-environment jsdom */

// Study — centralized safe new-tab opening + active-session source chips.
//
// All "opens a Study page in a NEW tab" buttons go through studyWindow so the
// `noopener,noreferrer` popup contract and popup-block fallback stay
// single-sourced. The examPrepBits open-source button opts into new-tab
// behavior per caller (active Locate/Drill/Mock sessions) without changing
// in-SPA Learn links.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudyUrlNewTab, studyProvisionPath } from '../../src/study/studyWindow';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from '../../src/study/examPrep/components/examPrepBits';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

describe('studyWindow centralized new-tab helper', () => {
  it('opens with noopener,noreferrer and returns the window', () => {
    const fakeWindow = { closed: false } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
    const result = openStudyUrlNewTab('/study/library');
    expect(openSpy).toHaveBeenCalledWith('/study/library', '_blank', 'noopener,noreferrer');
    expect(result).toBe(fakeWindow);
    openSpy.mockRestore();
  });

  it('returns null when the browser blocks the popup so callers keep their error UX', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openStudyUrlNewTab('/study/library')).toBeNull();
    openSpy.mockRestore();
  });

  it('builds the same provision deep-link path the SPA navigation uses', () => {
    expect(studyProvisionPath('doc-surveys act', 'section:83')).toBe(
      `/study/document/${encodeURIComponent('doc-surveys act')}#${encodeURIComponent('section:83')}`,
    );
  });
});

describe('EXAM_PREP_OPEN_SOURCE_BUTTON new-tab opt-in', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  const click = (button: HTMLButtonElement): Promise<void> =>
    act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('opens the provision in a new tab when newTab is set, leaving in-SPA callers untouched', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const onOpenProvision = vi.fn();
    await renderIntoRoot(
      <EXAM_PREP_OPEN_SOURCE_BUTTON
        documentId="doc-surveys-act"
        sourceKey="section:83"
        label="s.83"
        onOpenProvision={onOpenProvision}
        newTab
      />,
      root,
    );
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.includes('s.83'),
    );
    expect(button).toBeTruthy();
    await click(button!);
    expect(openSpy).toHaveBeenCalledWith(
      `/study/document/${encodeURIComponent('doc-surveys-act')}#${encodeURIComponent('section:83')}`,
      '_blank',
      'noopener,noreferrer',
    );
    expect(onOpenProvision).not.toHaveBeenCalled();
  });

  it('defaults to in-SPA onOpenProvision navigation (Learn lists)', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const onOpenProvision = vi.fn();
    await renderIntoRoot(
      <EXAM_PREP_OPEN_SOURCE_BUTTON
        documentId="doc-one"
        sourceKey="section:2"
        label="s.2"
        onOpenProvision={onOpenProvision}
      />,
      root,
    );
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.includes('s.2'),
    );
    await click(button!);
    expect(onOpenProvision).toHaveBeenCalledWith('doc-one', 'section:2');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
