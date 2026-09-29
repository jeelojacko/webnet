# Phase 20F.4 Visual QA — full 33/33 pixel review + replacement

Source: `/tmp/20f4-pixel-review.md` (Step 2A). Method: every PNG in `docs/evidence/phase20f3/`
opened at full resolution and eyeballed (33/33 rendered, no fakes) on branch
`fix/phase20f4-visual-evidence-finalization`, baseline `c444f0a7`. Dimensions PIL-verified
(11× 1366×768, 11× 1920×1080, 11× 2560×1440); sizes 142935–321962 bytes; SHA-256 per
`/tmp/20f4-inventory.txt`. This supersedes the objective-only draft verdicts in
`phase20f3-visual-qa.md` for pixel legibility — the DOM evidence there stands, the eyeball verdicts
below govern.

## 33-row verdict table

Columns: file | claimed state | salient legible text | verdict. En/Dis (enable/disable
distinguishable), selected-group identifiable, and clipping checked per row in the source review;
only exceptions are noted — unnoted rows are YES / YES / non-blocking.

### 1366×768

| File | Claimed state | Salient text | Verdict |
|------|---------------|--------------|---------|
| 1366-live-building.png | live BUILDING | Props RibbonCalc / Method Distance / Status **Building** | PASS (dialog bottom note half-covered by Model bar, non-blocking) |
| 1366-live-current.png | live CURRENT | Status **Current**, Accuracy **Exact**, 2 members / 1 corner | PASS (same minor overlap) |
| 1366-failed-manager.png | FAILED manager dialog | "Failed (stale) — CORNER_NO_SOLUTION", Max 200.00 m; `GROUP_SET_COURSE_CRITERIA (PadFail)` | PASS w/ note (Extract/Bake disabled styling low-contrast — DOM assertion gates it) |
| 1366-failed-toolspace-properties.png | FAILED panels | Toolspace PadFail **Failed (stale)** + `GRADING_ANALYTIC_CORNER_Z`; Props "Failed (stale result withheld)" | PASS marginal (Toolspace cramped but readable) |
| 1366-ribbon-unbuilt.png | ribbon pre-calc gates | GateA/GateB Distance 2 Right; Default Grade -2.000% → 20.000 m; Calc on, Extract/Bake greyed | PASS |
| 1366-ribbon-current.png | ribbon Current | Green Current product; Extract/Bake enabled | PASS |
| 1366-ribbon-extract.png | ribbon Extract product | `GROUPEXTRACTDAYLIGHT (GateA - Daylight) committed.` | PASS (counts assertion-only) |
| 1366-ribbon-bake.png | ribbon Bake product | `GROUPBAKE (GateA - Baked) committed.`; Surfaces: EG + GateA - Baked | PASS (counts assertion-only) |
| 1366-cutfill-defaults.png | Cut/Fill defaults | Name CutFillDF … Target EG visible; **Criterion row + Cut/Fill values BELOW fold, occluded by dock — "2:1"/"3:1" NOT legible** | **FAIL → recaptured (see below)** |
| 1366-cutfill-reopened.png | Cut/Fill reopened | EnableManager + CutFillDF rows (Cut +50.000% / Fill -33.333%); `GRADING_CREATE (CutFillDF) committed.` | PASS marginal (cramped, legible) |
| 1366-shell.png | shell | Toolspace Prospector 2 entities / Layers (7) / Sheets (0); one ribbon band; `Type a command` | PASS |

### 1920×1080 (all PASS, dialog fully visible, no blocking clipping)

| File | Claimed state | Salient text | Verdict |
|------|---------------|--------------|---------|
| 1920-live-building.png | live BUILDING | Status **Building**, full dialog (Fixed grade, -2.000%, 20 / 0.1) | PASS |
| 1920-live-current.png | live CURRENT | Status **Current**, Accuracy **Exact**, Plan 4400.000 m², 3D 4400.880 m², 6 triangles | PASS |
| 1920-failed-manager.png | FAILED dialog | "1 course overridden", "Failed (stale) — CORNER_NO_SOLUTION" | PASS w/ note (same disabled-contrast note) |
| 1920-failed-toolspace-properties.png | FAILED panels | STALE Exact 4 members 4 corners + `GRADING_ANALYTIC_CORNER_Z`; Tie 25.000 m, Plan 12500.000 m² | PASS |
| 1920-ribbon-unbuilt.png | ribbon pre-calc | GateA/GateB, Calc on / Extract+Bake off, "2 side-preview arrows + 1 seam previews" | PASS |
| 1920-ribbon-current.png | ribbon Current | Green Current product; Extract/Bake on | PASS |
| 1920-ribbon-extract.png | ribbon Extract | `GROUPEXTRACTDAYLIGHT … committed.` + daylight L-polygon | PASS (counts assertion-only) |
| 1920-ribbon-bake.png | ribbon Bake | `GROUPBAKE … committed.` | PASS (counts assertion-only) |
| 1920-cutfill-defaults.png | Cut/Fill defaults | **Cut (nH:1V) 2:1, Fill (nH:1V) 3:1 legible**; "Cut +50.000% - Fill -33.333%" | PASS |
| 1920-cutfill-reopened.png | Cut/Fill reopened | Both rows + `GRADING_CREATE (CutFillDF) committed.` | PASS |
| 1920-shell.png | shell | One MODIFY band, Toolspace + Layers, Props FL, cmd input, empty viewport | PASS |

### 2560×1440 (all PASS, same content as 1920, fully legible)

| File | Claimed state | Salient text | Verdict |
|------|---------------|--------------|---------|
| 2560-live-building.png | live BUILDING | Status **Building**, full dialog | PASS |
| 2560-live-current.png | live CURRENT | Status **Current**, Accuracy **Exact**, 2 members · 1 corner, 4400.0 m² plan | PASS |
| 2560-failed-manager.png | FAILED dialog | Failed (stale) — CORNER_NO_SOLUTION, `GROUP_SET_COURSE_CRITERIA (PadFail)` | PASS w/ note (same disabled-contrast note) |
| 2560-failed-toolspace-properties.png | FAILED panels | Failed (stale) + `GRADING_ANALYTIC_CORNER_Z`, 4/4 members/corners | PASS |
| 2560-ribbon-unbuilt.png | ribbon pre-calc | GateA/GateB, Calc on / Extract+Bake off | PASS |
| 2560-ribbon-current.png | ribbon Current | Current product, Extract/Bake on | PASS |
| 2560-ribbon-extract.png | ribbon Extract | Extract committed + product | PASS (counts assertion-only) |
| 2560-ribbon-bake.png | ribbon Bake | Bake committed | PASS (counts assertion-only) |
| 2560-cutfill-defaults.png | Cut/Fill defaults | **Cut (nH:1V) 2:1, Fill (nH:1V) 3:1 legible** (UI literal `(nH:1V)` — contract wording maps to this control) | PASS |
| 2560-cutfill-reopened.png | Cut/Fill reopened | Both rows + `GRADING_CREATE` committed | PASS |
| 2560-shell.png | shell | One ribbon band + Properties + input + viewport | PASS |

Cross-cutting: 1366 ribbon shows the Home-tab panel set while 1920/2560 show MODIFY — exactly one
band everywhere, contract satisfied. Extract/Bake exact counts are assertion-only at all widths.

## Replacement (Step 3 recapture)

- Failed: `docs/evidence/phase20f3/1366-cutfill-defaults.png` (left untouched — history preserved).
- Replacement: `docs/evidence/phase20f4/1366-cutfill-defaults.png` — fresh production build
  (`index-BFrZan0G.js`) + Playwright/Chromium real `/cad` UI, Flow D framing with the create form
  scrolled so Criterion + ratios + summary sit fully above the dock. Legible in-frame: Criterion
  `Cut / Fill`, `Cut (nH:1V)` **2:1**, `Fill (nH:1V)` **3:1**, `Cut +50.000% · Fill -33.333%`,
  `Criterion: Cut +50.000% / Fill -33.333%`, Max search 20, Curve chord 0.1. Same DOM gates as Flow D
  asserted before capture (name `CutFillDF`, values `2:1`/`3:1`, summary valid, form bottom ≤
  viewport, zero page/console errors).

## New-image table

| File | Res | Bytes | SHA-256 |
|------|-----|-------|---------|
| `docs/evidence/phase20f4/1366-cutfill-defaults.png` | 1366×768 | 145539 | `61271b8d1dac9e0cab7b0f8e6913fae57d851da6e3273de0f2a6494d9b320660` |

Image audit (34 files: 33 phase20f3 + 1 phase20f4): **34 unique digests, 0 duplicate groups,
0 zero-byte** — every frame distinct, replacement differs from the failed original.
