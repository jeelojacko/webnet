# Phase 20F.4 Independent Review — first review recorded (re-review pending)

Brief: independent reviewer (`reviewer-visual-gate`) examined the 20F.4 close-out: single
recaptured PNG (`docs/evidence/phase20f4/1366-cutfill-defaults.png`), the 33/33 pixel verdicts
in `phase20f4-visual-qa.md`, the final-HEAD 16/16 rerun in `phase20f4-browser-qa.md`, and the
merge-state facts in `phase20f4-post-merge-audit.md`. No `src/` changes are part of this phase
(docs + evidence PNGs only), so the review was evidence-sufficiency, not code correctness.

## First review: REQUEST CHANGES (1 major + 1 minor)

1. **MAJOR** — `phase20f4-visual-qa.md` falsely PASSED `docs/evidence/phase20f3/1920-failed-manager.png`:
   the manager row is scrolled with no FAILED/stale/CORNER_NO_SOLUTION legible (pre-recalc
   criteria-override moment, not the settled FAILED state).
2. **MINOR** — `*-cutfill-reopened.png` frames show created rows/summary, not the literal
   2H:1V/3H:1V edit-field values; docs must state plainly the literals are DOM-asserted and
   qualify the horizontal-clipping check as layout-only.

## Fix round (same branch, unreviewed)

- Recaptured `docs/evidence/phase20f4/1920-failed-manager.png` (fresh production build +
  real Chromium `/cad` Flow B @ 1920×1080; `Failed (stale) — CORNER_NO_SOLUTION` legible);
  phase20f3 original untouched. Corrected totals: carried frames 31 PASS + 2 FAIL, all 33
  states passing with the two phase20f4 replacements.
- Qualified the Cut/Fill literal-vs-pixel split in `phase20f3-browser-qa.md`,
  `phase20f4-visual-qa.md`, and `phase20f4-browser-qa.md`.

Counts: 35 evidence images total (33 carried phase20f3 + 2 phase20f4 replacements); 16/16
browser flows; 116/116 focused unit tests; lint/typecheck clean.

Verdict: **PENDING re-review** (fix round not yet examined by the reviewer).
