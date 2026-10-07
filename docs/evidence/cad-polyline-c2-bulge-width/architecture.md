# Phase C2 — PLINE Arc/Line/Width architecture (bulge + band width)

Branch `feat/cad-polyline-bulge-width-c2`, on top of the C1 close/backstep
baseline. Scope is additive across the engine, consumers, session, preview,
and DXF seams: a PLINE gains optional per-course bulge (true arc legs) and
optional per-course centred band width. No schema/migration bump, no Z, no
vertex insert/delete, no DXF import, no second geometry convention.

## 1. Schema placement (additive trailing optional)

- `src/engine/cad/cadTypes.ts:302` — `CadPolylineSegmentGeometry =
  { kind:'line' } | { kind:'arc'; bulge:number }` (endpoint-owned, signed
  bulge shared with parcels/feature lines).
- `src/engine/cad/cadTypes.ts:312` — `CadPolylineSegmentWidth { startWidth;
  endWidth }` (full band width in metres, centred on the centreline).
- `src/engine/cad/cadTypes.ts:328`/`335` — `CadPolylineEntity.segmentGeometry?`
  / `segmentWidths?`; the doc comments record the course-count contract and
  the "trailing optional field (no version bump)" rule.
- `src/engine/cad/cadTransactions.types.ts:431`/`435` — the same two optional
  fields on the `PLINE` command payload, after `closed?`.

Absent arrays = legacy all-line, zero-width (the C1 shape). No existing field
changes and no migration/version change; the schema is byte-compatible with
legacy files.

## 2. Bulge authority reuse (one convention, parcel-named)

`src/engine/cad/cadPolylineGeometry.ts:1-16` states the law explicitly: the
signed bulge is the Phase 19C/20A seam verbatim — `b = tan(sweepRad/4)`,
positive = CCW = center-left, `|b| > 1` = major. There is no second
convention. The module imports and reuses the parcel helpers directly:

- `CAD_PARCEL_BULGE_LINE_FLOOR`, `CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE`,
  `CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG`
- `describeParcelArcCourse` (arc metrics: center/radius/sweep/midpoint/arcLength)
- `parcelBulgeFromArcDefinition` (three-point inverse)
- `parcelArcBoundsPoints` (in-sweep extrema) — via `cadPolylineCourses.ts`

`cadPolylineCourses.ts` imports `CAD_PARCEL_BULGE_LINE_FLOOR`,
`describeParcelArcCourse`, `parcelArcBoundsPoints`, and the metrics type from
`cadParcelArcGeometry`; blocks/transforms reuse `mirrorParcelCourseGeometry`
and `parcelCourseCanonicalKind`. Consequences of the floor: an absent or
sub-floor entry canonicalizes to a line (`cadPolylineCourseKind`,
`cadPolylineCourses.ts:49`).

## 3. Canonical normalizer (`sanitizeCadPolylinePath`)

`src/engine/cad/cadPolylineGeometry.ts:334` is the ONE entry point that turns
a command/session path plus optional metadata into persisted geometry:

- Legacy path (no metadata) keeps the C1 law byte-for-byte: adjacent 1e-9
  dedupe, closed redundant-final strip, label alignment, open ≥2 / closed
  ≥3-distinct gate.
- With metadata present, an interior duplicate cannot be deduped without
  shifting entry ownership, so it **fails closed**; a closed redundant final
  vertex is stripped together with its outgoing (zero-length) course entry,
  and a real arc/nonzero width there fails closed as ambiguous.
- All-line geometry and all-zero widths canonicalize back to **absent** so
  legacy files stay byte-clean.
- Arc/width values are preserved exactly (never straightened, never
  sign-flipped).

Supporting pure seams in the same module:
`cadPolylineCourseCount` (n-1 open / n closed), `validateCadPolylineSegmentMetadata`
(structural + numeric), `cadPolylineVerticesWrapToFirst` (C1 wrap law reused),
`countDistinctPlinePositions`, `cadPolylineBulgeFromThreePoints` (3-point →
bulge via `cadBuildArcFromThreePoints` + `parcelBulgeFromArcDefinition`),
`cadPolylineWidthAtFraction` (linear taper, null out of range),
`revalidateCadPolylineVertexMove` (grip/transform-core revalidation).

`src/engine/cad/cadTransactionsPolylineCommand.ts:19` calls the normalizer
before any project mutation; `ok:false` returns null (zero project/history
mutation, one undo entry max). Persistence reuses
`validateCadPolylineSegmentMetadata` in `clonePolylineSegmentMetadata`
(`cadPersistence.ts:103`) so a malformed load throws and is rejected rather
than silently straightened.

## 4. Resolver (`cadPolylineCourses.ts`)

The single consumer-facing seam. `resolveCadPolylineCourses(entity)`
(`cadPolylineCourses.ts:57`) returns true courses in traversal order
(`index`, `from`, `to`, `kind`, `geometry`, `width`, arc `metrics`) or `null`
(fail closed) when the arrays do not match the course count or an arc does not
derive. `cadPolylineCourseEdgePoints` applies the C1 closed last→first wrap,
so a closed ring's final course is first-class.

Derived helpers: `cadPolylineHasArcCourse`, `cadPolylineHasNonzeroWidth`,
`cadPolylineHasCurveOrWidth` (chord-kernel edit guard; presence-aware
fail-closed — a PRESENT-but-unresolvable array, i.e. non-array, wrong course
count, or an invalid/sparse entry, counts as arc/width so trim/blocks and the
general-affine transform refuse exactly what the resolver rejects),
`cadPolylineWidthEnvelopePoints` (arc extrema + half-width envelope),
`cadPolylineMaxHalfWidth`, and `buildCadPolylineBandPoints` (one aggregated
band polygon; hard per-arc sample ceiling; `[]` for zero-width).

## 5. Band primitive and data flow

`src/engine/cad/cadDisplayTypes.ts:85` adds
`CadDisplayBandPrimitive { kind:'band'; points; fill }` to the display union.
`cadRenderer.ts:262` (`buildPolylineCoursePrimitives`) emits native arc
primitives for arc courses, line primitives for line courses, and one band
primitive (band first, centreline on top). The band renders through the
shared viewport/SVG/PDF primitive path
(`SurveyCadPreviewPrimitive.tsx:354`, `SurveyCadPreviewLayers.tsx:83`,
`SurveyCadPreview.geometry.ts:195`) and is `pointer-events:none`, so hit
testing stays centreline/course-authoritative. Transform previews carry the
band (`cadTransformPreview.ts:130`) and translated previews recolor it
(`useSurveyCadWorkspacePreviews.ts`).

Data flow:

```
session draft (useSurveyCadPlineSession)
  -> commitPlineSession payload { vertices, closed, segmentGeometry, segmentWidths }
  -> polylineCommand.execute
  -> sanitizeCadPolylinePath (canonicalize / fail closed / omit all-line+all-zero)
  -> CadPolylineEntity { vertices, vertexLabels, closed, segmentGeometry?, segmentWidths? }
  -> every consumer calls resolveCadPolylineCourses (never re-derives)
```

## 6. Deferred (explicit, out of scope)

Vertex insert/delete, Z, line chaining, right-click finish, command repeat,
raw direct bulge-entry UI, arc-midpoint/width grips, full mixed-segment
trim/extend/fillet, and general DXF import are NOT delivered here. See
`interaction-law.md` and `consumer-proof.md` for the exact delivered
boundary.
