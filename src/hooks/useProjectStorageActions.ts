import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { buildBlankProjectWorkspace } from '../app/blankProjectDefaults';
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
  const persistNewProject = useCallback(async ({
    name,
    workspace,
    createdTitle,
  }: {
    name: string;
    workspace: ProjectFlatWorkspacePayloadOptions;
    createdTitle: string;
  }): Promise<ProjectSessionState | null> => {
    const createdAt = new Date().toISOString();
    const seed = createFlatProjectManifestSeed({
      projectId: createProjectId(),
      name,
      createdAt,
      updatedAt: createdAt,
      workspace,
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
    // Persist + attach the session only. Callers decide whether the live
    // workspace must be reloaded (explicit Create) or kept (Save/Import).
    setProjectSession(cleanSession);
    await requestPersistentStorage();
    await refreshStorageContext();
    setImportNotice({
      title: createdTitle,
      detailLines: [
        `Created ${name}.`,
        'Named projects now autosave sources and settings to browser project storage.',
      ],
    });
    return cleanSession;
  }, [
    cloneInstrumentLibrary,
    refreshStorageContext,
    setImportNotice,
    setProjectSession,
    storage,
    storageStatus?.preferredBackend,
  ]);

  const createNamedProject = useCallback(async ({
    name,
    workspace,
    createdTitle,
  }: {
    name: string;
    workspace: ProjectFlatWorkspacePayloadOptions;
    createdTitle: string;
  }): Promise<ProjectSessionState | null> => {
    const cleanSession = await persistNewProject({ name, workspace, createdTitle });
    if (!cleanSession) return null;
    // Explicit Create switches the live UI to the new (blank) payload and
    // cancels any in-flight run via resetWorkspaceAfterProjectLoad inside the
    // loader's reset path, so a late outcome cannot publish into the new project.
    applyLoadedProjectPayload(buildParsedPayloadFromSession(cleanSession), cleanSession, []);
    return cleanSession;
  }, [applyLoadedProjectPayload, persistNewProject]);

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
    // Shared switch guard: the sidebar and Project Files tab both route here, so
    // untitled work is only discarded after one confirmation.
    if (
      projectSession == null &&
      projectFlatWorkspacePayload.input.trim() !== '' &&
      !window.confirm('Create a new blank project? Unsaved untitled input will be discarded.')
    ) {
      return null;
    }
    const suggestedName = `WebNet Project ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('Project name', suggestedName)?.trim();
    if (!name) return null;
    // New projects always start blank; never clone the current workspace.
    return createNamedProject({
      name,
      workspace: buildBlankProjectWorkspace(),
      createdTitle: 'Local project created',
    });
  }, [canUseNamedProjectStorage, createNamedProject, projectFlatWorkspacePayload.input, projectSession, setImportNotice]);

  // Clone-preserving creation for Save/Import fallbacks: unlike the explicit
  // Create action, these routes must keep the current untitled workspace. The
  // named session is attached but live input/results/review state are untouched.
  const createProjectFromCurrentWorkspace = useCallback(async (createdTitle = 'Local project created'): Promise<ProjectSessionState | null> => {
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
    return persistNewProject({
      name,
      workspace: projectFlatWorkspacePayload,
      createdTitle,
    });
  }, [canUseNamedProjectStorage, persistNewProject, projectFlatWorkspacePayload, setImportNotice]);

  const handleSaveProject = useCallback(async () => {
    if (!projectSession) {
      // Save preserves the current workspace (old clone behavior); only the
      // explicit Create action starts blank.
      await createProjectFromCurrentWorkspace('Local project saved');
      return;
    }
    await persistProjectNow(projectSession);
    setImportNotice({
      title: 'Local project saved',
      detailLines: [`Saved ${projectSession.manifest.name}.`],
    });
  }, [createProjectFromCurrentWorkspace, persistProjectNow, projectSession, setImportNotice]);

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
    createProjectFromCurrentWorkspace,
    deleteLocalProject,
    handleSaveProject,
    openProjectById,
    openProjectWorkspace,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
  };
};
