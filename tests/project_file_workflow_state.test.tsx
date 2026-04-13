/** @vitest-environment jsdom */

import React, { act, useRef, useState, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { cloneAdjustedPointsExportSettings, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../src/engine/adjustedPointsExport';
import { serializeProjectFile } from '../src/engine/projectFile';
import { useProjectFileWorkflow } from '../src/hooks/useProjectFileWorkflow';
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
