# Phase 18T point-edit architecture (evidence, not a new 18S campaign)

Baseline: `origin/main b3ff6e93446ecc3bfad7d89c0ac3a7e959adedd2` (PR #110 merge).
Branch: `feat/cad-surface-point-elevation-edits`.

## 1. 18S re-audit (verified in merged code, all TRUE)

- One replay chokepoint: `replaySurfaceEdits` (`src/engine/cad/cadSurfaces.ts:189`)
  called only from `buildCadSurface` (`:251` imported, `:391` native). Worker
  (`surfaceWorkerHandler.ts:347`), sync (`surfaceBuildService.ts:543`), direct
  (`cadLandxmlCommit.ts:202`) all route through `buildCadSurface`.
- Ordered semantics: sequential loop `cadSurfaceEdits.ts:207-228`.
- Source constraints: swap blocks constrained diagonals (`:118-121`), delete
  blocks (`:160`), add-line blocks crossings (`:86-105`); map re-emitted (`:239-246`).
- Stable identity: `resolveEditVertex` accepts only `source:`/`imported:`
  (`cadSurfaceEditMesh.ts:52-79`); inverse `surfaceEditRefOfPointId`
  (`cadSurfaceEditPicking.ts:60-70`).
- No triangle-index persistence; worker/direct/sync parity (pinned
  `tests/cad_surface_edits_18s.test.ts:567`); incremental edge map
  (`indexEditTri`/`unindexEditTri`); downstream invalidation keyed off
  `computeCadSurfaceSourceRevision`; CURRENT-mesh pick gate
  (`useSurveyCadSurfaceEditSessions.ts:134-140`, `checkSurfaceEditRevision`).
- 18S kernel statement ("Coordinates never change") lived at
  `cadSurfaceEditMesh.ts:9-11` and `cadSurfaceEdits.ts:20-24`. 18T removes that
  restriction: `EditMeshState` now owns mutable `pts` (cloned at replay start;
  baseline source objects and `ImportedTinPayload` never mutated).

## 2. 18T model

- 5 additive edit kinds (`cadTypes.ts`): `add-point {x,y,z}`,
  `delete-point {vertex}`, `move-point {vertex,x,y}`,
  `set-elevation {vertex,z}`, `raise-lower-surface {deltaZ}`.
- Edit-created identity: `edit:<surfaceId>:<editId>` (edit ID, not index/XY);
  stable across rebuild/save/triangle/input reorder/stack moves. Resolved by the
  SAME resolver (extended, no second resolver); `boundary:`/`steiner:` stay
  blocked; picking round-trips `edit:` exactly (`editPointIdOf`).
- Replay returns final edited point array; `buildCadSurface` derives
  bounds/stats/grid/adjacency/edgeKinds/interpolation from it. Final compaction
  drops inactive/deleted vertices and remaps triangles + constraint map.
- Add-point: inside-split 1->3 (CCW), free-edge split 2->4; blocks outside/void,
  boundary, constrained, coincident XY (incl. different Z — 2.5D). orient2d
  predicates, no survey tolerance.
- Delete-point: interior-only, >=3 neighbors, no constrained incident edge,
  ear-clip cavity (boundary preserved, diagonals FREE); retriangulates, never holes.
- Move-point: XY-only, valid one-ring kernel (all incident tris keep positive
  area), no coincidence/crossings; else BLOCK (use Delete+Add).
- Set-elevation: absolute override (survives source Z changes), topology unchanged,
  allowed on breakline endpoints. Raise/lower: deltaZ to every active vertex
  incl. synthetic; order-sensitive. User-added lines stay non-source constraints.
- Fail-closed: first enabled unreplayable edit fails the build; disabled skips.
  Revision covers all new fields in both `cadSurfaceRevision.ts` and
  `cadImportedTin.ts` via one serializer (`cadSurfaceEditDescribe.ts`).
  `cloneCadSurfaceDefinition` extended per kind. WNCAD stores semantic records
  only (~207 B/record, mesh-independent).
- PROJECTTRANSFORM (GO gate): `transformCadSurfaceEdits`
  (`cadSurfaceEditTransform.ts`) maps add/move XY exactly once, leaves refs/Z/delta;
  Helmert + Grid/Ground branches; no Z scaling.
- Dependency inspector: `cadSurfaceEditDeps.ts` (created/consumed `edit:` keys,
  missing/disabledProducer) drives manager warnings; reorder consumer-before-
  producer blocked; delete/disable warns (no cascade).
- UI: SURFADDPOINT (interpolated-Z default, Enter = no shape change),
  SURFDELETEPOINT, SURFMOVEPOINT, SURFSETELEV ("Surface-only elevation override"),
  SURFRAISELOWER (explicit confirm); all CURRENT-gated with stale-revision re-pick;
  one transaction per op; manager dense table + E-numbers; Properties counts only.
- Measured perf (replay/total; 18S ref 100k/1000-edge ~693 ms): 100k set1000
  replay 543 ms (linear), add/delete linear; move-point crossing guard full-scans
  `state.tris` per neighbor -> O(moves x triangles) (100k/move100 ~8 s). Documented
  in `docs/evidence/phase18t-performance.md` with `ponytail:` upgrade note; no CI gate.
- Restrictions hold: no synthetic/boundary/breakline XY editing, no smoothing,
  no paste/merge, no simplification, no arbitrary re-triangulating move, no
  apply-edits-to-source, no Adjustment changes (parity 25/25).
