/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import { useExportWorkflow } from '../src/hooks/useExportWorkflow';
import type {
  BuildExportArtifactsRequest,
  BuildExportArtifactsResult,
} from '../src/engine/exportArtifacts';
import type { ImportedInputNotice } from '../src/engine/importers';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../src/appStateTypes';
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

const baseSettings = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  units: 'm',
  uiTheme: 'gruvbox-light',
  mapShowLostStations: true,
  map3dEnabled: false,
  listingShowLostStations: true,
  listingShowCoordinates: true,
  listingShowObservationsResiduals: true,
  listingShowErrorPropagation: true,
  listingShowProcessingNotes: true,
  listingShowAzimuthsBearings: true,
  listingSortCoordinatesBy: 'input',
  listingSortObservationsBy: 'input',
  listingObservationLimit: 0,
} as unknown as SettingsState;

const baseParseSettings = {
  solveProfile: 'webnet',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'LOCAL',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  clusterDetectionEnabled: false,
  autoSideshotEnabled: true,
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
  order: 'EN',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  angleMode: 'auto',
  deltaMode: 'slope',
  mapMode: 'off',
  mapScaleFactor: 1,
  normalize: true,
  faceNormalizationMode: 'on',
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  levelWeight: undefined,
  levelLoopToleranceBaseMm: 0,
  levelLoopTolerancePerSqrtKmMm: 4,
  crsTransformEnabled: false,
  crsProjectionModel: 'legacy-equirectangular',
  crsLabel: '',
  crsGridScaleEnabled: false,
  crsGridScaleFactor: 1,
  crsConvergenceEnabled: false,
  crsConvergenceAngleRad: 0,
  geoidModelEnabled: false,
  geoidModelId: 'NGS-DEMO',
  geoidSourceFormat: 'builtin',
  geoidSourcePath: '',
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  gpsLoopCheckEnabled: false,
  gpsAddHiHtEnabled: false,
  gpsAddHiHtHiM: 0,
  gpsAddHiHtHtM: 0,
  qFixLinearSigmaM: 0.01,
  qFixAngularSigmaSec: 1,
  prismEnabled: false,
  prismOffset: 0,
  prismScope: 'global',
  descriptionReconcileMode: 'first',
  descriptionAppendDelimiter: ' | ',
  lonSign: 'west-negative',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  parseCompatibilityMode: 'strict',
  parseModeMigrated: true,
} as ParseSettings;

const baseRunDiagnostics = {
  solveProfile: 'webnet',
} as RunDiagnostics;

const renderExportHarness = (options?: {
  exportFormat?: ProjectExportFormat;
  adjustedPointsExportSettings?: AdjustedPointsExportSettings;
  currentComparisonText?: string;
  buildArtifacts?: (_request: BuildExportArtifactsRequest) => Promise<BuildExportArtifactsResult>;
}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const buildArtifacts = vi.fn(
    options?.buildArtifacts ??
      (async (request: BuildExportArtifactsRequest): Promise<BuildExportArtifactsResult> => {
        if (request.exportFormat === 'landxml') {
          return {
            files: [
              {
                name: `webnet-landxml-${request.dateStamp}.xml`,
                mimeType: 'application/xml',
                text: '<LandXML />',
              },
            ],
          };
        }
        if (request.exportFormat === 'points-csv') {
          return {
            files: [
              {
                name: `webnet-adjusted-points-${request.dateStamp}.csv`,
                mimeType: 'text/csv',
                text: 'P,N,E\nP1,200.0000,100.0000',
              },
            ],
          };
        }
        if (request.exportFormat === 'observations-csv') {
          return {
            files: [
              {
                name: `webnet-observations-residuals-${request.dateStamp}.csv`,
                mimeType: 'text/csv',
                text: 'obsId,status,type,stations\n1,active,dist,P1',
              },
            ],
          };
        }
        if (request.exportFormat === 'geojson') {
          return {
            files: [
              {
                name: `webnet-network-${request.dateStamp}.geojson`,
                mimeType: 'application/geo+json',
                text: JSON.stringify({ type: 'FeatureCollection' }),
              },
            ],
          };
        }
        return {
          files: [
            {
              name: `webnet-qa-bundle-${request.dateStamp}-comparison-summary.txt`,
              mimeType: 'text/plain',
              text: 'COMPARE',
            },
            {
              name: `webnet-qa-bundle-${request.dateStamp}-webnet-report.txt`,
              mimeType: 'text/plain',
              text: 'WEBNET REPORT',
            },
            {
              name: `webnet-qa-bundle-${request.dateStamp}-industry-listing.txt`,
              mimeType: 'text/plain',
              text: 'INDUSTRY LISTING',
            },
            {
              name: `webnet-qa-bundle-${request.dateStamp}-adjusted-points.csv`,
              mimeType: 'text/csv',
              text: 'P,N,E\nP1,200.0000,100.0000',
            },
            {
              name: `webnet-qa-bundle-${request.dateStamp}-network.xml`,
              mimeType: 'application/xml',
              text: '<LandXML />',
            },
          ],
          noticeTitle: 'QA bundle exported',
          noticeLines: [
            `Downloaded webnet-qa-bundle-${request.dateStamp}-comparison-summary.txt`,
            `Downloaded webnet-qa-bundle-${request.dateStamp}-webnet-report.txt`,
            `Downloaded webnet-qa-bundle-${request.dateStamp}-industry-listing.txt`,
            `Downloaded webnet-qa-bundle-${request.dateStamp}-adjusted-points.csv`,
            `Downloaded webnet-qa-bundle-${request.dateStamp}-network.xml`,
          ],
        };
      }),
  );

  const Harness = () => {
    const [importNotice, setImportNotice] = useState<ImportedInputNotice | null>(null);
    const { handleExportResults } = useExportWorkflow({
      result: baseResult,
      exportFormat: options?.exportFormat ?? 'points',
      units: 'm',
      settings: baseSettings,
      parseSettings: baseParseSettings,
      runDiagnostics: baseRunDiagnostics,
      adjustedPointsExportSettings:
        options?.adjustedPointsExportSettings ??
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      levelLoopCustomPresets: [],
      currentComparisonText: options?.currentComparisonText ?? '',
      setImportNotice,
      buildArtifacts,
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
    buildArtifacts,
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
