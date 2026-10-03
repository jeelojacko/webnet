# Phase 20M.2 validation record

Predicate under test (frozen): OPEN line-only one-transition `trp1`, stable joint/member refs via
`courseCriterionKey`, both flat, exact joint Z, same side, same target-free family
(Distance / RelativeElevation / flat Elevation), exact `gL === gR`, exact collinearity 0, explicit W
finite with `0 < W <= 2*min(LL,LR)` exact, interval `[-W/2, +W/2]`, `TRANSITION_LINEAR_V1`
(`v(s) = vL + (vR-vL)*t`), natives independently resolve ok. All exclusions fail closed (Surface, hybrid,
roots, extension, arcs, closed, sloped, joint-step, mixed, non-collinear, second, unsupported).
Malformed/stale intent FAILS CLOSED, never fallback. Old files legacy-identical. `>1` rejects.

## Focused suites — 48/48 green across 8 files

| File | Tests |
| --- | --- |
| `tests/cad_grading_transition_policy_20m2.test.ts` | 10 (predicate admit/reject ladder) |
| `tests/cad_grading_transition_persist_20m2.test.ts` | 7 (intents, sanitation, revision) |
| `tests/cad_grading_transition_topology_20m2.test.ts` | 7 (`deriveTransitionExpectation`, pre-mesh fails, legacy identical) |
| `tests/cad_grading_transition_worker_20m2.test.ts` | 5 (plan, agreement/vertex validators, pre-solve gate, real kernel solve) |
| `tests/cad_grading_transition_mesh_20m2.test.ts` | 5 (C0 geometry, no C1) |
| `tests/cad_grading_transition_product_20m2.test.ts` | 3 (provenance builder/gate/citation, bake/extract Undo/Redo) |
| `tests/cad_grading_transition_editor_20m2.test.ts` | 4 (authoring, GROUP_SET/CLEAR, panel) |
| `tests/cad_grading_transition_robust_20m2.test.ts` | 7 (Wave J: transforms, boundaries, extremes, determinism) |
| Browser `tests-browser/cad-grading-transition-20m2.spec.ts` | 10/10 flows A–J, 0 errors (see below) |

## Wave K regression / parity

- `tests/cad_grading*`: 1247/1248 — the single failure is the superseded 20M.1 tree-clean pin, failing
  BY DESIGN (the tree is no longer clean: production transition code now exists where 20M.1 pinned zero `src/`).
- `npm run test:agent`: 7751 pass + 4 known fails (3 pre-existing study-desktop, 1 tree-clean-by-design).
- `npm run test:wasm`: 74/74. `npm run parity:industry-reference`: 25/25. Build 11.39 s.
- `npm run check:portable-paths`: 0 violations.

## Browser flows A–J — 10/10, 0 page/console errors

A Distance CURRENT, B RelativeElevation CURRENT, C flat-Elevation CURRENT (mesh proof SURVIVED — no narrowing),
D width-40 (exact max) CURRENT, E width-41 FAILED, F bent FAILED, G single-transition (add absent while one
staged; single intent CURRENT), H save/reopen persists (joint:0, 8 m; recalc CURRENT),
I removal → FAILED `CORNER_NO_SOLUTION` (legacy gap) / width re-add → CURRENT / grade 50→75% override → FAILED /
reset → CURRENT, J extract+bake gated ok / Design Patch disabled for the open route.
Single-viewport limitation: 1366×768 only. Evidence: `browser-qa.md` + 13 PNGs + `geometry.json`.

## Robustness / perf (Wave J)

Translations 1e6/1e8 dev 0; mirror exact; reversal pinned; width 40 admits / 40.000001 rejects / asymmetric
20 admits / 20.5 rejects; scalars 1e-6/20/40 finite + oriented, 1e6 beyond maxSearch fails
`MEMBER_NO_SOLUTION`, NaN/Inf fail closed; 3× repeat bit-identical.
Perf (`scripts/measureTransition20m2.ts`, measurement-only, n=200): legacy median 0.125 ms,
admitted-transition median 0.137 ms — ratio 1.10× (machine-local, correctness first).

## Law

Legislated law: explicit user width + `TRANSITION_LINEAR_V1`. One-transition-only. No C1 claim.
Flat-Elevation mesh proof survived — no narrowing from 20M.1.
