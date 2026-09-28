# Phase 21B — shell close-out summary

Branch: `feat/cad-shell-closeout-civil-icons` (base `origin/main` 0407a4d).
This is the close-out for the Phase 21B work that landed on top of Phase 21A:
the Civil icon wave, the parcel-report migration, the ribbon/flyout
hardening, and the browser visual QA. It is a summary/index; the detailed
records live in the sibling documents.

## 1. Scope landed on this branch

| Piece | Detail | Evidence |
|-------|--------|----------|
| Parcel report migration | `CadParcelReportProperties.tsx` renders the authoritative parcel report (area m²/ha/ac/ft², perimeter, closure dN/dE/dist, course table) inside the shell Properties palette; single-selection wiring only | `docs/evidence/phase21b-properties-parity.md` |
| Civil icon wave | 25 EXACT/STRONG Civil icons adopted (50 stripped PNGs), semantic names, manifest registration, icon-first wiring | `docs/evidence/phase21b-civil-icon-audit.md`, `docs/evidence/phase21b-icon-provenance.md` |
| Ribbon hardening | height gate, vertical clip decision, viewport-capped flyout anchor, real-path New/Open reset coverage, Survey label casing | `docs/evidence/phase21b-ribbon-hardening.md` |
| Browser visual QA | 46 real frames + inspected findings F1–F6 | `docs/evidence/phase21b-visual-qa.md` |

## 2. Icon mappings

The 25 adopted ids map 1:1 to one truthful control each; the full
`WebNet id → 16px source → 32px source → raw bundle` table is in
`docs/evidence/phase21b-icon-provenance.md §3`. Summary by family:

- **Surface (11):** `surface-create`, `surface-boundary`, `surface-breakline`,
  `surface-contours`, `surface-paste`, `surface-volume` (TIN volume),
  `surface-volume-report`, `surface-swap-edge`, `surface-line-add`,
  `surface-add-point`, `surface-style`.
- **Feature Line (5):** `feature-line-create`, `feature-line-elevation`,
  `feature-line-elev-from-surface`, `feature-line-raise-lower`,
  `feature-line-insert-vertex`.
- **Grading (2):** `grading-create`, `grading-group-create`.
- **Parcel (3):** `parcel-props-edit`, `parcel-segments-edit`,
  `parcel-renumber-tags`.
- **Survey / Profile-Section / Output (4):** `survey-point-group`,
  `profile-view`, `section-view`, `landxml-import`.

Registry command map additions in `CadRibbonShared.tsx`:
`PARCELCOURSEARC`/`PARCELCOURSELINE → parcel-segments-edit`,
`SHELL_IMPORT_LANDXML → landxml-import` (plus existing table icons for
`PARCELREPORT`/`PARCELDESC`). Icons remain presentation-only; no `commandKey`
was added to bounded groups, so `cadCommandRegistry` stays the single dispatch
path. Every id resolves to a real committed PNG; the manifest test strips
comments and fails on a real `local-assets` reference in `src/`.

## 3. Gates (assertions that hold the shell contract)

**Ribbon height / band** (`tests-browser/cad-shell-compact-ribbon-21a.spec.ts`,
`assertSingleRibbonBand`, all 3 resolutions):

- `ribbonH ≤ 130` (CSS `max-height: 128px` + tolerance)
- `groupsH ≤ 104`
- `groups.scrollHeight ≤ clientHeight + 1` (no vertical overflow)
- `flexWrap === 'nowrap'`, `overflowY === 'hidden'`
- exactly one `.cad-shell-ribbon-groups`
- drawing viewport height equals the recorded baseline ±2 px
  (345 / 657 / 1017 → viewport is not reduced by the compact band)

**Flyout viewport contract**
(`tests-browser/cad-shell-ribbon-hardening-21b.spec.ts`, all 3 resolutions):

- open flyout box has non-zero size and stays inside the viewport
  (`x ≥ -0.5`, `y ≥ -0.5`, `x + width ≤ vw + 0.5`, `y + height ≤ vh + 0.5`)
- `max-height ≤ 260.5px`, `overflow-y: auto`
- the long Line flyout scrolls internally (`scrollHeight > clientHeight`) with
  no document-level overflow (`documentElement.scrollHeight - innerHeight ≤ 1`)
- a far-right (`hatch`) caret, partially clipped by the strip, still anchors
  on-screen
- Escape restores caret focus; outside-click, `scroll`, and `resize` close it
- the strip keeps its horizontal access path (`scrollLeft` moves whenever
  `scrollWidth > clientWidth`)

**Unit gates:** `tests/cad_ribbon_icon_manifest.test.tsx` (5) locks the
manifest boundary; `tests/cad_ribbon_custom_families.test.tsx`,
`tests/cad_ribbon_controls.test.tsx`, `tests/cad_ribbon_wave2.test.tsx`,
`tests/cad_ribbon_tool_families.test.ts` cover family/registry wiring;
`tests/cad_shell_parcel_report.test.tsx` (7) pins the report snapshot,
units/rounding, straight and curved course cases, and the absence of the
legacy floating overlay; `tests/cad_feature_line_ui_20a.test.tsx` asserts the
moved full label via `aria-label`/`title`.

## 4. Open/reset proof (sticky tool-family faces)

Sticky state is owned by the shell (`useCadToolFamilyState`, keyed on
`snapshot.drawingId`) and reset only by the drawing lifecycle
(`handleDrawingLifecycle` ← `notifyDrawingLifecycle`, which
`SurveyCadWorkspace` emits as `cad-created`/`cad-opened`). Proven through real
shell paths by the 21B lifecycle spec at 1366×768:

| Action | Face after action |
|--------|-------------------|
| default | Arc: 3-Point |
| Arc flyout pick `arc-sce` | Arc: Start, Center, End (sticks) |
| quick-access **Save** (real WNCAD download) | unchanged (sticky) |
| ribbon collapse → restore | unchanged (sticky) |
| typed dock `ARC_SCA` | starts command, face unchanged |
| **New Drawing** | Arc: 3-Point (reset) |
| model-tab **Open** (`survey_plan_sample.wncad`) | Arc: 3-Point (reset) |
| sheet-tab **Open** (shell input) | Arc: 3-Point (reset) |

The 21A sweep independently re-asserts New-reset and collapse/restore
stickiness. The `useCadToolFamilyState` lookup was also switched from a
module-global `findCadRibbonToolFamily` to a memoized `familyById` map so
injected `families` props are honored (behavior-preserving for the shell).

## 5. Overflow and flyout behavior

- The compact band is one nowrap strip with `overflow-x: auto`,
  `overflow-y: hidden`; narrow widths scroll horizontally instead of wrapping
  or growing a vertical scrollbar. Baseline strip overflow: 1162 px @1366,
  608 px @1920, 0 px @2560.
- Open family flyouts paint `position: fixed` at a caret-computed anchor
  (`cadRibbonFlyout.constants.ts`: 352×260 box, 8 px viewport margin, 2 px
  caret gap); the anchor picks the side with more room and caps the inline
  `max-height` to the space actually available, so the menu is never taller
  than the contract and never off-viewport. No portal was introduced.
- Visual QA found and fixed one real defect (F1 in the visual-QA doc): the
  flyout had grown a horizontal scrollbar from long hints
  (`scrollWidth 458 > clientWidth 350`); `overflow-x: hidden` plus a
  shrink/ellipsize rule on `.cad-ribbon-flyout__hint` now keeps the menu
  vertical-only. Presentation-only change in `cadShell.css`.

## 6. Measurements

Shell bands (DOM geometry, visual-QA camera):

| Resolution | ribbon | groups | viewport | share | strip overflow-x |
|------------|-------:|-------:|---------:|------:|-----------------:|
| 1366×768   | 120    | 93     | 345      | 44.9 % | 1162 |
| 1920×1080  | 120    | 93     | 657      | 60.8 % | 608  |
| 2560×1440  | 120    | 93     | 1017     | 70.6 % | 0    |

Flyouts: Line 352×260 (internal scroll 414 > 258); Hatch 240×80; auxiliary
430 px-tall probe caps the Line menu to `max-height 255px` ending at
`bottom 422 ≤ 430`. Details and the full screenshot index are in
`docs/evidence/phase21b-visual-qa.md`.

## 7. Validation run for this close-out

- `npx playwright test cad-shell-compact-ribbon-21a cad-shell-ribbon-hardening-21b`
  → **7/7 passed** (3 compact-ribbon sweeps + 1 lifecycle + 3 flyout-hardening).
- Focused unit suites (ribbon controls/wave2/custom-families/tool-families/
  icon-manifest/parcel-report) → **36/36 passed**.
- `npm run check:portable-paths` → 0 violations (includes the new
  `tests-browser/fixtures/phase21b-parcel-report.wncad`).
- Browser specs run headless Chromium in-container with zero page/console
  errors (the specs assert `errors == []`).

## 8. Restrictions / not done

- **No merge.** The branch is left for review; this close-out does not merge.
- **Presentation-only.** No math/geometry/solver/registry dispatch changed.
  The CSS fix and ribbon icon wiring are the only non-doc source edits here.
- **Untouched by design:** circle/ellipse/rect/polygon/plain-hatch,
  shared-boundary, chord-label, F2F/linework, layer/xref, daylight,
  Helmert/Grid transforms keep text faces (no truthful asset);
  `draw-spline`/`draw-3dpoly`/`dim-arc-length` remain orphan manifest ids (no
  matching command).
- **Right-edge flyout clamp is spec-proven, not screenshot-proven:** every
  draw-family caret sits in the left ~660 px at the QA widths, so no frame can
  place one against the right edge; the bottom-edge cap is shown by the
  auxiliary probe (see visual-QA F3).
- **Horizontal ribbon affordance:** clipped rightmost groups are reachable by
  strip scroll; no chevron is implemented (reserved CSS hook only, visual-QA
  F2).
- **Legacy floating parcels overlay** is not reintroduced; the report is a
  palette section only.
