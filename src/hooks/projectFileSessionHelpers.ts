import {
  normalizeWorkspaceState,
  type ProjectManifestWorkspaceState,
  type ProjectSessionState,
} from '../engine/projectWorkspace';

export const normalizeSessionWorkspace = (
  current: ProjectSessionState,
): ProjectManifestWorkspaceState => normalizeWorkspaceState(current.manifest.files, current.manifest.workspace);

export const resolveNextFocusedFileId = (
  openFileIds: string[],
  removedFileId: string,
  preferredFileIds: string[],
): string | undefined => {
  const remaining = openFileIds.filter((fileId) => fileId !== removedFileId);
  return preferredFileIds.find((fileId) => remaining.includes(fileId)) ?? remaining[0];
};

export const applyPersistedProjectSession = ({
  current,
  saved,
  requestedManifestUpdatedAt,
  completedAt,
}: {
  current: ProjectSessionState | null;
  saved: ProjectSessionState;
  requestedManifestUpdatedAt: string;
  completedAt: string;
}): ProjectSessionState | null => {
  if (!current || current.indexRow.id !== saved.indexRow.id) return current;
  const staleSaveCompleted =
    current.manifest.updatedAt !== requestedManifestUpdatedAt ||
    current.manifestDirty ||
    current.dirtyFileIds.length > 0;
  if (staleSaveCompleted) {
    return {
      ...current,
      indexRow: saved.indexRow,
      autosaveState: 'idle',
      lastAutosavedAt: completedAt,
      lastAutosaveError: null,
    };
  }
  return {
    ...saved,
    dirtyFileIds: [],
    manifestDirty: false,
    autosaveState: 'idle',
    lastAutosavedAt: completedAt,
    lastAutosaveError: null,
  };
};
