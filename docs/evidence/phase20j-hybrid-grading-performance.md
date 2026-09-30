# Phase 20J — hybrid grading-group performance

Status: FILLED (measurement only, production engine). Branch
`feat/cad-grading-hybrid-exact-common-tie`, HEAD `71eae6dd`.
Harness: `scripts/phase20jHybridGradingPerf.ts`
(`npx tsx scripts/phase20jHybridGradingPerf.ts [--quick]`).

Rules honored: fixture construction (chains, covers, criterion arrays,
arc plans, patch TIN) happens OUTSIDE the timed region; only the solve
is timed. No timing gate exists anywhere. Every figure is an actual run.

Run recorded below: full mode (4/20/100/1000 courses), exit 0, node
v26.8.1 linux x64, heap start 11.8 MB / end 81.6 MB. Figures are
single-run medians (7 repeats, 3 at 1000 courses); indicative, not a gate.

## Complexity expectation

| case | expected complexity |
|---|---|
| Surface-only control | O(courses) members + O(1) miter + candidate-triangle ray walk per surface chord |
| Analytic-only control | O(courses) + one O(1) line intersection per joint |
| hybrid alternating | half the surface ray-walks + one O(1) exact-common-tie per joint |
| closed square | 4 joints, each O(1) |
| arc joint | O(Σ per-course subdivisions) |
| determinism | 15 repeats, 1 digest |

## A. Open groups — Surface vs analytic vs mixed vs hybrid

| courses | surface ms | analytic ms | mixed ms | hybrid ms | hybrid/surface |
|---:|---:|---:|---:|---:|---:|
| 4 | 5.79 | 0.15 | 0.12 | 2.99 | 0.516x |
| 20 | 76.31 | 0.41 | 0.33 | 13.76 | 0.180x |
| 100 | 4618.99 | 1.48 | 1.12 | 416.00 | 0.090x |
| 1000 | 33323.00 | 10.01 | 9.50 | 3183.09 | 0.096x |

All variants solve ok with all corners exact at every scale
(999 corners at 1000 courses; 3507 verts / 3499 tris) and share one
digest per scale (`7b2f6262…`, `9b817220…`, `15cb6b89…`, `663d6f91…`).
Surface cost is dominated by the per-chord target ray-walk over the
cover grid (super-linear in grid density: 33 s at 1000 courses on a
~10k-vertex cover); analytic members stay ~10 µs/course; hybrid pays
only for its surface half (~3.2 s at 1000). No gate; reported only.

Honest fixture note: the first full run failed the 1000-course
surface/hybrid rows (`MEMBER_NO_SOLUTION`) because the cover-grid
builder could stop one step short of the bbox+margin edge, leaving the
far members' daylight rays over void. The builder now pins the far edge
explicitly; all rows solve. The engine correctly failed closed on an
uncovered target — no fabrication involved.

## B. Closed 100x100 hybrid square + controls

| variant | compute ms | plan area | outcome | digest |
|---|---:|---|---|---|
| hybrid | 0.72 | 9600.000 | ok | f7ea394f48c954d8 |
| surface | 4.28 | 9600.000 | ok | f7ea394f48c954d8 |
| analytic | 0.04 | 9600.000 | ok | f7ea394f48c954d8 |
| mixed | 0.04 | 9600.000 | ok | f7ea394f48c954d8 |

Digest equivalence: ALL MATCH. Closed hybrid 0.72 ms vs open
members-only 0.59 ms → four exact ties add ~0.13 ms (one O(1) corner
each). Dominant stage at this size is the member solve, not the corners.

## C. Joint outcomes

| case | solve ms | outcome | tie / detail | extent |
|---|---|---|---|---|
| GAP (surface x Rel) | 0.41 | ok | (40,−20,90) | 44.721360 = √2000 |
| OVERLAP (surface x Rel) | 0.47 | ok | (20,−20,90) | 44.721360 |
| mismatch D=24 | 0.63 | CORNER_NO_SOLUTION / TRANSITION_REQUIRED | fail-closed | — |
| root-policy (3 roots) | 0.12 | CORNER_NO_SOLUTION / ROOT_POLICY | fail-closed | — |

Failure joints reject before any patch geometry; cost is one seam-ray walk.

## D. Axis-aligned (Wave A path) vs 30°-rotated twin

| variant | compute ms | outcome |
|---|---:|---|
| axis-aligned | 1.41 | ok |
| rotated-30deg | 1.22 | CORNER_NO_SOLUTION / TRANSITION_REQUIRED (fail-closed) |

The rotated twin over the coarse axis-aligned cover fails closed rather
than mistie — contract-conformant (never fabricates). Rotation changes
which cover triangles the seam ray grazes; the exact-tie gate refuses
the degraded agreement.

## E. One-arc joint vs straight twin

| variant | tol 0.05 ms | tol 0.001 ms | accuracy |
|---|---|---|---|
| one-arc | 2.52 | 13.96 | CURVE_APPROXIMATED |
| straight | 0.48 | 0.43 | EXACT |

Cost scales with chord tolerance (subdivision count); the tie stays one
O(1) solve per chord joint. Digests stable per variant
(`3c7f1c42…`/`a46235c4…` arc, `77cc9b11…` straight).

## F. Determinism + dominant stage

15/15 repeats share one digest per case (`9b817220…` open,
`f7ea394f48c954d8` closed). Profiled 5 closed-square solves in 3.6 ms
(35 samples): other 0.60 ms, gridBuild 0.60 ms, targetIndexBuild
0.40 ms, engineGlue 0.15 ms — no single stage dominates; the solve is
sub-sampling-interval fast at pad scale.
