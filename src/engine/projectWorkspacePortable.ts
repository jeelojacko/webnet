import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import {
  cloneFiles,
  cloneProjectPayload,
  cloneUiPayload,
} from './projectWorkspaceClones';
import type {
  ProjectManifestFileEntry,
  ProjectManifestWorkspaceState,
  WebNetPortableProjectFileV5,
  WebNetProjectManifestV5,
} from './projectWorkspaceTypes';

export const createPortableProjectFileWithDependencies = ({
  manifest,
  normalizeWorkspaceState,
  savedRuns,
  sortProjectFiles,
  sourceTexts,
}: {
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
  sortProjectFiles: (_files: ProjectManifestFileEntry[]) => ProjectManifestFileEntry[];
  normalizeWorkspaceState: (
    _files: ProjectManifestFileEntry[],
    _workspace?: Partial<ProjectManifestWorkspaceState> | null,
  ) => ProjectManifestWorkspaceState;
}): WebNetPortableProjectFileV5 => ({
  kind: 'webnet-project',
  schemaVersion: 5,
  storageLayout: 'portable',
  projectId: manifest.projectId,
  name: manifest.name,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
  files: cloneFiles(manifest.files, { sortProjectFiles }),
  fileContents: Object.fromEntries(manifest.files.map((file) => [file.id, sourceTexts[file.id] ?? ''])),
  savedRuns: savedRuns?.map((snapshot) => JSON.parse(JSON.stringify(snapshot))),
  ui: cloneUiPayload(manifest.ui),
  project: cloneProjectPayload(manifest.project),
  workspace: normalizeWorkspaceState(manifest.files, manifest.workspace),
});
