import React from 'react';
import { FileText } from 'lucide-react';
import { toggleHashCommentsInSelection } from './commentToggle';
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
  canToggleComment: boolean;
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
  const editorWrapRef = React.useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);

  const handleScroll = () => {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    setContextMenu(null);
  };

  const applyCommentToggle = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      const result = toggleHashCommentsInSelection(
        input,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      );
      if (!result.changed) return;

      onChange(result.text);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [input, onChange],
  );

  const restoreSelection = React.useCallback((start: number, end: number) => {
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start, end);
    });
  }, []);

  const replaceSelection = React.useCallback(
    (textarea: HTMLTextAreaElement, replacement: string) => {
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const nextValue = `${textarea.value.slice(0, start)}${replacement}${textarea.value.slice(end)}`;
      const nextCaret = start + replacement.length;
      onChange(nextValue);
      restoreSelection(nextCaret, nextCaret);
    },
    [onChange, restoreSelection],
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
      replaceSelection(textarea, '');
    } catch {
      execNativeEditorCommand('cut');
    }
  }, [execNativeEditorCommand, replaceSelection]);

  const handlePaste = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    try {
      const clipboardText = await navigator.clipboard.readText();
      replaceSelection(textarea, clipboardText);
    } catch {
      textarea.focus();
      document.execCommand('paste');
    }
  }, [replaceSelection]);

  const handleDeleteSelection = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    replaceSelection(textarea, '');
  }, [replaceSelection]);

  const handleSelectAll = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isHashShortcut = event.key === '#' || (event.shiftKey && event.code === 'Digit3');
    if (!isHashShortcut || event.metaKey || event.ctrlKey || event.altKey) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    const selected = input.slice(start, end);
    if (!selected.includes('\n')) return;
    event.preventDefault();
    applyCommentToggle(textarea);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    event.preventDefault();
    const bounds = editorWrapRef.current?.getBoundingClientRect();
    const x = bounds ? event.clientX - bounds.left : event.clientX;
    const y = bounds ? event.clientY - bounds.top : event.clientY;
    const selected = input.slice(start, end);
    setContextMenu({
      x,
      y,
      hasSelection: start !== end,
      canToggleComment: selected.length > 0,
    });
  };

  const handleContextMenuAction = React.useCallback(
    async (action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'select-all' | 'toggle-comment') => {
      if (action === 'undo') execNativeEditorCommand('undo');
      if (action === 'redo') execNativeEditorCommand('redo');
      if (action === 'copy') await handleCopy();
      if (action === 'cut') await handleCut();
      if (action === 'paste') await handlePaste();
      if (action === 'delete') handleDeleteSelection();
      if (action === 'select-all') handleSelectAll();
      if (action === 'toggle-comment' && textareaRef.current) applyCommentToggle(textareaRef.current);
      setContextMenu(null);
    },
    [
      applyCommentToggle,
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
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          onContextMenu={handleContextMenu}
          className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-xs resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30 whitespace-pre"
          spellCheck={false}
        />
        {contextMenu ? (
          <div
            className="absolute z-20 min-w-44 rounded border border-slate-600 bg-slate-800 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
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
                id: 'toggle-comment',
                label: INPUT_PANE_CONTEXT_MENU_ORDER[7],
                disabled: !contextMenu.canToggleComment,
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
                  onClick={() =>
                    void handleContextMenuAction(
                      action.id as
                        | 'undo'
                        | 'redo'
                        | 'cut'
                        | 'copy'
                        | 'paste'
                        | 'delete'
                        | 'select-all'
                        | 'toggle-comment',
                    )
                  }
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
