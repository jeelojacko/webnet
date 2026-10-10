# STRUCT-241.5 Architecture — CAD annotation + survey-table type families

Baseline: origin/main EXACT `707b8b26d5426164d232c17d6f2e6d72484f6a8c` (PR #246 merge, STRUCT-241.4).
Branch: `refactor/issue2415-cad-annotation-survey-table-type-leaves`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadAnnotationEntityStyleTypes.ts` (147 lines) owns TWELVE
Phase 18O professional annotation entity/style contracts in original source
order: `CadMTextAttachment`, `CadMTextEntity`, `CadLeaderEntity`,
`CadDimensionKind`, `CadDimensionEntity`, `CadBearingDistanceLabelEntity`,
`CadCurveLabelEntity`, `CadDimensionStyle`, `CadLeaderStyle`,
`CadBearingLabelStyle`, `CadCurveLabelField`, `CadCurveLabelStyle`.

NEW `src/engine/cad/cadSurveyTableEntityTypes.ts` (115 lines) owns SEVEN
Phase 19A drawing survey-table contracts in original source order:
`CadSurveyTableKind`, `CadSurveyTableRowSource`, `CadSurveyTableRow`,
`CadSurveyTableTagSettings`, `CadSurveyTableColumnOverride`,
`CadSurveyTableEntity`, `CadSurveyTableStyle`.

Worker-verified 12/12 + 7/7 declarations verbatim (brace-matched bodies +
immediately-preceding JSDoc exact-string match; annotation whole-block diff
byte-identical), preserving the 9-point attachment union, the 5-branch
dimension discriminant, leader/dimension anchor contracts, style
units/options, label source/offset contracts, row-source discriminants,
stable course ids / parcel refs, tag settings, row order/custom code,
paper/model sizing, and style options.
Annotation type-only imports: `CadBaseEntity`, `CadAnnotationAnchor`
(`./annotation/cadAnnotationAnchorTypes`), `CadEntityId` + `CadTextStyleId`.
Survey-table type-only imports: `CadBaseEntity`, `CadEntityId` +
`CadTextStyleId`. No cross-import between the leaves; no `cadTypes`/barrel/
runtime/`cadTransactions` imports; each emitted JS is the header comment +
`export {};` (verified via transpileModule).

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1694 -> 1549 lines:

1. The 19 moved definitions/comments deleted (18O block + 19A block);
   nothing else touched. `CadTextEntity` / `CadPointLabelBinding` stay.
2. Two grouped `import type` + two grouped `export type` blocks re-export
   all 19 names so existing `from './cadTypes'` consumers compile unchanged.
3. Two now-unused local imports retired: the `CadAnnotationAnchor` line
   (all local uses moved to the annotation leaf; no consumer imported it
   from the hub) and the `CadTextStyleId` entry of the core-primitives
   import block (all local uses moved; the `export type` re-export stays).
4. `CadEntity` union order EXACT (19 members, survey-table first, 5
   annotation members in original slots), `CadBlockChild` EXACT (6 members,
   no parabola), `CadBlockChildType` untouched. Command unions, style
   resolvers, serialization, consumers untouched. No consumer rewritten to
   leaf paths.

## Graph impact (measured, `scripts/cadTypeImportGraph.mjs`)

- CAD+F2F scope: 489 nodes / 2416 edges -> 491 / 2424 (+2 nodes, +8 type
  edges: annotation 3 out + hub import-type + hub export-type, survey 2 out
  + hub import-type + hub export-type, minus the retired hub -> anchor
  import-type edge).
- Full `src`: 1661 / 7527 -> 1663 / 7535 (+2 nodes, +8 edges; every 241.5
  edge resolves inside `src`).
- Value/mixed digests UNCHANGED (scoped 1585/1567 `0bc9bae1…fcb7`, full
  4444/4385 `415f97f0…2448`); scoped VALUE/TYPE SCC 0; full VALUE 0 /
  TYPE 7 SCC-38 modules. No new SCC/backedge/runtime edge — verified by the
  new 92-test suite and the rolled-forward 2412/2413/2414/19511/19514/1957
  guards.

## Workers

- Worker A annotation leaf (slot 1 `commandcode/deepseek/deepseek-v4.1-flash`):
  new annotation leaf only, 12/12 verbatim, type-only + emit verified.
- Worker B survey-table leaf (slot 2 `opencode-go/deepseek-v4.1-flash`):
  new survey-table leaf only, 7/7 verbatim, type-only + emit verified.
- Parent: hub splice, unused-import retirement, new 92-test suite, all guard
  roll-forwards, docs, TODO, validation, PR.
- Reviewer: independent read-only review of final diff (see validation.md).
