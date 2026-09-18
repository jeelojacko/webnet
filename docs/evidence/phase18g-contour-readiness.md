# Phase 18G — Contour readiness (data seam for 18H)

No contour algorithm lives here. This note pins exactly what 18H consumes so
contouring starts from derived data with no re-derivation and no new
topology passes.

## 1. What the build outputs (per `ok` result)

`CadSurfaceBuildResult` (`src/engine/cad/cadSurfaces.ts`):

| Field | Shape | Meaning for 18H |
|---|---|---|
| `points` | `CadSurfaceSourcePoint[]` (`entityId, x, y, z`, world units) | Vertices with XYZ. Canonical order: data sorted by (x,y,z,entityId), then the boundary tail (`boundary:<surfaceId>:<n>`, XY-sorted), then the Steiner tail (`steiner:<surfaceId>:<n>`). Translation/shuffle/ring-permutation invariant. |
| `triangles` | `Array<[number, number, number]>` | CCW index triples, lexicographically sorted, referencing `points`. Retained domain only (null outside outer, null in voids). |
| `adjacency` | `Array<[number, number, number]>` | Neighbor triangle opposite vertex 0/1/2, `-1` = exterior sentinel (hull edge OR edge against a dropped triangle). Aligned with `triangles`. Compact index triples; typed-array convertible. |
| `edgeKinds` | `Array<[0\|1\|2\|3, …]>` | Constrained flag opposite vertex 0/1/2: `0` free, `1` breakline, `2` outer, `3` void (outer > void > breakline on overlap). Derived only — never persisted to the drawing. |
| `grid` | `CadSurfaceGrid` (`minX, minY, cellSize, cells`) | Uniform index over retained triangles (cell → triangle list). O(1) seed lookup for contour tracing. |
| `stats.planimetricArea` | `number` | Σ retained triangle areas (meters²). Sanity denominator for contour-length checks. |

## 2. How the seam crosses process/session boundaries

- `SurfaceWorkerMesh` (`src/workers/surfaceWorkerHandler.ts`) carries all six
  fields across the worker boundary (structured-cloneable: plain arrays +
  `Map`; `isWellFormedMesh` in `surfaceWorkerClient.ts` rejects payloads
  missing `grid`/`adjacency`/`edgeKinds`).
- `CachedSurfaceMesh` (`src/engine/cad/cadSurfaceCache.ts`) stores deep
  copies of all six (session-only; meshes never persist to the drawing —
  `clearSurfaceBuildCacheOnLoad` still wipes revisions on reopen).
- UI display paths (`surfaceTrianglesPathD`, `surfaceBoundaryPathD`) already
  consume `triangles` only; contour rendering will add its own derived layer
  without touching them.

## 3. Invariants 18H may rely on (all pinned by tests)

- Triangles are CCW with positive area; adjacency is symmetric
  (`validateTinMesh` in `src/engine/cad/tin/tinTopology.ts` checks all of
  this: index validity, CCW, symmetry, shared-edge consistency, no
  duplicates, constraint coverage + flag agreement, no proper crossings).
- Every outer/void ring edge is covered by mesh edges (possibly split at
  collinear vertices); breakline chains are covered edge-for-edge.
- The TIN is continuous across shared edges (same endpoint Z), so contour
  segments meeting at a shared edge agree exactly — no crack stitching
  needed for interior edges.
- Boundary vertices carry interpolated (never zero) Z; Steiner midpoints
  carry segment-midpoint Z. Contours crossing a boundary therefore meet the
  boundary at a well-defined elevation.
- Query policy (also the contour/boundary-intersection rule): outer boundary
  inclusive of the surface, void boundary inclusive of the surface, void
  interiors and exterior null. Pinned in `tests/cad_surface_domain.test.ts`
  ("edge query policy").

## 4. Measured inquiry performance (Node, engine grid vs legacy full scan)

| Mesh | Build | 10k queries (grid / scan) | 50k queries (grid / scan) |
|---|---|---|---|
| 50×50 (4,802 tris) | 146 ms | 21 ms / 477 ms (2.1 / 47.7 µs/q) | 33 ms / 2,066 ms (0.7 / 41.3 µs/q) |
| 100×100 (19,602 tris) | 289 ms | 14 ms / 1,728 ms (1.4 / 172.8 µs/q) | 45 ms / 7,058 ms (0.9 / 141.2 µs/q) |

Grid and full scan agree bit-for-bit on 2,000 sampled probes. The full-scan
fallback in `getSurfaceElevationAt` stays for cell-miss cracks only — the
index is no longer dropped at any boundary. Contour seed searches should use
`grid` (same magnitudes apply).

## 5. Explicitly out of scope for 18H startup

Contour generation, smoothing, labeling, interval selection, volume
computation, DXF/SVG contour export styling. When 18H lands it MUST NOT
re-derive adjacency or re-classify the domain — consume the seam above.
