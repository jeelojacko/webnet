# STRUCT-241.2 Validation

Main exact SHA: `739b0de3a83efe48d9ead26366e3b1ffac88f954` (origin/main, PR #243
merge; 5/5 CI run 38069846381). Branch
`refactor/issue2412-block-command-type-leaf`. 14 pre-existing stashes preserved
in order (verified `git stash list | wc -l` = 14 before and after; never
applied/popped/dropped). `.pi/lsp.json`, secrets, ignored Study Desktop
fixtures, prior branches untouched. Local tree was clean on the prior
`refactor/issue2411-survey-layer-command-type-leaves` head `4a874a36`
(controller merged remotely — normal); switched to `main`, ff-only to the
expected SHA, branched fresh. No force push, no merge, no issue close here.
Docs-only prep also corrected one stale line in
`docs/evidence/struct-2411/validation.md` (new suite `37/37` -> final `40/40`
after two review corrections); no other historical evidence modified.

## Splice positions (before -> after)

- Early: `TITLE_BLOCK_EDIT` -> `BLOCK_SEED, BLOCK_EDIT` (hub lines 776-788) ->
  `CadLayerCommandPayload`. After: `TITLE_BLOCK_EDIT` ->
  `CadBlockPreludeCommandPayload` -> `CadLayerCommandPayload`.
- Later: `CadSectionViewDeleteCommand` -> `BLOCK_CREATE, BLOCK_INSERT,
  BLOCK_EXPLODE, BLOCK_REDEFINE, BLOCK_RENAME, BLOCK_DUPLICATE, BLOCK_DELETE`
  (hub lines 820-862) -> `CREATE_MTEXT`. After: `CadSectionViewDeleteCommand`
  -> `CadBlockDefinitionCommandPayload` -> `CREATE_MTEXT`.
- Leaf diff vs baseline is empty except the required terminal `};` per alias
  (Worker A verified). All 9 shapes/comments/optionality/field-order verbatim,
  incl. `BLOCK_INSERT` optional `mirrored`/`layerId`, `BLOCK_DELETE` optional
  `force`/`deleteRefs`, `BLOCK_EDIT` optional transforms.

## Counts / fingerprints

- Hub: 1169 -> 1121 lines (31646 -> 30880 bytes).
- `CadCommand` top-level: 140 -> 133 (101 inline / 7 intersections / 25 refs).
  Flattened effective members: 168 exact before vs after, original order
  unchanged (all 30 survey/layer variants in place; 7 duplicate BLOCK key
  literals untouched).
- `CadCommandKey`: raw source segment byte-identical from pinned baseline
  (248 occurrences / 241 unique).
- CAD+F2F graph: 485/2404 -> 486/2406 (+1 node, +2 type edges, explicit
  allowlist). VALUE/MIXED 1585 edges / 1567 unique pairs, SHA
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  identical; entire edge membership identical outside allowlist. VALUE 0/0,
  TYPE 0/0.
- Full `src`: 1657/7514 -> 1658/7516. VALUE 4444/4385, SHA
  `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  identical. VALUE SCC 0; TYPE 7/38 unchanged.

## Tests (parent-run)

- NEW `tests/cad_block_command_type_leaf_2412.test.ts`: **36/36** (was 29/36
  before the parent hub splice; the 7 failures were exactly the
  splice-dependent assertions, and an in-memory simulated splice predicted the
  post-state 133/101/25/7 + 168 + sentinels).
- Rolled-forward neighbours: `2411` 40/40, `1955` 20/20, `19511/19512/19513/
  19514/1956` 133/133; block neighbours (`cad_blocks_transactions`,
  `cad_blocks_engine`, `cad_blocks_wncad`, `cad_blocks_ui`,
  `cad_blocks_mirror_18q`, `cad_block_value_cycle_1951`) green.
- `npx tsc --noEmit`: exit 0. `npm run lint`: 0 errors (9 pre-existing warnings elsewhere). `npm run build`: clean, 11.80s. `npm run check:portable-paths`: 6356/0. `npm run test:agent`: 1048 files (1045 passed, 3 failed = exactly the 3 known pre-existing study-desktop ignored-fixture real-data fails); 10188 passed + 1 skipped. User files preserved; attribution honest.
- Old frozen fixtures (19511 graph, parcel 41-edge, 19513 arc) byte-identical.

## Review / PR

- Independent final reviewer: `openai-codex/gpt-6-sol` (per active routing
  policy) on the full exact integrated diff — PENDING at time of writing;
  substantive findings will be fixed in this context with rerun + re-review.
- Commit + push branch `refactor/issue2412-block-command-type-leaf`; create ONE
  PR "STRUCT-241.2: extract CAD Block command payload family" against exact
  verified main with final SHA, graph/test evidence, reviewer, risk, honest CI
  status, `Refs #241` ONLY (never Closes/Fixes). Do NOT merge, close #241,
  alter #195/#240, force-push, or launch 241.3.
