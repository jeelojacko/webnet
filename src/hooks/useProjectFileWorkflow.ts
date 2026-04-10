import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  parseProjectFile,
  serializeProjectFile,
  type ParsedProjectPayload,
} from '../engine/projectFile';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  buildProjectBundleBytes,
  parseProjectBundleBytes,
} from '../engine/projectBundle';
import {
  buildProjectEditorIncludeFiles,
  buildProjectSolveIncludeFiles,
  buildProjectSolveInput,
  cloneProjectSessionState,
  createManifestFromFlatProject,
  createProjectManifest,
  createProjectId,
  createManifestEntry,
  getProjectActiveFile,
  type ProjectIndexRow,
  type ProjectSessionState,
  type ProjectStorageStatus,
  type ProjectSourceFileKind,
} from '../engine/projectWorkspace';
import {
  buildProjectIndexRow,
  buildSavedSessionForStorage,
  createProjectStorage,
  requestPersistentStorage,
  touchProjectIndexRow,
} from '../engine/projectStorage';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
  RunMode,
} from '../types';

const PROJECT_IMPORT_FILE_TYPES = [
  {
    description: 'WebNet Project',
    accept: {
      'application/json': ['.wnproj', '.wnproj.json', '.json'],
      'application/zip': ['.zip'],
    },
  },
];

const PROJECT_SOURCE_ACCEPT =
  '.dat,.txt,.sum,.rpt,.xml,.jxl,.jobxml,.htm,.html,.rw5,.cr5,.raw,.dbx,.json';

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });

const readFileAsUint8Array = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error(`Expected binary data for ${file.name}.`));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const writeTextDownload = async (name: string, text: string) => {
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: PROJECT_IMPORT_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([text], { type: 'application/json' }));
  return true;
};

const writeBinaryDownload = async (name: string, bytes: Uint8Array) => {
  const binaryBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: PROJECT_IMPORT_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([binaryBuffer], { type: 'application/zip' }));
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([binaryBuffer], { type: 'application/zip' }));
  return true;
};

interface ImportNotice {
  title: string;
  detailLines: string[];
}

export interface ProjectWorkspaceFileView {
  id: string;
  name: string;
  kind: ProjectSourceFileKind;
  enabled: boolean;
  order: number;
  isMain: boolean;
  isActive: boolean;
}

interface UseProjectFileWorkflowArgs {
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  resetWorkspaceAfterProjectLoad: () => void;
  restoreSavedRunSnapshots: (_snapshots: PersistedSavedRunSnapshot[]) => void;
  normalizeUiTheme: (_value: unknown) => SettingsState['uiTheme'];
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
}

const appendUniqueId = (ids: string[], value: string): string[] =>
  ids.includes(value) ? ids : [...ids, value];

export const useProjectFileWorkflow = ({
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
  restoreSavedRunSnapshots,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
}: UseProjectFileWorkflowArgs) => {
  const storage = useMemo(() => createProjectStorage(), []);
  const autosaveTimerRef = useRef<number | null>(null);
  const [projectSession, setProjectSession] = useState<ProjectSessionState | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectIndexRow[]>([]);
  const [storageStatus, setStorageStatus] = useState<ProjectStorageStatus | null>(null);
  const canUseNamedProjectStorage = Boolean(storageStatus?.hasIndexedDb);

  const refreshStorageContext = useCallback(async () => {
    const status = await storage.getStatus();
    setStorageStatus(status);
    try {
      const projects = await storage.listProjects();
      setRecentProjects(projects);
    } catch {
      setRecentProjects([]);
    }
  }, [storage]);

  useEffect(() => {
    void refreshStorageContext();
  }, [refreshStorageContext]);

  const applyLoadedProjectPayload = useCallback(
    (
      parsed: ParsedProjectPayload,
      nextSession: ProjectSessionState | null,
      savedRuns: PersistedSavedRunSnapshot[],
    ) => {
      const loadedSettings = parsed.ui.settings as unknown as SettingsState;
      const normalizedLoadedSettings: SettingsState = {
        ...loadedSettings,
        precisionReportingMode: 'industry-standard',
        uiTheme: normalizeUiTheme(loadedSettings?.uiTheme),
      };
      const loadedParseSettings = parsed.ui.parseSettings as unknown as ParseSettings;
      const profileForMode = normalizeSolveProfile(
        (loadedParseSettings.solveProfile ?? 'industry-parity') as SolveProfile,
      );
      const normalizedRunMode: RunMode =
        loadedParseSettings.preanalysisMode === true
          ? 'preanalysis'
          : (loadedParseSettings.runMode ?? 'adjustment');
      const normalizedLoadedParseSettings: ParseSettings = {
        ...loadedParseSettings,
        solveProfile: profileForMode,
        runMode: normalizedRunMode,
        preanalysisMode: normalizedRunMode === 'preanalysis',
        suspectImpactMode: loadedParseSettings.suspectImpactMode ?? 'auto',
        ...(loadedParseSettings.observationMode
          ? {
              gridBearingMode: loadedParseSettings.observationMode.bearing,
              gridDistanceMode: loadedParseSettings.observationMode.distance,
              gridAngleMode: loadedParseSettings.observationMode.angle,
              gridDirectionMode: loadedParseSettings.observationMode.direction,
            }
          : {}),
        observationMode:
          loadedParseSettings.observationMode ??
          buildObservationModeFromGridFields(loadedParseSettings),
        parseCompatibilityMode: 'strict',
        faceNormalizationMode: 'on',
        normalize: true,
        parseModeMigrated: true,
        crsTransformEnabled: false,
        crsProjectionModel: 'legacy-equirectangular',
        crsLabel: '',
        geoidSourceFormat: loadedParseSettings.geoidSourceFormat ?? 'builtin',
        geoidSourcePath: loadedParseSettings.geoidSourcePath ?? '',
        verticalDeflectionNorthSec: loadedParseSettings.verticalDeflectionNorthSec ?? 0,
        verticalDeflectionEastSec: loadedParseSettings.verticalDeflectionEastSec ?? 0,
      };
      const loadedAdjustedPointsSettings = sanitizeAdjustedPointsExportSettings(
        parsed.ui.adjustedPointsExport,
        {
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          includeLostStations: normalizedLoadedSettings.listingShowLostStations,
        },
      );
      const nextInput =
        nextSession != null
          ? nextSession.sourceTexts[
              getProjectActiveFile(nextSession.manifest)?.id ?? nextSession.manifest.mainFileId
            ] ?? buildProjectSolveInput(nextSession.manifest, nextSession.sourceTexts)
          : parsed.input;

      setInput(nextInput);
      setProjectIncludeFiles(
        nextSession != null
          ? buildProjectEditorIncludeFiles(
              nextSession.manifest,
              nextSession.sourceTexts,
              getProjectActiveFile(nextSession.manifest)?.id,
            )
          : { ...(parsed.includeFiles ?? {}) },
      );
      setSettings(normalizedLoadedSettings);
      setParseSettings(normalizedLoadedParseSettings);
      setGeoidSourceData(null);
      setGeoidSourceDataLabel('');
      setExportFormat(parsed.ui.exportFormat);
      setAdjustedPointsExportSettings(
        cloneAdjustedPointsExportSettings(loadedAdjustedPointsSettings),
      );
      restoreSavedRunSnapshots(savedRuns);
      setProjectInstruments(cloneInstrumentLibrary(parsed.project.projectInstruments));
      setSelectedInstrument(parsed.project.selectedInstrument);
      setLevelLoopCustomPresets(
        parsed.project.levelLoopCustomPresets.map((preset) => ({ ...preset })),
      );

      setSettingsDraft(normalizedLoadedSettings);
      setParseSettingsDraft(normalizedLoadedParseSettings);
      setGeoidSourceDataDraft(null);
      setGeoidSourceDataLabelDraft('');
      setProjectInstrumentsDraft(cloneInstrumentLibrary(parsed.project.projectInstruments));
      setSelectedInstrumentDraft(parsed.project.selectedInstrument);
      setLevelLoopCustomPresetsDraft(
        parsed.project.levelLoopCustomPresets.map((preset) => ({ ...preset })),
      );
      setAdjustedPointsExportSettingsDraft(
        cloneAdjustedPointsExportSettings(loadedAdjustedPointsSettings),
      );
      setIsAdjustedPointsTransformSelectOpen(false);
      setAdjustedPointsTransformSelectedDraft([]);

      resetWorkspaceAfterProjectLoad();
    },
    [
      buildObservationModeFromGridFields,
      cloneInstrumentLibrary,
      normalizeSolveProfile,
      normalizeUiTheme,
      resetWorkspaceAfterProjectLoad,
      restoreSavedRunSnapshots,
      setAdjustedPointsExportSettings,
      setAdjustedPointsExportSettingsDraft,
      setAdjustedPointsTransformSelectedDraft,
      setExportFormat,
      setGeoidSourceData,
      setGeoidSourceDataDraft,
      setGeoidSourceDataLabel,
      setGeoidSourceDataLabelDraft,
      setInput,
      setIsAdjustedPointsTransformSelectOpen,
      setLevelLoopCustomPresets,
      setLevelLoopCustomPresetsDraft,
      setParseSettings,
      setParseSettingsDraft,
      setProjectIncludeFiles,
      setProjectInstruments,
      setProjectInstrumentsDraft,
      setSelectedInstrument,
      setSelectedInstrumentDraft,
      setSettings,
      setSettingsDraft,
    ],
  );

  const buildPortablePayload = useCallback(
    (): ParsedProjectPayload => ({
      schemaVersion: projectSession ? 4 : 3,
      input: projectSession
        ? buildProjectSolveInput(projectSession.manifest, projectSession.sourceTexts)
        : input,
      includeFiles: projectSession
        ? buildProjectSolveIncludeFiles(projectSession.manifest, projectSession.sourceTexts)
        : projectIncludeFiles,
      savedRuns: savedRunSnapshots,
      ui: {
        settings: settings as unknown as Record<string, unknown>,
        parseSettings: parseSettings as unknown as Record<string, unknown>,
        exportFormat,
        adjustedPointsExport: adjustedPointsExportSettings,
      },
      project: {
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      },
      workspace: projectSession
        ? {
            projectId: projectSession.manifest.projectId,
            name: projectSession.manifest.name,
            createdAt: projectSession.manifest.createdAt,
            updatedAt: projectSession.manifest.updatedAt,
            mainFileId: projectSession.manifest.mainFileId,
            activeFileId: projectSession.manifest.workspace?.activeFileId,
            files: projectSession.manifest.files.map((file) => ({ ...file })),
          }
        : undefined,
    }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      input,
      levelLoopCustomPresets,
      parseSettings,
      projectIncludeFiles,
      projectInstruments,
      projectSession,
      savedRunSnapshots,
      selectedInstrument,
      settings,
    ],
  );

  const effectiveSolveInput = useMemo(
    () =>
      projectSession
        ? buildProjectSolveInput(projectSession.manifest, projectSession.sourceTexts)
        : input,
    [input, projectSession],
  );

  const effectiveSolveIncludeFiles = useMemo(
    () =>
      projectSession
        ? buildProjectSolveIncludeFiles(projectSession.manifest, projectSession.sourceTexts)
        : projectIncludeFiles,
    [projectIncludeFiles, projectSession],
  );

  const activeProjectFileViews = useMemo<ProjectWorkspaceFileView[]>(
    () =>
      projectSession
        ? projectSession.manifest.files
            .map((file) => ({
              id: file.id,
              name: file.name,
              kind: file.kind,
              enabled: file.enabled,
              order: file.order,
              isMain: file.id === projectSession.manifest.mainFileId,
              isActive:
                file.id ===
                (projectSession.manifest.workspace?.activeFileId ??
                  projectSession.manifest.mainFileId),
            }))
            .sort(
              (a, b) =>
                a.order - b.order ||
                a.name.localeCompare(b.name, undefined, { numeric: true }) ||
                a.id.localeCompare(b.id, undefined, { numeric: true }),
            )
        : [],
    [projectSession],
  );

  const updateProjectSession = useCallback(
    (
      updater: (_current: ProjectSessionState) => ProjectSessionState,
      options?: { syncEditor?: boolean },
    ) => {
      setProjectSession((current) => {
        if (!current) return current;
        const next = updater(cloneProjectSessionState(current));
        if (options?.syncEditor !== false) {
          const activeFile = getProjectActiveFile(next.manifest);
          if (activeFile) {
            setInput(next.sourceTexts[activeFile.id] ?? '');
            setProjectIncludeFiles(
              buildProjectEditorIncludeFiles(next.manifest, next.sourceTexts, activeFile.id),
            );
          }
        }
        return next;
      });
    },
    [setInput, setProjectIncludeFiles],
  );

  const handleEditorInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (!projectSession) return;
      const activeFile = getProjectActiveFile(projectSession.manifest);
      if (!activeFile) return;
      updateProjectSession(
        (current) => {
          const currentText = current.sourceTexts[activeFile.id] ?? '';
          if (currentText === value) return current;
          const nowIso = new Date().toISOString();
          current.sourceTexts = {
            ...current.sourceTexts,
            [activeFile.id]: value,
          };
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === activeFile.id
              ? { ...file, size: value.length, modifiedAt: nowIso }
              : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, activeFile.id);
          current.manifestDirty = true;
          current.autosaveState = 'idle';
          current.lastAutosaveError = null;
          return current;
        },
        { syncEditor: false },
      );
    },
    [projectSession, setInput, updateProjectSession],
  );

  const persistProjectNow = useCallback(
    async (session: ProjectSessionState) => {
      const saved = await storage.saveProject(buildSavedSessionForStorage(session));
      setProjectSession((current) => {
        if (!current || current.indexRow.id !== session.indexRow.id) return current;
        return {
          ...saved,
          dirtyFileIds: [],
          manifestDirty: false,
          autosaveState: 'idle',
          lastAutosavedAt: new Date().toISOString(),
          lastAutosaveError: null,
        };
      });
      await refreshStorageContext();
    },
    [refreshStorageContext, storage],
  );

  useEffect(() => {
    if (!projectSession) return;
    if (!projectSession.manifestDirty && projectSession.dirtyFileIds.length === 0) return;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setProjectSession((current) =>
            current ? { ...current, autosaveState: 'saving', lastAutosaveError: null } : current,
          );
          await persistProjectNow(projectSession);
        } catch (error) {
          setProjectSession((current) =>
            current
              ? {
                  ...current,
                  autosaveState: 'error',
                  lastAutosaveError: error instanceof Error ? error.message : String(error),
                }
              : current,
          );
        }
      })();
    }, 500);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [persistProjectNow, projectSession]);

  const serializedProjectShape = useMemo(
    () =>
      JSON.stringify({
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      settings,
    ],
  );

  useEffect(() => {
    if (!projectSession) return;
    const currentShape = JSON.stringify({
      settings: projectSession.manifest.ui.settings,
      parseSettings: projectSession.manifest.ui.parseSettings,
      exportFormat: projectSession.manifest.ui.exportFormat,
      adjustedPointsExportSettings: projectSession.manifest.ui.adjustedPointsExport,
      projectInstruments: projectSession.manifest.project.projectInstruments,
      selectedInstrument: projectSession.manifest.project.selectedInstrument,
      levelLoopCustomPresets: projectSession.manifest.project.levelLoopCustomPresets,
    });
    if (currentShape === serializedProjectShape) return;
    updateProjectSession(
      (current) => {
        const nowIso = new Date().toISOString();
        current.manifest.ui = {
          ...current.manifest.ui,
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          exportFormat,
          adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
          migration: {
            parseModeMigrated: true,
            migratedAt: nowIso,
          },
        };
        current.manifest.project = {
          projectInstruments: cloneInstrumentLibrary(projectInstruments),
          selectedInstrument,
          levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.lastAutosaveError = null;
        return current;
      },
      { syncEditor: false },
    );
  }, [
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    levelLoopCustomPresets,
    parseSettings,
    projectInstruments,
    projectSession,
    selectedInstrument,
    serializedProjectShape,
    settings,
    updateProjectSession,
  ]);

  const createLocalProjectFromCurrentWorkspace = useCallback(async () => {
    if (!canUseNamedProjectStorage) {
      setImportNotice({
        title: 'Local project storage unavailable',
        detailLines: [
          'Named browser projects require IndexedDB support in this browser.',
          'Use portable project export/import for this session instead.',
        ],
      });
      return;
    }
    const suggestedName = `WebNet Project ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('Project name', suggestedName)?.trim();
    if (!name) return;
    const createdAt = new Date().toISOString();
    const seed = createManifestFromFlatProject({
      projectId: createProjectId(),
      name,
      createdAt,
      updatedAt: createdAt,
      input,
      includeFiles: projectIncludeFiles,
      ui: {
        settings: settings as unknown as Record<string, unknown>,
        parseSettings: parseSettings as unknown as Record<string, unknown>,
        exportFormat,
        adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
        migration: {
          parseModeMigrated: true,
          migratedAt: createdAt,
        },
      },
      project: {
        projectInstruments: cloneInstrumentLibrary(projectInstruments),
        selectedInstrument,
        levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      },
    });
    const preferredBackend = storageStatus?.preferredBackend ?? 'indexeddb';
    const session = await storage.createProject({
      indexRow: buildProjectIndexRow({
        id: seed.manifest.projectId,
        name,
        backend: preferredBackend,
        createdAt,
        updatedAt: createdAt,
      }),
      manifest: seed.manifest,
      sourceTexts: seed.sourceTexts,
    });
    setProjectSession({
      ...session,
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: createdAt,
      lastAutosaveError: null,
    });
    await requestPersistentStorage();
    await refreshStorageContext();
    setImportNotice({
      title: 'Local project created',
      detailLines: [
        `Created ${name}.`,
        'Named projects now autosave sources and settings to browser project storage.',
      ],
    });
  }, [
    adjustedPointsExportSettings,
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    exportFormat,
    input,
    levelLoopCustomPresets,
    parseSettings,
    projectIncludeFiles,
    projectInstruments,
    refreshStorageContext,
    selectedInstrument,
    setImportNotice,
    settings,
    storage,
    storageStatus?.preferredBackend,
  ]);

  const handleSaveProject = useCallback(async () => {
    if (!projectSession) {
      await createLocalProjectFromCurrentWorkspace();
      return;
    }
    await persistProjectNow(projectSession);
    setImportNotice({
      title: 'Local project saved',
      detailLines: [`Saved ${projectSession.manifest.name}.`],
    });
  }, [createLocalProjectFromCurrentWorkspace, persistProjectNow, projectSession, setImportNotice]);

  const openProjectById = useCallback(
    async (projectId: string) => {
      const session = await storage.openProject(projectId);
      if (!session) {
        setImportNotice({
          title: 'Project open failed',
          detailLines: ['The selected local project could not be opened.'],
        });
        return;
      }
      const parsedPayload: ParsedProjectPayload = {
        schemaVersion: 4,
        input: buildProjectSolveInput(session.manifest, session.sourceTexts),
        includeFiles: buildProjectSolveIncludeFiles(session.manifest, session.sourceTexts),
        savedRuns: [],
        ui: {
          settings: session.manifest.ui.settings,
          parseSettings: session.manifest.ui.parseSettings,
          exportFormat: session.manifest.ui.exportFormat,
          adjustedPointsExport: session.manifest.ui.adjustedPointsExport,
          migration: session.manifest.ui.migration,
        },
        project: session.manifest.project,
        workspace: {
          projectId: session.manifest.projectId,
          name: session.manifest.name,
          createdAt: session.manifest.createdAt,
          updatedAt: session.manifest.updatedAt,
          mainFileId: session.manifest.mainFileId,
          activeFileId: session.manifest.workspace?.activeFileId,
          files: session.manifest.files.map((file) => ({ ...file })),
        },
      };
      applyLoadedProjectPayload(parsedPayload, session, []);
      setProjectSession(session);
      await requestPersistentStorage();
      setImportNotice({
        title: 'Local project opened',
        detailLines: [
          `Opened ${session.manifest.name}.`,
          'Named project autosave is active; rerun adjustment to rebuild report and map state.',
        ],
      });
    },
    [applyLoadedProjectPayload, setImportNotice, storage],
  );

  const deleteLocalProject = useCallback(
    async (projectId: string) => {
      const existing = recentProjects.find((entry) => entry.id === projectId);
      const accepted = window.confirm(
        `Delete local project "${existing?.name ?? projectId}" from browser project storage?`,
      );
      if (!accepted) return;
      await storage.deleteProject(projectId);
      if (projectSession?.indexRow.id === projectId) {
        setProjectSession(null);
      }
      await refreshStorageContext();
      setImportNotice({
        title: 'Local project deleted',
        detailLines: [`Deleted ${existing?.name ?? projectId}.`],
      });
    },
    [projectSession?.indexRow.id, recentProjects, refreshStorageContext, setImportNotice, storage],
  );

  const triggerProjectFileSelect = useCallback(() => {
    projectFileInputRef.current?.click();
  }, [projectFileInputRef]);

  const triggerProjectSourceFileSelect = useCallback(() => {
    if (!projectSession) {
      setImportNotice({
        title: 'No local project',
        detailLines: ['Create or open a local project before adding source files.'],
      });
      return;
    }
    projectSourceFileInputRef.current?.click();
  }, [projectSession, projectSourceFileInputRef, setImportNotice]);

  const exportPortableProject = useCallback(async () => {
    const suggestedName = projectSession
      ? `${projectSession.manifest.name.replace(/\s+/g, '-').toLowerCase()}.wnproj.json`
      : `webnet-project-${new Date().toISOString().slice(0, 10)}.wnproj.json`;
    const saved = await writeTextDownload(
      suggestedName,
      serializeProjectFile(buildPortablePayload()),
    );
    if (!saved) return;
    setImportNotice({
      title: 'Portable project exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [buildPortablePayload, projectSession, setImportNotice]);

  const exportProjectBundle = useCallback(async () => {
    const seed =
      projectSession != null
        ? {
            manifest: projectSession.manifest,
            sourceTexts: projectSession.sourceTexts,
          }
        : createManifestFromFlatProject({
            name: `WebNet Project ${new Date().toISOString().slice(0, 10)}`,
            input,
            includeFiles: projectIncludeFiles,
            ui: {
              settings: settings as unknown as Record<string, unknown>,
              parseSettings: parseSettings as unknown as Record<string, unknown>,
              exportFormat,
              adjustedPointsExport: cloneAdjustedPointsExportSettings(
                adjustedPointsExportSettings,
              ),
              migration: {
                parseModeMigrated: true,
                migratedAt: new Date().toISOString(),
              },
            },
            project: {
              projectInstruments: cloneInstrumentLibrary(projectInstruments),
              selectedInstrument,
              levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
            },
          });
    const bundleBytes = buildProjectBundleBytes(seed);
    const suggestedName = `${(projectSession?.manifest.name ?? 'webnet-project')
      .replace(/\s+/g, '-')
      .toLowerCase()}.zip`;
    const saved = await writeBinaryDownload(suggestedName, bundleBytes);
    if (!saved) return;
    setImportNotice({
      title: 'Project bundle exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    input,
    levelLoopCustomPresets,
    parseSettings,
    projectIncludeFiles,
    projectInstruments,
    projectSession,
    selectedInstrument,
    setImportNotice,
    settings,
  ]);

  const importPortablePayloadAsLocalProject = useCallback(
    async (parsed: ParsedProjectPayload) => {
      if (!canUseNamedProjectStorage) {
        applyLoadedProjectPayload(parsed, null, parsed.savedRuns);
        setProjectSession(null);
        setImportNotice({
          title: 'Portable project loaded',
          detailLines: [
            'Loaded the portable project into the current workspace.',
            'Named browser project storage is unavailable in this environment.',
          ],
        });
        return;
      }
      const createdAt = parsed.workspace?.createdAt ?? new Date().toISOString();
      const updatedAt = new Date().toISOString();
      const manifestSeed =
        parsed.workspace?.files && parsed.workspace.files.length > 0
          ? {
              manifest: createProjectManifest({
                projectId: parsed.workspace.projectId,
                name: parsed.workspace.name,
                createdAt,
                updatedAt,
                files: parsed.workspace.files,
                mainFileId: parsed.workspace.mainFileId,
                ui: {
                  settings: parsed.ui.settings,
                  parseSettings: parsed.ui.parseSettings,
                  exportFormat: parsed.ui.exportFormat,
                  adjustedPointsExport: parsed.ui.adjustedPointsExport,
                  migration: parsed.ui.migration,
                },
                project: parsed.project,
                workspace: {
                  activeFileId: parsed.workspace.activeFileId,
                },
              }),
              sourceTexts: Object.fromEntries(
                parsed.workspace.files.map((file) => [
                  file.id,
                  file.id === parsed.workspace?.mainFileId
                    ? parsed.input
                    : parsed.includeFiles[file.name] ?? '',
                ]),
              ),
            }
          : createManifestFromFlatProject({
              projectId: parsed.workspace?.projectId,
              name:
                parsed.workspace?.name ??
                `Imported Project ${new Date().toISOString().slice(0, 10)}`,
              createdAt,
              updatedAt,
              input: parsed.input,
              includeFiles: parsed.includeFiles,
              ui: {
                settings: parsed.ui.settings,
                parseSettings: parsed.ui.parseSettings,
                exportFormat: parsed.ui.exportFormat,
                adjustedPointsExport: parsed.ui.adjustedPointsExport,
                migration: parsed.ui.migration,
              },
              project: parsed.project,
              preferredActiveFileId: parsed.workspace?.activeFileId,
            });
      const backend = storageStatus?.preferredBackend ?? 'indexeddb';
      const session = await storage.createProject({
        indexRow: buildProjectIndexRow({
          id: manifestSeed.manifest.projectId,
          name: manifestSeed.manifest.name,
          backend,
          createdAt,
          updatedAt,
        }),
        manifest: manifestSeed.manifest,
        sourceTexts: manifestSeed.sourceTexts,
      });
      applyLoadedProjectPayload(parsed, session, parsed.savedRuns);
      setProjectSession(session);
      await requestPersistentStorage();
      await refreshStorageContext();
      setImportNotice({
        title: 'Portable project imported',
        detailLines: [
          `Imported ${manifestSeed.manifest.name} into local browser project storage.`,
          'Saved runs were restored into the current session but are not part of named-project autosave yet.',
        ],
      });
    },
    [
      applyLoadedProjectPayload,
      canUseNamedProjectStorage,
      refreshStorageContext,
      setImportNotice,
      storage,
      storageStatus?.preferredBackend,
    ],
  );

  const importProjectBundleAsLocalProject = useCallback(
    async (bytes: Uint8Array) => {
      const parsedBundle = parseProjectBundleBytes(bytes);
      const updatedAt = new Date().toISOString();
      const manifest = {
        ...parsedBundle.manifest,
        updatedAt,
      };
      if (!canUseNamedProjectStorage) {
        const parsedPayload: ParsedProjectPayload = {
          schemaVersion: 4,
          input: buildProjectSolveInput(manifest, parsedBundle.sourceTexts),
          includeFiles: buildProjectSolveIncludeFiles(manifest, parsedBundle.sourceTexts),
          savedRuns: [],
          ui: manifest.ui,
          project: manifest.project,
          workspace: {
            projectId: manifest.projectId,
            name: manifest.name,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            mainFileId: manifest.mainFileId,
            activeFileId: manifest.workspace?.activeFileId,
            files: manifest.files.map((file) => ({ ...file })),
          },
        };
        applyLoadedProjectPayload(parsedPayload, null, []);
        setProjectSession(null);
        setImportNotice({
          title: 'Project bundle loaded',
          detailLines: [
            `Loaded ${manifest.name} into the current workspace.`,
            'Named browser project storage is unavailable in this environment.',
          ],
        });
        return;
      }
      const backend = storageStatus?.preferredBackend ?? 'indexeddb';
      const session = await storage.createProject({
        indexRow: buildProjectIndexRow({
          id: manifest.projectId,
          name: manifest.name,
          backend,
          createdAt: manifest.createdAt,
          updatedAt,
        }),
        manifest,
        sourceTexts: parsedBundle.sourceTexts,
      });
      const parsedPayload: ParsedProjectPayload = {
        schemaVersion: 4,
        input: buildProjectSolveInput(manifest, parsedBundle.sourceTexts),
        includeFiles: buildProjectSolveIncludeFiles(manifest, parsedBundle.sourceTexts),
        savedRuns: [],
        ui: manifest.ui,
        project: manifest.project,
        workspace: {
          projectId: manifest.projectId,
          name: manifest.name,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          mainFileId: manifest.mainFileId,
          activeFileId: manifest.workspace?.activeFileId,
          files: manifest.files.map((file) => ({ ...file })),
        },
      };
      applyLoadedProjectPayload(parsedPayload, session, []);
      setProjectSession(session);
      await requestPersistentStorage();
      await refreshStorageContext();
      setImportNotice({
        title: 'Project bundle imported',
        detailLines: [`Imported ${manifest.name} into local browser project storage.`],
      });
    },
    [
      applyLoadedProjectPayload,
      canUseNamedProjectStorage,
      refreshStorageContext,
      setImportNotice,
      storage,
      storageStatus?.preferredBackend,
    ],
  );

  const handleProjectFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      try {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const bytes = await readFileAsUint8Array(file);
          await importProjectBundleAsLocalProject(bytes);
          return;
        }
        const rawText = await readFileAsText(file);
        const parsed = parseProjectFile(rawText, {
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          exportFormat,
          adjustedPointsExport: adjustedPointsExportSettings,
          projectInstruments,
          selectedInstrument,
          levelLoopCustomPresets,
        });
        if (!parsed.ok) {
          setImportNotice({
            title: 'Project load failed',
            detailLines: parsed.errors,
          });
          return;
        }
        await importPortablePayloadAsLocalProject(parsed.project);
      } catch (error) {
        setImportNotice({
          title: 'Project load failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [
      adjustedPointsExportSettings,
      exportFormat,
      importPortablePayloadAsLocalProject,
      importProjectBundleAsLocalProject,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      setImportNotice,
      settings,
    ],
  );

  const handleProjectSourceFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      if (!projectSession) return;
      try {
        const text = await readFileAsText(file);
        updateProjectSession((current) => {
          const nowIso = new Date().toISOString();
          if (current.manifest.files.some((entry) => entry.name === file.name)) {
            throw new Error(`A project source file named "${file.name}" already exists.`);
          }
          const entry = createManifestEntry({
            name: file.name,
            kind: 'include',
            order: current.manifest.files.length,
            text,
            modifiedAt: nowIso,
          });
          current.manifest.files = [...current.manifest.files, entry];
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.sourceTexts = {
            ...current.sourceTexts,
            [entry.id]: text,
          };
          current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, entry.id);
          current.manifestDirty = true;
          return current;
        });
        setImportNotice({
          title: 'Project source file added',
          detailLines: [`Added ${file.name}.`],
        });
      } catch (error) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const createBlankProjectFile = useCallback(() => {
    if (!projectSession) {
      setImportNotice({
        title: 'No local project',
        detailLines: ['Create or open a local project before adding source files.'],
      });
      return;
    }
    const name = window.prompt(
      'New source file name',
      `section-${projectSession.manifest.files.length}.dat`,
    )?.trim();
    if (!name) return;
    try {
      updateProjectSession((current) => {
        if (current.manifest.files.some((file) => file.name === name)) {
          throw new Error(`A project source file named "${name}" already exists.`);
        }
        const nowIso = new Date().toISOString();
        const entry = createManifestEntry({
          name,
          kind: 'include',
          order: current.manifest.files.length,
          text: '',
          modifiedAt: nowIso,
        });
        current.manifest.files = [...current.manifest.files, entry];
        current.manifest.workspace = {
          ...(current.manifest.workspace ?? {}),
          activeFileId: entry.id,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.sourceTexts = { ...current.sourceTexts, [entry.id]: '' };
        current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, entry.id);
        current.manifestDirty = true;
        return current;
      });
      setImportNotice({
        title: 'Blank source file created',
        detailLines: [`Created ${name}.`],
      });
    } catch (error) {
      setImportNotice({
        title: 'Blank source file failed',
        detailLines: [error instanceof Error ? error.message : String(error)],
      });
    }
  }, [projectSession, setImportNotice, updateProjectSession]);

  const switchActiveProjectFile = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        if (!current.manifest.files.some((file) => file.id === fileId)) return current;
        const nowIso = new Date().toISOString();
        current.manifest.workspace = {
          ...(current.manifest.workspace ?? {}),
          activeFileId: fileId,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const renameProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      const nextName = window.prompt('Rename source file', target.name)?.trim();
      if (!nextName || nextName === target.name) return;
      try {
        updateProjectSession((current) => {
          if (current.manifest.files.some((file) => file.id !== fileId && file.name === nextName)) {
            throw new Error(`A project source file named "${nextName}" already exists.`);
          }
          const nowIso = new Date().toISOString();
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === fileId ? { ...file, name: nextName, modifiedAt: nowIso } : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.manifestDirty = true;
          return current;
        });
      } catch (error) {
        setImportNotice({
          title: 'Rename failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const toggleProjectFileEnabled = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        if (fileId === current.manifest.mainFileId) return current;
        const nowIso = new Date().toISOString();
        current.manifest.files = current.manifest.files.map((file) =>
          file.id === fileId ? { ...file, enabled: !file.enabled, modifiedAt: nowIso } : file,
        );
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const moveProjectFile = useCallback(
    (fileId: string, direction: 'up' | 'down') => {
      updateProjectSession((current) => {
        const sorted = [...current.manifest.files].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((file) => file.id === fileId);
        if (index < 0) return current;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= sorted.length) return current;
        const [moved] = sorted.splice(index, 1);
        sorted.splice(targetIndex, 0, moved);
        const nowIso = new Date().toISOString();
        current.manifest.files = sorted.map((file, order) => ({
          ...file,
          order,
          modifiedAt: file.id === fileId ? nowIso : file.modifiedAt,
        }));
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const removeProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      if (target.id === projectSession.manifest.mainFileId) {
        setImportNotice({
          title: 'Main file preserved',
          detailLines: [
            'Phase 1 keeps the current main file in place; remove other source members instead.',
          ],
        });
        return;
      }
      const accepted = window.confirm(
        `Remove source file "${target.name}" from the current local project?`,
      );
      if (!accepted) return;
      updateProjectSession((current) => {
        const nowIso = new Date().toISOString();
        const nextFiles = current.manifest.files.filter((file) => file.id !== fileId);
        current.manifest.files = nextFiles.map((file, order) => ({ ...file, order }));
        if (current.manifest.workspace?.activeFileId === fileId) {
          current.manifest.workspace = {
            ...(current.manifest.workspace ?? {}),
            activeFileId: current.manifest.mainFileId,
          };
        }
        const nextSourceTexts = { ...current.sourceTexts };
        delete nextSourceTexts[fileId];
        current.sourceTexts = nextSourceTexts;
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.dirtyFileIds = current.dirtyFileIds.filter((id) => id !== fileId);
        return current;
      });
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const openProjectWorkspace = useCallback(async () => {
    if (recentProjects.length > 0) {
      await openProjectById(recentProjects[0].id);
      return;
    }
    triggerProjectFileSelect();
  }, [openProjectById, recentProjects, triggerProjectFileSelect]);

  const currentProjectFile = projectSession
    ? getProjectActiveFile(projectSession.manifest)
    : null;

  return {
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept: PROJECT_SOURCE_ACCEPT,
    effectiveSolveInput,
    effectiveSolveIncludeFiles,
    currentEditorIncludeFiles:
      projectSession && currentProjectFile
        ? buildProjectEditorIncludeFiles(
            projectSession.manifest,
            projectSession.sourceTexts,
            currentProjectFile.id,
          )
        : projectIncludeFiles,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    openProjectWorkspace,
    handleSaveProject,
    handleEditorInputChange,
    handleProjectFileChange,
    handleProjectSourceFileChange,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    createBlankProjectFile,
    switchActiveProjectFile,
    renameProjectFile,
    toggleProjectFileEnabled,
    moveProjectFile,
    removeProjectFile,
  };
};
