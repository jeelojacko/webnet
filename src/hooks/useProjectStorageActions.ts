import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import {
  buildProjectIndexRow,
  requestPersistentStorage,
} from '../engine/projectStorage';
import {
  createProjectId,
  type ProjectIndexRow,
  type ProjectSessionState,
  type ProjectStorageStatus,
} from '../engine/projectWorkspace';
import type { InstrumentLibrary } from '../types';
import {
  buildParsedPayloadFromSession,
  createFlatProjectManifestSeed,
  type ProjectFlatWorkspacePayloadOptions,
} from './projectFilePayloadBuilders';

type ImportNotice = {
  title: string;
  detailLines: string[];
};

interface UseProjectStorageActionsArgs {
  applyLoadedProjectPayload: (
    _parsed: ReturnType<typeof buildParsedPayloadFromSession>,
    _nextSession: ProjectSessionState | null,
    _savedRuns: PersistedSavedRunSnapshot[],
  ) => void;
  canUseNamedProjectStorage: boolean;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  persistProjectNow: (_session: ProjectSessionState) => Promise<void>;
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectFlatWorkspacePayload: ProjectFlatWorkspacePayloadOptions;
  projectSession: ProjectSessionState | null;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
  recentProjects: ProjectIndexRow[];
  refreshStorageContext: () => Promise<void>;
  removeRecentProjectRow: (_projectId: string) => void;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  setProjectSession: Dispatch<SetStateAction<ProjectSessionState | null>>;
  storage: ReturnType<typeof import('../engine/projectStorage').createProjectStorage>;
  storageStatus: ProjectStorageStatus | null;
  upsertRecentProjectRow: (_row: ProjectIndexRow) => void;
}

export const useProjectStorageActions = ({
  applyLoadedProjectPayload,
  canUseNamedProjectStorage,
  cloneInstrumentLibrary,
  persistProjectNow,
  projectFileInputRef,
  projectFlatWorkspacePayload,
  projectSession,
  projectSourceFileInputRef,
  recentProjects,
  refreshStorageContext,
  removeRecentProjectRow,
  setImportNotice,
  setProjectSession,
  storage,
  storageStatus,
  upsertRecentProjectRow,
}: UseProjectStorageActionsArgs) => {
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
    const cleanSession = {
      ...session,
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle' as const,
      lastAutosavedAt: createdAt,
      lastAutosaveError: null,
    };
    setProjectSession(cleanSession);
    await requestPersistentStorage();
    await refreshStorageContext();
    setImportNotice({
      title: 'Local project created',
      detailLines: [
        `Created ${name}.`,
        'Named projects now autosave sources and settings to browser project storage.',
      ],
    });
    return cleanSession;
  }, [
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    projectFlatWorkspacePayload,
    refreshStorageContext,
    setImportNotice,
    setProjectSession,
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
      setProjectSession,
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
    [
      projectSession?.indexRow.id,
      recentProjects,
      removeRecentProjectRow,
      setImportNotice,
      setProjectSession,
      storage,
    ],
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

  const openProjectWorkspace = useCallback(async () => {
    if (recentProjects.length > 0) {
      await openProjectById(recentProjects[0].id);
      return;
    }
    triggerProjectFileSelect();
  }, [openProjectById, recentProjects, triggerProjectFileSelect]);

  return {
    createLocalProjectFromCurrentWorkspace,
    deleteLocalProject,
    handleSaveProject,
    openProjectById,
    openProjectWorkspace,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
  };
};
