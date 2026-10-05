# Phase 20Q.1 — Validation: full gate record

Branch `feat/phase20q1-sloped-source-transitions`, baseline `main` `784b28e8`
(PR #167 merge). All results below were measured on this uncommitted working
tree on 2026-10-05. 14 stashes preserved.

## Focused suites

| Suite group | Files / tests | Result |
|-------------|---------------|--------|
| 20Q.1 new (robust + sloped + sloped-plural + reviewfix) | 4 files / 205 | ✅ 205/205 |
| 20Q study freeze (sloped + step + boundary) | 3 files / 70 | ✅ 70/70 |
| Transition neighbors (all `cad_grading_transition*`) | 30 files / 660 | ✅ 660/660 |
| `cad_grading` (full) | 118 files / 1984 | ✅ 1984/1984 |

Notes: the 20Q.1 count is the four new `.test.ts` files (robust + sloped +
sloped-plural + reviewfix); the modified mesh/panel/study suites are counted
in the transition-neighbor row. The study freeze
pins were updated to the admitted truth; `docs/evidence/phase20q/corpus.json`
stays **byte-frozen** (not modified by this branch).

## Review-fix record (2026-10-05)

| Item | Finding | Fix | Pin |
|------|---------|-----|-----|
| BLOCKER | transitioned groups quantized source Z, so a sub-nm flat→sloped edit kept a cached CURRENT | `exactZ` (`hasTransitionIntent`) hashes source startZ/endZ at full precision; no-transition groups keep the 1 nm quantizer byte-identical | `cad_grading_transition_reviewfix_20q1.test.ts` |
| MAJOR | worker accepted a re-anchored cut-source/daylight pair that passed every legacy law/native/anchor check | worker mesh gate compares result-owned cut/joint source XYZ against authoritative member geometry, fails closed `GRADING_AGREEMENT_TRANSITION_GEOMETRY` | same file |
| MINOR | browser captures showed the CREATE form above the row table | 12 PNGs re-exported; form collapsed, status/notices framed | `browser-qa.md` |

Review-fix suite `cad_grading_transition_reviewfix_20q1.test.ts` **4/4** green;
20Q.1 focused total now **205/205** (4 files). Typecheck and lint clean after
the fix.

## Full gates

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ clean |
| Lint | `npm run lint` | ✅ 0 errors, 2 pre-existing warnings |
| Build | `npm run build` | ✅ clean, 9.99 s |
| Portable paths | `npm run check:portable-paths` | ✅ 5801 paths, 0 violations |
| WASM tier | `npm run test:wasm` | ✅ 12 files / 74 tests |
| Parity | `npm run parity:industry-reference` | ✅ 1 file / 25 tests |
| Agent tier | `npm run test:agent` | ⚠️ 933 passed files, **8449 pass, 1 skipped, 3 failed** |

## Pre-existing failures (not caused by 20Q.1)

The 3 agent-tier failures are the `study-desktop/` calibration trio, which
fail identically on the clean baseline (documented since Phase 20N.1; this
branch touches zero `study-desktop/` files):

- `study_ai_unit_calibration`
- `study_ai_unit_calibration_v5` — `sourcePackageId
  "nb-sit-statute-corpus-2026-08-29"` vs expected `...-09-11`
- `study_ai_unit_preflight`

They are carried, not fixed here. Agent totals: 936 files
(933 passed, 3 failed), 8453 tests (8449 passed, 1 skipped, 3 failed).

## Scoping boundary pinned

Elevation at ±15% / ±50% slope fails at the pre-existing member-plane gate
(`MEMBER_NO_SOLUTION`) before transition tiling; admission owns the sloped
transition scope, the member solver owns plane feasibility. Pinned by
`cad_grading_transition_robust_20q1.test.ts` (`family === 'elevation'`,
`steep` rows). No relaxation here.

## Browser

Wave L's `docs/evidence/phase20q1/browser-qa.md` has landed (3/3 green,
0 page/console errors); its 12 PNG captures were re-framed in the review-fix
(CREATE form collapsed, status/notices framed). No browser flows were run or
claimed by this validation wave itself.

## Contract checks

- `src/` is modified by the Waves B–E+J implementation plus the review-fix
  (see `architecture.md`); no persistence / law / threshold file appears in
  the diff.
- No new law / tolerance / schema / default: verified by diff
  (`git diff --name-only` contains no persistence/legal/threshold files).
- 14 stashes intact (`git stash list` = 14).
- Determinism: `perf-output.txt` asserts identical repeated-solve digests and
  worker gates for every row.

## What this is not

- **A browser certification by this wave**: browser evidence is Wave L's
  (landed, see above), not authored here.
- **A green agent tier**: three pre-existing study-desktop failures remain.
- **A release certification**: `test:release` / `test:evidence` were not run
  (not required for this doc-only completion wave).
