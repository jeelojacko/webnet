# STRUCT-195.2 — validation (Worker B)

Branch: `refactor/issue1952-cad-core-type-foundations`
Baseline: `origin/main` `4796e0ba9da43934e3bba66623c0e58fc0e2e13c`
Refs #195 / Part of #195 — issue #195 stays OPEN.

## Scope (Worker B)

Two type-only leaves plus one narrow import re-point:

| File | Change |
| --- | --- |
| `src/engine/fieldToFinish/fieldToFinishLinkTypes.ts` (new) | `FieldToFinishSourceKind`, `FieldToFinishSyncStatus`, `FieldToFinishLink` |
| `src/engine/fieldToFinish/linkedSync.ts` | type import + `export type` re-export of the three types |
| `src/engine/cad/cadSelectionTypes.ts` (new) | `CadSelectionState` |
| `src/engine/cad/cadSelection.ts` | type import + `export type` re-export of `CadSelectionState` |
| `src/engine/cad/cadTransactions.types.ts` | line 1 import re-pointed to the selection leaf (1-line diff) |
| `tests/cad_f2f_link_selection_types_1952.test.ts` (new) | AST + type + behavior suite |
| `docs/evidence/struct-1952/validation.md` (this file) | evidence |

Worker A owns `cadCorePrimitiveTypes.ts`, `cadTypes.ts`, `cadDisplayTypes.ts`,
`cadDraftTypes.ts`, `scripts/cadTypeImportGraph.*`,
`tests/cad_type_dependency_graph_1952.test.ts`, and
`docs/evidence/struct-1952/architecture.md`; none of those were edited here.
`CadEntityId` is imported from Worker A's zero-import core leaf.

## Moved definitions

`fieldToFinishLinkTypes.ts` has **zero imports** and carries the former
module doc plus the field docs (catalogRevision Phase 18E; sourceRevision
authoritative adjustment-result fingerprint vs legacy
`<inputFingerprint>:<settingsFingerprint>` composite, fail-closed). The
extracted block is byte-identical (modulo the trailing newline) to the former
`linkedSync.ts` definitions — diffed against
`git show HEAD:src/engine/fieldToFinish/linkedSync.ts`.

`cadSelectionTypes.ts` has a single **type-only** import
(`import type { CadEntityId } from './cadCorePrimitiveTypes'`) and exports
`CadSelectionState { selectedEntityIds: CadEntityId[] }`; it declares no
runtime values.

## Re-export contract

- `linkedSync.ts`: `import type { FieldToFinishLink, FieldToFinishSourceKind,
  FieldToFinishSyncStatus } from './fieldToFinishLinkTypes'` for internal use
  plus `export type { ... } from './fieldToFinishLinkTypes'` for backward
  compatibility. Every executable function (`buildSourceRevision`,
  `cloneFieldToFinishLink`, `buildFieldToFinishLink`, `computeSyncStatus`,
  `classifyCatalogChange`, the stamp/link helpers, `buildStationEntityIndex`)
  is unchanged.
- `cadSelection.ts`: `import type { CadSelectionState } from
  './cadSelectionTypes'` plus `export type { CadSelectionState } from
  './cadSelectionTypes'`. All selection functions are byte-identical.
- `cadTransactions.types.ts`: `CadSelectionState` now resolves to
  `./cadSelectionTypes`; nothing else in the 2,000+ line command union moved.

## AST import-graph edge changes owned here

| Before | After | Kind |
| --- | --- | --- |
| `cadTypes.ts` → `../fieldToFinish/linkedSync` (`FieldToFinishLink`) | `cadTypes.ts` → `../fieldToFinish/fieldToFinishLinkTypes` | type-only |
| `cadTransactions.types.ts` → `./cadSelection` (`CadSelectionState`) | `cadTransactions.types.ts` → `./cadSelectionTypes` | type-only |
| `linkedSync.ts` → local type declarations | `linkedSync.ts` → `./fieldToFinishLinkTypes` | type-only |
| `cadSelection.ts` → local interface | `cadSelection.ts` → `./cadSelectionTypes` | type-only |

Both new leaves have no outgoing value edges (asserted by the new suite's
TS-AST `runtimeImportSpecifiers` check); `cadSelectionTypes`' only outgoing
edge is the type-only core-leaf import.

## Validation actually run

While editing:

- Pi LSP diagnostics on all six touched/created files: **no diagnostics**
  (one transient `ImportClause.isTypeOnly` deprecation hint in the test was
  fixed before finishing; final LSP clean).

Focused / affected suites (`npx vitest run …`):

- `tests/cad_f2f_link_selection_types_1952.test.ts` — **1 file / 18 tests
  passed**.
- F2F link/catalog/regen/golden/stale/sync + selection + `cadCommandHistory`
  + the two #195.1 cycle suites — **28 files / 222 tests passed**.
- #183/#184/#185/#186/#191/#194 neighbour suites — **31 files / 276 tests
  passed**.

Static:

- `npm run check:portable-paths` — **6278 tracked paths, 0 violations**.

Build:

- `npm run build` (`vite build`) — **succeeded**.

## Not run (honest status)

- `npm run test:agent` — parent integration owns the pre-PR run; not run here.
- `npm run test:wasm`, `npm run test:evidence`,
  `parity:industry-reference`, `npm run test:full` — out of scope for a
  type-only extraction; not run.
- Manual `lint` / `typecheck` — Husky/CI owns; LSP diagnostics used while
  editing.
- Browser QA — **not performed**; this change is type-only with no UI,
  rendering, or selection-behavior change, and no browser numbers are claimed.

## Integration note (combined working tree)

`tests/cad_type_dependency_graph_1952.test.ts` (Worker A) was also run to
confirm the combined edge severances. Its
`cadTransactions.types -> cadSelectionTypes` and re-export assertions pass,
and the `cadDraftTypes.ts` runtime-dependency check — `parseImports`
asserting the `../id` and `./cadStyles` `value` edges — passes. The earlier
transient flag about the draft-to-id graph edge is resolved; no failure
remains in that suite from this run. That coverage concerns Worker A's
display/draft primitive re-point and graph tooling, not Worker B's files;
recorded here for honest cross-scope visibility. Worker A owns it.

## Limitations

- The leaves' payload is erased at runtime; `expectTypeOf` assignability and
  "legacy import path still compiles" are compile-time contracts validated by
  LSP here and by Husky/CI typecheck, not by a standalone `tsc` run in this
  mission.
- Integration depends on Worker A's `cadCorePrimitiveTypes.ts` and the
  `cadTypes.ts` re-exports landing in the same PR; the focused suites above ran
  against the combined working tree (Worker A's files present).
- The old `linkedSync.ts` / `cadSelection.ts` re-exports are intentionally
  retained indefinitely as the backward-compatible surface.

## Also fixed

`docs/evidence/struct-1951/{architecture,validation}.md` final-status lines
were corrected to the merged truth: PR #225, review head
`2b6616a4957122caf08b775a59dbf7d7448ab38c`, merge commit
`4796e0ba9da43934e3bba66623c0e58fc0e2e13c`, 5/5 exact-head CI green. The
original docs-worker limited-visibility caveats and the "no browser numbers"
statement were preserved; issue #194 stays closed.

## Roadmap

- #195.3: continue breaking the remaining type-level cycles (barrel hygiene,
  further leaf extraction) — separate scope and evidence.

## Acceptance mapping

- Both leaves zero runtime imports — AST test + LSP.
- Legacy import paths compile via type re-exports — `export type` statements,
  `expectTypeOf` mutual assignability, LSP clean.
- No schema/JSON/behavior change — F2F status/fingerprint/clone and selection
  order/toggle/history suites green.
- F2F legacy fidelity — byte-identical extraction; legacy composite vs result
  fingerprint reads `COORDINATES_CHANGED`, empty revision never does.
- Selection semantics untouched — normalization/order/toggle/history pinned.
- Transactions file diff is a 1-line import change — verified by `git diff`.

## Phase-end closeout (parent-recorded, 195.2 merged)

PR #226 merged: reviewed head `c19dc6d4e6450859da15e7ee5a37372b965887c3`,
main merge SHA `706ab3ff9ec8a172aad2e4e17492d78d2274c329`. Exact-head GitHub
CI all 5 jobs green; Chromium 3/3 per the merged PR record. The "Not run
(honest status)" section above stays the true worker-local record
(Worker-B-local: test:agent/build/browser/CI pending at the time of
writing); this note is the parent-recorded phase closeout, not a claim
that the workers ran CI. Refs #195 — issue #195 stays OPEN.
