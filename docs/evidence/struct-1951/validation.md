# STRUCT-195.1 — validation

Branch: `refactor/issue1951-runtime-value-import-cycles`
Baseline: `ee5b2a31064dc180a3f9116512b3c5757f34ffeb`
Refs #195 / Part of #195 — issue #195 stays OPEN; severity High.

## What this file covers

Docs-worker validation for the STRUCT-195.1 shared-docs mission: confirm the
integrated Worker A+B code state, record the exact BEFORE/AFTER value edges,
verify helper/API-export claims by grep, inventory the new cycle tests, and
record the integration outcome (PR #225 merged; 5/5 exact-head CI green).

## Code-state confirmation (docs worker, read-only)

| Check | Command / method | Result |
| --- | --- | --- |
| Diff stat | `git diff --stat` | 4 modified files, +13/−94 (behavior-preserving extraction shape) |
| Status | `git status --short` | 4× `M` (Worker A+B owned) + 4× `??` (2 core files, 2 cycle tests) |
| Branch | `git branch --show-current` | `refactor/issue1951-runtime-value-import-cycles` |
| Baseline | `git log --oneline` | head `ee5b2a31` (PR #224 merge), review head `62bd052e` |
| Core files read | headers + full bodies (`cadTransactionsSurfaceCore.ts`, `cadBlockUiCommon.ts`) | leaf contracts as documented |
| Cycle tests read | headers + graph sections (`cad_surface_value_cycle_1951.test.ts`, `cad_block_value_cycle_1951.test.ts`) | AST value-graph + parity suites |
| Cross-edit guard | no `src/*`, `tests/*`, `scripts/*`, stash, or config touched | clean |

## Import-graph verification (own grep, value vs type)

Surface (`src/engine/cad/`):

- `cadTransactionsSurfaceCommands.ts` value-imports Boundary
  (`surfaceBoundaryCommandDefinitions`) AND Core (`commitSurface`,
  `editSurface`); all other cross-module imports are `import type`.
- `cadTransactionsSurfaceBoundaryCommands.ts` value-imports Core only —
  the former `from './cadTransactionsSurfaceCommands'` value import is
  gone (confirmed in diff).
- `cadTransactionsSurfaceCore.ts` value-imports only
  `cadTransactionsLayerCommands`, `cadSurfaceTypes`, `cadTypes`; its
  `cadTransactions.types` import is `import type`.

Block (`src/cad-app/blocks/`):

- `cadBlockUiCommands.ts` value-imports `cadBlockReferenceOps`
  (`applyBlockReferenceOp`) and `cadBlockUiCommon` (`fail`,
  `siblingNames`); `CadBlockUiCommandKey` is a type import.
- `cadBlockReferenceOps.ts` value-imports `cadBlockUiCommon` only; its
  `cadBlockUiCommands` import is `import type` (op/result types).
- `cadBlockUiCommon.ts` has no value imports at all (`import type` only).

Re-export checks:

| Claim | Verification | Result |
| --- | --- | --- |
| `commitSurface` re-export retained on C | `export { commitSurface }` present in diff; 3 command modules + barrel still import from C | confirmed |
| `blockFail`/`blockSiblingNames` re-export removed | export line deleted in diff; grep for consumers hits only a test-file comment | confirmed, zero consumers |

## New cycle-test inventory (static, from file)

| Suite | Graph tests | Parity tests | Method |
| --- | --- | --- | --- |
| `tests/cad_surface_value_cycle_1951.test.ts` | 4 (no reciprocal/transitive value edge; core-leaf; type-only classification; boundary-first dynamic load) | 10 (labels/registry order, guards, boundaries, breaklines, cache invalidation, undo/redo, save/reopen) | TS-AST value graph + real engine builders |
| `tests/cad_block_value_cycle_1951.test.ts` | 3 (no value cycle; TDZ-free load both orders) | 7 (envelope shape, lifecycle, uniqueness, rejections, selection, undo/redo) | TS-AST value graph + real block ops |

Counts above are test cases present in the files (static inventory). The
suites ran green in the PR #225 exact-head CI (see Integration outcome).

### Surface suite — case list (static, from file)

Graph (`STRUCT-195.1 surface value-import graph`, 4):

1. `has no reciprocal or transitive value edge between commands and boundary`
2. `keeps the core a leaf: it never reaches either commands module`
3. `classifies type-only imports separately from value edges`
4. `loads boundary before commands without a TDZ cycle failure`

Parity (`STRUCT-195.1 surface helper behavior parity`, 10):

1. `keeps the boundary spread position and exact create/rename/delete labels`
2. `rejects null mutations and invalid edits without a history entry`
3. `blocks destructive edits on a locked surface layer`
4. `rejects native source mutations on imported topology but allows mesh edits`
5. `clears cachedRevision/buildDiagnostic on geometry edits only`
6. `adds/replaces outer and void boundaries and removes by kind`
7. `rejects malformed boundary candidates and non-ring sources`
8. `edits one dual-sourced breakline while preserving its sibling exactly`
9. `undo/redo round-trips a single surface edit entry`
10. `round-trips the definition through WNCAD save/reopen`

### Block suite — case list (static, from file)

Graph (`block UI/reference value graph`, 3):

1. `has no runtime value cycle between UI commands and reference ops`
2. `evaluates reference ops before UI commands without a TDZ`
3. `evaluates UI commands before reference ops without a TDZ`

Parity (`block UI/reference behavior parity`, 7):

1. `fails with the exact envelope shape and leaves project/history untouched`
2. `covers seed/create/duplicate/rename/redefine lifecycle`
3. `enforces case-insensitive sibling uniqueness and exceptId filtering`
4. `rejects invalid coordinates, scales, missing refs, and locked entities`
5. `rejects expansion-invalid circle ops without mutation`
6. `reports afterSelectionIds and converges commitBlockUiOp selection`
7. `undoes and redoes one committed op`

Total static inventory: 24 test cases across 2 files.

## Behavior parity checklist (diff-verified, byte-equivalent moves)

- [x] Surface `commitSurface`/`editSurface`/`NATIVE_SOURCE_MUTATION_KEYS`
  identical between deleted C block and new K (diff-verified).
- [x] Surface registry spread position and boundary/breakline/geometry/
  undo/save semantics unchanged (C keeps all command definitions).
- [x] Block `fail`/`siblingNames` bodies line-identical in M; `uniqueName`,
  op dispatch, and `commitBlockUiOp` untouched in U.
- [x] Block `commandKey` union members identical under the
  `CadBlockUiCommandKey` alias; result envelope shape unchanged.
- [x] No wording, ordering, rounding, registry-order, or history change.

## Portable paths

`npm run check:portable-paths` run by the docs worker after creating the
two new evidence files — clean, 0 violations (new paths use only
portable lowercase-hyphen names under `docs/evidence/struct-1951/`).

## Integration outcome — PR #225 (merged)

- PR #225 merged to `main` (`STRUCT-195.1: eliminate CAD surface and block
  runtime import cycles`).
- Review head: `2b6616a4957122caf08b775a59dbf7d7448ab38c`.
- Merge commit on `main`: `4796e0ba9da43934e3bba66623c0e58fc0e2e13c`.
- Exact-head CI: 5/5 checks green (the five stable CI jobs: `classify`,
  `static`, `tests`, `build-smoke`, `numerical`).
- Browser QA was NOT performed for this change and no browser numbers are
  claimed: the extraction is a byte-equivalent structural split with no
  user-facing behavior change.
- Commit/push/PR completed. The PR said `Refs #195` (issue #195 stays OPEN;
  135 type cycles deferred to #195.2+).

## Honest limitations

- BEFORE edges are reconstructed from the integrated diff (removed import
  lines) plus the cycle-test headers — not from a pre-change full AST run.
- AFTER edges are confirmed by direct grep of the current import blocks
  and corroborated by the tests' TS-AST graph assertions (static here; the
  suites ran green in PR #225 exact-head CI).
- No `test:wasm`, `parity:industry-reference`, `test:evidence`, or
  `test:full` campaign: engine structural split with byte-equivalent moves,
  no math/worker-protocol/parity change.
- No `scripts/testTiers.ts` change: both new suites are fast,
  deterministic, agent-tier by construction.

## Acceptance mapping

- TODO STRUCT-195.1 entry + #194.9 one-line truth fix — done.
- `docs/evidence/struct-1949/validation.md` stale-sentence fix — done
  (PR #224 merged at `ee5b2a31`, review head `62bd052e`, 5/5 exact-head
  CI green, issue #194 closed as completed).
- Two new evidence files, small and accurate, no invented CI/browser
  numbers — this file + `architecture.md`.
- Portable-paths clean; no cross-edits outside the four allowed paths.
