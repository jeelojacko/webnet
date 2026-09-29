# Phase 20F.4 Independent Review — final APPROVE (first REQUEST CHANGES → fix round → 20F.5 fresh APPROVE)

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

## 20F.5 fresh re-review: APPROVE (reviewer-20f5-fresh35, tree 699e9ff9)

Source: fresh pixel inspection of all 35 PNGs (33 originals + 2 replacements), authored by
reviewer `reviewer-20f5-fresh35` (not the implementer) on tree `699e9ff9` (= PR #134 merge).
Method: every PNG opened through the image reader and visually inspected at source resolution
(original dimensions independently checked with `identify`); no repo files changed by the review.

Result: **35/35 examined = 33/33 required states PASS with explicitly limited claims** —
31 PASS / 2 FAIL among the 33 originals, plus 2/2 replacements PASS:

- Per resolution: 1366 originals 10 PASS/1 FAIL + 1 PASS replacement; 1920 originals
  10 PASS/1 FAIL + 1 PASS replacement; 2560 originals 11 PASS/0 FAIL + 0 replacements.
- The two original failures stay FAIL (history preserved):
  `phase20f3/1366-cutfill-defaults.png` (Criterion + `2:1`/`3:1` occluded by the dock) and
  `phase20f3/1920-failed-manager.png` (pre-recalc moment, settled FAILED row out of frame).
- Both replacements PASS: `phase20f4/1366-cutfill-defaults.png` (Criterion Cut/Fill +
  `2:1`/`3:1` + valid summary legible above dock) and `phase20f4/1920-failed-manager.png`
  (`Failed (stale) — CORNER_NO_SOLUTION` fully legible).
- Pixel-vs-assertion limits restated: Extract/Bake exact +1/Undo, reopened `2H:1V`/`3H:1V`
  edit-field literals, `disabled` attributes, and one-click sequencing are DOM-asserted by
  `tests-browser/cad-grading-20f3-qa.spec.ts`, not pixel-provable; screenshots judge only the
  claimed pixel-visible state. Image audit: 35 distinct SHA-256 digests, no duplicates;
dimensions 11×1366×768 + 11×1920×1080 + 11×2560×1440 originals + 1+1 replacements.

This closes the fix round recorded above: the FIRST REVIEW (REQUEST CHANGES) findings —
the 1920-failed-manager false PASS and the reopened-literal wording — were both corrected
(1920 replacement recaptured, literal-vs-pixel split qualified), the counts corrected 1→2,
and the reruns verified. Fix rounds by implementer: 0 after this review; reviewer edits: 0.

Verdict: **APPROVE** (no remaining screenshot failures except the two intentionally retained
historical originals, superseded for state coverage).
