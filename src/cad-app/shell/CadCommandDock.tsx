import React, { useRef, useState } from 'react';
import {
  autocompleteShellCommands,
  executeShellCommand,
  resolveShellCommandText,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadShellLink } from './cadShellLink';

interface CadCommandDockProps {
  link: CadShellLink;
  snapshot: CadWorkspaceSnapshot | null;
  heightPx: number;
  onResize: (_heightPx: number) => void;
}

/**
 * Phase 18B — first-class bottom command dock: live prompt, input with
 * alias completion, history (arrow keys), Enter to run, Escape to cancel.
 * Idle text resolves through the shared registry (L/LINE, PL/PLINE, M/MOVE,
 * CO/COPY, TR/TRIM, EX/EXTEND + full names); the same path serves menu,
 * ribbon, and context menu. While a command session is active the prompt
 * mirrors the workspace and Enter confirms via the workspace.
 */
export const CadCommandDock: React.FC<CadCommandDockProps> = ({ link, snapshot, heightPx, onResize }) => {
  const actions: CadShellActions | null = link.actions;
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{ startY: number; startHeight: number } | null>(null);

  const onInputChange = (value: string): void => {
    setText(value);
    // Typing starts a fresh echo; submit() sets the next one (no effect
    // wipe, so the completion message survives the submit re-render).
    setCompleted(null);
  };

  const availableKeys = snapshot ? new Set(snapshot.availableCommands) : null;
  const suggestions = autocompleteShellCommands(text, availableKeys, 8);
  const prompt = snapshot?.commandPrompt ?? 'Type a command (L, PL, M, CO, TR, EX).';

  const submit = (): void => {
    const entry = text.trim();
    if (entry.length === 0) {
      actions?.confirmCommandInput();
      return;
    }
    const def = resolveShellCommandText(entry);
    if (def && actions) {
      const started = executeShellCommand(def, actions);
      setCompleted(started ? `Started ${def.label}.` : `${def.label} is unavailable right now.`);
    } else if (snapshot?.activeCommandKey && actions?.submitSessionText) {
      // Phase 18O — text that is not a command belongs to the active
      // session (MTEXT/LEADER lines, numeric inputs). History untouched.
      actions.submitSessionText(entry);
      setCompleted(null);
    } else if (actions?.submitSessionText && entry.trim().length > 0 && Number.isFinite(Number(entry))) {
      // Phase 18T — a bare number with no annotation session is a
      // candidate surface-edit value (Elevation / delta); the workspace
      // consumes it only when a point session is staged, else no-op.
      actions.submitSessionText(entry);
      setCompleted(null);
    } else {
      setCompleted(`Unknown command “${entry}”.`);
    }
    setHistory((current) => [...current.slice(-99), entry]);
    setHistoryIndex(null);
    setText('');
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey && suggestions.length > 0 && text.trim().length > 0) {
        setText(suggestions[0]!.key);
        return;
      }
      submit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      if (text.length > 0) {
        setText('');
        setHistoryIndex(null);
      } else {
        actions?.cancelCommand();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const next = historyIndex == null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setText(history[next] ?? '');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex == null) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setText('');
      } else {
        setHistoryIndex(next);
        setText(history[next] ?? '');
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (suggestions.length > 0 && text.trim().length > 0) setText(suggestions[0]!.key);
    }
  };

  return (
    <section aria-label="Command line" className="cad-shell-command" style={{ height: heightPx }} data-cad-command-dock>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize command line"
        className="cad-shell-command-resize"
        onPointerDown={(event) => {
          dragStart.current = { startY: event.clientY, startHeight: heightPx };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = dragStart.current;
          if (!start) return;
          onResize(start.startHeight + (start.startY - event.clientY));
        }}
        onPointerUp={() => {
          dragStart.current = null;
        }}
      />
      <div className="cad-shell-command-prompt" data-cad-command-prompt>
        {prompt}
      </div>
      <div className="cad-shell-command-row">
        <span className="cad-shell-command-glyph" aria-hidden="true">⌘</span>
        <input
          ref={inputRef}
          aria-label="Command input"
          value={text}
          placeholder="Type a command"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          data-cad-command-input
        />
      </div>
      {text.trim().length > 0 && suggestions.length > 0 ? (
        <ul className="cad-shell-command-suggest" aria-label="Command suggestions">
          {suggestions.map((def) => (
            <li key={def.key}>
              <button
                type="button"
                title={`${def.label} — ${def.hint}`}
                onClick={() => {
                  setText(def.key);
                  inputRef.current?.focus();
                }}
              >
                <strong>{def.key}</strong> {def.label}
                {def.aliases.length > 0 ? <span> ({def.aliases.join(', ')})</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {completed ? <div className="cad-shell-command-echo">{completed}</div> : null}
      {history.length > 0 ? (
        <div className="cad-shell-command-history" aria-label="Command history">
          {history.slice(-4).map((entry, index) => (
            <span key={`${index}-${entry}`}>{entry}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
};
