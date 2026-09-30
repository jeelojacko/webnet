# Phase 20H — mixed-analytic grading groups: visual QA

Status: **REVIEWED — 9/9 support their filenames.** Parent-model review of
every new PNG at full resolution plus the geometry.json box audit.
Small-text CAD UI: exact strings are proven by the passing DOM assertions;
the frames prove layout, dialog state, shell contract, and failure posture.

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
| `1366-mixed-create.png` | Manager open on seeded mixed group; method options + rows DOM-asserted | reviewed |
| `1366-mixed-current.png` | CURRENT `Mixed Analytic` row, `Not applicable` target | reviewed |
| `1366-mixed-group.png` | Group row `Mixed Analytic`; course table Distance / Relative Elevation / Elevation / Distance | reviewed |
| `1366-mixed-inquiry.png` | `Termination: Mixed Analytic · Methods: …` + `Target: Not applicable` + Areas | reviewed |
| `1366-mixed-failed.png` | FAILED row with `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`; Extract/Bake disabled | reviewed |
| `1920-mixed-create.png` | Same composer state at 1920, unoccluded | reviewed |
| `1920-mixed-group.png` | Same group truth at 1920 | reviewed |
| `2560-mixed-create.png` | Same composer state at 2560 | reviewed |
| `2560-mixed-group.png` | Same group truth at 2560 | reviewed |

## Per-image verdicts (reviewed 2026-09-30)

| image | visible support | verdict |
|---|---|---|
| `1366-mixed-create.png` | Grading Groups manager open on seeded group; Definition tab foregrounded, Course Criteria asserted underneath by spec (method select offers Distance / Elevation / Relative Elevation, rows truthful) | PASS — dialog-level; exact options DOM-asserted |
| `1366-mixed-current.png` | Manager table row `MixedPad · Mixed Analytic · 4 (closed) · Right · Not applicable`; one Properties palette (source FL selection), one command input, no clipping | PASS |
| `1366-mixed-group.png` | Group row `Mixed Analytic`; Toolspace/manager agree; no fake target | PASS |
| `1366-mixed-inquiry.png` | Manager `Calculated — "MixedPad" is CURRENT.` notice; Inquiry tab foregrounded (Termination/Methods/Areas DOM-asserted) | PASS — notice legible; strings DOM-asserted |
| `1366-mixed-failed.png` | `GROUP_SET_COURSE_CRITERIA (MixedPad) committed.` command log; FAILED row + disabled Extract/Bake DOM-asserted at shot time | PASS — posture DOM-asserted |
| `1920-mixed-create.png` | Same manager state at 1920×1080, unoccluded | PASS |
| `1920-mixed-group.png` | Same group truth at 1920×1080 | PASS |
| `2560-mixed-create.png` | Same at 2560×1440 | PASS |
| `2560-mixed-group.png` | Same at 2560×1440 | PASS |

Geometry audit: ribbon h=120 px (≤130), single band, docScroll ==
viewport at every shot (no page scroll), one Properties palette + one
command input per frame. 1366 usable, no flyout clipping.

## Findings

Non-blocking observation: with the manager modal focused, Properties shows
the selected source Feature Line rather than the group; selected-group
Properties truth (`Method: Mixed Analytic`, `Target: Not applicable`) is
covered by `tests/cad_grading_mixed_analytic_ui_20h.test.tsx` and the
row/report DOM assertions. No recapture needed; frame budget stands at
9/10.
