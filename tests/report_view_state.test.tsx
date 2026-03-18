/** @vitest-environment jsdom */

import React, { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useReportViewState } from '../src/hooks/useReportViewState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleRows = Array.from({ length: 150 }, (_, index) => index);

const HookHarness: React.FC<{
  resultVersion: number;
  excludedVersion: number;
}> = ({ resultVersion, excludedVersion }) => {
  const result = useMemo(() => ({ resultVersion }), [resultVersion]);
  const excludedIds = useMemo(() => new Set([excludedVersion]), [excludedVersion]);
  const state = useReportViewState({
    result,
    excludedIds,
  });

  return (
    <div>
      <div data-testid="normalized-query">{state.normalizedReportFilterQuery}</div>
      <div data-testid="visible-count">{state.visibleRowsFor('sample', sampleRows).length}</div>
      <div data-testid="collapsed-state">
        {state.isSectionCollapsed('angles-ts') ? 'collapsed' : 'expanded'}
      </div>
      <div data-testid="pin-count">{state.pinnedDetailSections.length}</div>
      <button onClick={() => state.setReportFilterQuery('  P100  ')}>set filter</button>
      <button onClick={() => state.showMoreRows('sample')}>show more</button>
      <button onClick={() => state.toggleDetailSection('angles-ts')}>toggle collapse</button>
      <button onClick={() => state.togglePinnedDetailSection('angles-ts', 'Angles (TS)')}>
        toggle pin
      </button>
      <button onClick={state.clearPinnedDetailSections}>clear pins</button>
      <button onClick={state.clearFilters}>clear filters</button>
    </div>
  );
};

describe('useReportViewState', () => {
  it('normalizes filters, manages section pins/collapse, and resets row windows on rerender inputs', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<HookHarness resultVersion={1} excludedVersion={1} />);
    });

    const visibleCount = () =>
      container.querySelector('[data-testid="visible-count"]')?.textContent ?? '';
    const normalizedQuery = () =>
      container.querySelector('[data-testid="normalized-query"]')?.textContent ?? '';
    const collapsedState = () =>
      container.querySelector('[data-testid="collapsed-state"]')?.textContent ?? '';
    const pinCount = () => container.querySelector('[data-testid="pin-count"]')?.textContent ?? '';
    const buttons = Array.from(container.querySelectorAll('button'));

    expect(visibleCount()).toBe('100');
    expect(normalizedQuery()).toBe('');
    expect(collapsedState()).toBe('expanded');
    expect(pinCount()).toBe('0');

    await act(async () => {
      buttons[1]?.click();
      buttons[2]?.click();
      buttons[3]?.click();
      await Promise.resolve();
    });

    expect(visibleCount()).toBe('150');
    expect(collapsedState()).toBe('collapsed');
    expect(pinCount()).toBe('1');

    await act(async () => {
      buttons[0]?.click();
      await Promise.resolve();
    });

    expect(normalizedQuery()).toBe('p100');
    expect(visibleCount()).toBe('100');

    await act(async () => {
      root.render(<HookHarness resultVersion={2} excludedVersion={2} />);
      await Promise.resolve();
    });

    expect(visibleCount()).toBe('100');

    await act(async () => {
      buttons[4]?.click();
      buttons[5]?.click();
      await Promise.resolve();
    });

    expect(pinCount()).toBe('0');
    expect(normalizedQuery()).toBe('');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
