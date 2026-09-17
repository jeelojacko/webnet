# Phase 18C Browser QA Report

Branch: `feat/cad-drawing-standards` · Date: 2026-09-17
Spec: `tests-browser/cad-drawing-18c.spec.ts` (11 Playwright tests, real `/cad` app, Chromium)
Result: **11/11 pass, zero console/page errors.** Screenshots: `docs/evidence/phase18c/` (local only, NOT committed).

Mission items A–K drive the shipped UI: ribbon, Layer Properties Manager, canvas clicks,
Properties palette, LWT toggle, Export Center downloads, WNCAD save/reopen.

## Per-item verdicts

| Item | Verdict | Notes |
|------|---------|-------|
| A Layer Manager CRUD | **PASS** | New layer (deterministic name), rename to QA-Walls, set current (★), color #ff0000, linetype center, lineweight 0.5, transparency 25%, description — all persist in-row; ribbon current-layer dropdown follows. |
| B Visibility OFF/ON, Freeze/Thaw | **PASS** | OFF hides the QA-B line and clears its selection; ON restores. Freeze/Thaw behave identically in the viewport. |
| C Lock blocks MOVE | **PASS (fixed)** | Locked MOVE is rejected, geometry byte-identical, prompt shows `MOVE blocked: selection is locked (LAYER_LOCKED)…`. Unlock → same MOVE displaces the entity. Required fix #1 (rejection was silent). |
| D ByLayer follows layer | **PASS (fixed)** | Layer General → red/blue dispatches recolor the drawn line immediately; generic creates are pure ByLayer (no legacy style stamp). |
| E Explicit override | **PASS (fixed)** | Explicit green survives layer changes; back-to-ByLayer resumes following the layer (red). Same fix as D. |
| F New LINE lands on current layer | **PASS** | Set QA-B/QA-F current (manager radio AND ribbon dropdown paths); Properties Layer row of the new line confirms. |
| G Linetype across pan/zoom | **PASS (fixed)** | Layer linetype center reaches the ByLayer entity; wheel-zoom + middle-drag pan keep rendering stable with zero errors. |
| H LWT toggle | **PASS (fixed)** | Toggle flips display width (thin-normalized vs mapped 2 mm → clamped px); stored `Lineweight` row still `ByLayer (2 mm)`. Required fix #2 (toggle was unwired). |
| I Properties single/multi/undo | **PASS** | Single edit works; multi shows `*VARIES*` placeholder; multi-edit recolors both. Note: multi-edit commits **one undo step per entity** (2 undos to revert 2 entities) — behavior note, not a bug. |
| J WNCAD persistence | **PASS** | Save → bytes contain `QA-J`, `currentLayerId`, description, lineweight; blank-session reopen restores manager state + entity, rendered in the persisted layer color (ByLayer). |
| K Plot exclusion | **PASS** | No-plot `QA-K` group absent from downloaded SVG while printable `general` present; PDF generates via the same scene builder; WNCAD keeps all entities. Needed the plan sample (blank drawings have no sheets — note N3). |

## Bugs fixed during QA (small, focused)

1. **Silent MOVE/COPY rejection** — `src/hooks/surveyCad/useSurveyCadEditPointPick.ts`:
   `runCadCommand` returning `null` (lock/hidden gate) ended the session with no
   feedback. Now mirrors the TRIM/EXTEND pattern: detects `committed`, keeps the
   session, and sets `resultText` with the stable code (`LAYER_LOCKED` /
   `ENTITY_HIDDEN`), which surfaces in the command prompt.
2. **Dead LWT toggle** — the status-bar button flipped its label but nothing fed
   `lineweightDisplay` into the renderer (scene always `thin`). Plumbed
   `CadApplicationShell layout → SurveyCadWorkspace prop → useSurveyCadWorkspace
   → buildCadDisplayScene({ lineweightDisplay })`. Display-only; stored mm untouched.
3. **Wheel-zoom console error** — `SurveyCadPreviewCanvas` called
   `preventDefault()` inside React's passive wheel listener
   (`Unable to preventDefault inside passive event listener invocation`).
   Zoom math unchanged; now attached once as a native non-passive listener via ref.

Validation for the fixes: `npx eslint` clean on all touched files; vitest
`tests/cadCommandHistory`, `cad_appearance`, `cad_render_standards`,
`cad_export_18c`, `cad_wncad_18c`, `cad_properties_appearance`,
`cad_layer_manager_ui`, `cad_f2f_18c` — 18 files / 103 tests pass.
Repo `typecheck` shows only the pre-existing phase9l sibling dirt
(`runSessionAsync.ts`, `preanalysisScenario*` — untracked, not mine).

## Fixed (was "Reported, NOT fixed")

**B-18C-1 — interactive generic factories stamped a colored legacy style that shadowed the layer.**
Fixed: generic creates no longer stamp a legacy `styleId` (pure ByLayer per spec
§10 + §34) — LINE (`cadTransactions.ts`), PLINE (`cadTransactionsPolylineCommand.ts`),
TRAVERSE (`cadTransactionsTraverseCommand.ts`), arcs (`cadTransactionsCurveCommands.ts`,
FILLET in `cadTransactionsModifyCommands.ts`), PARCEL_CREATE
(`cadTransactionsParcelBasicCommands.ts`), manual POINT/text
(`cadTransactionsEntityFactories.ts`). Domain pipelines keep their stamps:
F2F `cadGeneration`, `cadAdjustedPointsImport`, error-ellipse pipeline, parsed-observation
seed (`cadModel.ts`), alignments, batch-COGO, parcel splits (inherit
`parcelEntity.styleId`), and FILLET previews (transient `preview` layer).
No new fallback code was needed — every consumer already resolves style-undefined
gracefully: renderer width fallbacks per family (1.25 line / 1.5 parcel / 1.1 ellipse /
1.2 point-or-text via `entityScreenStyle`), `pointRadius` by pointClass
(free 1.8 / control 2.4), `textFontSize` fallback 11 (= `label-default`), the §4
resolver (explicit > style > layer > default), and DXF/SVG export via the same
resolver (`entryStyle` emits only deltas from the layer). Default layer colors
equal their style counterparts (observation-lines #22c55e, points #38bdf8,
labels #e2e8f0, parcels/control #f59e0b), so domain imports render unchanged.
The 18C-D/E/G/J spec assertions are flipped to the fixed behavior and pass.

(Original bug note, kept for history: every interactive draw command hardcoded
`styleId: 'style-observation-line'`
(color `#22c55e`, linetype `continuous`):
`src/engine/cad/cadTransactions.ts:336` (LINE),
`src/engine/cad/cadTransactionsPolylineCommand.ts:28` (PLINE),
`src/engine/cad/cadTransactionsTraverseCommand.ts:134,164`,
`src/engine/cad/cadTransactionsCurveCommands.ts:51,138,231`.
`resolveCadEntityAppearance` ranks legacy style above layer for color/linetype
(`src/engine/cad/cadAppearance.ts`), so no drawn entity ever follows its layer —
breaking spec §4 ("changing layer color immediately recolors ByLayer entities")
and §10 ("new generic entities take currentLayerId + ByLayer appearance").
(Original repro, now fixed: `/cad` → LINE → Layer Manager sets General to red →
line stayed `#22c55e`; saved WNCAD showed `layerId: general` + red layer +
`styleId: style-observation-line`.)
Done — see above. Test fallout was limited to `tests/cad_render_standards.test.ts`
(two assertions pinning the stamp, updated to the ByLayer contract);
`tests/cadCommandHistory/*` passed unchanged (fixtures, not create-assertions).

## Other notes (minor / environmental)

- **N1 (minor UX):** the legacy floating workspace Properties panel and the embedded
  bottom command bar still render in `shellChrome` mode and overlap the right dock
  (clicks on Layer Manager fail while a selection exists). QA collapses/clears via
  shipped controls. Files: `src/components/SurveyCadWorkspaceSurface.tsx` (~L95-113).
- **N2 (behavior):** multi-entity Properties edits commit one undo step per entity.
- **N3 (coverage gap):** blank drawings have no sheets and `/cad` offers no sheet
  creation, so SVG/PDF plot could only be reached via `public/examples/survey_plan_sample.wncad`
  (whose legacy entities must first be erased — unstamped legacy fail-closed blocks
  deliverables, correctly).
- **N4 (test env):** headless Chromium exposes File System Access pickers with no UI
  to confirm; the spec deletes `showSaveFilePicker`/`showOpenFilePicker` pre-load to
  exercise the app's anchor-download fallback.
- **N5:** drawn geometry lands exactly under the cursor (cursor readout == saved
  world coords); earlier offset confusion was a test-harness fraction-mapping error.
- Pre-existing repo dirt untouched: `reports/phase9l/`, `src/engine/runSessionAsync.ts`,
  `preanalysisScenario*`, `tests/phase9l*` (typecheck already red on those).

## HEAD

`1d2a797b28771b2f6ffa19f63730d78d21e6e582` — spec + report + 4 source
fixes in one commit. Screenshots in `docs/evidence/phase18c/` are local-only.
