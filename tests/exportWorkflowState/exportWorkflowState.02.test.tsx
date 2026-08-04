/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  renderExportHarness,
} from './exportWorkflowStateTestSupport';
describe('useExportWorkflow bundle exports', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('downloads QA bundle files and reports the bundle notice', async () => {
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;

    const downloads: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    HTMLAnchorElement.prototype.click = function click() {
      downloads.push(this.download);
    };
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    });

    const harness = renderExportHarness({
      exportFormat: 'bundle-qa-standard-with-landxml',
      currentComparisonText: 'COMPARE',
    });

    await harness.render();
    await harness.clickExport();

    expect(downloads).toEqual([
      'webnet-qa-bundle-2026-03-17-comparison-summary.txt',
      'webnet-qa-bundle-2026-03-17-webnet-report.txt',
      'webnet-qa-bundle-2026-03-17-industry-listing.txt',
      'webnet-qa-bundle-2026-03-17-adjusted-points.csv',
      'webnet-qa-bundle-2026-03-17-network.xml',
    ]);
    expect(harness.buildArtifacts).toHaveBeenCalledTimes(1);
    expect(harness.buildArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        exportFormat: 'bundle-qa-standard-with-landxml',
        currentComparisonText: 'COMPARE',
      }),
    );
    expect(harness.container.querySelector('#notice-title')?.textContent).toBe(
      'QA bundle exported',
    );

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
    HTMLAnchorElement.prototype.click = originalClick;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });
});
