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
