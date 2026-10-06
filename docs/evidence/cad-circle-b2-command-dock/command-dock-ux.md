# Phase B2 — Global command dock UX

Component: `src/cad-app/shell/CadCommandDock.tsx` (486 lines). Behaviour is
pinned by `tests/cad_command_dock_b2.test.tsx` (33 tests). This is presentation
and input orchestration only; command dispatch stays in `cadCommandRegistry`.

## 1. Single input buffer

There is exactly one visible command line with two owners:

- **Session active** (`snapshot.activeCommandKey != null`): the workspace
  `snapshot.commandInputValue` is the authority. `bufferValue` reads it
  directly; dock edits call `actions.setSessionInputValue(value)`; there is no
  effect that syncs a second copy.
- **Idle**: the dock owns one entry buffer (`text` state). Session takeover
  clears any abandoned idle draft (`useEffect` on `sessionActive`) so it never
  reappears after the session ends.

Submit routing:

- Session active + Enter → `submitSessionText(entry)` (or `confirmCommandInput`
  for empty/absent handler). The value is never re-resolved as a command.
- Idle + Enter → resolve via `resolveShellCommandText`, execute through
  `executeShellCommand`; a bare finite number with no session falls back to
  `submitSessionText`; otherwise an honest "Unknown command" echo.

## 2. Idle first-key capture (AutoCAD-style)

While idle, a capture-phase `window` keydown listener feeds the one dock buffer
and focuses the input:

- Captured: printable single-character keys (`event.key.length === 1`).
- Never captured: keys with Ctrl/Meta/Alt; `Delete`; `Space` (left to the
  workspace for grip-edit/snap cycling); any event whose target is interactive
  chrome (`input`, `textarea`, `select`, `button`, links, `contenteditable`,
  and the relevant `role=` values) or already `defaultPrevented`.
- `Backspace` edits the buffer only when non-empty; `Escape` clears a non-empty
  buffer otherwise falls through to the workspace cancel handler; `Enter`
  submits only when the buffer is non-empty.

## 3. Autocomplete

- `autocompleteShellCommands(text, availableKeys, SUGGESTION_LIMIT)` with
  `SUGGESTION_LIMIT = 8`; only idle (never during a session); only keys present
  in `snapshot.availableCommands`.
- Each row shows the key, label, and alias (e.g. `(PL)`).
- Highlight is null until the operator navigates/hovers; plain Enter then falls
  back to exact alias resolve (e.g. `I` → INSERT) rather than an unasked
  suggestion.
- Keyboard: `ArrowUp`/`ArrowDown` move the highlight and wrap; `Enter` executes
  the highlighted row; `Tab` completes the text without executing; `Ctrl+Enter`
  completes with the first suggestion.
- Pointer: hover highlights without executing; double-click executes.
- ARIA: input is `role="combobox"` with `aria-expanded`,
  `aria-controls="cad-shell-command-suggest"`, and
  `aria-activedescendant="cad-shell-command-suggest-<KEY>"`; the list is
  `role="listbox"` with `role="option"` rows.

## 4. History

- UI-only log, bounded at `HISTORY_LIMIT = 200`, never persisted and never part
  of the drawing model. Consecutive duplicates are collapsed.
- `ArrowUp`/`ArrowDown` recall history only when suggestions are hidden;
  `ArrowDown` past the newest entry clears the buffer.
- A central seam records commands started anywhere (ribbon, menu, flyout,
  context menu, session handoff) from `activeCommandKey` transitions, deduped
  against a typed dock start for the same key.
- When the panel is expanded, the list is scrollable and auto-scrolls to the
  newest entry.

## 5. Compact layout (two-row law)

- Collapsed is the default (`commandHistoryExpanded: false`): exactly **two
  rows** — the status row and the command-input row — with no history panel,
  no resize handle, and no reserved hidden space. `commandHeightPx` is ignored
  while collapsed (a stale 148/200/320 value never leaves a blank reservoir).
- The completed/unknown-command/unavailable echo is **not** a separate row. A
  single `visibleStatusText` is computed; it shows the echo when idle and the
  live prompt whenever a session is active (the live prompt carries the
  operative instruction and the command key). The status row keeps
  `data-cad-command-prompt`; it additionally carries the
  `cad-shell-command-echo` class (and `data-cad-command-status="echo"`) only
  while it displays a completion echo, so the old `.cad-shell-command-echo`
  selector still resolves without adding a row.
- Starting a session clears the stale echo, so a dock-initiated completion
  message can never mask the session/commit prompt (e.g. a `LAYER_LOCKED`
  reason). Errors that do not start a session always stay visible in the
  status row.
- The chevron toggle `[data-cad-command-history-toggle]` expands/collapses;
  it never submits a command (`type="button"`). Its `aria-label` flips between
  `Show command history` / `Hide command history` and it reports
  `aria-expanded`. The glyph direction is pinned: collapsed shows a down
  chevron (`⌄`) because the panel expands below, expanded shows an up chevron
  (`⌃`) to collapse.
- Expanded applies the fixed `heightPx` (e.g. 200 px) and shows the resize
  separator. Collapsing after use returns to the pre-use two-row height
  (browser flow E pins 54 px at 1366 and 1920).

## 6. Layout persistence

- `CadShellLayoutState` gains `commandHistoryExpanded` (default `false`);
  `useCadShellLayout().setCommandHistoryExpanded` updates it and
  `sanitizeLayout` reads only strict `true`.
- `CadApplicationShell` passes `historyExpanded` / `onToggleHistory` to the
  dock; without those props the dock falls back to internal state.
- `resetWorkspace()` restores the collapsed default and the default height.

## 7. Scripted Chrome the dock owns

The dock never captures keyboard events inside interactive targets; this is why
grip editing, snap cycling (Space), and ribbon/dialog typing keep working while
the global first-key capture is armed.
