import React from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
import { buildProjectFileStatusChips, reorderFileIds } from './InputPane.projectFiles';
import type { ProjectWorkspaceFileView } from '../hooks/useProjectFileWorkflow';

type FileMenuState = {
  fileId: string;
  x: number;
  y: number;
};

type InputPaneProjectFilesPanelProps = {
  beginRename: (_fileId: string) => void;
  cancelRename: () => void;
  checkedProjectFileCount: number;
  commitRename: () => void;
  draggedFileId: string | null;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
  isProjectFilesOpen: boolean;
  onAddProjectSourceFile?: () => void;
  onCreateBlankProjectFile?: () => void;
  onDeleteProjectFile?: (_fileId: string) => void;
  onDuplicateProjectFile?: (_fileId: string) => void;
  onFocusProjectFile?: (_fileId: string) => void;
  onOpenFileTab?: (_fileId: string) => void;
  onOpenProjectFiles?: () => void;
  onReorderProjectFiles?: (_fileIdsInOrder: string[]) => void;
  onSetProjectFileEnabled?: (_fileId: string, _enabled: boolean) => void;
  openTabs: ProjectWorkspaceFileView[];
  projectFiles: ProjectWorkspaceFileView[];
  renameDraft: string;
  renamingFileId: string | null;
  setDraggedFileId: React.Dispatch<React.SetStateAction<string | null>>;
  setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState | null>>;
  setIsProjectFilesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>;
  sortedProjectFiles: ProjectWorkspaceFileView[];
};

export const InputPaneProjectFilesPanel = ({
  beginRename,
  cancelRename,
  checkedProjectFileCount,
  commitRename,
  draggedFileId,
  editorWrapRef,
  isProjectFilesOpen,
  onAddProjectSourceFile,
  onCreateBlankProjectFile,
  onDeleteProjectFile,
  onDuplicateProjectFile,
  onFocusProjectFile,
  onOpenFileTab,
  onOpenProjectFiles,
  onReorderProjectFiles,
  onSetProjectFileEnabled,
  openTabs,
  projectFiles,
  renameDraft,
  renamingFileId,
  setDraggedFileId,
  setFileMenu,
  setIsProjectFilesOpen,
  setRenameDraft,
  sortedProjectFiles,
}: InputPaneProjectFilesPanelProps) => (
  <>
        {isProjectFilesOpen && projectFiles.length > 0 && (
          <div
            className="absolute left-2 right-2 top-full z-30 mt-2 rounded border border-slate-600 bg-slate-900 shadow-xl md:left-auto md:right-4 md:w-96"
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Checked files run together in list order
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  {checkedProjectFileCount} checked / {openTabs.length} open
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAddProjectSourceFile?.()}
                  className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500 hover:text-white"
                >
                  <Plus size={12} />
                  Add Source
                </button>
                <button
                  type="button"
                  onClick={() => onCreateBlankProjectFile?.()}
                  className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500 hover:text-white"
                >
                  <Plus size={12} />
                  New File
                </button>
              </div>
            </div>
              <div className="max-h-80 overflow-y-auto p-2">
              {sortedProjectFiles.map((file) => (
                <div
                  key={file.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggedFileId || draggedFileId === file.id) return;
                    onReorderProjectFiles?.(
                      reorderFileIds(
                        sortedProjectFiles.map((entry) => entry.id),
                        draggedFileId,
                        file.id,
                      ),
                    );
                    setDraggedFileId(null);
                  }}
                  onDoubleClick={() => onOpenFileTab?.(file.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const bounds = editorWrapRef.current?.getBoundingClientRect();
                    setFileMenu({
                      fileId: file.id,
                      x: bounds ? event.clientX - bounds.left : event.clientX,
                      y: bounds ? event.clientY - bounds.top : event.clientY,
                    });
                    setIsProjectFilesOpen(true);
                  }}
                  className={`mb-1 flex items-center gap-2 rounded border px-2 py-2 text-xs ${
                    file.isActive
                      ? 'border-blue-500/70 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.14)]'
                      : 'border-slate-700 bg-slate-950/70 hover:border-slate-600'
                  }`}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDraggedFileId(file.id)}
                    onDragEnd={() => setDraggedFileId(null)}
                    onClick={(event) => event.preventDefault()}
                    className="cursor-grab rounded p-1 text-slate-500 hover:text-slate-300"
                    aria-label={`Reorder ${file.name}`}
                    title={`Reorder ${file.name}`}
                  >
                    <GripVertical size={12} />
                  </button>
                  <input
                    type="checkbox"
                    checked={file.isCheckedForRun}
                    onChange={(event) => onSetProjectFileEnabled?.(file.id, event.target.checked)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Include ${file.name} in run`}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                  />
                  <div className="min-w-0 flex-1">
                    {renamingFileId === file.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename();
                          if (event.key === 'Escape') cancelRename();
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onFocusProjectFile?.(file.id)}
                        className="w-full text-left"
                      >
                        <div
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            beginRename(file.id);
                          }}
                          className="truncate text-slate-200"
                        >
                          {file.name}
                        </div>
                      </button>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                      {buildProjectFileStatusChips(file).map((chip) => (
                        <span
                          key={`${file.id}-${chip}`}
                          className={`rounded border px-1.5 py-0.5 ${
                            chip === 'active'
                              ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                              : chip === 'main'
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                                : chip === 'unchecked'
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                                  : 'border-slate-700 bg-slate-900/70 text-slate-500'
                          }`}
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                      {!file.isOpenInTab && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenFileTab?.(file.id);
                          }}
                          className="rounded border border-slate-700 bg-slate-900/70 px-1.5 py-0.5 text-slate-300 hover:border-slate-500 hover:text-white"
                          aria-label={`Open ${file.name}`}
                        >
                          Open
                        </button>
                      )}
                      {!file.isActive && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onFocusProjectFile?.(file.id);
                          }}
                          className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-blue-200 hover:border-blue-400/60 hover:text-white"
                          aria-label={`Edit ${file.name}`}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDuplicateProjectFile?.(file.id);
                        }}
                        className="rounded border border-slate-700 bg-slate-900/70 px-1.5 py-0.5 text-slate-300 hover:border-slate-500 hover:text-white"
                        aria-label={`Duplicate ${file.name}`}
                      >
                        Duplicate
                      </button>
                      {!file.isMain && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteProjectFile?.(file.id);
                          }}
                          className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-rose-200 hover:border-rose-400/60 hover:text-white"
                          aria-label={`Remove ${file.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-slate-700 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Right-click still shows full file menu
              </div>
              <button
                type="button"
                onClick={() => onOpenProjectFiles?.()}
                className="rounded border border-slate-600 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500 hover:text-white"
              >
                Project Options
              </button>
            </div>
          </div>
        )}
  </>
);

export const InputPaneFileTabs = ({
  onCloseFileTab,
  onFocusProjectFile,
  openTabs,
}: {
  onCloseFileTab?: (_fileId: string) => void;
  onFocusProjectFile?: (_fileId: string) => void;
  openTabs: ProjectWorkspaceFileView[];
}) => {
  if (openTabs.length === 0) return null;
  return (
    <div className="border-b border-slate-700 bg-slate-900/80 px-2 py-1">
      <div className="flex gap-1 overflow-x-auto">
        {openTabs.map((file) => (
          <div
            key={file.id}
            className={`flex items-center gap-1 rounded-t border px-2 py-1 text-[11px] ${
              file.isFocusedTab
                ? 'border-slate-500 bg-slate-800 text-slate-100'
                : 'border-slate-700 bg-slate-950 text-slate-400'
            }`}
          >
            <button type="button" onClick={() => onFocusProjectFile?.(file.id)} className="truncate">
              {file.name}
            </button>
            <button
              type="button"
              onClick={() => onCloseFileTab?.(file.id)}
              className="text-slate-500 hover:text-white"
              aria-label={`Close ${file.name}`}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
