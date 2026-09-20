# Phase 18R — Project Transform Architecture Audit

**Branch:** `feat/cad-project-coordinate-transformation` · baseline `7b8ad218a7c14391eb00d45f2ab865780f1fb39d` (origin/main, PR #107 merged).
**Status:** reconnaissance only; no behavior changed.
**Supersedes (rows noted):** `docs/evidence/phase18q-transform-architecture.md` §3/§9 rule 8 (block MIRROR now supported via `mirrored` flag).

## 0. Classification legend

| Code | Meaning |
| --- | --- |
| TRANSFORM | Model geometry/coordinate; mapped by affine kernel (`applyPoint`). |
| SCALE | Scalar in drawing units; multiply by `|scale|` under similarity/GRIDGROUND. |
| UNCHANGED | Presentation, identity, or provenance; never touched. |
| DERIVED-INVALIDATE | Derived/cached; never transformed in place — recompute or invalidate. |
| BLOCKED | Cannot be represented under family; whole object fails transform. |

Kernel: `src/engine/cad/cadTransform2D.ts` — `identity:25`, `translation:27`, `rotationAbout:33`, `uniformScaleAbout:45`, `reflectionAboutLine:51`, `compose:71`, `determinant:79`, `inverse:81`, `applyPoint:93`, `applyVector:99`, `classifyTransform:113`.
Solvers: `src/engine/cad/cadHelmert2D.ts` — `solveHelmert2D:68`, `deriveAlign2DTransform:175`, `gridGroundTransform:224`.
Apply seam: `src/engine/cad/cadTransformApply.ts` — `preflightCadSelectionTransform`, `applyCadSelectionTransform`, `commitCadSelectionTransform` (atomic preflight → single bulk replace + one undo entry).
Per-entity: `src/engine/cad/cadTransformGeometry.ts` — `transformCadEntityGeometry:89` (exhaustive switch; `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED`, `CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY`).
Commands: `src/engine/cad/cadTransactionsTransformCommands.ts` — `ROTATE/SCALE/MIRROR/HELMERT2D/GRIDGROUND/ALIGN2D`.

## 1. Field-domain taxonomy

| Domain | Fields | Behavior |
| --- | --- | --- |
| Model coords | survey-point x/y, line from/to, polyline/polygon/parcel vertices, arc center, alignment element start/end/center, text x/y, ellipse center, block-ref x/y, mtext x/y, leader vertices, dimension dimLinePoint/textPoint, fixed anchors, importedTin vertices, DraftDocumentLabel xModel/yModel | TRANSFORM via `applyPoint` |
| Presentation coords | label offset, mtext/block rotationDeg, ellipse thetaDeg, DraftSheetViewport modelCenter, paper-space *mm | TRANSFORM via `applyVector` or normalize; paper-mm never transformed |
| Derived/session-only | bounds, parcel area/perimeter/closure, CadSurface cachedRevision, CachedSurfaceMesh.*, CadVolumeResult.*, profile/section display layers, CadHistoryState.*, CadTransaction.*, COGO report text | DERIVED-INVALIDATE |
| Linear distances | arc radius, ellipse semi-axes, buildOptions.maxEdgeLength, SampleLine left/rightWidth, PointLabelStyle offsets, arrow sizes/gaps, grid intervals | SCALE × `|s|` |
| Station values | alignment startStation, stationEquations, SampleLine rawStation | UNCHANGED under rigid; PROPAGATED under project similarity per 18R §§24-25,27 (not BLOCKED for project scope) |
| Vertical values | survey-point z, datumElevation, elevation grid intervals | UNCHANGED (2D only) |
| Provenance-only | CadAdjustmentDependency.*, metadata.provenance, COGO provenance, sourceObservationIds, surface provenance, CadEntityOwner | UNCHANGED (must survive; ownership detaches to TRANSFORMED/MANUAL per 18R §§49-52) |

## 2. Transformation matrix (every coordinate-bearing object)

### Survey Points (`cadTypes.ts:256-275`)
x,y TRANSFORM; z UNCHANGED; stationId/pointClass/source/description/featureCode UNCHANGED; embedded errorEllipse SCALE/DERIVED note; style refs UNCHANGED.

### Lines (`cadTypes.ts:277-286`)
fromX/fromY/toX/toY TRANSFORM; fromStationId/toStationId UNCHANGED; sourceObservationIds UNCHANGED.

### Polylines / Polygons (`cadTypes.ts:288-293`, `334-338`)
vertices[] TRANSFORM (order never reversed); vertexLabels[] UNCHANGED; closed UNCHANGED.

### Parcels (`cadTypes.ts:340-350`)
vertices[] TRANSFORM; areaSquareMeters/perimeterMeters/closureDeltaX/Y/closureDistanceMeters DERIVED-INVALIDATE (recompute; area ×s², perimeter ×s); parcelName/vertexLabels UNCHANGED.

### Arcs (`cadTypes.ts:295-302`)
centerX/centerY TRANSFORM; radius SCALE; startAngleDeg/endAngleDeg TRANSFORM (recompute from endpoints; sweep sign preserved under orientation-preserving similarity); general affine BLOCKED.

### Alignments (`cadTypes.ts:304-318`, elements `326-332`)
line element start/end TRANSFORM; arc center TRANSFORM, radius SCALE, angles recomputed; sourceEntityId UNCHANGED; name/element order UNCHANGED; startStation: UNCHANGED numerically under project transform (§23); stationEquations PROPAGATED per §25 (jump preserved, raw scaled about start); rigid s=1 → bit-identical stationing (§26).

### Station equations (`cadTypes.ts:320-324`)
backStation/aheadStation/rawStation PROPAGATED: raw' = start + s·(raw−start); jump = ahead−back preserved; back' = raw' + Σ prior jumps; ahead' = back' + jump. Resolver: `cadAlignmentStationing.ts` (`cadAlignmentEndStation:83`, `cadAlignmentRawStationToDisplayStation:108`, `cadAlignmentDisplayStationToRawStation:134`).

### Legacy Text (`cadTypes.ts:352-360`)
x,y TRANSFORM; anchorEntityId/pointLabelBinding UNCHANGED (re-resolve); glyph sizing UNCHANGED (legacy).

### MText (`cadTypes.ts:426-434`)
x,y TRANSFORM; rotationDeg TRANSFORM (compose); text/textStyleId/attachment UNCHANGED; paperHeightMm/modelHeight/line spacing/width factor UNCHANGED (presentation standards, §19).

### Leaders (`cadTypes.ts:436-444`)
vertices[] TRANSFORM once; arrowAnchor fixed→TRANSFORM, associative→UNCHANGED (re-resolves to transformed source); styles/text UNCHANGED.

### Dimensions (`cadTypes.ts:448-460`)
dimLinePoint/textPoint TRANSFORM; anchors fixed→TRANSFORM, associative→UNCHANGED; kind/orientation/styles/textOverride UNCHANGED.

### Bearing / Curve labels (`cadTypes.ts:462-469`, `471-477`)
offset TRANSFORM via applyVector (rotate+scale); sourceEntityId UNCHANGED; styles/side/manual override UNCHANGED; derived values recompute.

### Error ellipses (`cadTypes.ts:362-370`)
centerX/centerY TRANSFORM; semiMajor/semiMinor SCALE ×s; thetaDeg TRANSFORM (recompute); stationId UNCHANGED; never touch adjustment covariance.

### Block References (`cadTypes.ts:403-412`)
x,y TRANSFORM; rotationDeg TRANSFORM (compose); scaleX/scaleY SCALE ×|s|; blockDefinitionId UNCHANGED; 18Q semantics reused.

### Native Surfaces (`cadTypes.ts:872-884`, `901-912`)
pointSource/breakline/boundary source refs UNCHANGED (sources transform); CachedSurfaceMesh DERIVED-INVALIDATE (never transform cache); status → NEEDS_REBUILD/UNBUILT; buildOptions.maxEdgeLength SCALE ×s (§35); contour interval UNCHANGED (vertical); contours DERIVED-INVALIDATE.

### Imported TIN (`cadTypes.ts:866-870`)
vertices[] XY TRANSFORM (z UNCHANGED) — AUTHORITATIVE; faces[] UNCHANGED EXACTLY (no Delaunay/reorder); provenance fileName/surfaceName/sourceId UNCHANGED; audit records later transform.

### Surface Profiles (`cadTypes.ts:1046-1053`)
alignmentEntityId/surfaceId/styleId/name UNCHANGED (refs only); derived samples DERIVED-INVALIDATE → UNBUILT/NEEDS_REBUILD.

### Profile Views (`cadTypes.ts:1071-1089`)
insertionX/Y TRANSFORM (stay in drawing neighborhood); horizontalScale/verticalExaggeration/datumElevation/grid intervals/width-height UNCHANGED (presentation); refs UNCHANGED; axis-aligned.

### Volume Surfaces (`cadTypes.ts:960-969`, results `997-1039`)
baseSurfaceId/comparisonSurfaceId/refs UNCHANGED; derived volumes/stats/display regions DERIVED-INVALIDATE (never scale cache; recompute → old×s² oracle §41).

### Sample Line Groups / Sample Lines (`cadTypes.ts:1118-1142`)
rawStation PROPAGATED: raw' = start + s·(raw−start); leftWidth/rightWidth SCALE ×s; skewDeg UNCHANGED; manualName UNCHANGED; group alignmentEntityId/surfaceSources/layerId UNCHANGED.

### Section Views (`cadTypes.ts:1160-1177`)
insertionX/Y TRANSFORM; horizontalScale/verticalExaggeration/datum/grid UNCHANGED; sourceSurfaceIds/sampleLineGroupId/sampleLineId/style/layer UNCHANGED; no persisted section geometry.

### Point Groups (`cadTypes.ts:163-172`)
query/rules UNCHANGED; membership re-derives; elevationMin/Max UNCHANGED (vertical); style overrides UNCHANGED.

### Styles (all presentation — `cadTypes.ts:87-128`, `479-524`, `972-983`, `1056-1064`, `1145-1153`)
Text/Dimension/Leader/Point/Surface/Profile/Section/Volume styles UNCHANGED (paper heights, arrow sizes, marker scales, contour intervals, lineweights, linetypes, layer appearance, annotationScaleDenominator). CadPointLabelStyle offsetX/Y: UNCHANGED (paper-sized label offsets; confirm intentional).

### Block Definitions (`cadTypes.ts:386-392`)
basePoint/entities/id/name/description ALL UNCHANGED (library-local space; only references transform).

### Draft / paper resources (`cadDraftTypes.ts`)
DraftSheetViewport.modelCenterX/Y TRANSFORM-or-stale decision required (§65-66: transform atomically OR preflight-block OR mark stale — chosen: transform atomically); scaleDenominator/paper-mm/rotation/clip/layerOverrides UNCHANGED; DraftDocumentLabel.xModel/yModel TRANSFORM; tables/title blocks UNCHANGED. Never leave finished sheets silently aimed at old frame.

## 3. Dependency / provenance / persistence

- CadAdjustmentDependency (`cadAdjustmentDependency.ts:22-26`): fingerprints UNCHANGED (lineage preserved); `ownerOfCadEntity:82`, `evaluateCadEntityDependency:230`, `summarizeDrawingDependency:275`, `decideCadDeliverableVerdict:328`. After transform: transformed entities → MANUAL/TRANSFORMED-DERIVED with `metadata.coordinateTransform={transformId,sourceOwner,sourceAdjustmentDependency}`; summary must NOT claim CURRENT-adjustment (→ MANUAL_ONLY/TRANSFORMED).
- F2F: `metadata.provenance.generatedBy/state` + `fieldToFinishCatalog/Settings` (`cadTypes.ts:577-590`) UNCHANGED as lineage; active ownership → F2F_MANUAL_OVERRIDE.
- COGO: `cadCogoTypes.ts` (`CadCogoComputation:80-91`, `CadCogoReport:39-44`, `CadCogoProvenance:59-68`); history UNCHANGED (never rewrite); append one PROJECT_COORDINATE_TRANSFORM computation.
- Import Adjusted Points (`cadAdjustedPointsImport.ts`): after transform history exists → BLOCK with mixed-frame message; likewise Send-to-CAD/refresh/F2F refresh writing source-frame coords BLOCK; LandXML import allowed with warning (confirm target frame, no auto-transform).
- WNCAD: `CadDrawingDocument` (`cadTypes.ts:669-682`), `cadPersistence.ts` (clone/sanitize/migrate), `cadDrawingFile.ts` (schema 1|2), signatures `cadProjectState.ts:146,157` — persist transformed coords/stationing/TIN arrays/ownership/audit; never persist derived caches; legacy (no history) unchanged.
- Bounds: DERIVED-INVALIDATE, rebuilt via `buildCadBounds` (`cadProjectState.ts:34`); TIN-only extents included per current contract.
- History: `cadUndoRedo.ts` — PROJECTTRANSFORM is ONE transaction; undo restores coords/stationing/widths/TIN/build options/view insertions/ownership/audit/bounds; redo deterministic (same floats, same audit identity, no regenerated ID).
- Worker safety: surface/profile/section/volume builds keyed by drawing/revision/request ownership; late old-frame results discarded (existing latest-wins).

## 4. Gaps closed by 18R (vs 18Q BLOCKED)

1. Alignment scale: 18Q BLOCKED (`CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY`) → 18R project scope PROPAGATES stationing (§§22-26).
2. Imported-TIN vertices: 18Q silently UNCHANGED → 18R TRANSFORMS XY, preserves faces exactly (§§36-37).
3. Profile/Section view insertion: 18Q untouched → 18R TRANSFORMS insertionX/Y (§§31-32).
4. `buildOptions.maxEdgeLength`: 18Q unscaled → 18R SCALES ×s (§35).
5. Block MIRROR doc row superseded (implementation supports `mirrored` flag; 18R project scope is orientation-preserving only, so reflection excluded by determinant check anyway).

## 5. Orientation-preserving gate (§8)

Project determinant must be positive; reject reflection/negative scale/general affine/non-uniform/shear/3D/vertical scale. Reuse `classifyTransform` + `CadTransform2D`. Preserves LEFT/RIGHT, offset sign, bearing orientation, parcel winding.
