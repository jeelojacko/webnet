# Phase 18R.1 integrity audit (pre-fix, baseline 041f7b1d = PR #108 merge)

Branch: `fix/cad-project-transform-integrity`. Date: 2026-09-20.
Source: read-only scout recon of production path; no code changed for this doc.

## Production command path

`cadCommandRegistry.ts:91` → `SurveyCadWorkspace.tsx:1256`
→ `useSurveyCadCommandStarters.ts:328-330` → `useSurveyCadProjectTransformPanel.ts:89-183`
→ `useSurveyCadTransformSubmit.ts:636-670` (dry-run `:648` via
`applyCadProjectTransform(history.present.project, request)`; commit `:653`
via `commitTransform` → `runCadCommand`)
→ `cadTransactionsProjectTransformCommands.ts:19-46` (registered `cadTransactions.ts:546`)
→ `cadProjectTransformRequest.ts:100-172` → `cadProjectTransform.ts:401-577`.

## Finding A — CONFIRMED

Production transaction calls `applyCadProjectTransform(snapshot.project, request)`
(`cadTransactionsProjectTransformCommands.ts:23`); that function takes
`(project, request)` only — no draft parameter (`cadProjectTransformRequest.ts:100-103`).
Both kernel calls (`:107`, `:145`) pass mode/frame/control metadata only, never
`draft`. `commitProjectTransform` builds `nextSnapshot` as `{ project, selection }`
only (`:33-40`); `CadWorkspaceSnapshot = { project, selection }`
(`cadTransactions.types.ts:1260-1263`) — no DraftDocument channel.
`transformDraftDocument` (`cadProjectTransform.ts:310-323`, module-private) is gated
on `options.draft` (`:565`, `draft?` on result) and unreachable in production.
Consequence: after production PROJECTTRANSFORM, viewport `modelCenterX/Y` and label
`xModel/yModel` stay in the old frame while project geometry moves.

Repro sketch (production seam): drawing with point E=2000000 N=7000000,
viewport.modelCenter at same coordinate, label xModel/yModel nearby; run
PROJECTTRANSFORM through `runCadCommand`; project point moves, draft anchors unchanged.

## Finding B — CONFIRMED (two parts)

B1: `buildCadBounds(entities, blockDefinitions?)` (`cadProjectState.ts:34-119`)
iterates entities only (+ block expansion). No `surfaces` parameter, no TIN access.
Post-transform call `cadProjectTransform.ts:557` uses entity-derived array only.
Repro: zero model entities + one imported TIN far from origin → project.bounds
ignores TIN vertices.

B2 (ownership): `DraftDocument` is a field of `CadDrawingDocument`, sibling of
`project` (`cadTypes.ts:669-683`), mutated via direct `onDraftChange` replacement
(`SurveyCadWorkspace.tsx:1906-1908` → `replaceActiveDrawing` `:1009-1013`), outside
CAD history. Draft-only sheet history (`cadSheets.ts:335-353`) has zero `src/`
consumers. `useSurveyCadWorkspace.ts` has zero `draft` refs. CAD undo/redo
(`cadUndoRedo.ts:58-118`, one entry per command) cannot roll back/replay draft.

## Finding C — CONFIRMED

Transform path never runs the 18L validator `validateImportedTinPayload`
(`cadImportedTin.ts:30-65`: presence, `%3` + >=9, finite XYZ, faces array + `%3` + >0,
integer in-range indices, degenerate reject, CCW/positive-area reject).
`transformImportedTinVertices` (`cadProjectTransform.ts:228-241`) returns null only
on `vertices.length % 3 !== 0`; `transformSurface` (`:243-271`) then warns
("malformed imported-TIN vertex array; left unchanged") and CONTINUES — surface
stays in old frame while everything else moves. A 3-aligned but invalid payload
(NaN coords, bad faces) transforms silently with no warning. Pre-count helper
(`cadProjectTransformRequest.ts:78-85`) has the same `%3`-only leniency.

## Supporting facts

- Draft transformable set = viewport `modelCenterX/Y` + label `xModel/yModel`
  (`cadDraftTypes.ts:130-160`; matches `transformDraftDocument`, which leaves
  `rotationDeg`, `scaleDenominator`, paper-mm untouched — correct for similarity).
- No `northArrow` field in DraftDocument (north rendering comes from project
  annotation tables/blocks, moves with entities).
- Cache: transform clones surface def, sets `cachedRevision: null`
  (`:266-268`); session cache keyed `${scopeId}::${surfaceId}@${revision}`
  (`cadSurfaceCache.ts:37-40`); transformed vertices yield new
  `importedTinRevision` (`cadImportedTin.ts:67-75`).
- Save: `.wncad` serializes draft with project (`cadDrawingFile.ts:231,185-205,314-409`);
  legacy `SurveyCadPersistedState` (`cadTypes.ts:649-655`) has no draft;
  `emitDrawingChange` fallback drops draft (`SurveyCadWorkspace.tsx:289-315`);
  migration creates blank draft (`:325`).
- Undo/redo: one history entry per command (`cadUndoRedo.ts:82`); 18R contract tests
  `tests/cad_project_transform_18r.test.ts:466-475`,
  `tests/cad_project_transform_commands_18r.test.ts:82-85,115-118`.
- Test inventory: 18R kernel/command/browser
  (`tests/cad_project_transform_18r.test.ts`,
  `tests/cad_project_transform_commands_18r.test.ts`,
  `tests-browser/cad-project-transform-18r.spec.ts` + fixture
  `tests-browser/fixtures/cad-project-transform-18r.wncad`);
  draft (`tests/cad_draft_*.test.ts`, `tests/surveyCadDraftingPanel.test.tsx`);
  LandXML/imported-TIN (`tests/landxml_*.test.ts`, `tests/landxmlLargeTinFixtures.ts`).
  No test exercises `options.draft`.

## Fix direction (authorized by mission 18R.1)

1. Draft: route draft through production PROJECTTRANSFORM seam atomically
   (one logical undo entry covering project + draft); transform only
   model-space fields (viewport center, label anchors); scale denominator and
   rotation unchanged.
2. Bounds: `buildCadProjectAuthoritativeBounds(project)` reusing entity bounds +
   union of validated imported-TIN XY extents; recompute from transformed state.
3. TIN: preflight every imported TIN with `validateImportedTinPayload` before any
   mutation; `ok:false` + stable reason `CAD_PROJECT_TRANSFORM_IMPORTED_TIN_INVALID`
   on failure; missing payload and non-finite coordinates block.

## Appendix 18R.1-A — Finding A fix: architecture choice

Chosen: the PROJECTTRANSFORM transaction owns project + draft atomically via
an optional `draft` channel on `CadWorkspaceSnapshot`
(`cadTransactions.types.ts`). The command reads `snapshot.draft`, threads it
through `applyCadProjectTransform(project, request, { draft })` into the
(existing, previously dead-in-production) kernel `options.draft` path, and
commits the transformed draft in the same `nextSnapshot` — one `runCadCommand`
= one undo entry covering both. No CAD history rewrite: the field is optional,
`createCadHistoryState`/`runCadCommand`/`undoCadHistory`/`redoCadHistory` are
untouched, and `executeCadCommand` carries a snapshot draft forward by
reference across commands that do not rewrite it (so workspace propagation can
distinguish "changed" from "carried" and only syncs drawing.draft when the
reference actually swaps: commit D0→D1, undo D1→D0, redo D0→D1).

Rejected: routing through the draft-only `SHEET_*`/`VIEWPORT_*` seams would
need 2+ history entries (PROJECTTRANSFORM + VIEWPORT_MOVE + LABEL_MOVE) and
could never undo atomically. The standalone cadSheets draft history
(`runDraftSheetCommand`, `cadSheets.ts:335-353`) stays as-is — still zero
`src/` production consumers; draft-only sheet edits keep bypassing CAD history
via `onDraftChange`/`replaceActiveDrawing` as before.

Production UI path: `useSurveyCadTransformSubmit` APPLY seeds the live drawing
draft into the history snapshot inside the SAME updater as the commit (before =
pre-transform draft, after = transformed draft), and
`useSurveyCadWorkspace.applyHistoryUpdate` propagates a swapped draft reference
into the parent `CadDrawingDocument` alongside the project. Draft-only edits
made after a transform are outside CAD history: undoing the transform restores
the pre-transform draft wholesale (documented price of atomicity).

Scale denominator and viewport/label rotation are unchanged by design: under a
similarity transform the model frame moves, so paper-mm presentation
(scaleDenominator, placements, title blocks, tables) and viewport-local
rotationDeg stay put; only model-space anchors are remapped.

## Appendix 18R.1-B — DraftDocument field transformation matrix

Source: `cadDraftTypes.ts:130-160` (+ `transformDraftDocument`,
`cadProjectTransform.ts`). Rule: model-space (drawing-unit) anchors move;
paper-mm presentation, library/style data, and metadata never move.

| Field | Transformed? | Notes |
|---|---|---|
| `sheets[].viewports[].modelCenterX/Y` | YES | same CadTransform2D as project |
| `labels[].xModel/yModel` | YES | same CadTransform2D as project |
| `version`, `modelSpaceProjectId` | no | identity |
| `layers` | no | library space |
| `annotationStyles` (text/line/label styles) | no | paper-mm sizes |
| `precision` | no | display decimals |
| `sheets[].widthMm/heightMm/orientation/margins` | no | paper space |
| `viewports[].scaleDenominator` | no | drawing scale unchanged |
| `viewports[].rotationDeg` | no | viewport-only clockwise rotation; model coords untouched |
| `viewports[].paperXmm/paperYmm/paperWidthMm/paperHeightMm/clip*/layerOverrides` | no | paper placement/presentation |
| `sheets[].titleBlockId`, `sheets[].sheetObjects[]` | no | paper-mm objects |
| `titleBlockDefinitions[]` | no | paper-mm template primitives |
| `labels[].layerId/text/heightMm/provenance/overrideText/placement/sourceEntityId` | no | identity/presentation |
| `labels[].rotationDeg` | no | presentation rotation, not a model angle |
| `labels[].viewportOverrides` (dxMm/dyMm/rotationDeg/visible) | no | paper-mm offsets |
| `labels[].leader` (elbowMm/lineweightMm) | no | paper-mm styling |
| `tables[]`, `tableFragments[]` (rows, rowRange, paperXmm/paperYmm) | no | content + paper placement |
| `metadata` (createdAt/updatedAt/author/description) | no | bookkeeping |
