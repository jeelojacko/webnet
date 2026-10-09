# STRUCT-195.2 — CAD core primitive type leaf

Branch: `refactor/issue1952-cad-core-type-foundations`
Baseline: `4796e0ba9da43934e3bba66623c0e58fc0e2e13c` (parent of the branch work)
Refs #195 / Part of #195 — issue #195 stays **OPEN** (never `Closes`/`Fixes`).
Scope: Worker A — the import-free primitive type leaf plus the display/draft
repoints, the `cadTypes` F2F-link repoint, and the reusable import-graph tool.
Worker B (parallel) owns `fieldToFinishLinkTypes.ts`, `cadSelectionTypes.ts`,
and the `cadTransactions.types`/`cadSelection`/`linkedSync` repoints; those
landed during this mission and are exercised by the same graph guard.

## What moved

`src/engine/cad/cadCorePrimitiveTypes.ts` (new, **zero imports**, type-only)
now owns exactly nine declarations copied verbatim from `cadTypes.ts`:

- `CadEntityId`, `CadLayerId`, `CadStyleId`, `CadLineTypeId`,
  `CadTextStyleId`, `CadPointSymbolId` (string aliases)
- `CadBounds` (`minX`/`minY`/`maxX`/`maxY` numbers)
- `CadLayer` (all fields + the 8-literal `role` union; comments preserved)
- `CadPointSymbolShape` (`'circle' | 'square' | 'triangle' | 'cross' | 'x' | 'dot'`)

`CadEntityAppearance`, `CadBaseEntity`, `CadLineType`, `CadTextStyle`, and
`CadPointSymbol` stay in `cadTypes.ts` (outside the agreed leaf contract).

Re-export contract: `cadTypes.ts` gains
`import type { … } from './cadCorePrimitiveTypes'` +
`export type { … } from './cadCorePrimitiveTypes'`, so every existing
`from './cadTypes'` consumer keeps compiling with no change. The AST/identity
pin is `tests/cad_core_primitive_types_1952.test.ts`.

Repointed edges (all type-only; runtime value imports untouched):

| From | Old target | New target |
| --- | --- | --- |
| `cadDisplayTypes.ts` | `./cadTypes` | `./cadCorePrimitiveTypes` |
| `cadDraftTypes.ts` | `./cadTypes` (primitives only) | `./cadCorePrimitiveTypes` |
| `cadTypes.ts` (`FieldToFinishLink`) | `../fieldToFinish/linkedSync` | `../fieldToFinish/fieldToFinishLinkTypes` (Worker B leaf) |
| `cadTransactions.types.ts` | `./cadSelection` | `./cadSelectionTypes` (Worker B leaf) |

`cadDraftTypes.ts` keeps its real value imports (`createStableRuntimeId` from
`../id`, `cadStyles` constants) — asserted by
`tests/cad_type_dependency_graph_1952.test.ts`.

## Measurement method

`scripts/cadTypeImportGraph.mjs` uses the TypeScript compiler API
(`typescript` is already a dependency; no new package) to parse every static
import/reexport and classify it:

- `import type …`, a type-only `ImportClause`, or a named-import clause whose
  specifiers are all `isTypeOnly` (with no default/namespace binding) → **TYPE**
- `export type …` / `export { type A, type B } from` → **TYPE**
- side-effect / default / namespace / any clause with a runtime binding → **VALUE**
- a single clause with both runtime and type-only bindings → **MIXED**, which
  contributes to **both** graphs.

Modules resolve through relative `.ts`/`.tsx`/index probing, bundler-style
`.js` → `.ts`, and tsconfig `baseUrl`/`paths` aliases. Adjacency is sorted and
SCCs use a deterministic iterative Tarjan.

- **BEFORE** = read-only `git show 4796e0ba…:…` snapshot (no checkout, no
  stash apply, no work-tree mutation).
- **AFTER** = the working tree.
- **Scope** = `src/engine/cad/**` + `src/engine/fieldToFinish/**`; the resolver
  is restricted to that covered set, so cross-scope specifiers are recorded as
  unresolved (93 in both runs) and excluded from the SCCs. This is applied
  identically before and after, so the A/B comparison is sound for the touched
  modules, but it is a scope limitation (see below).

## BEFORE/AFTER graphs (measured)

| Metric | BEFORE (4796e0ba) | AFTER (working tree) |
| --- | --- | --- |
| Nodes | 462 | 465 |
| Edges (value + type + mixed) | 2337 | 2344 |
| VALUE cyclic components | 4 | 4 |
| VALUE cyclic nodes | 18 | 18 |
| VALUE largest SCC | 7 | 7 |
| TYPE cyclic components | 5 | 8 |
| TYPE cyclic nodes | 58 | 28 |
| TYPE largest SCC | 47 | 9 |

The **value graph is byte-identical** before and after (same components, same
18 nodes); the three extra nodes/seven extra edges are the new type-only
leaves (`cadCorePrimitiveTypes`, `fieldToFinishLinkTypes`,
`cadSelectionTypes`) and their type-only edges. The giant
47-node TYPE SCC decomposes into a 9-node maximum plus smaller remnants.

Touched-module SCC membership (value / type):

| Module | BEFORE value | BEFORE type | AFTER value | AFTER type |
| --- | --- | --- | --- | --- |
| `cadCorePrimitiveTypes.ts` | — (absent) | — (absent) | 1 | 1 |
| `cadTypes.ts` | 1 | 47 | 1 | 4 |
| `cadDisplayTypes.ts` | 1 | 47 | 1 | **1** |
| `cadDraftTypes.ts` | 1 | 47 | 1 | **1** |
| `cadTransactions.types.ts` | 1 | 47 | 1 | 9 |
| `cadSelection.ts` | 1 | 47 | 1 | **1** |
| `fieldToFinishLinkTypes.ts` | — | — | 1 | 1 |

Every touched module is a singleton in the **value** graph (no introduced
runtime SCC), and display/draft/selection leave the type hub entirely.

Severed edges verified by the AST graph (no edge of any kind remains):

```
cadDisplayTypes.ts  -> cadTypes.ts            NONE  (was type)
cadDraftTypes.ts    -> cadTypes.ts            NONE  (was type)
cadTypes.ts         -> linkedSync.ts          NONE  (was type)
cadTransactions.types.ts -> cadSelection.ts   NONE  (was type)
```

Replacement edges exist and are type-only:
`cadDisplayTypes → cadCorePrimitiveTypes`, `cadDraftTypes → cadCorePrimitiveTypes`,
`cadTypes → fieldToFinishLinkTypes`, `cadTransactions.types → cadSelectionTypes`.

## Residual type-level cycles (honest)

The leaf **shrinks** the type graph; it does not eliminate every type cycle.
The AFTER type SCCs and their residual paths:

- **4-node** — `cadTypes` still cycles through the annotation/cogo hub:
  `cadTypes → annotation/cadAnnotationAnchors → cadProjectLookup → cadTypes`
  and `cadTypes → cadCogoTypes → cadTypes`.
- **9-node** — the transaction/F2F cluster:
  `cadTransactions.types ⇄ {cadParcelSharedEdit, cadTransactionsParcelLinkCommands,
  cadTransactionsParcelNetworkCommands, cadTransactionsParcelPlanCommands,
  cadUndoRedo, cadTransactions}` plus
  `cadTransactions.types → fieldToFinish/cadGeneration → linkedSync → cadGeneration`
  (the `linkedSync ⇄ cadGeneration` type cycle persists; only the
  `cadTypes → linkedSync` path was cut).
- **2-node** pairs: `cadProjectTransform ⇄ cadProjectTransformRequest`,
  `cadSurfaceRevision ⇄ cadSurfaces`, `cadSurfaceEditMesh ⇄ cadSurfaceEdits`,
  `dxf/dxfBlockExport ⇄ dxf/dxfExportModel`,
  `profiles/profileExtraction ⇄ profiles/profileSampling`.
- **5-node** export cluster: `cadExportScene` and the analysis/grading/sheet
  export-scene modules (pre-existing, unchanged).

Note: `cadProjectTransform`, `cadSurfaceRevision`/`cadSurfaces`, and the
export cluster were previously *inside* the 47-node SCC; the leaf split them
out into their own smaller cycles, which is why the component count rises
(5 → 8) while the cyclic-node count falls (58 → 28). No improvement is claimed
beyond what the numbers show, and no residual path is hidden.

## Assertions

`tests/cad_type_dependency_graph_1952.test.ts` (6 tests) pins:

- the four severed edges (the Worker B pair opportunistically, guarded on the
  leaf existing) and their type-only replacements;
- every touched module is a value-graph singleton (no introduced runtime SCC);
- no value path between the severed primitive pairs;
- the #195.1 splits stay value-acyclic (`cadBlockReferenceOps ⇄ cadBlockUiCommands`
  broken and `cadTransactionsSurfaceBoundaryCommands → cadTransactionsSurfaceCommands`
  has no value path).

`tests/cad_core_primitive_types_1952.test.ts` (6 tests) pins:

- leaf ↔ `cadTypes` assignability both ways via `expectTypeOf` for all nine
  names, plus runtime round-trips and identical JSON field order;
- the layer role union (8), bounds field order, and the 6-member symbol shape;
- the leaf has **zero imports** and every top-level statement is a type alias
  or interface, exporting exactly the nine agreed names;
- `cadTypes.ts` carries one type-only named re-export of all nine names.

## Limitations

- Scope-restricted resolution drops cross-scope edges (93 unresolved in both
  runs). A module outside `src/engine/cad` plus `src/engine/fieldToFinish`
  that imports back into the scope would be invisible here.
- Full `src/`/`src/cad-app` graph is not measured; the tool supports
  `collectTypeScriptFiles` over any root and `loadSourcesFromGit` for
  read-only ref snapshots.
- Classification is syntactic over static `import`/`export` declarations;
  dynamic `import()` expressions and `require` are not parsed (none in the
  touched scope).
- Pre-existing broad value SCCs (`cadCogo*`, `cadGeometry*`,
  `cadProjectTransform`) are untouched and out of scope for 195.2.
- No production build, browser QA, or CI is run or claimed here — parent
  integration owns those; exact-head CI is authoritative.

## Roadmap to 195.3

- Break the `cadTypes` hub (4-node SCC): move `CadCogoComputation` and the
  annotation anchor types behind leaves so `annotationAnchors`, `cadCogoTypes`,
  and `cadProjectLookup` stop pointing back at `cadTypes`.
- Split the 9-node transaction/F2F SCC: give `cadTransactions.types` its own
  command-family leaves (parcel commands, F2F generation) and cut the
  `linkedSync ⇄ cadGeneration` type cycle.
- Peel the deterministic 2-node pairs (projectTransform, surfaces/revision,
  surface edits, dxf, profiles) into leaves.
- Keep `scripts/cadTypeImportGraph.mjs` as the regression entry point; the
  value graph must stay identical to this AFTER measurement.
