# STRUCT-195.1 — architecture

Branch: `refactor/issue1951-runtime-value-import-cycles`
Baseline: `ee5b2a31064dc180a3f9116512b3c5757f34ffeb`
Refs #195 / Part of #195 — issue #195 stays OPEN.
Severity: High (until #195 is fully closed).

## Scope

STRUCT-195.1 breaks two live runtime VALUE import SCCs (strongly connected
components) by extracting leaf-only shared helpers into surface Core and
block Common modules. The moves are byte-equivalent extractions: no behavior,
label, guard, ordering, or rounding change. Type-level cycles (135 remaining)
are explicitly out of scope and deferred to #195.2+.

Integrated Worker state on this branch (uncommitted, parent owns commit):

| Worker | Owned change | Status |
| --- | --- | --- |
| A (surface) | `cadTransactionsSurfaceCore.ts` (new) + `cadTransactionsSurfaceCommands.ts` + `cadTransactionsSurfaceBoundaryCommands.ts` | integrated, uncommitted |
| B (block) | `cadBlockUiCommon.ts` (new) + `cadBlockUiCommands.ts` + `cadBlockReferenceOps.ts` | integrated, uncommitted |
| Shared docs (this mission) | `TODO.md` entry + `docs/evidence/struct-1951/` | this file |

This docs mission modifies no `src/*`, `tests/*`, or `scripts/*` file.

## Cycle 1 — surface transactions (Worker A)

Modules (all under `src/engine/cad/`):

- C = `cadTransactionsSurfaceCommands.ts`
- B = `cadTransactionsSurfaceBoundaryCommands.ts`
- K = `cadTransactionsSurfaceCore.ts` (new leaf)

### BEFORE — live VALUE SCC {C, B}

| Edge | Kind | Symbol(s) |
| --- | --- | --- |
| C → B | value | `surfaceBoundaryCommandDefinitions` (registry spread) |
| B → C | value | `commitSurface`, `editSurface` |

Transitive closure (value edges only; `import type` erased at runtime):
`closure(C)` contained B and `closure(B)` contained C — a genuine 2-node
runtime cycle. Any module-load order evaluated one side's bindings before
the other's initialization completed (TDZ risk on the shared helpers).

### AFTER — acyclic (verified by docs-worker grep + test AST check)

| Edge | Kind | Symbol(s) |
| --- | --- | --- |
| C → B | value (retained) | `surfaceBoundaryCommandDefinitions` |
| C → K | value | `commitSurface`, `editSurface` |
| B → K | value | `commitSurface`, `editSurface` |
| K → `cadTransactionsLayerCommands` | value | `commitLayerProject` |
| K → `cadSurfaceTypes` | value | `isSurfaceLayerLocked` |
| K → `cadTypes` | value | `isNativeSurfaceDefinition` |
| K ⇢ `cadTransactions.types` | type-only | `CadCommand`, `CadCommandExecutionResult`, `CadWorkspaceSnapshot` |
| B ⇢ `cadTypes` | type-only | command/result/project types |

Verified properties (own grep of the three files' import blocks):

- No value edge B → C remains; `valueClosure(B)` does not contain C.
- `valueClosure(C)` still contains B (one direction only — not a cycle).
- K never imports a transaction command module (C, B, or the
  `cadTransactions` barrel); `valueClosure(K)` contains neither C nor B.
- No SCC remains in the surface value graph.

### Surface helper location + API exports

- `commitSurface` / `editSurface` / `NATIVE_SOURCE_MUTATION_KEYS` moved
  verbatim from C into K (`cadTransactionsSurfaceCore.ts`, ~100 lines).
  K's header documents the leaf contract: it must never import a
  transaction command module.
- `export { commitSurface }` re-export is RETAINED on C for
  design/bake/compose compatibility. Verified consumers still resolving
  through C (docs-worker grep):
  - `cadTransactionsDesignSurfaceCommands.ts`
  - `cadTransactionsSurfaceBakeCommands.ts`
  - `cadTransactionsSurfaceComposeCommands.ts`
  - `cadTransactions.ts` barrel
- K's `editSurface` keeps the exact guard order: missing surface → locked
  layer → non-native source-mutation rejection → null-mutation rejection →
  geometry-only cache invalidation (`cachedRevision`/`buildDiagnostic`).

## Cycle 2 — block UI commands (Worker B)

Modules (all under `src/cad-app/blocks/`):

- U = `cadBlockUiCommands.ts`
- R = `cadBlockReferenceOps.ts`
- M = `cadBlockUiCommon.ts` (new leaf)

### BEFORE — live VALUE SCC {U, R}

| Edge | Kind | Symbol(s) |
| --- | --- | --- |
| U → R | value | `applyBlockReferenceOp` (dispatch) |
| R → U | value | `blockFail` / `blockSiblingNames` (re-exported helpers) |

Transitive closure: `closure(U)` contained R and `closure(R)` contained U.
Evaluating R first hit a TDZ on the re-exported helper bindings.

### AFTER — acyclic (verified by docs-worker grep + test AST check)

| Edge | Kind | Symbol(s) |
| --- | --- | --- |
| U → R | value (retained) | `applyBlockReferenceOp` |
| U → M | value | `fail`, `siblingNames` |
| U → M | type-only | `CadBlockUiCommandKey` |
| R → M | value | `fail`, `siblingNames` |
| R ⇢ U | type-only | `CadBlockUiOp`, `CadBlockUiResult` |
| M ⇢ engine `cadTypes` | type-only | `CadEntityId`, `CadProject` |

Verified properties:

- M has ZERO value imports — pure leaf (only `import type`).
- No value edge R → U remains; the only R → U link is type-only (erased).
- No SCC remains in the block value graph.

### Block helper location + API exports

- `fail` / `siblingNames` / `CadBlockUiCommandKey` (+ `CadBlockUiFailure`
  interface) live in M (`cadBlockUiCommon.ts`, ~60 lines). Both U and R
  import the values from M; R's former value dependency on U is now
  type-only.
- The `export { fail as blockFail, siblingNames as blockSiblingNames }`
  re-export on U is REMOVED. Docs-worker grep confirms zero consumers:
  the only remaining `blockFail|blockSiblingNames` hits are the historical
  comment inside `tests/cad_block_value_cycle_1951.test.ts`.
- U's `CadBlockUiResult.commandKey` union is now the named alias
  `CadBlockUiCommandKey` with identical members — same envelope shape.

## Behavior parity statement

Both extractions are verbatim moves, confirmed by the integrated diff:

- Surface: the deleted `commitSurface` / `editSurface` /
  `NATIVE_SOURCE_MUTATION_KEYS` block in C is identical to K's content;
  the only other C change is the import source plus the compatibility
  re-export. B's only functional change is the import source
  (C → K) plus a comment noting value helpers come from the leaf core.
- Block: `siblingNames` / `fail` bodies are line-identical in M; U keeps
  `uniqueName`, the full op dispatch, and `commitBlockUiOp` untouched; R
  keeps `applyBlockReferenceOp` logic untouched (two import-source lines).
- No output wording, row inclusion, ordering, rounding, registry order,
  label, guard, or undo/history change in either cycle.
- Parity is pinned by the two new cycle tests (AST value-graph + behavior
  suites); see `validation.md`. Test execution and browser/CI are parent
  integration steps — no results are claimed here.

## Explicitly NOT fixed here

- The 135 type-level (`import type` / interface-only) cycles tracked under
  #195 remain untouched and are deferred to #195.2+.
- This mission makes NO claim of a full #195 fix. The PR for this branch
  must say `Refs #195` (never `Closes`/`Fixes #195`).
- Severity remains High until #195 is fully closed.

## Roadmap

- #195.2+: break the 135 remaining type-level cycles (type-only layering,
  barrel hygiene) — separate scope, separate evidence.
- Parent integration for 195.1: run `test:agent`, production build, and
  browser QA; exact-head CI is authoritative.
- No `scripts/testTiers.ts` change: the two new cycle tests are fast,
  deterministic, agent-tier suites by construction.

## File inventory (this mission)

- `docs/evidence/struct-1951/architecture.md` (this file)
- `docs/evidence/struct-1951/validation.md` (validation + pending steps)
- `TODO.md`: one STRUCT-195.1 entry + one-line #194.9 status truth fix
- `docs/evidence/struct-1949/validation.md`: stale-sentence truth fix only

Worker-owned code/tests (read for this evidence, not modified):

- `src/engine/cad/cadTransactionsSurfaceCore.ts` (new)
- `src/cad-app/blocks/cadBlockUiCommon.ts` (new)
- `tests/cad_surface_value_cycle_1951.test.ts` (new)
- `tests/cad_block_value_cycle_1951.test.ts` (new)
