/** @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { useRunComparisonState } from '../src/hooks/useRunComparisonState';
import type { AdjustmentResult } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMockResult = (stationId: string): AdjustmentResult =>
  ({
    converged: true,
    iterations: 1,
    seuw: 1,
    dof: 1,
    stations: {
      [stationId]: {
        x: 0,
        y: 0,
        h: 0,
        fixed: false,
      },
    },
    observations: [],
    residuals: [],
    logs: [],
  }) as unknown as AdjustmentResult;

describe('useRunComparisonState', () => {
  it('tracks recent runs and selects the latest previous baseline', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const {
        runHistory,
        savedRunSnapshots,
        currentRunSnapshot,
        baselineRunSnapshot,
        comparisonSettingDiffs,
        currentSavedRunSnapshot,
        saveCurrentRunSnapshot,
        recordRunSnapshot,
      } = useRunComparisonState<string, { profile: string }>({
        buildSettingDiffs: (current, previous) =>
          previous && current !== previous ? [`${previous}->${current}`] : [],
      });

      useEffect(() => {
        recordRunSnapshot({
          result: createMockResult('A'),
          runDiagnostics: { profile: 'one' },
          settingsSnapshot: 'settings-a',
          inputFingerprint: 'input-a',
          excludedIds: [],
          overrideIds: [],
          approvedClusterMerges: [],
        });
        recordRunSnapshot({
          result: createMockResult('B'),
          runDiagnostics: { profile: 'two' },
          settingsSnapshot: 'settings-b',
          inputFingerprint: 'input-b',
          excludedIds: [],
          overrideIds: [],
          approvedClusterMerges: [],
        });
      }, [recordRunSnapshot]);

      useEffect(() => {
        if (currentRunSnapshot?.label !== 'Run 02') return;
        saveCurrentRunSnapshot();
      }, [currentRunSnapshot, saveCurrentRunSnapshot]);

      return (
        <div>
          <div data-history-count>{runHistory.length}</div>
          <div data-saved-count>{savedRunSnapshots.length}</div>
          <div data-current>{currentRunSnapshot?.label ?? '-'}</div>
          <div data-baseline>{baselineRunSnapshot?.label ?? '-'}</div>
          <div data-current-saved>{currentSavedRunSnapshot?.label ?? '-'}</div>
          <div data-diff-count>{comparisonSettingDiffs.length}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-history-count]')?.textContent).toBe('2');
    expect(container.querySelector('[data-saved-count]')?.textContent).toBe('1');
    expect(container.querySelector('[data-current]')?.textContent).toBe('Run 02');
    expect(container.querySelector('[data-baseline]')?.textContent).toBe('Run 01');
    expect(container.querySelector('[data-current-saved]')?.textContent).toBe('Saved Run 02');
    expect(container.querySelector('[data-diff-count]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
