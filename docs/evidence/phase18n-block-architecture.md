# Phase 18N Block Architecture Audit

Baseline: origin/main 876911254df0b165315b4c183804e913a2c4e2e7 (PR #103 merge, exact match).
Branch: feat/cad-blocks-survey-symbols.
Baseline validation 2026-09-19: lint 0 errors / 2 pre-existing warnings; typecheck clean; portable-paths 4177/0.

## 1. Verdict

NO native block-definition / insert model currently exists in model space.

Grep `blockDefinition|blockReference|BLOCK|INSERT` over src/: zero model-space hits.
Only hits: (a) DraftTitleBlockDefinition paper-space sheet template (cadDraftTypes.ts:150-156, cadSheets.ts:193-311);
(b) DXF layout export BLOCK/ENDBLK/INSERT for title blocks only (dxfLayoutExport.ts:523,657-669);
(c) unrelated `exportPolicy 'BLOCK'` verdict string and ANTEX token.
No BLOCK/INSERT in CadCommandKey (cadTransactions.types.ts:55-169) or registry (cadCommandRegistry.ts:50-104).
CadEntity has no block member; dxfExportModel.ts:179-181 documents "no block library".

## 2. Current primitive symbol architecture

- CadPointSymbolShape = circle|square|triangle|cross|x|dot (cadTypes.ts:97); CadPointSymbol {id,name,radius,shape?} (100-105).
- normalizePointSymbolShape / describePointSymbolShape (cadPointSymbolShape.ts:17-72) -> circle|dot|polygon|segments.
- Catalogue cadStyles.ts:32-40. CadStyleLibrary {lineTypes,textStyles,pointSymbols,styles} (cadTypes.ts:229-234) — no block table.
- CadPointStyle {markerSymbolId,markerScale?,rotationDeg?,displayMarker} (cadTypes.ts:215-226). rotationDeg is STORED-ONLY, never consumed (no reader in cadRendererStyle.ts, cadRenderer.ts, cadExportScene.ts, preview, pdf).
- Marker authority: cadRendererStyle.ts:42-77 surveyPointMarker; radius = symbol.radius*(markerScale??1); displayMarker false hides. Screen emit cadRenderer.ts:411-437; draw SurveyCadPreviewPrimitive.tsx:152-200; export cadExportScene.ts:187-215; DXF always POINT+TEXT approximated dxfExportModel.ts:173-187.

## 3. Repeated geometry model

None. COPY (cadTransactionsClipboardCommands.ts:270-300, buildCopiedEntities :32-215) deep-copies every entity. No instancing.

## 4. Entity transforms

- CadBaseEntity {id,type,layerId,styleId?,visible,locked,appearance?,metadata?} (cadTypes.ts:45-55).
- CadEntity = survey-point|line|polyline|arc|alignment|polygon|parcel|text|error-ellipse (cadTypes.ts:236-342).
- translateEntity covers all nine (cadTransactionsEntityTransforms.ts:20-81). Grip handles buildCadGripHandles :237-311; applyCadGripEdit :313-331; GRIP_EDIT command cadTransactionsModifyCommands.ts:333-360.
- MOVE :217-267, COPY :270-300, PASTE :303-320, ERASE cadTransactions.ts:188-221, EDIT_ENTITY cadTransactionsEditCommands.ts:24-230.
- Edit gate checkCadEntityEditable (cadAppearance.ts:74-89) LAYER_LOCKED/ENTITY_HIDDEN — single choke point.

## 5. Appearance resolution

resolveCadEntityAppearance (cadAppearance.ts:91-121): explicit > style > layer > default (#94a3b8, 0.25mm, continuous, transparency 0); printable = layer?.printable !== false. 18C authoritative. Point display resolveSurveyPointDisplay (cadPointGroups.ts:150-210): manual > group > base > default.

## 6. Selection / snap

- Selection state cadSelection.ts:3-64. Click select via SVG hit targets (SurveyCadPreviewCanvas.tsx:351-358; generous marker hit target SurveyCadPreviewPrimitive.tsx:169-200). Box select intersectsSelectionBox (SurveyCadPreview.geometry.ts:188).
- Spatial index buildCadSpatialIndex (cadSpatialIndex.ts:47-369); snap candidates cadSpatialSnapCandidates.ts; hook useSurveyCadSnapping.ts:87-93. Snap kinds cadTypes.ts:524-540.

## 7. Export adapters

- Scene: buildExportSheetSceneWithResult (cadExportScene.ts:521-679); ExportItem :42-57.
- SVG serializeExportSceneToSvg :60-102; PDF exportScenesToPdfWithWarnings :212-288.
- DXF R12 serializeDxfModelWithResult (dxfSerializer.ts:91-161, AC1009); model buildDxfExportModelWithResult (dxfExportModel.ts:103-387).
- DXF R2000 buildDxfLayoutInner (dxfLayoutExport.ts:284-737, AC1015); BLOCK/ENDBLK only for title blocks.
- Disposition: ExportWarningCode/ExportResult + finalizeExportResult (exportResult.ts:13-110); matrix tests/cad_export_coverage.test.ts:110; docs/webnet-cad-layout-plotting.md:69.
- LandXML: civil-only, presentation omitted by design.

## 8. Point-style integration seams

cadRendererStyle.ts:42-77 (sole authority); cadRenderer.ts:411-437; SurveyCadPreviewPrimitive.tsx:152-200; cadExportScene.ts:187-215; dxfExportModel.ts:173-187; SurveyPointStyleManager.tsx:44-45,209-210; cadSurveySnapshot.ts:76; CadPropertiesPalette.tsx:413. F2F resolveBasePointStyleId (cadGeneration.ts:380-399).

## 9. Rotation convention

Geometry: degrees, CCW-positive from +X, y-up (cadGeometryArcPrimitives.ts:13-25; cadAngleDegFromCenter atan2 cadGeometry.ts:182-185; normalize cadNormalizeAngleDeg :176-179). Bearings separate (atan2(east,north)). Scene/paper rotationDeg is clockwise-positive, negated at DXF/SVG/PDF boundary (cadRenderer.ts:216-236; cadExportScene.ts:363-369; dxfLayoutExport.ts:129-150). Blocks must store geometry-convention degrees CCW from +X; arc rotation = theta+delta.

## 10. Eligible-geometry audit

Safe initial children: line, polyline, arc, circle/ellipse (if exists as primitive), polygon, text (with pointLabel binding dropped). Exclude: survey-point (station identity), alignment (dependent profiles/views), parcel-as-boundary refs, surfaces/volumes/profiles/sections (tables, never selectable), error-ellipse (station coupling), text pointLabel bindings, locked/hidden sources (fail closed).

## 11. Reference-integrity hazards

Station-id coupling (fromStationId/toStationId, vertexLabels, anchorEntityId, stationId); surface boundary/breakline sourceEntityId -> BROKEN_REFERENCE on orphan; alignment dependents (profiles/views/sample groups by alignmentEntityId). Block clone must drop/re-map or exclude.

## 12. Persistence / undo seams

- WNCAD CadDrawingDocument schemaVersion 1|2 (cadTypes.ts:473-484); migrateV1ToV2 cadDrawingFile.ts:176-203; sanitizer :265-329; additive v2 precedent (18F :300-305). New tables must be optional trailing + appended last in cloneCadProject + buildStableCadProjectSignature (cadProjectState.ts:118-145, JSON key-order sensitive).
- Undo: runCadCommand cadUndoRedo.ts:58-87; workspace useSurveyCadWorkspaceHistory.ts:10-80.
- Layers: {visible (ON/OFF), frozen?, locked, printable?} cadTypes.ts:57-82; view filter isLayerHidden cadViewportAppearance.ts:87-92; plot consumed cadExportScene.ts:538-547.

## 13. What 18N must build

New optional trailing CadProject.blockDefinitions table (schema 2 additive); new CadEntity block-reference member; translate/copy cases; registry BLOCK/INSERT/EXPLODE/BLOCKS; shared pure transform/bounds/expansion seam; cycle diagnostic CAD_BLOCK_REFERENCE_CYCLE; appearance inheritance contract; WNCAD + undo; block-backed Point Style marker; F2F through style; DXF R2000 native BLOCK/INSERT + R12 explicit policy; SVG/PDF via export scene; symbol seeds; manager/preview/commands/properties/snapping.
