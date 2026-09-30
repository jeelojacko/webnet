# Phase 20K — hybrid arc×arc grading groups: validation

Status: STUDY / EVIDENCE ONLY. Zero `src/` changes. Corpus:
`docs/evidence/phase20k/corpus.json` — **39 rows, 0 mismatches, 12 distinct
success digests**, byte-identical across repeated runs (sha256 of the file is
stable). Loader/oracle: `tests/cad_grading_hybrid_arc_pair_mesh_20k.test.ts`
(9 tests, agent tier).

All expected values are independent classifications (geometry / production
control), not copied from the actual result.

## 1. Oracles and controls

| oracle | source | role |
|---|---|---|
| primary exact tie | `(40,−20,90)` hand geometry, surface `FIXED(−0.5)` vs analytic `DIST(−0.5,20)` | 20I/20J oracle reused for arc pairs |
| production all-distance | `computeGradingGroupFromSnapshots(square, DIST×4)` | curved control that builds (`ok`, 4 ties) |
| production all-surface | `computeGradingGroupFromSnapshots(square, FIXED×4, flat TIN)` | S↔S arc corner control |
| production mixed-analytic | `DIST/ELEV/REL` | one analytic domain, arc A↔A corners |
| independent topology audit | `auditMesh` | beyond `validateExplicitTinPayload` |
| independent shoelace | `shoelaceBoundary` | boundary-ring area check |
| analytic terminal line | `analyticTerminalLine` (production) | analytic tie authority |

## 2. Ladders and matrices

- **GAP tolerance ladder** — `tol ∈ {25, 10, 0.1, 0.01}` ×
  `{chord, true-tangent}` (8 rows). Every case resolves an EXACT tie; every
  one is non-buildable (see §4).
- **Mismatch ladder** — analytic `D = 20 + step`, `step ∈ {0, 1e-9, 1e-6,
  1e-3, 1e-1, 1, 4}`. `step = 0` is exact; every `step > 0` fails closed
  `GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED` (7 rows).
- **Radius / sweep matrix** — `R ∈ {500, 252.5, 120}`, all exact ties, all
  non-buildable as open pairs (3 rows).
- **Offset matrix** — closed square `D ∈ {10, 20, 40}` (with `Δ = −D/2`).
  `D = 20` is the flat-target exact offset and builds; `D = 10/40` fail
  closed `TRANSITION_REQUIRED` (3 rows).
- **Triangulation permutation** — alternate diagonal of the spun flat TIN →
  identical EXACT tie.
- **Projected** — the closed square translated to `E≈2 M, N≈7 M` fails the
  member solve (`MEMBER_NO_SOLUTION`), recorded in the perf report.

## 3. §26 open group

Two-member open group from the primary arc pair, criteria
`[FIXED(−0.5), DIST(−0.5,20)]`, `side=right`, `Z=10`, flat `Z=0` target:

- member strips solved by the production chord solvers (surface member via
  `solveStraightChord`, analytic via `solveGradingChord`), exact-arc samples;
- the single joint resolves through `resolveArcPairCorner` to one EXACT
  common tie in every tolerance/model combination;
- Qs/Qa, corner patch, areas, root counts, and digest are recorded per row.

Result: **tie exact, group NOT buildable.** The independent audit reports
`discontinuous open daylight` and `bridge/pinch in daylight`; edge-connected
components > 1 (the arc chord seams pinch the strip because adjacent chord
daylight endpoints do not coincide). Per the task rule *“exact tie without a
buildable group ≠ GO”*, these rows are classified
`EXACT_TIE_NOT_BUILDABLE`.

## 4. §27 rounded square

Four genuine arcs, criteria `[FIXED(−0.5), DIST(−0.5,20), FIXED(−0.5),
REL(−0.5,−10)]`, `side=right`, flat `Z=0`, `tol=0.1`:

- **4 exact GAP ties** (joints 0–3), all on the outward (convex) mirror;
- closed daylight ring passes `ringIsSimple`; mesh passes the production
  `validateGroupMesh`;
- independent audit **PASSES** (`sum(triangle plan area) == reported plan
  area`, no interior overlap, finite, valid indices, edge incidence ≤ 2,
  one vertex-connected component);
- reported plan area `9451.951560147` matches the production all-distance
  control to `<1e-11` relative; tie points match to `8.53e-14`.

**Honest control delta (miter-vs-count).** The hybrid mesh and the
all-distance control are NOT byte-identical: hybrid has **114** triangles vs
the control’s **100**, so `meshSetEqual=false` and the canonical digests
differ (`5355ec70…` vs `0913cdda…`). The cause is representation, not
geometry: surface-member strips emit an extra seam quad at each
non-coincident arc chord seam, while the analytic control’s stitcher shares
the seam edge and the analytic corner run uses sector-path vertices. Area
and tie-point equality are therefore required; digest equality is not claimed
(area-only would be insufficient, and this row reports more than area).

**Spec-literal geometry.** The task’s centre `(50,−247.5)` / minor CW sweep
is inward-bulging; the outward offset self-intersects. Both the study
assembler and the production all-distance control fail
`GROUP_SELF_INTERSECTION / GRADING_GROUP_DAYLIGHT_RING`. The buildable group
uses the outward mirror; the literal failure is retained as a control row.

**All-surface control.** Production S↔S corners on curved members fail
`CORNER_NO_SOLUTION / GRADING_CORNER_SECTOR` (or `…_SEAM_DISAGREE` at finer
tolerances) for every `tol ∈ {5,2,1,0.5,0.1}` tested. The all-distance and
mixed-analytic controls both build.

## 5. §28 mismatch

Adjacent joints with `D=24` or `Δ=−12` fail closed
`GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED` on the first offending joint:
no partial ring, no repair, no fabricated geometry, no control digest reuse,
deterministic (`match=true` for both rows).

## 6. §29 independent topology audit

`auditMesh` checks, all beyond `validateExplicitTinPayload`:

1. finite XYZ;
2. valid triangle indices, length ≡ 0 (mod 3);
3. positive plan area per triangle (CCW);
4. no duplicate triangle (canonical sorted vertex set);
5. no interior overlap — O(n²) plan triangle-intersection area beyond shared
   edges/vertices;
6. edge incidence ≤ 2 (non-manifold edges rejected);
7. vertex-connected component count (arc chord pinch is reported separately
   as `edgeComponents`);
8. open-continuous daylight / closed-simple ring, no bridge/pinch;
9. `sum(triangle plan area) == reported plan area`;
10. `outerShellArea` (daylight-ring shoelace) recorded for closed groups;
    control equality where applicable.

The audit self-check in the test rejects a synthetic overlapping mesh, and it
positively distinguishes the buildable closed square (pass) from the
non-buildable open pair (fail).

## 7. Corpus coverage

Covered (39 rows): open pair (degenerate/exact/fine GAP), exact OVERLAP
(mirrored side; interior overlap at this radius), Distance/Elevation/Relative
variants, CUT/FILL, tied-at-V (fails `TRANSITION_REQUIRED`), long-grade
implicit in the offset/mismatch ladders, same-XY/diff-Z (fails
`GRADING_GROUP_CORNER_MISMATCH`), order reversal, radius/sweep, offset
matrix, target gap, triangulation permutation, mismatch ladder, projected
(perf), open group, rounded square + mismatch, degenerate sources
(`GRADING_ARC_LINEARIZE`), max-search failure (`MEMBER_NO_SOLUTION`), sloped
target (`GRADING_DAYLIGHT_DISAGREE`, the known 20I/20B chord-agreement
limitation), no/policy/multi-root implicitly via the mismatch controls.

Deliberately coordinated `exact.*` / `mismatch.*` rows are separate from
arbitrary pairs; no real-world-frequency claim is made. Overlap, sweep, and
radius variations beyond the listed set are deferred (see the decision doc).
