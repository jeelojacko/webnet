# Phase C2 — consumer proof (true arcs + band width)

Every consumer reads course geometry through the one resolver
(`resolveCadPolylineCourses`, `cadPolylineCourses.ts:57`) instead of
re-deriving. A bulged course is never treated as its chord; malformed
metadata fails closed (empty/null), never silently straightened. Legacy
polylines with neither metadata field keep their byte-identical C1 path.

| Consumer | File:line | Delivered behavior |
|---|---|---|
| Renderer (geometry) | `src/engine/cad/cadRenderer.ts:262`, dispatch `:1468` | Arc courses emit native arc primitives (center/radius/sweep), line courses emit line primitives, preserving course order and per-course `sourceSegmentId`; legacy polylines fall back to `buildVertexPrimitives` unchanged. |
| Renderer (band) | `src/engine/cad/cadRenderer.ts:274` → `cadPolylineCourses.ts:220` | One aggregated filled band primitive per polyline (band first, centreline on top); `[]` for zero-width; hard per-arc sample ceiling. Band is `pointer-events:none`. |
| Shared segment iterator (spatial index / snaps / intersections) | `src/engine/cad/cadSpatialEntityRefs.ts:36` (`polylineCourseSegments`), `:60` (`polylineCourseArcs`), `:81` (`isPolylineArcCourse`) | Line courses join the segment set, arc courses join the arc set (never the chord); `vertexEntitySegments` retains the C1 closed last→first wrap for the all-line path. |
| Spatial index build | `src/engine/cad/cadSpatialIndex.ts:299-317` | Line courses → prepared segments; arc courses → prepared arcs; arc center + in-sweep extrema join the prepared entity box for cursor-box culling. Block children route the same way (`:393-402`). |
| Snaps (entity candidates) | `src/engine/cad/cadSpatialEntityCandidates.ts:324` (`buildPolylineSnapCandidates`) | Line courses keep endpoint/midpoint/nearest/perp/parallel; arc courses expose the existing arc snap kinds (endpoint/arc-midpoint/center/quadrant/nearest/tangent/perpendicular) through one pseudo-arc built from true metrics. |
| Snaps (block children) | `src/engine/cad/cadSpatialBlockSnaps.ts:88` | Arc child courses provide arc start/end/mid/center; line courses provide vertex/mid. Legacy children unchanged. |
| Intersections | `src/engine/cad/cadCogoEntityIntersections.ts:49` (`polylineEntityCurves`), `:75` (`curveIntersections`) | True line/arc curves feed line-line, line-arc, and arc-arc intersection math (never the chord). |
| Bounds (query culling) | `src/engine/cad/cadSpatialBounds.ts:203` (`polylineIntersectsBounds`), `:244` dispatch | Line courses use the chord segment optionally expanded by half the band; arc courses use true in-sweep extrema with the band envelope. |
| Bounds (drawing) | `src/engine/cad/cadProjectState.ts:110` | Meta-bearing polylines add arc extrema + width envelope (`cadPolylineWidthEnvelopePoints`) to the drawing bounds. |
| Properties | `src/engine/cad/cadProperties.ts:287` (`polylineSegmentRows`), `:327` (`polylineTrueLength`), dispatch `:539` | Per-course rows report true line vs arc, arc length/R/Δ/bulge/chord for arcs, chord length/azimuth for lines, and width (0/constant/`start→end`); total length sums true arc lengths. Legacy polylines keep the chord rows. |
| Grips | `src/engine/cad/cadTransactionsEntityTransforms.ts:268`, revalidation `:294` | One grip per stored vertex; a move keeps every stored bulge/width verbatim (metrics re-derive) and fails closed when the new endpoints collapse an arc, dedupe adjacent endpoints, or break the closed 3-distinct gate. No arc-midpoint/width grips. |
| Clipboard / copy | `src/engine/cad/cadTransactionsClipboardCommands.ts:120` | Copied polylines own deep-copied geometry/width arrays (no shared mutable array). |
| Persistence | `src/engine/cad/cadPersistence.ts:103` (`clonePolylineSegmentMetadata`), `:317` (`cloneCadEntity`) | Verbatim deep clone of bulge/width plus `closed`; malformed metadata throws so load is fail-closed. Legacy polylines clone byte-for-byte with no new keys. |
| Block persistence | `src/engine/cad/cadBlockPersistence.ts:43` | Block-child polyline arrays clone as owned values. |
| Blocks (transform) | `src/engine/cad/cadBlocks.ts:162` (`blockReferenceScalesDistortPolylineCurve`), `:205` (`transformBlockPolylineChildToWorld`), dispatch `:263`, `:397` (`childPoints`) | Uniform scale keeps bulges and scales widths; reflection flips every bulge sign and keeps widths positive; non-uniform scale over any arc/width child fails closed with `CAD_BLOCK_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED` (Circle precedent). Block-child bounds use the width envelope. |
| Block INSERT command | `src/engine/cad/cadTransactionsBlockCommands.ts:133` | The command refuses to create a non-uniform reference that would distort a bulged/wide polyline child. |
| Transforms (core) | `src/engine/cad/cadTransformGeometry.ts:124` | Translation/rotation carry bulge+width verbatim; uniform scale keeps bulges and scales widths by `|scale|`; reflection flips bulges and keeps widths positive; general affine (non-uniform/shear) over any arc or nonzero width fails closed with `CAD_TRANSFORM_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED`. |
| Transforms (preview) | `src/engine/cad/cadTransformPreview.ts:130`; `src/hooks/surveyCad/useSurveyCadWorkspacePreviews.ts` | The band primitive transforms with the same affine; translated previews recolor band fill. |
| MLightCAD adapter | `src/engine/cad/cadMlightcadAdapter.ts:48-57` | The `AcDbPolyline` spike geometry carries `segmentGeometry`/`segmentWidths` (geometry is `Record<string, unknown>`), so a bulged/wide polyline is never represented as a plain vertex ring. |
| Circle/tangent source | `src/engine/cad/cadGeometryCircleTangentSolvers.ts:764` (`resolvePolylineSegment`), used `:872` | A bulged course resolves as an ARC (closest point on the true arc) for tangent/perpendicular and Circle TTR/TTT sources; legacy polylines stay line segments. |
| Trim/extend/fillet (chord kernels) | `src/engine/cad/cadTransactionsTrimCommon.ts:42` (`isTrimmableEntity`), `:63` (`buildTrimSegments`) | A polyline carrying any arc or nonzero width is refused by the chord-based straight-only kernels (both the entity gate and the second-layer segment builder), so no chord treatment and no width loss. Full mixed-segment trim/extend/fillet is deferred. |

## C1-gap fixes closed in this pass

- **`cadCogoEntityIntersections` closed edge.** The old
  `polylineEntitySegments` iterated `vertices.slice(0, -1)`, so a C1 closed
  ring's synthesized last→first edge (and any closing-course intersection)
  was invisible to COGO intersections. `polylineEntityCurves` now resolves
  through `resolveCadPolylineCourses`, whose `cadPolylineCourseEdgePoints`
  applies the C1 wrap; the closed edge participates in line-line/line-arc/
  arc-arc intersection. (`cadCogoEntityIntersections.ts:49`.)
- **`dxfAnnotationExport` closing edge.** The annotation-arrow block-polyline
  expansion only wrapped polygons; a C1 closed polyline stored without a
  duplicate closure vertex lost its closing edge. It now wraps when
  `cadPolylineVerticesWrapToFirst(...)` is true, while a legacy ring that
  repeats first keeps its stored edges untouched. (`dxfAnnotationExport.ts:156`.)

## Arc-course identity and exact locking (C2 correction)

A polyline/feature-line arc course carries the same course id the renderer
and line courses use (`${entity.id}#i`), so multi-arc entities never lose
course identity across the snap/lock/tangent-source path:

- `CadArcRef` gains an optional `segmentId` (`cadSpatialIndexTypes.ts:35`);
  `polylineCourseArcs`/`featureLineCourseArcs`
  (`cadSpatialEntityRefs.ts:60`, `:147`) and the parcel/feature-line/polyline
  pseudo-arc refs (`cadSpatialEntityCandidates.ts:239`, `:300`, `:348`) set it.
  Standalone `CadArcEntity` refs stay absent (legacy shape).
- `buildArcEntitySnapCandidates`
  (`cadSpatialEntityCandidates.ts:363`) passes `arc.segmentId` as
  `sourceSegmentId` on every arc candidate (endpoint/center/arc-midpoint/
  quadrant/nearest/perpendicular/tangent). `CadSnapLock` already carried the
  field, so `useSurveyCadSnapping` preserves it.
- `cadSpatialIndex` resolves a segment-addressed locked arc by
  `sourceSegmentId` first (`arcBySegmentId` / exact search) and only falls
  back to `sourceEntityId` for legacy/standalone arcs; a tangent-seed arc
  seed (`tangentSeedArcSegmentId`) resolves the exact course too
  (`cadSpatialIndex.ts:529`, `:665`).
- Parcel arc courses join that same true-arc identity: `parcelCourseArcs`
  (`cadSpatialEntityRefs.ts:188`) resolves each bulged course with its
  `${id}#i` id, and the parcel branch of `buildCadSpatialIndex`
  (`cadSpatialIndex.ts:326`) indexes line courses as chord segments and arc
  courses as true arcs (never the chord). A line seeded from a parcel arc
  snap therefore seeds an ARC, and a locked tangent/perpendicular on a parcel
  arc resolves the true arc geometry instead of the chord. Legacy/all-line/
  invalid parcel geometry keeps the all-chord path unchanged.
- `resolveCadTangentSource` (`cadGeometryCircleTangentSolvers.ts:806`) keeps
  the exact polyline course when `snapSourceSegmentId` is supplied, and the
  arc tangent primitive carries `segmentId` so
  `isSameCadTangentPrimitive` distinguishes two courses of one polyline.

## Explicitly not in this pass

Vertex insert/delete, Z, line chaining, right-click finish, command repeat,
raw direct bulge-entry UI, arc-midpoint/width grips, full mixed-segment
trim/extend/fillet fail-closed remainder, and general DXF import are deferred
(see `interaction-law.md` §7 / `dxf.md`).
