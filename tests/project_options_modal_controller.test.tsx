/** @vitest-environment jsdom */

import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ParseSettings, SettingsState, SolveProfile } from '../src/appStateTypes';
import type {
  AdjustedPointsColumnId,
  CustomLevelLoopTolerancePreset,
  Instrument,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../src/types';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import { useProjectOptionsModalController } from '../src/hooks/useProjectOptionsModalController';
import { useProjectOptionsState } from '../src/hooks/useProjectOptionsState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
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
  solveProfile: 'industry-parity-current',
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
  autoAdjustEnabled: true,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 3,
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
  levelLoopToleranceBaseMm: 4,
  levelLoopTolerancePerSqrtKmMm: 2,
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

const createInstrument = (code: string, desc = ''): Instrument => ({
  code,
  desc,
  edm_const: 0,
  edm_ppm: 0,
  hzPrecision_sec: 0,
  dirPrecision_sec: 0,
  azBearingPrecision_sec: 0,
  vaPrecision_sec: 0,
  instCentr_m: 0,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
});

const normalizeUiTheme = (value: unknown): SettingsState['uiTheme'] => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

const normalizeSolveProfile = (
  profile: SolveProfile,
): Exclude<SolveProfile, 'industry-parity'> => {
  if (profile === 'industry-parity') return 'industry-parity-current';
  return profile;
};

const createCustomLevelLoopTolerancePreset = (
  seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
): CustomLevelLoopTolerancePreset => ({
  id: 'custom-seed',
  name: seed?.name?.trim() || 'Custom Preset',
  baseMm: seed?.baseMm ?? 0,
  perSqrtKmMm: seed?.perSqrtKmMm ?? 4,
});

const resolveLevelLoopTolerancePreset = (
  _presets: CustomLevelLoopTolerancePreset[],
  _baseMm: number,
  _perSqrtKmMm: number,
) => ({
  id: 'custom',
  label: 'Custom',
  description: 'Custom tolerance model.',
});

describe('useProjectOptionsModalController', () => {
  it('applies solve-profile and run-mode linked draft updates through the extracted controller', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: createInstrument('S9', 'S9'),
      });
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] = useState(() =>
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      );
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('webnet');
      const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
      const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);

      const projectOptionsState = useProjectOptionsState({
        initialSettingsModalOpen: false,
        initialOptionsTab: 'general',
        settings,
        setSettings,
        parseSettings,
        setParseSettings,
        geoidSourceData,
        setGeoidSourceData,
        geoidSourceDataLabel,
        setGeoidSourceDataLabel,
        projectInstruments,
        setProjectInstruments,
        levelLoopCustomPresets,
        setLevelLoopCustomPresets,
        adjustedPointsExportSettings,
        setAdjustedPointsExportSettings,
        selectedInstrument,
        setSelectedInstrument,
        cloneInstrumentLibrary,
        cloneAdjustedPointsExportSettings,
        sanitizeAdjustedPointsExportSettings: (draft) =>
          sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        normalizeUiTheme,
        resolveCatalogGroupFromCrsId: () => 'all',
        parseTransformAngleInput: (raw) => {
          const parsed = Number.parseFloat(raw);
          return Number.isFinite(parsed) ? parsed : null;
        },
      });

      const controller = useProjectOptionsModalController({
        projectOptionsState,
        adjustedPointsDraftStationIds: ['P1', 'P2'],
        adjustedPointsTransformDraftValidationMessage: null,
        crsCatalogGroupCounts: {},
        filteredDraftCrsCatalog: [],
        searchedDraftCrsCatalog: [],
        visibleDraftCrsCatalog: [],
        selectedDraftCrs: undefined,
        selectedCrsProj4Params: [],
        exportFormat,
        setExportFormat,
        handleSaveProject: () => undefined,
        triggerProjectFileSelect: () => undefined,
        geoidSourceFileInputRef,
        settingsModalContentRef,
        adjustedPointsDragRef,
        runDiagnostics: null,
        normalizeSolveProfile,
        normalizeUiTheme,
        buildObservationModeFromGridFields: (state) => ({
          bearing: state.gridBearingMode,
          distance: state.gridDistanceMode,
          angle: state.gridAngleMode,
          direction: state.gridDirectionMode,
        }),
        createInstrument,
        createCustomLevelLoopTolerancePreset,
        resolveLevelLoopTolerancePreset,
        staticContext: {
          FT_PER_M: 3.280839895,
        },
      });

      const context = controller.projectOptionsModalContext as {
        handleDraftParseSetting: <K extends keyof ParseSettings>(
          _key: K,
          _value: ParseSettings[K],
        ) => void;
        parseSettingsDraft: ParseSettings;
      };

      return (
        <div>
          <div data-parse-mode>{context.parseSettingsDraft.parseCompatibilityMode}</div>
          <div data-face-mode>{context.parseSettingsDraft.faceNormalizationMode}</div>
          <div data-normalize>{String(context.parseSettingsDraft.normalize)}</div>
          <div data-run-mode>{context.parseSettingsDraft.runMode}</div>
          <div data-preanalysis>{String(context.parseSettingsDraft.preanalysisMode)}</div>
          <div data-autoadjust>{String(context.parseSettingsDraft.autoAdjustEnabled)}</div>
          <button
            type="button"
            onClick={() =>
              context.handleDraftParseSetting('solveProfile', 'industry-parity-legacy')
            }
          >
            legacy-profile
          </button>
          <button
            type="button"
            onClick={() => context.handleDraftParseSetting('runMode', 'preanalysis')}
          >
            preanalysis-mode
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('legacy-profile');
    expect(container.querySelector('[data-parse-mode]')?.textContent).toBe('strict');
    expect(container.querySelector('[data-face-mode]')?.textContent).toBe('off');
    expect(container.querySelector('[data-normalize]')?.textContent).toBe('false');

    await click('preanalysis-mode');
    expect(container.querySelector('[data-run-mode]')?.textContent).toBe('preanalysis');
    expect(container.querySelector('[data-preanalysis]')?.textContent).toBe('true');
    expect(container.querySelector('[data-autoadjust]')?.textContent).toBe('false');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('filters transform-scope selections to adjusted stations when the extracted controller applies them', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: createInstrument('S9', 'S9'),
      });
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] = useState(() =>
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      );
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('webnet');
      const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
      const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);

      const projectOptionsState = useProjectOptionsState({
        initialSettingsModalOpen: false,
        initialOptionsTab: 'general',
        settings,
        setSettings,
        parseSettings,
        setParseSettings,
        geoidSourceData,
        setGeoidSourceData,
        geoidSourceDataLabel,
        setGeoidSourceDataLabel,
        projectInstruments,
        setProjectInstruments,
        levelLoopCustomPresets,
        setLevelLoopCustomPresets,
        adjustedPointsExportSettings,
        setAdjustedPointsExportSettings,
        selectedInstrument,
        setSelectedInstrument,
        cloneInstrumentLibrary,
        cloneAdjustedPointsExportSettings,
        sanitizeAdjustedPointsExportSettings: (draft) =>
          sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        normalizeUiTheme,
        resolveCatalogGroupFromCrsId: () => 'all',
        parseTransformAngleInput: (raw) => {
          const parsed = Number.parseFloat(raw);
          return Number.isFinite(parsed) ? parsed : null;
        },
      });

      const controller = useProjectOptionsModalController({
        projectOptionsState,
        adjustedPointsDraftStationIds: ['P1', 'P2'],
        adjustedPointsTransformDraftValidationMessage: null,
        crsCatalogGroupCounts: {},
        filteredDraftCrsCatalog: [],
        searchedDraftCrsCatalog: [],
        visibleDraftCrsCatalog: [],
        selectedDraftCrs: undefined,
        selectedCrsProj4Params: [],
        exportFormat,
        setExportFormat,
        handleSaveProject: () => undefined,
        triggerProjectFileSelect: () => undefined,
        geoidSourceFileInputRef,
        settingsModalContentRef,
        adjustedPointsDragRef,
        runDiagnostics: null,
        normalizeSolveProfile,
        normalizeUiTheme,
        buildObservationModeFromGridFields: (state) => ({
          bearing: state.gridBearingMode,
          distance: state.gridDistanceMode,
          angle: state.gridAngleMode,
          direction: state.gridDirectionMode,
        }),
        createInstrument,
        createCustomLevelLoopTolerancePreset,
        resolveLevelLoopTolerancePreset,
        staticContext: {
          FT_PER_M: 3.280839895,
        },
      });

      const context = controller.projectOptionsModalContext as {
        adjustedPointsExportSettingsDraft: typeof adjustedPointsExportSettings;
        openAdjustedPointsTransformSelectModal: () => void;
      };

      return (
        <div>
          <div data-selected>
            {context.adjustedPointsExportSettingsDraft.transform.selectedStationIds.join(',')}
          </div>
          <button type="button" onClick={context.openAdjustedPointsTransformSelectModal}>
            open-scope
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('P1', true)}
          >
            select-p1
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('P2', true)}
          >
            select-p2
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('MISSING', true)}
          >
            select-missing
          </button>
          <button type="button" onClick={controller.applyAdjustedPointsTransformSelection}>
            apply-scope
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('open-scope');
    await click('select-p1');
    await click('select-p2');
    await click('select-missing');
    await click('apply-scope');

    expect(container.querySelector('[data-selected]')?.textContent).toBe('P1,P2');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps transform-scope OK/Cancel semantics deterministic in the extracted controller', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: createInstrument('S9', 'S9'),
      });
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] = useState(() =>
        cloneAdjustedPointsExportSettings({
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          transform: {
            ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS.transform,
            selectedStationIds: ['P1'],
          },
        }),
      );
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('webnet');
      const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
      const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);

      const projectOptionsState = useProjectOptionsState({
        initialSettingsModalOpen: false,
        initialOptionsTab: 'general',
        settings,
        setSettings,
        parseSettings,
        setParseSettings,
        geoidSourceData,
        setGeoidSourceData,
        geoidSourceDataLabel,
        setGeoidSourceDataLabel,
        projectInstruments,
        setProjectInstruments,
        levelLoopCustomPresets,
        setLevelLoopCustomPresets,
        adjustedPointsExportSettings,
        setAdjustedPointsExportSettings,
        selectedInstrument,
        setSelectedInstrument,
        cloneInstrumentLibrary,
        cloneAdjustedPointsExportSettings,
        sanitizeAdjustedPointsExportSettings: (draft) =>
          sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        normalizeUiTheme,
        resolveCatalogGroupFromCrsId: () => 'all',
        parseTransformAngleInput: (raw) => {
          const parsed = Number.parseFloat(raw);
          return Number.isFinite(parsed) ? parsed : null;
        },
      });

      const controller = useProjectOptionsModalController({
        projectOptionsState,
        adjustedPointsDraftStationIds: ['P1', 'P2'],
        adjustedPointsTransformDraftValidationMessage: null,
        crsCatalogGroupCounts: {},
        filteredDraftCrsCatalog: [],
        searchedDraftCrsCatalog: [],
        visibleDraftCrsCatalog: [],
        selectedDraftCrs: undefined,
        selectedCrsProj4Params: [],
        exportFormat,
        setExportFormat,
        handleSaveProject: () => undefined,
        triggerProjectFileSelect: () => undefined,
        geoidSourceFileInputRef,
        settingsModalContentRef,
        adjustedPointsDragRef,
        runDiagnostics: null,
        normalizeSolveProfile,
        normalizeUiTheme,
        buildObservationModeFromGridFields: (state) => ({
          bearing: state.gridBearingMode,
          distance: state.gridDistanceMode,
          angle: state.gridAngleMode,
          direction: state.gridDirectionMode,
        }),
        createInstrument,
        createCustomLevelLoopTolerancePreset,
        resolveLevelLoopTolerancePreset,
        staticContext: {
          FT_PER_M: 3.280839895,
        },
      });

      const context = controller.projectOptionsModalContext as {
        adjustedPointsExportSettingsDraft: typeof adjustedPointsExportSettings;
        openAdjustedPointsTransformSelectModal: () => void;
      };

      return (
        <div>
          <div data-open>{String(projectOptionsState.isAdjustedPointsTransformSelectOpen)}</div>
          <div data-draft>{projectOptionsState.adjustedPointsTransformSelectedDraft.join(',')}</div>
          <div data-selected>
            {context.adjustedPointsExportSettingsDraft.transform.selectedStationIds.join(',')}
          </div>
          <button type="button" onClick={context.openAdjustedPointsTransformSelectModal}>
            open-scope
          </button>
          <button
            type="button"
            onClick={() => controller.handleAdjustedPointsTransformToggleSelected('P2', true)}
          >
            draft-p2
          </button>
          <button
            type="button"
            onClick={controller.closeAdjustedPointsTransformSelectModal}
          >
            cancel-scope
          </button>
          <button type="button" onClick={controller.applyAdjustedPointsTransformSelection}>
            apply-scope
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    expect(container.querySelector('[data-open]')?.textContent).toBe('false');
    expect(container.querySelector('[data-selected]')?.textContent).toBe('P1');

    await click('open-scope');
    expect(container.querySelector('[data-open]')?.textContent).toBe('true');
    expect(container.querySelector('[data-draft]')?.textContent).toBe('P1');

    await click('draft-p2');
    expect(container.querySelector('[data-draft]')?.textContent).toBe('P1,P2');

    await click('cancel-scope');
    expect(container.querySelector('[data-open]')?.textContent).toBe('false');
    expect(container.querySelector('[data-draft]')?.textContent).toBe('');
    expect(container.querySelector('[data-selected]')?.textContent).toBe('P1');

    await click('open-scope');
    expect(container.querySelector('[data-draft]')?.textContent).toBe('P1');
    await click('draft-p2');
    await click('apply-scope');

    expect(container.querySelector('[data-open]')?.textContent).toBe('false');
    expect(container.querySelector('[data-draft]')?.textContent).toBe('');
    expect(container.querySelector('[data-selected]')?.textContent).toBe('P1,P2');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
