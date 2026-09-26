# Phase 18W — Boundary / Breakline Source-Editing Architecture

Baseline: `origin/main` @ `8ea69d69` (PR #113 merge, Phase 18V). No advance at branch creation.
Branch: `feat/cad-surface-boundary-breakline-editing`.
Status: architecture audit (no code yet). All paths verified read-only against baseline.

## 1. Current source ownership

Native surface authority is `CadSurfaceDefinition` (`src/engine/cad/cadTypes.ts:885-903`):

```ts
{ pointSource, breaklines?, boundaries?, buildOptions?, edits?, sourceKind?: 'native'|'imported-tin', importedTin? }
```

Three ownership categories for 18W (matches mission §3):

- **A. Point-chain breakline** — Surface owns membership/order
  (`pointEntityIds: CadEntityId[]`, `cadTypes.ts:844-846`). Coordinates owned by
  Survey Point entities. Breakline row: `{ id, source, type: 'standard', name? }`
  (`:848-853`, only `'standard'` in 18F).
- **B. Entity-backed boundary** — Surface owns only
  `{ type: 'outer'|'void', sourceEntityId }` (`:855-858`, no name/id — identity is
  `(type, sourceEntityId)`). Ring geometry owned by the referenced CAD entity.
  Same split applies to entity-backed breaklines (`source.kind: 'entity'`).
- **C. Imported TIN** — `sourceKind === 'imported-tin'` + `ImportedTinPayload`
  (`vertices` xyz triples, `faces` CCW triples, `:879-883`). No native source
  editing; 18S/T/V final-mesh edits remain the allowed mechanism.

## 2. Point-chain breakline XYZ resolution

`collectSources` (`src/engine/cad/cadSurfaceRevision.ts:93-306`):

1. Point source resolves first (`:148-176`): `points`-kind by entity id
   (missing → `brokenRefs 'point:'+id`); group-kind unions sorted group ids.
   Missing-Z filter increments `skippedMissingZ`, then `dedupeTinPoints`.
2. Breaklines (`:190-236`): point-chain refs copied verbatim; each ref hits
   `indexOfEntity ?? indexOfStation`, else `resolveRefId` (entity id, then station
   id, `:47-51`). Consecutive duplicates collapsed. Any ref unresolvable or with
   non-finite coordinate → whole chain blocked (`SURFACE_BREAKLINE_MISSING_Z`).
   XY seen before with different Z → `duplicateConflict` + chain blocked.
   Resolvable-but-new points are **appended** to `resolved` (breakline-only Survey
   Points join the TIN without belonging to `pointSource`). Chain `< 2` →
   `SURFACE_BREAKLINE_INVALID`.
3. Implication for 18W: insert/append/remove/reorder/reverse/replace-chain are pure
   `pointEntityIds` array edits. No XYZ is ever stored in the definition; moving a
   Survey Point via normal point editing changes resolved XYZ with a
   byte-identical definition (revision changes because revision embeds resolved
   `entityId@x,y,z`, §6).

## 3. Entity-backed breakline ref resolution

`breaklineEntityRefs` (`cadSurfaceRevision.ts:53-65`):

```ts
metadata.sourcePointIds (strings) ++ line: [fromStationId, toStationId]
  ++ polyline/polygon/parcel: vertexLabels (positional, per-vertex order)
```

Arc/other types fall back to metadata only. Collection then resolves each ref
exactly as §2 (entity id → station id → missing-Z block). Consequences:

- Arbitrary entity vertex XY with invented Z is **never** breakline truth; only
  stable Survey Point refs count.
- `classifyBreaklineChainZ` (`cadSurfaceView.ts:468-495`) requires
  `metadata.sourcePointIds.length === vertex count` for polyline chains (F2F
  blocked unless explicit `allowF2F`); UI add-from-entity is gated on `chain.ok`.
- 18W conversion rule: offer "Convert to Point Chain" only when the resolved ref
  list is deterministic and `length >= 2` with all finite Z; result keeps breakline
  id/name/type, source becomes `{ kind: 'point-chain', pointEntityIds: [...] }`,
  original CAD entity untouched, one undo transaction. Otherwise block with a
  readable reason — never invent points from entity XY.

## 4. Boundary XY resolution

`boundaryRingOf` (`cadSurfaceRevision.ts:67-89`): polyline/polygon/parcel →
`vertices.map(v => ({x, y}))`, Z ignored entirely. Other types → `null` →
`SURFACE_BOUNDARY_INVALID`. `dedupeRing` collapses consecutive duplicate XY and
pops a closing duplicate; no rotation canonicalization, no non-adjacent dedupe.
Collection (`:260-302`): missing entity → `brokenRefs 'boundary:'+id`;
post-dedupe `< 3` distinct → `SURFACE_BOUNDARY_INVALID`; rings pushed to
`outers`/`voids` in definition order. Then `validateRingRelations` mapping
(`:285-292`) plus a void-centroid-inside-outer check (`:293-305`).

18W consequence (§23/84): **do not duplicate the ring into the definition**.
`sourceEntityId` stays authoritative — preserves revision, transform, CAD
ownership, and WNCAD simplicity. No point-chain boundary source in 18W.

## 5. Ring / crossing validation seams (reuse, do not duplicate)

- `validateRingRelations` (`tin/tinBoundaries.ts:100-148`): first-problem-only
  (`outer-invalid | void-invalid | breakline-crossing`). Self-intersection per
  ring, outer↔outer, void↔void, outer↔void; each breakline vs outer/void.
  Robust `orient` predicates; T-touch/spike-back without exact shared vertex is
  illegal. Breakline↔breakline is **not** handled here.
- Breakline↔breakline: `breaklinesCross` (`cadSurfaces.ts:462-503`), O(n²)
  pairwise on ordered chains; shared-edge skipped; mid-edge touch of one
  non-shared endpoint blocks; any on-segment endpoint contact without sharing
  blocks. Failure code `SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX`
  (`cadSurfaces.ts:42-54`). Crossing **with** a shared Survey Point in both chains
  is valid.
- 18W preflight must mirror these two seams exactly (candidate outer/void rings +
  candidate chains through the same pure functions). No UI-specific weaker
  validator, no epsilon snap, no survey tolerance.
- Pure chain self-intersection check (new, small): reject standard-chain segments
  that properly cross another segment of the same chain without sharing an
  endpoint, using the same `orient` helpers.

## 6. Source revision

`computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts:308-352`, `srev1:fnv1a`):

- Native parts: `points:<entityId@x,y,z;…>` (XY-sorted), `groups:`,
  `breaklines:` (per-chain resolved `entityId@x,y,z` join — **no breakline id,
  name, or type**), `outer:` / `void:` ring text (start-vertex/rotation and
  definition-order sensitive — conservative, never stale-prone), `opt:`,
  `broken:`, `edits:` (`describeEditForRevision`, `cadSurfaceEditDescribe.ts`).
- Imported: `importedTinRevision` (id + vertices + faces + provenance + edits).
- Status is derived, never persisted: `deriveSurfaceStatus`
  (`cadSurfaces.ts:505-530`, `cachedRevision == null → UNBUILT`, mismatch →
  `NEEDS_REBUILD`); UI truth in `cadSurfaceView.ts:131-169`.
- Geometry mutations null `cachedRevision` via `editSurface(..., geometry=true)`
  (`cadTransactionsSurfaceCommands.ts:37-60`).
- 18W findings:
  - **Rename is revision-neutral by construction** (names excluded). New
    `SURFACE_RENAME_BREAKLINE` must still commit through drawing history (undoable)
    but pass `geometry=false` so a rename alone never stales the surface. Pin with
    a test.
  - **Reverse/reorder/insert/remove change revision** (resolved chain text
    changes) → rebuild. Preferred over direction-canonicalization cleverness;
    final TIN must be numerically equivalent for reverse (pin).
  - New commands must not forget `geometry=true` — in-session the mesh cache is
    the visible truth, so a missed flag leaves the surface reporting CURRENT with
    a stale mesh on screen.

## 7. Generic polyline/polygon vertex editing — exists, reuse it

`EDIT_ENTITY` (`cadTransactionsEditCommands.ts:24`) already supports
`polyline-vertex` (`~:248`, index-addressed `vertices[index]`, then
`syncEditedEntityDependencies`). Central gate `checkCadEntityEditable`
(`cadAppearance.ts:79` → `LAYER_LOCKED` / `ENTITY_HIDDEN`) rejects all kinds.
Viewport grips exist: `buildCadGripHandles`
(`cadTransactionsEntityTransforms.ts:271`, polyline/polygon/parcel vertices),
drag lifecycle in `SurveyCadPreviewCanvas.tsx:280-310`, commit = one `GRIP_EDIT`
entry. Multi-entity transforms group via `commitCadSelectionTransform`
(`cadTransformApply.ts:349`).

18W boundary vertex move/insert/delete therefore ride the **existing source-entity
transaction path** (`EDIT_ENTITY polyline-vertex` / `GRIP_EDIT`), NOT a new
`CadSurfaceEdit` kind (§130: zero new edit-stack operations for source edits).
Vertex identity is index-based and short-lived: capture
`(sourceEntityId, expected revision/signature, vertex index)`, verify before
commit, reject-and-repick on mismatch; never persist vertex indices.

Gap: `EDIT_ENTITY` has **no parcel branch** (vertex edits are polyline-only);
parcel vertices move only via `GRIP_EDIT → updateEntityFromGrip → rebuildParcelMetrics`
(`:218`, `:115`). 18W does not need either path for parcels — parcel-backed
boundaries are reference-only from Surface tools (§8).

## 8. Parcel-backed boundary risk → safety gate

`CadParcelEntity` (`cadTypes.ts:344-354`): vertices + `vertexLabels` + derived
`areaSquareMeters/perimeterMeters/closure*`. Parcel geometry may carry
property/legal significance; code documents geometric-only handling
(`survey-drafting.md:166-168`, `webnet-cad-layout-plotting.md:88`,
`phase18l-landxml-support-matrix.md:20`), and there is **no legal-protection
semantic in code** — so 18W enforces a semantic (not merely layer-lock) gate:

- Boundary source is a Parcel → Manager shows `Source: Parcel`, geometry editing
  disabled; actions limited to Remove / Make Independent Copy / Zoom-Select.
- Even on an unlocked layer, the Surface Boundary editor never mutates Parcel
  vertices. Zero allowed (GO gate §131).
- `SURFBOUNDARYMAKEINDEPENDENT`: create a new ordinary `CadPolygonEntity`
  (preferred; closed `CadPolylineEntity` only if polygon semantics prove
  unwanted — document choice) with source layer or Surface-associated layer and a
  sensible name; atomically rebind `sourceEntityId`; original untouched; one undo
  transaction. Parcel metrics recompute is irrelevant since the Parcel is never
  touched.

## 9. Reference-sharing risks

- `SURFACE_ADD_BOUNDARY` replaces existing outer but allows duplicate void entries
  for the same entity; `REMOVE_BOUNDARY` without `sourceEntityId` removes **all**
  of that kind (`:340-349`) — pin in tests, preserve.
- New pure helper `surfaceDefinitionReferencesToEntity` (or repo-consistent
  equivalent): counts boundary source refs + entity-backed breakline refs across
  surfaces. Manager Boundary table shows `Shared Uses`; editing a shared plain
  source requires explicit confirmation (`Edit Shared Source` /
  `Make Independent Copy`); never silently clone, never silently mutate.
- Shared edit lifecycle: both surfaces' revisions change → both `NEEDS_REBUILD`,
  downstream stales appropriately (pin). Independent copy isolates one surface
  (pin).
- Generic `ERASE` of a source entity leaves `BROKEN_REFERENCE`
  (`findSurfaceBrokenRefs`, `cadSurfaceView.ts:~96-116`) — correct default; delete
  warning integration only if it fits existing guards without ballooning scope.

## 10. Imported-TIN exclusion

UI exclusion exists (`CadSurfaceDefinitionEditor.tsx:38-46`, snapshot flag
`cadSurfaceSnapshot.ts:37,351-357`, toolspace `CadToolspace.tsx:533`).
**Gap: no command-layer guard** — `surfaceAddPointsCommand` /
`surfaceAddBreaklineCommand` / `surfaceAddBoundaryCommand` and `editSurface`
never check `sourceKind` (`grep -i imported cadTransactionsSurfaceCommands.ts`
→ no matches). 18W adds engine-level rejection of native source-definition
mutations on imported-TIN definitions (new breakline/boundary commands included),
while 18S/T/V final-mesh edits stay allowed (`CadSurfaceDefinitionEditor.tsx:36-38`).
Zero mutation of `ImportedTinPayload.vertices/faces` from boundary/breakline
commands (§129); grey out Add/Convert/Make-Independent in imported-TIN Manager.

## 11. Rebuild lifecycle (reuse, no local patching)

`SurfaceBuildService` (`src/workers/surfaceBuildService.ts:77`):
`rebuildSurface` → cache-hit short-circuit → revision → transport → worker
(`surfaceWorkerHandler.ts:968 → :410 buildCadSurface`, same chokepoint as the
`SYNC_FALLBACK_POINT_LIMIT = 1000` sync fallback) → `complete` guards
(drawing-id + revision equality; late/old results discarded). Wiring in
`SurveyCadWorkspace.tsx:458-489,1230,1393,1402,1540`; ribbon/manager/toolspace
entry points as scouted.

Native build (`cadSurfaces.ts:334-459`): failure ladder brokenRefs →
duplicateConflict → breaklineError → boundaryError → too-few → collinear;
canonical sort → chain→segment remap → `breaklinesCross` gate →
`buildConstrainedTin` (`tinBuild.ts:112-232`: boundary-point merge → segment
split at collinear interior vertices → canonical sort/dedupe with boundary-wins
ties → up-to-6 recovery rounds → legalize → domain filter → topology) →
`replaySurfaceEdits` (`:406`, AFTER base topology, BEFORE grid/stats/cache).

18W policy (§56-57): source commits null `cachedRevision` → `NEEDS_REBUILD` →
normal async rebuild. No dynamic constrained-TIN patching. Drag preview shows
ring geometry + cheap validation only; full pre-commit builds only under a
bounded, documented threshold (§60-61); at minimum cheap exact ring validation
pre-commit, async rebuild owns triangulation.

## 12. 18S/T/V replay order (unchanged)

`replaySurfaceEdits` (`cadSurfaces.ts:189`) → `applyCadSurfaceEdits`
(`cadSurfaceEdits.ts:171`): sequential, first **enabled** failure throws
`CadSurfaceEditFailure` (`:88`), disabled edits skip. Stable keys only
(`source:` / `imported:` / `edit:`); synthetic vertices and XY-proximity fail
closed. `compactEditResult` (`~:260`) prunes/renumbers. 18V bulk kernels in
`cadSurfaceEditBulk.ts` (dedupe + lexicographic order, spatial-index crossing
discovery). Revision already covers edits, so staleness re-derives automatically.
18R transforms only coordinate-bearing edits (`cadSurfaceEditTransform.ts:17`).

18W consequence: source rebuild replays the persisted stack in order, unchanged.
If a source edit invalidates a later edit (e.g. boundary removes its region),
the build fails closed with the existing precise reason — never silently discard.
Preflight the full build including edits where the bounded-threshold policy
permits (§59); document the threshold.

## 13. Downstream invalidation (existing wiring only)

All derived per publish, never persisted: profiles/sections
`SOURCE_NOT_CURRENT` (surface not CURRENT) / `NEEDS_REBUILD` (revision drift);
volumes `SOURCE_NOT_CURRENT` / `NEEDS_RECALC`; 18U analyses same pair via
`resolveAnalysisSourceStatus`; contours session-cache auto-derive on revision
miss with STALE badge. Notifies are ref-diffed in `SurveyCadWorkspace`. 18W adds
no custom invalidation code — source revision already drives it; pin with
contour/analysis/volume/profile/section oracles (§103-107).

## 14. WNCAD implications

Schema `1|2`, writes always 2 (`cadDrawingFile.ts`); no 18S/T/V bump
(`cadSurfaceTypes.ts:9-12`). Surfaces persist refs-by-id inside
`project.entities`; `cloneCadSurfaceDefinition` deep-clones
sourceKind/importedTin/pointSource/breaklines/boundaries/buildOptions/edits with
order-authoritative arrays; `clearSurfaceBuildCacheOnLoad` prevents false
CURRENT on reopen. 18W: point-chain membership/order and new polygon copies
persist as ordinary entities — **preferred: no schema bump**. Save/reopen pins:
breakline chain exact order → equivalent TIN; outer + voids vertex edits →
same retained domain; independent copy → Parcel unchanged, new polygon
referenced, equivalent rebuild.

## 15. Transform implications (18R)

`transformSurface` (`cadProjectTransform.ts:270`): clones definition, refs
(`sourceEntityId` / `pointEntityIds` / breakline refs) **never rewritten**;
only coordinate-bearing edits, imported-TIN vertices, and
`maxEdgeLength × scale` change; `cachedRevision` nulled. Determinant > 0 gate.
Commutativity requirement: transform-then-rebuild ≈ transform-final-domain for
supported horizontal transforms; Grid/Ground leaves Z unchanged. 18W adds no
stored XY to the definition, so point-chains and boundary refs survive
transforms by construction — pin with a test.

## 16. UI architecture (delta from baseline)

- Baseline: `CadSurfaceDefinitionEditor.tsx` (275 lines, single component) with
  row-based breakline/boundary lists; ribbon Definition buttons only
  `openManager`; no `SURFBREAKLINE`/`SURFBOUNDARY` commands; registry pattern is
  type-union (`cadTransactions.types.ts:~811`) → definition object
  (`cadTransactionsSurfaceCommands.ts`, map `:648-653`) → executor map
  (`cadTransactions.ts:589-592`) → optional `CAD_SHELL_COMMANDS` entry.
- 18W deltas: split editor into Breakline/Boundary sections per file-structure
  rules; dense tables with specified columns/actions (§110-113); chain editor
  (live Survey Point E/N/Z, no coordinate copies); boundary vertex editor
  (E/N rows, Apply = one transaction); viewport grips only during explicit edit
  sessions; breakline highlight = transient chain overlay (no Style feature);
  Toolspace Definition tree gains Breaklines/Boundaries nodes (§118), never under
  Edits; Properties gains counts + selected-row source info; derived
  VALID/BROKEN_REFERENCE/MISSING_Z/INVALID_GEOMETRY/INTERSECTION statuses reuse
  engine reason codes (§120).
- New commands (and only these): `SURFBREAKLINE`, `SURFBREAKLINEEDIT`,
  `SURFBOUNDARY`, `SURFBOUNDARYEDIT`, `SURFBOUNDARYMAKEINDEPENDENT` — manager
  transactions shared, no alias sprawl. Note `editSurface` is at the 5-parameter
  warning line — new surface commands extract an options object rather than
  extend it.

## 17. What 18W explicitly does NOT build

No `CadSurfaceEdit` kinds for source edits; no wall/proximity breaklines; no
invented Z (0 / interpolated / nearest); no XY-click point creation; no local
TIN patching; no boolean/offset/buffer editor; no boundary Z; no smoothing /
densification / spline; no associative point-linked boundary (copies are labeled
"Copied from Survey Points"); no second status vocabulary.

## 18. Implementation order

1. Engine pure validation (`breaklineChainValidation.ts`-style new file:
   duplicate-ref, self-intersection via existing orient helpers) + reference-count
   helper + imported-TIN command guard.
2. Breakline transactions (rename/insert/remove/reverse/replace/convert) +
   engine tests (insert/remove/reverse/crossing/Z oracles).
3. Boundary transactions (create-source+attach, replace-source, independent
   copy, parcel/shared guards) reusing `EDIT_ENTITY polyline-vertex`; ring
   candidate validator seam over `validateRingRelations`; engine tests
   (rectangle/collinear/concave/delete/self-intersection/void/multi-void/parcel/
   shared oracles).
4. UI (editor split, commands, ribbon/toolspace/properties, grips sessions,
   previews) + browser spec `tests-browser/cad-surface-definition-editing-18w.spec.ts`.
5. Perf evidence (§123-125) + 3-resolution visual QA + reviewer gate (§146).
