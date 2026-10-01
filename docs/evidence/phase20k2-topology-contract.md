# Phase 20K.2 — topology contract

Status: **IMPLEMENTATION COMPLETE (uncommitted on branch
`fix/phase20k2-curved-topology-product-closeout`, baseline `fbac7c88` =
PR #142 merge)**. This document describes the shipped topology contract that
every grading mesh must satisfy before a product (Extract/Bake/Design Patch)
may consume it. It records the contract as implemented, not a plan.

## 1. What is validated, and by whom

`validateGradingMeshTopology(points, triangles, opts)` in
`src/engine/cad/grading/gradingTopology.ts` is the single production
authority. It is called:

- inside `solveArcGrading` (standalone source), gated as
  `NO_SOLUTION` + `<PINCH|NON_MANIFOLD>: detail`;
- inside `computeGradingGroupFromSnapshots` (merged group mesh), gated as
  `GROUP_NON_MANIFOLD` / revision `FAILED` with no partial result;
- again at product time through the certificate revalidator (section 5).

## 2. The validity ladder (production, bounded)

Per **face**:

| Check | Failure |
|---|---|
| finite integer indices in range | `NON_MANIFOLD` `bad index` |
| de-duplicated face (canonical vertex set) | `NON_MANIFOLD` `duplicate face` |
| non-degenerate plan double-area (`=== 0`) | `NON_MANIFOLD` `zero-area face` |
| **positive** signed plan area (`=== 0` and `< 0` both fail; must be `> 0`) | `NON_MANIFOLD` `negative-area face` |

Per **edge** (incidence map over the faces):

- incidence `> 2` is non-manifold and fails;
- incidence `== 2` is interior; incidence `== 1` is a boundary edge.

Per **boundary**:

- `traceBoundaryCycles` (graph level) requires every boundary vertex to have
  degree exactly 2 and traverses each edge exactly once back to the start
  with `>= 3` distinct vertices. Degree-1 (open end), degree-3+ (branch),
  degree-4 (pinch), figure-eight reuse, unused edges, and non-closing walks
  are violations, not cycles — the mesh fails `PINCH`
  (`boundary not simple cycles: …`).
- `collapseMicroEdges` removes consecutive arithmetic-duplicate boundary
  micro-edges before the geometric scan (see the 1 nm floor, section 4).
- `checkBoundaryGeometry` rejects, **in boundary size only**, zero-plan-length
  edges, non-adjacent segment crossings, repeated non-closing vertices,
  collinear overlap, same-cycle self-touch, and inter-cycle crossings/touches.

Per **component budget** (`opts.expectedComponents`):

- every edge-connected component beyond the expected count must contain a
  declared tied station or a vertex within `zeroDelta` of a recorded tied
  coordinate; unattributed extras fail closed.

The geometric boundary scan is `O(B^2)` in the number of boundary edges, never
`O(F^2)` over faces. The non-adjacent **face**-overlap audit (the independent
`O(F^2)` oracle) stays a test-only evidence tool
(`tests/cad_grading_topology_cycles_20k2.test.ts`) and is deliberately not on
the production path.

## 3. `components` ≠ `cycles` — the three distinct counts

The result shape now carries three separate numbers, and conflating them is
the exact error Phase 20K.2 corrects:

| Field | Meaning | Example |
|---|---|---|
| `components` | edge-connected **face** components of the whole mesh | all-Distance square `1`; tied-split arc `2` |
| `boundaryCycles` | traversed simple **boundary cycles** (new authority) | all-Distance square `2` (outer ring + interior hole); tied arc `2` |
| `loops` (deprecated) | boundary-edge **graph connected components** — the old semantics, kept only for compatibility | same value as `boundaryCycles` only when every component is one simple cycle |

Consequences made explicit rather than hidden:

- A valid **annulus** mesh (the rounded-square grading shell) has
  `components = 1` but `boundaryCycles = 2`. The old `loops` count could read
  either number depending on how it was computed; the new contract separates
  them and `expectedBoundaryLoops` is now validated against `boundaryCycles`.
- A **tied split** mesh has `components = 2` and `boundaryCycles = 2`; it is
  legitimate only when the second component is attributed to a real tied
  station (section 2). Components are not cycles, and neither is the
  zeroDelta-coincident "weld" diagnostics: the weld is informational and never
  repairs a mesh (Phase 20K.1 Wave A2 finding, retained).
- The Phase 20K.1 "boundary loops = 1" on the curved squares was a
  boundary-graph component count, not a real cycle confession. The real trace
  is what rejects a self-touching / branching boundary.

All three counts are visible on the certificate and in the grid/group
results, so a downstream reader never has to infer which number it holds.

## 4. The 1 nm agreement floor — an explicit bound

`AGREEMENT_FLOOR = 1e-9` m (`gradingGroupSectors.ts`) is the **agreement
bound** used by the two representation-sensitive authorities:

- `dupTol` in `gradingTopology.ts` (boundary micro-edge collapse): the pure
  ULP term under-measures a seam station recomputed as `start + t·length`
  (measured ~5e-13 vs a ~4.5e-13 ULP sum in the 20J hybrid seam), so the
  shared representation floor is added. At `|100|` the two-sided tolerance is
  ~1.4e-12 m — nine orders below any mm-scale feature.
- `sameRepresentationStation` in `designPatchRing.ts` (ring simplicity): two
  vertices are the same physical station when plan XY and Z agree within the
  shared `coordinateAgreementTol` / `elevationAgreementTol` contract plus this
  floor.

This is a representation-noise bound, not a geometry tolerance: nothing is
moved, averaged, projected, or welded by it. The global `zeroDelta`
classification floor is untouched, and the mismatch ladder is pinned in
`tests/cad_grading_cutfill_seam_target_20k2.test.ts` (0, 1e-12, 1e-9 accepted;
1e-8, 1e-6, 1e-3 rejected).

## 5. Certificate `gtop1`

`buildGradingTopologyCertificate` produces the session-only record of the
final assembled mesh (`src/engine/cad/grading/gradingTopologyCertificate.ts`):
`version`, `scope`, `meshDigest`, `components`, `boundaryCycles`,
`boundaryEdges`, `tiedSplitCoords`, `positiveWidthRegionCount`,
`sourceBoundaryDigest`, `gradingBoundaryDigest`. It is:

- produced only after final assembly, from the authoritative buffers;
- never persisted and never folded into `grev1:` / `ggrev1:`;
- revalidated at product time by `gradingTopologyCertificateError` (missing /
  scope / digest / topology / boundary-edge / boundary-cycle mismatches) and
  `gradingTopologyCertificateProductError` (adds the multi-region bound).

A missing, stale, forged, or mismatched certificate fails closed (null
command, zero mutation). Empty meshes need no certificate.

## 6. What remains blocked

- **arc×arc hybrid joints**: still fail
  `GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED` (Phase 20K verdict
  `NO_GO_TERMINAL_CHORD_ARC_PAIR` unchanged).
- **transition-less surface+analytic mixing**: still fails
  `GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`; the only admitted
  surface↔analytic joint is the gated exact-common-tie path.
- **CUT/FILL direct fan without target proof**: the cross-grade fallback now
  requires `directFanOnTarget` (a genuine cut/fill criterion, `V` on the
  target, and the whole `qIn→V→qOut` fan covered by one proven target plane).
  Ridges, valleys, voids, steps/branches, off-target `V`, and non-cut/fill
  criteria fail closed `GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`. This
  removes the pre-20K.2 fallback that admitted a bridge whenever
  `solveSurfaceCorner` returned `CORNER_INVERTED / GRADING_CORNER_RAY` and the
  two side grades differed (a limitation, not a gate).

## 7. Provenance

- `src/engine/cad/grading/gradingTopology.ts` (new cycle trace, boundary
  geometry, component attribution, per-face positivity).
- `src/engine/cad/grading/gradingTopologyCertificate.ts` (`gtop1`).
- `tests/cad_grading_topology_cycles_20k2.test.ts` (graph + validator +
  RED replay), `tests/cad_grading_topology_certificate_20k2.test.ts`
  (certificate shape/revalidation).
- `docs/evidence/phase20k2-perf-output.txt` (measured stage costs).
