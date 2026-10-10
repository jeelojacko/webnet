# STRUCT-241.2 Architecture — CAD Block command payload family extraction

Baseline: origin/main EXACT `739b0de3a83efe48d9ead26366e3b1ffac88f954` (PR #243 merge, STRUCT-241.1).
Branch: `refactor/issue2412-block-command-type-leaf`. Refs #241 ONLY (never Closes/Fixes).
#195 and #240 stay CLOSED. No SCC reduction claimed.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadTransactionsBlockCommandTypes.ts` (~3.2 KB) owns the nine
block payload variants as TWO disjoint unions mirroring their two disjoint hub
positions:

- `CadBlockPreludeCommandPayload` (early, 2): `BLOCK_SEED` (key only),
  `BLOCK_EDIT` (`referenceId: CadEntityId` + optional
  `x/y/rotationDeg/scaleX/scaleY/mirrored`).
- `CadBlockDefinitionCommandPayload` (later, 7, in original order):
  `BLOCK_CREATE` (`name`, `sourceEntityIds: CadEntityId[]`, optional
  `basePoint{x,y}`, `description?`), `BLOCK_INSERT` (`definitionId`, `x`, `y`,
  optional `rotationDeg/scaleX/scaleY/mirrored/layerId?`), `BLOCK_EXPLODE`
  (`referenceId`), `BLOCK_REDEFINE` (`definitionId` + `sourceEntityIds`),
  `BLOCK_RENAME` / `BLOCK_DUPLICATE` (`definitionId` + `name`),
  `BLOCK_DELETE` (`definitionId` + optional `force?/deleteRefs?`).
- Optional `CadBlockCommandPayload = Prelude | Definition` for family identity/tests.
  The hub splices the TWO separate unions, never the aggregate at one location.

Single import: `import type { CadEntityId, CadLayerId } from
'./cadCorePrimitiveTypes'` (zero-import primitive leaf). No values, no hub /
executor / barrel / `cadTypes` imports. Emitted JS is header comment +
`export {};`. No runtime algorithm changed.

## Hub splice (parent-owned, mechanical)

`src/engine/cad/cadTransactions.types.ts` 1169 -> 1121 lines
(31646 -> 30880 bytes):

1. Import block: one `STRUCT-241.2` type-only import of both leaf unions next
   to the 241.1 layer/survey leaves.
2. Early: the two inline members after `TITLE_BLOCK_EDIT` (old lines 776-788)
   replaced by `| CadBlockPreludeCommandPayload` before
   `| CadLayerCommandPayload`.
3. Later: the seven inline members after `CadSectionViewDeleteCommand` (old
   lines 820-862) replaced by `| CadBlockDefinitionCommandPayload` before
   `| { key: 'CREATE_MTEXT'; ... }`.

Everything else byte-identical: all other `CadCommand` members in original
position, `LANDXML_IMPORT` stays inline, survey/layer leaves untouched,
`CadCommandKey` text untouched (248 literals / 241 unique incl. 7 legacy
duplicate BLOCK keys, preserved not corrected). `CadEntityId`/`CadLayerId`
imports kept (63 remaining uses).

Critical order preserved:
`... TITLE_BLOCK_EDIT -> PRELUDE(2) -> CadLayerCommandPayload ->
F2F_GENERATE -> CadSurveyCommandPayload -> Surface/Volume/Profile/Section ->
LANDXML_IMPORT -> CadSectionViewDeleteCommand -> LATER BLOCK(7) ->
CREATE_MTEXT ...`. The two groups were never combined.

Counts: top-level `CadCommand` 140 -> 133 (101 inline / 7 parenthesized
intersections / 25 leaf refs); effective flattened payload members stay 168
in exact original order.

## Graph impact (measured, `scripts/cadTypeImportGraph.mjs`)

- CAD+F2F scope: 485/2404 -> 486/2406 (+1 node, +2 type edges:
  `hub -> blockLeaf[type]`, `blockLeaf -> cadCorePrimitiveTypes[type]`).
  VALUE/MIXED edges 1585, unique pairs 1567, pair SHA256
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  byte-identical; full edge multiset identical outside the 2 allowlisted
  additions. VALUE SCC 0/0, TYPE SCC 0/0.
- Full `src`: 1657/7514 -> 1658/7516 (same +1/+2). VALUE edges 4444, unique
  pairs 4385, SHA `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  identical. VALUE SCC 0; TYPE 7 SCC / 38 nodes unchanged (all unrelated
  domains). TYPE delta allowlist is exactly the 2 edges above; new leaf is a
  singleton with no backedge.
- Frozen fixtures untouched: 19511 48 KB graph, parcel 41-edge slice, 19513
  arc snapshots byte-identical (existing suites pin them).

## Guard roll-forward (parent-owned, no weakening)

- `cad_survey_layer_command_type_leaves_2411.test.ts`: helper now expands both
  block leaves; counts rolled 140->133 / 110->101 / 23->25 with STRUCT-241.2
  annotation; flattened stays 168; severed-survey control still 152.
- `cad_profile_section_command_types_1955.test.ts`: order guard now expects
  `CadBlockDefinitionCommandPayload` ref where `BLOCK_CREATE` sat inline.
- `cad_project_transform_runtime_cycle_19511` / `cad_cogo_parcel_runtime_cycle_19512` /
  `cad_geometry_primitives_runtime_cycle_19514`: added `STRUCT_2412_ADDED_NODES=1` /
  `STRUCT_2412_ADDED_EDGES=2` alongside the 241.1 constants; SHA/membership
  pins and slice allowlists untouched.

## Risks / next

- Risk: low. Type-only move; assignability proved both directions via
  `Extract<>` for all 9 keys; 6 in-memory negative controls prove the pins
  actually fail on optionality/order/merge mutations.
- Next (optional, #241 still open): CAD entity/style family decomposition
  (`cadTypes` cohesion follow-up). Not started here.
