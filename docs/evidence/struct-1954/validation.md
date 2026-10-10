# STRUCT-195.4 — validation (Worker C, docs-only)

Branch: `refactor/issue1954-f2f-parcel-command-type-feedback`
Baseline: `origin/main` `1987a6b801eaeda6c952c538b38c67f2d6a82ac0`
Refs #195 — issue #195 stays OPEN.

## Scope (Worker C)

Docs-only: one `TODO.md` entry, phase-end closeout notes in
`docs/evidence/struct-1953/{architecture,validation}.md`, and these
`docs/evidence/struct-1954/{architecture,validation}.md` files. No source,
test, or script file was edited here. Workers A+B own the landed code:

| File | Change (landed, not modified here) |
| --- | --- |
| `src/engine/fieldToFinish/fieldToFinishGenerationTypes.ts` (new, 75 lines) | `FieldToFinishEntityState` / `FieldToFinishProvenance` / `FieldToFinishCadPayload` / `LinkOfPayloadSource`; `generatedBy` literal `'FIELD_TO_FINISH'` |
| `src/engine/cad/cadTransactionsParcelCommandTypes.ts` (new, 74 lines) | 7 parcel interfaces in exact union order + `ParcelSharedEditEdit` |
| `src/engine/cad/cadTransactions.types.ts` (+ parcel plan/link/network/shared-edit, F2F `cadGeneration`/`linkedSync` re-exports) | hub splice: import-block only; `CadCommandKey` unchanged |
| `tests/cad_f2f_generation_types_1954.test.ts` (new) | 19 tests: leaf structure, literal equality, assignability |
| `tests/cad_parcel_command_payload_1954.test.ts` (new) | 16 tests: leaf structure, assignability, shapes |

## Fidelity (parent-verified, recorded here)

Parent diff-verified byte-identical extraction to baseline for all 7
parcel interfaces, `ParcelSharedEditEdit`, `FieldToFinishCadPayload`, and
`LinkOfPayloadSource`. `FieldToFinishProvenance` differs ONLY in
`generatedBy` (`typeof FIELD_TO_FINISH_GENERATOR` → `'FIELD_TO_FINISH'`
literal), with exact type equality pinned by the new suites
(`expectTypeOf`, typecheck-enforced).

## Validation actually run (parent-run, recorded honestly)

- `tests/cad_f2f_generation_types_1954.test.ts` — **19/19 passed**.
- `tests/cad_parcel_command_payload_1954.test.ts` — **16/16 passed**.
- Key 8-file batch (1954 new + 1952 graph/primitive + 1953
  surface/volume + 1951 value cycles) — **97/97 passed**.
- F2F/parcel/transaction neighbours — **16 files / 163 tests passed** +
  **6 files / 78 tests passed**.
- `tsc --noEmit` — exit 0.

## Not run (honest status)

- `npm run test:agent` — parent integration owns the pre-PR run; not run
  here, nothing claimed.
- Production `npm run build`, browser QA, exact-head CI — parent owns;
  PENDING parent integration, not claimed here.
- This phase does not finish #195: profile/section/grading payloads, the
  `cadTypes` 4-node annotation/cogo hub, and any remaining type SCC
  remnants are still open (see architecture roadmap).

## No runtime-graph regression

Value graph identical before/after (4 SCCs / 18 nodes; 1561 value edges,
0 added / 0 removed). Both new leaves introduce no value SCC; the
dissolved 9-node cluster was type-edges only.

## Acceptance mapping

- Parcel + F2F payload types extracted in exact union order with verbatim
  field semantics — hub diff + leaf member sequence.
- Public API safety (`CadCommandKey` unchanged, `Extract<>` narrowing,
  both-direction assignability, `generatedBy` literal equality) —
  `expectTypeOf` suites, typecheck-enforced.
- Type graph improved (8 SCCs/28 nodes/largest 9 → 7 SCCs/19 nodes/
  largest 5) with zero value-graph change; +1 unresolved is the
  scope-external `../resultIntegrity` specifier, not a regression.
- 14 pre-existing stashes preserved; stashes, `.pi/lsp.json`, provider
  settings, source, tests, and scripts untouched by this worker.
- `TODO.md` entry uses only "Refs #195"; #195 stays open.
