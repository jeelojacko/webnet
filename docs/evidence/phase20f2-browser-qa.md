# Phase 20F.2 Browser QA — grading session sync, FAILED truthfulness, Cut/Fill defaults

## Environment
- Branch `fix/phase20f2-grading-session-sync` @ `4769ba63` (implementation
  uncommitted in the working tree; QA artifacts added on top, not committed).
- **Chromium for Testing 151.0.7922.34** (Playwright 1.60.0 bundled, headless).
- Production build: `npm run build` (clean, ~11 s) served by `vite preview` on
  `127.0.0.1:4174` (the served `index.html` hash matched the fresh `dist/`).
- Harness: repo Playwright config (`tests-browser/`, `workers:1`), one new
  spec `tests-browser/cad-grading-20f2-qa.spec.ts` (14 tests). No new
  framework, no mocks — every flow opens a seeded `.wncad` and drives the live
  `/cad` ribbon, manager, criteria editor, Toolspace and Properties palette.
- Viewports: 1366×768, 1920×1080, 2560×1440.
- Screenshots + objective DOM geometry: `docs/evidence/phase20f2/`
  (48 PNGs + `geometry.json`).

## Result
`14 passed (48.6 s)` — flows A–D at all three resolutions, flow C and the §35
focused checks at 1366. Re-run stable (full sweep executed after each fix).

## Workflows executed
| Flow | What was driven | Result |
|------|-----------------|--------|
| A — live chrome refresh | Group Manager Calculate on an analytic distance group with the worker artificially delayed; `Manager row`, `Toolspace summary[data-cad-grading-group-status]` and `Properties[data-cad-grading-group-status-reason]` each read **Unbuilt → Building → Current**. Manager closed **while BUILDING**; Properties then read Building → Current with **no synthetic select-all / selection / tab / command**. Reopened Manager carried the same Current. Standalone grading repeated Unbuilt → Building → Current in Manager + Toolspace. | **PASS** |
| B — FAILED after stale | Closed square distance group (default 25 m, grade −50 %) calculated CURRENT; Course 2 overridden to 20 m → row `Needs Recalc (stale)`; recalc with the 25/20 nonzero-grade analytic corner → row `Failed (stale) — CORNER_NO_SOLUTION`, Toolspace `data-cad-grading-group-status="FAILED"` + full `Failed — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z`, Extract/Bake disabled, Properties Status `Failed — …`. Row never reads CURRENT (no promotion). | **PASS** |
| C — edit while BUILDING | Delayed worker holds `Building`; Edit Criteria distance 20 → 15 applied mid-build; BUILDING cleared within 2.5 s (well before the 4 s delayed worker settled), Calculate re-enabled, status settled to `Unbuilt`; after the worker window elapsed the late result never became CURRENT. | **PASS** |
| D — Cut/Fill defaults | Standalone surface grading create form: Criterion kind `Cut / Fill` with **untouched** defaults shows `Cut ratio = 2:1`, `Fill ratio = 3:1` and a valid summary (`Criterion: Cut +50.00% / Fill -33.33%`, never `invalid`); Preview/Create proceeded (`Created`). Re-opened the created criterion: fields read `2H:1V` / `3H:1V` (the explicit `nH:1V` round-trip) with a valid summary. | **PASS** |

### Flow C worker-delay method
`Worker.prototype.postMessage` is patched in an `addInitScript` so that
`grading` / `group-grading` messages are held by an in-page timer
(`window.__wnGradingDelayMs`); `cancel` still posts immediately. The service's
BUILDING window therefore stays observable and the reconcile sweep can retire
the pending run before the delayed request even reaches the worker
(`cancelledRequestIds` drops it). This is test-only instrumentation — no app
code changed.

## Error counts
- Page errors (uncaught exceptions / unhandled rejections): **0** across all 14
  tests.
- Console errors: **0** across all 14 tests.
- Every test funnels `pageerror` and `console error` into an array and ends
  with `expect(errors).toEqual([])`.

## Phase 21 / §34 shell contract (measured in-page, all three resolutions)
| Metric | 1366×768 | 1920×1080 | 2560×1440 | Verdict |
|--------|----------|-----------|-----------|---------|
| Ribbon height | 120 px | 120 px | 120 px | ≤ 130, **one band** (`overflow-y: visible`) |
| Ribbon groups overflow | `auto` (horizontal only) | auto | auto | intended horizontal strip |
| `document.scrollWidth/Height` vs inner | 1366/768 | 1920/1080 | 2560/1440 | **no page overflow** |
| `[data-cad-properties]` count | 1 | 1 | 1 | one Properties palette |
| `[data-cad-command-input]` count | 1 | 1 | 1 | one command input |
| Viewport box | 814×345 | 1368×657 | 2008×1017 | visible + usable everywhere |
| Arc flyout box | (222.9,167) 302×260 | same | same | fully inside viewport, unclipped |

## §35 focused chrome checks
- f2f node, parcel node + parcel schedule, all rendered from real drawing data
  (Survey toolspace tab).
- Idle toolspace mutation count over 1.2 s while f2f/surveyTable/parcel data is
  live: **0** — no publication loop (the new `snapshotsEqual` subtrees do not
  over-publish).
- Parcel schedule Select drives a real selection; creating a Line Table
  (`LINETABLE`) inserts a table whose `[data-cad-survey-table-node]` appears in
  the toolspace. No redesign, no error.
- Pre-existing (not a 20F.2 regression): `LINETABLE` requires a selection
  (`startLineTableCommand` returns early with `selectedEntityIds.length === 0`),
  and the Phase 19A browser helper still uses the pre-21A
  `[data-cad-annotation-command]` selector (now `[data-cad-command]`). The
  §35 test uses the current selector + `Select All`.

## Screenshot inventory (48 PNGs, `docs/evidence/phase20f2/`)
Minimum required states, produced at **all three resolutions**
(`1366-`/`1920-`/`2560-` prefixes): `unbuilt`, `building`,
`current-toolspace-sync`, `properties-current`, `needs-recalc`, `failed-stale`,
`diagnostic`, `cutfill-default-valid`, `cutfill-reopen-valid`,
`locked-family-editor`, `surface-control`, `distance-elevation-control`.
Extras: `elevation-control` (×3), `standalone-current` (×3), `ribbon-flyout`
(×3), and 1366-only `editwhilebuilding-building`, `editwhilebuilding-retired`,
`f2f-surveyTable-parcel`. `geometry.json` records the live DOM boxes/scroll
metrics + manager row text + Toolspace/Properties status for every capture.

## Restrictions / notes (unchanged, documented not "fixed")
- No grading math, engine, or shell-layout code was changed by this QA pass.
- The only new code is the Playwright spec (test-only). The 20F.2 implementation
  itself remains uncommitted for orchestrator review.
- Ribbon `GRADINGGROUPCALC` / `GRADINGCALC` still require an explicit groupId
  option that the ribbon button does not pass (`selectedGroupId(options)` →
  null), so Calculate is manager-driven; verified live, not changed (out of
  scope — would be a command-plumbing change, not a QA fix).

## Slice 1 re-verification — 2026-09-29 11:14 ADT (Flow A)

The prior session's evidence was captured against a production build
(`index-OM7xZvv5.js`, 10:32) that predated the last two working-tree edits to
`CadGradingGroupManager.tsx` / `CadGradingManager.tsx` (10:33, calc-notice
follow-up). Slice 1 rebuilt `dist/` (`npm run build` → `index-2xMtpJM2.js`),
confirmed the running `vite preview` on `127.0.0.1:4174` serves the fresh hash,
and re-ran the spec against it.

- Full spec: **`14 passed (48.5 s)`** against the current tree (all flows, not
  just Flow A, so the shared `geometry.json` writer is left coherent at 48
  entries).
- **Flow A (this slice): PASS at 1366×768, 1920×1080, 2560×1440.**
  - Required 1920 captures (regenerated 11:14):
    `1920-unbuilt.png` → `1920-building.png` → `1920-properties-current.png`
    → `1920-current-toolspace-sync.png`; same trio at 1366 and 2560.
  - Live status agreement (no synthetic select-all / selection / tab / command):
    `1920-unbuilt` Toolspace `[UNBUILT,UNBUILT,UNBUILT]`;
    `1920-building` Toolspace `[BUILDING,UNBUILT,UNBUILT]`;
    `1920-current-toolspace-sync`/`1920-properties-current` Toolspace `CURRENT`
    with Properties reason `Current`; reopen Manager carries `Current`.
  - Manager closed **while BUILDING**; Properties then read Building → Current
    without any refresh trigger. Standalone grading repeated
    Unbuilt → Building → Current (`*-standalone-current.png`).
- **Error counts (Flow A, all three resolutions): 0 page errors, 0 console
  errors, 0 unhandled rejections** — each test asserts `errors === []`.
- Browser: **Google Chrome for Testing 151.0.7922.34** (Playwright 1.60.0
  bundled production Chromium, headless).

Remaining for slice 2: flows B, C, D and the §34 shell contract / §35 focused
checks were also re-run green in the same pass above, but their dedicated
write-up, any 3-resolution screenshot deltas, and the shell-contract section
are slice 2's scope.

## Slice 2 — dedicated flow evidence (B, C, D) + §34 / §35

All figures below are from the same fresh-build run (`index-2xMtpJM2.js`),
re-confirmed green (`14 passed (48.5 s)`); every screenshot and `geometry.json`
entry (48) was regenerated in that run.

### Flow B — FAILED after stale (25/20 analytic corner): **PASS (all 3)**
- Evidence: `docs/evidence/phase20f2/{1366,1920,2560}-needs-recalc.png`,
  `-failed-stale.png`, `-diagnostic.png`.
- `geometry.json` `toolspaceStatuses`: `needs-recalc` → `[NEEDS_RECALC]`;
  `failed-stale` and `diagnostic` → `[FAILED]` at all three widths.
- Manager row `PadFail … Overrides:1` reads `Needs Recalc (stale)` then
  `Failed (stale) — CORNER_NO_SOLUTION`; diagnostic row
  `Failed — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z`;
  Extract/Bake disabled; the row never reads `Current` (no promotion).
- Errors: **0 page, 0 console** (all three).

### Flow C — edit while BUILDING retires pending work: **PASS (1366×768)**
- Evidence: `1366-editwhilebuilding-building.png`,
  `1366-editwhilebuilding-retired.png`.
- Delayed worker 4 s; BUILDING cleared < 2.5 s after the definition edit,
  Calculate re-enabled, late result never became CURRENT, final `Unbuilt`.
- Errors: **0 page, 0 console**.

### Flow D — Cut/Fill defaults + reopen round-trip: **PASS (all 3)**
- Evidence: `docs/evidence/phase20f2/{1366,1920,2560}-cutfill-default-valid.png`,
  `-cutfill-reopen-valid.png`, `-surface-control.png`.
- Untouched defaults `2:1` / `3:1` valid (summary never `invalid`); Create
  proceeded (`Created`); re-opened criterion fields `2H:1V` / `3H:1V` valid.
- Errors: **0 page, 0 console** (all three).

### §33 screenshot inventory — complete
Required §32 states present at **all three** resolutions
(`1366-` / `1920-` / `2560-` prefixes): `unbuilt`, `building`,
`current-toolspace-sync`, `properties-current`, `needs-recalc`, `failed-stale`,
`diagnostic`, `cutfill-default-valid`, `cutfill-reopen-valid`,
`locked-family-editor`, `surface-control`, `distance-elevation-control`.
Plus `elevation-control`, `standalone-current`, `ribbon-flyout` at all three,
and 1366-only `editwhilebuilding-building`, `editwhilebuilding-retired`,
`f2f-surveyTable-parcel`. Total **48 PNGs, 48 geometry entries**.
Inventory delta vs slice 1 / prior session: **none** (same filenames; all
rebuild-fresh against the current tree).

### §34 shell contract — **PASS at each resolution**
| Metric | 1366×768 | 1920×1080 | 2560×1440 |
|--------|----------|-----------|-----------|
| Ribbon height (≤130, one band) | 120 px | 120 px | 120 px |
| Ribbon `overflow-y` | visible (not auto/scroll) | visible | visible |
| Ribbon groups `overflow-x` | auto (horizontal strip) | auto | auto |
| `docScroll` vs `inner` | 1366×768 = viewport | 1920×1080 | 2560×1440 |
| Properties palettes / command inputs | 1 / 1 | 1 / 1 | 1 / 1 |
| Viewport box | 814×345 | 1368×657 | 2008×1017 |
| Arc flyout box | (222.89,167) 302.4×260 | same | same |
No page overflow, palettes/inputs unique, flyout fully contained, viewport
usable at every width.

### §35 focused chrome checks — **PASS**
- f2f node, parcel node + parcel schedule all render from real drawing data
  (`1366-f2f-surveyTable-parcel.png`).
- Idle toolspace mutations over 1.2 s: **0** (assert ≤4) — no publication loop.
- Parcel schedule Select drives a real selection; `LINETABLE` inserts a
  `[data-cad-survey-table-node]` without moving the shell.
- Errors: **0 page, 0 console**.

### Defects found / fixed in slice 2
- **UI defects: none.** No app/engine/math/layout code changed by QA.
- Test-only note (unchanged from slice 1): ribbon `GRADINGGROUPCALC` /
  `GRADINGCALC` need a groupId the ribbon button does not pass, so Calculate is
  manager-driven; verified live, left untouched (out of QA scope).

## Session-state contract checklist (§36 cross-reference)

Full source-derived audit: `phase20f2-session-state-audit.md`. Brief:

- **Root cause**: `snapshotsEqual` omitted the `grading`/`gradingGroups`/`f2f`/
  `surveyTable`/`parcel` subtrees, so pure-derivation transitions compared
  equal and `publish()` never notified — chrome stayed stale (display, not
  corruption).
- **Omitted fields**: those five subtrees (now compared). Partial gaps left:
  `selectionPreview.type`, `layers[].role`, `lineTypes` name/dash, `sheets`
  beyond id/name.
- **Equality contract**: `publish` notifies iff `!snapshotsEqual`; fast-ref
  check + 14 subtree compares.
- **Cancellation policy**: `reconcilePendingWithProject()` retires in-flight
  standalone+group runs whose `grev1:`/`ggrev1:` revision moved (never
  auto-calculates, never promotes stale); late results discarded by request-id
  + revision guards. Flow C proves it live.
- **FAILED policy**: session overlay via `deriveFailedEffectiveStatus`;
  eligible only over UNBUILT/NEEDS_RECALC at the current revision; Flow B
  proves a stale retained result can no longer mask FAILED.
- **Cut/Fill policy**: untouched defaults `2:1`/`3:1`, explicit `nH:1V`
  round-trip, bare `2` still rejected; Flow D proves it.
- **Perf**: ~3.5 ms full compare, ~5–6.5 ms with notify (see performance doc).
- **Remaining restrictions**: Relative Elevation, transitions, mixed-family
  groups, walls, corridors, radial, warped pads, DEM, boolean repair,
  selection-scoped GRIDGROUND.
