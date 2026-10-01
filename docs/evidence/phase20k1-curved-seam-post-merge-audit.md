# Phase 20K.1 Wave A2 — production curved-seam reproduction matrix

Status: **RECORDING ONLY / RED**. Zero `src/` changes, no engine fix, no gate,
no welding. Branch `fix/phase20k1-curved-grading-seam-topology`, baseline
`35b4c277e7782bf57f2485c2e462085ddef99f51` (PR #141 merge; Phase 20K study).

This audit replays the Phase 20K question against the **actual production
engine** — `computeGradingFromSnapshots` (standalone) and
`computeGradingGroupFromSnapshots` (groups) — instead of the Phase 20K study
assembler. Test:
`tests/cad_grading_arc_internal_seam_20k1.test.ts` (agent tier, freezes the
measured actuals). The test passing means the recorded topology is the
shipped topology, not that the engine passes.

## 1. Method

- Geometry: the Phase 20K outward rounded square (4 genuine arcs, chord
  `100`, sagitta `5`, `R = 252.5`), `curveChordTolerance = 0.1`,
  `maxSearchDistance = 100`, `side = right`, sources at `Z = 10`, flat target
  `Z = 0`.
- **INDEX topology** = shared vertex-index connectivity, computed by the
  Wave A1 audit `auditMesh` (`src`-free study module) and the boundary-loop
  scan in the test.
- **Geometric coincidence diagnostic** = Wave A1 `geometricDiagnostic`
  (zeroDelta-based), reported **separately**. Production success is judged on
  INDEX topology; the weld diagnostic never fakes success.
- §8 classification vocabulary and the product-stage gates below.
- Standalone courses A–D use production `computeGradingFromSnapshots`; groups
  E–I use production `computeGradingGroupFromSnapshots`.

### Product-stage gates (all production functions)

| Stage | Gate |
|---|---|
| CURRENT | engine `ok` and non-empty result (no `ALREADY_TIED`) |
| Extract | CURRENT and the mesh passes `validateGroupMesh` |
| Bake | `gradingMesh.triangles.length > 0` and `validateExplicitTinPayload(canonicalizeBakedTin(...))` passes (the `GROUPBAKE` topology gate) |
| Design Patch | closed + `validateSourceRing` + `resolveDesignPatchInterior` + `verifyRingAgainstMesh` + `mergePadWithGrading` all pass (the `resolveDesignPatch` gate) |

## 2. Matrix — engine, geometry, validator

| Fixture | engine | status | pts | tris | ties | plan area | 3D area | validator |
|---|---|---|---|---|---|---|---|---|
| `standalone.A distance` | ok | ok(CLEAN) | 25 | 23 | 0 | 2082.837637462 | 2328.688114517 | null (pass) |
| `standalone.B elevation` | ok | ok(CLEAN) | 25 | 23 | 0 | 2082.837637462 | 2328.688114517 | null (pass) |
| `standalone.C relative` | ok | ok(CLEAN) | 25 | 23 | 0 | 2082.837637462 | 2328.688114517 | null (pass) |
| `standalone.D surface fixed` | ok | ok(CLEAN) | 32 | 30 | 0 | 2082.837637462 | 2328.688114517 | null (pass) |
| `closed.square.all-distance` | ok | ok(CURVE_CORNER_APPROXIMATED) | 108 | 100 | 4 | 9451.951560147 | 10567.622475409 | null (pass) |
| `closed.square.mixed-analytic` | ok | ok(CURVE_CORNER_APPROXIMATED) | 108 | 100 | 4 | 9451.951560147 | 10567.622475409 | null (pass) |
| `open.hybrid.one-arc` | ok | ok(CURVE_CORNER_APPROXIMATED) | 37 | 34 | 1 | 4418.515930304 | 4940.055832699 | null (pass) |
| `closed.square.all-surface` | FAIL | `CORNER_NO_SOLUTION/GRADING_CORNER_SECTOR` | 0 | 0 | 0 | 0 | 0 | null (pass) |
| `standalone.straight.fixed` | ok | ok(CLEAN) | 4 | 2 | 0 | 2000 | 2236.0679775 | null (pass) |
| `closed.square.straight` | ok | ok(CLEAN) | 16 | 16 | 4 | 9600 | 10733.126291999 | null (pass) |

## 3. Matrix — INDEX topology, geometric diagnostic, §8

| Fixture | INDEX edgeComp | INDEX bEdges | INDEX loops | coincident vertex sets | exact dup sets | coincident non-shared edges | WELD edgeComp | WELD degenerate tris | §8 class | flags |
|---|---|---|---|---|---|---|---|---|---|---|
| `standalone.A distance` | 1 | 25 | 1 | 0 | 0 | 0 | 1 | 0 | **TOPOLOGY_VALID** | — |
| `standalone.B elevation` | 1 | 25 | 1 | 0 | 0 | 0 | 1 | 0 | **TOPOLOGY_VALID** | — |
| `standalone.C relative` | 1 | 25 | 1 | 0 | 0 | 0 | 1 | 0 | **TOPOLOGY_VALID** | — |
| `standalone.D surface fixed` | 1 | 32 | 1 | 2 | 0 | 0 | 1 | 2 | **TOPOLOGY_VALID** | — |
| `closed.square.all-distance` | 8 | 116 | 1 | 3 | 0 | 0 | 4 | 0 | **VERTEX_PINCH** | — |
| `closed.square.mixed-analytic` | 8 | 116 | 1 | 3 | 0 | 0 | 4 | 0 | **VERTEX_PINCH** | — |
| `open.hybrid.one-arc` | 2 | 38 | 1 | 2 | 0 | 0 | 2 | 2 | **VERTEX_PINCH** | — |
| `closed.square.all-surface` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **EXISTING_FAIL_CLOSED** | — |
| `standalone.straight.fixed` | 1 | 4 | 1 | 0 | 0 | 0 | 1 | 0 | **TOPOLOGY_VALID** | — |
| `closed.square.straight` | 1 | 16 | 2 | 0 | 0 | 0 | 1 | 0 | **TOPOLOGY_VALID** | — |

Interpretation of the §8 labels used here:

- **TOPOLOGY_VALID** — INDEX edge-connected (`edgeComponents = 1`), validator
  passes. The standalone surface arc `D` is INDEX-valid but still carries 2
  zeroDelta-coincident vertex sets and 2 triangles that degenerate under the
  diagnostic weld — recorded, not flagged as a break.
- **VERTEX_PINCH** — INDEX edge-disconnected, vertex-connected, and the
  zeroDelta weld does **not** restore a single boundary
  (`weldedEdgeComponents > 1`). This is the geometric pinch the Phase 20K
  study reported; the diagnostic weld heals nothing.
- **EXISTING_FAIL_CLOSED** — production already refuses (surface↔surface
  curved corner).
- **INDEX_SEAM_CRACK** and **GEOMETRIC_SEAM_GAP** do not occur in this
  matrix: every cracked row is a true geometric vertex pinch at the
  zeroDelta floor, not a pure index artifact.

## 4. Matrix — product-stage eligibility

| Fixture | CURRENT | Extract | Bake | Design Patch | design-patch detail |
|---|---|---|---|---|---|
| `standalone.A distance` | yes | yes | yes | no | not-closed |
| `standalone.B elevation` | yes | yes | yes | no | not-closed |
| `standalone.C relative` | yes | yes | yes | no | not-closed |
| `standalone.D surface fixed` | yes | yes | yes | no | not-closed |
| `closed.square.all-distance` | yes | yes | yes | no | `DESIGN_PATCH_NON_SIMPLE_RING:self-intersection 0/2` |
| `closed.square.mixed-analytic` | yes | yes | yes | no | `DESIGN_PATCH_NON_SIMPLE_RING:self-intersection 0/2` |
| `open.hybrid.one-arc` | yes | yes | yes | no | not-closed |
| `closed.square.all-surface` | no | no | no | no | engine-failed |
| `standalone.straight.fixed` | yes | yes | yes | no | not-closed |
| `closed.square.straight` | yes | yes | yes | yes | ok |

### Design Patch source-boundary finding

The closed curved groups E/F **fail the production Design Patch gate** even
though the engine is `ok` and the mesh passes every validator. Cause: the
group's captured `sourceBoundaryPoints` contains **exact duplicate adjacent
vertices at every internal arc chord joint** (zero-length segments), e.g.
ring indices 1 → 2 are bit-identical (`dx = dy = 0`; the same at 3→4, 5→6, …).
`validateSourceRing` walks exact-XY pairs and rejects the ring's non-simple
self-intersection (`self-intersection 0/2`) before the duplicate-adjacent
check can name it. The straight square `I2` has no such duplicates and Design
Patch succeeds. This is a direct, production-visible consequence of the
curved seam discretization and is independent of the daylight-ring
simplicity (`ringIsSimple` passes for E/F).

## 5. Shipped-impact classification (per fixture)

| Fixture | can become CURRENT | Extract | Bake | Design Patch | root observation |
|---|---|---|---|---|---|
| A/B/C standalone analytic arc | yes | yes | yes | n/a (open) | INDEX-valid, no coincident sets |
| D standalone surface arc | yes | yes | yes | n/a (open) | INDEX-valid; 2 diagnostic-weld coincident sets, 2 degenerate-after-weld tris |
| E closed all-Distance arcs | yes | yes | yes | **no** | VERTEX_PINCH (INDEX ec=8, weld ec=4); source ring non-simple |
| F closed mixed-analytic arcs | yes | yes | yes | **no** | VERTEX_PINCH (INDEX ec=8, weld ec=4); source ring non-simple |
| G one-arc hybrid | yes | yes | yes | n/a (open) | VERTEX_PINCH (INDEX ec=2, weld ec=2) |
| H surface-only curved | no | no | no | no | EXISTING_FAIL_CLOSED (`GRADING_CORNER_SECTOR`) |
| I1 straight standalone | yes | yes | yes | n/a (open) | clean |
| I2 straight square | yes | yes | yes | yes | clean |

**Shipped impact:** the shipped `GROUPBAKE` and `validateGroupMesh` gates pass
every cracked curved group (INDEX connectivity is not enforced there, and
`groupBakeCommand`/`mergeGroupTriangles` only exact-XYZ dedupe). The only
shipped gate that already rejects a cracked curved group is the **Design
Patch** ring/mesh agreement, and only because the captured source ring's
zero-length adjacent segments trip `validateSourceRing`. `validateGroupMesh`
accepts the E/F/G vertex-pinched mesh; `ringIsSimple` accepts the daylight
ring.

## 6. INDEX topology vs geometric coincidence (separate)

Per the task §6, the two are reported separately and never conflated:

- **INDEX** (authority for production success): E/F `edgeComponents = 8`,
  G `edgeComponents = 2`, A–D/I1/I2 `edgeComponents = 1`.
- **Diagnostic** (informational): E/F 3 coincident vertex sets and
  `weldedEdgeComponents = 4` (the weld is not a repair); G 2 coincident sets
  and `weldedEdgeComponents = 2`; D 2 coincident sets and 2 degenerate-after-
  weld triangles. `exactDuplicateSets = 0` for every mesh — the mesh merge
  already deduplicates exact-XYZ vertices, so the residual coincidence is
  below `zeroDelta` but above bit equality.
- No row uses the weld to claim buildability, and no row is reclassified as
  valid because a weld would connect it.

## 7. Study assembler vs production

The Phase 20K corpus was produced by `scripts/phase20kHybridArcPairGroups.ts`
(`assembleHybridArcGroup`), a **non-routed study assembler** that calls the
production member solvers and merge helpers but resolves arc×arc joints
through `resolveArcPairCorner` with the arc-pair guard cleared. This Wave A2
matrix instead calls the **actual production entry points**:

- `computeGradingFromSnapshots` for standalone courses A–D, I1;
- `computeGradingGroupFromSnapshots` for groups E–I.

Consequences observed here and not observable in the study corpus:

- the production hybrid path (G: one arc + one straight) is **supported** and
  returns `ok`, whereas the study focused on the blocked arc×arc joint;
- production S↔S curved corners fail closed (`H`,
  `GRADING_CORNER_SECTOR`) exactly as the Phase 20K control reported;
- the production `sourceBoundaryPoints` capture for closed curved groups is
  **not** ring-simple at the exact-predicate level, which the study corpus
  never exercised (it used the study mesh/daylight, not the Design Patch
  ring).

The `scale` of the finding is unchanged from Phase 20K: the blocker is the
arc chord-seam collision topology (duplicate/coincident seam vertices at each
internal arc chord joint), not the terminal frame. No production gate is
loosened and no seam is welded here.

## 8. What this audit does not do

- No `src/` change, no seam assembly, no gate relaxation, no weld.
- No `parity:industry-reference` relevance: no parser/solver/report output
  changed.
- The `EXPECTED` block in the test freezes the current counts; a deliberate
  engine fix must update both the test and this document.

## 9. Wave C1 analytic internal chord-seam cure (same branch)

New shared pure helper `src/engine/cad/grading/gradingChordSeam.ts`
(`assembleSolvedGradingChain`, 217 lines): every internal linearization
station resolves through the existing `analyticTerminalLine` +
`solveAnalyticCorner` authorities with the same effective criterion on both
sides (maxSearchDistance + line/Z/side/extent gates preserved). GAP emits
pairs (V,Qin),(V,T),(V,Qout) so the strip builder tiles the planar fan
exactly once (edge V–T shared, incidence 2); OVERLAP emits (V,Cin),(V,Cout)
miter-crossing clips (exact run-level Sutherland clips, no double-cover)
and records the tie once. No endpoint averaging, bridge, tangent
substitution, tolerance change, or weld. Consumed by `arcSolve` (analytic
path) and the curved-analytic member path of `gradingGroupCompute`; Surface
seams untouched (Wave C2).

Two root causes were needed, not one: (1) internal seams fanned/clipped as
above; (2) member-joint vertices canonicalized to the bitwise-shared member
ends — linearized arc endpoints differ from the member ends (and from each
other) by ulps (e.g. 100.00000000000004 vs 100 vs 100,-7e-15), which kept
corner patches index-disconnected (8 components) even with perfect seams.

Old -> new (this document's §7 matrix): A/B/C stay TOPOLOGY_VALID, 1
component, 1 loop, +7 verts/+7 tris (one tie + one fan triangle per joint),
plan 2082.837637462 -> 2082.880954009 (overlap double-cover out, fan in);
E/F PINCH-8 FAILED -> CURRENT TOPOLOGY_VALID (128 pts / 128 tris / 4 ties /
plan 9452.124826335 / 1 component / 2 loops / 0 coincident sets);
G (surface arc member) still PINCH-2, H still CORNER_NO_SOLUTION (C2 scope).
B1/B2 validators and gates unchanged; the §17 hand oracle
(T=121.64784400584789 within 1 ulp of the idealized hand value, extent
21.647844005847887, fan plan 165.6854249492381 / 3D 185.24193653371802) and
D/E/REL bitwise equivalence live in
`tests/cad_grading_analytic_seam_20k1.test.ts`. The 20K study corpus
(`docs/evidence/phase20k/corpus.json`) regenerated: literal-concave
all-distance SELF_INTERSECTION -> ok (independently audited valid),
control rows now CURRENT, hybrid-vs-control comparison available with ties
agreeing to 8.5e-14. E/F Design Patch still refuses
(`DESIGN_PATCH_NON_SIMPLE_RING` from exact-duplicate adjacent
sourceBoundary vertices at GAP joints) — pre-existing export shape, still
fail-closed, not widened here.

---

## 10. Addendum (2026-10-01) — PR #142 merged + Phase 20K.2 corrections

History above is preserved unchanged. This addendum records the merged state
and the corrections Phase 20K.2 establishes; it does not rewrite the 20K.1
finding.

### 10.1 Merge facts

Phase 20K.1 is **CLOSED / MERGED** via PR #142:

- base `35b4c277e7782bf57f2485c2e462085ddef99f51` (PR #141 merge);
- head `b0387f96` (reviewer fixes: overlap rejection + split attribution +
  buffer guard);
- merge `fbac7c88b3fadd6cce4043d2d2f7dfaa9d82a12d`;
- final-head CI run `36813779852` — success;
- merge-push CI run `36837387411` — success.

### 10.2 Boundary components vs cycles (correction)

The §2/§3 tables above report `INDEX loops = 1` for the pinched curved
squares. That was a **boundary-edge graph connected-component count**, not a
real simple cycle. Phase 20K.2 separates `components` (edge-connected faces),
`boundaryCycles` (traversed simple cycles, the new validity authority), and
deprecated `loops` (graph components). The corrected reading:

- E/F/G are `VERTEX_PINCH` with `edgeComponents = 8 / 8 / 2` (unchanged);
- the closed squares are annuli: `components = 1`, `boundaryCycles = 2`;
- the old "1 loop" was never a simple boundary cycle confession.

### 10.3 Tied-split product mismatch (correction)

A genuine Surface arc tied split returned CURRENT from Calculate while
Extract/Bake returned null. Cause: the products re-validated with
`{ scope: 'arc' }` (default `expectedComponents = 1`) and no tied
coordinates. Phase 20K.2 replaces product revalidation with the worker's
`gtop1` certificate; the legacy call remains RED on that mesh
(`ok:false, components:2`) as a pinned proof.

### 10.4 Actual Design Patch state (correction)

The §4 statement "E/F Design Patch still refuses on exact-duplicate adjacent
sourceBoundary vertices" is the **pre-20K.2** state. Post-fix, on the real
closed product path:

- all-Distance / mixed-analytic Design Patch **passes** (the
  `normalizeCapturedRing` consecutive-duplicate collapse);
- all-Surface Design Patch remains **explicitly restricted**
  (`DESIGN_PATCH_NON_SIMPLE_RING:SURFACE_EDIT_NOT_APPLICABLE`) because the
  Surface seam resamples stations as `start + t·length` (ulp-twin
  micro-edges).

### 10.5 Cut/Fill limitation (correction)

The pre-20K.2 cross-grade fallback admitted a direct fan whenever
`solveSurfaceCorner` returned `CORNER_INVERTED / GRADING_CORNER_RAY` and the
side grades differed. That was a limitation, not a gate. Phase 20K.2 requires
`directFanOnTarget` proof; ridges/valleys/voids/steps/branches/off-target `V`
fail closed `GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`.

### 10.6 Additional clampings

- **10→12 slope fail-closed**: the reviewer-fix interaction suite resolves
  the 10→11 slope strip and fails closed the 10→12 slope plus the
  zero-width-steep-drop fixtures on genuine folds.
- **1 nm floor contract**: `AGREEMENT_FLOOR = 1e-9` m is an explicit
  representation-noise agreement bound (topology boundary micro-edge collapse
  + Design Patch representation-station predicate), not a geometry tolerance;
  global `zeroDelta` is unchanged.

### 10.7 Phase 20K.2 link

Phase 20K.2 (branch `fix/phase20k2-curved-topology-product-closeout`,
baseline `fbac7c88`) delivers the topology contract, certificate,
product-consistency gates, curved Design Patch closeout, and CUT/FILL direct
fan. Evidence: `docs/evidence/phase20k2-topology-contract.md`,
`phase20k2-product-consistency.md`, `phase20k2-validation.md`,
`phase20k2-topology-product-performance.md`, `phase20k2-post-merge-audit.md`,
`phase20k2-curved-design-patch-cutfill.md`, `phase20k2/perf-output.txt`.
