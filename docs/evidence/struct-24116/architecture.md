# STRUCT-241.16 Architecture — sheet/viewport + polyline topology leaves

Baseline: origin/main 82cce548b3af56c0802d7b0be98bb8a0b5cf28c0 (PR #258 merge).
Branch: refactor/issue24116-sheet-viewport-polyline-topology-command-types.

## Extraction (6 + 2 = 8 inline members, verbatim)

Hub `src/engine/cad/cadTransactions.types.ts` +8/-47:
- 2 `import type` lines from direct owning leaves (no barrels) under STRUCT-241.16 comment.
- 6 contiguous SHEET_ADD..TITLE_BLOCK_EDIT inline objects (hub ~L437-470)
  replaced with ONE `| CadSheetViewportCommandPayload` AFTER geometry-edit
  alias, BEFORE block-prelude alias.
- 2 contiguous POLYLINE_INSERT_VERTEX..POLYLINE_DELETE_VERTEX inline objects
  + Phase C3 command-union header (hub ~L512-524) replaced with ONE
  `| CadPolylineTopologyCommandPayload` AFTER design-surface alias, BEFORE
  Curve F1 aliases.

New leaf A `src/engine/cad/cadTransactionsSheetViewportCommandTypes.ts`
(CadSheetViewportCommandPayload, 6 members, exact order, NO imports):
SHEET_ADD {sheetId, sheetName}, SHEET_DELETE {sheetId},
VIEWPORT_MOVE {sheetId, viewportId, x, y},
VIEWPORT_SCALE {sheetId, viewportId, scaleDenominator},
VIEWPORT_ROTATE {sheetId, viewportId, rotationDeg},
TITLE_BLOCK_EDIT {sheetId, definitionId, values: Record<string,string>}.

New leaf B `src/engine/cad/cadTransactionsPolylineTopologyCommandTypes.ts`
(CadPolylineTopologyCommandPayload, 2 members, exact order):
moved header `// Phase C3 — polyline vertex topology (count-changing, one undo entry).`
directly before POLYLINE_INSERT_VERTEX {entityId: CadEntityId, courseIndex, x, y},
POLYLINE_DELETE_VERTEX {entityId: CadEntityId, vertexIndex}.
Sole import: `import type { CadEntityId } from './cadCorePrimitiveTypes'`.
F1 header `// CAD Curves F1 — six atomic curve commands + atomic subdivision.`
stays in hub (occurs twice: key-union + command-union, both pinned).
No Curve F1 alias moved. CadEntityId hub import kept (8 uses remain).

## Pins
- CadCommandKey: 248 literals / 241 unique / 7 repeated BLOCK keys;
  raw-slice SHA 4ff8cd4a… + ordered-list SHA b2121894… unchanged.
- CadCommand: 168 flattened variants exact order; top-level AST 55 / 11 inline
  / 37 refs / 7 inter (61/19/35/7 before; 8 inline -> 2 refs).
- Hub stripped emit `export {};` SHA 2e29cd9a… byte-identical; both leaves inert.
- No leaf->hub back-edge; no new SCC; VALUE/MIXED edge sets unchanged.

## Graph (measured live scripts/cadTypeImportGraph.mjs)
- Scoped CAD+F2F: 511/2483 -> 513/2486 (+2 nodes, +3 edges: 2 hub type + 1 polyline->core-primitive; 0 retired).
- Full src: 1683/7594 -> 1685/7597 (same +2/+3).
- VALUE/MIXED unchanged: scoped 1585/1567 SHA 0bc9bae1…, full 4444/4385 SHA 415f97f0….
- SCC: scoped 0/0; full VALUE 0, TYPE 7/38 — all unchanged.

## Workers / review
- Worker A (sheet leaf) + Worker B (polyline leaf) parallel, disjoint; Worker C
  (hub splice + suite + roll-forward) after both. Independent read-only
  reviewer reviewer-24116: APPROVE (same session, no edits).
- 14 user stashes preserved count/order; ignored private fixtures, .pi/lsp.json,
  settings untouched.
