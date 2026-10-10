# STRUCT-241.4 Architecture — primitive CAD geometry entity contracts

Baseline: origin/main EXACT `526be1780efa7c0d90eb33728869a2591f2219d4` (PR #245 merge, STRUCT-241.3).
Branch: `refactor/issue2414-primitive-geometry-entity-types`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadPrimitiveGeometryEntityTypes.ts` (146 lines) owns EIGHT
primitive/geometry entity contracts in original source order:
`CadLineEntity`, `CadPolylineSegmentGeometry`, `CadPolylineSegmentWidth`,
`CadPolylineEntity`, `CadArcEntity`, `CadCircleEntity`, `CadPolygonEntity`,
`CadParabolaEntity` (noncontiguous in hub: line→circle block, polygon island,
parabola island).

Worker-verified 8/8 declarations verbatim (brace-matched bodies +
immediately-preceding JSDoc exact-string match), preserving bulge-sign
convention, segment-width semantics, radius fields, discriminants,
optionality, union member order, and finite parabola extent.
Type-only imports only: `CadBaseEntity` from `./cadEntityFoundationTypes`,
`CadDisplayPoint` from `./cadDisplayTypes`, `StationId` from `../../types`.
No `cadTypes`/barrel/runtime/`cadTransactions` imports; emitted JS is the
header comment + `export {};` (verified via transpileModule).

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1780 -> 1694 lines (25 insertions, 111 deletions):

1. The 8 moved definitions/comments deleted (line→circle block, polygon
   island, parabola JSDoc+interface); nothing else touched.
2. One grouped `import type` + one grouped `export type` re-export all 8
   names so existing `from './cadTypes'` consumers compile unchanged.
3. `CadEntity` union order EXACT (19 members), `CadBlockChild` EXACT
   (6 members, parabola excluded), `CadBlockChildType` untouched.
   Transaction/command types, geometry implementations, serialization,
   project transforms, runtime imports/consumers untouched.
   No consumer rewritten to the new leaf path.

## Graph impact (measured, `scripts/cadTypeImportGraph.mjs`)

- CAD+F2F scope: 488 nodes / 2412 edges -> 489 / 2416 (+1 node, +4 type
  edges: hub import-type + hub export-type + leaf→`./cadDisplayTypes` +
  leaf→`./cadEntityFoundationTypes`).
- Full `src`: 1660 / 7522 -> 1661 / 7527 (+1 node, +5 edges).
- Value/mixed digests UNCHANGED (scoped `0bc9bae1…fcb7`, full `415f97f0…2448`);
  scoped VALUE/TYPE SCC 0; full VALUE 0 / TYPE 7 SCC-38 modules.
  No new SCC/backedge/runtime edge — verified by the new 59-test suite and
  the rolled-forward 2412/2413/19511/19512/19514 guards.

## Workers

- worker-leaf-2414 (slot 1): new leaf only, 8/8 verbatim, tsc clean.
- worker-tests-2414 (slot 2): new 59-test suite (740 lines), 59/59 green
  post-integration (isolated-worktree pre-verified).
- worker-guards-2414 (slot 3): rolled forward 5 guard files only
  (2412/2413/19511/19512/19514), 7-file set 285/285 green.
- Parent: hub splice, docs, TODO, integration, validation, PR.
- Reviewer: independent read-only review of final diff (see validation.md).
