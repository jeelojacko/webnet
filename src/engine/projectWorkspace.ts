import type { AdjustedPointsExportSettings, CustomLevelLoopTolerancePreset, InstrumentLibrary, ProjectExportFormat } from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';

export const WEBNET_PROJECT_SCHEMA_VERSION = 4;

export type ProjectStorageBackend = 'opfs' | 'indexeddb';
export type ProjectSourceFileKind = 'main' | 'include' | 'import' | 'control';

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
  modifiedAt?: string;
}

export interface ProjectManifestWorkspaceState {
  activeFileId?: string;
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
  };
}

export interface ProjectManifestProjectPayload {
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}

interface ProjectManifestV4Base {
  kind: 'webnet-project';
  schemaVersion: 4;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  mainFileId: string;
  files: ProjectManifestFileEntry[];
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  workspace?: ProjectManifestWorkspaceState;
}

export interface WebNetProjectManifestV4 extends ProjectManifestV4Base {
  storageLayout: 'manifest';
}

export interface WebNetPortableProjectFileV4 extends ProjectManifestV4Base {
  storageLayout: 'portable';
  fileContents: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
}

export interface ProjectSessionState {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV4;
  sourceTexts: Record<string, string>;
  dirtyFileIds: string[];
  manifestDirty: boolean;
  autosaveState: 'idle' | 'saving' | 'error';
  lastAutosavedAt?: string | null;
  lastAutosaveError?: string | null;
}

const FILE_NAME_SANITIZE_RE = /[^a-zA-Z0-9._-]+/g;

const normalizeSourcePath = (value: string): string => value.replace(/\\/g, '/').trim();

const sortFiles = (files: ProjectManifestFileEntry[]): ProjectManifestFileEntry[] =>
  [...files].sort(
    (a, b) =>
      a.order - b.order ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

const cloneFiles = (files: ProjectManifestFileEntry[]): ProjectManifestFileEntry[] =>
  sortFiles(files).map((file) => ({ ...file }));

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

export const getProjectMainFile = (
  manifest: Pick<WebNetProjectManifestV4, 'files' | 'mainFileId'>,
): ProjectManifestFileEntry | null =>
  manifest.files.find((file) => file.id === manifest.mainFileId) ?? null;

export const getProjectActiveFile = (
  manifest: Pick<WebNetProjectManifestV4, 'files' | 'workspace' | 'mainFileId'>,
): ProjectManifestFileEntry | null => {
  const activeFileId = manifest.workspace?.activeFileId;
  if (activeFileId) {
    const active = manifest.files.find((file) => file.id === activeFileId);
    if (active) return active;
  }
  return getProjectMainFile(manifest);
};

export const cloneProjectManifest = (
  manifest: WebNetProjectManifestV4,
): WebNetProjectManifestV4 => ({
  kind: 'webnet-project',
  schemaVersion: 4,
  storageLayout: 'manifest',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  mainFileId: manifest.mainFileId,
  files: cloneFiles(manifest.files),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: manifest.workspace ? { ...manifest.workspace } : undefined,
});

export const clonePortableProjectFile = (
  project: WebNetPortableProjectFileV4,
): WebNetPortableProjectFileV4 => ({
  kind: 'webnet-project',
  schemaVersion: 4,
  storageLayout: 'portable',
  projectId: project.projectId,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  mainFileId: project.mainFileId,
  files: cloneFiles(project.files),
  fileContents: { ...project.fileContents },
  savedRuns: project.savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))) ?? undefined,
  ui: cloneUiPayload(project.ui),
  project: cloneProjectPayload(project.project),
  workspace: project.workspace ? { ...project.workspace } : undefined,
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
  modifiedAt = new Date().toISOString(),
}: {
  id?: string;
  name: string;
  kind: ProjectSourceFileKind;
  order: number;
  enabled?: boolean;
  text?: string;
  modifiedAt?: string;
}): ProjectManifestFileEntry => ({
  id,
  name: normalizeSourcePath(name) || 'file.dat',
  kind,
  path: buildProjectFileStoragePath(id, name),
  enabled,
  order,
  size: text.length,
  modifiedAt,
});

export const createProjectManifest = ({
  projectId = createProjectId(),
  name,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  files,
  mainFileId,
  ui,
  project,
  workspace,
}: {
  projectId?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  files: ProjectManifestFileEntry[];
  mainFileId: string;
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  workspace?: ProjectManifestWorkspaceState;
}): WebNetProjectManifestV4 => ({
  kind: 'webnet-project',
  schemaVersion: 4,
  storageLayout: 'manifest',
  projectId,
  name: name.trim() || 'Untitled Project',
  createdAt,
  updatedAt,
  mainFileId,
  files: cloneFiles(files),
  ui: cloneUiPayload(ui),
  project: cloneProjectPayload(project),
  workspace: workspace ? { ...workspace } : undefined,
});

export const buildProjectSourceTextMap = (
  files: Array<{ id: string; text: string }>,
): Record<string, string> =>
  Object.fromEntries(files.map((file) => [file.id, file.text]));

export const buildProjectEditorIncludeFiles = (
  manifest: Pick<WebNetProjectManifestV4, 'files'>,
  sourceTexts: Record<string, string>,
  excludeFileId?: string,
): Record<string, string> =>
  Object.fromEntries(
    sortFiles(manifest.files)
      .filter((file) => file.id !== excludeFileId)
      .map((file) => [file.name, sourceTexts[file.id] ?? '']),
  );

export const buildProjectSolveIncludeFiles = (
  manifest: Pick<WebNetProjectManifestV4, 'files' | 'mainFileId'>,
  sourceTexts: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    sortFiles(manifest.files)
      .filter((file) => file.id !== manifest.mainFileId && file.enabled)
      .map((file) => [file.name, sourceTexts[file.id] ?? '']),
  );

export const buildProjectSolveInput = (
  manifest: Pick<WebNetProjectManifestV4, 'files' | 'mainFileId'>,
  sourceTexts: Record<string, string>,
): string => sourceTexts[manifest.mainFileId] ?? '';

export const createPortableProjectFile = ({
  manifest,
  sourceTexts,
  savedRuns,
}: {
  manifest: WebNetProjectManifestV4;
  sourceTexts: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
}): WebNetPortableProjectFileV4 => ({
  kind: 'webnet-project',
  schemaVersion: 4,
  storageLayout: 'portable',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  mainFileId: manifest.mainFileId,
  files: cloneFiles(manifest.files),
  fileContents: Object.fromEntries(
    manifest.files.map((file) => [file.id, sourceTexts[file.id] ?? '']),
  ),
  savedRuns: savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: manifest.workspace ? { ...manifest.workspace } : undefined,
});

export const createSessionFromManifest = ({
  indexRow,
  manifest,
  sourceTexts,
}: {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV4;
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
  preferredActiveFileId,
}: {
  projectId?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  input: string;
  includeFiles: Record<string, string>;
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  preferredActiveFileId?: string;
}): { manifest: WebNetProjectManifestV4; sourceTexts: Record<string, string> } => {
  const mainFile = createManifestEntry({
    name: 'main.dat',
    kind: 'main',
    order: 0,
    text: input,
    modifiedAt: updatedAt,
  });
  const includeEntries = Object.entries(includeFiles)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([fileName, text], index) =>
      createManifestEntry({
        name: fileName,
        kind: 'include',
        order: index + 1,
        text,
        modifiedAt: updatedAt,
      }),
    );
  const allFiles = [mainFile, ...includeEntries];
  const sourceTexts = {
    [mainFile.id]: input,
    ...Object.fromEntries(includeEntries.map((entry) => [entry.id, includeFiles[entry.name] ?? ''])),
  };
  const activeFileId =
    allFiles.find((file) => file.id === preferredActiveFileId)?.id ??
    mainFile.id;
  return {
    manifest: createProjectManifest({
      projectId,
      name,
      createdAt,
      updatedAt,
      files: allFiles,
      mainFileId: mainFile.id,
      ui,
      project,
      workspace: { activeFileId },
    }),
    sourceTexts,
  };
};

export const createManifestFromPortableProject = ({
  portable,
}: {
  portable: WebNetPortableProjectFileV4;
}): { manifest: WebNetProjectManifestV4; sourceTexts: Record<string, string> } => ({
  manifest: createProjectManifest({
    projectId: portable.projectId,
    name: portable.name,
    createdAt: portable.createdAt,
    updatedAt: portable.updatedAt,
    files: portable.files,
    mainFileId: portable.mainFileId,
    ui: portable.ui,
    project: portable.project,
    workspace: portable.workspace,
  }),
  sourceTexts: { ...portable.fileContents },
});
