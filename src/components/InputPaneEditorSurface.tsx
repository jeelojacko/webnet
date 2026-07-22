import React from 'react';
import { INPUT_EDITOR_LINE_HEIGHT_PX } from './InputPane.highlighting';
import { INPUT_PANE_CONTEXT_MENU_ORDER } from './inputPaneContextMenu';

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

type InputPaneEditorSurfaceProps = {
  beginRename: (_fileId: string) => void;
  contextMenu: ContextMenuState | null;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
  fileMenu: FileMenuState | null;
  handleContextMenu: (_event: React.MouseEvent<HTMLTextAreaElement>) => void;
  handleContextMenuAction: (
    _action:
      | 'undo'
      | 'redo'
      | 'cut'
      | 'copy'
      | 'paste'
      | 'delete'
      | 'select-all'
      | 'block-comment'
      | 'block-uncomment',
  ) => Promise<void>;
  handleKeyDown: (_event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleScroll: () => void;
  highlightRef: React.RefObject<HTMLPreElement | null>;
  importNotice: { title: string; detailLines: string[] } | null;
  input: string;
  jumpHighlightLine: number | null;
  lineCount: number;
  numbersRef: React.RefObject<HTMLDivElement | null>;
  onChange: (_value: string) => void;
  onClearImportNotice?: () => void;
  onCloseFileTab?: (_fileId: string) => void;
  onDeleteProjectFile?: (_fileId: string) => void;
  onDuplicateProjectFile?: (_fileId: string) => void;
  onOpenFileTab?: (_fileId: string) => void;
  setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState | null>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  visibleHighlightedInput: React.ReactNode;
  visibleLineNumbers: number[];
  visibleLineWindow: { visibleStart: number; visibleEnd: number };
};

export const InputPaneEditorSurface = ({
  beginRename,
  contextMenu,
  editorWrapRef,
  fileMenu,
  handleContextMenu,
  handleContextMenuAction,
  handleKeyDown,
  handleScroll,
  highlightRef,
  importNotice,
  input,
  jumpHighlightLine,
  lineCount,
  numbersRef,
  onChange,
  onClearImportNotice,
  onCloseFileTab,
  onDeleteProjectFile,
  onDuplicateProjectFile,
  onOpenFileTab,
  setFileMenu,
  textareaRef,
  visibleHighlightedInput,
  visibleLineNumbers,
  visibleLineWindow,
}: InputPaneEditorSurfaceProps) => (
  <>
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
          data-input-line-numbers
          className="bg-slate-950 text-slate-600 text-right pr-2 pt-4 font-mono text-xs select-none w-10 overflow-hidden"
          style={{ lineHeight: '1.625' }} // Match leading-relaxed of textarea (approx 1.625)
        >
          <div style={{ paddingTop: `${visibleLineWindow.visibleStart * INPUT_EDITOR_LINE_HEIGHT_PX}px` }}>
            {visibleLineNumbers.map((n) => (
              <div
                key={n}
                className={`leading-relaxed ${jumpHighlightLine === n ? 'bg-blue-500/20 text-blue-200' : ''}`}
              >
                {n}
              </div>
            ))}
          </div>
          <div
            style={{
              height: `${Math.max(
                0,
                (lineCount - visibleLineWindow.visibleEnd) * INPUT_EDITOR_LINE_HEIGHT_PX,
              )}px`,
            }}
          />
        </div>
        <div className="relative flex-1 bg-slate-900">
          <pre
            ref={highlightRef}
            aria-hidden={true}
            data-input-highlight-window
            className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-mono text-xs leading-relaxed whitespace-pre"
          >
            <div
              style={{
                paddingTop: `${visibleLineWindow.visibleStart * INPUT_EDITOR_LINE_HEIGHT_PX}px`,
                paddingBottom: `${Math.max(
                  0,
                  (lineCount - visibleLineWindow.visibleEnd) * INPUT_EDITOR_LINE_HEIGHT_PX,
                )}px`,
              }}
            >
              {visibleHighlightedInput}
            </div>
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
  </>
);
