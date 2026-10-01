# Phase 20K.2 — post-merge audit

Status: **Phase 20K.1 CLOSED / MERGED; Phase 20K.2 IMPLEMENTATION COMPLETE
(uncommitted)**. This audit records the merged-state facts for Phase 20K.1
(PR #142), corrects the 20K.1 wording that Phase 20K.2 superseded, and states
the Phase 20K.2 scope and honest bounds.

## 1. Phase 20K.1 merge facts (PR #142)

| Fact | Value |
|---|---|
| Base | `35b4c277e7782bf57f2485c2e462085ddef99f51` (PR #141 merge) |
| Head | `b0387f96` (reviewer fixes: overlap rejection + split attribution + buffer guard) |
| Merge | `fbac7c88b3fadd6cce4043d2d2f7dfaa9d82a12d` |
| Final-head CI | run `36813779852` — success |
| Merge-push CI | run `36837387411` — success |

Phase 20K.1 delivered the production curved chord-seam assembly (analytic
`assembleSolvedGradingChain` + Surface `assembleSurfaceChain`), the fail-closed
topology gate (Wave B2), and the reviewer fixes: interior-overlap rejection
(edge-adjacent faces must have opposite vertices on opposite plan sides,
`O(E)`), split attribution (extras beyond expected components each need a
real tied station/coordinate), and ragged/finite index guards before the
empty-mesh return. It is MERGED and CLOSED.

## 2. Corrections Phase 20K.2 makes to the 20K.1 record

These are wording corrections, not retractions; the 20K.1 history is preserved
in `docs/evidence/phase20k1-curved-seam-post-merge-audit.md` with a dated
addendum.

### 2a. Boundary components vs cycles

The 20K.1 Wave A2 matrix reported `INDEX loops = 1` for the pinched curved
squares and read the boundary as if it were a cycle. That value was a
boundary-edge **graph connected-component count**, not a real cycle. The 20K.2
contract separates `components` (edge-connected faces), `boundaryCycles`
(traversed simple cycles, the new authority), and the deprecated `loops`
(graph components). The corrected reading:

- curved E/F/G meshes are `VERTEX_PINCH` with `edgeComponents = 8 / 8 / 2` —
  unchanged as a component count;
- the "1 loop" was never a simple boundary cycle; the real trace is what
  rejects self-touching/branching boundaries;
- the all-Distance/all-Surface rounded squares are **annuli**: 1 face
  component, **2** boundary cycles (outer ring + interior hole).

### 2b. Tied-split product mismatch

20K.1's product gates re-validated the mesh with `{ scope: 'arc' }` (default
`expectedComponents = 1`) and no tied coordinates. A genuine Surface arc
tied split therefore returned CURRENT from Calculate while Extract/Bake
returned null. Phase 20K.2 makes the worker-recorded `gtop1` certificate the
product authority; products never guess tied stations. The legacy
`{ scope: 'arc' }` call is already RED on that mesh (`ok:false,
components:2`) and is kept as a pinned proof of why the certificate is
required.

### 2c. Actual Design Patch state

The 20K.1 matrix recorded E/F Design Patch failing
`DESIGN_PATCH_NON_SIMPLE_RING:self-intersection 0/2` because the captured
`sourceBoundaryPoints` held exact duplicate adjacent vertices at every internal
arc chord joint. The 20K.2 **actual** state (real closed product path):

- all-Distance and mixed-analytic: Design Patch now **passes** (the
  `normalizeCapturedRing` consecutive-duplicate collapse, plus
  representation-station simplicity);
- all-Surface: Design Patch stays **explicitly restricted**
  (`DESIGN_PATCH_NON_SIMPLE_RING:SURFACE_EDIT_NOT_APPLICABLE`) — the Surface
  seam resamples each shared station as `start + t·length`, leaving ulp-twin
  micro-edges that ear-clipping refuses.

### 2d. Cut/Fill limitation

The 20K.1 cross-grade fallback activated a direct fan whenever
`solveSurfaceCorner` returned `CORNER_INVERTED / GRADING_CORNER_RAY` and the
two side grades differed. That was a **limitation**, not a gate: it could
bridge geometry that left the target. 20K.2 requires `directFanOnTarget`
proof (cut/fill criterion, `V` on the target, the whole fan on one proven
target plane); ridges/valleys/voids/steps/branches/off-target `V` now fail
closed `GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`.

### 2e. 10→12 slope fail-closed

The reviewer-fix interaction suite `cad_grading_arc_surface_seam_20k1`
(23/23) resolves the 10→11 slope strip (39 pts / 37 tris, plan
2190.7018168390186) and **fails closed** the 10→12 slope plus the
zero-width-steep-drop fixtures on genuine folds. This is intended: a genuine
fold is not a representable grading strip, and the new cycle/overlap contract
is what names it.

### 2f. 1 nm floor contract

`AGREEMENT_FLOOR = 1e-9` m is an explicit representation-noise **agreement
bound** (used by the topology boundary micro-edge collapse and the Design
Patch representation-station predicate), not a geometry tolerance. The global
`zeroDelta` classification floor is unchanged. This is stated plainly so no
future reader mistakes the floor for a cross-cutting numerical relaxation.

## 3. Phase 20K.2 scope and evidence

Uncommitted branch `fix/phase20k2-curved-topology-product-closeout`, baseline
`fbac7c88`.

- **Topology worker**: real boundary-cycle trace (`traceBoundaryCycles`),
  `O(B^2)` boundary geometry, per-face positive-plan-area gate, component
  attribution, `gtop1` certificate, product revalidation.
- **Worker B**: certificate shape + fail-closed product revalidation +
  `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE` policy; tied-split
  Calculate/Product consistency.
- **Worker C**: curved Design Patch ring collapse + representation-station
  simplicity; CUT/FILL `directFanOnTarget`.

Evidence documents (this batch):

- `docs/evidence/phase20k2-topology-contract.md`
- `docs/evidence/phase20k2-product-consistency.md`
- `docs/evidence/phase20k2-validation.md`
- `docs/evidence/phase20k2-topology-product-performance.md`
- `docs/evidence/phase20k2-curved-design-patch-cutfill.md` (Worker C)
- `docs/evidence/phase20k2/perf-output.txt` (raw perf run)
- `scripts/phase20k2TopologyProductPerf.ts`

Browser QA is owned by the browser sibling
(`docs/evidence/phase20k2-browser-qa.md`, not written here).

## 4. Honest bounds retained

- arc×arc hybrid joints: still blocked
  (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`).
- transition-less surface+analytic mixing: still blocked
  (`GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`).
- Multi-region Extract: unavailable **by bound**
  (`GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`), surfaced honestly as
  `exportable: false`, never a silent concatenation.
- all-Surface Design Patch: restricted with a named root cause and a named
  next-phase fix (`assembleSurfaceChain` endpoint canonicalization); not
  implemented in this scope.
- The `O(F^2)` non-adjacent face-overlap audit remains test-only.

## 5. Worktree cleanup

The mission listed three leftover probe scripts
(`scripts/tmp20k2probe.ts`, `scripts/tmp20k2bprobe.ts`,
`scripts/tmp20k2gprobe.ts`). None is present in the worktree (tracked,
untracked, or ignored), so there was nothing to delete.

## 6. Verdict

Topology contract and product consistency are coherent and fail-closed; the
three known limitations (arc×arc, transition-less mixing, all-Surface Design
Patch) are explicit bounds, not silent gaps. Phase 20K.1 is CLOSED; Phase 20K.2
is IMPLEMENTATION COMPLETE and awaiting orchestrator commit/review.
