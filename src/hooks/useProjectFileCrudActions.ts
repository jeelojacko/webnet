import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  createManifestEntry,
  normalizeWorkspaceState,
  type ProjectSessionState,
  type ProjectSourceFileKind,
} from '../engine/projectWorkspace';
import { touchProjectIndexRow } from '../engine/projectStorage';
import {
  normalizeSessionWorkspace,
  resolveNextFocusedFileId,
} from './projectFileSessionHelpers';
import { appendUniqueId, buildFileNameCopy, removeFileId } from './projectWorkflowUtils';

type ImportNotice = {
  title: string;
  detailLines: string[];
};

interface UseProjectFileCrudActionsArgs {
  projectSession: ProjectSessionState | null;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  updateProjectSession: (
    _updater: (_current: ProjectSessionState) => ProjectSessionState,
    _options?: { syncEditor?: boolean },
  ) => void;
}

export const useProjectFileCrudActions = ({
  projectSession,
  setImportNotice,
  updateProjectSession,
}: UseProjectFileCrudActionsArgs) => {
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
          current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
            ...workspace,
            openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
            focusedFileId: entry.id,
          });
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

  return {
    createBlankProjectFile,
    deleteProjectFile,
    duplicateProjectFile,
    removeProjectFile: deleteProjectFile,
    renameProjectFile,
    setProjectFileEnabled,
  };
};
