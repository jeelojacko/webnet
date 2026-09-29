# Phase 20F.5 Reviewer-Record Closeout — authoritative summary

Baseline: `699e9ff9c76d05395e4c3d82514490da57cf363e` (= live `origin/main`, PR #134 merge).
Branch: `fix/phase20f5-review-record-merge-state`. No `src/`, `cpp/`, `tests/`,
`tests-browser/`, or `package` changes in this phase — docs only.

## PR table (PRs 132–134)

| PR | Subject | Head | Merge | Merged at | State |
|----|---------|------|-------|-----------|-------|
| #132 | Phase 20F.3: grading shell command and visual evidence close-out | `91b2e0c4` | `8753478b` | 2026-09-29T16:25:42Z | MERGED |
| #133 | Update AGENTS.md memory routing to ctx_search (non-20F drift) | `bca465d0` | `c444f0a7` | 2026-09-29T21:16:23Z | MERGED |
| #134 | Phase 20F.4: finalize grading visual evidence and merge-state documentation | `3c380dca` | `699e9ff9` | 2026-09-29T22:08:36Z | MERGED |

PR #134 scope: 10 files, zero `src/` (docs + 2 evidence PNGs). CI on the PR head:
run `36636317410` PASS (8m30s).

## Contradiction found and corrected

`docs/evidence/phase20f3-visual-qa.md` (objective DOM-geometry draft) verdict all 33 PASS;
the 20F.4 full pixel review found TWO framing FAILs instead (failed originals kept FAIL,
history preserved): `phase20f3/1366-cutfill-defaults.png` (Criterion + ratios occluded by
the dock) and `phase20f3/1920-failed-manager.png` (pre-recalc moment, settled FAILED row out
of frame — falsely PASSED in the first draft, caught by independent review). The reopened
`2H:1V`/`3H:1V` edit-field literals are DOM-asserted, not pixel-legible; docs now state this
plainly. Files corrected in 20F.5: `phase20f4-independent-review.md` (fresh re-review section),
`phase20f4-post-merge-audit.md` (PR134 MERGED facts, single CLOSED verdict),
`phase20f4-browser-qa.md` (fresh `699e9ff9` rerun), `TODO.md`, `docs/CURRENT_BEHAVIOR.md`,
plus this closeout record.

## 35/35 summary (detail: `phase20f4-visual-qa.md`, `phase20f4-independent-review.md`)

35/35 examined = 33/33 required states PASS: 31 carried originals PASS + 2 originals FAIL
(intentionally retained) + 2/2 replacements PASS. Per resolution: 1366 10/1 + 1 replacement;
1920 10/1 + 1 replacement; 2560 11/0 + 0 replacements. 35 distinct SHA-256 digests, no
duplicates; dimensions 11×1366×768 + 11×1920×1080 + 11×2560×1440 + 1+1 replacements.
Representative digests: 1366 failed `e1e33b0a…` / replacement `61271b8d…`; 1920 failed
`3d5acc12…` / replacement `2e3e2ba1…`. Reviewer verdict: **APPROVE** (reviewer-20f5-fresh35,
tree `699e9ff9`).

## Browser execution (detail: `phase20f4-browser-qa.md`)

Execution SHA `699e9ff9`; fresh build 11.22 s, entry `dist/assets/index-BFrZan0G.js`
sha256 `01fa028de567c7f7bb7acc2889b63242cc86f28b85c365cee093f4e631de8215`, served via
`vite preview` byte-identical; Playwright 1.60.0, Chromium 148.0.7778.96;
**16/16 in 25.1 s, zero page/console/unhandled errors**; evidence restored byte-for-byte;
lint exit 0 (2 pre-existing warnings), typecheck exit 0.

## Actions state and verdict

- Actions: CI run `36636317410` on the PR134 head PASS; merge push `699e9ff9` is live `main`.
- No `src/`/test changes in 20F.4 or 20F.5 — visual-record correction only; no new product-code
  defect found.
- Phase 20F verdict: **PRODUCT SOUND / EVIDENCE RECORD CLOSED**.
- Next: Phase 20G (not started; Relative Elevation and the other 20F.2 restrictions remain
  deferred, fail-closed).
