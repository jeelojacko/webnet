/** @vitest-environment jsdom */

import React, { act, useRef, useState, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { cloneAdjustedPointsExportSettings, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../src/engine/adjustedPointsExport';
import { serializeProjectFile } from '../src/engine/projectFile';
import { applyPersistedProjectSession, useProjectFileWorkflow } from '../src/hooks/useProjectFileWorkflow';
import {
  createManifestEntry,
  createProjectManifest,
  type ProjectIndexRow,
  type ProjectSessionState,
} from '../src/engine/projectWorkspace';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
} from '../src/appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
} from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  precisionReportingMode: 'industry-standard',
  units: 'm',
  uiTheme: 'gruvbox-dark',
  mapShowLostStations: true,
  map3dEnabled: false,
  listingShowLostStations: true,
  listingShowCoordinates: true,
  listingShowObservationsResiduals: true,
  listingShowErrorPropagation: true,
  listingShowProcessingNotes: true,
  listingShowAzimuthsBearings: true,
  listingSortCoordinatesBy: 'name',
  listingSortObservationsBy: 'residual',
  listingObservationLimit: 60,
};

const baseParseSettings: ParseSettings = {
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

const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
  const next: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, instrument]) => {
    next[code] = { ...instrument };
  });
  return next;
};

const normalizeUiTheme = (value: unknown): SettingsState['uiTheme'] => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

const buildObservationModeFromGridFields = (state: {
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

describe('useProjectFileWorkflow', () => {
  it('keeps newer project-file state when an older autosave finishes late', () => {
    const createdAt = '2026-04-13T13:00:00.000Z';
    const olderUpdatedAt = '2026-04-13T13:01:00.000Z';
    const newerUpdatedAt = '2026-04-13T13:02:00.000Z';
    const completedAt = '2026-04-13T13:03:00.000Z';
    const baseFile = createManifestEntry({
      id: 'file-1',
      name: 'main.dat',
      kind: 'dat',
      order: 0,
      enabled: true,
      text: 'MAIN',
      createdAt,
      updatedAt: createdAt,
    });
    const staleManifest = createProjectManifest({
      projectId: 'project-1',
      name: 'Autosave Project',
      createdAt,
      updatedAt: olderUpdatedAt,
      files: [{ ...baseFile, updatedAt: olderUpdatedAt, modifiedAt: olderUpdatedAt }],
      ui: {
        settings: {},
        parseSettings: {},
        exportFormat: 'points',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: {},
        selectedInstrument: '',
        levelLoopCustomPresets: [],
      },
    });
    const currentManifest = createProjectManifest({
      projectId: 'project-1',
      name: 'Autosave Project',
      createdAt,
      updatedAt: newerUpdatedAt,
      files: [{ ...baseFile, enabled: false, updatedAt: newerUpdatedAt, modifiedAt: newerUpdatedAt }],
      ui: staleManifest.ui,
      project: staleManifest.project,
    });
    const staleIndexRow: ProjectIndexRow = {
      id: 'project-1',
      name: 'Autosave Project',
      backend: 'indexeddb',
      rootKey: 'project-1',
      schemaVersion: 5,
      createdAt,
      updatedAt: olderUpdatedAt,
      lastOpenedAt: olderUpdatedAt,
    };
    const currentSession: ProjectSessionState = {
      indexRow: {
        ...staleIndexRow,
        updatedAt: newerUpdatedAt,
        lastOpenedAt: newerUpdatedAt,
      },
      manifest: currentManifest,
      sourceTexts: { 'file-1': 'MAIN' },
      dirtyFileIds: [],
      manifestDirty: true,
      autosaveState: 'saving',
      lastAutosavedAt: null,
      lastAutosaveError: null,
    };
    const savedSession: ProjectSessionState = {
      indexRow: staleIndexRow,
      manifest: staleManifest,
      sourceTexts: { 'file-1': 'MAIN' },
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: null,
      lastAutosaveError: null,
    };

    const merged = applyPersistedProjectSession({
      current: currentSession,
      saved: savedSession,
      requestedManifestUpdatedAt: olderUpdatedAt,
      completedAt,
    });

    expect(merged).not.toBeNull();
    expect(merged?.manifest.updatedAt).toBe(newerUpdatedAt);
    expect(merged?.manifest.files[0]?.enabled).toBe(false);
    expect(merged?.manifestDirty).toBe(true);
    expect(merged?.indexRow.updatedAt).toBe(olderUpdatedAt);
    expect(merged?.lastAutosavedAt).toBe(completedAt);
  });

  it('skips editor/include resync when toggling project-file run state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const setInputSpy = vi.fn();
    const setProjectIncludeFilesSpy = vi.fn();
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;

    const stores = {
      projectIndex: new Map<string, unknown>(),
      projectManifest: new Map<string, unknown>(),
      projectFile: new Map<string, unknown>(),
    };

    const createFakeRequest = <T,>(resolver: () => T, onComplete?: () => void): IDBRequest<T> => {
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
                      createFakeRequest(() => store.get(key), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    getAll: () =>
                      createFakeRequest(() => Array.from(store.values()), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    put: (value: unknown) =>
                      createFakeRequest(() => {
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
                      createFakeRequest(() => {
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
    window.prompt = vi.fn(() => 'Perf Project');

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInputState] = useState('NETWORK');
      const [projectIncludeFiles, setProjectIncludeFilesState] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [_importNotice, setImportNotice] = useState<{
        title: string;
        detailLines: string[];
      } | null>(null);

      const setInput = React.useCallback((value: React.SetStateAction<string>) => {
        setInputSpy(value);
        setInputState((current) => (typeof value === 'function' ? value(current) : value));
      }, []);

      const setProjectIncludeFiles = React.useCallback(
        (value: React.SetStateAction<Record<string, string>>) => {
          setProjectIncludeFilesSpy(value);
          setProjectIncludeFilesState((current) =>
            typeof value === 'function' ? value(current) : value,
          );
        },
        [],
      );

      const {
        createLocalProjectFromCurrentWorkspace,
        setProjectFileEnabled,
        activeProjectFileViews,
        projectSession,
      } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad: () => undefined,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      return (
        <div>
          <button type="button" id="create-project" onClick={() => void createLocalProjectFromCurrentWorkspace()}>
            create
          </button>
          <button
            type="button"
            id="toggle-enabled"
            onClick={() => {
              const target = activeProjectFileViews[0];
              if (target) setProjectFileEnabled(target.id, !target.enabled);
            }}
          >
            toggle
          </button>
          <div id="project-id">{projectSession?.manifest.projectId ?? '-'}</div>
          <div id="file-enabled">{String(activeProjectFileViews[0]?.enabled ?? false)}</div>
        </div>
      );
    };

    try {
      await act(async () => {
        root.render(<Harness />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });

      expect(container.querySelector('#project-id')?.textContent).not.toBe('-');
      expect(container.querySelector('#file-enabled')?.textContent).toBe('true');

      setInputSpy.mockClear();
      setProjectIncludeFilesSpy.mockClear();

      await act(async () => {
        (container.querySelector('#toggle-enabled') as HTMLButtonElement).click();
      });

      expect(container.querySelector('#file-enabled')?.textContent).toBe('false');
      expect(setInputSpy).not.toHaveBeenCalled();
      expect(setProjectIncludeFilesSpy).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      window.prompt = originalPrompt;
    }
  });

  it('waits one minute before autosaving dirty project edits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T15:00:00.000Z'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;

    const stores = {
      projectIndex: new Map<string, unknown>(),
      projectManifest: new Map<string, unknown>(),
      projectFile: new Map<string, unknown>(),
    };

    const createFakeRequest = <T,>(resolver: () => T, onComplete?: () => void): IDBRequest<T> => {
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
                      createFakeRequest(() => store.get(key), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    getAll: () =>
                      createFakeRequest(() => Array.from(store.values()), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    put: (value: unknown) =>
                      createFakeRequest(() => {
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
                      createFakeRequest(() => {
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
    window.prompt = vi.fn(() => 'Autosave Project');

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('NETWORK');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [_importNotice, setImportNotice] = useState<{
        title: string;
        detailLines: string[];
      } | null>(null);

      const { createLocalProjectFromCurrentWorkspace, handleEditorInputChange, projectSession } =
        useProjectFileWorkflow({
          projectFileInputRef,
          projectSourceFileInputRef,
          input,
          projectIncludeFiles,
          settings,
          parseSettings,
          exportFormat,
          adjustedPointsExportSettings,
          savedRunSnapshots,
          projectInstruments,
          selectedInstrument,
          levelLoopCustomPresets,
          setInput,
          setProjectIncludeFiles,
          setSettings,
          setParseSettings,
          setGeoidSourceData,
          setGeoidSourceDataLabel,
          setExportFormat,
          setAdjustedPointsExportSettings,
          setProjectInstruments,
          setSelectedInstrument,
          setLevelLoopCustomPresets,
          setSettingsDraft,
          setParseSettingsDraft,
          setGeoidSourceDataDraft,
          setGeoidSourceDataLabelDraft,
          setProjectInstrumentsDraft,
          setSelectedInstrumentDraft,
          setLevelLoopCustomPresetsDraft,
          setAdjustedPointsExportSettingsDraft,
          setIsAdjustedPointsTransformSelectOpen,
          setAdjustedPointsTransformSelectedDraft,
          setImportNotice,
          resetWorkspaceAfterProjectLoad: () => undefined,
          restoreSavedRunSnapshots: setSavedRunSnapshots,
          normalizeUiTheme,
          normalizeSolveProfile,
          buildObservationModeFromGridFields,
          cloneInstrumentLibrary,
        });

      return (
        <div>
          <button type="button" id="create-project" onClick={() => void createLocalProjectFromCurrentWorkspace()}>
            create
          </button>
          <button type="button" id="edit-input" onClick={() => handleEditorInputChange('NETWORK\nC P1 0 0 0')}>
            edit
          </button>
          <div id="last-autosaved-at">{projectSession?.lastAutosavedAt ?? '-'}</div>
        </div>
      );
    };

    try {
      await act(async () => {
        root.render(<Harness />);
      });

      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        await vi.runAllTimersAsync();
      });

      const initialLastAutosavedAt = container.querySelector('#last-autosaved-at')?.textContent;
      expect(initialLastAutosavedAt).toBe('2026-04-13T15:00:00.000Z');

      await act(async () => {
        (container.querySelector('#edit-input') as HTMLButtonElement).click();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(container.querySelector('#last-autosaved-at')?.textContent).toBe(initialLastAutosavedAt);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.runAllTimersAsync();
      });
      expect(container.querySelector('#last-autosaved-at')?.textContent).toContain(
        '2026-04-13T15:01:00.',
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      window.prompt = originalPrompt;
      vi.useRealTimers();
    }
  });

  it('imports multiple dat files into the current project as new source files', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalFileReader = globalThis.FileReader;

    const stores = {
      projectIndex: new Map<string, unknown>(),
      projectManifest: new Map<string, unknown>(),
      projectFile: new Map<string, unknown>(),
    };

    const createFakeRequest = <T,>(resolver: () => T, onComplete?: () => void): IDBRequest<T> => {
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
                      createFakeRequest(() => store.get(key), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    getAll: () =>
                      createFakeRequest(() => Array.from(store.values()), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    put: (value: unknown) =>
                      createFakeRequest(() => {
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
                      createFakeRequest(() => {
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
    window.prompt = vi.fn(() => 'Source Import Project');

    class MockFileReader {
      public result: string | null = null;
      public onload: null | (() => void) = null;
      public onerror: null | (() => void) = null;

      readAsText(file: Blob) {
        const namedFile = file as File;
        this.result = namedFile.name === 'traverse.dat' ? 'TRAVERSE' : 'CONTROL';
        this.onload?.();
      }
    }

    (globalThis as { FileReader: typeof FileReader }).FileReader =
      MockFileReader as unknown as typeof FileReader;

    const waitForText = async (selector: string, matcher: (_text: string) => boolean) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const text = container.querySelector(selector)?.textContent ?? '';
        if (matcher(text)) return text;
        await act(async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
        });
      }
      return container.querySelector(selector)?.textContent ?? '';
    };

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('NETWORK');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [_importNotice, setImportNotice] = useState<{
        title: string;
        detailLines: string[];
      } | null>(null);

      const {
        createLocalProjectFromCurrentWorkspace,
        importProjectSourceFiles,
        activeProjectFileViews,
        currentProjectFile,
      } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad: () => undefined,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      return (
        <div>
          <button type="button" id="create-project" onClick={() => void createLocalProjectFromCurrentWorkspace()}>
            create
          </button>
          <button
            type="button"
            id="import-sources"
            onClick={() =>
              void importProjectSourceFiles([
                new File(['TRAVERSE'], 'traverse.dat', { type: 'text/plain' }),
                new File(['CONTROL'], 'control.dat', { type: 'text/plain' }),
              ])
            }
          >
            import
          </button>
          <div id="file-names">{activeProjectFileViews.map((file) => file.name).join('|')}</div>
          <div id="active-file">{currentProjectFile?.name ?? '-'}</div>
          <div id="input">{input}</div>
        </div>
      );
    };

    try {
      await act(async () => {
        root.render(<Harness />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
      });
      expect(await waitForText('#file-names', (text) => text.includes('main.dat'))).toContain('main.dat');

      await act(async () => {
        (container.querySelector('#import-sources') as HTMLButtonElement).click();
      });
      expect(await waitForText('#file-names', (text) => text.includes('traverse'))).toContain('traverse');

      expect(container.querySelector('#file-names')?.textContent).toContain('traverse');
      expect(container.querySelector('#file-names')?.textContent).toContain('control');
      expect(container.querySelector('#active-file')?.textContent).toBe('control');
      expect(container.querySelector('#input')?.textContent).toBe('CONTROL');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      window.prompt = originalPrompt;
      (globalThis as { FileReader: typeof FileReader }).FileReader = originalFileReader;
    }
  });

  it('writes a serialized project through the save picker', async () => {
    const write = vi.fn(async (_content: string) => undefined);
    const close = vi.fn(async () => undefined);
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    const previousPicker = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = showSaveFilePicker;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('NETWORK');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [importNotice, setImportNotice] = useState<{ title: string; detailLines: string[] } | null>(
        null,
      );

      const { exportPortableProject } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad: () => undefined,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      return (
        <div>
          <button type="button" onClick={() => void exportPortableProject()}>
            export
          </button>
          <div id="notice">{importNotice?.title ?? '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    const firstWriteArg = write.mock.calls[0]?.[0] as string | undefined;
    expect(String(firstWriteArg ?? '')).toContain('"kind": "webnet-project"');
    expect(close).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#notice')?.textContent).toBe('Portable project exported');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker = previousPicker;
  });

  it('loads a project file, applies normalized state, and resets workspace state', async () => {
    const resetWorkspaceAfterProjectLoad = vi.fn();
    const originalFileReader = globalThis.FileReader;

    const loadedProjectText = serializeProjectFile({
      input: 'LOADED NETWORK',
      includeFiles: { 'child.dat': 'C P1 0 0 0' },
      savedRuns: [
        {
          id: 'saved-run-1',
          sourceRunId: 'run-9',
          createdAt: '2026-03-20T08:00:00.000Z',
          savedAt: '2026-03-20T08:05:00.000Z',
          label: 'Saved Run 09',
          notes: '',
          inputFingerprint: 'fnv1a:abc',
          settingsFingerprint: 'fnv1a:def',
          summary: {
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stationCount: 1,
            observationCount: 0,
            suspectObservationCount: 0,
            maxAbsStdRes: 0,
          },
          result: {
            success: true,
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stations: {
              P1: { x: 0, y: 0, h: 0, fixed: true },
            },
            observations: [],
            logs: [],
          },
          runDiagnostics: null,
          settingsSnapshot: {
            solveProfile: 'industry-parity',
          } as unknown as RunSettingsSnapshot,
          excludedIds: [],
          overrideIds: [],
          overrides: {},
          approvedClusterMerges: [],
          reopenState: null,
        },
      ],
      ui: {
        settings: {
          ...baseSettings,
          uiTheme: 'gruvbox-light',
          precisionReportingMode: 'posterior-scaled',
          listingShowLostStations: false,
        },
        parseSettings: {
          ...baseParseSettings,
          solveProfile: 'industry-parity' as SolveProfile,
          runMode: 'preanalysis',
          preanalysisMode: true,
          crsTransformEnabled: true,
          crsProjectionModel: 'local-enu',
          crsLabel: 'Legacy Grid',
          geoidSourcePath: '',
        },
        exportFormat: 'geojson',
        adjustedPointsExport: cloneAdjustedPointsExportSettings({
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          includeLostStations: false,
        }),
      },
      project: {
        projectInstruments: {
          T1: { code: 'T1' } as InstrumentLibrary['T1'],
        },
        selectedInstrument: 'T1',
        levelLoopCustomPresets: [
          { id: 'custom-1', name: 'Custom', baseMm: 1, perSqrtKmMm: 2 },
        ],
      },
    });

    class MockFileReader {
      public result: string | null = null;
      public onload: null | (() => void) = null;

      readAsText() {
        this.result = loadedProjectText;
        this.onload?.();
      }
    }

    (globalThis as { FileReader: typeof FileReader }).FileReader =
      MockFileReader as unknown as typeof FileReader;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('ORIGINAL');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(
        new Uint8Array([1]),
      );
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('old');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(
        new Uint8Array([2]),
      );
      const [geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('draft');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(true);
      const [adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>(['P1']);
      const [importNotice, setImportNotice] = useState<{ title: string; detailLines: string[] } | null>(
        null,
      );

      const { handleProjectFileChange } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      const triggerLoad = () => {
        const file = new File(['ignored'], 'loaded.wnproj.json', { type: 'application/json' });
        handleProjectFileChange({
          target: {
            files: [file],
            value: 'loaded.wnproj.json',
          },
        } as unknown as ChangeEvent<HTMLInputElement>);
      };

      return (
        <div>
          <button type="button" onClick={triggerLoad}>
            load
          </button>
          <div id="input">{input}</div>
          <div id="theme">{settings.uiTheme}</div>
          <div id="precision-mode">{settings.precisionReportingMode}</div>
          <div id="run-mode">{parseSettings.runMode}</div>
          <div id="export">{exportFormat}</div>
          <div id="instrument">{selectedInstrument}</div>
          <div id="include-count">{Object.keys(projectIncludeFiles).length}</div>
          <div id="saved-runs">{savedRunSnapshots.length}</div>
          <div id="draft-theme">{settingsDraft.uiTheme}</div>
          <div id="draft-precision-mode">{settingsDraft.precisionReportingMode}</div>
          <div id="draft-run-mode">{parseSettingsDraft.runMode}</div>
          <div id="crs-transform">{parseSettings.crsTransformEnabled ? 'on' : 'off'}</div>
          <div id="crs-model">{parseSettings.crsProjectionModel}</div>
          <div id="crs-label">{parseSettings.crsLabel || '-'}</div>
          <div id="draft-crs-transform">{parseSettingsDraft.crsTransformEnabled ? 'on' : 'off'}</div>
          <div id="draft-crs-model">{parseSettingsDraft.crsProjectionModel}</div>
          <div id="draft-crs-label">{parseSettingsDraft.crsLabel || '-'}</div>
          <div id="draft-open">{isAdjustedPointsTransformSelectOpen ? 'open' : 'closed'}</div>
          <div id="draft-selected">{adjustedPointsTransformSelectedDraft.length}</div>
          <div id="notice">{importNotice?.title ?? '-'}</div>
          <div id="geoid-label">{geoidSourceDataLabel || '-'}</div>
          <div id="draft-geoid">{geoidSourceDataLabelDraft || '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(container.querySelector('#input')?.textContent).toBe('LOADED NETWORK');
    expect(container.querySelector('#theme')?.textContent).toBe('gruvbox-light');
    expect(container.querySelector('#precision-mode')?.textContent).toBe('industry-standard');
    expect(container.querySelector('#run-mode')?.textContent).toBe('preanalysis');
    expect(container.querySelector('#export')?.textContent).toBe('geojson');
    expect(container.querySelector('#instrument')?.textContent).toBe('T1');
    expect(container.querySelector('#include-count')?.textContent).toBe('1');
    expect(container.querySelector('#saved-runs')?.textContent).toBe('1');
    expect(container.querySelector('#draft-theme')?.textContent).toBe('gruvbox-light');
    expect(container.querySelector('#draft-precision-mode')?.textContent).toBe(
      'industry-standard',
    );
    expect(container.querySelector('#draft-run-mode')?.textContent).toBe('preanalysis');
    expect(container.querySelector('#crs-transform')?.textContent).toBe('off');
    expect(container.querySelector('#crs-model')?.textContent).toBe('legacy-equirectangular');
    expect(container.querySelector('#crs-label')?.textContent).toBe('-');
    expect(container.querySelector('#draft-crs-transform')?.textContent).toBe('off');
    expect(container.querySelector('#draft-crs-model')?.textContent).toBe(
      'legacy-equirectangular',
    );
    expect(container.querySelector('#draft-crs-label')?.textContent).toBe('-');
    expect(container.querySelector('#draft-open')?.textContent).toBe('closed');
    expect(container.querySelector('#draft-selected')?.textContent).toBe('0');
    expect(container.querySelector('#notice')?.textContent).toBe('Portable project loaded');
    expect(container.querySelector('#geoid-label')?.textContent).toBe('-');
    expect(container.querySelector('#draft-geoid')?.textContent).toBe('-');
    expect(resetWorkspaceAfterProjectLoad).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as { FileReader: typeof FileReader }).FileReader = originalFileReader;
  });

  it('loads a workspace-shaped portable project with a non-main focused file and restores the other file texts', async () => {
    const resetWorkspaceAfterProjectLoad = vi.fn();
    const originalFileReader = globalThis.FileReader;

    const loadedProjectText = serializeProjectFile({
      input: 'CHILD CONTENT',
      includeFiles: {
        'main.dat': 'MAIN CONTENT',
        'notes.txt': 'NOTES CONTENT',
      },
      workspaceFileContents: {
        'file-main': 'MAIN CONTENT',
        'file-child': 'CHILD CONTENT',
        'file-notes': 'NOTES CONTENT',
      },
      savedRuns: [],
      ui: {
        settings: baseSettings,
        parseSettings: baseParseSettings,
        exportFormat: 'points',
        adjustedPointsExport: cloneAdjustedPointsExportSettings(
          DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        ),
      },
      project: {
        projectInstruments: {
          S9: { code: 'S9' } as InstrumentLibrary['S9'],
        },
        selectedInstrument: 'S9',
        levelLoopCustomPresets: [],
      },
      workspace: {
        projectId: 'project-2',
        name: 'Focused Child Project',
        createdAt: '2026-04-13T11:00:00.000Z',
        updatedAt: '2026-04-13T11:05:00.000Z',
        files: [
          {
            id: 'file-main',
            name: 'main.dat',
            kind: 'dat',
            path: 'data/file-main-main.dat',
            enabled: true,
            order: 0,
          },
          {
            id: 'file-child',
            name: 'child.dat',
            kind: 'dat',
            path: 'data/file-child-child.dat',
            enabled: true,
            order: 1,
          },
          {
            id: 'file-notes',
            name: 'notes.txt',
            kind: 'notes',
            path: 'data/file-notes-notes.txt',
            enabled: false,
            order: 2,
          },
        ],
        openFileIds: ['file-main', 'file-child'],
        focusedFileId: 'file-child',
        mainFileId: 'file-main',
      },
    });

    class MockFileReader {
      public result: string | null = null;
      public onload: null | (() => void) = null;

      readAsText() {
        this.result = loadedProjectText;
        this.onload?.();
      }
    }

    (globalThis as { FileReader: typeof FileReader }).FileReader =
      MockFileReader as unknown as typeof FileReader;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('ORIGINAL');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [importNotice, setImportNotice] = useState<{ title: string; detailLines: string[] } | null>(
        null,
      );

      const { handleProjectFileChange } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      const triggerLoad = () => {
        const file = new File(['ignored'], 'focused-child.wnproj.json', {
          type: 'application/json',
        });
        handleProjectFileChange({
          target: {
            files: [file],
            value: 'focused-child.wnproj.json',
          },
        } as unknown as ChangeEvent<HTMLInputElement>);
      };

      return (
        <div>
          <button type="button" onClick={triggerLoad}>
            load
          </button>
          <div id="input">{input}</div>
          <div id="include-json">{JSON.stringify(projectIncludeFiles)}</div>
          <div id="notice">{importNotice?.title ?? '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(container.querySelector('#input')?.textContent).toBe('CHILD CONTENT');
    expect(container.querySelector('#include-json')?.textContent).toBe(
      JSON.stringify({
        'main.dat': 'MAIN CONTENT',
        'notes.txt': 'NOTES CONTENT',
      }),
    );
    expect(container.querySelector('#notice')?.textContent).toBe('Portable project loaded');
    expect(resetWorkspaceAfterProjectLoad).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as { FileReader: typeof FileReader }).FileReader = originalFileReader;
  });
});
