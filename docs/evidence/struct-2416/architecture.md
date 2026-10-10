# STRUCT-241.6 Architecture — CAD linear-design + parcel entity contracts

Baseline: origin/main EXACT `818579e4d58d5ac1262c3f45d72d051651b808ee` (PR #247 merge, STRUCT-241.5).
Branch: `refactor/issue2416-linear-design-parcel-entity-type-leaves`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadLinearDesignEntityTypes.ts` (98 lines) owns SIX
linear-design contracts in original source order: `CadAlignmentElement`,
`CadStationEquation`, `CadAlignmentEntity`, `CadFeatureLineVertex`,
`CadFeatureLineSegmentGeometry`, `CadFeatureLineEntity`.

NEW `src/engine/cad/cadParcelEntityTypes.ts` (102 lines) owns SIX parcel
contracts in original source order: `CadParcelCourseGeometry`,
`CadParcelPlanRole`, `CadParcelPlanInfo`, `CadParcelSharedBoundaryEnd`,
`CadParcelSharedBoundary`, `CadParcelEntity`.

Worker-verified 6/6 + 6/6 declarations verbatim (Worker A proved the linear
block byte-identical via diff of the hub lines 197-267 region), preserving
the line/arc discriminants, optional `sourceEntityId`, station-equation
semantics (`rawStation` optional), required feature-line vertex Z (never
default 0), signed CAD-standard bulge convention (positive = CCW, |b| > 1 =
major arc), per-course length contracts, the six plan-role literals in
order, shared-boundary ref-only semantics, parcel course/closure metadata,
and trailing optional `planInfo`.
Linear type-only imports: `CadBaseEntity`, `CadDisplayPoint`, `CadEntityId`.
Parcel type-only imports: `CadBaseEntity`, `CadDisplayPoint`. No
cross-import between the leaves; no `cadTypes`/barrel/runtime/
`cadTransactions` imports; each stripped emit is `export {};` (verified via
transpileModule).

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1549 -> 1440 lines:

1. The 12 moved definitions with attached JSDoc deleted (alignment block +
   feature-line block + parcel block); nothing else touched.
2. One grouped `import type` + one grouped `export type` block per leaf
   re-export all 12 names so existing `from './cadTypes'` consumers compile
   unchanged. No import retired (all hub-local uses of `CadBaseEntity`,
   `CadDisplayPoint`, `CadEntityId` remain for other contracts).
3. `CadEntity` union order EXACT (19 members, alignment/parcel/feature-line
   in original slots), `CadBlockChild` EXACT (6 members, no parabola),
   `CadBlockChildType` untouched. Survey-point/text/error-ellipse, block,
   project/drawing/persistence/parcel-layout/grips/snaps, surface/volume/
   profile/section contracts, runtime guards untouched. No consumer rewritten
   to leaf paths.

## Graph impact (measured, `scripts/cadTypeImportGraph.mjs`)

- CAD+F2F scope: 491 nodes / 2424 edges -> 493 / 2433 (+2 nodes, +9 type
  edges: linear 3 out + hub import-type + hub export-type, parcel 2 out +
  hub import-type + hub export-type, no retired hub edge).
- Full `src`: 1663 / 7535 -> 1665 / 7544 (+2 nodes, +9 edges; every 241.6
  edge resolves inside `src`).
- Value/mixed digests UNCHANGED (scoped 1585/1567 `0bc9bae1…fcb7`, full
  4444/4385 `415f97f0…2448`); scoped VALUE/TYPE SCC 0; full VALUE 0 /
  TYPE 7 SCC-38 modules. No new SCC/backedge/runtime edge — verified by the
  new 93-test suite and the rolled-forward 2412/2413/2414/2415/19511/19512/
  19514 guards.

## Workers

- Worker A linear leaf (slot 1 `commandcode/deepseek/deepseek-v4.1-flash`):
  new linear leaf only, 6/6 verbatim, type-only + emit verified.
- Worker B parcel leaf (slot 2 `opencode-go/deepseek-v4.1-flash`):
  new parcel leaf only, 6/6 verbatim, type-only + emit verified.
- Parent: hub splice, new 93-test suite, all guard roll-forwards, docs,
  TODO, validation, PR.
- Reviewer: independent read-only review of final diff (see validation.md).
