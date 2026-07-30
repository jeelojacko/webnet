/** @vitest-environment jsdom */

import { vi } from 'vitest';

export { default as React, act, useRef, useState } from 'react';
export type { ChangeEvent } from 'react';
export { createRoot } from 'react-dom/client';
export type { Root } from 'react-dom/client';
export {
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
} from '../../src/engine/adjustedPointsExport';
export {
  MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
  MAX_PORTABLE_PROJECT_TEXT_BYTES,
} from '../../src/engine/browserFileIo';
export { serializeProjectFile } from '../../src/engine/projectFile';
export { applyPersistedProjectSession, useProjectFileWorkflow } from '../../src/hooks/useProjectFileWorkflow';
export {
  createManifestEntry,
  createProjectManifest,
} from '../../src/engine/projectWorkspace';
export type { ProjectIndexRow, ProjectSessionState } from '../../src/engine/projectWorkspace';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
} from '../../src/appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
} from '../../src/types';
export type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createProjectWorkflowFakeRequest = <T,>(
  resolver: () => T,
  onComplete?: () => void,
): IDBRequest<T> => {
  const request: {
    result: T;
    error: DOMException | null;
    onsuccess: IDBRequest<T>['onsuccess'];
    onerror: IDBRequest<T>['onerror'];
  } = {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  const idbRequest = request as unknown as IDBRequest<T>;
  window.setTimeout(() => {
    try {
      request.result = resolver();
      request.onsuccess?.call(idbRequest, new Event('success') as never);
      window.setTimeout(() => {
        onComplete?.();
      }, 0);
    } catch (error) {
      request.error = error as DOMException;
      request.onerror?.call(idbRequest, new Event('error') as never);
      window.setTimeout(() => {
        onComplete?.();
      }, 0);
    }
  }, 0);
  return idbRequest;
};

export const installProjectWorkflowFakeIndexedDb = (
  promptResult: string,
): void => {
  const stores = {
    projectIndex: new Map<string, unknown>(),
    projectManifest: new Map<string, unknown>(),
    projectFile: new Map<string, unknown>(),
  };

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: vi.fn(() => {
        const request: {
          result: IDBDatabase | null;
          error: DOMException | null;
          onsuccess: IDBOpenDBRequest['onsuccess'];
          onerror: IDBOpenDBRequest['onerror'];
          onupgradeneeded: IDBOpenDBRequest['onupgradeneeded'];
        } = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        const db = {
          objectStoreNames: {
            contains: () => true,
          },
          createObjectStore: () => undefined,
          close: () => undefined,
          transaction: (storeNames: string | string[]) => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            const transaction = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: (name: string) => {
                if (!names.includes(name)) {
                  throw new Error(`Unexpected store ${name}`);
                }
                const store =
                  name === 'projectIndex'
                    ? stores.projectIndex
                    : name === 'projectManifest'
                      ? stores.projectManifest
                      : stores.projectFile;
                return {
                  get: (key: string) =>
                    createProjectWorkflowFakeRequest(() => store.get(key), () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  getAll: () =>
                    createProjectWorkflowFakeRequest(() => Array.from(store.values()), () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  put: (value: unknown) =>
                    createProjectWorkflowFakeRequest(() => {
                      if (name === 'projectIndex') {
                        const row = value as { id: string };
                        store.set(row.id, value);
                      } else if (name === 'projectManifest') {
                        const row = value as { projectId: string };
                        store.set(row.projectId, value);
                      } else {
                        const row = value as { projectId: string; fileId: string };
                        store.set(`${row.projectId}:${row.fileId}`, value);
                      }
                      return value;
                    }, () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  delete: (key: string | string[]) =>
                    createProjectWorkflowFakeRequest(() => {
                      store.delete(Array.isArray(key) ? key.join(':') : key);
                      return undefined;
                    }, () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                };
              },
            } as unknown as IDBTransaction;
            return transaction;
          },
        } as unknown as IDBDatabase;
        request.result = db;
        const openRequest = request as unknown as IDBOpenDBRequest;
        window.setTimeout(() => {
          request.onsuccess?.call(openRequest, new Event('success') as never);
        }, 0);
        return openRequest;
      }),
    },
  });
  window.prompt = vi.fn(() => promptResult);
};

export const baseSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  precisionReportingMode: 'industry-standard',
  units: 'm',
  uiTheme: 'gruvbox-dark',
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
  listingSortCoordinatesBy: 'name',
  listingSortObservationsBy: 'stdResidual',
  listingObservationLimit: 60,
};

export const baseParseSettings: ParseSettings = {
  solveProfile: 'industry-parity',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'LOCAL',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  verticalDeflectionNorthSec: 0,
  verticalDeflectionEastSec: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
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
  suspectImpactMode: 'auto',
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
  qFixLinearSigmaM: 1e-7,
  qFixAngularSigmaSec: 1.0001e-3,
  prismEnabled: false,
  prismOffset: 0,
  prismScope: 'global',
  directionSetMode: 'reduced',
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
};

export const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
  const next: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, instrument]) => {
    next[code] = { ...instrument };
  });
  return next;
};

export const normalizeUiTheme = (value: unknown): SettingsState['uiTheme'] => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

export const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

export const buildObservationModeFromGridFields = (state: {
  gridBearingMode: ParseSettings['gridBearingMode'];
  gridDistanceMode: ParseSettings['gridDistanceMode'];
  gridAngleMode: ParseSettings['gridAngleMode'];
  gridDirectionMode: ParseSettings['gridDirectionMode'];
}): ObservationModeSettings => ({
  bearing: state.gridBearingMode,
  distance: state.gridDistanceMode,
  angle: state.gridAngleMode,
  direction: state.gridDirectionMode,
});

