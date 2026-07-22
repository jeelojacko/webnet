import React from 'react';
import { FileText, Files } from 'lucide-react';
import {
  INPUT_EDITOR_LINE_HEIGHT_PX,
  INPUT_EDITOR_WINDOW_BUFFER_LINES,
  renderHighlightedLine,
} from './InputPane.highlighting';
import { InputPaneEditorSurface } from './InputPaneEditorSurface';
import { InputPaneFileTabs, InputPaneProjectFilesPanel } from './InputPaneProjectFilesPanel';
import { useInputPaneEditorActions } from './useInputPaneEditorActions';
import type { ProjectRunValidation, ProjectWorkspaceFileView } from '../hooks/useProjectFileWorkflow';

interface InputPaneProps {
  input: string;
  onChange: (_value: string) => void;
  projectName?: string | null;
  activeFileName?: string | null;
  projectFiles?: ProjectWorkspaceFileView[];
  projectRunValidation?: ProjectRunValidation | null;
  onOpenProjectFiles?: () => void;
  onAddProjectSourceFile?: () => void;
  onOpenFileTab?: (_fileId: string) => void;
  onCloseFileTab?: (_fileId: string) => void;
  onFocusProjectFile?: (_fileId: string) => void;
  onCreateBlankProjectFile?: () => void;
  onDuplicateProjectFile?: (_fileId: string) => void;
  onRenameProjectFile?: (_fileId: string, _name: string) => void;
  onDeleteProjectFile?: (_fileId: string) => void;
  onSetProjectFileEnabled?: (_fileId: string, _enabled: boolean) => void;
  onReorderProjectFiles?: (_fileIdsInOrder: string[]) => void;
  importNotice?: {
    title: string;
    detailLines: string[];
  } | null;
  onClearImportNotice?: () => void;
}

export type InputPaneHandle = {
  jumpToLine: (_lineNumber: number) => void;
};

type FileMenuState = {
  fileId: string;
  x: number;
  y: number;
};

const InputPane = React.forwardRef<InputPaneHandle, InputPaneProps>(
  (
    {
      input,
      onChange,
      projectName = null,
      activeFileName = null,
      projectFiles = [],
      projectRunValidation = null,
      onOpenProjectFiles,
      onAddProjectSourceFile,
      onOpenFileTab,
      onCloseFileTab,
      onFocusProjectFile,
      onCreateBlankProjectFile,
      onDuplicateProjectFile,
      onRenameProjectFile,
      onDeleteProjectFile,
      onSetProjectFileEnabled,
      onReorderProjectFiles,
      importNotice = null,
      onClearImportNotice,
    },
    ref,
  ) => {
  const editorLines = React.useMemo(() => input.split('\n'), [input]);
  const lineCount = editorLines.length;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const numbersRef = React.useRef<HTMLDivElement>(null);
  const highlightRef = React.useRef<HTMLPreElement>(null);
  const editorWrapRef = React.useRef<HTMLDivElement>(null);
  const projectFilesButtonRef = React.useRef<HTMLButtonElement>(null);
  const [isProjectFilesOpen, setIsProjectFilesOpen] = React.useState(false);
  const [fileMenu, setFileMenu] = React.useState<FileMenuState | null>(null);
  const [renamingFileId, setRenamingFileId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [draggedFileId, setDraggedFileId] = React.useState<string | null>(null);
  const [jumpHighlightLine, setJumpHighlightLine] = React.useState<number | null>(null);
  const [editorViewportHeight, setEditorViewportHeight] = React.useState(0);
  const [editorScrollTop, setEditorScrollTop] = React.useState(0);
  const jumpHighlightTimeoutRef = React.useRef<number | null>(null);
  const openProjectFiles = React.useCallback(() => {
    setIsProjectFilesOpen((current) => !current);
  }, []);
  const sortedProjectFiles = React.useMemo(
    () => [...projectFiles].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [projectFiles],
  );
  const openTabs = React.useMemo(
    () =>
      projectFiles
        .filter((file) => file.isOpenInTab)
        .sort(
          (a, b) =>
            (a.tabOrder ?? Number.MAX_SAFE_INTEGER) - (b.tabOrder ?? Number.MAX_SAFE_INTEGER) ||
            a.name.localeCompare(b.name),
        ),
    [projectFiles],
  );
  const checkedProjectFileCount = React.useMemo(
    () => projectFiles.filter((file) => file.enabled).length,
    [projectFiles],
  );
  const beginRename = React.useCallback(
    (fileId: string) => {
      const target = sortedProjectFiles.find((file) => file.id === fileId);
      if (!target) return;
      setRenamingFileId(fileId);
      setRenameDraft(target.name);
      setFileMenu(null);
    },
    [sortedProjectFiles],
  );
  const commitRename = React.useCallback(() => {
    if (!renamingFileId) return;
    const nextName = renameDraft.trim();
    if (nextName) {
      onRenameProjectFile?.(renamingFileId, nextName);
    }
    setRenamingFileId(null);
    setRenameDraft('');
  }, [onRenameProjectFile, renameDraft, renamingFileId]);
  const cancelRename = React.useCallback(() => {
    setRenamingFileId(null);
    setRenameDraft('');
  }, []);
  const visibleLineWindow = React.useMemo(() => {
    const visibleStart = Math.max(
      0,
      Math.floor(editorScrollTop / INPUT_EDITOR_LINE_HEIGHT_PX) - INPUT_EDITOR_WINDOW_BUFFER_LINES,
    );
    const visibleEnd = Math.min(
      lineCount,
      Math.ceil((editorScrollTop + Math.max(editorViewportHeight, INPUT_EDITOR_LINE_HEIGHT_PX)) / INPUT_EDITOR_LINE_HEIGHT_PX) +
        INPUT_EDITOR_WINDOW_BUFFER_LINES,
    );
    return { visibleStart, visibleEnd };
  }, [editorScrollTop, editorViewportHeight, lineCount]);
  const visibleLineNumbers = React.useMemo(
    () =>
      Array.from(
        { length: visibleLineWindow.visibleEnd - visibleLineWindow.visibleStart },
        (_, index) => visibleLineWindow.visibleStart + index + 1,
      ),
    [visibleLineWindow],
  );
  const visibleHighlightedInput = React.useMemo(() => {
    return editorLines
      .slice(visibleLineWindow.visibleStart, visibleLineWindow.visibleEnd)
      .map((line, lineOffset) => (
        <React.Fragment key={`input-line-${visibleLineWindow.visibleStart + lineOffset}`}>
          {renderHighlightedLine(line, visibleLineWindow.visibleStart + lineOffset)}
          {visibleLineWindow.visibleStart + lineOffset < editorLines.length - 1 ? '\n' : null}
        </React.Fragment>
      ));
  }, [editorLines, visibleLineWindow]);

  const {
    closeContextMenu,
    contextMenu,
    handleContextMenu,
    handleContextMenuAction,
    handleKeyDown,
  } = useInputPaneEditorActions(textareaRef, editorWrapRef);
  const handleScroll = React.useCallback(() => {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (textareaRef.current) {
      setEditorScrollTop(textareaRef.current.scrollTop);
      setEditorViewportHeight(textareaRef.current.clientHeight);
    }
    closeContextMenu();
  }, [closeContextMenu]);

  const jumpToLine = React.useCallback(
    (lineNumber: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const linesForSelection = editorLines;
      const clampedLine = Math.min(Math.max(Math.trunc(lineNumber), 1), linesForSelection.length);
      let start = 0;
      for (let i = 0; i < clampedLine - 1; i += 1) {
        start += linesForSelection[i].length + 1;
      }
      const end = start + linesForSelection[clampedLine - 1].length;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const targetScrollTop = Math.max(
        0,
        (clampedLine - 1) * INPUT_EDITOR_LINE_HEIGHT_PX - textarea.clientHeight / 2,
      );
      textarea.scrollTop = targetScrollTop;
      handleScroll();
      setJumpHighlightLine(clampedLine);
      if (jumpHighlightTimeoutRef.current != null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      jumpHighlightTimeoutRef.current = window.setTimeout(() => {
        setJumpHighlightLine((current) => (current === clampedLine ? null : current));
        jumpHighlightTimeoutRef.current = null;
      }, 1600);
    },
    [editorLines, handleScroll],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      jumpToLine,
    }),
    [jumpToLine],
  );

  React.useEffect(
    () => () => {
      if (jumpHighlightTimeoutRef.current != null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    const syncViewport = () => {
      if (!textareaRef.current) return;
      setEditorViewportHeight(textareaRef.current.clientHeight);
      setEditorScrollTop(textareaRef.current.scrollTop);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);


  React.useEffect(() => {
    if (!isProjectFilesOpen && !fileMenu) return;
    const close = () => {
      setFileMenu(null);
      setIsProjectFilesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        cancelRename();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelRename, fileMenu, isProjectFilesOpen]);

  return (
    <div className="border-r border-slate-700 flex flex-col min-w-[220px] md:min-w-[260px] flex-none h-full">
      <div className="relative bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div>INPUT DATA (.dat / imported reports)</div>
            {(projectName || activeFileName) && (
              <div className="truncate text-[10px] font-normal uppercase tracking-wide text-slate-500">
                {[projectName, activeFileName].filter(Boolean).join(' / ')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              ref={projectFilesButtonRef}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (projectFiles.length === 0) {
                  onOpenProjectFiles?.();
                  return;
                }
                openProjectFiles();
              }}
              className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500 hover:text-white"
            >
              <Files size={12} />
              Project Files
            </button>
            <FileText size={14} />
          </div>
        </div>
        {projectRunValidation && !projectRunValidation.ok && (
          <div className="mt-2 text-[10px] font-normal uppercase tracking-wide text-amber-300">
            {projectRunValidation.errors[0]}
          </div>
        )}
        <InputPaneProjectFilesPanel
          beginRename={beginRename}
          cancelRename={cancelRename}
          checkedProjectFileCount={checkedProjectFileCount}
          commitRename={commitRename}
          draggedFileId={draggedFileId}
          editorWrapRef={editorWrapRef}
          isProjectFilesOpen={isProjectFilesOpen}
          onAddProjectSourceFile={onAddProjectSourceFile}
          onCreateBlankProjectFile={onCreateBlankProjectFile}
          onDeleteProjectFile={onDeleteProjectFile}
          onDuplicateProjectFile={onDuplicateProjectFile}
          onFocusProjectFile={onFocusProjectFile}
          onOpenFileTab={onOpenFileTab}
          onOpenProjectFiles={onOpenProjectFiles}
          onReorderProjectFiles={onReorderProjectFiles}
          onSetProjectFileEnabled={onSetProjectFileEnabled}
          openTabs={openTabs}
          projectFiles={projectFiles}
          renameDraft={renameDraft}
          renamingFileId={renamingFileId}
          setDraggedFileId={setDraggedFileId}
          setFileMenu={setFileMenu}
          setIsProjectFilesOpen={setIsProjectFilesOpen}
          setRenameDraft={setRenameDraft}
          sortedProjectFiles={sortedProjectFiles}
        />
      </div>
      <InputPaneFileTabs
        onCloseFileTab={onCloseFileTab}
        onFocusProjectFile={onFocusProjectFile}
        openTabs={openTabs}
      />
      <InputPaneEditorSurface
        beginRename={beginRename}
        contextMenu={contextMenu}
        editorWrapRef={editorWrapRef}
        fileMenu={fileMenu}
        handleContextMenu={handleContextMenu}
        handleContextMenuAction={handleContextMenuAction}
        handleKeyDown={handleKeyDown}
        handleScroll={handleScroll}
        highlightRef={highlightRef}
        importNotice={importNotice}
        input={input}
        jumpHighlightLine={jumpHighlightLine}
        lineCount={lineCount}
        numbersRef={numbersRef}
        onChange={onChange}
        onClearImportNotice={onClearImportNotice}
        onCloseFileTab={onCloseFileTab}
        onDeleteProjectFile={onDeleteProjectFile}
        onDuplicateProjectFile={onDuplicateProjectFile}
        onOpenFileTab={onOpenFileTab}
        setFileMenu={setFileMenu}
        textareaRef={textareaRef}
        visibleHighlightedInput={visibleHighlightedInput}
        visibleLineNumbers={visibleLineNumbers}
        visibleLineWindow={visibleLineWindow}
      />
    </div>
  );
  },
);

export default InputPane;





