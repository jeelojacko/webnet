/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  renderExportHarness,
} from './exportWorkflowStateTestSupport';
describe('useExportWorkflow save-picker exports', () => {
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

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'webnet-landxml-2026-03-17.xml',
      }),
    );
    expect(harness.buildArtifacts).toHaveBeenCalledTimes(1);
    expect(harness.buildArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        exportFormat: 'landxml',
      }),
    );
    expect(write).toHaveBeenCalledWith('<LandXML />');
    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('#notice-title')?.textContent).toBe('-');

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('forces first-class adjusted-points CSV export to comma-delimited csv output', async () => {
    const writes: string[] = [];
    const close = vi.fn(async () => undefined);
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (content: string) => {
          writes.push(content);
        },
        close,
      }),
    }));
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'points-csv',
      adjustedPointsExportSettings: cloneAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        format: 'text',
        delimiter: 'tab',
      }),
    });

    await harness.render();
    await harness.clickExport();

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'webnet-adjusted-points-2026-03-17.csv',
      }),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.split('\n')[0]).toContain(',');
    expect(writes[0]?.split('\n')[0]).not.toContain('\t');
    expect(close).toHaveBeenCalledTimes(1);

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('routes observations and residuals CSV export through the save picker', async () => {
    const writes: string[] = [];
    const close = vi.fn(async () => undefined);
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (content: string) => {
          writes.push(content);
        },
        close,
      }),
    }));
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'observations-csv',
    });

    await harness.render();
    await harness.clickExport();

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'webnet-observations-residuals-2026-03-17.csv',
      }),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('obsId,status,type,stations');
    expect(close).toHaveBeenCalledTimes(1);

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('routes GeoJSON export through the save picker', async () => {
    const writes: string[] = [];
    const close = vi.fn(async () => undefined);
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (content: string) => {
          writes.push(content);
        },
        close,
      }),
    }));
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const harness = renderExportHarness({
      exportFormat: 'geojson',
    });

    await harness.render();
    await harness.clickExport();

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'webnet-network-2026-03-17.geojson',
      }),
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? '{}')).toEqual(
      expect.objectContaining({
        type: 'FeatureCollection',
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);

    await harness.cleanup();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });
});
