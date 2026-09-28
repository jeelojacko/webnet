# Phase 21A — compact ribbon + viewport architecture

Branch: `feat/cad-compact-icon-ribbon-viewport-cleanup`. Consolidated record
for the Wave-3 reviewer: how the shell pieces fit, what Wave 3 changed, and
what was deliberately left alone.

## 1. Split-button architecture

One family = one joined control (`CadRibbonSplitButton.tsx`): a **primary**
face (runs the sticky variant immediately, never opens the menu) plus a
**caret** (opens the menu only, never runs). Separate `<button>`s, so
keyboard/pointer semantics stay unambiguous.

- Dispatch is registry-only: `executeShellCommand` + `isShellCommandAvailable`
  from `cadCommandRegistry.ts`. No parallel command wiring lives in the
  ribbon; the manifest only *names* keys verified against real starters in
  `useSurveyCadCommandStarters.ts`.
- The flyout (`CadRibbonFlyout.tsx`) is a `role=menu` list: 16 px icon + full
  label + registry alias + hint per row. Planned rows render greyed with
  `aria-disabled` (focusable/inspectable) and can never run or go sticky
  (`isCadRibbonVariantSelectable` requires a real `commandKey`).
- **Wave-3 fix**: the menu paints `position:fixed` at a caret-computed
  viewport anchor (`.cad-ribbon-flyout--fixed`, clamped into the viewport,
  upward flip on short windows). Reason: the groups strip is a horizontal
  scroll container and `overflow` clips in-place absolute menus — Wave-3
  screenshots proved open flyouts painted zero pixels. The menu closes on
  outside press (menu-internal presses exempted — mousedown precedes the row
  click), Escape, selection, scroll, and resize. DOM position is unchanged,
  so `tests/cad_ribbon_controls.test.tsx` is unaffected. No transformed /
  filtered ancestor exists between ribbon and viewport, so `fixed` escapes
  the clip.

## 2. Sticky model + reset wiring

- `useCadToolFamilyState.ts` owns `currentVariantByFamily` (defaults from
  `buildCadRibbonDefaultVariantMap`). Shell-owned instance lives in
  `CadApplicationShell`; `CadRibbon` falls back to a local one.
- Only `cad-created` / `cad-opened` lifecycle events reset faces, via
  `handleDrawingLifecycle` → `toolFamilies.notifyDrawingLifecycle`. Save, tab
  switches, selection, undo/redo, collapse, and tab switches never touch
  family state. Verified in-browser: New/Open restore `Arc: 3-Point`;
  collapse/restore preserves the sticky face.

## 3. Family manifests (`cadRibbonToolFamilies.ts`)

Eight Draw families (`arc/line/curves/circle/bestfit/ellipse/shapes/hatch`)
declare every variant with `{ id, label, icon?, commandKey?, planned?, hint?,
separatorBefore? }`. The manifest is the long-term variant backlog: planned
rows are visible-but-grey with no fake keys (never semantically lying).
Truthful mappings called out in code: `Curve Calculator → CURVE_SOLVER`
(genuine parameter solver), `REVERSE_CURVE`/`COMPOUND_CURVE` kept as separate
honest rows below the Curves separator. Home tab (`CadRibbonHomeTab.tsx`)
composes Draw splits + Modify/Edit/Blocks icon rows + Layers/Parcel/Network/
Feature-Line/Grading groups; per-tab builders (`CadRibbon*Tab.tsx`) keep each
file under ~200 lines after `CadRibbon.tsx` thinned 532 → 74.

## 4. CSS band model (`cadShell.css`)

One compact band, `max-height: 128px`: tabs row (~26 px) + groups row
(`flex nowrap`, 2-row column grid, caption bottom, `overflow-x: auto`).
Measured 120 px rendered against a 128 px max at 1366/1920/2560. Groups never wrap
(`scrollHeight <= clientHeight + 2` asserted per tab); excess width scrolls
horizontally — the access path, never vertical wrap, never clip without a
path. Quick-access New/Open/Save use curated file icons; entries without a
truthful curated asset keep short text faces (never placeholder glyphs).

## 5. shellChrome gating (Wave-1C)

`SurveyCadWorkspace → Surface → Preview` take a `shellChrome` flag (default
false; shell passes true). In shell mode: NO legacy
`SurveyCadPropertiesPanel`, NO preview `SurveyCadCommandInputBar`, NO
duplicate `data-survey-cad-command-status` echo — while snap badge/menu,
parcel-label toggle, and modifier/construction hints stay. Exactly one shell
input (`[data-cad-command-input]`), one `Properties` palette
(`[data-cad-properties]`), one command dock. Verified: legacy selectors count
0 with a polyline selected showing full values. Parcel shared-boundary row
actions (Edit Shared / Unlink) were migrated into `CadPropertiesPalette` via
`CadShellActions.runParcelLinkAction` with `disabledReason` tooltips; the
parcel report-summary block is still deferred and does not gate row actions
(proven in-browser: linked lot-1 → both actions enabled → Unlink applies).

## 6. Viewport token + pan fix (Wave-1D)

One fixed token `--cad-model-bg: #020617` (`.cad-shell`) replaces the
theme-coupled `bg-slate-950` (`#1d2021`) on the preview shell div, the SVG
root (which paints the `xMidYMid meet` letterbox bands), and the drawing
background rect — unifying bands and drawing area in every theme. Verified:
5/25/50/75/95% width samples all `rgb(2, 6, 23)`. Pan anisotropy fixed
minimally: one uniform `clientToView = min(rect.w/900, rect.h/520)` factor
instead of per-axis rescaling, so diagonal drags track the cursor. Full
inventory, before/after math, and validation in
`docs/evidence/phase21a-viewport-background-audit.md`.

## 7. Responsive-projector decision: NOT changed + why

`SurveyCadPreview.geometry.ts` (`project`/`unproject`/`baseScale`,
`visibleWorldBoundsFromViewport`, `screenPointFromClientPoint`, wheel anchor
math, the 900x520 constants) is byte-identical. Rationale: the Wave-3 oracle
(sx == sy to 1e-9, 45° renders 45°, `getScreenCTM` agrees with viewBox math
to 0.0000 px at all three resolutions) proves the projector is already
isotropic and round-trip sound; the observed defects (letterbox seam,
pan drift, clipped flyouts) were all presentation/chrome layering, fixed
without touching geometry. The fixed `viewBox="0 0 900 520"` is intentional:
zoom/pan live in view coordinates, so zoom is observed on rendered geometry,
not on the viewBox attribute.
