# Phase 18V — Bulk / Region Surface Edit Architecture

Baseline: `origin/main` @ `a34ec79b` (PR #112 merge, 18U landed). Branch `feat/cad-surface-bulk-region-editing`.
Status: audit only. No code changed by this doc.

## 1. Current single-point edit model

`CadSurfaceEdit` (`src/engine/cad/cadTypes.ts:1010-1018`) has 8 members: `swap-edge`
(:930), `add-line` (:936), `delete-line` (:945), `add-point` (:961), `delete-point`
(:971), `move-point` (:980, XY-only absolute target), `set-elevation` (:990),
`raise-lower-surface` (:1001, whole-surface `deltaZ` over every active vertex
*including synthetic*, `cadSurfaceEditPointModify.ts:195-200`).

One operator commit = one `SURFACE_ADD_EDIT` transaction against a fresh revision;
stale revision blocks with re-pick (`surfacePointEditSessionUtils.ts:23`,
`stageMoveTarget` :307). Edit-stack array order is authoritative and is the replay
order. Enable/disable is per-row; reorder is dependency-checked in UI only
(`CadSurfaceEditTable.tsx:35,50`). 18T sessions
(`useSurveyCadSurfacePointEditSessions.ts:40-67`, state
`surfacePointEditSessionUtils.ts:75`) stage targets on overlays; nothing mutates the
cached mesh — commit marks `NEEDS_REBUILD`, the worker rebuilds.

## 2. Stable vertex identity model

`CadSurfaceVertexRef = {key}` (`cadTypes.ts:918`). Three addressable schemes,
resolved by `resolveEditVertex` (`cadSurfaceEditMesh.ts:69-88`):
`source:<surveyId>`, `imported:<payload>:v<index>`, `edit:<surfaceId>:<editId>`
(built by `editPointIdOf`, :96). `boundary:`/`steiner:` are synthetic and throw
`SURFACE_EDIT_SYNTHETIC_VERTEX`. Inverse map `surfaceEditRefOfPointId`
(`cadSurfaceEditPicking.ts:66-83`) returns null for synthetic. Picking already
refuses synthetic (`{blocked:'synthetic'}`), never producing a ref.

18V rule (GO gate): region selection resolves to stable refs **at commit time**;
the persisted bulk edit stores the ref array only — never a polygon/window query.

## 3. Current point picking performance

`nearestVertex` (`cadSurfaceEditPicking.ts:100-113`) is a linear O(points) scan;
`nearestEdge` (:169-191), `kindOfMeshEdge` (:132-153), `adjacentCountOf` (:155-167)
are all O(triangles) per pick. Tolerance = max(1% extent, 0.5) (:86-91). Fine for
occasional picks; region selection (window/polygon over N vertices) is O(N) points
× O(polygonEdges) worst case — acceptable at 100k for modest polygons, with a mesh
bbox prefilter. Measure in §98 matrix; add a point index only on evidence.

## 4. Move Point crossing algorithm (root cause)

`applyMovePoint` (`cadSurfaceEditPointModify.ts:134-186`): gates (active, finite,
boundary via `hasBoundaryEdge`, constrained via `hasConstrainedEdge`, exact `===`
coincidence scan :139-143), valid-star kernel check (substitute target,
`orient2d >= 0` ⇒ `INVALID_STAR` :157-165), then the crossing guard :167-178:

```
for (const w of neighborsOf(state, v))        // moved edges v->w
  for (const [, tri] of state.tris)           // EVERY active triangle
    for (each of 3 edges)
      if (properlyCrosses(moved, edge)) throw INTERSECTION
```

`properlyCrosses` (:122-131) is 4 exact `orient2d` calls, all nonzero, opposite
signs — no epsilon. Correct + fail-closed; discovery is global:
**O(movedEdges × tris × 3)** exact tests per move, plus O(points) coincidence.
Measured 18T: 100 moves on 100k verts ≈ 8 s. Single-move and bulk-moves both pay
it. 18V replaces *candidate discovery only*; the predicate is untouched.

## 5. Command selection primitives (what exists)

`CommandSession` discriminated union (`useSurveyCadCommandTypes.ts:127`);
`sessionExpectsPointPick` (:75) routes canvas clicks; `handleSurveyCadConsumePoint`
(`useSurveyCadConsumePoint.ts:171`) accumulates chains (PLINE/TRAVERSE/AREA).
Entity selection is `CadSelectionState { selectedEntityIds }` (`cadSelection.ts:3`),
undo-snapshotted, with window/crossing box select over *entity primitive screen
bboxes* (`SurveyCadPreview.geometry.ts:188`; box drag disabled while
`commandActive`, `SurveyCadPreviewCanvas.tsx:205`). **No surface-vertex selection
state exists** (0 hits); surface picks are session-staged facts. Box select does
not see mesh vertices/triangles (no bbox participation).

## 6. Intended selection ownership (18V)

New session/UI-only `SurfaceVertexSelection { surfaceId, revision, refs[] }`
(canonical lexicographic order, deduped at commit). NOT in WNCAD, NOT in
`CadSurfaceDefinition`, NOT in undo history. Bulk commands read the selection at
commit against the *current expected revision*; any surface/source change after
selection ⇒ `SURFACE_EDIT_STALE_REVISION`-style block, reselect required (§35/§101).
Window = inclusive-rect inside test on current final-mesh points; polygon =
deterministic point-in-polygon, boundary included, self-intersecting blocked;
Select All = all stable editable refs (synthetic excluded, reported as
`N editable / M synthetic excluded`). Source-kind filters (All/Source/Imported/
Added) only — no query language. Crossing ≡ window for points (no fake
distinction, §37).

## 7. Persisted bulk-edit representation (first-class, one row per action)

```ts
// names follow repo convention; canonical lexicographic refs[], deduped
{ kind:'set-elevation-many', vertices: CadSurfaceVertexRef[], z }
{ kind:'raise-lower-points', vertices: CadSurfaceVertexRef[], deltaZ }
{ kind:'move-points',        vertices: CadSurfaceVertexRef[], deltaX, deltaY }
```

Zero refs ⇒ no edit, no undo entry ("No editable surface vertices selected").
Bulk raise/lower-selected is distinct from whole-surface `raise-lower-surface`
(which keeps affecting synthetic). "Flatten" is UI label over `set-elevation-many`.
No per-vertex enabled flags; disable skips the whole row. Missing ref at replay ⇒
`SURFACE_EDIT_VERTEX_MISSING`, whole surface build fails closed (no partial apply).
Dependency inspector consumes ref arrays (producer add-point before consumer bulk
row ⇒ reorder BLOCK, delete/disable warns). Revision serialization: kind + enabled
+ canonical refs + z/deltaZ/dx/dy; no selection geometry. `PROJECTTRANSFORM`: refs
+ Z/deltaZ invariant; move delta is a **displacement vector** — rotation+scale only,
no translation component (§63-65). Grid/Ground scales dx/dy only.

## 8. Simultaneous Bulk Move model

Persist deltas, not absolute XY: replay translates each ref from its coordinates
*at that stack position* (ordered semantics preserved). Commit builds the proposed
map `vertexIndex -> {x: oldX+dx, y: oldY+dy}` for ALL selected vertices first;
validation reads proposed-for-selected / current-for-unselected; **no state
mutation until validation passes**; then all XY commit atomically. Sequential
`applyMovePoint` per vertex is FORBIDDEN (intermediate states can falsely fail —
pinned by oracle §89).

Eligibility (all-or-nothing): every selected vertex must be active, non-synthetic,
non-boundary, non-void, and free of source-constrained incidence — else the whole
operation blocks with a class-specific reason (never silent drop).

Validation of the proposed final state:
- one-ring orientation: every triangle incident to ≥1 selected vertex, with all
  proposed coordinates substituted, must keep strict positive plan area
  (generalizes the 18T valid-star rule);
- frontier edges (selected→unselected) and translated selected edges must not
  properly cross unrelated mesh edges (exact `properlyCrosses` authority);
- no selected-final coincidence with active unselected vertices; no pairwise
  selected-final coincidence (rigid translation makes this degenerate-only, still
  checked). Rigidly-translated selected–selected edges are skipped as self (length
  / direction invariant).

## 9. Dynamic edge spatial index (`EditEdgeSpatialIndex`)

**What it indexes:** unique active mesh edges — identity = canonical edge key from
`state.edgeMap` (one record per unique edge, never doubled for shared interior
edges). Record: `{ edgeKey, u, v, minX, minY, maxX, maxY }`.

**Structure:** deterministic uniform hash grid. Sizing from mesh bounds + edge
count (target ~O(sqrt(edgeCount)) cells along characteristic extent; viewport- and
randomness-free; large coordinates E≈2M/N≈7M via bounds-relative integer cell
coords, no 32-bit packing). Cell size affects performance only, never correctness.

**Contract:** may return false positives, NEVER false negatives. Query = segment
bbox → candidate edge keys → exact `properlyCrosses` decides. No tolerance
skipping (GO gate).

**Lifecycle:** lazy — built on first Move Point / Move Points edit in a replay;
stacks with only Z/add/delete/topology edits pay nothing (measure; always-build
only if evidence favors). Maintenance follows `edgeMap` transitions, NOT raw
triangle callbacks (shared edge survives 2→1): 0→1 add spatial edge, 1→2 noop,
2→1 keep, 1→0 remove. Hook placement (§26): inside or directly beside
`indexEditTri`/`unindexEditTri` with edge-refcount awareness, or a higher-level
edge-diff seam — audit during implementation, pin with §93-96 oracles.

**Move update protocol:** validate against old index + proposed geometry; on
success remove old bboxes for the union of incident edges (deduped canonical
keys), apply coordinates, insert new bboxes — atomic; on failure index untouched.
Single `move-point` uses the same index (§66 — no fast-bulk/slow-single split).

**Moved-vs-moved (§30, GO gate):** the old index is pre-move geometry; final-state
moved edges must ALSO be tested against other proposed moved edges (temporary
local candidate set over proposed segments). Never rely on the old index alone.

**Brute-force oracle (test-only):** keep the legacy global-scan validator as a
test reference; randomized deterministic corpus (grids, irregular, holes, user
lines, swaps, add/delete, large coords, valid + crossing moves) must show 100%
PASS/BLOCK parity for single and bulk moves (§31-32, §92).

## 10. Worker implications

No new worker operation. `buildCadSurface` replay owns the new kinds; new kernels
run inside `applyCadSurfaceEdits` like existing ones. Revision guards
(`surfaceBuildService.ts:429-489` latest-wins discard) already cover build A/B
races and undo-during-build — bulk commits go through the same `SURFACE_ADD_EDIT`
+ `NEEDS_REBUILD` + schedule path. No preview mesh is ever trusted.

## 11. WNCAD implications

Clone per-kind explicitly in `cloneCadSurfaceDefinition`
(`cadSurfaceTypes.ts:55-72`), order authoritative/never sorted. A 1000-point raise
is one edit object + 1000 compact `{key}` refs (measure §61 sizes at
10/100/1000/10000). Revisions never persist; `cachedRevision` clears on load.
Selection never persists. Imported payloads stay byte-identical; `edit:` refs
replay after their producer (dependency rules unchanged).

## 12. Downstream lifecycle (no new contracts)

Bulk commits clear geometry cache → `NEEDS_REBUILD` → contours (TIN-revision
stale diagnostic), profiles/sections (`SOURCE_NOT_CURRENT` → `NEEDS_REBUILD`),
volumes (`SOURCE_NOT_CURRENT` → `NEEDS_RECALC`), 18U analysis
(`SOURCE_NOT_CURRENT` while source stale → `NEEDS_RECALC` after rebuild, retained
stale result never UNBUILT). LandXML exports the flattened final mesh; no edit
history representation. All 18S–U/adjustment contracts unchanged; analysis/volume
math untouched.
