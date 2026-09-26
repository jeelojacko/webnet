# Phase 19B — Sheet/Layout Architecture Audit

Branch: `feat/cad-professional-sheet-layouts`
Baseline: `7373d43d` (= origin/main at mission creation, PR #118 merge).
Date: 2026-09-26. Method: full reads + repo-wide consumer greps (engine-only vs production-wired verified, not assumed).

## 0. Headline

1. No `CadLayoutEntity` / `CadPaperSpaceProject` / `DraftSheetTemplate` / `plotFrame` / viewport-lock concept exists (zero matches).
2. Sheets + viewports are fully modeled and persisted but have **no authoring UI** — only production draft mutation is the title-block template editor, which clears model undo history.
3. Production SVG/PDF/DXF contain **no north arrow or scale bar**; sheet preview hardcodes both per viewport with geometry differing from the two engine builders.
4. Preview and export disagree on `printable`, `viewport.layerOverrides`, and plan notes with a template assigned.
5. Decision: **extend/professionalize DraftDocument**. No evidence of a fundamental problem requiring replacement.

## 1. Inventory (path + line)

### 1.1 Draft model — `src/engine/cad/cadDraftTypes.ts`

- `DraftSheetViewport` 55–72: modelCenterX/Y, scaleDenominator, paperXmm/Ymm/W/H, `rotationDeg` 64, optional clip 65–69, `layerOverrides?: Record<string,{visible?:boolean}>` 70. No lock/plot/frozen field.
- `DraftDocumentLabel` 89–107: provenance, overrideText, placement, `viewportOverrides` 76–81 (dxMm/dyMm/rotationDeg/visible), leader 83–87, sourceEntityId.
- `DraftSheetObject` 109–117: `kind: string`; only shapes in practice are `'plan-note'` (`cadSheets.ts:322–327`) and sanitize fallback `'text'`.
- `DraftSheet` 119–129; `DraftTitleBlockElement` 131–148 (`line|rect|static-text|token-text`, paper-mm); `DraftTitleBlockDefinition` 150–156.
- `DraftLogicalTable` 165–177 (owns rows), `DraftTableFragment` 179–188 (references ranges).
- `DraftDocument` 197–213 (`version: 1`, modelSpaceProjectId, layers, annotationStyles, precision, sheets, titleBlockDefinitions, labels, tables, tableFragments, metadata).
- Factories: `createDraftSheet` 280 (margins 10 mm all sides, **no template hook**); `cloneDraftDocument` 301–345; `sanitizeDraftDocument` 457+ (idempotent stable-id rule).

### 1.2 Sheet helpers — `src/engine/cad/cadSheets.ts`

Production-wired: `STANDARD_SHEET_SIZES_MM` 11–24 (12 sizes, portrait basis), `createPlanSheet` 67–77, `asPlanViewport` 35, `modelToPaperMm` 159–160 (= m·1000/den), `NORTH_REFERENCE='grid'` 178, `northArrowAngleDeg` 179–180 (`((θ%360)+360)%360`), `buildSheetTokenContext` 226–241, `expandSheetTokens` 202–212, `SHEET_TOKENS` 198 (11 tokens), template CRUD 252–296, `deleteTitleBlockTemplateIfUnused` 298–312 (fail-closed), `assignTitleBlockToSheet` 314–320, `DraftSheetHistoryState` + undo/redo 335–353.

Engine-only (zero production consumers, grep-verified): `STANDARD_VIEWPORT_SCALES` 28, `mmToInch`/`inchToMm` 64–65, `renameSheetInDraft` 83, `duplicateSheetInDraft` 86–95, `deleteSheetFromDraft` 97, `reorderSheetsInDraft` 103–107, `addViewportToSheet` 109–122 (only sensible default: 1:500, margins-to-margins, rot 0), `moveViewportCenter` 124, `setViewportScale` 127, `rotateViewport` 133, `setViewportClip` 139, `setViewportLayerOverride` 144–157, `paperMmToModel` 162, `suggestViewportScale` 166–172, `buildScaleBar` 183–189, `TitleBlockInstance`/`createTitleBlockInstance`/`setTitleBlockField` 214–222 (**not persisted**), `addPlanNote`/`editPlanNoteText` 322–331, `runDraftSheetCommand`/undo/redo 339–353.

### 1.3 Sheet workspace — `src/components/surveyCad/SheetWorkspace.tsx`

Read-only renderer. Props 145–155: no `onDraftChange`, no selection, no editing, no zoom/pan, no hit-testing. MODEL preview fixed `<svg width={640} height={420}>` 203; SHEET preview `widthMm*2.5` px/mm 210–211, no scroll/zoom container (ARCH D landscape ⇒ 2286 px wide). Only 5 primitive kinds (`line|point|text|ellipse|arc`, 26–105; default null). Viewport group: `translate(C) rotate(θ) scale(k,−k) translate(−M)`, k=1000/den (118–128); text counter-mirror 41–45; ellipse negated-angle + "double-mirror bug" note 52–61; arcs not y-flipped 66–82. Hardcoded north arrow + scale bar per viewport 133–140. Notes filtered to `kind==='plan-note'` 260–266. Dual sheet selector (internal state 166 + `<select>` ~220 vs shell layout tabs); `initialView` mount-only, shell works around with `key={activeSheet.id}` (`CadApplicationShell.tsx:249`).

### 1.4 Export owners

- `modelToPaperPoint` `cadExportScene.ts:107–142`: `paper = C + Rot(θ)·(k·(x−mcx), −k·(y−mcy))`, k=1000/den; center removed in model units first (precision-safe, 13B anchoring note).
- `primitiveToPaper` 162–283 (arc→48-step polyline; text `heightMm = fontSize·0.35`; ellipse `rotationDeg = thetaDeg + viewportRotationDeg`).
- `buildPaperLabelItems` 303–362 (per-viewport override wins; `visible:false` emits nothing; elbow clamp; sorted by id).
- `buildNorthArrowItems` 364–380 / `buildScaleBarItems` 382–394 — **zero production callers** (only dev/tests pass `paperExtras`).
- `buildTitleBlockItems` 402–470: template path renders verbatim and **returns early** (407–449) ⇒ `sheetObjects` text only in legacy bar path (450–470); unknown tokens collected.
- `buildExportSheetSceneWithResult` 584–770: one display scene, sorted primitives 642–645; per-viewport clip 655–666; override hidden/shown sets 667–678; `paper-frame` rect 685; labels 709–719; table fragments 714; title block 725–737; `paperTexts` 742–751; `paperExtras` 752.
- Layer law 613–624 + 650–653: `visible===false || frozen===true` hides (project **or** draft layer); `printable===false` **unconditional**; viewport `visible:true` re-shows OFF/frozen.
- SVG `cadSvgSerializer.ts:73–99` (deterministic, clipPath, `<g id="layer-…">`); PDF `cadPdfExport.ts` (PT_PER_MM 12, flipY, 25-gon ellipses, arc sign flip, WinAnsi glyph warnings via `cadDraftGlyphs.ts`); DXF layout `dxf/dxfLayoutExport.ts` (dual-contract comment 29–38; paper bottom-left flipY 500–503; mandatory full-paper VIEWPORT id 1 per sheet 505–522; per-viewport VIEWPORT group 45 = `paperHeightMm·den/1000`, 51 = `normDeg(rot)`, 69 = index+2; title block as `TB_<layout>` BLOCK+INSERT 555–586; layer 62-negative OFF, 70 bit1 frozen/bit4 locked 616–636).
- Export Center `exportCenter.ts`: no paper-vs-model scope toggle except PDF `current|all`; **no `paperExtras` passed by any production path**.

### 1.5 Persistence — `cadDrawingFile.ts` / `cadTypes.ts`

`CadDrawingDocument.draft?: DraftDocument` (`cadTypes.ts:794`). New drawing seeds blank draft 128–160; clone/sanitize 178–205; v1→v2 210–240. Draft layers are a **frozen snapshot copy** of project layers at creation, backfilled only for `general` (`cadLayers.ts:123–132`) — no ongoing sync; exports consult **both** tables. Persisted: sheets (+viewports incl. rotation/clip/layerOverrides, sheetObjects, titleBlockId), titleBlockDefinitions, labels, tables+fragments, annotationStyles, precision, metadata, draft.layers. NOT persisted: title-block instances/per-sheet field values, active sheet, sheet templates, viewport lock/plot flags, page setup. Schema still `draft.version: 1`; additive path precedent = `sanitizeDraftDocument` defaults.

### 1.6 Tabs / active layout

`CadDrawingTabs.tsx`: document strip 22–67 + `CadModelLayoutTabs` 76–108 (Model + one tab per real sheet). `useCadShellLayout.ts:86–100`: `activeLayout: 'MODEL' | {sheetId}` is **per-session view state, never persisted**. Shell derives `activeSheetId` (75–76), falls back to MODEL (111–117), swaps `SurveyCadWorkspace` vs `SheetWorkspace` (231–232). Status bar shows `MODEL`/`LAYOUT n` (288–294). **No command gating on `activeLayout`**: ribbon/menu/dock/context menu stay live on sheet tabs; context menu keys off model `snapshot.selectionCount` (257–276).

### 1.7 History

Model history owns `{project, selection}` (`cadUndoRedo.ts:17–24`); Ctrl+Z/Y → model history only (`cadCommandRegistry.ts:233–234, 461–462`). Draft-only history (`cadSheets.ts:335–353`) unused; six `draftOnlyCommand` keys (`SHEET_ADD` etc., `cadTransactions.ts:574–582`) have no UI/CLI call site. Only production draft mutation: title-block editor → `onDraftChange` → `replaceCadProject()` (`useSurveyCadWorkspace.ts:599–614`) which **clears undo/redo stacks** — template edits are not undoable and destroy model history. PROJECTTRANSFORM is the sole atomic project+draft command (maps `viewport.modelCenterX/Y`, `cadProjectTransform.ts:351–370`).

### 1.8 Annotation scale (18O) × viewport scale

Single drawing-wide denominator (`DEFAULT…=500`, `annotation/cadAnnotationSettings.ts:11`, clamped 1..100000). Paper→model = `paper/1000·den·unitFactor` (ft 0.3048). Consumers: renderer, bounds, DXF annotation export, survey-table derive. **No coupling with viewport scale exists**: effective paper height of a 1:A annotation in a 1:N viewport = `paperHeightMm·A/N`. No per-viewport annotation scale, no annotative flag, no divergence warning. 19B policy (§39): document honest single-scale behavior; defer multi-scale contexts.

### 1.9 19A tables through viewports

Model-space entities → ordinary display primitives (`cadRenderer.ts:1296–1307` via `buildCadSurveyTablePrimitives`); text heights baked in model meters from the annotation denominator, so paper size scales by `annotationDen/viewportDen`. They project/clip/rotate with everything else. Paper tables (`DraftLogicalTable` + `buildTableFragmentItems`) are a disjoint path; bridge (`addLogicalTableToDraft`) has no UI callers.

## 2. Topic audit answers

- **Engine-only vs UI**: see §1.2 list. Production: preview, title-block template editor, exports, WNCAD, layout tabs, PROJECTTRANSFORM mapping.
- **SheetWorkspace limits**: §1.3. Must become zoom/pan/select/grips/Properties workspace; drop fixed 640×420.
- **Title-block model**: Definition persisted; Instance engine-only unpersisted; per-sheet DRAWN_BY/CLIENT/LOCATION always `''` in production (only `projectName`+`crs` passed).
- **Hardcoded North/Scale**: preview-only (§3 below); exports ship neither.
- **Viewport transform**: `paper = C + Rot(θ)·(k·(x−mcx), −k·(y−mcy))`, k=1000/den, θ clockwise-as-seen. DXF writes group 51 = +θ while paper text rotation is negated (intentional y-up CCW asymmetry — record).
- **Paper coordinates**: scene top-left y-down mm; PDF flips y-up; DXF paper bottom-left; DXF model keeps absolute survey coords (6-dp).
- **Export parity**: one scene builder feeds SVG/PDF; layout DXF reuses label/title/table builders with own emitter; R12 model-only by design.
- **Histories**: separate; Draft history dead; model history cleared by title-block edits. 19B: context-route Undo/Redo by active space, no cross-history transactions.
- **Selection**: single model-id selection; sheet has none; model selection survives tab switch. 19B: paper selection on viewports/objects, no model-through-viewport by default.
- **Multi-viewport**: independently transformed; same full scene each; boolean visibility overrides only; `SCALE` token joins all denominators (ambiguous multi-scale — needs VARIES/list policy); DXF injects extra full-paper VIEWPORT (counts differ from draft).
- **PROJECTTRANSFORM**: maps viewport modelCenter + label model pos; paper geometry untouched. 19B: keep; do not similarity-transform paper mm.

## 3. North arrow / scale bar detail

| | Preview | Engine builders | Production export |
|---|---|---|---|
| Arrow | per-viewport always: inset (8,12)mm, triangle `0,0 3,12 −3,12`, `N` 4mm | `buildNorthArrowItems`: tip `(x,y−size)`, half-width 0.3·size, `N (grid)` 2.5mm | **absent** |
| Bar | per-viewport: `modelToPaperMm(10,den)` rect, 1.5mm high, `10 m @ 1:den` 3mm | `buildScaleBarItems`: N alternating 2mm rects; `modelPerDivisionM` default 10 | **absent** |
| Rotation | `northArrowAngleDeg(θ)` | same, clockwise convention | n/a |
| Units | `10 m` hardcoded, meters assumed — wrong for `ft` drawings | `modelPerDivisionM`, no unit awareness | n/a |

Grid-north only (`NORTH_REFERENCE='grid'`; `docs/survey-drafting.md:47–55`). Three independent definitions (preview, item builders, `buildScaleBar`) with different geometry — 19B consolidates to one canonical builder + persisted viewport-linked objects.

## 4. Preview vs export divergence matrix

| Behavior | Preview | SVG/PDF | DXF R2000 |
|---|---|---|---|
| OFF/frozen | hidden | hidden | hidden |
| `printable:false` | **shown** | omitted | omitted |
| `layerOverrides` | **ignored** | applied | applied (model) |
| North/scale | drawn hardcoded | **absent** | **absent** |
| Note + template assigned | drawn | **dropped, no warning** | **dropped** |
| Note, no template | drawn | drawn | drawn |
| Title block | shared builder | shared builder | shared builder |
| Non-text sheetObjects | not rendered | not rendered | `UNSUPPORTED_SHEET_OBJECT` warning |

## 5. Scope decision

Extend `DraftDocument` (additive, `sanitizeDraftDocument` defaults, version stays 1 unless breaking): sheet CRUD/reorder UI, sheet templates (drawing-owned, snapshot copy), viewport lock + plotFrame, explicit north-arrow / scale-bar / plan-note paper objects, per-sheet title-block instance values, Page Setup, Model/Layout gating, active-space undo routing, canonical `deriveSheetScene` shared by screen+SVG+PDF+DXF. Create nothing parallel (`CadLayoutEntity` et al. rejected). Docs to correct: `docs/survey-drafting.md` grid-north/scale-bar-as-shipped claims; `CURRENT_BEHAVIOR.md:489` same.

## 6. Risks (ranked)

1. Deliverables lack north arrow/scale bar shown on screen — largest parity gap.
2. No sheet/viewport authoring UI; sheets arrive only via `.wncad`/dev harness; `SHEET_*`/`VIEWPORT_*` unreachable.
3. Title-block edits destroy model undo history, not undoable themselves.
4. Preview ≠ export (`printable`, overrides, notes) — sheet view not a trustworthy plot preview.
5. Single annotation scale × many viewport scales — physical size drift; `SCALE` token ambiguous.
6. Per-sheet title-block fields unreachable/unpersisted (always empty).
7. `TitleBlockInstance` unpersisted parallel concept — persist values on sheet or persist instances, one path.
8. Dual layer tables (`project.layers` + frozen `draft.layers`) both feed export — silent drift.
9. Model commands dispatchable on sheet tabs — explicit gating decision required.
10. No page setup / plot flags at all.
11. DXF extra full-paper VIEWPORT — QA must not count viewports from file.
