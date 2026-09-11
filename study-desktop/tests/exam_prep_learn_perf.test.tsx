/** @vitest-environment jsdom */

// Learn perf: all 133 units stay mounted (filters, toggles, anchors, hash
// targets keep working) while offscreen cards skip layout/paint via CSS
// content-visibility.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepLearnView } from '../src/examPrep/components/ExamPrepLearn';
import { EXAM_PREP_LEARN_UNITS } from '../src/examPrep/examPrepRecallTasks';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

const cards = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('section[id^="exam-unit-"]'));

describe('ExamPrepLearnView perf containment', () => {
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
    window.location.hash = '';
  });

  it('renders all 133 units with content-visibility containment', async () => {
    await renderIntoRoot(
      <ExamPrepLearnView
        unitProgress={[]}
        onOpenProvision={vi.fn()}
        onToggleUnitStudied={vi.fn()}
      />,
      root,
    );

    expect(EXAM_PREP_LEARN_UNITS).toHaveLength(133);
    const rendered = cards();
    expect(rendered).toHaveLength(133);
    for (const card of rendered) {
      expect(card.style.contentVisibility).toBe('auto');
    }
  });

  it('preserves tier filters, studied toggles, and source anchors', async () => {
    const onToggleUnitStudied = vi.fn();
    const onOpenProvision = vi.fn();
    await renderIntoRoot(
      <ExamPrepLearnView
        unitProgress={[]}
        onOpenProvision={onOpenProvision}
        onToggleUnitStudied={onToggleUnitStudied}
      />,
      root,
    );

    // Tier filter narrows the mounted set without losing units overall.
    const tierA = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Tier A'),
    );
    await act(async () => {
      tierA?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const tierACount = EXAM_PREP_LEARN_UNITS.filter((unit) => unit.tier === 'A').length;
    expect(cards()).toHaveLength(tierACount);

    // Studied toggle still fires for a visible card.
    const toggle = cards()[0]?.querySelector('button[aria-pressed]');
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleUnitStudied).toHaveBeenCalledTimes(1);

    // Source anchors stay individually openable under containment.
    const openButton = document.querySelector<HTMLButtonElement>('button[title^="Open "]');
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenProvision).toHaveBeenCalledTimes(1);
  });
});
