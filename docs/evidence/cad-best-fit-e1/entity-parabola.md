# E1 entity parabola — first-class `CadParabolaEntity` and consumers (Worker B)

Companion to `architecture.md` (Worker A contract) and `numerical-parabola.md`
(fit method). This note records the Worker B slice: the entity kind, its
consumer arms, and the fail-closed decisions. It does NOT cover the ribbon,
command keys, COGO tool keys, or transaction wiring (Worker C).

## 1. Schema (no version bump)

`src/engine/cad/cadTypes.ts` adds `CadParabolaEntity`:

```
type: 'parabola'
vertexX, vertexY        world vertex V
axisAngleDeg            opening-axis direction, degrees CCW from +X
focalLength             f > 0 (metres)
tStart, tEnd            finite extent, tStart < tEnd
P(t) = V + b*(2 f t) + a*(f t^2)
a = unit axis from axisAngleDeg, b = left-perp(a)
```

The kind is a trailing optional member of the WNCAD v2 `CadEntity` union.
Kinds are not enumerated by the version table, so **legacy files open
byte-identically and there is NO schema version bump**. All internal math is
metres/radians; degrees appear only in `axisAngleDeg`.

The entity seam (`src/engine/cad/cadParabola.ts`) is a thin, pure module over
Worker A's `cadParabolaGeometry.ts`. It owns validation, canonical conversion,
endpoints, half-curve-length midpoint, analytic closest point, bounded
tessellation, analytic bounds, segment intersection, the similarity transform,
and the fit-result projection. It deliberately imports **no**
drafting-only allowlisted module (see §10).

## 2. Fit-result projection (architecture §3)

`cadParabolaEntityFromCanonical(canonical, seed)` projects a Worker A
`BestFitParabolaResult.canonical` (or any canonical parabola) into a
first-class entity. The caller supplies id/layer/style/appearance/metadata;
`visible` defaults true and `locked` defaults false. Invalid canonical geometry
returns `null`, so a fit result can never materialize a malformed entity.

## 3. Persistence, clone, load

`src/engine/cad/cadPersistence.ts` `cloneCadEntity` gains a `parabola` arm that
validates (`isValidParabolaEntity`: finite vertex/axis/focal, focal above the
floor, `tStart < tEnd`) and **throws** on malformed geometry, matching the
circle / feature-line convention. Both load sanitizers (`sanitizeSurveyCad
PersistedState` + the drawing-file path) already try/catch clone, so a corrupt
file load-rejects instead of silently repairing. No migration write.

## 4. Renderer / preview / SVG / PDF

`src/engine/cad/cadRenderer.ts` `toPrimitives` gains a `parabola` arm that
emits deterministic, bounded LINE primitives from
`cadParabolaTessellatePoints(entity)` (recursive midpoint subdivision in `t`
order, chord tolerance `0.001 m` — the surface-breakline convention — capped at
2048 segments, endpoints always exact). Each chord carries
`sourceEntityId`/`sourceSegmentId` so selection and sub-entity naming resolve to
the parabola. The **stored model stays analytic**; tessellation is display/plot
only. SVG and PDF consume the resulting `CadDisplayLinePrimitive`s through the
existing export-scene pipeline (no per-format parabola code, so no drift).

## 5. Analytic bounds

`cadParabolaEntityBounds` evaluates the finite ends plus the in-range
`dx/dt = 0` / `dy/dt = 0` roots (`t = -bX/aX`, `t = -bY/aY`), never a chord
hull. Wired into:
- `cadSpatialBounds.entityIntersectsBounds` (AABB overlap test);
- `cadProjectState.buildCadBounds` (drawing/project authoritative bounds);
- `cadSpatialIndex` (prepared cursor-box AABB, so broad-phase culling is exact).

## 6. Spatial, selection, snaps

- `cadSpatialIndex`: `isSnapGeometry` accepts `parabola`; the prepared entity
  bounds are the analytic AABB. The curve is **never** indexed as chord
  segments, so intersection/construction snaps cannot produce false chords.
- `cadSpatialEntityCandidates.buildParabolaEntitySnapCandidates` emits:
  - `endpoint` at both finite ends;
  - `midpoint` at the **half curve-length** parameter (exact arc-length
    bisection via `cadParabolaHalfLengthMidpointT`), never the `t`-average;
  - `nearest` at the true finite closest point (bounded cubic solve via
    `cadParabolaClosestPoint`), never a single chord.
  No `center`-as-vertex, `quadrant`, `tangent`, or `perpendicular` candidates
  are fabricated.
- Selection/hit rides the renderer primitives' `sourceEntityId`; the shared
  selection path needs no parabola-specific code.
- Annotation anchoring (`cadAnnotationAnchorFromCommandPoint`) returns a fixed
  (non-associative) anchor for a parabola, like a polyline.

## 7. Exact line/segment intersections

`cadCogoEntityIntersections` gains `cadIntersectSegmentParabola` and
`cadIntersectLineParabola`, both delegating to Worker A's quadratic solve in
the canonical frame and clamping to the finite `t` range **and** the segment
parameter. Deterministic x-then-y order. Circle/arc vs parabola and
parabola-vs-parabola are explicitly **not** provided, so no caller can render a
false chord.

## 8. Properties

`cadProperties.buildEntityProperties` adds read-only analytic rows: name,
vertex E/N, axis angle, axis azimuth (DMS, degrees clockwise from north via
`cadParabolaAxisAzimuthDeg`), focal length, `t` start/end, curve length, and a
chord cogo summary (chord length/azimuth, start/end points). `cadProperties
Model` adds the `Parabolas` / `Parabola` type labels. Only the shared entity
name row is editable.

## 9. Transforms, MOVE / COPY / ERASE

`transformParabolaEntity` (used by `cadTransformGeometry`) is exact under
similarity transforms: the vertex maps through the affine part, the axis maps
through the linear part, focal scales by `|scale|`, and a handedness flip
(`det < 0`) re-parameterizes `t -> -t` so the canonical left-perp convention
survives. Non-uniform/shear/affine (`GENERAL_AFFINE`) fails closed with
`CAD_TRANSFORM_PARABOLA_NON_UNIFORM_UNSUPPORTED`; a sub-floor focal result fails
closed with `CAD_TRANSFORM_PARABOLA_DEGENERATE_RESULT`. No silent shear or
chord.

`translateEntity` (MOVE) translates the vertex; COPY (`buildCopiedEntities`)
mints a fresh deterministic id and translates the vertex, carrying
axis/focal/range; ERASE is the generic removal path.

## 10. Blocks — explicit rejection (not silent omission)

A block instance may carry a non-uniform `scaleX/scaleY`, which cannot map a
parabola into the canonical family. Parabolas are therefore **not** a
`CadBlockChild` and block creation rejects them explicitly: `cadBlockSources`
`SEMANTIC_TYPES` now includes `parabola`, so `classifyBlockSources` reports
`CAD_BLOCK_SEMANTIC_UNSUPPORTED` (never a silent drop). As belt-and-suspenders,
`cadBlockPersistence.cloneBlockChild` throws on any unknown child type, so a
corrupt persisted definition cannot smuggle a parabola into a definition's
entity array as `undefined`. (The alternative — first-class block support — was
judged disproportionate because it would require fail-closing every
non-uniform-scale block and expanding the block preview/selection/DXF surface.)

## 11. DXF R12

`dxfExportModel` gains a `parabola` arm: the analytic curve is exported as a
bounded chord-tolerance **LWPOLYLINE approximation**, the id is added to
`approximatedEntityIds`, and a `SKIPPED_ENTITY` warning is emitted (the frozen
warning union has no `PARABOLA_APPROXIMATED` code; the id list carries the
approximation, mirroring the error-ellipse precedent). It is never claimed as
FULL and never silently dropped.

## 12. LandXML

`landxmlCadProject` gains a `parabola` arm that omits the entity with an
explicit `NOT_APPLICABLE` message (LandXML 1.2 carries no conic curve). No
geometry is written and no chord is substituted.

## 13. TRIM / EXTEND / FILLET

All three already gate on `isTrimmableEntity` (`CadTrimEntity` =
line/polyline/arc), so a parabola is refused before any geometry is built — no
false trim, extension, or fillet. Pinned by test.

## 14. mlightcad / names / labels

`cadMlightcadAdapter` emits the tessellation as `AcDbPolyline` with an explicit
`approximation: 'parabola-tessellation'` marker (truthful, never a native
claim). `cadEntityNames` labels an unnamed parabola `Parabola` (opaque
`cad-parabola:*` ids collapse to the readable type label). No parabola label
entity is introduced; annotation anchors stay fixed.

## 15. Files

New: `src/engine/cad/cadParabola.ts` (entity seam),
`tests/cad_parabola_entity_b1.test.ts`, this note.
Changed: `cadTypes.ts`, `cadPersistence.ts`, `cadRenderer.ts`,
`cadSpatialBounds.ts`, `cadSpatialIndex.ts`, `cadSpatialEntityCandidates.ts`,
`cadProjectState.ts`, `cadCogoEntityIntersections.ts`, `cadProperties.ts`,
`cadPropertiesModel.ts`, `cadEntityNames.ts`, `cadTransformGeometry.ts`,
`cadTransactionsEntityTransforms.ts`, `cadTransactionsClipboardCommands.ts`,
`cadBlockSources.ts`, `cadBlockPersistence.ts`, `cadMlightcadAdapter.ts`,
`annotation/cadAnnotationAnchorFromCommandPoint.ts`, `dxf/dxfExportModel.ts`,
`landxmlCadProject.ts`, `tests/cad_export_coverage.test.ts`.

## 16. Validation

New suite `tests/cad_parabola_entity_b1.test.ts` (25 tests): persistence
roundtrip + malformed rejection, analytic bounds (dense oracle + endpoint-only
range), renderer tessellation error bound (dense oracle, endpoints exact),
closest nearest (dense oracle), half-length midpoint (arc-length split, not
`t`-average), exact line intersection (secant/single/none), transforms
(translate/rotate/uniform-scale/reflection point-mapping + nonuniform
fail-closed reason), MOVE/COPY/ERASE, DXF approximation warning, LandXML
NOT_APPLICABLE, block rejection, TRIM/EXTEND/FILLET refusal, read-only property
rows, mlightcad truthfulness, axis azimuth, and best-fit projection.

Neighbouring suites re-run green: `cad_best_fit_{line,arc,parabola}`,
`cad_circle_consumer_v1`, `cad_circle_reviewfix_v1`,
`cad_polyline_bulge_width_c2_consumers` (7 files, 190 tests);
`cad_export_coverage` (updated to include the parabola across SVG/PDF FULL,
DXF APPROXIMATED, LandXML NOT_APPLICABLE). `test:agent`: 9226 pass, with only
the pre-existing study-desktop real-data trio failing (unrelated) after the
classifier invariant was restored by keeping the shape-builders module out of
the worker import closure.
