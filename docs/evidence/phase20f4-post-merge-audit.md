# Phase 20F.4 Post-Merge Audit — live facts (2026-09-29)

## Merge state (fetch-verified this run)

- `origin/main` = `c444f0a79b34720f3592b67ddfc981215acedb48` (PR #133 merge).
- PR #132 "Phase 20F.3: grading shell command and visual evidence close-out":
  base `d3be99fc96626b0b91d12795759790975bfa55ea` (= PR #131 merge),
  head `91b2e0c4530f52d50011ab53e9687ae84c0976df`, merge `8753478bd6ac83ce140cbd71abc1eaef7322352f`,
  merged `2026-09-29T16:25:42Z`, state MERGED.
- CI on the PR132 head: run `36596624458` PASS (7m34s). CI on the merge push: run `36597639156` PASS.
- PR #133 "Update AGENTS.md memory routing to ctx_search": head `bca465d0`, merge `c444f0a7`,
  merged `2026-09-29T21:16:23Z`, state MERGED. CI runs `36632144539` / `36632157949` PASS.
- Drift note: PR133 landed on `main` after PR132 using the same branch name
  (`fix/phase20f3-grading-shell-evidence-closeout`). `origin/main` therefore advanced
  `8753478b` → `c444f0a7` with a non-20F.3 change (AGENTS.md memory routing only, no product code).
  20F.4 baseline `c444f0a7` includes that drift; product behavior is unaffected.

## Visual-gate contradiction

`docs/evidence/phase20f3-visual-qa.md` (pre-merge) verdicts all 33 frames PASS, including the
cross-cutting claims "NO CLIPPING" and "Cut/Fill visible unclipped" for
`1366-cutfill-defaults.png`. Those claims rested on objective DOM geometry (`geometry.json` box
containment + spec assertions), not pixels. The 20F.4 full 33/33 pixel review
(`docs/evidence/phase20f4-visual-qa.md`, source `/tmp/20f4-pixel-review.md`) finds that frame
**FAIL**: the create-form Criterion row and Cut/Fill ratio fields sit below the fold, occluded by
the Model/command dock at 1366x768 — `2:1`/`3:1` not legible. DOM "unclipped" (manager box inside
viewport) does not imply field-level pixel legibility when the form is internally scrolled.
Resolution: recaptured as `docs/evidence/phase20f4/1366-cutfill-defaults.png` (32 carry forward).

## Stale-doc findings (pre-merge docs, corrected in 20F.4)

- `phase20f3-browser-qa.md` Environment cites branch `@ 74bbf637` with "only uncommitted delta".
  `74bbf637` was an intermediate commit; the merged head is `91b2e0c4` (merge `8753478b`).
  Corrected by dated addendum in that file; full rerun recorded in `phase20f4-browser-qa.md`.
- `phase20f3-visual-qa.md` Method section discloses "objective, not eyeballed" draft status.
  That disclosure is now history: the 20F.4 33/33 eyeballed review supersedes the draft verdicts
  for pixel legibility (one FAIL, see above). Addendum appended at top; history not rewritten.
- `1366-failed-manager.png` / `2560-failed-manager.png` recapture note inside the old visual-qa
  is accurate (post-`91b2e0c4` frames) and stands.

## Verdict

**PRODUCT SOUND / DOCS INCOMPLETE-then-CLOSED**: grading-group shell, comparator contract, and
all 16 Chromium flows pass on the final HEAD (16/16, zero errors); the single visual-qa FAIL is a
framing defect in one evidence PNG, not a product defect — no `src/` change. Docs completed by the
20F.4 set: `phase20f4-visual-qa.md` (33/33 + replacement), `phase20f4-browser-qa.md` (final-HEAD
rerun), `phase20f4-independent-review.md` (placeholder, reviewer pending), and dated addenda on
both phase20f3 docs.
