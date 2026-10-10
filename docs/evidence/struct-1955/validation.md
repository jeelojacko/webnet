# STRUCT-195.5 — validation (test + evidence worker)

Branch: `refactor/issue1955-profile-section-command-type-leaves`
Baseline: `origin/main` `7127c5f4430c1483a4cf1279085aed3e887a1f8f`
Refs #195 — issue #195 stays OPEN.

## Scope (this worker)

Only three new files; no source file was edited here. The hub splice and
both leaves are parent-owned (landed, recorded but not modified here):

| File | Change (landed, not modified here) |
| --- | --- |
| `src/engine/cad/cadTransactionsProfileCommandTypes.ts` (new, 121 lines) | `CadProfileCommandPayload` (11 variants) + `CadProfileViewUpdatePatch` |
| `src/engine/cad/cadTransactionsSectionCommandTypes.ts` (new, 155 lines) | `CadSectionCommandPayload` (17 variants) + `CadSectionViewDeleteCommand`; LANDXML stays in hub |
| `src/engine/cad/cadTransactions.types.ts` (modified) | hub splice: leaf imports, union member order, `CadProfileViewUpdatePatch` re-export; `CadCommandKey` unchanged |
| `tests/cad_profile_section_command_types_1955.test.ts` (new, this worker) | 20 tests: key sets/order, per-key `Extract<>` equivalence, hub order, dual-path patch, type-only leaves, no back-edge, and 60 hand-transcribed independent baseline assertions (22 profile + 36 section incl. split delete + 2 patch) |
| `docs/evidence/struct-1955/{architecture,validation}.md` (new, this worker) | this evidence pair |

## Current: review-correction round 2 (docs-only)

Reviewer P3 flagged that this evidence still described an 18-test suite
after the baseline-pin correction
(`tests/cad_profile_section_command_types_1955.test.ts` lines 667–745)
added 60 independent baseline assertions. Fresh re-run of the suite in the
current tree:

```
 RUN  v4.1.11 /home/jacko/Code/webnet

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  23:41:55
   Duration  2.32s (transform 110ms, setup 22ms, import 2.18s, tests 40ms, environment 0ms)
```

The suite is **20/20 green**. The added tests are the `describe` blocks
"independent baseline pins: profile payloads" and "independent baseline
pins: section payloads" (the pre-existing `it.each` already counts as two
rows). The `Base*` object-literal shapes are transcribed **by hand** from
the pre-refactor hub
(`git show 7127c5f4:src/engine/cad/cadTransactions.types.ts`), import no
type from either leaf under test, and are compared against both
`Extract<CadCommand, { key }>` and the matching leaf `Extract`, so a
drifted leaf can no longer move both sides of an assertion and stay green.
Those pins are type-level, so their enforcement surface is
`npm run typecheck` — **not** vitest alone.

Negative controls (from the correction round; leaves mutated and then
reverted, not re-run in this docs-only round):

- Mutation 1 — drop `| null` from `PROFILE_REBUILD.styleId` in the profile
  leaf → `npm run typecheck` **exit 2**, failing at the baseline pins.
- Mutation 2 — drop `?` from `SAMPLE_GROUP_CREATE.layerId` in the section
  leaf → `npm run typecheck` **exit 2**.
- Green after revert: `npm run typecheck` exit 0 and the suite 20/20.

Fresh neighbour re-run with the grown suite: **159/159 passed** across the
same 13 files (pre-correction was 157/157 with 18 tests). Re-verified in
the current tree: `npm run typecheck` exit 0, `npx eslint
tests/cad_profile_section_command_types_1955.test.ts` exit 0,
`npm run check:portable-paths` 6300 tracked paths / 0 violations. The
graph figures below are unchanged because they measure `src/engine/cad` +
`src/engine/fieldToFinish` and no source file changed in this round.

## Pre-correction record (round 1, historical)

- `tests/cad_profile_section_command_types_1955.test.ts` — **18/18 passed**.
- Profile/section/transaction neighbour batch (13 files: the new suite +
  profile transactions/extraction/revision/cache, sections engine/revision,
  LANDXML civil 18l, surface + volume 1953 suites, parcel 1954 suite, 1952
  graph + primitive suites) — **157/157 passed**.
- `npm run typecheck` (`tsc --noEmit`) — exit 0. (One self-inflicted
  failure during iteration: `importClause.name.isTypeOnly` does not exist
  on `Identifier` in this TS version; fixed by treating any default import
  binding as a value import. No source or hub change involved.)
- `npx eslint tests/cad_profile_section_command_types_1955.test.ts` —
  exit 0.
- `npm run check:portable-paths` — 6300 tracked paths, **0 violations**.
  (Caveat: the script scans tracked paths, so the three new files are
  covered only after staging; their names were chosen portable by
  construction — lowercase, no reserved basenames, no forbidden chars —
  and were re-checked clean at the end of the session.)
- Graph re-measurement (`scripts/cadTypeImportGraph.mjs`, cad +
  fieldToFinish scope) — nodes 471, edges 2367, unresolved 94, value 4
  SCC / 18 nodes, type 7 SCC / 19 nodes largest 5; matches the
  parent-verified AFTER figures recorded in `architecture.md`. SCC member
  lists were read from this live measurement.

## Test-tier classification

No `scripts/testTiers.ts` change. Per `tests/AGENTS.md` / `docs/TEST_TIERS.md`
the decision tree is semantic: the new suite is a fast (~2.5 s) unit-scope
contract test — no stress, evidence, repeated real-WASM, browser, or
performance campaign — so it joins the agent tier by default. The manifest
test needs no update (no suspicious campaign-like basename, no new tier).

## Not run (honest status)

- `npm run test:agent` (full) — parent integration owns the pre-PR run;
  not run here, nothing claimed.
- Production `npm run build`, browser QA, exact-head CI — parent owns;
  PENDING parent integration, not claimed here.
- BEFORE-graph figures are parent-measured and recorded as such; only the
  AFTER figures were re-measured by this worker.
- This phase does not finish #195: grading payloads, the `cadTypes`
  4-node annotation/cogo hub, and the export-scene SCC remain open (see
  architecture roadmap).

## No runtime-graph regression

Value edges identical before/after (1579 including mixed, 0 added /
0 removed). Both new leaves emit only `type` edges (pinned by the suite)
and introduce no value SCC.

## Acceptance mapping

- Profile (11) + section (17 + split delete) payloads extracted in exact
  union order with verbatim field semantics — per-key `Extract<>`
  equality (29 keys) plus required-field probes, typecheck-enforced.
- Public API safety (`CadCommandKey` unchanged, hub union adjacency,
  dual-path patch identity) — AST + `expectTypeOf` suites.
- Type graph stable with zero value-graph change (+7 type edges are the
  leaf wiring; type SCC 7/19 largest 5 unchanged, honestly no reduction).
- Source, scripts, `TODO.md`, and tier manifest untouched by this worker;
  `TODO.md`/`README.md` updates (if any) belong to parent integration.
