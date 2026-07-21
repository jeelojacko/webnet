import { useCallback, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { readBrowserFileAsText } from '../engine/browserFileIo';
import {
  buildProjectEditorIncludeFiles,
  cloneProjectSessionState,
  createManifestEntry,
  normalizeWorkspaceState,
  type ProjectSessionState,
} from '../engine/projectWorkspace';
import { touchProjectIndexRow } from '../engine/projectStorage';
import { buildImportedReviewFileName, getImportedProjectSourceName } from './projectFileAssociatedSettings';
import { normalizeSessionWorkspace } from './projectFileSessionHelpers';
import { appendUniqueId, buildFileNameCopy } from './projectWorkflowUtils';

type ImportNotice = {
  title: string;
  detailLines: string[];
};

interface UseProjectSourceFileImportsArgs {
  createLocalProjectFromCurrentWorkspace: () => Promise<ProjectSessionState | null>;
  projectSession: ProjectSessionState | null;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectSession: Dispatch<SetStateAction<ProjectSessionState | null>>;
  updateProjectSession: (
    _updater: (_current: ProjectSessionState) => ProjectSessionState,
    _options?: { syncEditor?: boolean },
  ) => void;
}

export const useProjectSourceFileImports = ({
  createLocalProjectFromCurrentWorkspace,
  projectSession,
  setImportNotice,
  setInput,
  setProjectIncludeFiles,
  setProjectSession,
  updateProjectSession,
}: UseProjectSourceFileImportsArgs) => {
  const importProjectSourceFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!projectSession || files.length === 0) return false;
      try {
        const loadedFiles = await Promise.all(
          files.map(async (file) => ({
            file,
            text: await readBrowserFileAsText(file),
          })),
        );
        updateProjectSession((current) => {
          const nowIso = new Date().toISOString();
          const workspace = normalizeSessionWorkspace(current);
          const existingNames = new Set(current.manifest.files.map((entry) => entry.name));
          const appendedEntries = loadedFiles.map(({ file, text }, index) => {
            const requestedName = getImportedProjectSourceName(file.name);
            const nextName = existingNames.has(requestedName)
              ? buildFileNameCopy(requestedName, existingNames)
              : requestedName;
            existingNames.add(nextName);
            return createManifestEntry({
              name: nextName,
              kind: 'dat',
              order: current.manifest.files.length + index,
              text,
              createdAt: nowIso,
              updatedAt: nowIso,
              modifiedAt: nowIso,
            });
          });
          current.manifest.files = [...current.manifest.files, ...appendedEntries];
          current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
            ...workspace,
            openFileIds: appendedEntries.reduce(
              (ids, entry) => appendUniqueId(ids, entry.id),
              workspace.openFileIds,
            ),
            focusedFileId: appendedEntries[appendedEntries.length - 1]?.id ?? workspace.focusedFileId,
          });
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.sourceTexts = appendedEntries.reduce<Record<string, string>>(
            (sourceTexts, entry, index) => {
              sourceTexts[entry.id] = loadedFiles[index]?.text ?? '';
              return sourceTexts;
            },
            { ...current.sourceTexts },
          );
          current.dirtyFileIds = appendedEntries.reduce(
            (ids, entry) => appendUniqueId(ids, entry.id),
            current.dirtyFileIds,
          );
          current.manifestDirty = true;
          current.autosaveState = 'idle';
          current.lastAutosaveError = null;
          return current;
        });
        setImportNotice({
          title: 'Project source file added',
          detailLines:
            loadedFiles.length === 1
              ? [`Added ${getImportedProjectSourceName(loadedFiles[0]?.file.name ?? 'file')}.`]
              : [`Added ${loadedFiles.length} source files to the current project.`],
        });
        return true;
      } catch (error) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
        return false;
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const importGeneratedProjectSourceFile = useCallback(
    async ({ sourceName, text }: { sourceName: string; text: string }): Promise<boolean> => {
      if (!text.trim()) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: ['Imported review output was empty after reconciliation.'],
        });
        return false;
      }
      let ensuredSession = projectSession;
      if (!ensuredSession) {
        ensuredSession = await createLocalProjectFromCurrentWorkspace();
        if (!ensuredSession) return false;
      }
      const requestedName = buildImportedReviewFileName(sourceName);
      let finalName = requestedName;
      let nextInputText = text;
      let nextIncludeFiles: Record<string, string> = {};
      setProjectSession((current) => {
        const base = cloneProjectSessionState(current ?? ensuredSession!);
        const nowIso = new Date().toISOString();
        const workspace = normalizeSessionWorkspace(base);
        const existingNames = new Set(base.manifest.files.map((entry) => entry.name));
        finalName = existingNames.has(requestedName)
          ? buildFileNameCopy(requestedName, existingNames)
          : requestedName;
        const entry = createManifestEntry({
          name: finalName,
          kind: 'dat',
          order: base.manifest.files.length,
          enabled: true,
          text,
          createdAt: nowIso,
          updatedAt: nowIso,
          modifiedAt: nowIso,
        });
        base.manifest.files = [...base.manifest.files, entry];
        base.manifest.workspace = normalizeWorkspaceState(base.manifest.files, {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
          focusedFileId: entry.id,
        });
        base.manifest.updatedAt = nowIso;
        base.indexRow = touchProjectIndexRow(base.indexRow, nowIso);
        base.sourceTexts = {
          ...base.sourceTexts,
          [entry.id]: text,
        };
        base.dirtyFileIds = appendUniqueId(base.dirtyFileIds, entry.id);
        base.manifestDirty = true;
        base.autosaveState = 'idle';
        base.lastAutosaveError = null;
        nextInputText = base.sourceTexts[entry.id] ?? text;
        nextIncludeFiles = buildProjectEditorIncludeFiles(base.manifest, base.sourceTexts, entry.id);
        return base;
      });
      setInput(nextInputText);
      setProjectIncludeFiles(nextIncludeFiles);
      setImportNotice({
        title: 'Project source file added',
        detailLines: [`Added ${finalName}.`],
      });
      return true;
    },
    [
      createLocalProjectFromCurrentWorkspace,
      projectSession,
      setImportNotice,
      setInput,
      setProjectIncludeFiles,
      setProjectSession,
    ],
  );

  const handleProjectSourceFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      e.target.value = '';
      await importProjectSourceFiles(files);
    },
    [importProjectSourceFiles],
  );

  return {
    handleProjectSourceFileChange,
    importGeneratedProjectSourceFile,
    importProjectSourceFiles,
  };
};
