/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import RunComparisonPanel from '../src/components/RunComparisonPanel';
import WorkspaceReviewActions from '../src/components/WorkspaceReviewActions';
import { LSAEngine } from '../src/engine/adjust';
import {
  buildRunSnapshotSummary,
  buildRunComparison,
  type ComparisonSelection,
  type RunSnapshot,
} from '../src/engine/qaWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const buildResult = (input: string) => new LSAEngine({ input, maxIterations: 8 }).solve();

describe('RunComparisonPanel', () => {
  it('renders compare rows and routes selection callbacks', async () => {
    const baseline = buildResult(
      ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'D A-B 100 0.01'].join('\n'),
    );
    const current = buildResult(
      ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C P 50 40 0', 'D A-P 64.0 0.01'].join('\n'),
    );
    const baselineSnapshot: RunSnapshot<{ tag: string }, null> = {
      id: 'run-1',
      createdAt: '2026-03-17T00:00:00.000Z',
      label: 'Run 01',
      inputFingerprint: 'input-run-1',
      settingsFingerprint: 'settings-run-1',
      summary: buildRunSnapshotSummary(baseline),
      result: baseline,
      runDiagnostics: null,
      settingsSnapshot: { tag: 'baseline' },
      excludedIds: [],
      overrideIds: [],
      overrides: {},
      approvedClusterMerges: [],
      reopenState: null,
    };
    const currentSnapshot: RunSnapshot<{ tag: string }, null> = {
      id: 'run-2',
      createdAt: '2026-03-17T00:01:00.000Z',
      label: 'Run 02',
      inputFingerprint: 'input-run-2',
      settingsFingerprint: 'settings-run-2',
      summary: buildRunSnapshotSummary(current),
      result: current,
      runDiagnostics: null,
      settingsSnapshot: { tag: 'current' },
      excludedIds: [7],
      overrideIds: [9],
      overrides: {},
      approvedClusterMerges: [],
      reopenState: null,
    };
    const selection: ComparisonSelection = {
      baselineRunId: 'run-1',
      pinnedBaselineRunId: null,
      stationMovementThreshold: 0,
      residualDeltaThreshold: 0,
    };
    const summary = buildRunComparison(currentSnapshot, baselineSnapshot, selection, [
      'Units: m -> ft',
    ]);
    const savedSnapshot = {
      ...baselineSnapshot,
      id: 'saved-run-1',
      sourceRunId: 'run-0',
      savedAt: '2026-03-17T00:02:00.000Z',
      notes: 'checkpoint',
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const stationSpy = vi.fn();
    const observationSpy = vi.fn();
    const baselineSpy = vi.fn();
    const pinSpy = vi.fn();
    const saveSpy = vi.fn();
    const restoreSpy = vi.fn();
    const compareSavedSpy = vi.fn();
    const renameSavedSpy = vi.fn();
    const notesSavedSpy = vi.fn();
    const deleteSavedSpy = vi.fn();
    const prevSpy = vi.fn();
    const nextSpy = vi.fn();
    const jumpSpy = vi.fn();
    const focusFilterSpy = vi.fn();
    const pinSelectedSpy = vi.fn();

    await act(async () => {
      root.render(
        <RunComparisonPanel
          currentSnapshot={currentSnapshot}
          baselineSnapshot={baselineSnapshot}
          comparisonCandidates={[baselineSnapshot, savedSnapshot]}
          savedRunSnapshots={[savedSnapshot]}
          currentSavedRunId={null}
          isCurrentSnapshotSaved={false}
          comparisonSelection={selection}
          comparisonSummary={summary}
          onSaveCurrentSnapshot={saveSpy}
          onRestoreSavedRun={restoreSpy}
          onCompareWithSavedRun={compareSavedSpy}
          onRenameSavedRun={renameSavedSpy}
          onUpdateSavedRunNotes={notesSavedSpy}
          onDeleteSavedRun={deleteSavedSpy}
          onSelectBaseline={baselineSpy}
          onTogglePinBaseline={pinSpy}
          onStationThresholdChange={() => {}}
          onResidualThresholdChange={() => {}}
          onSelectStation={stationSpy}
          onSelectObservation={observationSpy}
          reviewActionsContent={
            <WorkspaceReviewActions
              canNavigateSuspects
              canJumpToInput
              canPinSelectedObservation
              isSelectedObservationPinned={false}
              onSelectPreviousSuspect={prevSpy}
              onSelectNextSuspect={nextSpy}
              onJumpToInput={jumpSpy}
              onTogglePinSelectedObservation={pinSelectedSpy}
              onFocusReportFilter={focusFilterSpy}
            />
          }
        />,
      );
    });

    expect(container.textContent).toContain('Run Compare');
    expect(container.textContent).toContain('Saved runs 1');
    expect(container.textContent).toContain('Saved Runs');
    expect(container.textContent).not.toContain('Moved Stations');
    expect(container.querySelector('[data-qa-review-action="prev-suspect"]')).toBeNull();
    const expandButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show compare'),
    ) as HTMLButtonElement;
    expect(expandButton.title).toBe('Expand the comparison workspace and QA review actions.');
    await act(async () => {
      expandButton.click();
    });

    expect(container.querySelectorAll('[data-qa-review-action="prev-suspect"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-qa-review-action="next-suspect"]')).toHaveLength(1);
    expect(container.textContent).toContain('Moved Stations');

    const stationButton = container.querySelector('[data-run-compare-station]') as HTMLButtonElement;
    const observationButton = container.querySelector(
      '[data-run-compare-observation]',
    ) as HTMLButtonElement;
    const pinButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Pin baseline'),
    ) as HTMLButtonElement;
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save current run'),
    ) as HTMLButtonElement;
    const restoreButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Restore'),
    ) as HTMLButtonElement;
    const compareSavedButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Compare'),
    ) as HTMLButtonElement;
    const select = container.querySelector('select') as HTMLSelectElement;
    const prevButton = container.querySelector(
      '[data-qa-review-action="prev-suspect"]',
    ) as HTMLButtonElement;
    const nextButton = container.querySelector(
      '[data-qa-review-action="next-suspect"]',
    ) as HTMLButtonElement;
    const focusFilterButton = container.querySelector(
      '[data-qa-review-action="focus-filter"]',
    ) as HTMLButtonElement;
    const jumpInputButton = container.querySelector(
      '[data-qa-review-action="jump-input"]',
    ) as HTMLButtonElement;
    const pinSelectedButton = container.querySelector(
      '[data-qa-review-action="pin-selected"]',
    ) as HTMLButtonElement;

    const baselineLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Baseline',
    ) as HTMLDivElement;
    const moveThresholdLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Move threshold',
    ) as HTMLDivElement;
    const residualThresholdLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Residual threshold',
    ) as HTMLDivElement;
    const summaryLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Summary',
    ) as HTMLDivElement;
    const movedStationsLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Moved Stations',
    ) as HTMLDivElement;
    const residualDeltasLabel = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Residual Deltas',
    ) as HTMLDivElement;

    expect(baselineLabel.title).toBe(
      'Select which previous successful run or saved snapshot to use as the comparison baseline.',
    );
    expect(select.title).toBe('Choose the baseline run used for move/residual comparisons.');
    expect(moveThresholdLabel.title).toBe(
      'Minimum station horizontal movement required before a station appears in the moved-stations review list.',
    );
    expect(residualThresholdLabel.title).toBe(
      'Minimum absolute change in standardized residual before an observation appears in the residual-delta review list.',
    );
    expect(pinButton.title).toBe(
      'Pin the current baseline so it stays selected while newer runs are added.',
    );
    expect(summaryLabel.title).toBe(
      'High-level differences between the current run and the selected baseline.',
    );
    expect(movedStationsLabel.title).toBe(
      'Stations whose horizontal movement exceeds the configured move threshold.',
    );
    expect(residualDeltasLabel.title).toBe(
      'Observations whose absolute standardized-residual change exceeds the configured residual threshold.',
    );
    expect(prevButton.title).toBe(
      'Select the previous suspect observation and return review focus to it.',
    );
    expect(nextButton.title).toBe(
      'Select the next suspect observation and return review focus to it.',
    );
    expect(focusFilterButton.title).toBe(
      'Open the report tab if needed and focus the report filter input.',
    );
    expect(jumpInputButton.title).toBe(
      'Jump the input editor to the source line for the current selection.',
    );
    expect(pinSelectedButton.title).toBe(
      'Pin or unpin the currently selected observation for quick return navigation.',
    );
    expect(saveButton.title).toBe(
      'Store the current run as a persisted saved snapshot for this workspace or project file.',
    );

    await act(async () => {
      saveButton.click();
      restoreButton.click();
      compareSavedButton.click();
      stationButton.click();
      observationButton.click();
      select.value = 'run-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      pinButton.click();
      prevButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      focusFilterButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      jumpInputButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      pinSelectedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stationSpy).toHaveBeenCalled();
    expect(observationSpy).toHaveBeenCalled();
    expect(baselineSpy).toHaveBeenCalledWith('run-1');
    expect(pinSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalledWith('saved-run-1');
    expect(compareSavedSpy).toHaveBeenCalledWith('saved-run-1');
    expect(prevSpy).toHaveBeenCalled();
    expect(nextSpy).toHaveBeenCalled();
    expect(focusFilterSpy).toHaveBeenCalled();
    expect(jumpSpy).toHaveBeenCalled();
    expect(pinSelectedSpy).toHaveBeenCalled();

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Hide compare'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-qa-review-action="prev-suspect"]')).toBeNull();
    expect(container.querySelector('[data-qa-review-action="next-suspect"]')).toBeNull();
    expect(container.textContent).not.toContain('Moved Stations');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
