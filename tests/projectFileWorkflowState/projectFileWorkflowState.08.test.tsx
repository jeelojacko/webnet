/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import {
  act,
  useRef,
  useState,
  createRoot,
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  serializeProjectFile,
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
