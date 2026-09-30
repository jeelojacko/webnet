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

**NO_GO_GENERAL_ARC_PAIR_HYBRID + GO_CLOSED_EXACT_OFFSET_ONLY.**

- **GO (narrow).** A closed hybrid group over four genuine arcs with a
  single exact-offset, flat-target configuration (`FIXED(−0.5)` /
  `DIST(−0.5,20)` / `REL(−0.5,−10)`, outward convex rounded square,
  `tol=0.1`) resolves **4 exact common ties**, a **simple closed boundary**,
  a **mesh that passes the production validator**, and an **independent
  topology audit**. Its plan area matches the production all-distance
  control to `<1e-11` relative and its tie points to `8.53e-14`.
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

## §36 decision bullets

- **Support:** GO closed exact-offset only; NO-GO general arc×arc hybrid.
- **Tangent model:** insufficient alone; chord ≡ true-tangent for
  buildability; true-tangent is more physically faithful but needs the seam
  fix first.
- **Buildability:** the only audit-passing group is the closed rounded
  square (`pass`); all open/other groups are `EXACT_TIE_NOT_BUILDABLE` or
  fail closed.
- **Controls:** all-distance and mixed-analytic production controls build
  (`ok`, 4 ties); all-surface S↔S arc corners fail; no control digest is
  reused for a failing hybrid.
- **Mismatch:** `D=24` and `Δ=−12` fail closed on the first offending joint,
  no partial ring, deterministic.
- **Determinism:** corpus byte-identical across runs; one digest per
  distinct success; 12 success digests.
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
  overlap; radius/sweep coverage is three radii; no real-world-frequency
  claim; no DEM/elliptical arcs. Any productisation is a separate,
  routing-touching phase with its own reviewer gate. This branch never
  merges production behaviour.

## Incidental findings (not fixed)

- The arc chord-seam strip pinch also affects the shipped analytic arc path:
  production’s own closed all-distance arc square reports 8 edge-connected
  components under the independent audit (it still passes
  `validateExplicitTinPayload`). Recorded, not changed.
- The task-listed bottom-arc centre `(50,−247.5)` / minor CW sweep is
  inward-bulging and not gradable outward; the buildable mirror is
  `(50,+247.5)` / minor CCW. Documented in the architecture and validation
  docs and retained as a fail-closed corpus control.
