# Phase 21A Wave 1C — legacy duplication removal + Properties parity

Branch `feat/cad-compact-icon-ribbon-viewport-cleanup`, baseline `c29a2499`.
Scope of this wave: migrate `row.actions` into the shell `CadPropertiesPalette`,
thread `shellChrome` through the workspace surface/preview so the standalone
legacy UI stops duplicating shell chrome, and record the legacy-vs-palette
Properties parity. **By this wave: no `cadShell.css`, `CadRibbon.tsx`, canvas
geometry, or projector math was touched.** Not committed (per wave
instructions). (Other Phase 21A waves share this worktree; their
`cadShell.css`/canvas edits are not part of Wave 1C.)

## 1. What changed

| file | change |
|---|---|
| `src/cad-app/shell/cadShellTypes.ts` | new optional `runParcelLinkAction(action)` shell action (same signature the legacy panel's `onParcelRowAction` used) |
| `src/components/SurveyCadWorkspace.tsx` | maps `runParcelLinkAction → cadWorkspace.runParcelLinkAction`; passes `shellChrome` to the surface |
| `src/cad-app/shell/CadPropertiesPalette.tsx` | renders `row.actions` (Edit Shared / Unlink) with `disabledReason` tooltip + dispatch + rejection status |
| `src/components/SurveyCadWorkspaceSurface.tsx` | `shellChrome` prop (default false); when true the legacy `SurveyCadPropertiesPanel` is **not mounted** |
| `src/components/surveyCad/SurveyCadPreview.tsx` / `.types.ts` / `SurveyCadPreviewOverlays.tsx` | `shellChrome` prop (default false); hides the preview `SurveyCadCommandInputBar` and suppresses the duplicate command-status echo, keeping snap badge/menu, parcel-label toggle, modifier + construction hints |

`shellChrome` remains **default false**, so every existing caller (the full
`tests/surveyCadWorkspace/*` suite and the embedded standalone mounts) keeps the
legacy path verbatim.

### Dispatch channel

The palette uses the same channel as the legacy floating panel:

```
palette row button
  → CadShellActions.runParcelLinkAction(action)
  → workspace.runParcelLinkAction(action)
      parcel-unlink      → runLayerCommand({ key: 'PARCELUNLINK', boundaryId })
      parcel-shared-edit → commandState.startParcelSharedEditCommand(linkId)
```

A rejected outcome renders its `reason` inline (`role="status"`); a row whose
`disabledReason` is set (or a shell with no dispatcher) renders disabled with a
title tooltip — never a silent no-op.

## 2. Properties parity — legacy `SurveyCadPropertiesPanel` vs `CadPropertiesPalette`

Legend: **✅ parity**, **🟰 same engine rows, different chrome**, **🆕 migrated
this wave**, **❌ legacy-only (not migrated)**, **➕ palette-only**.

| capability | legacy floating panel | shell palette | status |
|---|---|---|---|
| common props (Type/Layer/Visible/Locked, COGO provenance, F2F provenance) | `buildEntityProperties` rows | same `buildEntityProperties` rows (identical keys/order/rounding) | ✅ 🟰 |
| appearance Color/Linetype/Lineweight/Transparency (ByLayer-or-explicit) | engine rows, inline edit via `editField` | engine rows, inline edit via `editField` | ✅ 🟰 |
| name / layer / linetype / lineweight / transparency edit | `editField` single-undo, Enter commit, Esc revert, LAYER_LOCKED message | `editField` single-undo, Enter commit, Esc revert, LAYER_LOCKED message | ✅ |
| block (definition, insertion E/N, rotation, scale X/Y) | engine rows + block transform edit fields | engine rows + block transform edit fields | ✅ 🟰 |
| survey point (coords/class/source read-only) | engine rows | engine rows **plus** Point Display override selects + effective-source lines (`CadSurveyPointDisplayInfo`) | ➕ (palette adds display overrides) |
| annotation (text/mtext/leader/dimension/label detail) | engine rows only | engine rows **plus** `CadAnnotationProperties` block (style/override edits) | ➕ |
| parcel inquiry (plan designation/role, area, perimeter, closure, arc-course metrics) | engine rows + dedicated `CadParcelReportSummary` block (m²/ha/ac/ft², closure dN/dE, course table) | engine rows (same numbers) — **dedicated report block not migrated** | 🟰 partial ❌ report block |
| shared-boundary row actions (Edit Shared / Unlink) | `onParcelRowAction` buttons in value cell | `runParcelLinkAction` buttons in value cell (same labels/disabled/tooltip/rejection message) | 🆕 |
| surface / profile / section / analysis blocks | not rendered | `Surface`/`Profile`/`Profile View`/`Sample Line`/`Section View`/analysis legend+map blocks | ➕ |
| grading / grading group blocks | not rendered | `GradingPropertiesBlock` / `GradingGroupPropertiesBlock` | ➕ |
| no-selection summary | none (entity rows only) | drawing summary (name/units/entities/layers/status) | ➕ |
| multi-select | type dropdown + entity dropdown, one active entity's rows at a time, no varies marker | per-type tabs, **common rows + `*VARIES*`**, batch edit across the group | ❌ different model (palette is the intended replacement) |
| undoable edits | `editField` → history single-undo | `editField` / `runSurveyCommand` / `runLayerCommand` / `runAnnotationOp` → history single-undo | ✅ |
| dock/float/collapse/close/drag chrome | `SurveyCadFloatingPanelShell` (Left/Right/Float/±/X) | `CadDockPanel` side dock (shell owns chrome); palette body is chrome-free | 🟰 |

Migrated this wave: **shared-boundary row actions**. Everything else in the
palette already matched or extended the legacy row set because both render the
same `engine/cad/cadProperties.ts` rows.

## 3. Remaining deltas (explicitly deferred)

1. **Parcel report block** — the legacy `CadParcelReportSummary` panel (ha/ac/ft²
   columns, course table) is not migrated into the palette. The preview's
   `SurveyCadParcelReportOverlay` also still suppresses itself while
   `propertiesPanelState` is non-null. In shell mode the report therefore relies
   on the palette's parcel property rows until a later wave migrates the block.
   This is the only user-visible capability reduction in shell mode.
2. **Non-shell tree actions in `CadParcelToolspace`** — the Toolspace keeps its
   own `runLayerCommand` / `startParcelSharedEdit` wiring; it was not folded into
   `runParcelLinkAction` (no behavior change, out of scope).
3. **`CadParcelToolspace` alternate action path** (`src/cad-app/shell/CadParcelToolspace.tsx:72-102`)
   is left untouched and still dispatches independently.

## 4. Browser specs

The `collapseFloatingPanel(page)` helpers in `tests-browser/**` locate
`button[title="Collapse panel body"]` guarded by
`isVisible().catch(() => false)`. With the legacy panel no longer mounted in
shell mode the query finds nothing and the helper is already a safe no-op — no
spec edits were needed (and none were made).

## 5. Validation

| check | result |
|---|---|
| `npm run typecheck` | clean |
| `npx eslint` on the 9 touched files | 0 errors / 0 warnings |
| `npx vitest run tests/surveyCadWorkspace/` | **52 files, 141 passed, 1 skipped** (legacy path intact) |
| `npx vitest run tests/cad_shell_panels.test.tsx` | **24 passed** (4 new: palette render+dispatch, disabled+rejected, no-dispatcher, ARC/Enter dock smoke) |
| `npx vitest run tests/surveyCad_shell_chrome.test.tsx` | **4 passed** (shell/legacy panel+input gating, overlay echo suppression) |

Shell-mode acceptance: exactly one Properties UI (the palette; the legacy
floating panel is not mounted) and command entry stays usable through
`CadCommandDock` (LINE via the existing `L` smoke, ARC completion + Enter, Escape
clear-then-cancel). Non-shell mode is byte-for-byte unchanged for the legacy
mounts.
