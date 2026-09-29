# Phase 20F.2 Visual QA — per-screenshot inspection

## Method (read this first)
This harness had **no vision-capable model available** (the `oracle`/`scout`
subagents do not accept image attachments). The per-screenshot inspection is
therefore **objective**, not eyeballed: every capture is accompanied by
`docs/evidence/phase20f2/geometry.json`, which records, *at the exact moment of
each screenshot*, the live DOM bounding boxes and scroll/client metrics of the
ribbon, viewport, Toolspace, Properties palette, command dock, manager and
criteria panel, plus the Toolspace status attributes, manager row text and
Properties status reason. Those values are cross-checked against the
assertions that gated the capture. Image files were additionally verified for
dimensions and non-blank content with ImageMagick/PIL.

Image sanity (all 48 PNGs): exact viewport dimensions (1366×768 / 1920×1080 /
2560×1440); grayscale mean 0.069–0.130, std-dev 0.082–0.118, 2 219–4 248 unique
colours → every frame is a populated, non-blank UI with real content.

## Cross-cutting verdicts
| Acceptance question | Evidence | Verdict |
|---------------------|----------|---------|
| Toolspace / Manager / Properties agree on the same group status | `1366-current-toolspace-sync`: Toolspace `CURRENT`, manager row `…Current…`, Properties `Current`. `1366-building`: Toolspace `BUILDING`, manager `…Building…`. `1366-properties-current`: Toolspace `CURRENT`, Properties `Current`, manager closed. | **AGREE** |
| Failed obvious | `1366-failed-stale` / `1366-diagnostic`: Toolspace `data-cad-grading-group-status="FAILED"`, manager row `Failed`, Toolspace diagnostic row `Failed — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z`; Properties (after manager close) `Failed — …`. | **OBVIOUS** |
| Stale not mistaken for CURRENT | FAILED row text carries `(stale)`; `1366-needs-recalc` shows `Needs Recalc (stale)`; no FAILED/NEEDS_RECALC frame contains `Current`. | **CORRECT** |
| No clipping at 1366 | Criteria composer `(599,240) 454×366` → right 1053 < 1366, bottom 606 < 768. Manager `(586,303) 480×276`, right 1066 < Properties x 1086 (no overlap). Ribbon 120 px, command dock `(285,614) 785×26` inside. `document.scroll` == viewport (no page overflow) at all captures. | **NO CLIPPING** |
| 1366 usable | Viewport 814×345, ribbon 120, one Properties (271 px) + one command input, all panels present and scrollable internally (`manager sh>ch`, `toolspace sh>ch`). | **USABLE** |
| No table/ribbon/command-dock/viewport regression | `1366-unbuilt`/`1366-building`: table (`[data-cad-grading-group-row]` ×3), ribbon strip, command dock and viewport all present; viewport box identical across every 1366 capture. §35 Line Table create adds a `[data-cad-survey-table-node]` without moving the shell. | **NO REGRESSION** |

## Per-screenshot inspection
Geometry column format: `ToolspaceStatus(es) · ManagerBox · CriteriaBox ·
PropertiesStatus`. “Manager row” quoted where it is the strongest agreement
evidence.

### 1366×768 (tightest width — authoritative)
| File | State proven | Geometry / evidence | Defect |
|------|--------------|---------------------|--------|
| `1366-unbuilt.png` | all three groups UNBUILT; manager + Toolspace + create form visible | `UNBUILT,UNBUILT,UNBUILT` · mgr `586,303 480×276` · row `DistSync…Unbuilt…` | none |
| `1366-building.png` | group mid-build, manager-open | `BUILDING,UNBUILT,UNBUILT` · row `DistSync…Building…` | none |
| `1366-current-toolspace-sync.png` | same group CURRENT in Manager + Toolspace (auto-sync, manager reopened, no refresh command) | `CURRENT,UNBUILT,UNBUILT` · row `DistSync…Current…` | none |
| `1366-properties-current.png` | Properties palette CURRENT with manager closed | Toolspace `CURRENT` · Properties `Current` | none |
| `1366-standalone-current.png` | standalone grading CURRENT in manager + Toolspace | Toolspace `CURRENT` (standalone) · Properties `Current` | none |
| `1366-needs-recalc.png` | override moved revision → stale retained | Toolspace `NEEDS_RECALC` · row `PadFail…Needs Recalc…` | none |
| `1366-failed-stale.png` | recalc failed closed → FAILED + stale | Toolspace `FAILED` · row `PadFail…Failed…` · Extract/Bake disabled | none |
| `1366-diagnostic.png` | full bounded failure reason visible | Toolspace `FAILED` + `Failed — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z` | none |
| `1366-cutfill-default-valid.png` | Cut/Fill untouched 2:1/3:1 valid summary | manager `586,303 480×276` · create form values `2:1`/`3:1`, summary not `invalid` | none |
| `1366-cutfill-reopen-valid.png` | re-opened Cut/Fill valid (`2H:1V`/`3H:1V`) | manager `586,297 480×276` · edit panel values valid | none |
| `1366-locked-family-editor.png` | locked composer `Method: Distance (locked to group family)` | Toolspace `CURRENT` · criteria `599,240 454×366` (fully inside) | none |
| `1366-distance-elevation-control.png` | distance composer fields visible | criteria `599,240 454×366` | none |
| `1366-elevation-control.png` | elevation composer (locked family) | criteria `599,524 454×366` (inside manager scroll region) | none |
| `1366-surface-control.png` | surface composer `Fixed grade / Cut / Fill` | manager `586,303 480×276`, create form visible | none |
| `1366-ribbon-flyout.png` | Arc flyout contained | flyout `(222.9,167) 302×260`, right 525 < 1366, bottom 427 < 768 | none |
| `1366-editwhilebuilding-building.png` | BUILDING captured mid-build | Toolspace `BUILDING` · row `DistEdit…Building…` | none |
| `1366-editwhilebuilding-retired.png` | edit retired the pending run (no auto-recalc, no promotion) | Toolspace `UNBUILT` · row `DistEdit…Distance 15.000 m…Unbuilt` | none |
| `1366-f2f-surveyTable-parcel.png` | f2f + parcel + new Line Table in the Survey tree | toolspace scrolled to f2f/parcel/table nodes; idle mutations 0 | none |

### 1920×1080
All 15 states reproduce the 1366 behaviour with a wider viewport
(1368×657 viewport, ribbon 120). `1920-failed-stale`, `1920-diagnostic` show
`FAILED` + reason; `1920-current-toolspace-sync`/`1920-building` show Toolspace
`CURRENT`/`BUILDING` with the matching manager row; `1920-locked-family-editor`
criteria `1153,462 454×366` fully inside; flyout contained at (222.9,167).
**Defects: none.**

### 2560×1440
Same 15 states (viewport 2008×1017, ribbon 120).
`2560-failed-stale`/`2560-diagnostic` `FAILED` + reason;
`2560-current-toolspace-sync`/`2560-building` agree; criteria
`1793,750 454×366` inside; manager `1780,303 480×…` does not overlap
Properties (`x 2280`). **Defects: none.**

### Cross-resolution consistency
- Ribbon height 120 px and `docScroll == inner` at every capture.
- Properties box identical per resolution (`1086,252` / `1640,252` / `2280,252`,
  271 px wide) → palette geometry stable.
- Flyout box identical at all three resolutions → no clamp drift.

## Defects found and fixes
1. **No UI defects** were found in any captured state; no app/engine/layout
   change was made by this QA pass.
2. **Harness defect found (not a UI regression), fixed in the new spec only:**
   the Phase 19A helper's `data-cad-annotation-command` selectors are stale
   after the 21A/21B ribbon rewrite (now `data-cad-command`), and `LINETABLE`
   requires an active selection. The §35 check uses the current selector +
   `Select All`; the pre-existing 19A browser spec is left untouched (out of
   scope, documented).
3. **Flow A method correction (test-only):** ribbon `GRADINGGROUPCALC` does not
   pass a groupId, so it is a no-op; Properties auto-sync is instead proven by
   closing the manager mid-build and reading the palette without any
   select-all/tab/command trigger.

## Honest limitation
Without a vision model, “no clipping / legible / obvious” is established from
live DOM geometry, scroll metrics, status agreement and assertion outcomes
(plus non-blank image metrics), not from human pixel inspection. The
`geometry.json` artifact is the per-screenshot record backing every row above.

## §34 shell-contract verdicts per resolution

Measured live in the same fresh-build run (see `geometry.json`
`*-ribbon-flyout` entries); each shell-contract test also asserts every row
below, with zero page/console errors.

| Check | 1366×768 | 1920×1080 | 2560×1440 | Verdict |
|-------|----------|-----------|-----------|---------|
| Ribbon height ≤ 130 px | 120 | 120 | 120 | **PASS** |
| Ribbon `overflow-y` not auto/scroll (one band) | visible | visible | visible | **PASS** |
| Ribbon groups overflow | `auto` (horizontal strip) | auto | auto | **PASS** |
| `document` scroll == viewport (no page overflow) | 1366×768 | 1920×1080 | 2560×1440 | **PASS** |
| `[data-cad-properties]` count | 1 | 1 | 1 | **PASS** |
| `[data-cad-command-input]` count | 1 | 1 | 1 | **PASS** |
| Viewport box visible + usable | 814×345 | 1368×657 | 2008×1017 | **PASS** |
| Arc flyout fully inside viewport | (222.89,167) 302.4×260 | same | same | **PASS** |

All three resolutions pass: ribbon stays a single 120 px band, no document
overflow, exactly one Properties palette and one command input, and the flyout
opens unclipped at an identical position/box regardless of width.

## Session-state contract checklist (§36 cross-reference)

Full source-derived audit: `phase20f2-session-state-audit.md`. This visual pass
inspects status agreement only; the state contract it exercises is:

- **Root cause**: 5 subtrees (`grading`, `gradingGroups`, `f2f`,
  `surveyTable`, `parcel`) missing from the `snapshotsEqual` publish gate →
  derived rows not reaching Toolspace/Properties (display staleness).
- **Omitted fields**: the same five (now compared); partial gaps left:
  `selectionPreview.type`, `layers[].role`, `lineTypes` name/dash, `sheets`
  beyond id/name.
- **Equality contract**: `publish` notifies iff `!snapshotsEqual`.
- **Cancellation policy**: revision-authoritative `reconcilePendingWithProject()`
  sweep retires moved in-flight runs; no auto-calculate, no stale promotion.
- **FAILED policy**: session overlay `deriveFailedEffectiveStatus` over
  UNBUILT/NEEDS_RECALC at the current revision; stale evidence never reads
  CURRENT. Every `*-failed-stale` / `*-needs-recalc` frame confirms this.
- **Cut/Fill policy**: untouched defaults `2:1`/`3:1`, `nH:1V` round-trip.
- **Workflows**: flows A–D (live chrome refresh, FAILED after stale, edit while BUILDING, Cut/Fill round-trip) as documented in `phase20f2-browser-qa.md`.
- **Screenshot inventory**: 48 PNG + 48 `geometry.json` entries.
- **Error counts**: 0 page / 0 console across the 14 browser tests.
- **Perf**: ~3.5 ms full compare (see performance doc).
- **Remaining restrictions**: Relative Elevation, transitions, mixed-family
  groups, walls, corridors, radial, warped pads, DEM, boolean repair,
  selection-scoped GRIDGROUND.
