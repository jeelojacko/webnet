# Phase C3 — Delete law

`deleteCadPolylineVertex(entity, { vertexIndex })` is the one delete
authority. It fails closed on any join it cannot represent, so a delete can
never silently straighten a curve or corrupt the ring.

## Minimum counts

- Open polyline: at least 2 retained vertices (`MIN_COUNT` otherwise).
- Closed polyline: at least 3 retained vertices (`MIN_COUNT` otherwise).

## Open endpoints

Deleting vertex `0` or the last vertex simply drops the single adjacent course
(and its geometry/width entry). No merge is required.

## Interior / closed vertices

The incoming and outgoing courses merge:

| Join | Result |
| --- | --- |
| line + line | one line |
| arc + arc, same circle, same traversal sign, summed sweep < full-circle cap | one arc with the summed signed sweep, bulge re-derived through `parcelBulgeFromArcDefinition` |
| arc + arc, off-circle or opposite direction | `INCOMPATIBLE_MERGE` |
| line + arc / arc + line | `INCOMPATIBLE_MERGE` (mixed curvature never straightens) |
| summed sweep reaches the full-circle cap | `INCOMPATIBLE_MERGE` |

- Closed vertex `0` rotates the ring and reindexes so no duplicate closure
  vertex is ever stored.
- Widths at a merge take the incoming start at the surviving previous vertex
  and the outgoing end at the surviving next vertex.
- The result re-runs the canonical path normalizer before return.

## Properties preflight (no mutation)

`describeCadPolylineVertexDeleteBlock(entity, vertexIndex)` runs the same pure
checks (canonicalize, range, minimum count, merge legality) and returns the
operator-facing reason or `null`. It never builds the replacement entity, so
the Properties panel can disable an unsafe `Delete Vertex` in O(n) per row
without O(n²) work. The engine transaction re-runs the real preflight at
commit, so a stale/disabled row still fails closed with zero mutation and no
history entry.

## Surfaces

- Properties: `Delete Vertex` per vertex, disabled with the reason when the
  merge is unrepresentable or the ring is at minimum count.
- Command `PLINEDELETEVERTEX`: pick the polyline then the exact vertex, or
  type `V<n>` (1-based).
