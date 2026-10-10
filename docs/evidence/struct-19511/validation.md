# STRUCT-195.11 — Validation

## Baseline (origin/main 78a71ca4, scope cad+fieldToFinish)

nodes 480, edges 2392, value|mixed 1579, unique value pairs 1561,
SHA `2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f`;
TYPE 1 SCC/2, VALUE 4 SCC/18. Local checkout clean, 14 pre-existing stashes
untouched (still 14, verified at PR time), no force-push, no other repos.

## After

nodes 481, edges 2393, value|mixed 1580, unique pairs 1562,
SHA `3d7284dbb0d33d8ba7afaad3dc2c0a7136945e98910ac026eebd03c0fbdc835e`;
TYPE **0** SCCs; VALUE **3 SCCs/16 nodes** (geometry 7, cogo-arc 5,
parcel-diagnostics 4 — all pre-existing, unrelated).

## Work split

- Worker A (`commandcode/deepseek/deepseek-v4.1-flash`): kernel split,
  src-only. tsc 0, 6 focused 18R/18R.1 suites 40/40, portable-paths 0/6329.
- Worker B, attempt 1 (`opencode-go/deepseek-v4.1-flash`): INFRA failure —
  403 "active OpenCode Go subscription required"; no result. Retried on
  `commandcode/deepseek/deepseek-v4.1-flash` (rotation deviation forced by
  broken provider path; same model family, medium reasoning). Worker B
  (retry): verified frozen fixture, wrote 23-test suite — tsc 0, 23/23,
  40/40 focused, portable-paths 0/6329, tier manifest 11/11.
- Worker B left behind `tests/cad_project_transform_runtime_delta_19511.guard.ts`
  (704 lines, 48 KB generated frozen baseline: 480 nodes + 2392 edge triples
  at 78a71ca4). Verified: decodes to exact baseline counts, canonical SHA
  `2bf1817d…`, contains old Transform<->Request edges, no Core node.
  Reviewed and kept as provenance for the authorized delta (not counted as
  coverage; coverage stays in `.test.ts` files).
- Worker B caught a parent error: TODO first recorded baseline SHA
  `469bb78f…` (wrong canonicalization from a quick parent hash); actual
  guard-canonical SHA is `2bf1817d…`. TODO corrected.

## Parent-owned integration

- Core move verified byte-exact (`git show HEAD:` + `sed '97,105d'` diff =
  only the 9-line block + header).
- Graph claims re-measured independently (parent node script): exact match.
- Emit parity (identical esbuild settings): kernel bodies/constants
  identical modulo the relocated 2 request re-exports; request emit
  identical modulo import specifier.
- 5 historical guards rolled forward (1954, 1957, 1958, 1959, 19510) (7 failing tests -> 0): value golden
  1561/1579/`2bf18…` -> 1562/1580/`3d7284d…` with explicit 195.11
  roll-forward comments + frozen-fixture reference; TYPE pins -> ZERO
  (1959 cumulative, 19510 pair-dissolved + new facade/core/request
  singleton test). All leaf/payload/purity/no-backedge/negative-control
  assertions untouched.
- 5 suites green: 1957 (27) + 1958 (27) + 1959 (35) + 19510 (41) + 19511 (23) = **153 tests** (vitest run below re-confirms).

## Test results (parent-run, exact)

- `npx vitest run` 8 graph suites: **8 passed, 193 passed** (1957/1958/1959/19510/19511/1954/1951/1952).
- `npx tsc --noEmit`: exit 0 (workers + parent guards edit -> LSP clean).
- `npm run check:portable-paths`: 0 violations / 6329 paths.
- `npm run test:agent` FINAL (post-integration, pre-PR): **1039 passed files
  / 10016 passed tests + 1 skip; 3 failed = ONLY the pre-existing
  study-desktop real-data fails** (gitignored calibration/preflight
  fixtures present locally; absent on fresh/CI checkout where they skip;
  unrelated code untouched).
- `npm run build`: clean, 14.45s (chunk-size warnings only, pre-existing).
- `tests-browser/cad-project-transform-18r1.spec.ts` (Chromium): **5/5 pass**.
- Known env caveat: gitignored Study Desktop calibration/preflight fixtures
  can cause unrelated local failures; untouched, GitHub exact-head CI
  adjudicates.

## Review / PR

- Independent reviewer (`openai-codex/gpt-6-sol` per routing): APPROVE on
  integrated implementation diff (reported in PR handoff). Controller independently
  verified the moved kernel and request body against exact baseline.
- PR: `refactor/issue19511-project-transform-runtime-cycle`, title
  'STRUCT-195.11: break project-transform runtime and type cycle',
  'Refs #195' only. DO NOT merge; issue #195 stays OPEN.


## Controller CI review correction (after original PR)

- Initial exact-head GitHub Actions run 38054533047: classify, static,
  build-smoke and numerical passed; agent tests reported 9985 pass, 34 skipped,
  **one 5-second timeout** on the first cold graph calculation in
  `tests/cad_project_transform_runtime_cycle_19511.test.ts:320`.
  The SCC assertion did not return an incorrect graph result; this was a
  full-suite load/test timeout, not evidence of a CAD behavioral regression.
- Controller increased ONLY that cold-graph Vitest test's timeout to 30s,
  keeping the graph construction, SCC assertion and all other tests unchanged.
- GitHub CI must pass on the corrected final PR head before merge.
