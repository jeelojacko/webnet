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
import { encodeUint8ArrayToBase64 } from './useWorkspaceRecovery';
import {
  assertBrowserFileSize,
  MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
  MAX_PORTABLE_PROJECT_TEXT_BYTES,
  MAX_PROJECT_BUNDLE_BYTES,
  readBrowserFileAsText,
  readBrowserFileAsUint8Array,
  saveBrowserBinaryFile,
  saveBrowserTextFile,
} from '../engine/browserFileIo';
import { stableSerializePlain } from '../engine/plainData';
import {
  parseProjectFile,
  serializeProjectFile,
  type ParsedProjectPayload,
} from '../engine/projectFile';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import { clonePlanningMapState, DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import { cloneSurveyCadPersistedState } from '../engine/cad/cadPersistence';
import {
  buildProjectBundleBytes,
  parseProjectBundleBytes,
} from '../engine/projectBundle';
import {
  buildProjectEditorIncludeFiles,
  cloneProjectSessionState,
  createProjectId,
  createManifestEntry,
  getProjectFocusedFile,
  normalizeWorkspaceState,
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
  PlanningMapState,
  ProjectExportFormat,
} from '../types';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import {
  buildImportedReviewFileName,
  buildSnprojAssociatedSettingsPayload,
  getImportedProjectSourceName,
  type PreparedAssociatedProjectSettingsImport,
} from './projectFileAssociatedSettings';
import {
  applyPersistedProjectSession,
  normalizeSessionWorkspace,
  resolveNextFocusedFileId,
} from './projectFileSessionHelpers';
import {
  buildParsedPayloadFromSession,
  createFlatProjectManifestSeed,
  createManifestSeedFromPortablePayload,
  type ProjectFlatWorkspacePayloadOptions,
} from './projectFilePayloadBuilders';
import { useProjectPayloadLoader } from './useProjectPayloadLoader';
import {
  useProjectWorkflowDerivedState,
  type ProjectRunValidation,
  type ProjectWorkspaceFileView,
} from './useProjectWorkflowDerivedState';

export { applyPersistedProjectSession } from './projectFileSessionHelpers';
export type { PreparedAssociatedProjectSettingsImport } from './projectFileAssociatedSettings';

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
const ASSOCIATED_PROJECT_SETTINGS_ACCEPT = '.wnproj,.wnproj.json,.json,.snproj';
const PROJECT_AUTOSAVE_DELAY_MS = 60_000;

interface ImportNotice {
  title: string;
  detailLines: string[];
}

interface ApplyPreparedAssociatedProjectSettingsOptions {
  successTitle?: string;
  failureTitle?: string;
  successDetailPrefix?: string[];
  failureDetailPrefix?: string[];
}

export type { ProjectRunValidation, ProjectWorkspaceFileView } from './useProjectWorkflowDerivedState';

interface UseProjectFileWorkflowArgs {
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  geoidSourceData?: Uint8Array | null;
  geoidSourceDataLabel?: string;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  planningMap?: PlanningMapState;
  surveyCadState?: SurveyCadPersistedState | null;
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
  setPlanningMap?: Dispatch<SetStateAction<PlanningMapState>>;
  setSurveyCadState?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
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

const removeFileId = (ids: string[], value: string): string[] => ids.filter((id) => id !== value);

const sortRecentProjectRows = (rows: ProjectIndexRow[]): ProjectIndexRow[] =>
  [...rows].sort(
    (a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

const buildFileNameCopy = (baseName: string, existingNames: Set<string>): string => {
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
  let candidate = `${stem} copy${ext}`;
  let counter = 2;
  while (existingNames.has(candidate)) {
    candidate = `${stem} copy ${counter}${ext}`;
    counter += 1;
  }
  return candidate;
};

export const useProjectFileWorkflow = ({
  projectFileInputRef,
  projectSourceFileInputRef,
  input,
  projectIncludeFiles,
  settings,
  parseSettings,
  geoidSourceData = null,
  geoidSourceDataLabel = '',
  exportFormat,
  adjustedPointsExportSettings,
  planningMap = DEFAULT_PLANNING_MAP_STATE,
  surveyCadState = null,
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
  setPlanningMap,
  setSurveyCadState,
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

  const upsertRecentProjectRow = useCallback((row: ProjectIndexRow) => {
    setRecentProjects((current) =>
      sortRecentProjectRows([
        row,
        ...current.filter((entry) => entry.id !== row.id),
      ]),
    );
  }, []);

  const removeRecentProjectRow = useCallback((projectId: string) => {
    setRecentProjects((current) => current.filter((entry) => entry.id !== projectId));
  }, []);

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

  const { applyLoadedProjectPayload, normalizeImportedProjectPayload } = useProjectPayloadLoader({
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
    setPlanningMap,
    setProjectIncludeFiles,
    setProjectInstruments,
    setProjectInstrumentsDraft,
    setSelectedInstrument,
    setSelectedInstrumentDraft,
    setSettings,
    setSettingsDraft,
    setSurveyCadState,
  });

  const {
    activeProjectFileViews,
    buildPortablePayload,
    currentProjectFile,
    effectiveProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    effectiveSolveIncludeFiles,
    effectiveSolveInput,
    getOrderedRunFiles,
    projectFlatWorkspacePayload,
    projectRunValidation,
    validateRunSet,
  } = useProjectWorkflowDerivedState({
    adjustedPointsExportSettings,
    exportFormat,
    geoidSourceData,
    geoidSourceDataLabel,
    input,
    levelLoopCustomPresets,
    parseSettings,
    planningMap,
    projectIncludeFiles,
    projectInstruments,
    projectSession,
    savedRunSnapshots,
    selectedInstrument,
    settings,
    surveyCadState,
  });

  const updateProjectSession = useCallback(
    (
      updater: (_current: ProjectSessionState) => ProjectSessionState,
      options?: { syncEditor?: boolean },
    ) => {
      setProjectSession((current) => {
        if (!current) return current;
        const next = updater(cloneProjectSessionState(current));
        if (options?.syncEditor !== false) {
          const focusedFile = getProjectFocusedFile(next.manifest);
          if (focusedFile) {
            setInput(next.sourceTexts[focusedFile.id] ?? '');
            setProjectIncludeFiles(
              buildProjectEditorIncludeFiles(next.manifest, next.sourceTexts, focusedFile.id),
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
      const focusedFile = getProjectFocusedFile(projectSession.manifest);
      if (!focusedFile) return;
      updateProjectSession(
        (current) => {
          const currentText = current.sourceTexts[focusedFile.id] ?? '';
          if (currentText === value) return current;
          const nowIso = new Date().toISOString();
          current.sourceTexts = {
            ...current.sourceTexts,
            [focusedFile.id]: value,
          };
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === focusedFile.id
              ? { ...file, size: value.length, updatedAt: nowIso, modifiedAt: nowIso }
              : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, focusedFile.id);
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
      const completedAt = new Date().toISOString();
      setProjectSession((current) => {
        return applyPersistedProjectSession({
          current,
          saved,
          requestedManifestUpdatedAt: session.manifest.updatedAt,
          completedAt,
        });
      });
      upsertRecentProjectRow(saved.indexRow);
    },
    [storage, upsertRecentProjectRow],
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
    }, PROJECT_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [persistProjectNow, projectSession]);

  const serializedProjectShape = useMemo(
    () =>
      stableSerializePlain({
        settings,
        parseSettings,
        geoidSourceDataBase64: encodeUint8ArrayToBase64(geoidSourceData),
        geoidSourceDataLabel,
        exportFormat,
        adjustedPointsExportSettings,
        planningMap,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        surveyCadState,
      }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      geoidSourceData,
      geoidSourceDataLabel,
      levelLoopCustomPresets,
      parseSettings,
      planningMap,
      projectInstruments,
      selectedInstrument,
      settings,
      surveyCadState,
    ],
  );

  useEffect(() => {
    if (!projectSession) return;
    const currentShape = stableSerializePlain({
      settings: projectSession.manifest.ui.settings,
      parseSettings: projectSession.manifest.ui.parseSettings,
      geoidSourceDataBase64: projectSession.manifest.ui.geoidSourceDataBase64 ?? null,
      geoidSourceDataLabel: projectSession.manifest.ui.geoidSourceDataLabel ?? '',
      exportFormat: projectSession.manifest.ui.exportFormat,
      adjustedPointsExportSettings: projectSession.manifest.ui.adjustedPointsExport,
      planningMap: projectSession.manifest.ui.planningMap,
      projectInstruments: projectSession.manifest.project.projectInstruments,
      selectedInstrument: projectSession.manifest.project.selectedInstrument,
      levelLoopCustomPresets: projectSession.manifest.project.levelLoopCustomPresets,
      surveyCadState: projectSession.manifest.project.surveyCad ?? null,
    });
    if (currentShape === serializedProjectShape) return;
    updateProjectSession(
      (current) => {
        const nowIso = new Date().toISOString();
        current.manifest.ui = {
          ...current.manifest.ui,
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          geoidSourceDataBase64: encodeUint8ArrayToBase64(geoidSourceData),
          geoidSourceDataLabel,
          exportFormat,
          adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
          planningMap: clonePlanningMapState(planningMap),
          migration: {
            parseModeMigrated: true,
            migratedAt: nowIso,
            listingSortModeVersion: 2,
          },
        };
        current.manifest.project = {
          projectInstruments: cloneInstrumentLibrary(projectInstruments),
          selectedInstrument,
          levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
          surveyCad: surveyCadState ? cloneSurveyCadPersistedState(surveyCadState) : undefined,
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
    geoidSourceData,
    geoidSourceDataLabel,
    levelLoopCustomPresets,
    parseSettings,
    planningMap,
    projectInstruments,
    projectSession,
    selectedInstrument,
    serializedProjectShape,
    settings,
    surveyCadState,
    updateProjectSession,
  ]);

  const createLocalProjectFromCurrentWorkspace = useCallback(async (): Promise<ProjectSessionState | null> => {
    if (!canUseNamedProjectStorage) {
      setImportNotice({
        title: 'Local project storage unavailable',
        detailLines: [
          'Named browser projects require IndexedDB support in this browser.',
          'Use portable project export/import for this session instead.',
        ],
      });
      return null;
    }
    const suggestedName = `WebNet Project ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('Project name', suggestedName)?.trim();
    if (!name) return null;
    const createdAt = new Date().toISOString();
    const seed = createFlatProjectManifestSeed({
      projectId: createProjectId(),
      name,
      createdAt,
      updatedAt: createdAt,
      workspace: projectFlatWorkspacePayload,
      cloneInstrumentLibrary,
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
    return {
      ...session,
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: createdAt,
      lastAutosaveError: null,
    };
  }, [
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    projectFlatWorkspacePayload,
    refreshStorageContext,
    setImportNotice,
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
      const parsedPayload = buildParsedPayloadFromSession(session);
      applyLoadedProjectPayload(parsedPayload, session, []);
      setProjectSession(session);
      upsertRecentProjectRow(session.indexRow);
      await requestPersistentStorage();
      setImportNotice({
        title: 'Local project opened',
        detailLines: [
          `Opened ${session.manifest.name}.`,
          'Named project autosave is active; rerun adjustment to rebuild report and map state.',
        ],
      });
    },
    [
      applyLoadedProjectPayload,
      setImportNotice,
      storage,
      upsertRecentProjectRow,
    ],
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
      removeRecentProjectRow(projectId);
      setImportNotice({
        title: 'Local project deleted',
        detailLines: [`Deleted ${existing?.name ?? projectId}.`],
      });
    },
    [projectSession?.indexRow.id, recentProjects, removeRecentProjectRow, setImportNotice, storage],
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
    const saved = await saveBrowserTextFile(
      suggestedName,
      serializeProjectFile(buildPortablePayload()),
      PROJECT_IMPORT_FILE_TYPES,
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
        : createFlatProjectManifestSeed({
            name: `WebNet Project ${new Date().toISOString().slice(0, 10)}`,
            updatedAt: new Date().toISOString(),
            workspace: projectFlatWorkspacePayload,
            cloneInstrumentLibrary,
          });
    const bundleBytes = buildProjectBundleBytes(seed);
    const suggestedName = `${(projectSession?.manifest.name ?? 'webnet-project')
      .replace(/\s+/g, '-')
      .toLowerCase()}.zip`;
    const saved = await saveBrowserBinaryFile(suggestedName, bundleBytes, PROJECT_IMPORT_FILE_TYPES);
    if (!saved) return;
    setImportNotice({
      title: 'Project bundle exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [
    cloneInstrumentLibrary,
    projectFlatWorkspacePayload,
    projectSession,
    setImportNotice,
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
      const manifestSeed = createManifestSeedFromPortablePayload({
        parsed,
        createdAt,
        updatedAt,
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
        const parsedPayload = buildParsedPayloadFromSession({
          indexRow: buildProjectIndexRow({
            id: manifest.projectId,
            name: manifest.name,
            backend: storageStatus?.preferredBackend ?? 'indexeddb',
            createdAt: manifest.createdAt,
            updatedAt,
          }),
          manifest,
          sourceTexts: parsedBundle.sourceTexts,
          dirtyFileIds: [],
          manifestDirty: false,
          autosaveState: 'idle',
          lastAutosavedAt: null,
          lastAutosaveError: null,
        });
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
      const parsedPayload = buildParsedPayloadFromSession(session);
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
          assertBrowserFileSize(file, MAX_PROJECT_BUNDLE_BYTES, `${file.name} project bundle`);
          const bytes = await readBrowserFileAsUint8Array(file);
          await importProjectBundleAsLocalProject(bytes);
          return;
        }
        assertBrowserFileSize(file, MAX_PORTABLE_PROJECT_TEXT_BYTES, `${file.name} project file`);
        const rawText = await readBrowserFileAsText(file);
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

  const importProjectSourceFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!projectSession || files.length === 0) return false;
      try {
        const loadedFiles = await Promise.all(
          files.map(async (file) => ({
            file,
            text: await readBrowserFileAsText(file),
          })),
        );
        updateProjectSession((current) => {
          const nowIso = new Date().toISOString();
          const workspace = normalizeSessionWorkspace(current);
          const existingNames = new Set(current.manifest.files.map((entry) => entry.name));
          const appendedEntries = loadedFiles.map(({ file, text }, index) => {
            const requestedName = getImportedProjectSourceName(file.name);
            const nextName = existingNames.has(requestedName)
              ? buildFileNameCopy(requestedName, existingNames)
              : requestedName;
            existingNames.add(nextName);
            return createManifestEntry({
              name: nextName,
              kind: 'dat',
              order: current.manifest.files.length + index,
              text,
              createdAt: nowIso,
              updatedAt: nowIso,
              modifiedAt: nowIso,
            });
          });
          current.manifest.files = [...current.manifest.files, ...appendedEntries];
          current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
            ...workspace,
            openFileIds: appendedEntries.reduce(
              (ids, entry) => appendUniqueId(ids, entry.id),
              workspace.openFileIds,
            ),
            focusedFileId: appendedEntries[appendedEntries.length - 1]?.id ?? workspace.focusedFileId,
          });
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.sourceTexts = appendedEntries.reduce<Record<string, string>>(
            (sourceTexts, entry, index) => {
              sourceTexts[entry.id] = loadedFiles[index]?.text ?? '';
              return sourceTexts;
            },
            { ...current.sourceTexts },
          );
          current.dirtyFileIds = appendedEntries.reduce(
            (ids, entry) => appendUniqueId(ids, entry.id),
            current.dirtyFileIds,
          );
          current.manifestDirty = true;
          current.autosaveState = 'idle';
          current.lastAutosaveError = null;
          return current;
        });
        setImportNotice({
          title: 'Project source file added',
          detailLines:
            loadedFiles.length === 1
              ? [`Added ${getImportedProjectSourceName(loadedFiles[0]?.file.name ?? 'file')}.`]
              : [`Added ${loadedFiles.length} source files to the current project.`],
        });
        return true;
      } catch (error) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
        return false;
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const importGeneratedProjectSourceFile = useCallback(
    async ({ sourceName, text }: { sourceName: string; text: string }): Promise<boolean> => {
      if (!text.trim()) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: ['Imported review output was empty after reconciliation.'],
        });
        return false;
      }
      let ensuredSession = projectSession;
      if (!ensuredSession) {
        ensuredSession = await createLocalProjectFromCurrentWorkspace();
        if (!ensuredSession) return false;
      }
      const requestedName = buildImportedReviewFileName(sourceName);
      let finalName = requestedName;
      let nextInputText = text;
      let nextIncludeFiles: Record<string, string> = {};
      setProjectSession((current) => {
        const base = cloneProjectSessionState(current ?? ensuredSession!);
        const nowIso = new Date().toISOString();
        const workspace = normalizeSessionWorkspace(base);
        const existingNames = new Set(base.manifest.files.map((entry) => entry.name));
        finalName = existingNames.has(requestedName)
          ? buildFileNameCopy(requestedName, existingNames)
          : requestedName;
        const entry = createManifestEntry({
          name: finalName,
          kind: 'dat',
          order: base.manifest.files.length,
          enabled: true,
          text,
          createdAt: nowIso,
          updatedAt: nowIso,
          modifiedAt: nowIso,
        });
        base.manifest.files = [...base.manifest.files, entry];
        base.manifest.workspace = normalizeWorkspaceState(base.manifest.files, {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
          focusedFileId: entry.id,
        });
        base.manifest.updatedAt = nowIso;
        base.indexRow = touchProjectIndexRow(base.indexRow, nowIso);
        base.sourceTexts = {
          ...base.sourceTexts,
          [entry.id]: text,
        };
        base.dirtyFileIds = appendUniqueId(base.dirtyFileIds, entry.id);
        base.manifestDirty = true;
        base.autosaveState = 'idle';
        base.lastAutosaveError = null;
        nextInputText = base.sourceTexts[entry.id] ?? text;
        nextIncludeFiles = buildProjectEditorIncludeFiles(base.manifest, base.sourceTexts, entry.id);
        return base;
      });
      setInput(nextInputText);
      setProjectIncludeFiles(nextIncludeFiles);
      setImportNotice({
        title: 'Project source file added',
        detailLines: [`Added ${finalName}.`],
      });
      return true;
    },
    [
      createLocalProjectFromCurrentWorkspace,
      projectSession,
      setInput,
      setImportNotice,
      setProjectIncludeFiles,
    ],
  );

  const prepareAssociatedProjectSettingsImport = useCallback(
    async (file: File): Promise<PreparedAssociatedProjectSettingsImport | null> => {
      try {
        assertBrowserFileSize(
          file,
          MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
          `${file.name} associated settings file`,
        );
        const rawText = await readBrowserFileAsText(file);
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.snproj')) {
          return buildSnprojAssociatedSettingsPayload({
            rawText,
            sourceName: file.name,
            settings,
            parseSettings,
            exportFormat,
            adjustedPointsExportSettings,
            projectInstruments,
            selectedInstrument,
            levelLoopCustomPresets,
          });
        }
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
            title: 'Associated settings import failed',
            detailLines: parsed.errors,
          });
          return null;
        }
        return {
          sourceName: file.name,
          payload: parsed.project,
          appliedDomains: [
            'project settings',
            'parse settings',
            'adjusted-points export',
            'instrument library',
          ],
          ignoredDomains: [],
        };
      } catch (error) {
        setImportNotice({
          title: 'Associated settings import failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
        return null;
      }
    },
    [
      adjustedPointsExportSettings,
      exportFormat,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      setImportNotice,
      settings,
    ],
  );

  const applyPreparedAssociatedProjectSettings = useCallback(
    async (
      prepared: PreparedAssociatedProjectSettingsImport,
      options: ApplyPreparedAssociatedProjectSettingsOptions = {},
    ): Promise<boolean> => {
      try {
        const normalized = normalizeImportedProjectPayload(prepared.payload);
        setSettings(normalized.normalizedLoadedSettings);
        setParseSettings(normalized.normalizedLoadedParseSettings);
        setGeoidSourceData(
          prepared.payload.ui.geoidSourceDataBase64 != null ? normalized.geoidSourceData : geoidSourceData,
        );
        setGeoidSourceDataLabel(
          prepared.payload.ui.geoidSourceDataLabel != null
            ? normalized.geoidSourceDataLabel
            : geoidSourceDataLabel,
        );
        setExportFormat(normalized.exportFormat);
        setAdjustedPointsExportSettings(
          cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings),
        );
        setProjectInstruments(cloneInstrumentLibrary(normalized.projectInstruments));
        setSelectedInstrument(normalized.selectedInstrument);
        setLevelLoopCustomPresets(
          normalized.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );

        setSettingsDraft(normalized.normalizedLoadedSettings);
        setParseSettingsDraft(normalized.normalizedLoadedParseSettings);
        setGeoidSourceDataDraft(
          prepared.payload.ui.geoidSourceDataBase64 != null ? normalized.geoidSourceData : geoidSourceData,
        );
        setGeoidSourceDataLabelDraft(
          prepared.payload.ui.geoidSourceDataLabel != null
            ? normalized.geoidSourceDataLabel
            : geoidSourceDataLabel,
        );
        setProjectInstrumentsDraft(cloneInstrumentLibrary(normalized.projectInstruments));
        setSelectedInstrumentDraft(normalized.selectedInstrument);
        setLevelLoopCustomPresetsDraft(
          normalized.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );
        setAdjustedPointsExportSettingsDraft(
          cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings),
        );
        setIsAdjustedPointsTransformSelectOpen(false);
        setAdjustedPointsTransformSelectedDraft([]);

        if (projectSession) {
          updateProjectSession(
            (current) => {
              const nowIso = new Date().toISOString();
              current.manifest.ui.settings =
                normalized.normalizedLoadedSettings as unknown as Record<string, unknown>;
              current.manifest.ui.parseSettings =
                normalized.normalizedLoadedParseSettings as unknown as Record<string, unknown>;
              if (prepared.payload.ui.geoidSourceDataBase64 != null) {
                current.manifest.ui.geoidSourceDataBase64 = prepared.payload.ui.geoidSourceDataBase64;
              }
              if (prepared.payload.ui.geoidSourceDataLabel != null) {
                current.manifest.ui.geoidSourceDataLabel = prepared.payload.ui.geoidSourceDataLabel;
              }
              current.manifest.ui.exportFormat = normalized.exportFormat;
              current.manifest.ui.adjustedPointsExport = cloneAdjustedPointsExportSettings(
                normalized.loadedAdjustedPointsSettings,
              );
              current.manifest.project.projectInstruments = cloneInstrumentLibrary(
                normalized.projectInstruments,
              );
              current.manifest.project.selectedInstrument = normalized.selectedInstrument;
              current.manifest.project.levelLoopCustomPresets =
                normalized.levelLoopCustomPresets.map((preset) => ({ ...preset }));
              current.manifest.updatedAt = nowIso;
              current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
              current.manifestDirty = true;
              current.autosaveState = 'idle';
              current.lastAutosaveError = null;
              return current;
            },
            { syncEditor: false },
          );
        }

        resetWorkspaceAfterProjectLoad();
        const detailLines = [
          ...(options.successDetailPrefix ?? []),
          `Applied settings from ${prepared.sourceName}.`,
          `Applied: ${prepared.appliedDomains.join(', ') || 'recognized project settings'}.`,
        ];
        if (prepared.ignoredDomains.length > 0) {
          detailLines.push(`Ignored: ${prepared.ignoredDomains.join(', ')}.`);
        }
        setImportNotice({
          title: options.successTitle ?? 'Associated settings imported',
          detailLines,
        });
        return true;
      } catch (error) {
        setImportNotice({
          title: options.failureTitle ?? 'Associated settings import failed',
          detailLines: [
            ...(options.failureDetailPrefix ?? []),
            error instanceof Error ? error.message : String(error),
          ],
        });
        return false;
      }
    },
    [
      cloneInstrumentLibrary,
      normalizeImportedProjectPayload,
      projectSession,
      resetWorkspaceAfterProjectLoad,
      setAdjustedPointsExportSettings,
      setAdjustedPointsExportSettingsDraft,
      setAdjustedPointsTransformSelectedDraft,
      setExportFormat,
      setGeoidSourceData,
      setGeoidSourceDataDraft,
      setGeoidSourceDataLabel,
      setGeoidSourceDataLabelDraft,
      geoidSourceData,
      geoidSourceDataLabel,
      setImportNotice,
      setIsAdjustedPointsTransformSelectOpen,
      setLevelLoopCustomPresets,
      setLevelLoopCustomPresetsDraft,
      setParseSettings,
      setParseSettingsDraft,
      setProjectInstruments,
      setProjectInstrumentsDraft,
      setSelectedInstrument,
      setSelectedInstrumentDraft,
      setSettings,
      setSettingsDraft,
      updateProjectSession,
    ],
  );

  const importAssociatedProjectSettingsFile = useCallback(
    async (file: File): Promise<boolean> => {
      const prepared = await prepareAssociatedProjectSettingsImport(file);
      if (!prepared) return false;
      return applyPreparedAssociatedProjectSettings(prepared);
    },
    [
      applyPreparedAssociatedProjectSettings,
      prepareAssociatedProjectSettingsImport,
    ],
  );

  const handleProjectSourceFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      e.target.value = '';
      await importProjectSourceFiles(files);
    },
    [importProjectSourceFiles],
  );

  const openFileTab = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        if (!current.manifest.files.some((file) => file.id === fileId)) return current;
        const nowIso = new Date().toISOString();
        const workspace = normalizeSessionWorkspace(current);
        current.manifest.workspace = {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, fileId),
          focusedFileId: fileId,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const focusFileTab = useCallback(
    (fileId: string) => {
      openFileTab(fileId);
    },
    [openFileTab],
  );

  const closeFileTab = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        const workspace = normalizeSessionWorkspace(current);
        if (!workspace.openFileIds.includes(fileId)) return current;
        const removedIndex = workspace.openFileIds.indexOf(fileId);
        const preferredNeighbors = [
          workspace.openFileIds[removedIndex + 1],
          workspace.openFileIds[removedIndex - 1],
        ].filter((value): value is string => Boolean(value));
        const nextFocusedFileId =
          workspace.focusedFileId === fileId
            ? resolveNextFocusedFileId(workspace.openFileIds, fileId, preferredNeighbors)
            : workspace.focusedFileId;
        const nowIso = new Date().toISOString();
        current.manifest.workspace = {
          ...workspace,
          openFileIds: removeFileId(workspace.openFileIds, fileId),
          focusedFileId: nextFocusedFileId,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const createBlankProjectFile = useCallback(
    (options?: { name?: string; kind?: ProjectSourceFileKind }) => {
      if (!projectSession) {
        setImportNotice({
          title: 'No local project',
          detailLines: ['Create or open a local project before adding source files.'],
        });
        return '';
      }
      const suggestedName =
        options?.name ?? `section-${projectSession.manifest.files.length + 1}.dat`;
      const name =
        options?.name ?? window.prompt('New source file name', suggestedName)?.trim() ?? '';
      if (!name) return '';
      let createdFileId = '';
      try {
        updateProjectSession((current) => {
          if (current.manifest.files.some((file) => file.name === name)) {
            throw new Error(`A project source file named "${name}" already exists.`);
          }
          const nowIso = new Date().toISOString();
          const entry = createManifestEntry({
            name,
            kind: options?.kind ?? 'dat',
            order: current.manifest.files.length,
            enabled: false,
            text: '',
            createdAt: nowIso,
            updatedAt: nowIso,
            modifiedAt: nowIso,
          });
          createdFileId = entry.id;
          const workspace = normalizeSessionWorkspace(current);
          current.manifest.files = [...current.manifest.files, entry];
          current.manifest.workspace = normalizeWorkspaceState(
            current.manifest.files,
            {
              ...workspace,
              openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
              focusedFileId: entry.id,
            },
          );
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
      return createdFileId;
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const duplicateProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return '';
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return '';
      let duplicatedFileId = '';
      updateProjectSession((current) => {
        const targetFile = current.manifest.files.find((file) => file.id === fileId);
        if (!targetFile) return current;
        const nowIso = new Date().toISOString();
        const nextName = buildFileNameCopy(
          targetFile.name,
          new Set(current.manifest.files.map((file) => file.name)),
        );
        const entry = createManifestEntry({
          name: nextName,
          kind: targetFile.kind,
          order: current.manifest.files.length,
          enabled: false,
          text: current.sourceTexts[targetFile.id] ?? '',
          createdAt: nowIso,
          updatedAt: nowIso,
          modifiedAt: nowIso,
        });
        duplicatedFileId = entry.id;
        const workspace = normalizeSessionWorkspace(current);
        current.manifest.files = [...current.manifest.files, entry];
        current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
          focusedFileId: entry.id,
        });
        current.sourceTexts = {
          ...current.sourceTexts,
          [entry.id]: current.sourceTexts[targetFile.id] ?? '',
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, entry.id);
        current.manifestDirty = true;
        return current;
      });
      return duplicatedFileId;
    },
    [projectSession, updateProjectSession],
  );

  const renameProjectFile = useCallback(
    (fileId: string, requestedName?: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      const nextName =
        requestedName ?? window.prompt('Rename source file', target.name)?.trim() ?? '';
      if (!nextName || nextName === target.name) return;
      try {
        updateProjectSession((current) => {
          if (current.manifest.files.some((file) => file.id !== fileId && file.name === nextName)) {
            throw new Error(`A project source file named "${nextName}" already exists.`);
          }
          const nowIso = new Date().toISOString();
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === fileId
              ? {
                  ...file,
                  name: nextName,
                  path: file.path,
                  updatedAt: nowIso,
                  modifiedAt: nowIso,
                }
              : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.manifestDirty = true;
          return current;
        }, { syncEditor: false });
      } catch (error) {
        setImportNotice({
          title: 'Rename failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const setProjectFileEnabled = useCallback(
    (fileId: string, enabled: boolean) => {
      updateProjectSession((current) => {
        if (!current.manifest.files.some((file) => file.id === fileId)) return current;
        const nowIso = new Date().toISOString();
        current.manifest.files = current.manifest.files.map((file) =>
          file.id === fileId ? { ...file, enabled, updatedAt: nowIso, modifiedAt: nowIso } : file,
        );
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.autosaveState = 'idle';
        current.lastAutosaveError = null;
        return current;
      }, { syncEditor: false });
    },
    [updateProjectSession],
  );

  const reorderProjectFiles = useCallback(
    (fileIdsInOrder: string[]) => {
      updateProjectSession((current) => {
        const sorted = [...current.manifest.files].sort((a, b) => a.order - b.order);
        const byId = new Map(sorted.map((file) => [file.id, file]));
        const requested = fileIdsInOrder
          .map((fileId) => byId.get(fileId))
          .filter((file): file is NonNullable<typeof file> => file != null);
        if (requested.length === 0) return current;
        const remaining = sorted.filter((file) => !fileIdsInOrder.includes(file.id));
        const nextFiles = [...requested, ...remaining];
        const nowIso = new Date().toISOString();
        current.manifest.files = nextFiles.map((file, order) => ({
          ...file,
          order,
          updatedAt: fileIdsInOrder.includes(file.id) ? nowIso : file.updatedAt,
          modifiedAt: fileIdsInOrder.includes(file.id) ? nowIso : file.modifiedAt,
        }));
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.autosaveState = 'idle';
        current.lastAutosaveError = null;
        return current;
      }, { syncEditor: false });
    },
    [updateProjectSession],
  );

  const moveProjectFile = useCallback(
    (fileId: string, direction: 'up' | 'down') => {
      if (!projectSession) return;
      const sorted = [...projectSession.manifest.files].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;
      const nextIds = sorted.map((file) => file.id);
      const [moved] = nextIds.splice(index, 1);
      nextIds.splice(targetIndex, 0, moved);
      reorderProjectFiles(nextIds);
    },
    [projectSession, reorderProjectFiles],
  );

  const deleteProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      const accepted = window.confirm(
        `Delete source file "${target.name}" from the current local project?`,
      );
      if (!accepted) return;
      updateProjectSession((current) => {
        const nowIso = new Date().toISOString();
        const sorted = [...current.manifest.files].sort((a, b) => a.order - b.order);
        const removedIndex = sorted.findIndex((file) => file.id === fileId);
        if (removedIndex < 0) return current;
        const preferredNeighbors = [
          sorted[removedIndex + 1]?.id,
          sorted[removedIndex - 1]?.id,
        ].filter((value): value is string => Boolean(value));
        const nextFiles = sorted.filter((file) => file.id !== fileId).map((file, order) => ({
          ...file,
          order,
        }));
        const workspace = normalizeWorkspaceState(nextFiles, current.manifest.workspace);
        const nextFocusedFileId =
          workspace.focusedFileId === fileId
            ? resolveNextFocusedFileId(workspace.openFileIds, fileId, preferredNeighbors)
            : workspace.focusedFileId;
        current.manifest.files = nextFiles;
        current.manifest.workspace = normalizeWorkspaceState(nextFiles, {
          ...workspace,
          openFileIds: removeFileId(workspace.openFileIds, fileId),
          focusedFileId: nextFocusedFileId,
        });
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
    [projectSession, updateProjectSession],
  );

  const removeProjectFile = deleteProjectFile;

  const openProjectWorkspace = useCallback(async () => {
    if (recentProjects.length > 0) {
      await openProjectById(recentProjects[0].id);
      return;
    }
    triggerProjectFileSelect();
  }, [openProjectById, recentProjects, triggerProjectFileSelect]);

  return {
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept: PROJECT_SOURCE_ACCEPT,
    associatedProjectSettingsAccept: ASSOCIATED_PROJECT_SETTINGS_ACCEPT,
    effectiveRunInput,
    effectiveProjectRunFiles,
    projectRunValidation,
    getOrderedRunFiles,
    validateRunSet,
    effectiveSolveInput,
    effectiveSolveIncludeFiles,
    effectiveRunIncludeFiles,
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
    importProjectSourceFiles,
    importGeneratedProjectSourceFile,
    prepareAssociatedProjectSettingsImport,
    applyPreparedAssociatedProjectSettings,
    importAssociatedProjectSettingsFile,
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
    openFileTab,
    closeFileTab,
    focusFileTab,
    createBlankProjectFile,
    duplicateProjectFile,
    switchActiveProjectFile: focusFileTab,
    renameProjectFile,
    toggleProjectFileEnabled: (fileId: string) => {
      const target = projectSession?.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      setProjectFileEnabled(fileId, !target.enabled);
    },
    setProjectFileEnabled,
    reorderProjectFiles,
    moveProjectFile,
    deleteProjectFile,
    removeProjectFile,
  };
};
