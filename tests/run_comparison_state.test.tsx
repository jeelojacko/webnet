/** @vitest-environment jsdom */

import React, { useEffect, useRef } from 'react';
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
          overrides: {},
          approvedClusterMerges: [],
        });
        recordRunSnapshot({
          result: createMockResult('B'),
          runDiagnostics: { profile: 'two' },
          settingsSnapshot: 'settings-b',
          inputFingerprint: 'input-b',
          excludedIds: [],
          overrideIds: [],
          overrides: {},
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

  it('renames, updates notes, and restores saved runs with reopen state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const startedRef = useRef(false);
      const recordedSecondRunRef = useRef(false);
      const renamedRef = useRef(false);
      const restoredRef = useRef(false);
      const {
        currentRunSnapshot,
        savedRunSnapshots,
        baselineRunSnapshot,
        comparisonSelection,
        recordRunSnapshot,
        saveCurrentRunSnapshot,
        renameSavedRunSnapshot,
        updateSavedRunSnapshotNotes,
        restoreSavedRunSnapshot,
      } = useRunComparisonState<string, { profile: string }>({
        buildSettingDiffs: () => [],
      });

      useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        recordRunSnapshot({
          result: createMockResult('A'),
          runDiagnostics: { profile: 'one' },
          settingsSnapshot: 'settings-a',
          inputFingerprint: 'input-a',
          excludedIds: [],
          overrideIds: [],
          overrides: {},
          approvedClusterMerges: [],
        });
      }, [recordRunSnapshot]);

      useEffect(() => {
        if (currentRunSnapshot?.label !== 'Run 01' || savedRunSnapshots.length > 0) return;
        saveCurrentRunSnapshot({
          label: 'Checkpoint A',
          notes: 'initial notes',
          reopenState: {
            activeTab: 'map',
            review: {
              reportView: {
                ellipseMode: '95',
                reportFilterQuery: 'A',
                reportObservationTypeFilter: 'all',
                reportExclusionFilter: 'all',
                tableRowLimits: { observations: 25 },
                pinnedDetailSections: [],
                collapsedDetailSections: {},
              },
              selection: {
                stationId: 'A',
                observationId: null,
                sourceLine: null,
                origin: 'compare',
              },
              pinnedObservationIds: [],
            },
            comparisonSelection: {
              baselineRunId: null,
              pinnedBaselineRunId: null,
              stationMovementThreshold: 0.02,
              residualDeltaThreshold: 0.75,
            },
          },
        });
      }, [currentRunSnapshot, saveCurrentRunSnapshot, savedRunSnapshots.length]);

      useEffect(() => {
        if (
          currentRunSnapshot?.label !== 'Run 01' ||
          savedRunSnapshots.length !== 1 ||
          recordedSecondRunRef.current
        ) {
          return;
        }
        recordedSecondRunRef.current = true;
        recordRunSnapshot({
          result: createMockResult('B'),
          runDiagnostics: { profile: 'two' },
          settingsSnapshot: 'settings-b',
          inputFingerprint: 'input-b',
          excludedIds: [],
          overrideIds: [],
          overrides: {},
          approvedClusterMerges: [],
        });
      }, [currentRunSnapshot, recordRunSnapshot, savedRunSnapshots.length]);

      useEffect(() => {
        if (
          currentRunSnapshot?.label !== 'Run 02' ||
          savedRunSnapshots.length !== 1 ||
          renamedRef.current
        ) {
          return;
        }
        renamedRef.current = true;
        renameSavedRunSnapshot('saved-run-1', 'Checkpoint A1');
        updateSavedRunSnapshotNotes('saved-run-1', 'updated notes');
      }, [
        currentRunSnapshot,
        renameSavedRunSnapshot,
        savedRunSnapshots.length,
        updateSavedRunSnapshotNotes,
      ]);

      useEffect(() => {
        if (
          currentRunSnapshot?.label !== 'Run 02' ||
          savedRunSnapshots[0]?.label !== 'Checkpoint A1' ||
          savedRunSnapshots[0]?.notes !== 'updated notes' ||
          restoredRef.current
        ) {
          return;
        }
        restoredRef.current = true;
        restoreSavedRunSnapshot('saved-run-1');
      }, [
        currentRunSnapshot,
        restoreSavedRunSnapshot,
        savedRunSnapshots,
      ]);

      return (
        <div>
          <div data-current>{currentRunSnapshot?.label ?? '-'}</div>
          <div data-saved-label>{savedRunSnapshots[0]?.label ?? '-'}</div>
          <div data-saved-notes>{savedRunSnapshots[0]?.notes ?? '-'}</div>
          <div data-baseline>{baselineRunSnapshot?.label ?? '-'}</div>
          <div data-thresholds>
            {comparisonSelection.stationMovementThreshold.toFixed(2)}|
            {comparisonSelection.residualDeltaThreshold.toFixed(2)}
          </div>
          <div data-reopen-tab>{savedRunSnapshots[0]?.reopenState?.activeTab ?? '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-current]')?.textContent).toBe('Checkpoint A1');
    expect(container.querySelector('[data-saved-label]')?.textContent).toBe('Checkpoint A1');
    expect(container.querySelector('[data-saved-notes]')?.textContent).toBe('updated notes');
    expect(container.querySelector('[data-baseline]')?.textContent).toBe('Run 02');
    expect(container.querySelector('[data-thresholds]')?.textContent).toBe('0.02|0.75');
    expect(container.querySelector('[data-reopen-tab]')?.textContent).toBe('map');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
