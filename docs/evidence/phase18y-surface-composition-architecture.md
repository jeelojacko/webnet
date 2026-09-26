# Phase 18Y — Exact two-surface composition architecture audit

- **Branch:** `feat/cad-surface-exact-composition`
- **Baseline:** `origin/main` = `603bc59a0b867a43b0127714bef85da758a6a7f7` (Phase 18X merged, PR #115)
- **Audit type:** read-only reconnaissance (no source modified)
- **Status:** PRE-IMPLEMENTATION — no `surfaceCompose*` module, no `SURFACE_COMPOSE*` reason code,
  and no `compose` worker op exist anywhere in the tree (repo-wide grep for
  `composeSurface|surfaceCompose|SURFACE_COMPOSE|SEAM` in `src/` returns only unrelated
  decomposition/TODO prose).

All `file:line` references valid at 18X tip (content-identical to baseline `603bc59a`).

---

## 1. Surface mesh ownership today

### 1.1 Persisted definition vs session-derived mesh

The contract is "definitions persist, meshes never do":

- `CadSurface` — `src/engine/cad/cadTypes.ts:1157-1167`:
  `id`, `name`, `definition`, `styleId?`, `cachedRevision?: string | null`,
  `layerId?`, `buildDiagnostic?`.
- `CadSurfaceDefinition` — `cadTypes.ts:943-968`:
  `pointSource`, `breaklines?`, `boundaries?`, `buildOptions?`, `edits?`,
  `sourceKind?: 'native' | 'imported-tin' | 'explicit-tin'`, `importedTin?`.
- `CadSurfaceStatus` — `cadTypes.ts:1148-1155`:
  `UNBUILT | CURRENT | NEEDS_REBUILD | BUILDING | FAILED | BROKEN_REFERENCE | INSUFFICIENT_DATA`.

### 1.2 Build result and query index

- `CadSurfaceBuildResult` — `src/engine/cad/cadSurfaces.ts:86-107`:
  `outcome: 'ok' | 'insufficient' | 'blocked'`, `revision`, `reasonCodes`,
  `points: CadSurfaceSourcePoint[]`, `triangles: Array<[number, number, number]>`,
  `adjacency: TinAdjacency[]`, `edgeKinds: TinEdgeKinds[]`, `stats`, `grid`, `editFailure?`.
- `CadSurfaceGrid` — `cadSurfaces.ts:109-114`: `{ minX, minY, cellSize, cells: Map<string, number[]> }`.
- `buildSurfaceGrid` — `src/engine/cad/cadSurfaceInterpolation.ts:4-41`.
- `getSurfaceElevationAt` — `cadSurfaceInterpolation.ts:55-88` (with `barycentric` at `:43`).
  Containing-triangle barycentric interpolation with `tol = 1e-9`; **null** outside the mesh and
  over voids. Single-valued function `(x, y) → z` on the retained domain.

### 1.3 Session cache (`CachedSurfaceMesh`)

- `CachedSurfaceMesh` — `src/engine/cad/cadSurfaceCache.ts:18-28`:
  `revision`, `points`, `triangles`, `stats`, `grid`, `adjacency`, `edgeKinds`.
  Grid + adjacency + edgeKinds are "session-only, never persisted".
- `applySurfaceBuildSuccess` — `cadSurfaceCache.ts:68-105`: latest-wins guard, deep-copies arrays.
- `applySurfaceBuildFailure` — `cadSurfaceCache.ts:108+`: records `buildDiagnostic` only.

### 1.4 Build entry point (one chokepoint, two legs)

`buildCadSurface` — `cadSurfaces.ts:240-460`:

1. `computeCadSurfaceSourceRevision(project, surface)` (`:241`).
2. **Explicit leg** (`:244-297`): `materializeImportedTin` → `replaySurfaceEdits` (`:266`).
   Invalid payload ⇒ `outcome:'blocked'` + `SURFACE_TRIANGULATION_FAILED`.
3. **Native leg** (`:299-460`): `collectSources` → breakline segments →
   `buildConstrainedTin` → `replaySurfaceEdits` (`:412`).
4. `replaySurfaceEdits` — `cadSurfaces.ts:189-238`: single edit-replay chokepoint.
5. `deriveSurfaceStatus` — `cadSurfaces.ts:505+`: explicit leg never derives
   `BROKEN_REFERENCE`/`INSUFFICIENT_DATA`.

**Composition consequence:** a new explicit-TIN *producer* inherits every downstream consumer for
free iff it returns a correct `CadSurfaceBuildResult` through this one function.

---

## 2. Explicit-TIN output architecture (the 18X seam 18Y reuses)

### 2.1 Payload + provenance types

- `ImportedTinPayload` — `cadTypes.ts:931-936`:
  `{ vertices: number[] /* flat x,y,z */, faces: number[] /* CCW index triples */, provenance }`.
- `CadExplicitTinProvenance` — `cadTypes.ts:917-924` = discriminated union
  `LandxmlTinProvenance | WebnetBakeTinProvenance | ExplicitFormatTinProvenance`.

### 2.2 Validation / materialization (`src/engine/cad/cadImportedTin.ts`)

- `validateExplicitTinPayload` — `cadImportedTin.ts:31-69`. Fail-closed:
  vertex/face counts; every vertex finite; index range; no degenerate faces;
  **strict CCW positive XY area**.
- `normalizeTinProvenance` — `:83-110`; `makeWebnetBakeProvenance` — `:112-129`.
- `importedTinRevision` — `:139-157`: `srev1:imported:<fnv1a(...)>` — prefix frozen for both kinds.
- `materializeExplicitTin` — `:159-196`: 1:1 vertices/faces, `buildTinTopology`, grid + stats.
  No Delaunay, no hull.
- `explicitTinTopologyDigest` — `:209-210`: `etin1:<fnv1a(v:...#f:...)>`; provenance excluded.

### 2.3 Bake-specific output helpers (`src/engine/cad/cadExplicitBake.ts`)

- `canonicalizeBakedTin` — `cadExplicitBake.ts:44-78`: compact unreferenced vertices, deterministic
  remap, preserve face order, force CCW.
- `createBakedPayloadFromMesh` — `:80-105`: exact doubles, strict `kind:'webnet-bake'`.
- `bakedSurfaceDefinition` — `:107-111`: explicit-tin, empty point source, edits cleared.
- Transactions — `src/engine/cad/cadTransactionsSurfaceBakeCommands.ts`:
  lock → status → stale revision → non-empty mesh → one undo entry. **Template 18Y copies.**

---

## 3. Source capability helpers, build service, worker protocol

### 3.1 Capability predicates (`cadTypes.ts`)

- `isExplicitTopologyDefinition` — `cadTypes.ts:970-974` — fail-closed into explicit leg.
- `isNativeSurfaceDefinition` — `:983-987`.
- Call sites: `cadSurfaces.ts:244,513`; `cadSurfaceRevision.ts:95,319`;
  `cadSurfaceTypes.ts:219`; `cadProjectTransformRequest.ts:83`;
  `cadProjectAuthoritativeBounds.ts:30`; `cadProjectTransform.ts:128,272`;
  `surfaceBuildService.ts:344`.

### 3.2 Build request + snapshot pruning

- `SurfaceBuildRequest` — `src/engine/cad/cadSurfaceTypes.ts:169-197`.
- Explicit surfaces ⇒ `points: []` (`:219`).

### 3.3 `SurfaceBuildService` (`src/workers/surfaceBuildService.ts`)

- `SYNC_FALLBACK_POINT_LIMIT = 1000`; serial queue; ownership-tuple `complete` (`:412-501`).

### 3.4 Worker protocol (`src/workers/surfaceWorkerHandler.ts`, `surfaceWorkerClient.ts`)

- Request ops: `build | contours | volume | profile | sections | analysis | cancel` (`:91-98`).
- Response variants incl. per-op `*-success` / `*-failure` (`:100-194`).
- `buildSurfaceMeshFromRequest` (`:367-407`): same `buildCadSurface` engine, two hosts.
- Client guards, request-id prefixes, terminal-type set, cancel ⇒ `null`.
- Per-derivation services: build/contour/volume/profile/section/analysis under `src/workers/`.

---

## 4. TIN primitives available for a composition PSLG

In `src/engine/cad/tin/` (pure, exact, deterministic, worker-safe):

| Module | Symbol | Role |
|---|---|---|
| `tinTypes.ts` | `TinEdgeKindCode` FREE/BREAKLINE/OUTER/VOID; `TinAdjacency`, `TinEdgeKinds` | edge-flag alphabet |
| `tinBase.ts` | `buildTinBase` | delaunator + local-frame conditioning; math-CCW; rejects zero-area |
| `tinDedupe.ts` | `dedupeTinPoints` | exact-XY dedupe; two Zs at one XY ⇒ `conflict` |
| `tinConstraintRecovery.ts` | `recoverConstrainedEdges` | Sloan-style flip recovery; Steiner midpoint requests |
| `tinLegalize.ts` | `legalizeTin` | Lawson empty-circle flips; constrained edges never flipped |
| `tinBuild.ts` | `buildConstrainedTin` | full pipeline + `TinBuildInput`/`TinBuildSuccess` |
| `tinTopology.ts` | `buildTinTopology`, `classifyTinDomain`, `validateTinMesh` | adjacency + domain + validator |
| `tinPredicates.ts` | `ccwSign`/`inCircle`/`triangleArea2`/`pointInRing` | robust-predicates wrappers |
| `tinBoundaries.ts` | `validateRingRelations`, `mergeBoundaryPoints` | ring checks, interpolated Z |
| `tinDomainFilter.ts` | `filterTinDomain` | retained mask + planimetric area |

18I two-mesh machinery (`src/engine/cad/surfaces/volume/`): `bboxIndex.findOverlappingPairs`,
`overlap.clipTrianglePair` (local frame, exact), `integrate.fitPlane`/`buildVertices`
(per-owner-plane Z), `zero.zeroDelta` (`4ε·max(1,|z|)` policy). Volume never unions topology —
precedent for the math, not the topology.

---

## 5. Surface revision lifecycle + dependent statuses

`computeCadSurfaceSourceRevision` — `cadSurfaceRevision.ts:319+`: explicit ⇒
`importedTinRevision` (vertices + faces + provenance + edits); native ⇒ `srev1:<fnv1a(...)>`.
`cachedRevision` never persisted (`clearSurfaceBuildCacheOnLoad`).

Dependents (all kind-agnostic, read `srev1` + final mesh): Profile (`prev1`),
Section (`secg1`), Volume (`vrev1`), Analysis (`arev1`), Contours, inquiry/display.
A composed explicit-tin surface needs **zero changes** in consumers if revision/build correct.

---

## 6. Transform / LandXML / WNCAD handling of explicit payloads

- Transform: `preflightImportedTins` (`cadProjectTransform.ts:128-142`) fail-closed;
  `transformImportedTinVertices` (`:257-269`) XY-only, Z preserved; `transformSurface` (`:272-317`).
- LandXML export (`landxmlCivilSource.ts:126-172`): runtime final mesh, CURRENT-gated,
  `sourceKind`-agnostic — composed surface exports for free.
- WNCAD: trailing `surfaces` clone (`cadPersistence.ts:226-230`), no load-time payload validation,
  no schema bump (additive-optional).

---

## 7. Manager / Toolspace / Ribbon / command-registration patterns

- Snapshot: `summarizeExplicitTinSource` (`cadSurfaceSnapshot.ts:216-245`),
  `surfaceBakeCapability` (`:250-257`).
- Manager: `CadSurfaceManager.tsx` bake paths (`:204-217`).
- Toolspace: `SurfaceDefinitionTree` (`CadToolspace.tsx:531+`).
- Ribbon: Definition Tools group (`CadRibbon.tsx:248-262`).
- Registry: `cadCommandRegistry.ts` (`:131,:152,:263,:395,:431,:487`).
- Transactions: `commitSurface`, `editSurface` deny-list, `checkSurfaceEditRevision`.

**Pattern:** engine transaction (gated) → registry command → ribbon/manager → snapshot text →
browser/agent tests. Composition is a sibling of Bake in Definition Tools.

---

## 8. Why arbitrary elevation discontinuities cannot be represented by the 2.5D TIN contract

A WebNet surface mesh is vertices `(x,y,z)` + index triangles, planar per triangle, elevation by
barycentric interpolation — a single-valued continuous piecewise-linear `f(x,y) → z`.

1. **Shared mesh edges** share vertex indices ⇒ same Z at seam endpoints. Steps unexpressible.
2. **Duplicate XY rejected**: `dedupeTinPoints` flags as `conflict` → `SURFACE_DUPLICATE_XY_CONFLICT`;
   explicit validator requires strict positive XY area (forbids wall faces).
3. **Delaunay indexes XY**: one point per XY by construction.
4. **Queries order-dependent at duplicated XY**: `getSurfaceElevationAt` returns first containing
   triangle — non-deterministic, forbidden by determinism contract.
5. **Vertical walls unqueryable**: `barycentric` denom 0 ⇒ `null`; degenerate grid bbox; zero
   projected area in volume clipping; adjacency symmetry fails.
6. **All two-surface math is XY-planar**: volume, analysis, contours, profiles, LandXML export.

Rejected alternatives: averaging (invents Z), snapping (silent discard + tolerance),
ramping/feathering (invented band/kernel geometry), vertical walls (unrepresentable).
All are silent geometric lies contradicting never-invent-Z / exact-deterministic / fail-closed
contracts. Correct response: refuse with `SURFACE_COMPOSE_SEAM_Z_MISMATCH` carrying ids +
location + both Zs + policy id.

---

## 9. Recommended composition engine placement and interfaces

New pure engine module `src/engine/cad/surfaceCompose.ts` (+ `surfaces/compose/` helpers):
PSLG construction → seam extraction + Z gate → `buildConstrainedTin` retriangulation →
derived-only owner classification. Worker `compose` op + `surfaceComposeService.ts` mirroring
volume-service ownership tuple. Transaction `SURFCOMPOSE*` mirroring bake gates.
Provenance `kind:'surface-compose'` widening `CadExplicitTinProvenance` additively
(kind/normalize/revision-part readers + snapshot/Toolspace text); `srev1:imported:` prefix frozen.

---

## REVIEWER-AGREEMENT — seam policy for sign-off

1. Composition output is one new explicit-TIN surface. Sources never mutated. One undo entry.
2. Composed domain is a hard XY ownership partition. No blending; every face has exactly one owner;
   Z comes from that owner's plane.
3. True seam = shared boundary of the ownership partition. Composable iff Zs agree at every seam vertex.
4. Disagreement fails closed with `SURFACE_COMPOSE_SEAM_Z_MISMATCH`. No averaging/snapping/ramping/
   feathering/vertical walls.
5. No user tolerance, no invented Z. Seam vertices are shared ⇒ exact equality structural.
6. Ambiguous overlap that cannot reduce to single-valued PL function is rejected; ownership is
   explicit policy in provenance.
7. Determinism: exact predicates, canonical ordering, local frames, stable revision namespace.
8. Gates mirror `SURFBAKE`: CURRENT at expected revisions, locks, non-empty result.
9. Verification: analytic oracles, `validateTinMesh`, dependent propagation, WNCAD round-trip,
   LandXML export, browser QA zero errors.
10. No source-kind or predicate churn: reuse explicit-tin + fail-closed predicate + shared
    validator/materializer/transform/bounds/export unchanged.
