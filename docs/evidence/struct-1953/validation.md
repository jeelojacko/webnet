# STRUCT-195.3 — validation (Worker C, docs-only)

Branch: `refactor/issue1953-cad-surface-volume-command-types`
Baseline: `origin/main` `706ab3ff9ec8a172aad2e4e17492d78d2274c329`
Refs #195 — issue #195 stays OPEN.

## Scope (Worker C)

Docs-only: one `TODO.md` entry, phase-end closeout notes in
`docs/evidence/struct-1952/{architecture,validation}.md`, and these
`docs/evidence/struct-1953/{architecture,validation}.md` files. No source,
test, or script file was edited here. Workers A+B own the landed code:

| File | Change (landed, not modified here) |
| --- | --- |
| `src/engine/cad/cadTransactionsSurfaceCommandTypes.ts` (new, 295 lines) | `CadSurfaceCommandPayload`, 34 variants |
| `src/engine/cad/cadTransactionsVolumeCommandTypes.ts` (new, 70 lines) | `CadVolumeCommandPayload`, 9 variants |
| `src/engine/cad/cadTransactions.types.ts` (2048→1727) | hub splice: `+2` comment `+2` imports `+2` union members; `CadCommandKey` unchanged |
| `tests/cad_surface_command_payload_1953.test.ts` (new, 406 lines) | 15 tests: leaf structure, assignability, shapes |
| `tests/cad_volume_command_payload_1953.test.ts` (new, 220 lines) | 10 tests: leaf structure, assignability, shapes |

## Validation actually run (worker-recorded)

- `tests/cad_surface_command_payload_1953.test.ts` — **15/15 passed**.
- `tests/cad_volume_command_payload_1953.test.ts` — **10/10 passed**;
  volume neighbours — **7 files / 62 tests passed**.
- Focused batch — **15 files / 213 tests passed**.
- 1952 graph + primitive suites — **13/13 passed** (no regression).
- `tsc` — exit 0; `eslint` — clean; LSP — clean.
- `npm run check:portable-paths` — **6288 tracked paths, 0 violations**
  (re-verified here for the new docs paths; see below).

## Not run (honest status)

- `npm run test:agent` — parent integration owns the pre-PR run; not run
  here, nothing claimed.
- Production `npm run build`, browser QA, exact-head CI — parent owns;
  PR pending parent, not claimed here.
- This phase does not finish #195: remaining `CadCommand` families and the
  `cadTypes` core SCCs are still open (see architecture roadmap).

## Acceptance mapping

- 43 payload members extracted in exact union order (30 `SURFACE_*` +
  `SURFBAKE`/`SURFBAKECOPY`/`SURFCOMPOSE`/`SURFCOMPOSEPASTE` + 9
  `VOLUME_SURFACE_*`/`VOLUME_STYLE_*`) — hub diff + leaf `key:` sequence.
- Verbatim field semantics (optionality/readonly/comments/field order,
  union order) — member-by-member preservation, pinned by shape tests.
- Public API safety (`CadCommandKey` identical, `Extract<>` narrowing,
  both-direction assignability) — `expectTypeOf` suites, typecheck-enforced.
- No value-graph regression (4 SCCs/18 nodes, leaves value-edgeless) and
  no type-graph change (8 SCCs/28 nodes, 93 unresolved both runs).
- 14 pre-existing stashes preserved; stashes, `.pi/lsp.json`, source,
  tests, and scripts untouched by this worker.
- `TODO.md` entry uses only "Refs #195"; #195 stays open with severity
  High until fully closed.
