# Phase C1 — consumer proof (closed polyline last→first edge)

A closed PLINE is persisted as `closed:true` with N stored vertices and no
duplicate closure vertex. The synthesized last→first edge is owned by
`cadPolylineVerticesWrapToFirst(vertices, closed)` (true for a closed ring
whose last stored vertex differs from its first under the 1e-9 law). Legacy
rings that already repeat the first vertex (e.g. TRAVERSE, which appends its
closure station) return false and keep their existing N-1 stored edges, so
their behavior is byte-identical.

| Consumer | File | Change |
|---|---|---|
| Shared segment iterator | `src/engine/cad/cadSpatialEntityRefs.ts` (`vertexEntitySegments`) | Wraps to first when `closed` and last≠first; the closing segment id is `${id}#${N-1}` with `endLabel` = first vertex label. Feeds the spatial index. |
| Spatial index / snaps / intersections | `src/engine/cad/cadSpatialIndex.ts` (`entitySegments`) | Consumes the iterator, so the closing edge is indexed for `querySnapCandidates` / `queryNearestSnap` / intersection candidates. No duplicated vertex. |
| Entity candidate snaps | `src/engine/cad/cadSpatialEntityCandidates.ts` | Consumes `entitySegments`; closing edge participates in endpoint/midpoint/nearest/extension construction. |
| Block-child snaps | `src/engine/cad/cadSpatialBlockSnaps.ts` | Block children build their own ring; a closed polyline child now wraps to first. Legacy repeated-first/ open children unchanged. |
| Renderer (geometry) | `src/engine/cad/cadRenderer.ts` (`buildVertexPrimitives`) | Wraps to first for a closed polyline; draws N edges. |
| Renderer (traverse labels) | `src/engine/cad/cadRenderer.ts` (`polylineSegments`) | Same wrap predicate; legacy repeated-first rings are unchanged. |
| Bounds | `src/engine/cad/cadSpatialBounds.ts` | Wraps to first for a closed polyline. |
| Properties segment rows | `src/engine/cad/cadProperties.ts` (`segmentRows`) | Emits N rows for a closed polyline (open stays N-1; closed legacy duplicated rings stay N-1 because the wrap predicate is false). `polylineLength` already honored `closed`. |
| Grips | `src/engine/cad/cadTransactionsEntityTransforms.ts` (`buildCadGripHandles`) | Unchanged: one grip per stored vertex, so no duplicate first-vertex grip. |
| Circle/tangent source | `src/engine/cad/cadGeometryCircleTangentSolvers.ts` (`resolvePolylineSegment`) | Already honored `closed`; N stored vertices yield N candidate segments with the last→first edge. No change needed. |
| Persistence | `src/engine/cad/cadPersistence.ts` (`cloneCadEntity`) | Verbatim spread preserves `closed`; vertices cloned per point with no closure duplication. No change needed. |
| DXF | `src/engine/cad/dxf/dxfExportModel.ts` + `dxfSerializer.ts` | `closed: entity.closed` maps to group 70 bit; vertices emitted as stored, no duplicated closure vertex. No change needed. |
| MlightCAD adapter | `src/engine/cad/cadMlightcadAdapter.ts` | `closed: entity.type === 'polyline' ? entity.closed : true`. No change needed. |
| Transforms / clipboard | `src/engine/cad/cadTransactionsEntityTransforms.ts`, `cadTransactionsClipboardCommands.ts` | Untouched: vertex arrays transform/copy verbatim and `closed` rides the spread. |

## Explicitly not in this pass

Trim/extend/fillet keep `buildTrimSegments` (open N-1 segment builder); a
closed PLINE's closing edge is not segmented by those tools yet. This is a
documented, deferred boundary, not silent behavior: selection, snaps,
intersections, render, bounds, and properties all see the closing edge.
