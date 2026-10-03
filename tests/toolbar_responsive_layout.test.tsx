/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import AppToolbar from '../src/components/AppToolbar';
import ReportToolbar from '../src/components/report/ReportToolbar';
import type { ResultIntegrityState } from '../src/engine/resultIntegrity';
import type { RunPipelineState } from '../src/hooks/useAdjustmentRunner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

const idlePipeline: RunPipelineState = {
  status: 'idle',
  runId: null,
  phase: null,
  error: null,
  workerBacked: true,
  elapsedMs: null,
  detail: null,
  stageId: null,
  solveIndex: null,
  solveTotalHint: null,
  iteration: null,
  maxIterations: null,
};

const renderToolbar = async (
  pipelineState: RunPipelineState,
  runPhaseLabel: string | null,
  integrityState: ResultIntegrityState = 'NO_RESULT',
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AppToolbar
        isSidebarOpen
        onToggleSidebar={() => {}}
        onOpenProjectOptions={() => {}}
        onOpenSurveyCad={() => {}}
        onSendToCad={() => {}}
        canSendToCad={false}
        sendToCadBlockMessage={null}
        onOpenStudy={() => {}}
        onOpenImportFile={() => {}}
        onOpenProjectFile={() => {}}
        onSaveProject={() => {}}
        exportFormat="points"
        onExportFormatChange={() => {}}
        exportTooltip="Export tooltip"
        exportLabel="Adjusted points"
        onExportResults={() => {}}
        canExport
        hasStoredDraft
        onClearCurrentDraft={() => {}}
        selectedObservationId={null}
        isSelectedObservationPinned={false}
        onTogglePinSelectedObservation={() => {}}
        pipelineState={pipelineState}
        integrityState={integrityState}
        runPhaseLabel={runPhaseLabel}
        pendingRunSettingDiffs={[]}
        onCancelRun={() => {}}
        onRun={() => {}}
        onResetToLastRun={() => {}}
      />,
    );
  });
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
};

const buttonByLabel = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === label,
  );

describe('AppToolbar responsive layout', () => {
  it('uses flex-wrap rows with orthogonal gaps and a shrinkable export select', async () => {
    const container = await renderToolbar(idlePipeline, null);
    const header = container.querySelector('[data-testid="app-toolbar"]') as HTMLElement;
    expect(header.className).toContain('flex-wrap');
    expect(header.className).toContain('gap-x-3');
    expect(header.className).toContain('gap-y-2');
    expect(header.className).toContain('min-w-0');

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.className).toContain('min-w-0');
    expect(select.className).not.toContain('min-w-[');
  });

  it('keeps run/project/CAD/save controls present with icon-only aria labels', async () => {
    const container = await renderToolbar(idlePipeline, null, 'FRESH_SUCCESS');
    for (const label of [
      'Adjust',
      'Open project options',
      'Open WebNet CAD',
      'Save project',
      'Open local project workspace',
    ]) {
      const button = buttonByLabel(container, label);
      expect(button, `expected button ${label}`).toBeDefined();
      expect(button?.title).toBeTruthy();
    }
    expect(container.querySelector('[data-result-integrity-status]')).not.toBeNull();
    const labelSpans = Array.from(container.querySelectorAll('span'));
    expect(labelSpans.some((span) => span.textContent === 'Project Options')).toBe(true);
    expect(labelSpans.some((span) => span.textContent === 'Open CAD')).toBe(true);
  });

  it('clears stale progress once a run is no longer running', async () => {
    const running = await renderToolbar(
      { ...idlePipeline, status: 'running', phase: 'solving', detail: 'Solving normal matrix' },
      'Solving',
    );
    expect(running.textContent).toContain('Solving');

    const cancelled = await renderToolbar(
      { ...idlePipeline, status: 'cancelled' },
      'Cancelled',
    );
    expect(cancelled.textContent).not.toContain('Cancelled');

    const failed = await renderToolbar({ ...idlePipeline, status: 'failed' }, 'Failed');
    expect(failed.textContent).not.toContain('Failed');
  });
});

describe('ReportToolbar responsive layout', () => {
  it('wraps action rows with gaps and preserves order and enabled semantics', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReportToolbar
          onReRun={() => {}}
          onToggleCollapseAll={() => {}}
          allDetailSectionsCollapsed={false}
          onClearExclusions={() => {}}
          onResetOverrides={() => {}}
          showClusterMergeRevert
          clusterAppliedMergeCount={0}
          clusterRevertDisabledReason="No applied cluster merges"
          onClearClusterMerges={() => {}}
          unitScale={1}
          units="m"
        />,
      );
    });
    cleanup.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    const toolbar = container.querySelector('[data-testid="report-toolbar"]') as HTMLElement;
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).toContain('gap-x-2');
    expect(toolbar.className).toContain('gap-y-2');

    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Re-run with exclusions',
      'Collapse detail sections',
      'Reset exclusions',
      'Reset overrides',
      'Revert cluster merges',
    ]);
    expect(buttons[4].disabled).toBe(true);
    for (const button of buttons) expect(button.title).toBeTruthy();
    expect(toolbar.textContent).toContain('Unit scale: 1.0000 (m)');
  });
});
