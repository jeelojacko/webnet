/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STALE_RESULT_STATUS_LINE } from '../../src/engine/resultIntegrity';
import type {
  BuildExportArtifactsRequest,
  BuildExportArtifactsResult,
} from '../../src/engine/exportArtifacts';
import { renderExportHarness } from './exportWorkflowStateTestSupport';

describe('useExportWorkflow integrity gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('blocks a deliverable export on stale integrity with a rerun reason', async () => {
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'points',
      integrity: {
        state: 'STALE_SUCCESS',
        reason: 'RESULT_STALE',
        changedDeps: ['input'],
        blockMessage: 'Project state changed since this run (input). Re-run the adjustment.',
      },
    });
    await harness.render();
    await harness.clickExport();

    expect(harness.container.querySelector('#notice-title')?.textContent).toBe(
      'Adjusted Points Export Blocked',
    );
    expect(harness.container.querySelector('#notice-detail')?.textContent).toContain('Re-run');
    expect(harness.buildArtifacts).not.toHaveBeenCalled();
    expect(showSaveFilePicker).not.toHaveBeenCalled();

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('prepends the stale status line to a diagnostic text-report export', async () => {
    const write = vi.fn(async (_content: string) => undefined);
    const close = vi.fn(async () => undefined);
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'webnet',
      integrity: {
        state: 'STALE_SUCCESS',
        reason: 'RESULT_STALE',
        changedDeps: ['input'],
        blockMessage: 'Project state changed since this run (input). Re-run the adjustment.',
      },
      buildArtifacts: async (
        request: BuildExportArtifactsRequest,
      ): Promise<BuildExportArtifactsResult> => ({
        files: [
          {
            name: `webnet-results-${request.dateStamp}.txt`,
            mimeType: 'text/plain',
            text: 'HEADER\nbody',
          },
        ],
      }),
    });
    await harness.render();
    await harness.clickExport();

    expect(write).toHaveBeenCalledTimes(1);
    const written = String(write.mock.calls[0]?.[0] ?? '');
    expect(written.startsWith(`${STALE_RESULT_STATUS_LINE}\n\n`)).toBe(true);
    expect(written).toContain('HEADER');

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });
});
