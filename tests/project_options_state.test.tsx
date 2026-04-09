/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS, cloneAdjustedPointsExportSettings, sanitizeAdjustedPointsExportSettings } from '../src/engine/adjustedPointsExport';
import { useProjectOptionsState } from '../src/hooks/useProjectOptionsState';
import type { ParseSettings, SettingsState } from '../src/appStateTypes';
import type { CustomLevelLoopTolerancePreset, InstrumentLibrary } from '../src/types';

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

const normalizeUiTheme = (value: unknown): SettingsState['uiTheme'] => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

describe('useProjectOptionsState', () => {
  it('reopens from committed state after cancel and applies committed edits after apply', async () => {
    document.documentElement.setAttribute('data-theme', 'gruvbox-dark');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: {
          code: 'S9',
          desc: 'S9',
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
        },
      });
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] = useState(() =>
        cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
      );
      const [selectedInstrument, setSelectedInstrument] = useState('S9');

      const state = useProjectOptionsState({
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

      return (
        <div>
          <div data-modal>{state.isSettingsModalOpen ? 'open' : 'closed'}</div>
          <div data-theme>{settings.uiTheme}</div>
          <div data-draft-theme>{state.settingsDraft.uiTheme}</div>
          <button onClick={state.openProjectOptions}>open</button>
          <button onClick={state.closeProjectOptions}>close</button>
          <button onClick={() => state.setSettingsDraft((prev) => ({ ...prev, uiTheme: 'gruvbox-light' }))}>
            light
          </button>
          <button onClick={() => state.applyProjectOptions()}>apply</button>
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

    await click('open');
    expect(container.querySelector('[data-modal]')?.textContent).toBe('open');
    expect(container.querySelector('[data-draft-theme]')?.textContent).toBe('gruvbox-dark');

    await click('light');
    expect(container.querySelector('[data-draft-theme]')?.textContent).toBe('gruvbox-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-light');

    await click('close');
    expect(container.querySelector('[data-modal]')?.textContent).toBe('closed');
    expect(container.querySelector('[data-theme]')?.textContent).toBe('gruvbox-dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-dark');

    await click('open');
    expect(container.querySelector('[data-draft-theme]')?.textContent).toBe('gruvbox-dark');

    await click('light');
    await click('apply');
    expect(container.querySelector('[data-modal]')?.textContent).toBe('closed');
    expect(container.querySelector('[data-theme]')?.textContent).toBe('gruvbox-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-light');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
