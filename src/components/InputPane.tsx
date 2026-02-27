import React from 'react';
import { FileText } from 'lucide-react';
import { toggleHashCommentsInSelection } from './commentToggle';

interface InputPaneProps {
  input: string;
  onChange: (_value: string) => void;
}

const InputPane: React.FC<InputPaneProps> = ({ input, onChange }) => {
  const lineCount = input.split('\n').length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const numbersRef = React.useRef<HTMLDivElement>(null);
  const editorWrapRef = React.useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);

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
    if (start === end) {
      setContextMenu(null);
      return;
    }
    event.preventDefault();
    const bounds = editorWrapRef.current?.getBoundingClientRect();
    const x = bounds ? event.clientX - bounds.left : event.clientX;
    const y = bounds ? event.clientY - bounds.top : event.clientY;
    setContextMenu({ x, y });
  };

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
        <span>INPUT DATA (.dat)</span> <FileText size={14} />
      </div>
      <div ref={editorWrapRef} className="flex-1 flex overflow-hidden relative">
        <div
          ref={numbersRef}
          className="bg-slate-950 text-slate-600 text-right pr-2 pt-4 font-mono text-xs select-none w-10 overflow-hidden"
          style={{ lineHeight: '1.625' }} // Match leading-relaxed of textarea (approx 1.625)
        >
          {lines.map(n => (
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
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
              onClick={() => {
                const textarea = textareaRef.current;
                if (textarea) applyCommentToggle(textarea);
                setContextMenu(null);
              }}
            >
              Toggle # Comment
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default InputPane;
