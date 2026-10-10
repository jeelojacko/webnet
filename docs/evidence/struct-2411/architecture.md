# STRUCT-241.1 — Architecture

Follow-up of issue #241 (optional maintainability/type-hub-cohesion; NOT a
new import-cycle bug). Branch
`refactor/issue2411-survey-layer-command-type-leaves` on exact `origin/main
08e0b6d0c8f7c14a896bb0c06221c116bc9f474e` (PR #242 merge). Refs #241 ONLY.

## What moved (type-only, zero runtime delta)

`src/engine/cad/cadTransactions.types.ts` (1354 -> 1169 lines) held 30
consecutive inline `CadCommand` union members in two disjoint slices:

- LAYER slice (hub lines ~786-862): 14 variants `LAYER_CREATE` through
  `LAYER_DELETE`, primitive-only fields -> new leaf
  `src/engine/cad/cadTransactionsLayerCommandTypes.ts` exporting
  `CadLayerCommandPayload` (99 lines, zero imports).
- SURVEY slice (hub lines ~868-978): 16 variants `SURVEY_POINT_OVERRIDE`
  x1, `SURVEY_STYLE_TABLE` x10 (`table: 'point'|'label'` x `op:
  create/duplicate/rename/update/delete`), `SURVEY_GROUP_TABLE` x5 (`op:
  create/rename/update/move/delete`) -> new leaf
  `src/engine/cad/cadTransactionsSurveyCommandTypes.ts` exporting
  `CadSurveyCommandPayload` (152 lines; `import type CadEntityId` from the
  zero-import `./cadCorePrimitiveTypes` core leaf per STRUCT-195.6
  convention, other 7 survey types via `import type` from `./cadTypes`).

Both slices copied VERBATIM (key literals, table/op discriminants,
optionality, nullability, `Partial<>` patches, property order, comments).
Repeated survey keys are by design and are never collapsed.

## Hub splice (parent-owned, the only shared-file production edit)

- Import block: +4 lines (`CadLayerCommandPayload`,
  `CadSurveyCommandPayload` type imports with a STRUCT-241.1 comment).
- Union: the 14 inline layer members replaced by
  `| CadLayerCommandPayload` at the first original position; the 16 inline
  survey members replaced by `| CadSurveyCommandPayload` at the first
  original position.
- Untouched: `CadCommandKey` (byte-identical, verified by regex extraction
  before/after), `F2F_GENERATE`, `BLOCK_SEED`/`BLOCK_EDIT`,
  `CadSurfaceCommandPayload`, inline `LANDXML_IMPORT`, `BLOCK_CREATE`
  through `BLOCK_DELETE` (future #241 scope), all other public exports, all
  runtime code. No import removal was needed (tsc + eslint clean, zero
  unused).

## Ownership

Worker A (slot 1) exclusively created the layer leaf; Worker B (slot 2)
exclusively created the survey leaf; neither edited the hub. Parent
performed the mechanical hub splice, the new test suite, TODO/evidence
updates, validation, and review orchestration. No overlapping writes.

## Consequences

- Top-level `CadCommand` members 168 -> 140 (140 inline -> 110, 21 leaf
  refs -> 23, 7 parenthesized intersections unchanged); effective flattened
  members remain 168 (AST-measured, pinned in tests).
- Graph: +2 nodes (the leaves), +4 type edges, VALUE 0/0 and TYPE 7/38
  unchanged on full `src`; CAD scope VALUE/TYPE 0/0 unchanged. No cycle
  severed or introduced; no SCC improvement claimed.
- Transpiled hub emit `export {};` byte-identical before/after; both
  leaves emit marker-only. `executeCadCommand` and all runtime behavior
  unchanged.
