# Phase 20J — hybrid grading groups: validation

Status: FILLED (production waves A/B/C1/C2 on branch
`feat/cad-grading-hybrid-exact-common-tie`, HEAD `71eae6dd`). Every number
below is a test/script run, not hand-entered. Oracles run through
`computeGradingGroupFromSnapshots` (no manual corner assembly) unless
noted.

## Oracle index (actual results)

| suite | cases | result |
|---|---|---|
| `tests/cad_grading_hybrid_corner_20j.test.ts` | 22 | green |
| `tests/cad_grading_hybrid_group_20j.test.ts` | 8 | green |
| `tests/cad_grading_hybrid_persistence_20j.test.ts` | 19 | green |
| `tests/cad_grading_hybrid_provenance_20j.test.ts` | 11 | green |
| `tests/cad_grading_hybrid_ui_20j.test.tsx` | 16 | green |
| `tests/cad_grading_surface_ray_interval_20j.test.ts` | 14 | green |

## Corner oracles (Wave B)

- Primary tie at `(40,−20,90)`, extent `√2000`, `Qs=(0,−20,90)`,
  `Qa=(40,0,90)`; fan plan `800`, 3D `859.5241580617239`.
- Distance / Elevation / Relative variants terminate at the same tie;
  order reversal mirrors to `(40,20,90)`; upward mirror ties at
  `(40,−20,110)`; CUT ties at `(40,−20,110)`, FILL at `(40,−20,90)`.
- Tied-at-V fails closed (no zero-extent corner); void target fails the
  member closed before any corner fallback.
- Mismatches (target z=92, analytic `Δ=−12`, analytic `D=24`) all fail
  `CORNER_NO_SOLUTION` / `GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`
  with no mesh.
- Root policy: 3-root patch TIN → `ROOT_POLICY` (nearest root kept, never
  re-picked); member-out-of-search → `MEMBER_NO_SOLUTION` with no corner
  fallback; thin disconnected target → `CORNER_TARGET_GAP` /
  `TARGET_GAP`.
- Large coords (`E≈2M/N≈7M`): tie and areas match within `1e-6`.
- One-arc joint solves `CURVE_APPROXIMATED` (tie within 0.5 m of the
  chord reference); arc×arc blocked `ARC_PAIR_UNSUPPORTED`.
- Determinism: repeats share one digest; mode authority derives
  surface/analytic/hybrid from effective criteria only.

## Group oracles (Wave B)

- Open two-course hybrid: GAP tie `(40,−20,90)`, plan area `4400`,
  `EXACT`, no interior overlap, deterministic.
- Closed 100×100 hybrid square: 4 GAP ties at 20√2 extents
  (`(120,−20,0)`, `(120,120,0)`, `(−20,120,0)`, `(−20,−20,0)`), ring plan
  `9600`, bounds `−20..120`, no interior overlap; mesh-identical
  (points, triangles, digest, areas, projection stats) to the
  all-Surface, all-Distance, and mixed-analytic controls — the only
  honest difference is the surface path's pre-existing `miterExtent`
  search-bound semantics.
- `D=24` mismatch fails `CORNER_NO_SOLUTION` /
  `GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED` at corner 0 with no
  partial mesh.
- OVERLAP group trims to the exact tie `(20,−20,90)` (retained exactly
  once, boundary within `1e-12`), no interior overlap, deterministic.

## Product engine (Wave C1)

- Persistence (19): cross-domain overrides round-trip; invalid records
  drop with a report; target-less surface-effective groups drop; schema
  v2, UNBUILT reopen, pinned key order; `ggrev1` target-in-when-any-
  surface-effective with homogeneous bytes identical.
- Provenance (11): `hybrid` + canonical `terminationKinds` legs
  (`hybrid:surface+distance…`); legacy/mixed-analytic legs byte-identical.

## UI shell (Wave C2)

- UI (16): `Hybrid` label with exact `Hybrid — Surface + Distance`
  detail; fully-overridden defaults never leak; target need derives from
  effective criteria; all five methods offered with no domain lock; exact
  common-tie warning with no calculability claim; explicit CURRENT target
  request on Surface edits; snapshot/Manager/Properties/Toolspace/report/
  CSV carry Hybrid + actual target + Grading Boundary; the seven group
  shell keys are byte-identical with no hybrid-specific command.

## Ray interval (Wave A)

- Ray (14): parallel-edge / grazing seam rays resolve to the
  nearest-outward root; axis-aligned geometry ties exactly.

## Performance (Wave C3, measured)

Harness `scripts/phase20jHybridGradingPerf.ts`; full figures in
`docs/evidence/phase20j-hybrid-grading-performance.md`. Quick-run
highlights: open hybrid groups solve at all of 4/20/100 courses with all
corners exact and digests shared across Surface/analytic/mixed/hybrid
variants at the same geometry; the closed hybrid square reports plan
`9600.000` with a digest identical to all three controls; GAP ties at
`44.721360`, OVERLAP at `44.721360`; mismatch and root-policy joints
fail closed in under 1 ms; one-arc solves `CURVE_APPROXIMATED` with cost
scaling by chord tolerance; 15/15 repeats share one digest per case.

## Full-gate status

Recorded in the Wave C3 commit message and the PR body: lint,
typecheck, `test:agent`, `test:wasm`, `parity:industry-reference`,
build, `check:portable-paths`, image audit, and the full-mesh topology
audit. Study-desktop 3 fails are known pre-existing (verified identical
on a clean-tree comparison; Study code untouched).

## Addendum — 2026-09-30 (Phase 20J merge + Phase 20J.1)

- Historical HEAD: `71eae6dd` (Wave C2 shell); Wave C3 evidence; reviewer
  fixes at `74629c40` (final PR #139 head).
- Phase 20J MERGED via PR #139: base `6842723c935ffdbe1461225f0ef97b7ccbceee52`,
  head `74629c40c7b017b2abb664bb7dbc152cc48d1ab1`, merge
  `ffa89282c8e15e41ab959726b9ab3bc4415422aa`; final-head CI run 36749390984,
  merge-push CI run 36750134664.
- Final-head reruns (baseline `ffa89282`): lint 0 errors (2 pre-existing
  warnings), typecheck clean, `test:agent` green with the same 3 pre-existing
  study-desktop fails, `test:wasm` 74/74, build clean.
- Phase 20J.1 (branch `fix/phase20j1-hybrid-persistence-tolerance`, baseline
  `ffa89282`): persistence defect (fully-overridden stored surface default
  dropped on reopen) + tie-tolerance hardening (quantity-specific
  single-world-scale X/Y/t/Z bounds, anchored target plane). Corrected
  tolerances and derivations: `coordinateAgreementTol` =
  32·eps·max(1,|a|,|b|,|coordinate|), `seamParameterAgreementTol`
  (single-quantum seam term), `elevationAgreementTol` (anchored-plane
  leverage), replacing the double-world-scaled `tieAgreementTol`. See
  `docs/evidence/phase20j1-hybrid-hardening.md` (§6–§14).
- Phase 20J.1 correction PR: #140 (head `397203c2`), open, DO NOT MERGE.
