# Phase 20I — surface↔analytic grading corner: performance

Status: FILLED (measurement only, zero `src/` change). Branch
`research/phase20i-surface-analytic-corner-feasibility`, baseline
`9dd28c94715daa3583c907224a04652d3ae99cc3`.

Harness: `scripts/phase20iSurfaceAnalyticCornerPerf.ts`
(`npx tsx scripts/phase20iSurfaceAnalyticCornerPerf.ts [--quick]`).

Rules honored by the harness:

- Fixture construction (course chains, criteria arrays, target TINs, arc
  subdivision plans, corpus generation) happens **outside** the timed region;
  only the solve / mesh / validation calls are timed.
- **No timing threshold exists anywhere.** Every figure is an actual run.
- The harness dynamic-imports `scripts/phase20iSurfaceAnalyticCornerCore.ts`;
  with the module absent every candidate row prints `skip-TBD` and exit is 0.
- Candidate/root counts, solve time, mesh time, validation time, and
  cases/sec are reported per case.

Run recorded below: `--quick`, exit 0, node v26.8.1 linux x64, heap start
13.6 MB / end 48.4 MB, `core: adapter resolveSurfaceAnalyticCorner`.
Figures are single-run quick-mode medians (3 repeats per timed case for the
corpus/controls scale, 7 otherwise); they are indicative, not a gate.

## Complexity expectation

| case | expected complexity |
|---|---|
| Surface↔Surface control | O(courses) members + O(1) miter + candidate-triangle ray walk |
| Analytic↔Analytic control | O(courses) + one O(1) line intersection per joint |
| surface↔analytic candidate | one O(1) `M ∩ La` 2-D intersection + one affine target query per joint |
| closed square | 4 joints, each O(1) |
| arc ladder | O(Σ per-course subdivisions) |
| corpus batch | O(cases) independent solves |

## A. Controls — Surface↔Surface vs Analytic↔Analytic

| case | courses | solve ms | validate ms | verts | tris | corners | outcome | digest |
|---|---:|---:|---:|---:|---:|---:|---|---|
| surface closed square (fixed) | 4 | 7.25 | 0.02 | 28 | 28 | 4 | ok | 98c392aae3bdf938 |
| surface closed square (cut-fill) | 4 | 5.59 | 0.02 | 52 | 52 | 4 | ok | 158140f205344267 |
| analytic closed square (Distance) | 4 | 0.24 | 0.01 | 16 | 16 | 4 | ok | 610aab765f0878a8 |
| analytic closed square (D/E/Rel) | 4 | 0.15 | 0.01 | 16 | 16 | 4 | ok | 610aab765f0878a8 |
| analytic open staircase | 20 | 0.56 | 0.02 | 77 | 69 | 19 | ok | 552f3e4f16dd9a84 |

## B/C. Candidate — exact fixed ↔ analytic kinds + reversal

| case | solve ms | mesh verts | validate ms | roots | xy gap | z gap | turn | outcome |
|---|---:|---:|---:|---:|---:|---:|---|---|
| exact fixed/Relative | 0.7521 | — | — | 1 | 0.000000000 | 0.000000000 | GAP | EXACT_COMMON_TIE |
| exact fixed/Distance | 0.6048 | — | — | 1 | 0.000000000 | 0.000000000 | GAP | EXACT_COMMON_TIE |
| exact fixed/Elevation | 0.4930 | — | — | 1 | 0.000000000 | 0.000000000 | GAP | EXACT_COMMON_TIE |
| reversed (Relative/fixed) | 0.5600 | — | — | 1 | 0.000000000 | 0.000000000 | OVERLAP | EXACT_COMMON_TIE |

## D. Candidate — mismatch and target-gap fail-closed

| case | solve ms | outcome | detail |
|---|---:|---|---|
| residual mismatch (Δ=−12) | 0.2796 | TRANSITION_REQUIRED | xy gap 5.656854249, z gap 2.000000000 |
| target void | 0.1428 | SURFACE_TARGET_GAP | gap-at-V, roots 0 |
| parallel `M ∥ La` | 0.2653 | ANALYTIC_SEAM_PARALLEL | roots 1 |

## E. Candidate — GAP / OVERLAP prototypes and multi-root

| case | solve ms | mesh verts | validate ms | roots | xy gap | z gap | turn | outcome |
|---|---:|---:|---:|---:|---:|---:|---|---|
| GAP (outside turn) | 0.5732 | 4.0 | 0.0194 | 1 | 0.000000000 | 0.000000000 | GAP | EXACT_COMMON_TIE |
| OVERLAP (inside turn) | 1.1613 | 9.0 | 0.0030 | 1 | 0.000000000 | 0.000000000 | OVERLAP | EXACT_COMMON_TIE |
| multi-root (fine TIN) | 4.3598 | — | — | 1 | 0.000000000 | 0.000000000 | GAP | EXACT_COMMON_TIE |

Mesh assembly is inside the adapter solve (the adapter returns the assembled
mesh); `validate ms` times `validateGroupMesh` on that mesh separately.

## F. Candidate — triangulation variants, large coordinates, arc ladder

| case | solve ms | verts | tris | outcome |
|---|---:|---:|---:|---|
| triangulation A (coarse, 200 tris) | 0.8326 | — | — | EXACT_COMMON_TIE |
| triangulation B (fine, 2000 tris) | 4.7759 | — | — | EXACT_COMMON_TIE |
| large coords (E≈2M/N≈7M, coarse harness TIN) | 0.2631 | — | — | ROOT_POLICY_CONFLICT/analytic-matches-later-root |

The large-coords row uses the harness's coarse 200-triangle grid over a 300 m
window at N≈7.26e6; the candidate resolves a later surface root there and
correctly fails closed (`ROOT_POLICY_CONFLICT`). The study's dedicated
large-coordinate case uses a finer pinned TIN and is `EXACT_COMMON_TIE` with
offset 0 (validation §M); the harness row is a conditioning observation, not
a regression.

Arc ladder (25-segment quarter-arc linearization, both adjacent members arc
chords — this is the arc×arc stress configuration, **not** the validated §L
one-straight-member configuration). 24 joints:

| outcome | joints | note |
|---|---:|---|
| EXACT_COMMON_TIE | 7 (2,3,8,12,19,22,24) | solve 0.25–0.74 ms |
| SURFACE_BRANCH_DISCONTINUITY | 6 (1,14,15,16,20,23) | fail closed |
| ANALYTIC_LINE_INVALID/line-plane-disagree | 11 | fail closed |

No crash and no fabricated mesh; the arc×arc pattern shows the candidate is
only validated for arc chord on one side with a straight member on the other
(validation §L). Folded into the bounded arc risk in the decision record.

> The harness does not time a standalone closed hybrid square. Its mesh size
> is bounded by the §A closed-square controls (28/52 verts / tris); the
> per-corner cost is the same O(1) candidate solve measured above.

## G. Corpus batch (cases/sec, no threshold)

| corpus | cases | total ms | cases/sec | exact | transition | gap | parallel | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| quick | 200 | 63.51 | 3149.3 | 0 | 118 | 0 | 0 | 82 |

`exact = 0` because the seeded corpus randomizes the analytic criterion angle
so the fixed surface tie and the randomized analytic limit do not coincide;
the batch is a throughput/stability probe, not an exactness probe (exactness
is the 112-row study corpus, validation §O). `other` = 82 guard outcomes
(side/extent reject and branch discontinuities). Full mode runs 2000 cases.

## H. Deterministic repeats

| case | repeats | unique digests | first digest |
|---|---:|---:|---|
| exact fixed/Relative | 15 | 1 | d7f04bdfd80a9537 |
| exact fixed/Distance | 15 | 1 | d7f04bdfd80a9537 |

## Reading

- Candidate solve is `0.14–4.78 ms` per joint in quick mode; the fine TIN
  (10× the triangles) costs ~5.7× the coarse target, i.e. bounded by the
  target query, not super-linear in joints.
- Controls remain sub-8 ms; no candidate path is timed against a threshold.
- No timing gate is introduced by this study.
