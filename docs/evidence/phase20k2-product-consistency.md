# Phase 20K.2 — product consistency

Status: **IMPLEMENTATION COMPLETE (uncommitted on branch
`fix/phase20k2-curved-topology-product-closeout`)**. This document records how
the topology certificate bounds the products (Extract, Bake, Design Patch) so
Calculate-CURRENT and product-available can no longer disagree.

## 1. The gap Phase 20K.2 closes

Phase 20K.1 Wave A2 (RED, recorded in
`docs/evidence/phase20k1-curved-seam-post-merge-audit.md`) showed a genuine
**Surface arc tied split** returning a CURRENT result from Calculate while
Extract/Bake returned null. Root cause: the product commands re-validated the
mesh with `validateGradingMeshTopology(..., { scope: 'arc' })`, whose default
`expectedComponents = 1`, and passed **no tied coordinates**, so the second
positive-width region was treated as an unattributed extra. Calculate's worker
gate already attributed the split. Products guessed; Calculate knew.

Phase 20K.2 makes the worker's record authoritative: Calculate writes a
`gtop1` certificate, and products consume it. They never re-solve and never
guess tied stations.

## 2. Product gate (Extract / Bake)

`gradingTopologyCertificateProductError(certificate, scope, mesh)` is the one
product authority. It returns a stable code, or `null` when the mesh is
provenable:

- `mesh.triangles.length === 0` → no certificate required (nothing to
  export);
- missing / wrong-version → `GRADING_TOPOLOGY_CERTIFICATE_MISSING`;
- scope mismatch → `GRADING_TOPOLOGY_CERTIFICATE_SCOPE`;
- forged mesh swap → `GRADING_TOPOLOGY_CERTIFICATE_DIGEST`;
- topology mismatch → `GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY:<code>:<detail>`;
- boundary-edge or boundary-cycle mismatch →
  `GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_EDGES` /
  `GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_CYCLES`;
- more than one edge-component → `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`.

Commands (`cadTransactionsGradingCommands.ts`,
`cadTransactionsGradingGroupCommands.ts`) replaced the old inline
`validateGradingMeshTopology` checks with this call; on any error they return
`null` — zero mutation, no partial geometry.

## 3. Multi-region Extract is unavailable by bound

A tied split is a legitimate Calculate result but is **not representable by
one Feature Line**: the daylight boundary collapses to repeated vertices at
the tie, so an Extract would have to silently concatenate two rings. Per the
20K.2 mission fallback, multi-region meshes are bounded off:

- the grading snapshot rows now compute `exportable` as
  `CURRENT && certificateProductError == null`, so Extract/Bake are disabled
  with a truthful notice instead of being enabled and returning null;
- the block code is `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`.

Single-region certified meshes keep extracting and baking as one undo entry
each (pinned by `tests/cad_grading_tied_products_20k2.test.ts`, including the
group path where a single-region certified chain extracts and bakes, and a
multi-region forged group mesh is blocked with zero mutation).

## 4. Product-stage matrix (measured)

Real closed rounded-square feature-line group → group compute → products.
See `docs/evidence/phase20k2-curved-design-patch-cutfill.md` for the full
Worker C write-up and `docs/evidence/phase20k2-perf-output.txt` for timings.

| Fixture | engine | pts/tris | ties | plan | Extract | Bake | Design Patch |
|---|---|---|---|---|---|---|---|
| all-Distance | CURRENT | 128/128 | 4 GAP | 9452.124826335 | pass | pass | **pass** |
| mixed-analytic | CURRENT | 128/128 | 4 GAP | 9452.124826335 | pass | pass | **pass** |
| all-Surface | CURRENT | 156/156 | 4 GAP | 9452.124826335 | pass | pass | **restricted** |

### 4a. Curved Design Patch

- all-Distance / mixed-analytic: the captured source ring held the exact
  station `V` three times at every internal seam (the GAP fan's
  `(V,Qin)`,`(V,T)`,`(V,Qout)` all reuse one sample). `normalizeCapturedRing`
  now collapses bit-identical **consecutive** vertices (first wins) before the
  ring is validated, so the previously-failing
  `self-intersection 0/2` no longer fires and the patch builds. Order,
  orientation, Z, and every distinct sample survive; no tolerance, no
  averaging.
- `validateSourceRing` additionally judges simplicity on the
  representation-collapsed station list (`sameRepresentationStation`), so a
  Surface seam twin recomputed as `start + t·length` is recognised as the same
  physical station in the predicate only. Genuine macroscopic
  self-intersections still fail closed.
- all-Surface stays **explicitly restricted**: `assembleSurfaceChain`
  resamples each shared station as `start + t·length`, so the captured ring
  carries ulp-twin micro-edges and ear-clipping fails closed
  `DESIGN_PATCH_NON_SIMPLE_RING : SURFACE_EDIT_NOT_APPLICABLE`. The blocked
  command returns the identical history object (zero mutation); Bake is
  unaffected. The recommended next-phase fix (canonicalize Surface chord-run
  source endpoints to the exact joint stations) is documented in
  `docs/evidence/phase20k2-curved-design-patch-cutfill.md` §3 and is
  deliberately **not** part of this scope.

### 4b. CUT/FILL direct fan

The pre-20K.2 fallback bridged a chord joint whenever `solveSurfaceCorner`
returned `CORNER_INVERTED / GRADING_CORNER_RAY` and the two side grades
differed. The fallback now additionally requires `directFanOnTarget`: a
CUT/FILL criterion, `V` agreeing with the target elevation under the shared
anchored contract, and the whole `qIn→V→qOut` fan covered by one proven target
plane (segment-walked against the target elevation). Ridges, valleys, voids,
steps/branches, off-target `V`, and non-CUT/FILL criteria fail closed
`GRADING_SURFACE_SEAM:GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`. No
averaging, projection, later-root preference, or tolerance relaxation.

## 5. Invariants preserved

- The certificate is additive and never persisted / never hashed into
  `grev1:` / `ggrev1:` (pinned in the tied-products suite).
- Straight-square and standalone straight meshes are certified with no
  behavior change.
- Homogeneous and mixed-analytic group meshes are bitwise identical to their
  pre-certificate forms.
- `validateGroupMesh` and `validateExplicitTinPayload` remain the mesh-shape
  gates; the certificate is the topology-authority gate layered on top.

## 6. What is not claimed

- No product is enabled for an uncertified mesh, and no product is silently
  concatenated.
- Multi-region is unavailable **by bound**, not by accident; the code is
  explicit and surfaced.
- The all-Surface Design Patch restriction is a known, fail-closed limitation
  with a named root cause and a named next-phase fix.

## 7. Provenance

- `src/engine/cad/grading/gradingTopologyCertificate.ts`.
- `src/engine/cad/cadTransactionsGradingCommands.ts`,
  `src/engine/cad/cadTransactionsGradingGroupCommands.ts` (product gate).
- `src/cad-app/shell/cadGradingSnapshot.ts`,
  `src/cad-app/shell/cadGradingGroupSnapshot.ts` (`exportable`).
- `src/engine/cad/grading/designPatchRing.ts` (ring collapse + simplicity).
- `src/engine/cad/grading/gradingChordSeam.ts` (`directFanOnTarget`).
- Tests: `tests/cad_grading_tied_products_20k2.test.ts` (14),
  `tests/cad_grading_curved_design_patch_20k2.test.ts` (12),
  `tests/cad_grading_cutfill_seam_target_20k2.test.ts` (14),
  `tests/cad_grading_topology_certificate_20k2.test.ts`.
