# STRUCT-195.3 — CAD surface/bake/compose + volume command-payload type leaves

Branch: `refactor/issue1953-cad-surface-volume-command-types`
Baseline: `706ab3ff9ec8a172aad2e4e17492d78d2274c329` (195.2 merge on main)
Refs #195 — issue #195 stays **OPEN** (never `Closes`/`Fixes`).
Scope: Worker A — the surface/bake/compose payload leaf; Worker B — the
volume payload leaf; both landed plus the hub splice (not modified here).
Worker C (this file + `validation.md`) is docs-only.

## What moved

Two new type-only leaves own the 43 payload members extracted verbatim from
the `CadCommand` union in `src/engine/cad/cadTransactions.types.ts`
(hub `2048 → 1727` lines: `+2` comment `+2` type-only imports `+2` union
members at lines 999–1000; `−270` surface block `−51` volume block `−6`
unused imports). The hub splices both leaves back into the union at the
original position, so union order is unchanged.

`src/engine/cad/cadTransactionsSurfaceCommandTypes.ts` (new, **295 lines**)
exports `CadSurfaceCommandPayload` — 34 variants in exact union order:

- 30 `SURFACE_*`: `SURFACE_CREATE`, `SURFACE_DELETE`, `SURFACE_RENAME`,
  `SURFACE_SET_LAYER_STYLE`, `SURFACE_ADD_POINT_GROUP`,
  `SURFACE_REMOVE_POINT_GROUP`, `SURFACE_ADD_POINTS`,
  `SURFACE_REMOVE_SOURCE`, `SURFACE_ADD_BREAKLINE`,
  `SURFACE_REMOVE_BREAKLINE`, `SURFACE_RENAME_BREAKLINE`,
  `SURFACE_BREAKLINE_INSERT_POINT`, `SURFACE_BREAKLINE_REMOVE_POINT`,
  `SURFACE_BREAKLINE_REVERSE`, `SURFACE_BREAKLINE_REPLACE_CHAIN`,
  `SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN`, `SURFACE_ADD_BOUNDARY`,
  `SURFACE_REMOVE_BOUNDARY`, `SURFACE_CREATE_BOUNDARY_SOURCE`,
  `SURFACE_REPLACE_BOUNDARY_SOURCE`,
  `SURFACE_MAKE_BOUNDARY_INDEPENDENT`, `SURFACE_ADD_EDIT`,
  `SURFACE_DELETE_EDIT`, `SURFACE_MOVE_EDIT`, `SURFACE_SET_EDIT_ENABLED`,
  `SURFACE_STYLE_CREATE`, `SURFACE_STYLE_DUPLICATE`, `SURFACE_STYLE_RENAME`,
  `SURFACE_STYLE_UPDATE`, `SURFACE_STYLE_DELETE`
- 4 bake/compose: `SURFBAKE`, `SURFBAKECOPY`, `SURFCOMPOSE`,
  `SURFCOMPOSEPASTE`

`src/engine/cad/cadTransactionsVolumeCommandTypes.ts` (new, **70 lines**)
exports `CadVolumeCommandPayload` — 9 variants in exact union order:

- 4 `VOLUME_SURFACE_*`: `VOLUME_SURFACE_CREATE`, `VOLUME_SURFACE_DELETE`,
  `VOLUME_SURFACE_UPDATE_SOURCES`, `VOLUME_SURFACE_SET_LAYER_STYLE`
- 5 `VOLUME_STYLE_*`: `VOLUME_STYLE_CREATE`, `VOLUME_STYLE_DUPLICATE`,
  `VOLUME_STYLE_RENAME`, `VOLUME_STYLE_UPDATE`, `VOLUME_STYLE_DELETE`

Field semantics are preserved verbatim per member: field names/types,
optionality (`?`), `readonly` modifiers, doc comments, and field order are
unchanged; the 43-member key sequence matches the pre-extraction union.
`CadCommandKey` is byte-identical (diff-verified), so the public command
surface, `Extract<CadCommand, { key }>` narrowing, and both-direction
assignability (`CadSurfaceCommandPayload`/`CadVolumeCommandPayload` extend
`CadCommand` and the `Extract<>` slices extend the leaves) all hold —
pinned by `expectTypeOf` in the new suites (typecheck-enforced).

## BEFORE/AFTER graphs (measured, `scripts/cadTypeImportGraph.mjs`)

Scope `src/engine/cad/**` + `src/engine/fieldToFinish/**` (same tool and
scope as 195.2; cross-scope specifiers recorded as unresolved):

| Metric | BEFORE (706ab3ff) | AFTER (working tree) |
| --- | --- | --- |
| Nodes | 465 | 467 |
| Edges (value + type + mixed) | 2344 | 2350 |
| Unresolved (scope-external, excluded) | 93 | 93 |
| VALUE cyclic components / nodes | 4 / 18 | 4 / 18 |
| TYPE cyclic components / nodes | 8 / 28 | 8 / 28 |

Both new leaves are **type-graph singletons with zero value edges**; the
value graph is unchanged (no runtime SCC introduced) and the type graph is
unchanged (the leaves did not join the residual 9-node transaction/F2F
cluster). This phase shrinks the hub file; it does not claim to break type
cycles. (The older "135 cycles" figure from 195.1 predates the 195.2 tool
recount; the current scoped baseline is 8 type SCCs / 28 nodes.)

## Limitations

- Scope-restricted resolution drops cross-scope edges (93 unresolved in both
  runs); a back-edge from outside the scope would be invisible here.
- Classification is syntactic over static `import`/`export` declarations.
- No `test:agent`, build, browser QA, or CI is run or claimed here — parent
  integration owns those; exact-head CI is authoritative.

## Roadmap

- Remaining `CadCommand` families in the hub (parcel, curve/F1, grading,
  profile/section, survey, block, F2F, shell) are candidates for the same
  leaf treatment, each keeping union order and `CadCommandKey` stable.
- The `cadTypes` 4-node annotation/cogo hub and the 9-node transaction/F2F
  cluster (incl. `linkedSync ⇄ cadGeneration`) from 195.2 remain open.
- Keep `scripts/cadTypeImportGraph.mjs` as the regression entry point.

## Phase-end closeout (parent-recorded, 195.3 merged)

PR #227 merged: reviewed head `a85fcd306918f79cfec32ddc549a7549b54ffa57`,
main merge SHA `1987a6b801eaeda6c952c538b38c67f2d6a82ac0`. Exact-head GitHub
CI all 5 jobs green; Chromium 4/4 per the merged PR record. The
worker-scope caveat in Limitations above ("No `test:agent`, build,
browser QA, or CI is run or claimed here — parent integration owns
those") remains the true record of what the workers ran (Worker C never
ran those suites); this note is the parent-recorded phase closeout, not
a claim that Worker C ran CI.
Refs #195 — issue #195 stays OPEN.
