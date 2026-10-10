# STRUCT-195.14 — validation

## Baseline provenance (parent-measured, exact origin/main)

- `git fetch origin --prune`; `origin/main = c7987ebc21d05ab2c92dd999200350b1360217e2`
  (PR #237 merge). Worktree clean, 14 pre-existing user stashes untouched,
  branch `refactor/issue19514-geometry-primitives-runtime-cycle` from exact main.
- Pre-work graph (scope cad+fieldToFinish): nodes 482, edges 2400,
  value|mixed 1584, pairs 1566, SHA
  `76838237ec49987ae9c64b11b97a3d72537b2fda2b806b1bcf73a4a22e1300f0`,
  VALUE 1 SCC/7 (geometry septet), TYPE 0. Matches the 195.13 golden exactly.

## Post-integration graph (parent-measured, same canonicalization)

- nodes 483, edges 2400, value|mixed 1585, pairs 1567, SHA
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`,
  VALUE 0 SCC/0 nodes, TYPE 0/0. All eight geometry modules singleton;
  Primitives has zero VALUE out-edges.
- Exact multiset delta: 6 removed + 6 added, all allowlisted (see
  architecture.md). No other edge in the tracked scope changed.
- `git diff --check` clean. New-core bytes SHA256 `d7167ba2…` equals the
  genuine baseline tail (`git show HEAD:cadGeometry.ts | tail -n +6`).

## Tests (all parent-run on this branch)

- NEW `tests/cad_geometry_primitives_runtime_cycle_19514.test.ts`: 34/34
  (API + identity, body SHA, 5 cold-load orders, 0/0 graph + golden +
  6+6 delta + static guards + negative/mutation controls, full numeric
  oracles, no-mutation).
- Rolled guards: 1954, 1957, 1958, 1959, 19510, 19511 (+ new 195.14
  cumulative allowlist), 19512, 19513 — combined 9-file run: 259/259.
- Focused neighbors (11 files): 243/243 — circle snap, cadCogo 01/02/03,
  parcel curved core/outputs, polyline bulge c2 core/consumers, vertex
  topology, vertex grips, feature-line geometry.
- `npx tsc --noEmit`: clean. ESLint on all touched files: clean.
- `npm run build`: clean (12.16s). `npm run check:portable-paths`: 6341/0.
- `npm run test:agent`: 1042 files passed, 10103 tests passed + 1 skipped, 3 failed —
  all three are the pre-existing study-desktop gitignored real-data
  calibration/preflight failures (identical trio as prior phases; no geometry
  involvement, unrelated). Exact-head CI is authoritative.
- Study Desktop gitignored real-data files preserved (their 3 historical
  local failures are pre-existing, unrelated). No ribbon changes (known
  intermittent scroll flake untouched).

## Reviewer

- Independent read-only review by `openai-codex/gpt-6-sol` on the exact final
  diff: APPROVE (no actionable findings; primitive body byte-identical,
  leaves specifier-only, graph/negative controls consistent, frozen 19511
  guard untouched, 14 stashes intact).

## PR

- ONE PR against verified `origin/main` (base `c7987ebc`): title
  `STRUCT-195.14: eliminate final CAD geometry import cycle`, body reports
  base/head, SCC 1/7 → 0/0, TYPE 0, edge multiset + digests, API/behavior
  oracles, CI status, reviewer, limitations, `Refs #195` ONLY. Never merged
  here; #195 stays OPEN for controller closeout.
