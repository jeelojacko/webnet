import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../../src/engine/adjustedPointsExport';
import { useExportWorkflow } from '../../src/hooks/useExportWorkflow';
import type {
  BuildExportArtifactsRequest,
  BuildExportArtifactsResult,
} from '../../src/engine/exportArtifacts';
import type { ImportedInputNotice } from '../../src/engine/importers';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../../src/appStateTypes';
import type {
  AdjustmentResult,
  AdjustedPointsExportSettings,
  ProjectExportFormat,
} from '../../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS, cloneAdjustedPointsExportSettings };
export const baseResult = {
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

export const baseSettings = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  units: 'm',
  uiTheme: 'gruvbox-light',
  mapShowLostStations: true,
  map3dEnabled: false,
  showRunComparisonPanel: false,
  showReviewQueuePanel: false,
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

export const baseParseSettings = {
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

export const baseRunDiagnostics = {
  solveProfile: 'webnet',
} as RunDiagnostics;

export const renderExportHarness = (options?: {
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
