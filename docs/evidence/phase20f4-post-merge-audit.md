# Phase 20F.4 Post-Merge Audit — live facts (2026-09-29, updated 20F.5)

## Merge state (fetch-verified)

- `origin/main` = `699e9ff9c76d05395e4c3d82514490da57cf363e` (PR #134 merge, 2026-09-29T22:08:36Z).
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
- PR #134 "Phase 20F.4: finalize grading visual evidence and merge-state documentation":
  base `c444f0a7`, head `3c380dca29b3a423f0941ddd9fa56d4bf57b9733`, merge `699e9ff9`,
  merged `2026-09-29T22:08:36Z`, state MERGED. CI on the PR head: run `36636317410` PASS
  (8m30s). Scope: 10 files, zero `src/` (docs + 2 evidence PNGs only).

## Visual-gate contradiction

`docs/evidence/phase20f3-visual-qa.md` (pre-merge) verdicts all 33 frames PASS, including the
cross-cutting claims "NO CLIPPING" and "Cut/Fill visible unclipped" for
`1366-cutfill-defaults.png`. Those claims rested on objective DOM geometry (`geometry.json` box
containment + spec assertions), not pixels. The 20F.4 full 33/33 pixel review
(`docs/evidence/phase20f4-visual-qa.md`, source `/tmp/20f4-pixel-review.md`) finally finds two frames
**FAIL**: the create-form Criterion row and Cut/Fill ratio fields sit below the fold, occluded by
the Model/command dock at 1366x768 — `2:1`/`3:1` not legible (found in the first review); plus
`1920-failed-manager.png`, which shows the pre-recalc criteria-override moment with the settled
FAILED row out of frame — falsely PASSED in the first draft, caught in the independent-review fix
round. DOM "unclipped" (manager box inside
viewport) does not imply field-level pixel legibility when the form is internally scrolled.
Resolution: recaptured as `docs/evidence/phase20f4/1366-cutfill-defaults.png` and
`docs/evidence/phase20f4/1920-failed-manager.png` (31 carry forward + 2 replacements).

## Stale-doc findings (pre-merge docs, corrected in 20F.4)

- `phase20f3-browser-qa.md` Environment cites branch `@ 74bbf637` with "only uncommitted delta".
  `74bbf637` was an intermediate commit; the merged head is `91b2e0c4` (merge `8753478b`).
  Corrected by dated addendum in that file; full rerun recorded in `phase20f4-browser-qa.md`.
- `phase20f3-visual-qa.md` Method section discloses "objective, not eyeballed" draft status.
  That disclosure is now history: the 20F.4 33/33 eyeballed review supersedes the draft verdicts
  for pixel legibility (two FAILs, see above). Addendum appended at top; history not rewritten.
- `1366-failed-manager.png` / `2560-failed-manager.png` recapture note inside the old visual-qa
  is accurate (post-`91b2e0c4` frames) and stands.

## Verdict

**PRODUCT SOUND / EVIDENCE RECORD CLOSED**: grading-group shell, comparator contract, and
all 16 Chromium flows pass on the merged HEAD `699e9ff9` (fresh 20F.5 rerun: 16/16, zero
errors; see `phase20f4-browser-qa.md`); the two visual-qa FAILs are framing defects in two
evidence PNGs, not product defects — no `src/` change. The 20F.5 fresh re-review
(`phase20f4-independent-review.md`) APPROVES: 35/35 examined = 33/33 states passing
(31 carried originals + 2 replacements). Live `main` is `699e9ff9`; no re-review is pending.
