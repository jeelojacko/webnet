/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  act,
  useRef,
  useState,
  createRoot,
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  useProjectFileWorkflow,
  baseSettings,
  baseParseSettings,
  cloneInstrumentLibrary,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  installProjectWorkflowFakeIndexedDb,
} from './projectFileWorkflowStateTestSupport';
import type {
  Root,
  ParseSettings,
  PersistedSavedRunSnapshot,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from './projectFileWorkflowStateTestSupport';

describe('useProjectFileWorkflow', () => {
  it('imports associated snproj settings without replacing the current project file manifest', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalFileReader = globalThis.FileReader;

    installProjectWorkflowFakeIndexedDb('Associated Settings Project');

    const snprojText = [
      '[Adjustment]',
      'RUN_MODE=PREANALYSIS',
      'ADJUSTMENT_TYPE=3D',
      'LOCAL_OR_GRID_ADJUSTMENT=1',
      'COORDINATE_SYSTEM_NAME=Canada NAD83(CSRS) / MTM Zone 10',
      'COORDINATE_ORDER=NE',
      '3D_INPUT_MODE=Slope/Zenith',
      'INDEX_OF_REFRACTION=0.07',
      'FIXED_LINEAR_STD_ERR=0.0000001',
      'FIXED_ANGULAR_STD_ERR=0.0010001',
      'CONVERGE_LIMIT=0.005',
      'MAXIMUM_ITERATIONS=25',
      'GEOID_HEIGHT=12.5',
      'VERT_DEFL_NORTH=1.2',
      'VERT_DEFL_EAST=-0.8',
      '[Listing]',
      'LIST_COORDINATES=0',
      'LIST_ADJ_OBS_RESIDUALS=0',
      'LIST_STANDARD_DEVIATIONS=1',
      'LIST_BEARING=0',
      '[Instrument]',
      'DISTANCE_STD_ERR=0.002',
      'EDM_PPM=1.5',
      'ANGLE_STD_ERR=5',
      'DIRECTION_STD_ERR=7',
      'AZIMUTH_STD_ERR=9',
      'ZENITH_STD_ERR=11',
      'INSTRUMENT_CENTERING_ERROR=0.003',
      'TARGET_CENTERING_ERROR=0.004',
      'VERTICAL_CENTERING_ERROR=0.005',
      'DELTA_ELEV_STD_ERR=0.006',
      'DELTA_ELEV_PPM=2.5',
      'LEVEL_STD_ERR=0.0075',
      '[DataFileList]',
      'FILE1=TRAVERSE.DAT',
      '',
    ].join('\n');

    class MockFileReader {
      public result: string | null = null;
      public onload: null | (() => void) = null;

      readAsText() {
        this.result = snprojText;
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
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(
        new Uint8Array([1]),
      );
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('existing');
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
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(
        new Uint8Array([2]),
      );
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('draft');
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
        useState(true);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>(['P1']);
      const [importNotice, setImportNotice] = useState<{ title: string; detailLines: string[] } | null>(
        null,
      );

      const {
        createLocalProjectFromCurrentWorkspace,
        prepareAssociatedProjectSettingsImport,
        importAssociatedProjectSettingsFile,
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
            id="prepare-settings"
            onClick={() =>
              void prepareAssociatedProjectSettingsImport(
                new File(['ignored'], 'associated.snproj', { type: 'text/plain' }),
              )
            }
          >
            prepare-settings
          </button>
          <button
            type="button"
            id="import-settings"
            onClick={() =>
              void importAssociatedProjectSettingsFile(
                new File(['ignored'], 'associated.snproj', { type: 'text/plain' }),
              )
            }
          >
            import-settings
          </button>
          <div id="file-names">{activeProjectFileViews.map((file) => file.name).join('|')}</div>
          <div id="active-file">{currentProjectFile?.name ?? '-'}</div>
          <div id="coord-mode">{parseSettings.coordMode}</div>
          <div id="run-mode">{parseSettings.runMode}</div>
          <div id="preanalysis">{parseSettings.preanalysisMode ? 'on' : 'off'}</div>
          <div id="coord-system">{parseSettings.coordSystemMode}</div>
          <div id="order">{parseSettings.order}</div>
          <div id="delta-mode">{parseSettings.deltaMode}</div>
          <div id="curv-ref">{parseSettings.applyCurvatureRefraction ? 'on' : 'off'}</div>
          <div id="refraction">{parseSettings.refractionCoefficient}</div>
          <div id="vertical-reduction">{parseSettings.verticalReduction}</div>
          <div id="geoid">{parseSettings.averageGeoidHeight}</div>
          <div id="vdn">{parseSettings.verticalDeflectionNorthSec}</div>
          <div id="vde">{parseSettings.verticalDeflectionEastSec}</div>
          <div id="qfix-linear">{parseSettings.qFixLinearSigmaM}</div>
          <div id="qfix-angular">{parseSettings.qFixAngularSigmaSec}</div>
          <div id="coords">{settings.listingShowCoordinates ? 'on' : 'off'}</div>
          <div id="residuals">{settings.listingShowObservationsResiduals ? 'on' : 'off'}</div>
          <div id="stdev">{settings.listingShowErrorPropagation ? 'on' : 'off'}</div>
          <div id="bearing">{settings.listingShowAzimuthsBearings ? 'on' : 'off'}</div>
          <div id="export">{exportFormat}</div>
          <div id="instrument">{selectedInstrument}</div>
          <div id="level-weight">{projectInstruments[selectedInstrument]?.levStd_mmPerKm ?? '-'}</div>
          <div id="notice">{importNotice?.title ?? '-'}</div>
          <div id="notice-detail">{importNotice?.detailLines.join('|') ?? '-'}</div>
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
      expect(await waitForText('#file-names', (text) => text.includes('main.dat'))).toContain(
        'main.dat',
      );
      await act(async () => {
        (container.querySelector('#prepare-settings') as HTMLButtonElement).click();
      });
      expect(container.querySelector('#notice')?.textContent).toBeTruthy();

      await act(async () => {
        (container.querySelector('#import-settings') as HTMLButtonElement).click();
      });
      expect(await waitForText('#coord-system', (text) => text === 'grid')).toBe('grid');

      expect(container.querySelector('#file-names')?.textContent).toBe('main.dat');
      expect(container.querySelector('#active-file')?.textContent).toBe('main.dat');
      expect(container.querySelector('#coord-mode')?.textContent).toBe('3D');
      expect(container.querySelector('#run-mode')?.textContent).toBe('preanalysis');
      expect(container.querySelector('#preanalysis')?.textContent).toBe('on');
      expect(container.querySelector('#coord-system')?.textContent).toBe('grid');
      expect(container.querySelector('#order')?.textContent).toBe('NE');
      expect(container.querySelector('#delta-mode')?.textContent).toBe('slope');
      expect(container.querySelector('#curv-ref')?.textContent).toBe('on');
      expect(container.querySelector('#refraction')?.textContent).toBe('0.07');
      expect(container.querySelector('#vertical-reduction')?.textContent).toBe('curvref');
      expect(container.querySelector('#qfix-linear')?.textContent).toBe('1e-7');
      expect(container.querySelector('#qfix-angular')?.textContent).toBe('0.0010001');
      expect(container.querySelector('#export')?.textContent).toBe('industry-style');
      expect(container.querySelector('#instrument')?.textContent).toBe('IMPORTED');
      expect(container.querySelector('#level-weight')?.textContent).toBe('0.0075');
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
});

