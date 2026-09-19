# Phase 18O — Annotation Architecture Audit

Baseline: `24c648690d37554fe82b48f897850eb4e1b493a9` (origin/main at mission creation, verified by fetch; PR #104 merged).
Branch: `feat/cad-professional-annotation`.

## 1. Legacy text contract

- `CadTextEntity` (`src/engine/cad/cadTypes.ts:340-347`): `{ type:'text', x, y, text, anchorEntityId?, pointLabel?: CadPointLabelBinding }`. Free text = persisted/baked; F2F binding = persisted/associative with baked x/y/text snapshot.
- `CadTextStyle` (`cadTypes.ts:91-96`): `{ id, name, fontFamily, fontSize }` only. `fontSize` is unitless screen px (viewport draws verbatim, fallback 11; seed `label-default = 11` in `cadStyles.ts:22-30`).
- Paper conversion is magic factor `heightMm = max(0.5, fontSize*0.35)` (`cadExportScene.ts:246`). Draft/title text uses explicit paper mm instead (default 3.5mm). DXF model text hard-codes height 2.5. `fontFamily` never reaches SVG/PDF/DXF (PDF Helvetica, DXF 'Standard').
- No annotation scale exists anywhere (recorded as future in `cadTypes.ts:167`, `cadPointLabelStyles.ts:12`).

## 2. Label inventory (PERSISTED / DERIVED / BAKED / ASSOCIATIVE)

- Point styles / label styles / groups: PERSISTED definitions; label text DERIVED via `materializePointLabel` (`cadPointLabelStyles.ts:220-267`).
- Traverse azimuth+distance, alignment station, arc curve (Δ,R,L), parcel area/perimeter labels: DERIVED at render (`cadRenderer.ts:203-388`).
- `anchorEntityId`: vestigial, never resolved at render (only F2F sync).
- Draft/paper labels (`CadDraftLabel`): PERSISTED placement + re-derivable AUTO_VALUE/USER_OVERRIDE/BROKEN_REFERENCE — closest existing broken-ref precedent.
- Contour labels: DERIVED viewport-only session cache.

## 3. Renderer / export seams

- Viewport: `<text fontSize>` screen px, no zoom scaling (`SurveyCadPreviewPrimitive.tsx:227-278`).
- SVG/PDF: paper-mm via export scene; PDF WinAnsi-sanitized Helvetica.
- DXF R12 model-only TEXT; R2000 layouts model+paper TEXT; lineweights dropped with warning.
- LandXML: text NOT_APPLICABLE, omitted with disposition (`landxmlCadProject.ts:320-321`, `exportResult.ts` contract).
- Appearance: `resolveCadEntityAppearance` (`cadAppearance.ts:78-113`); OFF/FROZEN hides, LOCKED gates edits only, printable=false unconditional in SVG+PDF.

## 4. Geometry / anchors

- 10 entity types (`cadTypes.ts:398-409`): survey-point, line, polyline, arc, alignment, polygon, parcel, text, error-ellipse, block-reference.
- Line: from/to + station refs; Arc: center/radius/angles (endpoints derived); Polyline vertices index-only, no stable IDs (segment id `${entity.id}#${index}`).
- Supported associative anchors for 18O: fixed, survey-point ref, line-endpoint ref, arc center/start/end ref, block-insertion ref. Polyline vertex → FIXED (no stable identity).
- Bearing/inverse: `formatCadBearing`, `buildCadInverseSummary` (`cadCogoSummaries.ts`); curve metrics `cadSolveCurveMetrics` / `cadBuildCurveMetricsSummaryFromRadiusDelta` (`cadCogoCurveMetrics.ts`); arc helpers `cadCogoCurveMath.ts`. Reuse mandatory, no new formatters.
- Units: internal meters+radians; drawing carries `units: UnitsMode`; coordinates persist verbatim; no CAD unit-conversion module (conversion only at import/export boundaries).

## 5. Blocks / arrowheads

- Block definition/reference + expansion seam `expandBlockReference` / `expandedBlockPrimitives` (`cadBlocks.ts`, `cadRendererBlocks.ts:27-67`); appearance inherits host layer; SVG/PDF expand (no instance semantic), DXF preserves native INSERT.
- No arrowhead block exists; 26-seed symbol library has no arrow/leader symbol; current arrows procedural (`buildNorthArrowItems`). 18O seeds Closed/Open Arrow, Dot, Tick with +X convention (tip at origin, body −X).

## 6. Commands / selection / persistence

- Two registries: engine `CAD_COMMAND_REGISTRY` (`cadTransactions.ts:497-626`) + shell `cadCommandRegistry.ts` — keep in sync manually.
- Selection: fat SVG hit targets; box-select containment/crossing; grips `buildCadGripHandles` / `updateEntityFromGrip`; MOVE/COPY/ERASE atomic with editable gate; undo/redo snapshot history.
- WNCAD `CadDrawingDocument` schema 1|2, additive optional tables appended last + `cloneCadProject` + `buildStableCadProjectSignature` must be extended together.
- Snapping: spatial index + 14 kinds + priority constants; annotation must not overpower survey geometry.

## 7. Decisions for 18O

- Legacy `fontSize` semantics frozen; professional sizing additive (`heightMode` model/paper/legacy-screen).
- One shared `resolveCadAnnotationTextMetrics`; no Canvas.measureText as geometric truth.
- Semantic entities persisted; derived graphics never persisted; broken refs stay broken with fallback display.
- Export: SVG/PDF full fidelity via shared geometry helper; DXF primitives with APPROXIMATED disposition unless native proven; LandXML NOT_APPLICABLE with warning.
