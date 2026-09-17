# Phase 18B shell reference: Open CAD Studio (OpenCADStudio)

## Purpose

This document records a read-only architectural/behavioural reconnaissance of
`HakanSeven12/OpenCADStudio`, gathered as **inspiration only** for the Phase 18B
professional CAD shell in WebNet. It is a concept inventory, not a port plan and
not a dependency decision.

## Provenance and license boundary

- Repository: https://github.com/HakanSeven12/OpenCADStudio
- License: GNU GPL-3.0 (see repo `LICENSE`). **No code was copied, adapted, or
  imported.** This brief contains only prose descriptions of observed structure,
  state names, UI concepts, and persisted-field concepts.
- Inspected revision: `472bb9883dab1d88f44ae674975658b1cb45f58f`
  (merge PR #1337, 2026-09-17), shallow clone, read-only.
- Method: primary-source inspection of the Rust/`iced` desktop+web application
  source (`src/app/`, `src/ui/`, `src/modules/`). No code blocks from the repo
  are reproduced here. Facts below are observations; anything believed rather
  than directly observed is labelled **inference**.

## 1. Document tab model

Observed:

- The app owns an ordered collection of document tabs plus an active index. Each
  tab carries a **stable numeric id** allocated from a process-wide counter, so
  background async work targets a tab by id, never by transient vector index.
- One `DocumentTab` is a full per-drawing session, not just a file handle. It
  holds: the drawing scene/document, `current_path`, `dirty`, a monotonic
  edit/undo/redo revision, a display title, a per-tab Properties panel state, a
  per-tab Layer panel state, the active layer, the active command (a boxed
  command object), selection set, previous selection set, per-tab undo/redo
  history, per-tab external-reference session state (unloaded set, stat cache),
  render/visual-style state, UCS, and view state.
- Tabs are **wrapped, not scrolled**: the bar is a flex-wrap flow that spills
  onto additional rows when there are more tabs than fit one line.
- Each tab shows a title (file name when saved, otherwise a tab title), an
  elided label, a dirty marker dot, hover/active styling, a per-tab close `×`,
  and a full-path tooltip when saved.
- A right-click tab context menu offers operations such as Save All, Close All,
  Close Others, and Copy Full Path. Close-all/close-others are queued by **stable
  tab id** because removing one tab reindexes the rest.
- Dirty close is gated by a shared unsaved-changes modal; clean closes proceed
  through a queue. Closing the last non-start tab falls back to the Start tab,
  or creates a fresh blank drawing when no Start tab exists.
- Tab switching persists the outgoing drawing's per-document system variables
  (e.g. Ortho / running OSNAP) into its header and adopts the incoming drawing's
  values, so per-drawing settings follow the active document instead of the app.
- A **Start/Welcome tab** is a sentinel at index 0: it cannot be closed or
  reordered, has no close button, and renders a welcome page in place of the
  viewport. The welcome page itself has sections (Recent, Videos, Welcome,
  Discussions, Supporters) and the last section is persisted.
- There is no MDI child-window model. New drawings are new tabs; there is no
  document-floating state.

Concepts worth reusing in WebNet: stable document id as the addressing key,
per-document session state (not just file + dirty flag), wrap-not-scroll tab
strip, dirty-marker tab, queued close-by-id, an optional non-closable Start tab,
and per-document view/system-variable persistence across switches.

## 2. Docking behaviour

Observed:

- A single generic **edge-stack dock** serves side panels. There are exactly two
  ordered vertical stacks — left and right — each ordered top-to-bottom.
  Stacking only; there is no floating/undocked state for dock panels and no
  tab-group-inside-dock concept.
- Dockable panels are an enumerable set: Properties, Block Palette, and External
  References. Adding a palette means adding one enum case; all dock chrome
  (drag, resize, collapse, close) is panel-agnostic.
- Per-panel persisted settings are **width** and **auto-collapse** (pin/auto-hide).
  Width is clamped to a shared minimum and per-panel maximum; the widest table
  palette is allowed roughly double the shared maximum; an additional clamp
  keeps the panel under ~45% of the window width. Auto-collapsed panels reduce to
  a collapsed bar and expand to full height on hover/click (industry-style
  auto-hide).
- Layout defaults: Properties docked left, Block Palette docked right; the
  External References palette docks to the right when opened if not already
  docked somewhere.
- Interactions exposed: begin drag to move/reorder, begin resize, reset width to
  default, toggle auto-collapse, close/hide, hover (raise), live drag-move,
  drag-release, hover-exit (re-collapse auto-hiding panels).
- Reorder/move between sides computes a live **insertion index** from the pointer
  y across the edge slots, with a special case that a lone full-height panel can
  only land in slot 0 (no top/bottom split).
- Persistence is a single grouped application config (native JSON settings file,
  web `localStorage`). The dock section stores the left list, the right list, and
  a per-panel width/auto-collapse map. It is serde-defaulted, and a
  "heal/ensure" pass seeds any missing panel entries so configs written by older
  versions still load. Close/hide visibility flags live in app state, separate
  from the persisted geometry.
- Dialogs are **not OS windows**: a shared in-canvas centered modal overlay hosts
  the Layer Manager, style editors, options, layout manager, About, etc. The
  native build has one main window and the web build has only the canvas, so the
  same modal path serves both. Modals carry movable/resizable options.

WebNet relevance: the two-edge ordered-stack model with drag-to-move/reorder,
width + auto-hide persisted per panel, and a single healable config section is a
small, testable contract. The in-canvas modal overlay (movable/resizable, one
code path for web) is directly aligned with a browser-only app.

## 3. Palette organisation

Observed:

- **There is no Toolspace-equivalent unified browser.** Palettes are separate,
  each with its own chrome and responsibility. (Explicitly checked; no
  "Toolspace"/"Tool Palettes" concept exists in the source or docs.)
- Docked palettes:
  - **Properties** — the selection/drawing property editor (see section 4).
  - **Block Palette** — a searchable grid of block thumbnails; clicking a card
    inserts the block; preview size cycles through small/medium/large; supports
    picking a file and refreshing.
  - **External References (Xref)** — a full reference manager palette with its own
    toolbar: attach DWG/Image/PDF, Refresh/Reload All, per-item Detach / Unload /
    Reload / Bind / Overlay, and a Change Path group (Full / Relative / Remove
    path / Select new path; the group is disabled until a path-changeable
    reference is selected). It has a **List vs Tree** view toggle: tree mode shows
    nested references with depth indentation and dashed hierarchy guides, and
    tree mode is single-select by design. The table has columns (Reference,
    Status, Size, Type, Date, Saved Path) with draggable column widths, and a
    lower pane that toggles between **Details** and **Preview** (a bounded
    thumbnail). Missing references surface as a neutral notice and never
    auto-open a modal.
- Modal "palette-like" tools (not docked): Layer Manager, layer-state manager,
  text/dimension/multileader/table/plot-style editors, named parameters, drawing
  units, plot dialogs, etc.
- The per-tab reference session state (which references are unloaded, load-time
  stat cache for staleness) lives on the document tab, not the palette, so the
  palette is stateless display + inputs and the document owns the truth.

WebNet relevance: a small set of focused palettes with per-palette toolbars, a
List/Tree duality only where hierarchy is real (xref), and document-owned session
state rather than palette-owned state. Confirms WebNet does not need a monolithic
Toolspace to be credible.

## 4. Properties palette behaviour

Observed, by selection cardinality:

- **No selection** — the panel becomes drawing-level properties and titles itself
  "No selection". It surfaces drawing/global sections (including named
  parameters, a constraint-value visibility toggle, and other document settings).
- **Single selection** — the full sectioned property set for that entity type.
- **Multiple selection** — properties are **merged by intersection**: only rows
  that apply to every selected object survive, and rows whose values differ show
  a shared "varies" marker (`*VARIES*`) instead of a value. A selection-group
  control lets the user narrow the edit scope: an "All (n)" group plus one group
  per entity type ("Line (n)", etc.). Above a large-selection threshold
  (~2,000 objects) per-entity aggregation is skipped and a count-only summary is
  shown; bulk edits still flow through the ribbon.
- **Commit model** — edits are buffered per field. Typing updates a per-field edit
  buffer; the focused field is highlighted; **Enter submits** and commits. A
  commit applies the new value to **every handle in the current property-target
  set** as a single undo snapshot, then invalidates derived caches, marks the tab
  dirty, and rebuilds the panel. An uncommitted edit buffer survives a panel
  rebuild only when the selection is unchanged.
- Collapsed property **sections** are an app-level preference (they carry across
  open drawings); expanded coordinate **groups** are a per-user view preference
  that survives rebuilds and selection changes. Derived/driven content can be
  marked read-only.
- Property edits are funnelled through a single "apply property op" recipe rather
  than duplicated per handler: undo snapshot → apply over all handles → invalidate
  dependent geometry caches → mark dirty → refresh.
- The ribbon reads the current selection too, so a property edit and a ribbon
  edit stay consistent; with no selection the ribbon falls back to document
  defaults.

WebNet relevance: the three-state model (drawing / single / multi) with a varies
marker and a scope-narrowing group control maps cleanly onto an SVG viewport app.
Enter-to-commit onto a buffered field with one undo entry per commit, plus
app-level section collapse vs per-user group expansion, is a precise, testable
behaviour contract.

## 5. Layer UI interaction

Observed:

- The Layer Manager is a dedicated (modal) table, not a dock panel.
- Toolbar: New, Delete (disabled for the layer "0"), Set Current (enabled only
  when a layer other than the current one is selected), and a live name search
  box that filters rows as you type.
- Columns: Status, Name, On, Freeze, Lock, Plot, Color, Linetype, Lineweight,
  Transparency. When editing a paper layout with viewports, additional
  per-viewport freeze columns are appended. **Every column header is sortable**;
  clicking the active header flips direction. Default sort is Name ascending.
- The Name column width is adjustable by dragging a divider.
- Selection is an **anchor row plus a multi-selection set**: Ctrl/Shift extend it,
  the anchor row owns the inline editable combos (a single shared combo state
  cannot drive several rows), and bulk property changes/deletion act on every
  selected row.
- The **current layer** is stored per drawing tab and highlighted in the table;
  "Set Current" moves it. The ribbon also exposes a quick layer dropdown with
  search and the same sort behaviour.

WebNet relevance: sortable-by-column, per-row toggle columns, anchor+multi
selection with bulk edits, explicit current-layer affordance, and a filter box
are all directly portable UI contracts. A searchable quick-layer control in the
shell chrome is a good complement to the full table.

## 6. File/layout tab concepts

Observed — there are **two independent tab systems**:

- **File (document) tabs** at the top, toggled by a FILETAB-style command (see
  section 1).
- **Layout tabs** at the bottom in the status bar, toggled by a LAYOUTTAB-style
  command. The strip lists "Model" first, then each paper-space layout.
  Paper-layout tabs are reorderable, have a right-click context menu
  (rename/delete), and support an inline rename text input with a cancel button.
  "Model" is not renameable. A left-most hamburger dropdown lists Model + every
  layout so a layout can be chosen even when the strip is crowded; a `+` creates
  a new layout.
- A **space-mode toggle** button reflects paper/model state: on the Model tab it
  reads "MODEL" and is informational; inside a layout it reads "PAPER" while
  editing paper space and "MODEL" while inside a viewport (MSPACE), and clicking
  it enters/exits the viewport. So paper-model context is shown both by the tab
  strip and by an explicit state button.
- Contextual chrome: a dedicated "Layout" ribbon tab is shown **only when a paper
  layout is active**, i.e. ribbon tabs are context-sensitive to model vs paper.
- Floating viewports inside a layout carry their own UCS, scale, annotation
  scale, and viewport-count/scale readouts surfaced as status-bar pills.

WebNet relevance: separating document tabs (what file) from layout tabs (which
space inside the file), a reorderable/renamable layout strip, a clear
MODEL/PAPER/MSPACE state indicator, and contextual (paper-only) toolbar groups
are all directly applicable concepts.

## 7. Command-line role in the workflow

Observed:

- The command line is a persistent bottom panel with an input field plus a
  transient history overlay. History lines fade after a configurable interval; a
  separate dropdown opens a **resizable full-history editor**.
- It is a first-class command entry surface, not a status log: commands can be
  typed, aliased (PGP-style alias table), recalled with arrow-key history, and
  autocompleted (bounded suggestion list with previous/next navigation and a
  ranked match function).
- While a command is active it publishes a **step prompt**; option keywords on the
  current prompt are rendered as clickable buttons beside the input (the bracketed
  option listing is stripped from the prompt when shown as buttons). A
  "recent input" list is available from the input context menu.
- **Transparent commands** (e.g. a zoom invoked mid-command) suspend the active
  command and restore it when the transparent command finishes.
- Dynamic input near the cursor (coordinate/distance/angle fields) is paired with
  the command prompt, including coordinate-mode prefixes and field focus.
- The same command surface is reused by other entry points: ribbon tools, context
  menus, keyboard shortcuts, plugins, and a line-based JSON automation/MCP
  endpoint. Historically-entered commands drive the undo labels and macros
  (command scripts).

WebNet relevance: a persistent command line that is a real command surface
(prompt + clickable keyword options + aliases + history + autocomplete) and that
shares one dispatch path with the ribbon/menus is the highest-leverage shell
concept. Transparent commands and clickable option buttons in particular are
cheap to model in a browser app.

## 8. Explicitly NOT applicable to WebNet

These were observed in OpenCADStudio but should **not** be carried into WebNet,
either because of the GPL-3.0 boundary, because WebNet is browser-only, or
because the scope is a survey drafting surface rather than a general CAD package:

- **All source code and any directly transliterated implementation** — GPL-3.0.
  Concepts only.
- Native DWG/DXF read-write codecs, ACIS/solid modelling, Boolean operations,
  STL/STEP export, plot/PDF output, CTB/STB plot styles, LandXML import — outside
  WebNet's purpose/parity scope.
- Native plugin architecture (separate processes, shared memory, IPC) and the
  plugin/MCP/headless automation servers — WebNet is a single browser app; the
  existing engine-free bridge (`AdjustmentSourceSnapshot`) already covers the
  survey→CAD handoff.
- Multi-OS-window management, file associations, OS thumbnails, native file
  dialogs/paths, edit-lease file locking, disk fingerprints, autosave/`.bak`
  files, and browser-leave confirmation — native-filesystem concerns; WebNet uses
  browser local persistence and explicit export/import.
- SpaceMouse and GPU-specific rendering/status machinery — not part of the shell
  redesign.
- The full eight-tab ribbon breadth (Draw, Parametric, Model, Insert, Annotate,
  View, Manage, Layout) and the associated tool catalogs — WebNet's CAD shell is a
  survey drafting surface; only the *pattern* (context-sensitive tabs, adaptive
  collapse, grouped panels) transfers, not the catalog.
- 21-locale i18n infrastructure and the themed multi-platform packaging — not
  needed for Phase 18B.
- A Toolspace-like unified browser — OpenCADStudio does not have one, and WebNet
  does not need to invent one for parity.

## Fact vs inference

- **Facts**: the tab/dock/palette/properties/layer/layout/command-line behaviours
  and the persisted-field concepts above were read directly from the inspected
  revision in `src/app/` and `src/ui/`.
- **Inference**: statements that a given concept "maps cleanly" or "is
  directly portable" to WebNet are engineering judgement, not claims about
  OpenCADStudio. No WebNet code was written or changed by this reconnaissance.

## Concept transfer shortlist for Phase 18B

1. Stable per-document id as the addressing key for async work and close queues.
2. Two-edge ordered dock stacks with drag-to-move/reorder, per-panel width +
   auto-hide, and a single healable persisted dock section.
3. A small set of focused palettes (Properties, block/insert palette, reference
   manager) instead of a monolith; document-owned session state.
4. Three-state Properties (drawing / single / multi) with a varies marker, a
   scope-narrowing group control, buffered Enter-to-commit, one undo per commit,
   app-level section collapse vs per-user group expansion.
5. Sortable, filterable, multi-select layer table with an explicit current-layer
   action and a quick-layer control in the chrome.
6. Separate document tabs vs layout tabs, reorderable/renamable layouts, a clear
   MODEL/PAPER/MSPACE indicator, and paper-context-sensitive toolbar groups.
7. A real command line (prompt + clickable option keywords + aliases + history +
   autocomplete + transparent commands) sharing one dispatch path with the
   ribbon/menus.
8. In-canvas movable/resizable modal overlays as the single dialog path for a
   browser-only app.

## 9. Phase 18B adoption notes (worker, 2026-09-17)

What WebNet 18B took from the shortlist above (concepts only, no code):

- (1) Tabs address drawings by drawing id; close-by-guard parks on Start.
  Per-tab history/selection deferred — single live workspace documented as
  the multi-doc restriction in `CadApplicationShell` and `cadShellLink.ts`.
- (2) Two side docks (left/right) with per-panel width persisted in one
  localStorage section (`webnet.cad.shell.v1`) plus Reset Workspace. No
  floating panels, no tab-groups-in-dock, no auto-hide (deferred 18C).
- (3) Focused palettes over a monolith; document-owned state via the
  `CadShellLink` snapshot. Toolspace itself stayed WebNet-specific.
- (4) Three-state Properties (drawing / single / multi) with a `*VARIES*`
  marker and per-type scope tabs; edits route through the existing
  transaction/undo (`editPropertiesField`). No buffered Enter-to-commit:
  edits commit per field through the existing path instead.
- (5) Layer table reuses the existing `LayerPanel` (supported columns only)
  with an explicit no-active-layer gap note; quick-layer dropdown deferred
  with the engine current-layer model.
- (6) Separate file tabs (top) vs Model/layout tabs (bottom strip over real
  `draft.sheets`); layout indicator repeated in the status bar. No
  rename/reorder of layouts, no paper-only ribbon tab (deferred 18C).
- (7) Persistent command dock with the six standard aliases (L/PL/M/CO/TR/EX,
  each verified against `ActiveCommandKey`), autocomplete, history, and one
  shared dispatch (`cadCommandRegistry.ts`) for menu/ribbon/dock/context
  menu. No transparent commands, no clickable option keywords (deferred 18C).
- (8) Dialogs stay the existing in-canvas overlays (drafting panel, export
  center); no new modal framework introduced.

GPL boundary: this file and the implementation contain prose concepts only;
no OpenCADStudio source was copied, adapted, or imported.
