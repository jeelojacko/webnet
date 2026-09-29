# Phase 20F.3 Browser QA — truthful grading-group shell commands from snapshot selection

## Final-state correction (2026-09-29 — original Environment section below is history)

- The `74bbf637` reference in the original Environment section was an intermediate commit, not the
  merged head. PR #132 merged head `91b2e0c4` as merge `8753478b` (`2026-09-29T16:25:42Z`, CI PASS
  run `36596624458`); the "uncommitted" recapture delta described below IS the merged head content.
- Then PR #133 (AGENTS.md memory routing, `bca465d0`) advanced `origin/main` to `c444f0a7`; 20F.4
  baseline = `c444f0a7` (no product-code drift).
- Final-HEAD rerun (fresh build, 16/16, 25.0s, zero errors):
  `docs/evidence/phase20f4-browser-qa.md`. Full pixel review + 20F.4 recaptures:
  `docs/evidence/phase20f4-visual-qa.md` (SUPERSEDED 2026-09-29 by Phase 20F.5: two 20F.4
  replacements, not one — 31 PASS/2 FAIL; see `phase20f5-review-record-closeout.md`).
  Merge-state audit: `docs/evidence/phase20f4-post-merge-audit.md`.

## Environment
- Branch `fix/phase20f3-grading-shell-evidence-closeout` @ `74bbf637`
  (implementation + Chromium QA committed on the branch; the only uncommitted
  delta is the Flow B failed-manager capture-step scroll fix, the two
  recaptured `1366/2560-failed-manager.png` frames, and these doc sentences —
  nothing product-side). Recapture reason: the first pair showed the
  pre-failure criteria-override moment, not the settled FAILED state; the
  rerun scrolls the manager's Status column and Extract/Bake actions into
  frame after recalc settles to FAILED.
- **Chromium 148.0.7778.96** (Playwright 1.60.0 bundled production build,
  headless). Measured at runtime, not copied from docs.
- Production build: `npm run build` (clean, 11.16 s) →
  `dist/assets/index-BFrZan0G.js`, served by `vite preview --host 127.0.0.1
  --port 4174`. The served `/cad` `index-*.js` hash matched the fresh `dist/`.
- Harness: repo `playwright.config.ts` (`testDir: tests-browser`,
  `workers: 1`, `reuseExistingServer: true`) so the already-running `vite
  preview` is reused instead of the dev server.
- Run command:
  `npx playwright test tests-browser/cad-grading-20f3-qa.spec.ts --reporter=list`
- Viewports: 1366×768, 1920×1080, 2560×1440.
- Spec: `tests-browser/cad-grading-20f3-qa.spec.ts` (16 tests). No mocks —
  every flow opens a seeded `.wncad` through the real Open Drawing input and
  drives the live `/cad` ribbon, manager, Toolspace, Properties and command
  dock. Grading math runs in the real worker.

## Result
`16 passed (24.9 s)` — flows A–D at all three resolutions, plus one typed
command/registry route at 1366 and the §22 shell regression at all three.
Re-run after a fresh `npm run build` on the current tree; stable.

## Requirement matrix
| Task | Requirement | Evidence | Verdict |
|------|-------------|----------|---------|
| A | UNBUILT → **one** Calculate click → BUILDING → CURRENT, no post-click wake-up interaction | One `GRADINGGROUPCALC` click; after it the test only polls `expect`/screenshots (zero clicks, zero typed commands, zero selection changes). `*-live-building.png` / `*-live-current.png` at 3 widths. | **PASS** |
| B | Distance group CURRENT → Course 2 override to an asymmetric 25 m/20 m corner → stale → recalc → FAILED `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`; stale retained; Extract/Bake disabled; Properties shows GROUP failure | Seed closed square group default 25 m / −50 %; override Course 2 to 20 m → row `Needs Recalc (stale)`; ribbon recalc → row `Failed (stale) — CORNER_NO_SOLUTION`, never `Current`; Toolspace `data-cad-grading-group-status="FAILED"`; Properties `Failed (stale result withheld) — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z`; Extract/Bake disabled both on ribbon and in the manager. `*-failed-manager.png` + `*-failed-toolspace-properties.png` at 3 widths. | **PASS** |
| C | Ribbon gates: no-selection disabled; UNBUILT Calc enabled; ribbon Calc → BUILDING → CURRENT exact group; CURRENT Extract+Bake enabled; Extract = one Feature Line + one Undo removes; Bake = one TIN surface + one Undo removes; one typed registry route | No selection: Calc/Inquiry/Extract/Bake all disabled, group buttons enabled. Group A selected → Calc enabled, Extract/Bake disabled. Ribbon Calc builds **only** A (`CURRENT`), B stays `UNBUILT`. `entityCount` +1 then Undo restores; surface node count +1 then Undo restores. `*-ribbon-unbuilt/-current/-extract/-bake.png` at 3 widths. Typed route: `GRADINGGROUPINQ` with no selection fails closed (`unavailable`, no dead tab); `GG` opens the manager definition tab. | **PASS** |
| D | Cut/Fill `*-cutfill-defaults.png` (2:1 / 3:1 valid) + `*-cutfill-reopened.png` (rows/summary visible unclipped; 2H:1V / 3H:1V literals DOM-asserted, clipping check is layout-only) at 3 widths | Untouched create-form defaults read `2:1` / `3:1`, summary contains `Cut` and not `invalid`. Created then reopened edit panel input values read `2H:1V` / `3H:1V` (DOM assertion — the PNGs show the created rows/summary, not the literal edit-field values), summary valid, and `right > innerWidth` check is `false` (layout-only unclipped check). 6 PNGs. | **PASS** |
| E | Every test: zero page/console errors + zero unhandled rejections | Every test registers `pageerror` + console-error collectors before `goto` and ends with `expect(errors).toEqual([])`. `16 passed`. | **PASS** |
| F | Shell regression: ribbon ≤130 px one band no wrap, usable overflow, no page overflow, one Properties palette, one command input, flyouts contained, 1366 usable, Toolspace/manager scrollable | In-page measurements at each width (below). | **PASS** |
| G | Docs + PNGs + visual-qa table + 20F.2 erratum | This file; `phase20f3-visual-qa.md`; `phase20f2-visual-qa.md` erratum; 33 PNGs + `geometry.json` under `docs/evidence/phase20f3/`. | **DONE** |
| H | Suite + `npm run check:portable-paths` | 16/16 pass; portable-path check green. | **PASS** |

## Error counts
- Uncaught page errors / unhandled rejections: **0** across all 16 tests.
- Console errors: **0** across all 16 tests.
- Every test funnels `pageerror` and `console error` into an array and asserts
  it is empty, so any unexpected error would fail the run.

## Flows executed (detail)
| Flow | What was driven | Result |
|------|-----------------|--------|
| A — one-click ribbon Calc | Group Manager row selected (snapshot selection drives the ribbon group commands), Survey toolspace tab, Properties on the group, drawing selection cleared — all **before** the click. Then exactly one `GRADINGGROUPCALC` click and observation only: manager row `Unbuilt → Building → Current`, Toolspace `data-cad-grading-group-status` `UNBUILT → BUILDING → CURRENT`, Properties reason `Building → Current`. | **PASS** (3 widths) |
| B — FAILED after stale | Closed square distance group calculated CURRENT; Course 2 overridden 25 m → 20 m (`overridden` notice) → row `Needs Recalc (stale)`; ribbon recalc fails closed → `FAILED` with `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`, row stays `(stale)` and never reads `Current`; Extract/Bake disabled; Toolspace diagnostic + Properties failure visible after closing the manager and clearing selection. | **PASS** (3 widths) |
| C — ribbon gates + products | Selection-driven enablement proven at no-selection / UNBUILT / CURRENT; ribbon Calc builds exactly the selected group; ribbon Extract adds exactly one feature line (`entityCount` +1) with one Undo removing it; ribbon Bake adds exactly one explicit-TIN surface (toolspace surface node +1) with one Undo removing it. Typed route `GG` / `GRADINGGROUPINQ` also exercised. | **PASS** (3 widths + 1 typed) |
| D — Cut/Fill defaults + reopen | Standalone surface grading create form: `Criterion kind = Cut / Fill` untouched defaults `2:1` / `3:1` and a valid summary; Create succeeded; reopened criterion input values read `2H:1V` / `3H:1V` (DOM-asserted), valid and layout-unclipped. | **PASS** (3 widths) |

## §22 shell contract (measured in-page, actual run output)
| Metric | 1366×768 | 1920×1080 | 2560×1440 | Verdict |
|--------|----------|-----------|-----------|---------|
| Ribbon height | 120 px | 120 px | 120 px | ≤ 130, **one band** (`overflow-y: visible`) |
| Ribbon groups wrap | `nowrap` | `nowrap` | `nowrap` | no wrap |
| Ribbon groups `overflow-x` | `auto` | `auto` | `auto` | usable horizontal overflow |
| `document.scrollWidth/Height` vs inner | 1366/768 | 1920/1080 | 2560/1440 | **no page overflow** |
| Properties palettes / command inputs | 1 / 1 | 1 / 1 | 1 / 1 | unique |
| Viewport box | 814×345 | 1368×657 | 2008×1017 | > 600×300 → usable at 1366 |
| Model layer present | true (svg/canvas) | true | true | viewport renders |
| Toolspace scrollable | true | true | true | `scrollH ≥ clientH` |
| Grading-group manager box | 480×276, right/bottom inside viewport | 480×526 | 480×658/676/682/704 | contained + internally scrollable (`scrollH 656…703` > `clientH 274`) |
| Arc flyout box | inside viewport (x≥0, right ≤ innerW, bottom ≤ innerH) | same | same | contained, unclipped |

Manager `scrollHeight` (656–703 px) exceeds its `clientHeight` (274 px) at all
widths while the box stays inside the viewport — the manager is scrollable, not
overflowing the page.

## Screenshot inventory (`docs/evidence/phase20f3/`, 33 PNGs + `geometry.json`)
All 11 required states at each of the three resolutions
(`1366-` / `1920-` / `2560-` prefix):

`live-building`, `live-current` (Flow A); `failed-manager`,
`failed-toolspace-properties` (Flow B); `ribbon-unbuilt`, `ribbon-current`,
`ribbon-extract`, `ribbon-bake` (Flow C); `cutfill-defaults`,
`cutfill-reopened` (Flow D); `shell` (§22).

`geometry.json` records, at the exact moment of each capture, the live DOM
boxes/scroll metrics of ribbon, viewport, Toolspace, Properties palette,
command input, manager and criteria panel, plus Toolspace statuses, manager row
text, Properties status reason and the disabled/enabled state of every ribbon
grading-group command. Nothing was written over `docs/evidence/phase20f2/`.

## Defects found
- **Product defects: none.** No grading math, `cadGradingGroupShell.ts`,
  `cadCommandRegistry.ts` group logic, or `cadShellSnapshotEqual.ts` semantics
  were changed. The 20F.3 shell behaviour (snapshot-selection-driven ribbon
  group commands) passed every gate.
- Test-only note (carried from 20F.2, still true): the group Properties palette
  renders only with zero drawing selection, so flows clear the selection in
  setup before asserting group Properties.

## Restrictions / notes
- The recapture delta (Flow B capture-step scroll fix, two `*-failed-manager`
  PNGs, these doc sentences) is **uncommitted**, left in the working tree for
  orchestrator review; everything else on the branch is committed.
- Runtime was 24.9 s for 16 tests on this machine; per repo tier rules the
  browser suite is not part of the vitest agent/WASM/release partitions.
