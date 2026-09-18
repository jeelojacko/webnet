# Phase 18G — Surface domain classification decision (exact, constrained)

Branch: `perf/cad-surface-production-hardening`. Baseline: `6d446c70` (PR #96).
Scope: Phase 18G §§19-35, 62, 66-71 — data plane only (no contours/volumes).

## 1. Problem

`filterTinDomain` (`src/engine/cad/tin/tinDomainFilter.ts:32-40`) keeps a
triangle iff its **centroid** is inside every outer ring and inside no void
ring. Outer/void rings are never passed as constrained segments
(`cadSurfaces.ts` builds segments from breaklines only) and ring vertices
never enter the point set. A triangle straddling a boundary is therefore
classified by whichever side its centroid falls on: ragged concave-outer
edges, void leakage, and area error. There is no adjacency anywhere, the
interpolation grid is built then dropped at the cache/worker boundary, and
the UI inquiry does an O(n) full scan (`cadSurfaceView.ts queryMeshElevation`).

## 2. Decision: enforced boundary constraints + flood fill from exterior

1. **Ring vertices join the point set.** Every outer/void ring vertex either
   reuses the existing point at the exact same XY (exact equality, no epsilon
   snap — same policy as `tinDedupe`) or is appended as a synthetic vertex.
   Synthetic ids are `boundary:<surfaceId>:<n>` with `n` in XY-sorted order of
   the new vertices, so translation (monotonic shift preserves XY order),
   input shuffle (canonical sort), and ring permutation (sorted-ring
   processing) all yield identical meshes. Rings are processed in
   coordinate-text-sorted order; all segments (breakline + boundary) are
   recovery-sorted by endpoint coordinates, so segment input order cannot
   affect the result.
2. **Boundary rings become enforced constrained segments** (closed: consecutive
   pairs plus last→first), recovered by the existing Sloan-style recovery +
   Steiner restart path. Triangulation math is otherwise untouched; with no
   boundaries the pipeline is bit-identical to 18F (early-out, no new points).
3. **Synthetic-vertex Z is interpolated, never invented as 0.**
   A stage-1 base Delaunay over data points only supplies the interpolant:
   containing-triangle barycentric Z, else nearest-vertex Z (lowest index
   breaks ties). Deterministic, translation-invariant (local-frame
   barycentric/distances), planar-exact (18F plane oracle preserved under
   boundaries). Steiner midpoints on boundary segments keep the existing
   midpoint-Z rule.
4. **Adjacency is materialized** on the derived mesh: per triangle, the
   neighbor opposite vertex 0/1/2 (`-1` = exterior sentinel), aligned with the
   final sorted triangle order. Compact index triples — the 18H contour seam.
5. **Constrained-edge flags** ride the derived mesh only (never persisted to
   the drawing): per-triangle triple of `0 = free, 1 = breakline, 2 = outer,
   3 = void` for the edge opposite vertex 0/1/2 (outer > void > breakline on
   overlap). Flood walls = kinds 2/3; breaklines are crossed freely.
6. **Classification = flood fill from exterior across unconstrained edges.**
   Seeds: triangles whose centroid is outside ≥1 outer ring (OUT seeds), and
   per-void triangles whose centroid is inside that void (VOID seeds, each
   void seeded independently). Flood moves on the dual graph across free and
   breakline edges only; outer/void edges stop the flood. Retained =
   reached by neither flood. `planimetricArea` = Σ retained triangle areas;
   the interpolation grid is rebuilt over retained triangles only
   (null outside, null in void, finite inside).

## 3. Equivalence proof (flood ≡ exact containment, given enforced constraints)

Lemma 1 — *No triangle straddles a boundary.* Every boundary segment is a
recovered mesh edge (recovery guarantees presence, else Steiner split +
restart, else build failure). A triangle edge-coincident with the ring has
its interior strictly on one side; a triangle merely touching the ring at a
vertex likewise. Hence each triangle interior is either fully inside or fully
outside each ring.

Lemma 2 — *Centroid seeding is exact.* A triangle centroid is strictly
interior to the triangle, hence never ON a boundary edge. By Lemma 1 the
centroid is inside a ring iff the whole triangle is. So OUT/VOID seeds are
exactly the outside/void triangles — no straddle ambiguity by construction.

Theorem — *Flood retention ≡ containment.* Walls are exactly the ring edges.
Flood from OUT seeds reaches precisely the outside-connected component(s);
flood from VOID seeds reaches precisely each void interior (walls enclose it
fully — rings are closed). IN triangles are unreachable (reaching one would
require crossing a wall). Therefore retained = inside-all-outers ∧
inside-no-void, exactly. Failure direction is closed: a missing wall can only
over-exclude (flood leaks outward-in), never include void/exterior triangles.

Corollary — with no boundaries there are no seeds and no walls: every
triangle is retained, bit-identical to 18F.

## 4. Edge/border query policy (deterministic, no iteration-order flicker)

TINs are continuous across shared edges (same endpoint Z), so any containing
triangle yields the same elevation on a shared edge. Policy, pinned by tests:

- **Interior shared edge:** inclusive in both adjacent triangles; value
  identical either way — no flicker possible.
- **On the outer boundary:** inclusive of the surface (finite elevation).
  Queries outside match no retained triangle → null.
- **On a void boundary:** inclusive of the surface (finite, continuous with
  the retained neighbor). Void interiors match no retained triangle → null.
- Point exactly on a mesh vertex: finite (that vertex's Z when all adjacent
  triangles agree, which they do at shared vertices by construction).
- Fail-closed stale behavior unchanged: no current mesh → the existing
  "has no current mesh — rebuild before querying elevation" path.

## 5. Invalid-relation validation (fail closed, existing codes only)

Checked in `collectSources` after breakline/boundary resolution, with exact
`ccwSign` predicates; shared exact vertices are always allowed:

| Relation | Code |
|---|---|
| Outer ring self-intersection / T-touch | `SURFACE_BOUNDARY_INVALID` |
| Void ring self-intersection / T-touch | `SURFACE_VOID_INVALID` |
| Outer↔outer proper crossing / T-touch | `SURFACE_BOUNDARY_INVALID` |
| Void crossing or touching outer (non-shared-vertex) | `SURFACE_VOID_INVALID` |
| Void↔void proper crossing / T-touch (nested voids without contact are union-harmless and allowed) | `SURFACE_VOID_INVALID` |
| Breakline crossing/touching a boundary without an exact shared vertex | `SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX` |

The pre-existing void-centroid-outside-outer check stays (catches disjoint
escape without contact). A breakline terminating exactly on a boundary ring
vertex is legal and recovers without false crossing (proper-crossing excludes
shared endpoints on both checks).

## 6. `pointInRing` ownership

Single owner: `src/engine/cad/tin/tinPredicates.ts` (exact copy of the
duplicated implementations in `tinDomainFilter.ts` and
`cadSurfaceRevision.ts`). Zero behavior change — byte-identical logic, both
call sites import it.

## 7. Inquiry performance plan

Wire the engine grid through the cache/worker boundary (`CachedSurfaceMesh`
+ `SurfaceWorkerMesh` carry `grid` + `adjacency` + `edgeKinds`; session-only,
never persisted to the drawing) and route `queryMeshElevation` through
`getSurfaceElevationAt` (grid lookup + full-scan fallback only on cell miss).
Measure 10k/50k sampled queries (grid vs legacy full scan) and report
averages; the fallback stays because cell-miss cracks are possible, not
because the boundary drops the index.

## 8. What this phase does NOT do

No contour algorithm (18H owns it; this phase ships the seam: vertices,
adjacency, constrained edges, boundaries, XYZ — see
`phase18g-contour-readiness.md`). No volumes. No new dependencies
(delaunator ISC + robust-predicates Unlicense only). No `cadTypes.ts` model
growth. Engine stays pure/sync (worker calls it). Files < 600 lines.
