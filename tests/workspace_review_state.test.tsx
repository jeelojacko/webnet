/** @vitest-environment jsdom */

import React, { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LSAEngine } from '../src/engine/adjust';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import {
  createDefaultWorkspaceReviewState,
  useWorkspaceReviewState,
} from '../src/hooks/useWorkspaceReviewState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 60 40 0',
  'D A-P 72.1110255 0.005',
  'D B-P 56.5685425 0.005',
  'A P-A-B 90-00-00 3',
].join('\n');

const buildResult = () => new LSAEngine({ input, maxIterations: 8 }).solve();

const WorkspaceReviewHarness: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const result = useMemo(() => (enabled ? buildResult() : null), [enabled]);
  const derivedResult = useMemo(() => (result ? buildQaDerivedResult(result) : null), [result]);
  const observationId = result?.observations.find((obs) => obs.type === 'dist')?.id ?? null;
  const reviewState = useWorkspaceReviewState({
    derivedResult,
    result,
    excludedIds: new Set<number>(),
  });

  return (
    <div>
      <div data-testid="query">{reviewState.normalizedReportFilterQuery}</div>
      <div data-testid="visible-count">
        {reviewState.visibleRowsFor('sample', Array.from({ length: 150 }, (_, index) => index))
          .length}
      </div>
      <div data-testid="selected-observation">{reviewState.selection.observationId ?? '-'}</div>
      <div data-testid="selected-station">{reviewState.selection.stationId ?? '-'}</div>
      <div data-testid="pinned-observation-count">{reviewState.pinnedObservationIds.length}</div>
      <button onClick={() => reviewState.setReportFilterQuery('  P100  ')}>set filter</button>
      <button onClick={() => reviewState.showMoreRows('sample')}>show more</button>
      <button
        onClick={() => {
          if (observationId != null) reviewState.selectObservation(observationId, 'report');
        }}
      >
        select observation
      </button>
      <button
        onClick={() => {
          if (observationId != null) reviewState.togglePinnedObservation(observationId);
        }}
      >
        pin observation
      </button>
      <button
        onClick={() =>
          reviewState.restoreSnapshot({
            ...createDefaultWorkspaceReviewState(),
            reportView: {
              ...createDefaultWorkspaceReviewState().reportView,
              reportFilterQuery: 'restored',
              tableRowLimits: { sample: 140 },
            },
            selection: {
              stationId: 'P',
              observationId: null,
              sourceLine: 3,
              origin: 'report',
            },
            pinnedObservationIds: observationId != null ? [observationId] : [],
          })
        }
      >
        restore snapshot
      </button>
    </div>
  );
};

describe('useWorkspaceReviewState', () => {
  it('keeps report review state together and clears invalid QA review context when results disappear', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<WorkspaceReviewHarness enabled />);
    });

    const query = () => container.querySelector('[data-testid="query"]')?.textContent ?? '';
    const visibleCount = () =>
      container.querySelector('[data-testid="visible-count"]')?.textContent ?? '';
    const selectedObservation = () =>
      container.querySelector('[data-testid="selected-observation"]')?.textContent ?? '';
    const selectedStation = () =>
      container.querySelector('[data-testid="selected-station"]')?.textContent ?? '';
    const pinnedObservationCount = () =>
      container.querySelector('[data-testid="pinned-observation-count"]')?.textContent ?? '';
    const buttons = Array.from(container.querySelectorAll('button'));

    await act(async () => {
      buttons[0]?.click();
      await Promise.resolve();
    });

    await act(async () => {
      buttons[1]?.click();
      buttons[2]?.click();
      buttons[3]?.click();
      await Promise.resolve();
    });

    expect(query()).toBe('p100');
    expect(visibleCount()).toBe('150');
    expect(selectedObservation()).not.toBe('-');
    expect(pinnedObservationCount()).toBe('1');

    await act(async () => {
      buttons[4]?.click();
      await Promise.resolve();
    });

    expect(query()).toBe('restored');
    expect(visibleCount()).toBe('140');
    expect(selectedStation()).toBe('P');

    await act(async () => {
      root.render(<WorkspaceReviewHarness enabled={false} />);
      await Promise.resolve();
    });

    expect(query()).toBe('restored');
    expect(selectedObservation()).toBe('-');
    expect(selectedStation()).toBe('-');
    expect(pinnedObservationCount()).toBe('0');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
