import React from 'react';
import { FileText, Files, Plus, X } from 'lucide-react';
import { blockCommentSelection, blockUncommentSelection } from './commentToggle';
import { INPUT_PANE_CONTEXT_MENU_ORDER } from './inputPaneContextMenu';
import type { ProjectRunValidation, ProjectWorkspaceFileView } from '../hooks/useProjectFileWorkflow';

interface InputPaneProps {
  input: string;
  onChange: (_value: string) => void;
  projectName?: string | null;
  activeFileName?: string | null;
  projectFiles?: ProjectWorkspaceFileView[];
  projectRunValidation?: ProjectRunValidation | null;
  onOpenProjectFiles?: () => void;
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

type ContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  canBlockComment: boolean;
  canBlockUncomment: boolean;
};

type FileMenuState = {
  fileId: string;
  x: number;
  y: number;
};

const INPUT_EDITOR_BASE_TOKEN_CLASS = 'text-slate-300';
const INPUT_EDITOR_COMMENT_CLASS = 'text-slate-500';
const INPUT_EDITOR_DIRECTIVE_CLASS = 'text-blue-300';
const INPUT_EDITOR_FIXED_CLASS = 'text-red-400';
const INPUT_EDITOR_LINE_HEIGHT_PX = 19.5;

const INPUT_EDITOR_OBS_TOKEN_CLASS: Record<string, string> = {
  C: 'text-amber-100',
  P: 'text-amber-100',
  PH: 'text-amber-100',
  CH: 'text-amber-100',
  EH: 'text-amber-100',
  E: 'text-amber-100',
  D: 'text-cyan-300',
  DV: 'text-cyan-200',
  A: 'text-blue-300',
  B: 'text-rose-300',
  V: 'text-green-400',
  G: 'text-amber-300',
  L: 'text-emerald-400',
  M: 'text-amber-200',
  BM: 'text-emerald-400',
  SS: 'text-rose-200',
  DB: 'text-cyan-300',
  DN: 'text-cyan-300',
  DM: 'text-cyan-300',
  DE: 'text-cyan-300',
  TB: 'text-blue-400',
  T: 'text-blue-400',
  TE: 'text-blue-400',
  ET: 'text-blue-400',
};

const isWhitespaceToken = (token: string): boolean => /^\s+$/.test(token);

const tokenizeWithWhitespace = (value: string): string[] => value.match(/(\s+|[^\s]+)/g) ?? [];

const reorderFileIds = (
  fileIds: string[],
  draggedFileId: string,
  targetFileId: string,
): string[] => {
  if (draggedFileId === targetFileId) return fileIds;
  const next = [...fileIds];
  const draggedIndex = next.indexOf(draggedFileId);
  const targetIndex = next.indexOf(targetFileId);
  if (draggedIndex < 0 || targetIndex < 0) return fileIds;
  const [moved] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
};

const findUnquotedHashIndex = (line: string): number => {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return i;
  }
  return -1;
};

const renderHighlightedLine = (line: string, lineIndex: number): React.ReactNode => {
  if (line.length === 0) return null;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith("'")) {
    return (
      <span key={`input-comment-${lineIndex}`} className={INPUT_EDITOR_COMMENT_CLASS}>
        {line}
      </span>
    );
  }

  const hashIndex = findUnquotedHashIndex(line);
  const codePart = hashIndex >= 0 ? line.slice(0, hashIndex) : line;
  const commentPart = hashIndex >= 0 ? line.slice(hashIndex) : '';
  const tokens = tokenizeWithWhitespace(codePart);
  const firstNonWhitespaceIndex = tokens.findIndex((token) => !isWhitespaceToken(token));
  const firstTokenUpper =
    firstNonWhitespaceIndex >= 0 ? tokens[firstNonWhitespaceIndex].toUpperCase() : '';
  const directiveLine = firstTokenUpper.startsWith('.') || firstTokenUpper.startsWith('/');
  const rendered: React.ReactNode[] = [];

  tokens.forEach((token, tokenIndex) => {
    if (isWhitespaceToken(token)) {
      rendered.push(
        <React.Fragment key={`input-ws-${lineIndex}-${tokenIndex}`}>{token}</React.Fragment>,
      );
      return;
    }
    let className = directiveLine ? INPUT_EDITOR_DIRECTIVE_CLASS : INPUT_EDITOR_BASE_TOKEN_CLASS;
    if (!directiveLine && tokenIndex === firstNonWhitespaceIndex) {
      className = INPUT_EDITOR_OBS_TOKEN_CLASS[firstTokenUpper] ?? INPUT_EDITOR_BASE_TOKEN_CLASS;
    }
    if (/^[!&]+$/.test(token)) {
      className = INPUT_EDITOR_FIXED_CLASS;
    }
    rendered.push(
      <span key={`input-token-${lineIndex}-${tokenIndex}`} className={className}>
        {token}
      </span>,
    );
  });

  if (commentPart) {
    rendered.push(
      <span key={`input-inline-comment-${lineIndex}`} className={INPUT_EDITOR_COMMENT_CLASS}>
        {commentPart}
      </span>,
    );
  }

  return <>{rendered}</>;
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
  const lineCount = input.split('\n').length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const numbersRef = React.useRef<HTMLDivElement>(null);
  const highlightRef = React.useRef<HTMLPreElement>(null);
  const editorWrapRef = React.useRef<HTMLDivElement>(null);
  const projectFilesButtonRef = React.useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [isProjectFilesOpen, setIsProjectFilesOpen] = React.useState(false);
  const [fileMenu, setFileMenu] = React.useState<FileMenuState | null>(null);
  const [renamingFileId, setRenamingFileId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [draggedFileId, setDraggedFileId] = React.useState<string | null>(null);
  const [jumpHighlightLine, setJumpHighlightLine] = React.useState<number | null>(null);
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
  const highlightedInput = React.useMemo(() => {
    const editorLines = input.split('\n');
    return editorLines.map((line, lineIndex) => (
      <React.Fragment key={`input-line-${lineIndex}`}>
        {renderHighlightedLine(line, lineIndex)}
        {lineIndex < editorLines.length - 1 ? '\n' : null}
      </React.Fragment>
    ));
  }, [input]);

  const handleScroll = React.useCallback(() => {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    setContextMenu(null);
  }, []);

  const jumpToLine = React.useCallback(
    (lineNumber: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const linesForSelection = input.split('\n');
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
    [handleScroll, input],
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

  const dispatchTextareaInput = React.useCallback((textarea: HTMLTextAreaElement) => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const replaceTextareaRangeWithNativeEdit = React.useCallback(
    (
      textarea: HTMLTextAreaElement,
      replacement: string,
      start: number,
      end: number,
      selectionMode: 'select' | 'start' | 'end' | 'preserve' = 'end',
    ): boolean => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const replaced = document.execCommand('insertText', false, replacement);
      if (!replaced) return false;
      if (selectionMode === 'select') {
        textarea.setSelectionRange(start, start + replacement.length);
      } else if (selectionMode === 'start') {
        textarea.setSelectionRange(start, start);
      } else if (selectionMode === 'preserve') {
        textarea.setSelectionRange(start, start + replacement.length);
      }
      return true;
    },
    [],
  );

  const replaceTextareaRange = React.useCallback(
    (
      textarea: HTMLTextAreaElement,
      replacement: string,
      start: number,
      end: number,
      selectionMode: 'select' | 'start' | 'end' | 'preserve' = 'end',
    ) => {
      if (replaceTextareaRangeWithNativeEdit(textarea, replacement, start, end, selectionMode)) {
        return;
      }
      textarea.focus();
      textarea.setRangeText(replacement, start, end, selectionMode);
      dispatchTextareaInput(textarea);
    },
    [dispatchTextareaInput, replaceTextareaRangeWithNativeEdit],
  );

  const applyBlockComment = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      const result = blockCommentSelection(
        textarea.value,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      );
      if (!result.changed) return;

      replaceTextareaRange(
        textarea,
        result.text.slice(result.replaceStart, result.selectionEnd),
        result.replaceStart,
        result.replaceEnd,
        'select',
      );
    },
    [replaceTextareaRange],
  );

  const applyBlockUncomment = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      const result = blockUncommentSelection(
        textarea.value,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      );
      if (!result.changed) return;

      replaceTextareaRange(
        textarea,
        result.text.slice(result.replaceStart, result.selectionEnd),
        result.replaceStart,
        result.replaceEnd,
        'select',
      );
    },
    [replaceTextareaRange],
  );

  const execNativeEditorCommand = React.useCallback((command: 'undo' | 'redo' | 'copy' | 'cut') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    document.execCommand(command);
  }, []);

  const handleCopy = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = textarea.value.slice(start, end);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      execNativeEditorCommand('copy');
    }
  }, [execNativeEditorCommand]);

  const handleCut = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = textarea.value.slice(start, end);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      replaceTextareaRange(textarea, '', start, end, 'end');
    } catch {
      execNativeEditorCommand('cut');
    }
  }, [execNativeEditorCommand, replaceTextareaRange]);

  const handlePaste = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    try {
      const clipboardText = await navigator.clipboard.readText();
      replaceTextareaRange(textarea, clipboardText, start, end, 'end');
    } catch {
      return;
    }
  }, [replaceTextareaRange]);

  const handleDeleteSelection = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    replaceTextareaRange(textarea, '', start, end, 'end');
  }, [replaceTextareaRange]);

  const handleSelectAll = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const isModifier = event.metaKey || event.ctrlKey || event.altKey;
    const isHashShortcut = event.key === '#' || (event.shiftKey && event.code === 'Digit3');

    if (event.key === 'Tab' && !isModifier) {
      event.preventDefault();
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      replaceTextareaRange(textarea, '\t', start, end, 'end');
      return;
    }

    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      execNativeEditorCommand('redo');
      return;
    }

    if (!isHashShortcut || isModifier) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    event.preventDefault();
    applyBlockComment(textarea);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    event.preventDefault();
    const bounds = editorWrapRef.current?.getBoundingClientRect();
    const x = bounds ? event.clientX - bounds.left : event.clientX;
    const y = bounds ? event.clientY - bounds.top : event.clientY;
    const selected = textarea.value.slice(start, end);
    setContextMenu({
      x,
      y,
      hasSelection: start !== end,
      canBlockComment: selected.length > 0,
      canBlockUncomment:
        selected.length > 0 && selected.split('\n').some((line) => /^\s*#\s/.test(line)),
    });
  };

  const handleContextMenuAction = React.useCallback(
    async (
      action:
        | 'undo'
        | 'redo'
        | 'cut'
        | 'copy'
        | 'paste'
        | 'delete'
        | 'select-all'
        | 'block-comment'
        | 'block-uncomment',
    ) => {
      if (action === 'undo') execNativeEditorCommand('undo');
      if (action === 'redo') execNativeEditorCommand('redo');
      if (action === 'copy') await handleCopy();
      if (action === 'cut') await handleCut();
      if (action === 'paste') await handlePaste();
      if (action === 'delete') handleDeleteSelection();
      if (action === 'select-all') handleSelectAll();
      if (action === 'block-comment' && textareaRef.current) applyBlockComment(textareaRef.current);
      if (action === 'block-uncomment' && textareaRef.current)
        applyBlockUncomment(textareaRef.current);
      setContextMenu(null);
    },
    [
      applyBlockComment,
      applyBlockUncomment,
      execNativeEditorCommand,
      handleCopy,
      handleCut,
      handleDeleteSelection,
      handlePaste,
      handleSelectAll,
    ],
  );

  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

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
    <div className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none h-full">
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
        {isProjectFilesOpen && projectFiles.length > 0 && (
          <div
            className="absolute right-4 top-full z-30 mt-2 w-96 rounded border border-slate-600 bg-slate-900 shadow-xl"
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Checked files run together in list order
              </div>
              <button
                type="button"
                onClick={() => onCreateBlankProjectFile?.()}
                className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500 hover:text-white"
              >
                <Plus size={12} />
                New File
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {sortedProjectFiles.map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={() => setDraggedFileId(file.id)}
                  onDragEnd={() => setDraggedFileId(null)}
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
                    file.isFocusedTab
                      ? 'border-blue-500/70 bg-blue-500/10'
                      : 'border-slate-700 bg-slate-950/70 hover:border-slate-600'
                  }`}
                >
                  <div className="cursor-grab text-slate-500">::</div>
                  <input
                    type="checkbox"
                    checked={file.isCheckedForRun}
                    onChange={(event) => onSetProjectFileEnabled?.(file.id, event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => onFocusProjectFile?.(file.id)}
                    className="min-w-0 flex-1 text-left"
                  >
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
                      <div
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          beginRename(file.id);
                        }}
                        className="truncate text-slate-200"
                      >
                        {file.name}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                      {file.kind}
                      {file.isOpenInTab ? ' / open' : ''}
                      {file.isFocusedTab ? ' / focused' : ''}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {openTabs.length > 0 && (
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
                <button
                  type="button"
                  onClick={() => onFocusProjectFile?.(file.id)}
                  className="truncate"
                >
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
      )}
      {importNotice && (
        <div className="border-b border-cyan-900/60 bg-cyan-950/30 px-4 py-3 text-[11px] text-cyan-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold uppercase tracking-wide text-cyan-200">
                {importNotice.title}
              </div>
              {importNotice.detailLines.map((line) => (
                <div key={line} className="mt-1 text-cyan-100/85">
                  {line}
                </div>
              ))}
            </div>
            {onClearImportNotice && (
              <button
                type="button"
                onClick={onClearImportNotice}
                className="text-[10px] uppercase tracking-wide text-cyan-300 hover:text-white"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
      <div ref={editorWrapRef} className="flex-1 flex overflow-hidden relative">
        <div
          ref={numbersRef}
          className="bg-slate-950 text-slate-600 text-right pr-2 pt-4 font-mono text-xs select-none w-10 overflow-hidden"
          style={{ lineHeight: '1.625' }} // Match leading-relaxed of textarea (approx 1.625)
        >
          {lines.map((n) => (
            <div
              key={n}
              className={`leading-relaxed ${jumpHighlightLine === n ? 'bg-blue-500/20 text-blue-200' : ''}`}
            >
              {n}
            </div>
          ))}
        </div>
        <div className="relative flex-1 bg-slate-900">
          <pre
            ref={highlightRef}
            aria-hidden={true}
            className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-mono text-xs leading-relaxed whitespace-pre"
          >
            {highlightedInput}
          </pre>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
            className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-transparent caret-slate-100 focus:outline-none selection:bg-blue-500/30 selection:text-transparent whitespace-pre"
            spellCheck={false}
          />
        </div>
        {contextMenu ? (
          <div
            className="absolute z-20 min-w-44 rounded border border-slate-600 bg-slate-800 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {[
              { id: 'undo', label: INPUT_PANE_CONTEXT_MENU_ORDER[0], disabled: false },
              { id: 'redo', label: INPUT_PANE_CONTEXT_MENU_ORDER[1], disabled: false },
              { id: 'sep-edit-1', label: '', separator: true },
              {
                id: 'cut',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[2],
                disabled: !contextMenu.hasSelection,
              },
              {
                id: 'copy',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[3],
                disabled: !contextMenu.hasSelection,
              },
              { id: 'paste', label: INPUT_PANE_CONTEXT_MENU_ORDER[4], disabled: false },
              {
                id: 'delete',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[5],
                disabled: !contextMenu.hasSelection,
              },
              { id: 'select-all', label: INPUT_PANE_CONTEXT_MENU_ORDER[6], disabled: false },
              { id: 'sep-edit-2', label: '', separator: true },
              {
                id: 'block-comment',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[7],
                disabled: !contextMenu.canBlockComment,
              },
              {
                id: 'block-uncomment',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[8],
                disabled: !contextMenu.canBlockUncomment,
              },
            ].map((action) =>
              'separator' in action && action.separator ? (
                <div key={action.id} className="my-1 border-t border-slate-700" />
              ) : (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  className={`w-full px-3 py-2 text-left text-xs ${
                    action.disabled
                      ? 'cursor-not-allowed text-slate-500'
                      : 'text-slate-200 hover:bg-slate-700'
                  }`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleContextMenuAction(
                      action.id as
                        | 'undo'
                        | 'redo'
                        | 'cut'
                        | 'copy'
                        | 'paste'
                        | 'delete'
                        | 'select-all'
                        | 'block-comment'
                        | 'block-uncomment',
                    );
                  }}
                >
                  {action.label}
                </button>
              ),
            )}
          </div>
        ) : null}
        {fileMenu ? (
          <div
            className="absolute z-30 min-w-40 rounded border border-slate-600 bg-slate-800 shadow-lg"
            style={{ left: fileMenu.x, top: fileMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {[
              { id: 'open', label: 'Open' },
              { id: 'rename', label: 'Rename' },
              { id: 'duplicate', label: 'Duplicate' },
              { id: 'close', label: 'Close Tab' },
              { id: 'delete', label: 'Delete' },
            ].map((action) => (
              <button
                key={action.id}
                type="button"
                className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (action.id === 'open') onOpenFileTab?.(fileMenu.fileId);
                  if (action.id === 'rename') beginRename(fileMenu.fileId);
                  if (action.id === 'duplicate') onDuplicateProjectFile?.(fileMenu.fileId);
                  if (action.id === 'close') onCloseFileTab?.(fileMenu.fileId);
                  if (action.id === 'delete') onDeleteProjectFile?.(fileMenu.fileId);
                  setFileMenu(null);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
  },
);

export default InputPane;
