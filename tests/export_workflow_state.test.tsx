/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
} from '../src/engine/adjustedPointsExport';
import { useExportWorkflow } from '../src/hooks/useExportWorkflow';
import type { ImportedInputNotice } from '../src/engine/importers';
import type {
  AdjustmentResult,
  AdjustedPointsExportSettings,
  ProjectExportFormat,
} from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseResult = {
  stations: {
    P1: {
      x: 100,
      y: 200,
      h: 10,
      lost: false,
    },
  },
  parseState: {
    reconciledDescriptions: {
      P1: 'Station 1',
    },
  },
} as unknown as AdjustmentResult;

const renderExportHarness = (options?: {
  exportFormat?: ProjectExportFormat;
  adjustedPointsExportSettings?: AdjustedPointsExportSettings;
  currentComparisonText?: string;
  buildResultsText?: (_result: AdjustmentResult) => string;
  buildIndustryListingText?: (_result: AdjustmentResult) => string;
  buildLandXmlExportText?: (_result: AdjustmentResult) => string;
}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const buildResultsText = vi.fn(options?.buildResultsText ?? (() => 'WEBNET REPORT'));
  const buildIndustryListingText = vi.fn(
    options?.buildIndustryListingText ?? (() => 'INDUSTRY LISTING'),
  );
  const buildLandXmlExportText = vi.fn(
    options?.buildLandXmlExportText ?? (() => '<LandXML />'),
  );

  const Harness = () => {
    const [importNotice, setImportNotice] = useState<ImportedInputNotice | null>(null);
    const { handleExportResults } = useExportWorkflow({
      result: baseResult,
      exportFormat: options?.exportFormat ?? 'points',
      units: 'm',
      adjustedPointsExportSettings:
        options?.adjustedPointsExportSettings ??
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      currentComparisonText: options?.currentComparisonText ?? '',
      setImportNotice,
      buildResultsText,
      buildIndustryListingText,
      buildLandXmlExportText,
    });

    return (
      <div>
        <button type="button" onClick={() => void handleExportResults()}>
          export
        </button>
        <div id="notice-title">{importNotice?.title ?? '-'}</div>
        <div id="notice-detail">{importNotice?.detailLines.join(' | ') ?? '-'}</div>
      </div>
    );
  };

  return {
    container,
    root,
    buildResultsText,
    buildIndustryListingText,
    buildLandXmlExportText,
    render: async () => {
      await act(async () => {
        root.render(<Harness />);
      });
    },
    clickExport: async () => {
      const button = container.querySelector('button') as HTMLButtonElement;
      await act(async () => {
        button.click();
      });
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useExportWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('blocks adjusted-points export when transform settings are invalid', async () => {
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const adjustedPointsExportSettings = cloneAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      transform: {
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS.transform,
        rotation: {
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS.transform.rotation,
          enabled: true,
          angleDeg: 15,
        },
        referenceStationId: '',
      },
    });
    const harness = renderExportHarness({
      exportFormat: 'points',
      adjustedPointsExportSettings,
    });

    await harness.render();
    await harness.clickExport();

    expect(harness.container.querySelector('#notice-title')?.textContent).toBe(
      'Adjusted Points Export Blocked',
    );
    expect(harness.container.querySelector('#notice-detail')?.textContent).toContain(
      'Transform requires a reference station.',
    );
    expect(showSaveFilePicker).not.toHaveBeenCalled();

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('routes LandXML export through the save picker', async () => {
    const write = vi.fn(async (_content: string) => undefined);
    const close = vi.fn(async () => undefined);
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'landxml',
    });

    await harness.render();
    await harness.clickExport();

    expect(harness.buildLandXmlExportText).toHaveBeenCalledTimes(1);
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'webnet-landxml-2026-03-17.xml',
      }),
    );
    expect(write).toHaveBeenCalledWith('<LandXML />');
    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('#notice-title')?.textContent).toBe('-');

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
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
    expect(harness.buildResultsText).toHaveBeenCalledTimes(1);
    expect(harness.buildIndustryListingText).toHaveBeenCalledTimes(1);
    expect(harness.buildLandXmlExportText).toHaveBeenCalledTimes(1);
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
