# Phase 18S §2 — TIN edit-stack architecture

DOCUMENTATION ONLY. No `src/`, test, or code changes. Baseline: `origin/main`
`cef381780ef2a657b2e1ace3d5456746dde3038` on branch
`feat/cad-surface-tin-edit-stack`.

## 1. Current surface build sequence

### 1.1 `buildCadSurface` — `src/engine/cad/cadSurfaces.ts:172-350`

Step order, exactly as coded:

1. **Revision compute** (`:173`): `computeCadSurfaceSourceRevision(project, surface)`
   runs BEFORE any geometry. The returned `revision` stamps every exit path
   (ok / blocked / insufficient).
2. **Imported branch** (`:177-213`): when `isImportedTinDefinition(...)` holds,
   `materializeImportedTin(surface.id, ...)` (`src/engine/cad/cadImportedTin.ts:88`)
   rebuilds the mesh with NO Delaunay — vertices map 1:1, faces map 1:1.
   Null (invalid payload) → `blocked` + `SURFACE_TRIANGULATION_FAILED` with an
   empty mesh. Success returns early with bounds + stats + grid already
   materialized; none of steps 3-9 run on this path.
3. **Native source collection** (`:214`): `collectSources(project, surface)`
   (`src/engine/cad/cadSurfaceRevision.ts`) — point-source resolution with
   missing-Z skip, exact XY dedupe, breakline chains (Z must resolve, never
   invented), boundary outer/void rings + relation validation. Pure, no
   triangulation.
4. **Failure gates** (`:215-258`, in order): broken refs →
   `SURFACE_REFERENCE_MISSING`; XY conflict → `SURFACE_DUPLICATE_XY_CONFLICT`;
   breakline/boundary errors; <3 points → `SURFACE_TOO_FEW_POINTS`;
   collinear → `SURFACE_COLLINEAR_POINTS`. All gates return the same `fail`
   shape: empty points/triangles/adjacency/edgeKinds + empty grid.
5. **Canonical sort** (`:262-278`): collected points sorted by
   x → y → z → entityId (input-permutation invariant); breakline world
   indices remapped to canonical indices via an entityId → index map;
   `breaklinesCross` rejects non-vertex intersections →
   `SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX`.
6. **Constrained TIN** (`:278-286`): `buildConstrainedTin({ points, segments,
   outers, voids, maxEdgeLength, surfaceId })`. Failure →
   `SURFACE_TRIANGULATION_FAILED`.
7. **Synthetic tail** (`:288-306`): canonical points cloned; boundary tail
   appended with `entityId: tin.syntheticIds[i]` (`boundary:<surfaceId>:<n>`,
   `:293`); Steiner tail appended with
   `` `steiner:${surface.id}:${k}` `` (`:301`). Triangle indices already
   address the full (input + boundary + Steiner) array, so no index remap is
   needed here.
8. **Bounds scan** (`:308-322`): single pass over `finalPoints` for
   min/max X/Y/Z.
9. **Face stats + grid + return** (`:323-349`): `computeSurfaceFaceStats(
   finalPoints, tin.triangles)` spread over the count/bounds stats, and
   `buildSurfaceGrid(finalPoints, tin.triangles)` (`:347`). Returns
   `{ outcome, revision, reasonCodes, points, triangles, adjacency, edgeKinds,
   stats, grid }`.

### 1.2 `buildConstrainedTin` inner pipeline — `src/engine/cad/tin/tinBuild.ts:105-210`

1. `mergeBoundaryPoints(points, outers, voids, surfaceId)` (`:106`) — merges
   boundary-ring vertices into the point set; returns the XY-sorted appended
   tail + `syntheticIds` (`boundary:<surfaceId>:<n>`,
   `src/engine/cad/tin/tinBoundaries.ts:246`).
2. **Segment assembly** (`:108-118`): input breaklines tagged `kind:
   'breakline'`; one segment per ring edge tagged `'outer'` / `'void'`.
3. `splitAtInteriorVertices(points, segments)` (`:119`) — splits any
   constrained segment at exact-interior data/boundary vertices (exact zero
   predicate, no epsilon); kind inherited per piece.
4. **Canonical sort + dedupe** (`:124-137`): segments sorted by endpoint
   world coords, kind rank (`outer > void > breakline` via `codeOf`) breaking
   exact ties; overlap dedupe keeps the boundary win; degenerate `a === b`
   dropped.
5. **6-round loop** (`:139-209`, `maxRounds = 6`): per round —
   `buildTinBase(points)` (Delaunay) → `recoverConstrainedEdges(...)` (on
   failure with a Steiner candidate: append the Steiner point, split the
   target segment preserving kind, `continue`) → constrained map built with
   **max-kind priority** (`code > prior` wins, `:169-175`, so
   outer > void > breakline on shared edges) → `legalizeTin(...)` (`:178`) →
   `filterTinDomain(...)` (`:179-187`, flood fill + `maxEdgeLength` trim) →
   triangle index sort (`:189-193`) → `buildTinTopology(...)` (`:195`) →
   return `TinBuildSuccess`.
6. `TinBuildSuccess` (`:28-46`): `{ ok, points, syntheticIds, triangles,
   adjacency, edgeKinds, planimetricArea, steinerCount }`. Note: the
   constrained kind map is INTERNAL — it is consumed by `buildTinTopology`
   and `filterTinDomain` but NOT returned (see §3 companion).

## 2. Identity, insertion, domain, adjacency, grid/stats

- **Native vertex identity**: `CadSurfaceSourcePoint.entityId` is stable —
   survey-point entity id for data vertices (survives the canonical sort via
   the entityId → index map, `cadSurfaces.ts:270-287`); `boundary:<surfaceId>:<n>`
   for the merged boundary tail (positional within the XY-sorted tail);
   `steiner:<surfaceId>:<k>` for the recovery tail (positional discovery
   order). Only data-vertex ids are entity-stable across rebuilds; synthetic
   tails are positional and shift when the source set changes.
- **Imported-TIN vertex identity**: `` `${surfaceId}:v${i / 3}` ``
   (`cadImportedTin.ts:88-96`) — stable while the payload is unchanged
   (index-derived, so payload edits renumber trailing vertices).
- **Constrained-edge insertion**: inside the `tinBuild.ts:141` loop —
   `recoverConstrainedEdges` (`:147`) enforces breakline + boundary segments
   (with bounded Steiner restart), then the constrained map (`:169-175`)
   applies max-kind priority outer > void > breakline before legalization.
- **Boundary/void application**: `filterTinDomain`
   (`src/engine/cad/tin/tinDomainFilter.ts:28`) — `classifyTinDomain` flood
   fill retains iff reached by neither the exterior flood nor any void flood
   (outer/void edges are walls; free + breakline edges are crossed,
   `tinTopology.ts:83-110`), then over-long edges are trimmed when
   `maxEdgeLength` is set (`:38-45`).
- **Adjacency creation** (`buildTinTopology` call sites):
   `tin/tinBuild.ts:195` (native path, constrained map),
   `cadImportedTin.ts:103` (imported path, empty map — all edges FREE,
   exterior is adjacency `-1`), and internally `tinTopology.ts:83` inside
   `classifyTinDomain` (throwaway topology for the flood; not the returned
   mesh topology).
- **Grid/stats creation**: after topology on ALL paths — native
   (`cadSurfaces.ts:345,347`), imported (`cadImportedTin.ts:108-109` via
   `materializeImportedTin`), blocked/insufficient (empty grid via
   `buildSurfaceGrid([], [])`, `cadSurfaces.ts:191,231`).

## 3. Intended edit-stack pipeline + insertion point

Intended pipeline:

```
collect / materialize authoritative source
  → baseline triangulation + topology
  → source breakline / boundary / domain work   (already inside buildConstrainedTin)
  → APPLY ORDERED TIN EDIT STACK
  → final adjacency / edge flags
  → grid → stats → cache
```

**Recommended single insertion point**: `buildCadSurface`, between the
synthetic-tail final (`cadSurfaces.ts:306`) and the bounds scan (`:308`) on
the native path, plus the same call immediately after the
`materializeImportedTin` return value is obtained on the imported path
(`:177`, before the `:195` early return).

Justification:

- Single chokepoint for all three producers — worker
  (`src/workers/surfaceWorkerHandler.ts`), sync fallback
  (`src/workers/surfaceBuildService.ts:351`), and direct engine callers all
  route through `buildCadSurface`; one replay call covers every path.
- Revision is already computed (`:173`) and stamps the result, so edits that
  change geometry must ALSO change the revision (see companions) or the
  result would falsely claim CURRENT.
- Cache writers are generic (keyed on `surfaceId` + revision,
  `cadSurfaceSnapshot.ts:168,183,242`); no cache change is needed if the
  replayed mesh carries the post-edit revision.

**Required companions** (not this doc's scope; recorded so the implementer
does not replay against stale derivations):

1. Expose the constrained kind map from `TinBuildSuccess` (currently
   internal, `tinBuild.ts:169-175`) so post-replay `buildTinTopology`
   re-derivation preserves outer/void/breakline flags.
2. Add the edit stack to the `cloneCadSurfaceDefinition` whitelist
   (`src/engine/cad/cadSurfaceTypes.ts:23-51`) AND to both revision inputs —
   `computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts:315`) and
   `importedTinRevision` (`cadImportedTin.ts:71`) — otherwise edits are
   invisible to CURRENT checks.
3. Vertex identity must be entity-id based, not index-based: native replay
   keys on `entityId` (data ids stable; synthetic tails positional — edits
   referencing synthetic vertices must resolve post-tail or be rejected);
   imported replay operates on stored vertices/faces only (no entity refs —
   `collectSources` imported branch returns empty breaklines/boundaries,
   `cadSurfaceRevision.ts:105-131`).
4. Post-replay: remap triangles/adjacency/edgeKinds over the edited vertex
   set, then regenerate grid (`buildSurfaceGrid`) and stats
   (`computeSurfaceFaceStats`) — never reuse pre-edit derivations.

If the actual implementation requires a slightly different insertion point
(e.g. inside `buildConstrainedTin` before the triangle sort so edits compose
with domain filtering, or after the bounds scan reusing the scan), document
why here: the constraint is that replay must sit AFTER authoritative
source/topology exists and BEFORE grid/stats/cache, with the revision
covering the edits.

## 4. Revision, worker, consumer architecture

- **Revisions**: `computeCadSurfaceSourceRevision` → `srev1:<fnv1a>`
   (`cadSurfaceRevision.ts:315-363`; geometry-only: canonical point ids +
   coords, breakline chains, boundary rings, build options, broken-ref
   markers; styling excluded). Imported path delegates to
   `importedTinRevision` → `srev1:imported:<fnv1a>` over vertices + faces +
   provenance (`cadImportedTin.ts:71-81`). `surfaceContentRevision` is a pure
   alias (`cadSurfaceView.ts:176-180`). CURRENT iff the session cache holds
   `surfaceId` at exactly that revision (`cadSurfaces.ts:404-416`,
   `cadSurfaceView.ts:150-175`); a persisted CURRENT without a session mesh
   (or UNBUILT with a superseded mesh) degrades to NEEDS_REBUILD. **Meshes
   never persist** — reopen normalizes to `cachedRevision: null`
   (`cadSurfaceTypes.ts:72-83`).
- **Worker ownership** (`src/workers/surfaceBuildService.ts`): `pending` map
   keyed by surfaceId holds `{ requestId, revision, queued, startedAt }`
   (`:126-137`); `complete` runs the revision gauntlet — superseded /
   cancelled / disposed (`:419-420`), cross-drawing / deleted /
   source-changed (`:431-438`), worker-vs-entry revision mismatch
   (`:458-462`) all discard without caching. No transport (or oversized
   fallback) → `syncFallback` (`:351`) bounded by `SYNC_FALLBACK_POINT_LIMIT`
   with `fallbackBudget` (`:344-350`; imported budget = vertex count since
   the survey snapshot is unread on that path). Non-ok engine outcomes cache
   nothing; status derives from the definition.
- **Downstream consumers** key on the surface revision: contours re-derive
   over a CURRENT TIN (`docs/CURRENT_BEHAVIOR.md:491`); profiles / sections /
   volumes report `SOURCE_NOT_CURRENT` (with retained stale samples) when the
   surface revision moved (`cadTypes.ts:993,1099,1187`;
   `tests-browser/cad-profile-18j.spec.ts:146-176`,
   `tests-browser/cad-sections-18k.spec.ts:17`,
   `docs/evidence/phase18j-profile-architecture.md:118`,
   `docs/evidence/phase18k-cross-section-architecture.md:127`).
- **LandXML export** is CURRENT-only: civil TIN export
   (`src/engine/landxmlCadSerialize.ts` via `landxmlCad.ts`) emits retained
   surfaces from the cached mesh, and the Shell/Export-Center path requires a
   CURRENT cached mesh (`docs/evidence/phase18m-landxml-production-path.md:37`).
- **PROJECTTRANSFORM** (`src/engine/cadProjectTransform.ts:269-309`): clones
   the definition (`cloneCadSurfaceDefinition`), transforms imported-TIN
   vertices in place (`transformImportedTinVertices`, `:253-267`; Z kept),
   scales `buildOptions.maxEdgeLength`, and nulls `cachedRevision` (plus
   clears `buildDiagnostic`) — revision content-derivation retires cached
   meshes/contours and discards late old-frame worker results. Any edit stack
   stored on the definition therefore travels WITH the transform (cloned),
   while imported-vertex edits apply pre-transform coordinates and must be
   expressed in entity-id / stored-vertex terms to survive.

## 5. Engine-slice decisions (2026-09-20)

- Insertion point is exactly the §3 recommendation: `replaySurfaceEdits`
  (single chokepoint in `cadSurfaces.ts`) with two call legs — imported
  (after `materializeImportedTin`, before bounds/stats/grid) and native
  (after the synthetic tail, before the bounds scan). The imported leg
  recomputes face stats + grid from the same deterministic functions instead
  of reusing the pre-edit derivations (identical output when edits absent).
- Applicator split for the ≤400-line rule: `cadSurfaceEdits.ts` (status
  model + swap/delete + sequential driver), `cadSurfaceEditMesh.ts`
  (mutable triangle table + canonical edge map + stable-identity
  resolution), `cadSurfaceEditAddLine.ts` (crossed-FREE-region walk + ear
  clipping; the Delaunay recovery kernel was not factorable for replay).
- Sign convention: `robust-predicates` `orient2d` is positive for
  math-CLOCKWISE (see `tinPredicates.ccwSign`); all winding enforcement uses
  `orient2d < 0` = CCW. Straddle/convexity/crossing tests are
  sign-agnostic and unaffected.
- Oracle note: cocircular XY quads (e.g. perfect squares) have an
  implementation-defined Delaunay diagonal that can flip under rotation, so
  similarity-parity oracles use a non-cocircular quad.
