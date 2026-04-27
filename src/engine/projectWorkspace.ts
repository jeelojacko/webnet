import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';

export const WEBNET_PROJECT_SCHEMA_VERSION = 5;

export type ProjectStorageBackend = 'opfs' | 'indexeddb';
export type ProjectSourceFileKind = 'dat' | 'control' | 'notes' | 'report' | 'other';

export interface ProjectIndexRow {
  id: string;
  name: string;
  backend: ProjectStorageBackend;
  rootKey: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  starred?: boolean;
}

export interface ProjectStorageStatus {
  hasOpfs: boolean;
  hasIndexedDb: boolean;
  canPersist: boolean;
  persisted: boolean | null;
  preferredBackend: ProjectStorageBackend;
}

export interface ProjectManifestFileEntry {
  id: string;
  name: string;
  kind: ProjectSourceFileKind;
  path: string;
  enabled: boolean;
  order: number;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  modifiedAt?: string;
}

export interface ProjectManifestWorkspaceState {
  openFileIds: string[];
  focusedFileId?: string;
  mainFileId?: string;
  fileListCollapsed?: boolean;
}

export interface ProjectManifestUiPayload {
  settings: Record<string, unknown>;
  parseSettings: Record<string, unknown>;
  exportFormat: ProjectExportFormat;
  adjustedPointsExport: AdjustedPointsExportSettings;
  migration?: {
    parseModeMigrated: boolean;
    migratedAt?: string;
    listingSortModeVersion?: number;
  };
}

export interface ProjectManifestProjectPayload {
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}

interface ProjectManifestV5Base {
  kind: 'webnet-project';
  schemaVersion: 5;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: ProjectManifestFileEntry[];
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  workspace?: ProjectManifestWorkspaceState;
}

export interface WebNetProjectManifestV5 extends ProjectManifestV5Base {
  storageLayout: 'manifest';
}

export interface WebNetPortableProjectFileV5 extends ProjectManifestV5Base {
  storageLayout: 'portable';
  fileContents: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
}

export interface ProjectSessionState {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
  dirtyFileIds: string[];
  manifestDirty: boolean;
  autosaveState: 'idle' | 'saving' | 'error';
  lastAutosavedAt?: string | null;
  lastAutosaveError?: string | null;
}

export interface ProjectRunFile {
  fileId: string;
  name: string;
  order: number;
  content: string;
}

const FILE_NAME_SANITIZE_RE = /[^a-zA-Z0-9._-]+/g;

const normalizeSourcePath = (value: string): string => value.replace(/\\/g, '/').trim();

export const sortProjectFiles = (files: ProjectManifestFileEntry[]): ProjectManifestFileEntry[] =>
  [...files].sort(
    (a, b) =>
      a.order - b.order ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

const cloneFiles = (files: ProjectManifestFileEntry[]): ProjectManifestFileEntry[] =>
  sortProjectFiles(files).map((file) => ({ ...file }));

const cloneProjectPayload = (
  payload: ProjectManifestProjectPayload,
): ProjectManifestProjectPayload => ({
  projectInstruments: Object.fromEntries(
    Object.entries(payload.projectInstruments).map(([code, instrument]) => [code, { ...instrument }]),
  ),
  selectedInstrument: payload.selectedInstrument,
  levelLoopCustomPresets: payload.levelLoopCustomPresets.map((preset) => ({ ...preset })),
});

const cloneUiPayload = (payload: ProjectManifestUiPayload): ProjectManifestUiPayload => ({
  settings: { ...payload.settings },
  parseSettings: { ...payload.parseSettings },
  exportFormat: payload.exportFormat,
  adjustedPointsExport: JSON.parse(JSON.stringify(payload.adjustedPointsExport)),
  migration: payload.migration ? { ...payload.migration } : undefined,
});

const toValidFileIdSet = (files: ProjectManifestFileEntry[]): Set<string> =>
  new Set(files.map((file) => file.id));

export const createProjectId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `project-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

export const createProjectFileId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `file-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

export const sanitizeProjectFileStorageName = (value: string): string => {
  const normalized = normalizeSourcePath(value);
  const baseName = normalized.split('/').filter(Boolean).pop() ?? 'file.dat';
  const sanitized = baseName.replace(FILE_NAME_SANITIZE_RE, '-');
  return sanitized || 'file.dat';
};

export const buildProjectFileStoragePath = (fileId: string, name: string): string =>
  `data/${fileId}-${sanitizeProjectFileStorageName(name)}`;

export const normalizeProjectFileKind = (
  value: unknown,
  fallback: ProjectSourceFileKind = 'dat',
): ProjectSourceFileKind => {
  if (value === 'dat' || value === 'control' || value === 'notes' || value === 'report' || value === 'other') {
    return value;
  }
  if (value === 'main' || value === 'include' || value === 'import') return 'dat';
  return fallback;
};

export const normalizeWorkspaceState = (
  files: ProjectManifestFileEntry[],
  workspace?: Partial<ProjectManifestWorkspaceState> | null,
): ProjectManifestWorkspaceState => {
  const sortedFiles = sortProjectFiles(files);
  const validIds = toValidFileIdSet(sortedFiles);
  const legacyMainFileId =
    workspace?.mainFileId && validIds.has(workspace.mainFileId)
      ? workspace.mainFileId
      : sortedFiles[0]?.id;
  const rawOpenFileIds = Array.isArray(workspace?.openFileIds)
    ? workspace.openFileIds.filter((fileId): fileId is string => typeof fileId === 'string' && validIds.has(fileId))
    : [];
  let focusedFileId =
    workspace?.focusedFileId && validIds.has(workspace.focusedFileId)
      ? workspace.focusedFileId
      : rawOpenFileIds[0] ?? legacyMainFileId;
  const openFileIds =
    rawOpenFileIds.length > 0
      ? [...rawOpenFileIds]
      : focusedFileId
        ? [focusedFileId]
        : [];
  if (focusedFileId && !openFileIds.includes(focusedFileId)) {
    openFileIds.unshift(focusedFileId);
  }
  if (!focusedFileId && openFileIds.length > 0) {
    focusedFileId = openFileIds[0];
  }
  return {
    openFileIds,
    focusedFileId,
    mainFileId: legacyMainFileId,
    fileListCollapsed: workspace?.fileListCollapsed === true,
  };
};

export const getProjectFileById = (
  manifest: Pick<WebNetProjectManifestV5, 'files'>,
  fileId?: string | null,
): ProjectManifestFileEntry | null => {
  if (!fileId) return null;
  return manifest.files.find((file) => file.id === fileId) ?? null;
};

export const getProjectLegacyMainFile = (
  manifest: Pick<WebNetProjectManifestV5, 'files' | 'workspace'>,
): ProjectManifestFileEntry | null => {
  const legacyMainFileId = normalizeWorkspaceState(manifest.files, manifest.workspace).mainFileId;
  return getProjectFileById(manifest, legacyMainFileId) ?? sortProjectFiles(manifest.files)[0] ?? null;
};

export const getProjectFocusedFile = (
  manifest: Pick<WebNetProjectManifestV5, 'files' | 'workspace'>,
): ProjectManifestFileEntry | null => {
  const workspace = normalizeWorkspaceState(manifest.files, manifest.workspace);
  return (
    getProjectFileById(manifest, workspace.focusedFileId) ??
    getProjectFileById(manifest, workspace.mainFileId) ??
    sortProjectFiles(manifest.files)[0] ??
    null
  );
};

export const getProjectOpenFiles = (
  manifest: Pick<WebNetProjectManifestV5, 'files' | 'workspace'>,
): ProjectManifestFileEntry[] => {
  const workspace = normalizeWorkspaceState(manifest.files, manifest.workspace);
  return workspace.openFileIds
    .map((fileId) => getProjectFileById(manifest, fileId))
    .filter((file): file is ProjectManifestFileEntry => file != null);
};

export const getCheckedProjectFiles = (
  manifest: Pick<WebNetProjectManifestV5, 'files'>,
): ProjectManifestFileEntry[] => sortProjectFiles(manifest.files).filter((file) => file.enabled);

export const cloneProjectManifest = (
  manifest: WebNetProjectManifestV5,
): WebNetProjectManifestV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'manifest',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  files: cloneFiles(manifest.files),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: normalizeWorkspaceState(manifest.files, manifest.workspace),
});

export const clonePortableProjectFile = (
  project: WebNetPortableProjectFileV5,
): WebNetPortableProjectFileV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'portable',
  projectId: project.projectId,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  files: cloneFiles(project.files),
  fileContents: { ...project.fileContents },
  savedRuns: project.savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))) ?? undefined,
  ui: cloneUiPayload(project.ui),
  project: cloneProjectPayload(project.project),
  workspace: normalizeWorkspaceState(project.files, project.workspace),
});

export const cloneProjectSessionState = (
  session: ProjectSessionState,
): ProjectSessionState => ({
  indexRow: { ...session.indexRow },
  manifest: cloneProjectManifest(session.manifest),
  sourceTexts: { ...session.sourceTexts },
  dirtyFileIds: [...session.dirtyFileIds],
  manifestDirty: session.manifestDirty,
  autosaveState: session.autosaveState,
  lastAutosavedAt: session.lastAutosavedAt ?? null,
  lastAutosaveError: session.lastAutosaveError ?? null,
});

export const createManifestEntry = ({
  id = createProjectFileId(),
  name,
  kind,
  order,
  enabled = true,
  text = '',
  createdAt,
  updatedAt,
  modifiedAt = updatedAt ?? createdAt ?? new Date().toISOString(),
}: {
  id?: string;
  name: string;
  kind: ProjectSourceFileKind;
  order: number;
  enabled?: boolean;
  text?: string;
  createdAt?: string;
  updatedAt?: string;
  modifiedAt?: string;
}): ProjectManifestFileEntry => ({
  id,
  name: normalizeSourcePath(name) || 'file.dat',
  kind,
  path: buildProjectFileStoragePath(id, name),
  enabled,
  order,
  size: text.length,
  createdAt,
  updatedAt,
  modifiedAt,
});

export const createProjectManifest = ({
  projectId = createProjectId(),
  name,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  files,
  ui,
  project,
  workspace,
}: {
  projectId?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  files: ProjectManifestFileEntry[];
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  workspace?: Partial<ProjectManifestWorkspaceState>;
}): WebNetProjectManifestV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'manifest',
  projectId,
  name: name.trim() || 'Untitled Project',
  createdAt,
  updatedAt,
  files: cloneFiles(files),
  ui: cloneUiPayload(ui),
  project: cloneProjectPayload(project),
  workspace: normalizeWorkspaceState(files, workspace),
});

export const buildProjectSourceTextMap = (
  files: Array<{ id: string; text: string }>,
): Record<string, string> => Object.fromEntries(files.map((file) => [file.id, file.text]));

export const buildProjectEditorIncludeFiles = (
  manifest: Pick<WebNetProjectManifestV5, 'files'>,
  sourceTexts: Record<string, string>,
  excludeFileId?: string,
): Record<string, string> =>
  Object.fromEntries(
    sortProjectFiles(manifest.files)
      .filter((file) => file.id !== excludeFileId)
      .map((file) => [file.name, sourceTexts[file.id] ?? '']),
  );

export const buildProjectRunFiles = (
  manifest: Pick<WebNetProjectManifestV5, 'files'>,
  sourceTexts: Record<string, string>,
): ProjectRunFile[] =>
  getCheckedProjectFiles(manifest).map((file) => ({
    fileId: file.id,
    name: file.name,
    order: file.order,
    content: sourceTexts[file.id] ?? '',
  }));

export const buildProjectLegacySolveInput = (
  manifest: Pick<WebNetProjectManifestV5, 'files' | 'workspace'>,
  sourceTexts: Record<string, string>,
): string => {
  const legacyMain = getProjectLegacyMainFile(manifest);
  return legacyMain ? sourceTexts[legacyMain.id] ?? '' : '';
};

export const buildProjectLegacyIncludeFiles = (
  manifest: Pick<WebNetProjectManifestV5, 'files' | 'workspace'>,
  sourceTexts: Record<string, string>,
): Record<string, string> => {
  const legacyMain = getProjectLegacyMainFile(manifest);
  return Object.fromEntries(
    sortProjectFiles(manifest.files)
      .filter((file) => file.id !== legacyMain?.id)
      .map((file) => [file.name, sourceTexts[file.id] ?? '']),
  );
};

export const buildProjectSolveInput = buildProjectLegacySolveInput;
export const buildProjectSolveIncludeFiles = buildProjectLegacyIncludeFiles;
export const getProjectActiveFile = getProjectFocusedFile;
export const getProjectMainFile = getProjectLegacyMainFile;

export const createPortableProjectFile = ({
  manifest,
  sourceTexts,
  savedRuns,
}: {
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
}): WebNetPortableProjectFileV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'portable',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  files: cloneFiles(manifest.files),
  fileContents: Object.fromEntries(manifest.files.map((file) => [file.id, sourceTexts[file.id] ?? ''])),
  savedRuns: savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: normalizeWorkspaceState(manifest.files, manifest.workspace),
});

export const createSessionFromManifest = ({
  indexRow,
  manifest,
  sourceTexts,
}: {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
}): ProjectSessionState => ({
  indexRow: { ...indexRow },
  manifest: cloneProjectManifest(manifest),
  sourceTexts: { ...sourceTexts },
  dirtyFileIds: [],
  manifestDirty: false,
  autosaveState: 'idle',
  lastAutosavedAt: null,
  lastAutosaveError: null,
});

export const createManifestFromFlatProject = ({
  projectId = createProjectId(),
  name,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  input,
  includeFiles,
  ui,
  project,
  preferredFocusedFileId,
}: {
  projectId?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  input: string;
  includeFiles: Record<string, string>;
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  preferredFocusedFileId?: string;
}): { manifest: WebNetProjectManifestV5; sourceTexts: Record<string, string> } => {
  const mainFile = createManifestEntry({
    name: 'main.dat',
    kind: 'dat',
    order: 0,
    text: input,
    createdAt,
    updatedAt,
    modifiedAt: updatedAt,
  });
  const includeEntries = Object.entries(includeFiles)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([fileName, text], index) =>
      createManifestEntry({
        name: fileName,
        kind: 'dat',
        order: index + 1,
        text,
        createdAt,
        updatedAt,
        modifiedAt: updatedAt,
      }),
    );
  const allFiles = [mainFile, ...includeEntries];
  const focusedFileId =
    allFiles.find((file) => file.id === preferredFocusedFileId)?.id ?? mainFile.id;
  const sourceTexts = {
    [mainFile.id]: input,
    ...Object.fromEntries(includeEntries.map((entry) => [entry.id, includeFiles[entry.name] ?? ''])),
  };
  return {
    manifest: createProjectManifest({
      projectId,
      name,
      createdAt,
      updatedAt,
      files: allFiles,
      ui,
      project,
      workspace: {
        mainFileId: mainFile.id,
        focusedFileId,
        openFileIds: [focusedFileId],
      },
    }),
    sourceTexts,
  };
};

export const createManifestFromPortableProject = ({
  portable,
}: {
  portable: WebNetPortableProjectFileV5;
}): { manifest: WebNetProjectManifestV5; sourceTexts: Record<string, string> } => ({
  manifest: createProjectManifest({
    projectId: portable.projectId,
    name: portable.name,
    createdAt: portable.createdAt,
    updatedAt: portable.updatedAt,
    files: portable.files,
    ui: portable.ui,
    project: portable.project,
    workspace: portable.workspace,
  }),
  sourceTexts: { ...portable.fileContents },
});
