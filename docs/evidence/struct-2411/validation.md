# STRUCT-241.1 — Validation

Provenance: branch `refactor/issue2411-survey-layer-command-type-leaves` on exact
`origin/main 08e0b6d0c8f7c14a896bb0c06221c116bc9f474e` (PR #242 merge). 14 stashes preserved.
Refs #241 ONLY. All measurements parent-run.

## 1. Baseline pins (captured BEFORE mutation, exact main)

- Hub `src/engine/cad/cadTransactions.types.ts`: 1354 lines, sha256
  `a78b669b...` (worktree); `CadCommandKey` text sha256 `f2c09f75...`;
  layer slice lines 785-862 sha256 `bde7de9c...`; survey slice lines
  867-979 sha256 `204b9e5e...`.
- `CadCommand` top-level members: 168 = 140 inline object literals + 7
  parenthesized intersections + 21 leaf refs (AST-measured).
- `CadCommandKey`: 248 literals, 241 unique (7 pre-existing BLOCK
  duplicates), byte-identical since pre-#195.
- Graph at exact `08e0b6d0` via `loadSourcesFromGit`: CAD scope 467 nodes /
  2329 edges VALUE 0/0 TYPE 0/0; full `src` 1655 / 7510 VALUE 0/0 TYPE 7/38.

## 2. Leaves (Workers A+B, parent-verified verbatim)

- Layer leaf sha256 `afba3df9...` (99 lines); `diff` hub lines 785-862 vs
  leaf body: VERBATIM except the final `};`.
- Survey leaf sha256 `f9c5c44d...` (152 lines); `diff` hub lines 867-979 vs
  leaf body: VERBATIM except the final `};`.
- Survey import decision: `CadEntityId` from zero-import
  `./cadCorePrimitiveTypes` (grep proves import-free); other 7 types from
  `./cadTypes` (which never imports the hub). All `import type`; LSP clean
  per workers; `git status` showed only the two new untracked files.

## 3. Hub splice (parent)

- `git diff --stat`: 6 insertions, 191 deletions; 1354 -> 1169 lines.
- `CadCommandKey` regex-extracted text identical before/after.
- `npx tsc --noEmit`: exit 0. `npx eslint` on hub + both leaves: 0 errors.
- Transpiled (`ts.transpileModule`) hub emit `export {};` byte-identical
  before/after; both leaves emit comment + `export {};` only.

## 4. Graph after (`scripts/cadTypeImportGraph.mjs`)

| scope | base (exact main) | after |
|---|---|---|
| CAD nodes/edges | 467 / 2329 | 469 / 2333 (+2 leaves, +4 type edges) |
| CAD VALUE / TYPE SCC | 0/0 / 0/0 | 0/0 / 0/0 |
| full `src` nodes/edges | 1655 / 7510 | 1657 / 7514 |
| full VALUE / TYPE SCC | 0/0 / 7/38 | 0/0 / **7/38 unchanged** |

Edge delta allowlist: +`hub->layerLeaf[type]`, +`hub->surveyLeaf[type]`,
+`surveyLeaf->cadTypes[type]`, +`surveyLeaf->cadCorePrimitiveTypes[type]`.
No VALUE/MIXED delta. (One interim worktree read showed 1656 nodes because
Worker A's leaf landed mid-scan; the git-ref measurement above is
authoritative.)

## 5. Tests (parent-run)

- New `tests/cad_survey_layer_command_type_leaves_2411.test.ts`: **40/40** (final after two review corrections; was 37/37 at initial landing).
  Pins: 14 layer keys + 16 survey (key,table,op) discriminants in order;
  `Extract<CadCommand>` equivalence for all 30 (table/op narrowing for
  repeats; key-alone 5-member unions for point/label/group tables);
  independent hand-transcribed `Base*` pins (hub AND leaf); runtime AST
  shape pins; splice window
  `BLOCK_EDIT -> 14 layer -> F2F_GENERATE -> 16 survey ->
  CadSurface/CadVolume/CadProfile/CadSection -> LANDXML_IMPORT ->
  CadSectionViewDeleteCommand -> BLOCK_CREATE`; top-level 140
  (110 inline / 23 refs / 7 intersections); flattened 168; 248-key pin;
  `CadTransaction`/`CadCommandState`/`CadCommandDefinition` surfaces;
  type-only + `export {};` emit pins; leaf->hub back-edge + type-only-edge
  graph pins; 7 in-memory negative controls (all fail the guard, worktree
  clean).
- Neighbours (1955 profile/section + 1956 grading + 2401 session-cycle):
  **51/51** (3 files).
- Graph-guard roll-forward (expected fallout of +2 nodes / +4 type
  edges, all outside the guarded slices): 19512 + 19514 + 19511 totals
  483/2400 -> 485/2404 with explicit STRUCT-241.1 annotations; VALUE
  fingerprints and slice allowlists untouched. Rolled suites + new
  suite: **122/122** (4 files).
- `npx tsc --noEmit`: 0. `npx eslint` (hub, leaves, all 4 tests):
  0 errors. `npm run check:portable-paths`: 6351/0.
- `npm run build`: clean, 12.02s.
- `npm run test:agent`: **1044 files passed, 10149 passed + 1 skipped;
  3 failed** = exactly the 3 known pre-existing study-desktop
  ignored-fixture real-data fails (untouched by this phase).
- Review round 1 (reviewer-2411): single P3 — the suite docstring
  overclaimed pairwise variant-text equality while `VariantShape.text`
  was captured but never asserted. Remediated parent-side (test-only,
  no production change): docstring narrowed to the true guarantee +
  three new source-text comment pins (LINEWEIGHT default comment,
  leave/clear/set comments in both override carriers, rewire comment in
  both style-table deletes). Suite now 40/40, eslint clean. Round 2 (reviewer-2411-r2): single P3 —
  lineweight + delete comment pins lacked exact per-variant occurrence
  counts. Remediated test-only (`countOccurrences === 1` in each intended
  variant); suite still 40/40, eslint clean. All production assertions
  from rounds 1-2 stand (verbatim leaves, minimal hub diff, intact order,
  arithmetic-only guard deltas).
- Exact-head CI: pending controller gate. DO NOT merge here; #241 stays OPEN.
