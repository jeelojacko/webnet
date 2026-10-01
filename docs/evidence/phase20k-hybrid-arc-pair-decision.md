# Phase 20K — hybrid arc×arc grading groups: decision record

Status: STUDY / EVIDENCE ONLY. Branch
`research/phase20k-hybrid-arc-pair-feasibility`, baseline
`e8bece3d0c05d12e9cc82e81a9c368fc92c41089` (PR #140 merge). Zero `src/`
changes. Nothing in this study is implemented; a genuine arc×arc hybrid
joint still fails closed in production.

Inputs: `phase20k-hybrid-arc-pair-architecture.md`,
`...-validation.md`, `...-performance.md`, `docs/evidence/phase20k/corpus.json`
(39 rows, 0 mismatches), `scripts/phase20kHybridArcPairGroups.ts`,
`scripts/phase20kHybridArcPairPerf.ts`,
`tests/cad_grading_hybrid_arc_pair_mesh_20k.test.ts`.

## Verdict 1 — ARC-PAIR support

**NO_GO_GENERAL_ARC_PAIR_HYBRID + NO_GO_CLOSED (vertex pinch).**
Overall: **NO_GO_TERMINAL_CHORD_ARC_PAIR** — no arc-pair hybrid group in
this study is buildable.

- **NOT-GO (closed).** The closed hybrid group over four genuine arcs
  with a single exact-offset, flat-target configuration (`FIXED(−0.5)` /
  `DIST(−0.5,20)` / `REL(−0.5,−10)`, outward convex rounded square,
  `tol=0.1`) resolves **4 exact common ties**, a **simple closed boundary**,
  and a **mesh that passes the production validator**. Its plan area
  matches the production all-distance control to `<1e-11` relative and its
  tie points to `8.53e-14`. It is nevertheless **NOT buildable**: the
  independent topology audit **FAILS** — the mesh has **8 edge-connected
  components** (vertex pinch at the arc chord seams; 130 boundary edges
  over 114 triangles). A vertex-pinched mesh is not a 2-manifold usable
  surface even though the production validator passes it (`validateGroupMesh`
  delegates to `validateExplicitTinPayload`, which passes this
  vertex-pinched/edge-disconnected mesh — edge connectivity is not enforced
  there). Per the pre-committed rule, an exact tie without a buildable
  group is not a GO.
- **NO-GO (general).** Every OPEN arc pair in the study resolves an exact
  tie but is **NOT buildable**: the independent audit finds discontinuous
  daylight and a vertex-pinched strip (edge-connected components > 1) at
  every tolerance and both frame models. Per the pre-committed rule, an
  exact tie without a buildable group is not a GO. Non-exact offsets
  (`D=10/40`) fail closed; the spec-literal concave geometry self-intersects
  (`GROUP_SELF_INTERSECTION`, production and study alike); production
  all-surface arc corners fail `GRADING_CORNER_SECTOR`; the projected
  million-metre case fails the member solve.

## Verdict 2 — tangent model (§6/§44)

**NEITHER_MODEL_IS_SUFFICIENT_ALONE.**

- Both the **chord** model (what shipped arc paths use) and the
  **true-tangent** model produce an exact common tie for the primary arc
  pair — the tie exists because `solveHybridCorner` is frame-driven, not
  because either frame is special.
- The model **does** matter numerically: at `tol=25` the chord-model open
  pair has plan area `4400.000` vs the true-tangent `4339.496`; at `tol=0.1`
  `4445.826` vs `4441.105`; they converge as the chord tolerance falls.
- The model does **not** change buildability: the open arc seam pinches
  under both. The blocker is the strip/merge topology at arc chord seams
  (adjacent chord daylight endpoints do not coincide), not the corner frame.
- Therefore a productisation must fix the **seam** (a seam-aware strip
  miter/re-stitch, or an explicit transition) before choosing a frame model.
  Swapping to true-tangent alone would not ship.
- Grade bookkeeping is honest: the chord frame carries the production
  terminal-chord grade (`ΔZ/|chord|`, R60 quarter-arc `0.0435520988` at
  `tol=10`); true-tangent keeps the arc-length grade (`0.0424413182`).

## §36 decision bullets

- **Support:** NO-GO general arc×arc hybrid AND NO-GO closed
  exact-offset (vertex pinch); overall NO_GO_TERMINAL_CHORD_ARC_PAIR.
- **Tangent model:** insufficient alone; chord ≡ true-tangent for
  buildability (both pinch); true-tangent is more physically faithful but
  needs the seam fix first.
- **Buildability:** NO group in the study is buildable. The closed
  rounded square resolves 4 exact ties but audit-fails (edgeComponents=8
  vertex pinch); all open/other groups are `EXACT_TIE_NOT_BUILDABLE` or
  fail closed.
- **Controls:** all-distance and mixed-analytic production controls return `ok` (4 ties) from production compute only; the independent edge-connected audit also fails the all-distance control (see incidental findings), so no independent-buildability claim is made for the controls; all-surface S↔S arc corners fail; no control digest is
  reused for a failing hybrid.
- **Mismatch:** `D=24` and `Δ=−12` fail closed on the first offending joint,
  no partial ring, deterministic.
- **Determinism:** corpus byte-identical across runs; one digest per
  distinct success; 13 success digests.
- **Performance:** no thresholds; hybrid closed square 1.69 ms / 4 joints,
  comparable to the analytic arc control (1.23 ms); solve dominates open
  cases, merge dominates the closed case; validation negligible; corpus
  39 rows ≈ 41 ms.
- **Seams (§33):** authoring/persistence/revision/resolve/provenance need no
  schema change; the only real seam is compute (`gradingGroupHybridCorners`)
  and it needs a seam-aware strip stitch, not just guard removal.
- **Diagnostics (§34):** existing `GRADING_SURFACE_ANALYTIC_*` is necessary
  but NOT sufficient; add `SEAM_MITER_REQUIRED` (and informational
  `SEAM_PINCH`) before any arc-pair route.
- **Restrictions / future work:** OVERLAP at the study radius shows interior
  overlap; radius/sweep coverage is three radii (honest endpoint-anchored);
  offset-radius rows are symbolic-only (the resolver never runs on a shifted
  radius — the joint would leave V); nearest-vs-later root policy is untested
  on the arc path; no real-world-frequency
  claim; no DEM/elliptical arcs. Any productisation is a separate,
  routing-touching phase with its own reviewer gate. This branch never
  merges production behaviour.

## Incidental findings (not fixed)

- The arc chord-seam strip pinch also affects the shipped analytic arc path:
  production’s own closed all-distance arc square reports 8 edge-connected
  components under the independent audit (it still passes
  `validateExplicitTinPayload`). The closed square is the sharpest case:
  exact ties, simple ring, production-validator pass — yet 8
  edge-components. Recorded, not changed.
- The task-listed bottom-arc centre `(50,−247.5)` / minor CW sweep is
  inward-bulging and not gradable outward; the study mirror is
  `(50,+247.5)` / minor CCW (exact ties, still not buildable — vertex
  pinch). Documented in the architecture and validation
  docs and retained as a fail-closed corpus control.

## Addendum 20K.1 — audit-correction regen (2026-09-30, Wave A1)

Branch `fix/phase20k1-curved-grading-seam-topology`. The original §29 audit
used a raw-float `o1 !== o2 && o3 !== o4` segment test; the corrected
predicate (robust `-1/0/+1` orientations on the shared `zeroDelta` floor,
collinear overlap/touch counting for non-adjacent pairs, adjacent-pair
skip, closed-ring collinear sweep) is strictly stronger. Regen result:
**39 rows, 0 mismatches — every original verdict stands as recorded above
(erratum preserved, not rewritten); the only corpus delta is additive
`detail` (open-group index-vs-geometric diagnostic) on previously
detail-less open rows.**

Open-group diagnostic (from corpus `detail`): `tol-25/10` strips report
`edgeComponents=2`, no duplicates, no coincident sets, weld a no-op
(`2 → 2`); finer-tolerance and corner rows report `edgeComponents=3` with
0–3 zeroDelta-coincident sets and 0–2 degenerate-after-weld triangles, and
the weld heals nothing except `corner.reversed` (`3 → 2`). The seam pinch
is therefore geometric, not indexical. Verdicts unchanged:
**NO_GO_TERMINAL_CHORD_ARC_PAIR** holds. No gate, no seam assembly, no
`src/` change.

## Addendum 20K.1 — PR #141 merged + production-line record (2026-10-01, Wave D1)

PR #141 merged the Phase 20K study branch (base `e8bece3d`, head
`c03617b8`, merge `35b4c27`; CI runs 36788493770 + 36790303544). History
above is preserved as erratum, not rewritten.

Corrected audit predicate (Wave A1, robust zeroDelta orientations) +
regenerated verdicts: 39 corpus rows, 0 mismatches — every 20K verdict
stands. Direct production all-Distance closed square (Wave A2, actual
`computeGradingGroupFromSnapshots`): was study-assembler VERTEX_PINCH
with 8 edge-components → after Wave C1 analytic seam assembly the same
group resolves CURRENT 128/128, 1 component, plan 9452.124826335.
Study-vs-production distinction: the study assembler never stitched
internal chord seams (each chord an isolated strip), so its 8-component
pinch does not transfer to production; the production blocker the study
identified (chord-seam strip/merge topology) was real and is now fixed
for analytic + Surface paths. arc×arc hybrid remains blocked
(`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`); `NO_GO_TERMINAL_CHORD_ARC_PAIR`
for general arc pairs is retained. 20K.1 evidence:
`phase20k1-curved-seam-{architecture,validation,performance}.md`,
`phase20k1-browser-qa.md`, `phase20k1-curved-seam-post-merge-audit.md`.
