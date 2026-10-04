# Phase 20N.1 — Validation (Wave L): full regression

## Suite table (all green 2026-10-04, branch `feat/phase20n1-multiple-collinear-transitions`)

| Suite group | Files / tests | Result |
|-------------|---------------|--------|
| 20N.1 new (group 9 + plural 5 + authoring 10 + separation 14 + multi 3 + panel 5 + robust boundary cases) | 7 files / 100 | ✅ 100/100 |
| 20M.2 transition (mesh, persist, editor, policy, product, robust, topology, worker) | 8 files / 55 | ✅ 55/55 |
| 20N study + 20M feasibility (expansion ×2, feasibility) | 3 files / 61 | ✅ 61/61 |
| `test:agent` full | 925 files / 8023 | ✅ 8019 pass, 1 skipped, 3 pre-existing fails (below) |
| Browser 20N.1 (Wave I) | 12 flows | ✅ 12/12, 0 page/console errors |
| Browser 20M.2 (Wave L re-verified) | Flow g single-transition | ✅ CURRENT (see pin note) |

## Gates

- `typecheck`: clean. `lint`: 0 errors (2 pre-existing warnings).
- `build`: clean (10.07 s). `check:portable-paths`: 5724 paths, 0 violations.
- `npm audit` + `npm audit --omit=dev`: 0 vulnerabilities.

## Superseded 20M.2 Flow-g pin (Wave L commit `c1b599d2`)

The old 20M.2 pin asserted the Add button is *gone* while one transition is
staged (single-transition cap). 20N.1 per-joint authoring intentionally keeps
Add/Update visible so further strictly-separated transitions can stage; the
pin now asserts a staged joint offers "Update transition", and the single
staged transition still solves CURRENT. One-transition behavior is otherwise
byte-identical (legacy route).

## Pre-existing failures (not caused by 20N.1)

3 `study-desktop` calibration suites fail identically on the clean baseline
(proven via stash during Wave E/J): `study_ai_unit_calibration`,
`study_ai_unit_calibration_v5`, `study_ai_unit_preflight`. Carried, not fixed
here.

## What this is not

- **20N study validation**: study runs (39 pins, corpus SHA) are recorded on
  the 20N decision branch, not here; the 61 study/feasibility tests above
  are the production-tree neighbors confirming no regression.
- **Candidate B**: no validation exists for non-collinear admission —
  correctly, since no such code shipped.
