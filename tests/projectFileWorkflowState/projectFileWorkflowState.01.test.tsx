/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  act,
  useRef,
  useState,
  createRoot,
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
  MAX_PORTABLE_PROJECT_TEXT_BYTES,
  useProjectFileWorkflow,
  baseSettings,
  baseParseSettings,
  cloneInstrumentLibrary,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
} from './projectFileWorkflowStateTestSupport';
import type {
  ChangeEvent,
  Root,
  ParseSettings,
  PersistedSavedRunSnapshot,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from './projectFileWorkflowStateTestSupport';

describe('useProjectFileWorkflow', () => {
  it('rejects oversized portable project imports with explicit notice copy', async () => {
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
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({});
      const [selectedInstrument, setSelectedInstrument] = useState('');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('');
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
        resetWorkspaceAfterProjectLoad: () => undefined,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      return (
        <div>
          <button
            id="load-project"
            onClick={() =>
              void handleProjectFileChange({
                target: {
                  files: [
                    new File(['x'.repeat(MAX_PORTABLE_PROJECT_TEXT_BYTES + 1)], 'oversized.wnproj.json', {
                      type: 'application/json',
                    }),
                  ],
                  value: '',
                },
              } as unknown as ChangeEvent<HTMLInputElement>)
            }
          >
            load
          </button>
          <div id="notice-title">{importNotice?.title ?? '-'}</div>
          <div id="notice-detail">{importNotice?.detailLines.join('|') ?? '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('#load-project') as HTMLButtonElement).click();
    });

    expect(container.querySelector('#notice-title')?.textContent).toBe('Project load failed');
    expect(container.querySelector('#notice-detail')?.textContent).toContain('project file is too large');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('rejects oversized associated settings imports with explicit notice copy', async () => {
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
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({});
      const [selectedInstrument, setSelectedInstrument] = useState('');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('');
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

      const { prepareAssociatedProjectSettingsImport } = useProjectFileWorkflow({
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
          <button
            id="load-settings"
            onClick={() =>
              void prepareAssociatedProjectSettingsImport(
                new File(['x'.repeat(MAX_ASSOCIATED_SETTINGS_TEXT_BYTES + 1)], 'oversized.snproj', {
                  type: 'text/plain',
                }),
              )
            }
          >
            settings
          </button>
          <div id="notice-title">{importNotice?.title ?? '-'}</div>
          <div id="notice-detail">{importNotice?.detailLines.join('|') ?? '-'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('#load-settings') as HTMLButtonElement).click();
    });

    expect(container.querySelector('#notice-title')?.textContent).toBe(
      'Associated settings import failed',
    );
    expect(container.querySelector('#notice-detail')?.textContent).toContain(
      'associated settings file is too large',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
