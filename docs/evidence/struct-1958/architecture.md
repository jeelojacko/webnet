# STRUCT-195.8 — Architecture (Workstream C evidence)

## Scope

Break the 5-node TYPE import cycle
`cadExportScene ↔ {cadAnalysisExportScene, cadGradingExportScene, cadGradingGroupExportScene, cadSheetScene}`
by extracting `ExportBase` + `ExportItem` into the import-free leaf
`src/engine/cad/cadExportItemTypes.ts` and repointing the four consumers
(plus the hub's own use) at the leaf. The hub keeps the legacy surface via
`export type { ExportBase, ExportItem } from './cadExportItemTypes'`.

Ownership (parent/worker-reported, not re-verified beyond disk state):

- Leaf file `cadExportItemTypes.ts` — Worker (leaf author).
- Four consumer repoints + hub splice — Workers / parent integration.
- This directory + `tests/cad_export_scene_type_cycle_1958.test.ts` —
  Workstream C (this worker), covering the INTEGRATED end state read from disk.

## Baseline

- Baseline ref: origin/main `5fcffc46511e82c1c4e8663f0d3d492fbed28a73`
  (= branch HEAD at the time of measurement; worker changes uncommitted in
  the worktree). Baseline graph measured from `git show HEAD:<path>`
  snapshots in a scratch script (NOT in the committed test).
- Baseline `ExportBase` + 7-branch `ExportItem` lived inline in
  `src/engine/cad/cadExportScene.ts` (lines ~35–60 at HEAD).
- Baseline import shape (personally observed via `git show HEAD` + grep):
  each of the four consumers held
  `import type { ExportItem } from './cadExportScene'` (cadSheetScene:
  `import type { ExportItem, ExportWarning } from './cadExportScene'`),
  while the hub held mixed/value edges back to the consumers
  (`buildAnalysisSheetItems`, `buildGradingSheetItems`,
  `buildGroupSheetItems`, paper-symbol builders), closing the TYPE loop.

## End state (personally observed on disk)

- `src/engine/cad/cadExportItemTypes.ts` (new, 33 lines): `ExportBase`
  interface + `ExportItem` 7-branch union, byte-identical shape to baseline
  (verified member-by-member against `git show HEAD:...cadExportScene.ts`).
  Zero `import` statements; no runtime value exports.
- `src/engine/cad/cadExportScene.ts`: inline `ExportBase`/`ExportItem`
  declarations removed; now holds
  `import type { ExportItem } from './cadExportItemTypes'` (for its own
  signatures) and
  `export type { ExportBase, ExportItem } from './cadExportItemTypes'`
  (legacy path preserved). Unchanged: `export type { ExportResult,
  ExportWarning, ExportWarningCode };` from `./exportResult`.
- Four consumers: `import type { ExportItem } from './cadExportItemTypes'`
  (cadSheetScene splits the old combined import: leaf for `ExportItem`,
  `./exportResult` for `ExportWarning`). No other consumer edits observed.
- No value-edge changes: the entire refactor is type-only bindings.

## Graph before → after (personally measured, scope `src/engine/cad` + `src/engine/fieldToFinish`)

| fact | baseline (HEAD snapshot) | integrated worktree |
|---|---|---|
| nodes | 475 | 476 (+1 leaf) |
| total edges | 2380 | 2383 (+3: 4 consumer repoints net 0, hub import +1, hub re-export +1, sheet split-import +1) |
| value / type / mixed edges | 1330 / 801 / 249 | 1330 / 804 / 249 (value+mixed identical) |
| unresolved specifiers | 94 | 94 |
| unique VALUE pairs | 1561 | 1561 |
| value\|mixed edges (with multiplicity) | 1579 | 1579 |
| VALUE pair-set delta (added / removed) | — | [] / [] |
| VALUE pairs SHA256 | `2bf1817d…6323f` | `2bf1817d…6323f` (identical) |
| TYPE SCC containing the five | ONE 5-node component: cadAnalysisExportScene, cadExportScene, cadGradingExportScene, cadGradingGroupExportScene, cadSheetScene | gone — each of the five is a TYPE singleton |
| remaining TYPE SCCs | 5 × 2-node (see below) | same 5 × 2-node, unchanged |
| VALUE SCCs | 4 (see below) | same 4, unchanged |

Full SHA256: `2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f`
(same pin as STRUCT-195.7; canonicalization identical, verified empirically
on both the HEAD snapshot and the worktree — see validation.md).

Remaining five 2-node TYPE SCCs (pre-existing, untouched, identical before/after):

- `cadProjectTransform.ts | cadProjectTransformRequest.ts`
- `cadSurfaceEditMesh.ts | cadSurfaceEdits.ts`
- `cadSurfaceRevision.ts | cadSurfaces.ts`
- `dxf/dxfBlockExport.ts | dxf/dxfExportModel.ts`
- `profiles/profileExtraction.ts | profiles/profileSampling.ts`

Four pre-existing VALUE SCCs (untouched, identical before/after):

- 5-node: cadCogoEntityIntersections, cadCogoMath, cadParcelArcGeometry, cadPolylineCourses, cadPolylineGeometry
- 4-node: cadCogoParcelDiagnostics, cadCogoParcelGeometry, cadCogoParcelGeometrySourceDraft, cadCogoParcelLineworkDiagnostics
- 7-node: cadGeometry, cadGeometryArcBuilders, cadGeometryArcPrimitives, cadGeometryCurveCore, cadGeometryCurveIntersections, cadGeometryCurves, cadGeometryTangentCurve
- 2-node: cadProjectTransform, cadProjectTransformRequest

## Type names + old-path parity (personally observed)

- Moved surface: `ExportBase`, `ExportItem` (leaf declares exactly these two).
- Old-path parity: both names importable from `cadExportScene.ts` (hub
  re-export) with `expectTypeOf` bidirectional equality vs the leaf and vs
  the hand-transcribed baseline pins (enforced by project typecheck; runtime
  AST pins enforce it under plain vitest).
- Legacy warning path: `ExportWarning` still re-exported from the hub and
  `expectTypeOf`-equal to `exportResult.ExportWarning` both directions.
- Union contract pinned exactly: branch order line, polyline, rect, circle,
  ellipse, arc, text; per-branch keys, `?` markers, kind literals, number
  fields, and the nested `Array<{x;y}>` point shape.
