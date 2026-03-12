import React from 'react';
import { FileText } from 'lucide-react';
import { blockCommentSelection, blockUncommentSelection } from './commentToggle';
import { INPUT_PANE_CONTEXT_MENU_ORDER } from './inputPaneContextMenu';

interface InputPaneProps {
  input: string;
  onChange: (_value: string) => void;
  importNotice?: {
    title: string;
    detailLines: string[];
  } | null;
  onClearImportNotice?: () => void;
}

type ContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  canBlockComment: boolean;
  canBlockUncomment: boolean;
};

const INPUT_EDITOR_BASE_TOKEN_CLASS = 'text-slate-300';
const INPUT_EDITOR_COMMENT_CLASS = 'text-slate-500';
const INPUT_EDITOR_DIRECTIVE_CLASS = 'text-blue-300';
const INPUT_EDITOR_FIXED_CLASS = 'text-red-400';

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

const InputPane: React.FC<InputPaneProps> = ({
  input,
  onChange,
  importNotice = null,
  onClearImportNotice,
}) => {
  const lineCount = input.split('\n').length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const numbersRef = React.useRef<HTMLDivElement>(null);
  const highlightRef = React.useRef<HTMLPreElement>(null);
  const editorWrapRef = React.useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const highlightedInput = React.useMemo(() => {
    const editorLines = input.split('\n');
    return editorLines.map((line, lineIndex) => (
      <React.Fragment key={`input-line-${lineIndex}`}>
        {renderHighlightedLine(line, lineIndex)}
        {lineIndex < editorLines.length - 1 ? '\n' : null}
      </React.Fragment>
    ));
  }, [input]);

  const handleScroll = () => {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    setContextMenu(null);
  };

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

  return (
    <div className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none h-full">
      <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 flex justify-between items-center">
        <span>INPUT DATA (.dat / imported reports)</span> <FileText size={14} />
      </div>
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
            <div key={n} className="leading-relaxed">
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
      </div>
    </div>
  );
};

export default InputPane;
