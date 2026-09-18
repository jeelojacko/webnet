# Phase 18H §2 — Contour architecture audit

Companion reads (18G seam): `phase18g-contour-readiness.md` (build-output
contract), `phase18g-surface-domain-classification.md` (flood-fill
equivalence proof), `phase18g-browser-performance.md` (worker/display
budgets). This note audits what contouring can consume, what display
scaffolding exists, and where the analysis should live. It adds no code.

## 1. Topology available from 18G (consume, never re-derive)

`CachedSurfaceMesh` (`src/engine/cad/cadSurfaceCache.ts:18-27`) stores, per
`scopeId::surfaceId@revision`: `points` (XYZ world units, canonical
data → boundary-tail → Steiner-tail order), `triangles` (CCW, sorted,
retained-domain only), `stats`, `grid` (`CadSurfaceGrid`: O(1) seed
lookup), `adjacency` (`TinAdjacency[]`, `-1` = hull-or-dropped sentinel),
`edgeKinds` (`TinEdgeKinds[]`: 0 free / 1 breakline / 2 outer / 3 void).

Consequences for contour extraction:

- Boundary is implicit via `edgeKinds` 2/3 — there is **no ring list** on
  the cached mesh. Contour tracing stops at walls (kinds 2/3) and crosses
  breaklines (kind 1) freely; it must not need ring geometry.
- Adjacency is symmetric and validated (`validateTinMesh`,
  `src/engine/cad/tin/tinTopology.ts`); the TIN is continuous across
  shared edges (same endpoint Z), so segments meeting at a shared edge
  agree exactly — no crack stitching on interior edges.
- Boundary vertices carry interpolated (never zero) Z; Steiner midpoints
  carry segment-midpoint Z. Contours meet the boundary at defined
  elevations, never at invented zeros.
- Query policy doubles as the contour/boundary-intersection rule: outer
  boundary inclusive, void boundary inclusive, void interiors and
  exterior null (pinned in `tests/cad_surface_domain.test.ts`).

## 2. Contour extraction inputs

Per `ok` result, via the 18G seam (`phase18g-contour-readiness.md` §1–2):
vertices + XYZ, CCW triangles, adjacency, edgeKinds, grid, and
`stats.planimetricArea` as the sanity denominator for contour-length
checks. `SurfaceWorkerMesh` (`src/workers/surfaceWorkerHandler.ts`)
already carries all six across the worker boundary (structured-cloneable;
`isWellFormedMesh` rejects payloads missing `grid`/`adjacency`/
`edgeKinds`). Contour seeds should use `grid` — 10k queries run ~21 ms
vs ~477 ms for the legacy full scan at 50×50 (§4 of the readiness note).

## 3. Contour display needs

`CadSurfaceDisplayLayer` (`src/engine/cad/cadDisplayTypes.ts:90-109`)
aggregates each surface to **one** triangles path (`trianglesD`), one
boundary path (`boundaryD`), and a capped vertex list — ≤2 paths per
surface, coarse picking (surface object, zero per-triangle nodes).
Contours need their own derived layer alongside these, without touching
the triangle/boundary paths. Inquiry stays separate: `queryMeshElevation`
(`src/engine/cad/cadSurfaceView.ts:184`) returns `number | null`, and
`formatSurfaceElevationAnswer`
(`src/cad-app/shell/cadSurfaceSnapshot.ts:112`) formats the string.
`CadSurfaceBuildStats` (`src/engine/cad/cadSurfaces.ts:57-69`) is computed
in `buildCadSurface` only — contouring adds its own derived stats, never
extends it.

## 4. Worker options

**Option A — extend the surface worker.** Add a `contour-analysis` op to
the existing protocol (`src/workers/surfaceBuildService.ts`), operating
on the cached mesh in the same worker. Manual rebuild only,
revision-gated, latest-wins supersession (`supersede`,
`surfaceBuildService.ts:212`), structured-clone payloads (no
transferables — §6 of the performance note rejects them: ~50–90 ms saved
at 50k vs a typed-array contract break), sync-fallback cap
`SYNC_FALLBACK_POINT_LIMIT = 1000` (`surfaceBuildService.ts:42`), cache
key `scopeId::surfaceId@revision`, current + ≤1 previous bounding
(`surfaceBuildService.ts:433-439`), session-only.

**Option B — dedicated analysis worker.** A second worker with its own
protocol, lifecycle, and cache. Isolates analysis crashes from builds but
duplicates supersession, revision gating, cache policy, and the sync
fallback — every invariant in §4 re-implemented and re-tested.

**RECOMMENDATION: prefer A.** Extend the surface worker protocol with a
contour-analysis op. Contouring consumes the mesh the surface worker
already owns; keeping one owner keeps one revision gate, one
supersession path, and one cache policy. Revisit B only if analysis
workloads measurably block rebuild throughput.

## 5. Style dependencies

`CadSurfaceStyle.showContours` exists but is **DORMANT**
(`src/engine/cad/cadTypes.ts:655-667` — flag defined at line 662; no
renderer, UI, or seed reads it; style keys plumbed in
`cadSurfaceStyles.ts:91,106` and `cadTransactions.types.ts:668` only).
No style-editor UI exists. Before contours render, `showContours` needs a
reader (display adapter) and a writer (some toggle surface); interval,
major/minor distinction, and color live behind the same dormant flag.

## 6. Label needs

No label infrastructure exists on the display layer (vertices are bare
`{x, y}` points; `CadSurfaceDisplayLayer` has no text slots). Contour
labels need elevation text placement (interval subset, de-collision,
rotation along segment) as a new display concern — out of scope for the
geometry pass, but the geometry should emit per-polyline elevations so
labels never re-derive Z.

## 7. Rendering limits

Precedent (`phase18g-browser-performance.md` §7): one SVG path per layer
at any scale; vertex *nodes* capped (`SURFACE_DISPLAY_VERTEX_CAP =
2000`); no viewport-bounds filtering, no off-screen suppression. Contour
output must fit the same mold — one/few SVG path strings, never per-
segment nodes. At 50k the triangle path-D alone is ~10.8 MiB (§4 table),
so contour vertex output needs a cap of the same family (vertex-count or
path-length budget) before it reaches the DOM. Label counts need their
own cap (labels are nodes, not path data — the expensive kind).

## 8. Export status

Unchanged exclusion: export scenes omit surfaces structurally (no test
pins this either way). Contours inherit the exclusion — no DXF/SVG
contour export styling in 18H startup scope (readiness note §5).

---

**No production contour geometry currently exists.**
