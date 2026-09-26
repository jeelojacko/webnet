# Phase 19A — Survey Plan Production: Baseline + Architecture Audit

**Branch:** `feat/cad-survey-plan-production` · **Status:** reconnaissance only, no behavior changed.
**Baseline SHA:** `bd44465a709ef183e86a3c650f98475de1608af2` (matches mission creation time; origin/main had not advanced).
**Method:** read-only source/doc/reflog inspection.

---

## 0. Baseline and Phase 18Z merge ancestry

Evidence:
- `origin/main` → `bd44465a709ef183e86a3c650f98475de1608af2`; branch created directly from it.
- Phase 18Z chain: `fb33d293` (18Y/PR #116 baseline) → … → `16f12566` ("Phase 18Z: close out TODO with PR reference and GO decision") → merge into main `bd44465a` (PR #117).
- `TODO.md` records Phase 18Z decision **GO-CAD-COMPOSITION-SCALING**, PR #117.

Baseline validation (orchestrator, on branch):
- lint: 0 errors, 2 pre-existing warnings (unused eslint-disable in study-desktop evidence tests)
- typecheck: pass
- test:agent: 5870 passed, 3 failed — all pre-existing study-desktop calibration/preflight (`study_ai_unit_calibration`, `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), unrelated to CAD
- test:wasm: 74/74 pass
- parity:industry-reference: 25/25 pass
- build: pass

---

## 1. Inventory (verified path + line numbers)

### 1.1 Parcel entity + parcel helpers

| Item | Location |
| --- | --- |
| `CadParcelEntity` (`type:'parcel'`, `vertices: CadDisplayPoint[]`, `vertexLabels: string[]`, `parcelName`, optional `areaSquareMeters/perimeterMeters/closureDeltaX/Y/closureDistanceMeters`) | `src/engine/cad/cadTypes.ts:344-354` |
| `CadBaseEntity` (id/type/layerId/styleId?/visible/locked/metadata) | `src/engine/cad/cadTypes.ts:51-61` |
| `CadParcelSourceDraft` / `CadParcelClosureSummary` / `CadParcelReportSummary` | `src/engine/cad/cadCogoParcelGeometryTypes.ts` |
| `cadBuildParcelClosureSummary` (shoelace area/perimeter/closure/centroid) | `src/engine/cad/cadCogoParcelGeometrySummaries.ts:60` |
| `cadBuildParcelReportSummary` (closure + per-course azimuth/bearing/distance) | `src/engine/cad/cadCogoParcelGeometrySummaries.ts:135` |
| `cadBuildParcelSourceDraft` (**`CadLineEntity \| CadPolylineEntity` only**) | `src/engine/cad/cadCogoParcelGeometrySourceDraft.ts:118` |
| `cadBuildParcelSplitByLineDraft` (segment-intersection ring split, straight edges) | `src/engine/cad/cadCogoParcelSplit.ts:20,28` |
| `parcelCreateCommand` (`PARCEL_CREATE`) | `src/engine/cad/cadTransactionsParcelBasicCommands.ts:27` |
| `parcelSplitCommand` (`PARCEL_SPLIT`, by selected line) | `src/engine/cad/cadTransactionsParcelBasicCommands.ts:143` |
| Split-by-bearing/area/slide/swing | `src/engine/cad/cadTransactionsParcelSplitCommands.ts`, `cadTransactionsParcelLayoutCommands.ts` |
| Layout report rows | `src/engine/cad/cadTransactionsParcelLayoutReports.ts:54,78,103` |
| Parcel layout frontage reference (accepts line/polyline/**arc → reduced to chord + `sourceGeometry`) | `src/engine/cad/cadCogoParcelFrontage.ts:16-77,79` |

### 1.2 COGO report tables + draft (drawing) tables

| Item | Location |
| --- | --- |
| **REPORT TABLE** shape `CadCogoReportTable {title, columns, rows}` | `src/engine/cad/cadCogoTypes.ts:33` |
| `CadCogoToolKey` union | `cadCogoTypes.ts:3-25` |
| COGO report text/CSV/MD exporter | `src/engine/cad/cadCogoReports.ts:12,22` |
| COGO report panel | `src/components/surveyCad/SurveyCadCogoPanel.tsx:35,78` |
| **DRAWING TABLE** logical table + fragment model | `src/engine/cad/cadDraftTypes.ts:165,179,207,208` |
| Draft row builders (`buildDraftPointTable`, `buildDraftLineTable`, `buildDraftCurveTable`) | `src/engine/cad/cadDraftTables.ts:75,103,128` |
| Sheet placement → SVG/PDF scene items | `src/engine/cad/cadExportTables.ts:9-15` |

### 1.3 Bearing/distance + curve labels + styles

| Item | Location |
| --- | --- |
| `CadBearingDistanceLabelEntity` (`type:'bearing-label'`) | `src/engine/cad/cadTypes.ts:466-473` |
| `CadCurveLabelEntity` (`type:'curve-label'`) | `src/engine/cad/cadTypes.ts:475-481` |
| `deriveBearingDistanceLabel`, `deriveCurveLabel` | `src/engine/cad/annotation/cadSurveyLabels.ts:106,149` |
| `formatCadBearing` / `buildCadInverseSummary` / azimuth/distance summaries | `src/engine/cad/cadCogoSummaries.ts:116,164,66,176` |
| `cadBuildCurveMetricsSummaryFromRadiusDelta` + `cadSolveCurveMetrics` | `src/engine/cad/cadCogoCurveMetrics.ts:137,55` |
| Raw curve math | `src/engine/cad/cadCogoCurveMath.ts` |
| `CadTextStyle` + `CadTextHeightMode` (`legacy-screen \| model \| paper`) | `cadTypes.ts:99-113,97` |
| `resolveCadAnnotationTextMetrics` | `annotation/cadAnnotationTextMetrics.ts:36` |
| `CadAnnotationSettings` + `resolveAnnotationScaleDenominator` | `annotation/cadAnnotationSettings.ts:8,49` |

**`CadEntity` union:** `src/engine/cad/cadTypes.ts:530-546` (15 members).
**WNCAD:** `src/engine/cad/cadDrawingFile.ts` (migrate/sanitize); `src/engine/cad/cadPersistence.ts:92,192,331,341` (clone).
**Command registries:** engine `CAD_COMMAND_REGISTRY` → `src/engine/cad/cadTransactions.ts:514`; shell → `src/cad-app/shell/cadCommandRegistry.ts:153`.

### 1.4 Export architecture

- Unified contract `ExportResult` (`FULL/APPROXIMATED/NOT_APPLICABLE/UNSUPPORTED_WITH_WARNING`): `src/engine/cad/exportResult.ts:20-45`
- Canonical paper scene: `src/engine/cad/cadExportScene.ts:584`; SVG `cadSvgSerializer.ts:105`; PDF `cadPdfExport.ts:329`
- DXF: `dxf/dxfExportModel.ts:139`, `dxfAnnotationExport.ts:400`, `dxfBlockExport.ts`, `dxfLayoutExport.ts`
- LandXML: `src/engine/landxmlCadProject.ts:362`
- Export Center: `src/engine/cad/exportCenter.ts:42,96,105,144,417`
- Coverage matrix: `tests/cad_export_coverage.test.ts`

Parcel disposition today: SVG/PDF **FULL**, DXF **APPROXIMATED**, LandXML entity-partitioned.

---

## 2. Audit answers (mission §2)

**A. Parcel geometry authority.** `CadParcelEntity` is sole authority: straight-edge polygon `vertices[]` + `vertexLabels[]`. Area/perimeter/closure fields are caches recomputed on edit/transform/render — never geometry.

**B. Course derivation.** Derived, never persisted: `cadBuildParcelReportSummary` walks `ring[i] → ring[i+1]`, calls `buildCadInverseSummary` per leg. All edges straight by construction.

**C. Stable identity?** No. Entity ids are `crypto.randomUUID()`; only semantic identity is `parcelName` (`Parcel N`) + `metadata.cogo.provenanceId`. No immutable lot/PID, no course IDs.

**D. Source-entity relationship.** Create: additive, sources kept, `metadata.sourceEntityIds` only. Split: parent removed, two new UUID entities with `metadata.parentParcelId`. No cascade, no re-derivation.

**E. Straight-vs-curve.** Authoritatively straight-edge only. Curved input accepted in exactly one place — layout frontage may be arc but is immediately reduced to chord (`cadCogoParcelFrontage.ts:36-77`).

**F. Formatter ownership.** Single owners: `formatCadBearing` (`cadCogoSummaries.ts:116`), curve metrics `cadCogoCurveMetrics.ts:137`, raw math `cadCogoCurveMath.ts`. All consumers reuse; no duplicates found.

**G. Text Style architecture.** One drawing-wide `styleLibrary.textStyles`; single resolution seam `resolveCadAnnotationTextMetrics` → model metres; `annotationSettings.scaleDenominator` default 500.

**H. DRAWING TABLE vs REPORT TABLE.** REPORT TABLE = `CadCogoReportTable` in `CadCogoComputation`, rendered by `SurveyCadCogoPanel`, never on sheet. DRAWING TABLE = `DraftLogicalTable` + fragments, placed paper-mm on sheets, exported as geometry. Parcel courses today are neither — only report rows + viewport overlay card. **No bridge exists between the two; this is the core 19A gap.**

**I. Associative annotation pattern.** Model entities (`bearing-label`, `curve-label`, …) via `sourceEntityId` + read-time derivation + BROKEN_REFERENCE placeholder. Draft labels via `sourceEntityId` + AUTO/MANUAL placement + dependency status. Both id-based, non-cascading, resolve at read time.

**J. Source-deletion behavior.** `ERASE` is atomic, no cascade. Dependents degrade honestly (BROKEN_REFERENCE placeholder / STALE export gate). Parcels unaffected (copied geometry).

**K. Project Transform.** Whole-drawing Helmert 2D under positive-determinant gate; one undo entry; parcel vertices transform + metrics recomputed; annotation offsets via `applyVector`; COGO history appended, never rewritten.

**L. WNCAD.** Schema v2; additive tables must be optional + **trailing** in `cloneCadProject`/`createBlankCadProject`/both sanitize paths (key-order-signature-sensitive). Dangling refs stay dangling. Derived caches cleared on load.

---

## 3. Scope decision (§3): DEFER curved parcel courses

Proven authoritatively absent: no curve field on entity; creation accepts only line/polyline; split/closure/layout math is segment/shoelace; arc frontage reduced to chord; `CadArcEntity` never appears in parcel type signatures. Curved courses would require a new element-list representation + arc-aware split/closure/export — a follow-on phase. **19A ships straight-edge survey-plan production: straight parcel courses + standalone line rows + standalone arc curve rows.**

---

## 4. Integration map

| Need | Where to hook |
| --- | --- |
| New entity kind | `CadEntity` union `cadTypes.ts:530` + `cadPropertiesModel.ts:59` + `cadPersistence.ts:92` + `cadRenderer.ts:1093` + DXF adapter + coverage matrix |
| New engine command | `CadCommandKey` (`cadTransactions.types.ts:68`), definition file (`cadTransactionsParcel*` pattern), `CAD_COMMAND_REGISTRY` (`cadTransactions.ts:514`) |
| Shell command | `ActiveCommandKey`, `CAD_SHELL_COMMANDS` (`cadCommandRegistry.ts:153`), ribbon `CadRibbon.tsx:49-56` |
| Toolspace | `CadToolspace.tsx` + `Cad<Feature>Toolspace.tsx` sibling; snapshot in `cadShellTypes.ts` |
| Properties | `cadProperties.ts` switch + `cadPropertiesModel.ts`; `CadPropertiesPalette.tsx` |
| WNCAD | `cadDrawingFile.ts` + `cadPersistence.ts:192`, trailing + key-order-stable |
| Export | `exportCenter.ts`, `cadExportScene.ts`, `cadSvgSerializer.ts`, `cadPdfExport.ts`, `dxf/*`; matrix `tests/cad_export_coverage.test.ts` |

## 5. Risks

1. Key-order-sensitive persistence — new tables trailing only.
2. `Date.now()/Math.random()` provenance ids in parcel diagnostic reports — avoid for deterministic outputs.
3. File-size pressure — `cadRenderer.ts` ~1,320 lines, `CadToolspace.tsx` ~815; prefer new sibling modules.
4. Two shells coexist — add new commands to shell registry, dispatch via workspace actions.
