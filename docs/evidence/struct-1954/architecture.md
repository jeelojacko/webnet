# STRUCT-195.4 — F2F generation + parcel command-payload type leaves

Branch: `refactor/issue1954-f2f-parcel-command-type-feedback`
Baseline: `origin/main` `1987a6b801eaeda6c952c538b38c67f2d6a82ac0` (195.3 merge on main)
Refs #195 — issue #195 stays **OPEN** (never `Closes`/`Fixes`).
Scope: Worker A — the FieldToFinish generation leaf; Worker B — the
parcel command-payload leaf; both landed plus the hub splice (not modified
here). Worker C (this file + `validation.md`) is docs-only.

## What moved

Two new type-only leaves own the payload members extracted verbatim from
the `CadCommand` union in `src/engine/cad/cadTransactions.types.ts`.
Old modules re-export under their original paths; `CadCommandKey` is
unchanged; the hub diff is import-block only (union order preserved).

`src/engine/fieldToFinish/fieldToFinishGenerationTypes.ts` (new,
**75 lines**) exports `FieldToFinishEntityState`,
`FieldToFinishProvenance`, `FieldToFinishCadPayload`, and
`LinkOfPayloadSource`. `generatedBy` is the literal `'FIELD_TO_FINISH'`,
compiler-proven equal to `typeof FIELD_TO_FINISH_GENERATOR` (pinned by
the new suites).

`src/engine/cad/cadTransactionsParcelCommandTypes.ts` (new, **74 lines**)
exports the 7 parcel interfaces in exact union order —
designate/number/link/unlink/shared-edit/check/schedule — plus
`ParcelSharedEditEdit`.

## BEFORE/AFTER graphs (measured, `scripts/cadTypeImportGraph.mjs`)

Scope `src/engine/cad/**` + `src/engine/fieldToFinish/**` (same tool and
scope as 195.2/195.3; cross-scope specifiers recorded as unresolved).
BEFORE = `origin/main` `1987a6b801eaeda6c952c538b38c67f2d6a82ac0`,
AFTER = working tree:

| Metric | BEFORE (1987a6b8) | AFTER (working tree) |
| --- | --- | --- |
| Nodes | 467 | 469 |
| Edges (value + type + mixed) | 2350 | 2360 |
| Unresolved (scope-external, excluded) | 93 | 94 |
| VALUE cyclic components / nodes | 4 / 18 | 4 / 18 |
| TYPE cyclic components / nodes | 8 / 28 (largest 9) | 7 / 19 (largest 5) |

The entire 9-node transaction/F2F type SCC is **GONE**: no residual SCC
contains any of `cadTransactions.types`, `cadTransactions`,
`cadUndoRedo`, `cadGeneration`, `linkedSync`, the parcel
plan/link/network modules, or `cadParcelSharedEdit`.

Severed TYPE edges (mixed edges become value-only; the
`cadGeneration->linkedSync` value edge is retained):

- hub → `cadGeneration`
- `linkedSync` → `cadGeneration`
- `cadGeneration` → `linkedSync` (mixed → value-only)
- hub → parcel plan, parcel link, parcel network, parcel shared-edit

Why the SCC dissolved: the hub and `linkedSync` no longer import
generation/parcel *types* from the cycle members — those payload types
now live in the two leaves, which are type-graph singletons outside the
cluster. With the type back-edges cut, Tarjan finds no cycle through the
former 9-node set, while every retained value edge keeps runtime imports
unchanged (value edges: 1561 before and after, 0 added / 0 removed).

The +1 unresolved (93 → 94) is scope-external `../resultIntegrity`
imported by the F2F leaf — a cross-scope specifier excluded from the
graph, NOT a regression. The largest remaining type SCC is the 5-node
export-scene cluster (`cadAnalysisExportScene` / `cadExportScene` /
`cadGradingExportScene` / `cadGradingGroupExportScene` /
`cadSheetScene`), which is out of scope.

## Limitations

- Scope-restricted resolution drops cross-scope edges (93/94 unresolved);
  a back-edge from outside the scope would be invisible here.
- Classification is syntactic over static `import`/`export` declarations.
- No `test:agent`, build, browser QA, or CI is run or claimed here — parent
  integration owns those; exact-head CI is authoritative.

## Roadmap

- #195.5: remaining `CadCommand` families (profile/section/grading
  payloads) get the same leaf treatment, keeping union order and
  `CadCommandKey` stable.
- The `cadTypes` 4-node annotation/cogo hub and any remaining type SCC
  remnants stay open.
- Keep `scripts/cadTypeImportGraph.mjs` as the regression entry point;
  the value graph must stay identical to this AFTER measurement.
