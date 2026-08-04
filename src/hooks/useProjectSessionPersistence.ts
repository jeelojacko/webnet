import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { ParseSettings, SettingsState } from '../appStateTypes';
import { cloneAdjustedPointsExportSettings } from '../engine/adjustedPointsExport';
import { cloneSurveyCadPersistedState } from '../engine/cad/cadPersistence';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { clonePlanningMapState } from '../engine/planningMapState';
import { stableSerializePlain } from '../engine/plainData';
import { stripLocalOnlyProjectSettings } from '../engine/projectExportSlimming';
import {
  buildSavedSessionForStorage,
  createProjectStorage,
  touchProjectIndexRow,
} from '../engine/projectStorage';
import {
  buildProjectEditorIncludeFiles,
  cloneProjectSessionState,
  getProjectFocusedFile,
  type ProjectIndexRow,
  type ProjectSessionState,
  type ProjectStorageStatus,
} from '../engine/projectWorkspace';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  PlanningMapState,
  ProjectExportFormat,
} from '../types';
import { applyPersistedProjectSession } from './projectFileSessionHelpers';
import { encodeUint8ArrayToBase64 } from './useWorkspaceRecovery';
import { appendUniqueId, sortRecentProjectRows } from './projectWorkflowUtils';

const PROJECT_AUTOSAVE_DELAY_MS = 60_000;

interface UseProjectSessionPersistenceArgs {
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  exportFormat: ProjectExportFormat;
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  parseSettings: ParseSettings;
  planningMap: PlanningMapState;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  settings: SettingsState;
  surveyCadState: SurveyCadPersistedState | null;
}

export const useProjectSessionPersistence = ({
  adjustedPointsExportSettings,
  cloneInstrumentLibrary,
  exportFormat,
  geoidSourceData,
  geoidSourceDataLabel,
  levelLoopCustomPresets,
  parseSettings,
  planningMap,
  projectInstruments,
  selectedInstrument,
  setInput,
  setProjectIncludeFiles,
  settings,
  surveyCadState,
}: UseProjectSessionPersistenceArgs) => {
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
        settings: stripLocalOnlyProjectSettings(settings as unknown as Record<string, unknown>),
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
      settings: stripLocalOnlyProjectSettings(projectSession.manifest.ui.settings),
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
          settings: stripLocalOnlyProjectSettings(settings as unknown as Record<string, unknown>),
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

  return {
    canUseNamedProjectStorage,
    handleEditorInputChange,
    persistProjectNow,
    projectSession,
    recentProjects,
    refreshStorageContext,
    removeRecentProjectRow,
    setProjectSession,
    storage,
    storageStatus,
    updateProjectSession,
    upsertRecentProjectRow,
  };
};
