import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  autocompleteShellCommands,
  executeShellCommand,
  resolveShellCommandText,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadShellLink } from './cadShellLink';

interface CadCommandDockProps {
  link: CadShellLink;
  snapshot: CadWorkspaceSnapshot | null;
  heightPx: number;
  onResize: (_heightPx: number) => void;
  /** Phase 19B — sheet-space gated actions override link.actions when set. */
  actionsOverride?: CadShellActions | null;
  /** Phase B2 — history panel expanded (controlled by shell layout). */
  historyExpanded?: boolean;
  /** Phase B2 — expand/collapse callback; falls back to internal state. */
  onToggleHistory?: (_expanded: boolean) => void;
}

/** UI-only log bound (never persisted, never part of the drawing model). */
const HISTORY_LIMIT = 200;
const SUGGESTION_LIMIT = 8;

/** Interactive chrome that owns the keyboard: the dock never captures there. */
const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="tab"]',
].join(',');

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_SELECTOR) != null;

const clampIndex = (index: number, length: number): number =>
  length <= 0 ? 0 : Math.min(index, length - 1);

/**
 * Phase B2 — global command dock. When a command session is active the
 * workspace `commandInputValue` is the single authority (viewport typing and
 * dock edits both write the session buffer, no effect syncing). When idle the
 * dock owns one shell entry buffer with AutoCAD-style first-key capture,
 * registry autocomplete, bounded history, and a compact collapsed layout.
 */
export const CadCommandDock: React.FC<CadCommandDockProps> = ({
  link,
  snapshot,
  heightPx,
  onResize,
  actionsOverride,
  historyExpanded,
  onToggleHistory,
}) => {
  const actions: CadShellActions | null = actionsOverride ?? link.actions;
  const sessionActive = (snapshot?.activeCommandKey ?? null) != null;
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  // Null until the operator navigates/hovers — plain Enter falls back to the
  // exact alias resolve (e.g. `I` → INSERT), never an unasked suggestion.
  const [suggestionIndex, setSuggestionIndex] = useState<number | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ startY: number; startHeight: number } | null>(null);
  const textRef = useRef(text);
  const lastCommandKeyRef = useRef<string | null>(null);

  const expanded = historyExpanded ?? internalExpanded;
  const toggleHistory = (): void => {
    const next = !expanded;
    if (onToggleHistory) onToggleHistory(next);
    else setInternalExpanded(next);
  };

  // Single buffer: the live session value while a session runs, else the
  // dock-owned idle entry buffer.
  const bufferValue = sessionActive ? (snapshot?.commandInputValue ?? '') : text;
  const availableKeys = snapshot ? new Set(snapshot.availableCommands) : null;
  const suggestions = sessionActive ? [] : autocompleteShellCommands(text, availableKeys, SUGGESTION_LIMIT);
  const suggestionsVisible = !sessionActive && text.trim().length > 0 && suggestions.length > 0;
  const activeSuggestionIndex =
    suggestionIndex == null ? -1 : clampIndex(suggestionIndex, suggestions.length);
  const activeSuggestion =
    activeSuggestionIndex >= 0 ? suggestions[activeSuggestionIndex] ?? null : null;
  const prompt = snapshot?.commandPrompt ?? 'Type a command (L, PL, M, CO, TR, EX).';

  const writeBuffer = useCallback(
    (value: string) => {
      // Session buffer is workspace-owned; idle buffer is dock-owned.
      if (sessionActive) actions?.setSessionInputValue?.(value);
      else setText(value);
    },
    [actions, sessionActive],
  );

  const recordHistory = useCallback((entry: string) => {
    const trimmed = entry.trim();
    if (trimmed.length === 0) return;
    setHistory((current) => {
      if (current.length > 0 && current[current.length - 1] === trimmed) return current;
      return [...current.slice(-(HISTORY_LIMIT - 1)), trimmed];
    });
  }, []);

  const runDefinition = (def: CadShellCommandDef): void => {
    const started = executeShellCommand(def, actions);
    setCompleted(started ? `Started ${def.label}.` : `${def.label} is unavailable right now.`);
    recordHistory(def.key);
    setText('');
    setSuggestionIndex(null);
    setHistoryIndex(null);
    inputRef.current?.focus();
  };

  const executeSuggestion = (def: CadShellCommandDef): void => {
    // Planned/unavailable rows are filtered by autocompleteShellCommands; the
    // starter still reports honestly when a live session is missing.
    runDefinition(def);
  };

  const submit = (): void => {
    const entry = bufferValue.trim();
    if (sessionActive) {
      // Session submit wins: the visible session value is consumed through
      // the existing workspace submit path, never re-resolved as a command.
      if (entry.length === 0) actions?.confirmCommandInput();
      else if (actions?.submitSessionText) actions.submitSessionText(entry);
      else actions?.confirmCommandInput();
      if (entry.length > 0) recordHistory(entry);
      setCompleted(null);
      return;
    }
    if (entry.length === 0) {
      actions?.confirmCommandInput();
      return;
    }
    const def = resolveShellCommandText(entry);
    if (def && actions) {
      const started = executeShellCommand(def, actions);
      setCompleted(started ? `Started ${def.label}.` : `${def.label} is unavailable right now.`);
    } else if (actions?.submitSessionText && Number.isFinite(Number(entry))) {
      // Phase 18T — bare number with no session is a candidate surface value.
      actions.submitSessionText(entry);
      setCompleted(null);
    } else {
      setCompleted(`Unknown command “${entry}”.`);
    }
    recordHistory(entry);
    setText('');
    setHistoryIndex(null);
    setSuggestionIndex(null);
    inputRef.current?.focus();
  };

  const onInputChange = (value: string): void => {
    writeBuffer(value);
    // Typing starts a fresh echo; submit() sets the next one (no effect
    // wipe, so the completion message survives the submit re-render).
    setCompleted(null);
    setHistoryIndex(null);
    setSuggestionIndex(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeSuggestion) {
        executeSuggestion(activeSuggestion);
        return;
      }
      if (event.ctrlKey && suggestions.length > 0 && text.trim().length > 0) {
        setText(suggestions[0]!.key);
        return;
      }
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (bufferValue.length > 0) {
        writeBuffer('');
        setSuggestionIndex(null);
        setHistoryIndex(null);
      } else {
        actions?.cancelCommand();
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestionsVisible) {
        setSuggestionIndex((current) => {
          if (current == null) return suggestions.length - 1;
          const index = clampIndex(current, suggestions.length);
          return index <= 0 ? suggestions.length - 1 : index - 1;
        });
        return;
      }
      if (history.length === 0) return;
      const next = historyIndex == null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      writeBuffer(history[next] ?? '');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestionsVisible) {
        setSuggestionIndex((current) =>
          current == null ? 0 : (clampIndex(current, suggestions.length) + 1) % suggestions.length,
        );
        return;
      }
      if (historyIndex == null) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        writeBuffer('');
      } else {
        setHistoryIndex(next);
        writeBuffer(history[next] ?? '');
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (activeSuggestion) setText(activeSuggestion.key);
      else if (suggestions.length > 0 && text.trim().length > 0) setText(suggestions[0]!.key);
      setSuggestionIndex(null);
    }
  };

  // AutoCAD-style idle first-key capture: typing on the viewport lands in the
  // one dock buffer. Capture phase so the dock wins over the workspace idle
  // selection handler; interactive chrome keeps its own keyboard.
  const submitRef = useRef<() => void>(() => {});
  useEffect(() => {
    textRef.current = text;
    submitRef.current = submit;
  });
  // A session takes over the command line; any abandoned idle draft is
  // dropped rather than reappearing after the session ends.
  useEffect(() => {
    if (sessionActive) setText('');
  }, [sessionActive]);
  useEffect(() => {
    if (sessionActive) return undefined;
    const capture = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Delete') return;
      if (isInteractiveTarget(event.target)) return;
      if (event.key === 'Escape') {
        if (textRef.current.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setText('');
        setSuggestionIndex(null);
        setHistoryIndex(null);
        return;
      }
      if (event.key === 'Backspace') {
        if (textRef.current.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setText((current) => current.slice(0, -1));
        setSuggestionIndex(null);
        inputRef.current?.focus();
        return;
      }
      if (event.key === 'Enter') {
        if (textRef.current.trim().length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        submitRef.current();
        return;
      }
      if (event.key.length !== 1) return;
      // Space stays with the workspace (grip-edit/snap cycling) — never a
      // literal here.
      if (event.key === ' ') return;
      event.preventDefault();
      event.stopPropagation();
      setText((current) => current + event.key);
      setSuggestionIndex(null);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [sessionActive]);

  // Central seam — record commands started anywhere (ribbon, menu, flyout,
  // context menu, session handoff) from activeCommandKey transitions. Dedupe
  // against a typed start already recorded by the dock submit.
  useEffect(() => {
    const key = snapshot?.activeCommandKey ?? null;
    if (key == null) {
      lastCommandKeyRef.current = null;
      return;
    }
    if (key === lastCommandKeyRef.current) return;
    lastCommandKeyRef.current = key;
    const lastEntry = history[history.length - 1] ?? '';
    if (resolveShellCommandText(lastEntry)?.key === key) return;
    recordHistory(key);
  }, [snapshot?.activeCommandKey, history, recordHistory]);

  // Keep the newest entry visible while the history panel is expanded.
  useEffect(() => {
    if (!expanded) return;
    const list = historyListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [expanded, history]);

  return (
    <section
      aria-label="Command line"
      className="cad-shell-command"
      style={expanded ? { height: heightPx } : undefined}
      data-cad-command-dock
      data-cad-command-expanded={expanded ? 'true' : 'false'}
    >
      {expanded ? (
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
      ) : null}
      <div className="cad-shell-command-prompt" data-cad-command-prompt>
        {prompt}
      </div>
      <div className="cad-shell-command-inputwrap" style={{ position: 'relative' }}>
        <div className="cad-shell-command-row">
          <span className="cad-shell-command-glyph" aria-hidden="true">
            ⌘
          </span>
          <input
            ref={inputRef}
            aria-label="Command input"
            role="combobox"
            aria-expanded={suggestionsVisible}
            aria-controls="cad-shell-command-suggest"
            aria-activedescendant={
              activeSuggestion ? `cad-shell-command-suggest-${activeSuggestion.key}` : undefined
            }
            aria-autocomplete="list"
            value={bufferValue}
            placeholder="Type a command"
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            data-cad-command-input
          />
          <button
            type="button"
            className="cad-shell-command-history-toggle"
            aria-label={expanded ? 'Hide command history' : 'Show command history'}
            aria-expanded={expanded}
            title={expanded ? 'Hide command history' : 'Show command history'}
            onClick={toggleHistory}
            data-cad-command-history-toggle
          >
            {expanded ? '⌄' : '⌃'}
          </button>
        </div>
        {suggestionsVisible ? (
          <ul
            id="cad-shell-command-suggest"
            role="listbox"
            aria-label="Command suggestions"
            className="cad-shell-command-suggest"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '100%',
              zIndex: 60,
              margin: 0,
              padding: '4px 0',
              listStyle: 'none',
              maxHeight: 160,
              overflow: 'auto',
              background: '#0b1220',
              border: '1px solid var(--cad-panel-edge)',
              borderRadius: 4,
            }}
          >
            {suggestions.map((def, index) => (
              <li
                key={def.key}
                role="option"
                id={`cad-shell-command-suggest-${def.key}`}
                aria-selected={index === activeSuggestionIndex}
              >
                <button
                  type="button"
                  title={`${def.label} — ${def.hint}`}
                  onMouseEnter={() => setSuggestionIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSuggestionIndex(index);
                    setText(def.key);
                    inputRef.current?.focus();
                  }}
                  onDoubleClick={() => executeSuggestion(def)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: index === activeSuggestionIndex ? '#1d2c4d' : 'transparent',
                  }}
                  data-cad-command-suggestion
                >
                  <strong>{def.key}</strong> {def.label}
                  {def.aliases.length > 0 ? <span> ({def.aliases.join(', ')})</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {completed ? <div className="cad-shell-command-echo">{completed}</div> : null}
      {expanded && history.length > 0 ? (
        <div
          ref={historyListRef}
          className="cad-shell-command-history"
          aria-label="Command history"
          data-cad-command-history
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {history.map((entry, index) => (
            <span key={`${index}-${entry}`} style={{ whiteSpace: 'nowrap' }}>
              {entry}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
};
