import { cloneSurveyCadPersistedState } from './cad/cadPersistence';
import type {
  ProjectManifestFileEntry,
  ProjectManifestProjectPayload,
  ProjectManifestUiPayload,
  ProjectManifestWorkspaceState,
  ProjectSessionState,
  WebNetPortableProjectFileV5,
  WebNetProjectManifestV5,
} from './projectWorkspaceTypes';

export type ProjectWorkspaceCloneDependencies = {
  sortProjectFiles: (_files: ProjectManifestFileEntry[]) => ProjectManifestFileEntry[];
  normalizeWorkspaceState: (
    _files: ProjectManifestFileEntry[],
    _workspace?: Partial<ProjectManifestWorkspaceState> | null,
  ) => ProjectManifestWorkspaceState;
};

export const cloneProjectPayload = (
  payload: ProjectManifestProjectPayload,
): ProjectManifestProjectPayload => ({
  projectInstruments: Object.fromEntries(
    Object.entries(payload.projectInstruments).map(([code, instrument]) => [code, { ...instrument }]),
  ),
  selectedInstrument: payload.selectedInstrument,
  levelLoopCustomPresets: payload.levelLoopCustomPresets.map((preset) => ({ ...preset })),
  surveyCad: payload.surveyCad ? cloneSurveyCadPersistedState(payload.surveyCad) : undefined,
});

export const cloneUiPayload = (payload: ProjectManifestUiPayload): ProjectManifestUiPayload => ({
  settings: { ...payload.settings },
  parseSettings: { ...payload.parseSettings },
  exportFormat: payload.exportFormat,
  adjustedPointsExport: JSON.parse(JSON.stringify(payload.adjustedPointsExport)),
  planningMap: payload.planningMap
    ? JSON.parse(JSON.stringify(payload.planningMap))
    : undefined,
  geoidSourceDataBase64: payload.geoidSourceDataBase64 ?? null,
  geoidSourceDataLabel: payload.geoidSourceDataLabel ?? '',
  migration: payload.migration ? { ...payload.migration } : undefined,
});

export const cloneFiles = (
  files: ProjectManifestFileEntry[],
  { sortProjectFiles }: Pick<ProjectWorkspaceCloneDependencies, 'sortProjectFiles'>,
): ProjectManifestFileEntry[] => sortProjectFiles(files).map((file) => ({ ...file }));

export const cloneProjectManifestWithDependencies = (
  manifest: WebNetProjectManifestV5,
  dependencies: ProjectWorkspaceCloneDependencies,
): WebNetProjectManifestV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'manifest',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  files: cloneFiles(manifest.files, dependencies),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: dependencies.normalizeWorkspaceState(manifest.files, manifest.workspace),
});

export const clonePortableProjectFileWithDependencies = (
  project: WebNetPortableProjectFileV5,
  dependencies: ProjectWorkspaceCloneDependencies,
): WebNetPortableProjectFileV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'portable',
  projectId: project.projectId,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  files: cloneFiles(project.files, dependencies),
  fileContents: { ...project.fileContents },
  savedRuns: project.savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))) ?? undefined,
  ui: cloneUiPayload(project.ui),
  project: cloneProjectPayload(project.project),
  workspace: dependencies.normalizeWorkspaceState(project.files, project.workspace),
});

export const cloneProjectSessionStateWithDependencies = (
  session: ProjectSessionState,
  dependencies: ProjectWorkspaceCloneDependencies,
): ProjectSessionState => ({
  indexRow: { ...session.indexRow },
  manifest: cloneProjectManifestWithDependencies(session.manifest, dependencies),
  sourceTexts: { ...session.sourceTexts },
  dirtyFileIds: [...session.dirtyFileIds],
  manifestDirty: session.manifestDirty,
  autosaveState: session.autosaveState,
  lastAutosavedAt: session.lastAutosavedAt ?? null,
  lastAutosaveError: session.lastAutosaveError ?? null,
});
