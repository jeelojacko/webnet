/** @vitest-environment jsdom */

// Study — centralized safe new-tab opening + active-session source chips.
//
// All "opens a Study page in a NEW tab" buttons go through studyWindow so the
// `noopener,noreferrer` popup contract stays single-sourced. With noopener
// semantics the browser legitimately returns `null` from `window.open()` even
// when the tab opened, so callers must NOT treat a null WindowProxy as a
// popup failure — the helper reports only genuine synchronous exceptions.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudyUrlNewTab, openProvisionNewTab, studyProvisionPath } from '../../src/study/studyWindow';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from '../../src/study/examPrep/components/examPrepBits';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

describe('studyWindow centralized new-tab helper', () => {
  it('attempts window.open with _blank + noopener,noreferrer and reports attempted', () => {
    const fakeWindow = { closed: false } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
    const result = openStudyUrlNewTab('/study/library');
    expect(openSpy).toHaveBeenCalledWith('/study/library', '_blank', 'noopener,noreferrer');
    expect(result).toEqual({ attempted: true });
    openSpy.mockRestore();
  });

  it('does NOT treat a null WindowProxy as a popup failure (noopener gives no handle)', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    // null is the NORMAL noopener outcome; it must not be surfaced as failure.
    expect(openStudyUrlNewTab('/study/library')).toEqual({ attempted: true });
    expect(openSpy).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });

  it('surfaces only a genuine synchronous exception as a failure', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked by policy');
    });
    const result = openStudyUrlNewTab('/study/library');
    expect(result.attempted).toBe(false);
    if (!result.attempted) expect(result.error.message).toBe('blocked by policy');
    openSpy.mockRestore();
  });

  it('builds the same provision deep-link path the SPA navigation uses', () => {
    expect(studyProvisionPath('doc-surveys act', 'section:83')).toBe(
      `/study/document/${encodeURIComponent('doc-surveys act')}#${encodeURIComponent('section:83')}`,
    );
  });

  it('openProvisionNewTab keeps noopener,noreferrer on provision deep links', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openProvisionNewTab('doc-surveys act', 'section:83')).toEqual({ attempted: true });
    expect(openSpy).toHaveBeenCalledWith(
      `/study/document/${encodeURIComponent('doc-surveys act')}#${encodeURIComponent('section:83')}`,
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
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
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
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
