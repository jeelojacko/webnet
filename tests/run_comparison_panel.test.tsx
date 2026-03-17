/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import RunComparisonPanel from '../src/components/RunComparisonPanel';
import { LSAEngine } from '../src/engine/adjust';
import {
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
      result: baseline,
      runDiagnostics: null,
      settingsSnapshot: { tag: 'baseline' },
      excludedIds: [],
      overrideIds: [],
      approvedClusterMerges: [],
    };
    const currentSnapshot: RunSnapshot<{ tag: string }, null> = {
      id: 'run-2',
      createdAt: '2026-03-17T00:01:00.000Z',
      label: 'Run 02',
      result: current,
      runDiagnostics: null,
      settingsSnapshot: { tag: 'current' },
      excludedIds: [7],
      overrideIds: [9],
      approvedClusterMerges: [],
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

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const stationSpy = vi.fn();
    const observationSpy = vi.fn();
    const baselineSpy = vi.fn();
    const pinSpy = vi.fn();

    await act(async () => {
      root.render(
        <RunComparisonPanel
          currentSnapshot={currentSnapshot}
          baselineSnapshot={baselineSnapshot}
          runHistory={[currentSnapshot, baselineSnapshot]}
          comparisonSelection={selection}
          comparisonSummary={summary}
          onSelectBaseline={baselineSpy}
          onTogglePinBaseline={pinSpy}
          onStationThresholdChange={() => {}}
          onResidualThresholdChange={() => {}}
          onSelectStation={stationSpy}
          onSelectObservation={observationSpy}
        />,
      );
    });

    expect(container.textContent).toContain('Run Compare');
    const stationButton = container.querySelector('[data-run-compare-station]') as HTMLButtonElement;
    const observationButton = container.querySelector(
      '[data-run-compare-observation]',
    ) as HTMLButtonElement;
    const pinButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Pin baseline'),
    ) as HTMLButtonElement;
    const select = container.querySelector('select') as HTMLSelectElement;

    await act(async () => {
      stationButton.click();
      observationButton.click();
      select.value = 'run-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      pinButton.click();
    });

    expect(stationSpy).toHaveBeenCalled();
    expect(observationSpy).toHaveBeenCalled();
    expect(baselineSpy).toHaveBeenCalledWith('run-1');
    expect(pinSpy).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
