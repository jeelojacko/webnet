import { useCallback } from 'react';
import type { ProjectSessionState } from '../engine/projectWorkspace';
import { touchProjectIndexRow } from '../engine/projectStorage';
import {
  normalizeSessionWorkspace,
  resolveNextFocusedFileId,
} from './projectFileSessionHelpers';
import { appendUniqueId, removeFileId } from './projectWorkflowUtils';

interface UseProjectFileTabActionsArgs {
  projectSession: ProjectSessionState | null;
  updateProjectSession: (
    _updater: (_current: ProjectSessionState) => ProjectSessionState,
    _options?: { syncEditor?: boolean },
  ) => void;
}

export const useProjectFileTabActions = ({
  projectSession,
  updateProjectSession,
}: UseProjectFileTabActionsArgs) => {
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

  return {
    closeFileTab,
    focusFileTab,
    moveProjectFile,
    openFileTab,
    reorderProjectFiles,
  };
};
