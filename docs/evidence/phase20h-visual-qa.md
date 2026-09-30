# Phase 20H — mixed-analytic grading groups: visual QA

Status: **REVIEWED — 9/9 support their filenames (fix round).**
Parent-model review of every new PNG at full resolution plus the
geometry.json box audit. The fix round re-scrolled dialog internals so the
claimed states are visible in-frame; exact strings remain proven by the
passing DOM assertions alongside.

## Inputs

- Frames: `docs/evidence/phase20h/*.png` (≤10 new PNGs, no extras).
- Geometry audit: `docs/evidence/phase20h/geometry.json` written by the spec's
  `recordGeometry` hook.
- DOM assertions captured at each shot (already asserted by the spec).

## Review method

An independent **vision-capable reviewer** opens every PNG and reports what it
actually sees. OCR is not used as a gate on this dark, small-text CAD UI.
Visual review is combined with the deterministic `geometry.json` box audit and
with the DOM assertions captured at shot time.

## Per-image checklist (fill at run)

| image | required visible content | verdict |
|---|---|---|
| `1366-mixed-create.png` | Composer + exact per-course methods visible | reviewed |
| `1366-mixed-current.png` | CURRENT row + tie/area metrics legible | reviewed |
| `1366-mixed-group.png` | Shell frame with MixedPad Toolspace row | reviewed |
| `1366-mixed-inquiry.png` | Report metrics + corner ties legible | reviewed |
| `1366-mixed-failed.png` | FAILED + CORNER_NO_SOLUTION legible | reviewed |
| `1920-mixed-create.png` | Same composer state at 1920, unoccluded | reviewed |
| `1920-mixed-group.png` | Same group truth at 1920 | reviewed |
| `2560-mixed-create.png` | Same composer state at 2560 | reviewed |
| `2560-mixed-group.png` | Same group truth at 2560 | reviewed |

## Per-image verdicts (reviewed 2026-09-30)

| image | visible support | verdict |
|---|---|---|
| `1366-mixed-create.png` | Course Criteria composer scrolled into view: per-course rows (Elevation `Grade -50.000% → Elevation 0.000 m`, Distance `Grade -50.000% → Distance 20.000 m`), Method/Grade/Target-distance fields, `Criterion: Grade -50.000% → 20.000 m`, Apply/Reset/Apply-to-All | PASS — composer + exact per-course methods visible; option list DOM-asserted |
| `1366-mixed-current.png` | Groups table scrolled right: row `… Overrides:2 · Current · 50.00 m · Exact · 20.00–20.00 m · 9600.0 · 16`; Target `Not applicable` | PASS — CURRENT + tie/area metrics legible |
| `1366-mixed-group.png` | Shell-regression frame: Toolspace `Grading Groups (1) MixedPad Unbuilt, Method Mixed`; square model in viewport; one Properties palette, one command input | PASS — shell frame; course table covered by `-create` + DOM assertions |
| `1366-mixed-inquiry.png` | Inquiry report scrolled into view: `Tie distance min/max/mean 20.000`, `Areas: plan 9600.000 / 3D 10733.126`, `Grading Limit vertices: 12 · mesh triangles: 16`, four GAP corners `miter 28.284 m` with ties `(120,-20,0) (120,120,0) (-20,120,0) (-20,-20,0)` | PASS — metrics + ties legible; header lines DOM-asserted |
| `1366-mixed-failed.png` | Groups table scrolled right: row `… Failed — CORNER_NO_SOLUTION`, Max `50.00 m`; committed-override notice in command log | PASS — FAILED + code legible; `GRADING_ANALYTIC_CORNER_Z` detail + disabled Extract/Bake DOM-asserted |
| `1920-mixed-create.png` | Same manager state at 1920×1080, unoccluded | PASS |
| `1920-mixed-group.png` | Same group truth at 1920×1080 | PASS |
| `2560-mixed-create.png` | Same at 2560×1440 | PASS |
| `2560-mixed-group.png` | Same at 2560×1440 | PASS |

Geometry audit: ribbon h=120 px (≤130), single band, docScroll ==
viewport at every shot (no page scroll), one Properties palette + one
command input per frame. 1366 usable, no flyout clipping.

## Findings

Fix round (reviewer majors): (1) fully-overridden default leaked into
`groupMethodSummary`, group-bake and design-patch provenance, and
inquiry/CSV value rows — fixed by deriving kinds + representative values
from effective per-course criteria (`representativeGroupCriterion`),
proven by 5 new `(8b)` tests including end-to-end GROUPBAKE; legacy
homogeneous shapes byte-identical (696 grading/design-patch/shell tests
green). (2) First-capture frames left claimed states scrolled out of the
276 px 1366 manager — fixed with dialog-internal scroll reveals and
recaptured; all 9 frames re-reviewed above. Non-blocking observation: with the manager modal focused, Properties shows
the selected source Feature Line rather than the group; selected-group
Properties truth (`Method: Mixed Analytic`, `Target: Not applicable`) is
covered by `tests/cad_grading_mixed_analytic_ui_20h.test.tsx` and the
row/report DOM assertions. No recapture needed; frame budget stands at
9/10.
