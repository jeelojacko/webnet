# Phase 18C — Current Appearance Map (baseline `8a0107d6`, PR #92 merge)

Derived from parallel scout recon 2026-09-17 (model / UI+renderer / export). Read-only; no behavior changed.

## 1. Data model (`src/engine/cad/cadTypes.ts`)

- `CadBaseEntity` (:32-40): `id, type, layerId, styleId?, visible, locked, metadata?`.
  **No per-entity color / width / linetype / transparency fields.**
- `CadLayer` (:42-60): `id, name, color, lineTypeId?, defaultStyleId?, visible, locked,
  printable?, lineweightMm?, role`. **No frozen, no transparency, no description,
  no on/off-vs-visible distinction, no current-layer field anywhere.**
- `CadStyle` (:85-93): `id, name, color?, strokeWidth?, textStyleId?, pointSymbolId?,
  lineTypeId?`. No lineweight, no transparency.
- `CadStyleLibrary` (:95-100): `lineTypes[], textStyles[], pointSymbols[], styles[]`.
  Drawing-owned per `CadProject.styleLibrary`, except `cadModel.ts:189-190` hands out
  the `DEFAULT_*` singletons **by reference** (mutation would leak across projects).
- Defaults (`cadLayers.ts`, `cadStyles.ts`): 6 layers (all visible, unlocked,
  printable, 0.25mm), 2 linetypes (`continuous []`, `dash-short [6,4]`, units
  undocumented), 6 styles. Dangling ids: `planning` (alignments), `preview` (COGO
  preview) have no layer definition → silent `#94a3b8` fallback.
- WNCAD: `CadDrawingDocument.schemaVersion 1|2` (current 2). **No layer/style field
  migration exists** (only blank-draft backfill + legacy SurveyCad state migration).

## 2. Resolution today (who wins)

Screen (`cadRendererStyle.ts` + `cadRenderer.ts`): `style.color ?? layer.color ?? #94a3b8`.
Export twin (`resolveEffectiveColor.ts`): `override → style → layer → #94a3b8`,
but `override` is **never passed** by any caller. DXF linetype:
`style.lineTypeId ?? layer.lineTypeId ?? 'continuous'`.

| Property | Viewport | DXF | SVG/PDF | LandXML | Properties |
|---|---|---|---|---|---|
| Color | style → layer | style → layer (ACI/420, BYLAYER by omission) | style → layer (hex) | n/a (semantic) | not shown |
| Linetype | **dead** (no primitive sets dash) | style → layer → Continuous | dash from scene | n/a | not shown |
| Width | style.strokeWidth + hardcoded fallback/1.25/1.5/1.1 | **never** (R12 warns; R2000 reads layer only) | ExportBase.widthMm | n/a | not shown |
| lineweightMm | **ignored** | layer 370 (R2000 only) | ignored | n/a | not shown |
| Transparency | **does not exist** | n/a | n/a | n/a | not shown |
| layer.visible | **ignored** | **ignored** (only entity.visible) | honored (scene pre-filter) | ignored (no layer lookup) | toggle = export-only note |
| layer.locked | **never enforced** | n/a | n/a | n/a | read-only row |
| printable | **ignored** | **ignored** | honored (unconditional drop; beats viewport re-show) | ignored | read-only row |
| Point symbol shape | **ignored on screen** | circle approx | circle approx | NOT_APPLICABLE | not shown |
| Current layer | **does not exist** | n/a | n/a | n/a | n/a |
| ByBlock | **no block model** (only paper title-block templates) | n/a | n/a | n/a | n/a |

## 3. Per-family creation defaults (all hardcoded literals, no active layer)

LINE/PLINE/arcs/traverse/batch-COGO → `observation-lines` + `style-observation-line`;
POINT → `points`/`style-point`; labels → `labels`/`style-label`; parcels → `parcels`;
alignments → **`planning`** (undefined layer); ellipses → `error-ellipses`.
No producer creates `polygon` entities (consumers only). F2F: role forced `'points'`,
palette-hashed colors, fixed strokeWidth 1.2, no linetype; catalog has no
color/linetype/lineweight/role fields.

## 4. UI / transactions

- Layer palette (`LayerPanel.tsx`): name + count + Hide/Show + Lock/Unlock +
  Printing + Rename + Delete. No color/linetype/lineweight/current/sort/search.
  Both mutation paths call `replaceActiveDrawing` → **clears undo/redo + resets
  selection**. Unwired alternative exists: `LAYER_CREATE/RENAME/VISIBILITY/LOCKED/
  PRINTABLE/MOVE_OBJECTS/DELETE` in `cadTransactions.ts:384-486` (only tests call them).
- Properties (`cadProperties.ts:86-140`): Type + Layer/Locked/Visible **read-only**;
  editable fields are geometry-only. Multi-select loops one transaction per entity.
- Commands: 56 session + 10 chrome; **no LAYER command**. Status bar: OSNAP only,
  **no LWT** (0 hits repo-wide). Toolspace Settings: snap modes + units only.
- Persistence: shell layout `webnet.cad.shell.v1` (panels only); drawing file keeps
  layers incl. visible/locked/printable/lineweightMm/lineTypeId.

## 5. Known traps (do not reintroduce)

1. **Option-A prefilter was reverted**: filtering `buildCadDisplayScene` by layer
   visibility broke the documented export semantic (viewport `visible=true` re-show
   of project-hidden layers, `tests/cad_draft_deliverables`). Viewport hide must be
   a **view-layer filter** at scene consumers, not in `buildCadDisplayScene`.
2. `layer.visible` is honored **only** in `cadExportScene.ts:456-510` (plus per-viewport
   `plan.layerOverrides`, which has no production caller). Any global layer model must
   state precedence vs `layerOverrides`.
3. Unknown layer ids (`preview`, `planning`, F2F-generated) must default to **visible**
   under any layer-scoped filter, or preview/F2F geometry silently disappears.
4. `entity.locked` blocks trim/fillet/extend targets but **not move/erase**;
   `layer.locked` blocks nothing. Lock work must centralize one editability gate
   covering move/erase/properties edits.
5. Synthesized labels carry `layerId:'labels'` but render in the **source entity's
   style color** — layer-color changes must not unexpectedly recolor foreign labels.
6. New linetypes must be added to **both** the model library and `DXF_LINETYPE_CATALOG`
   (`dxf/dxfColorMap.ts:132-136`); same coupling for point-symbol shapes.
7. Draft sanitizer (`cadDraftTypes.ts:459-490`) mirrors layer validation — any new
   `CadLayer` field needs coverage there too.
