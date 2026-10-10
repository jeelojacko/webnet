# STRUCT-241.3 Architecture — CAD foundation + survey presentation extraction

Baseline: origin/main EXACT `fa71437e82b87907016f20968c48308964c6c698` (PR #244 merge, STRUCT-241.2).
Branch: `refactor/issue2413-cad-foundation-survey-presentation-types`. Related to #241
(single non-closing reference; multiple #241 phases remain). #195 and #240 stay CLOSED.
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadEntityFoundationTypes.ts` (101 lines) owns EIGHT
foundation / appearance / style contracts in original order:
`CadEntityAppearance`, `CadBaseEntity`, `CadLineType`, `CadTextHeightMode`,
`CadTextStyle`, `CadPointSymbol`, `CadStyle`, `CadStyleLibrary` (the last sat
after the survey block in the hub but belongs to this family).
Single import: `import type { CadEntityId, CadLayerId, CadLineTypeId,
CadPointSymbolId, CadPointSymbolShape, CadStyleId, CadTextStyleId } from
'./cadCorePrimitiveTypes'`.

NEW `src/engine/cad/cadSurveyPresentationTypes.ts` (138 lines) owns NINE
survey presentation / point-group contracts in original order:
`CadPointStyleId`, `CadPointLabelStyleId`, `CadPointGroupId`,
`CadPointGroupQuery`, `CadPointGroup`, `CadPointLabelComponent`,
`CadPointLabelStyle`, `CadPointLabelBinding`, `CadPointStyle`.
Single import: `import type { CadEntityId, CadPointSymbolId, CadTextStyleId }
from './cadCorePrimitiveTypes'` (names verified present in the core leaf).

All 17 declarations are byte-identical bodies/comments/property order/
optionality to hub lines 55-243 (verified 17/17 by exact-string match). No
values, no hub/sibling-leaf/barrel/runtime/`cadTransactions` imports. Emitted
JS for each leaf is `export {};`. The region ends immediately before
`CadSurveyPointEntity`; every later declaration stays in the hub.

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1923 -> 1780 lines (64771 bytes -> smaller;
189-line region removed, 46-line STRUCT-241.3 import/re-export block added):

1. The 17 moved definitions/comments deleted; nothing else touched
   (`CadSurveyPointEntity` is now the first declaration, still
   `extends CadBaseEntity`).
2. Two grouped `import type` + two grouped `export type` statements re-export
   all 17 names so existing `from './cadTypes'` consumers compile unchanged.
3. Original `cadCorePrimitiveTypes` import/export block, analysis/display
   re-exports, unrelated `StationId`/`StationErrorEllipse`/`ParseOptions`/
   COGO imports, and all runtime functions untouched. No consumer rewritten
   to the new leaf paths (additive alternative, not API replacement).

## Graph impact (measured, `scripts/cadTypeImportGraph.mjs`)

- CAD+F2F scope: 486/2406 -> 488/2412 (+2 nodes, +6 type edges: hub
  import-type + hub export-type per leaf, plus one leaf-to-core edge per
  leaf; each statement is one graph edge). VALUE/MIXED edges 1585, unique
  pairs 1567, pair SHA256
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  byte-identical. VALUE SCC 0/0, TYPE SCC 0/0.
- Full `src`: 1658/7516 -> 1660/7522 (same +2/+6). VALUE edges 4444, unique
  pairs 4385, SHA `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  identical. VALUE SCC 0; TYPE 7 SCC / 38 nodes unchanged. Both leaves are
  singletons with no back-edge (hub, sibling leaf, runtime targets pinned
  absent).
- Frozen fixtures untouched: 19511 48 KB graph, parcel 41-edge slice, 19513
  arc snapshots byte-identical (existing suites pin them).

## Guard roll-forward (parent-owned, no weakening)

- `cad_block_command_type_leaf_2412.test.ts`: CAD+F2F 486/2406 -> 488/2412,
  full-src 1658/7516 -> 1660/7522, comments annotated; shape/union/negative
  controls untouched.
- `cad_cogo_parcel_runtime_cycle_19512` / `cad_project_transform_runtime_cycle_19511` /
  `cad_geometry_primitives_runtime_cycle_19514`: added `STRUCT_2413_ADDED_NODES=2` /
  `STRUCT_2413_ADDED_EDGES=6` alongside the 241.1/241.2 constants; SHA/membership
  pins and slice allowlists untouched.

## Risks / next

- Risk: low. Type-only move; facade-vs-leaf equality proved both directions
  via `expectTypeOf` for all 17; 7 in-memory negative controls prove the pins
  fail on optionality/discriminant/field/cycle/re-export mutations.
- Next (optional, #241 still open): entity family (`CadSurveyPointEntity`,
  `CadLineEntity`, `CadEntity` union, project/surface/volume/profile splits)
  evaluated separately. Not started here.
