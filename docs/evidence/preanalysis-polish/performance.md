# Performance / solve-count evidence (Wave C)

Tests/evidence only (`tests/evidence/phase9k_planning_solve_instrumentation.test.ts`,
registered as `phase9k`). Zero production-math change. A run-local memo
(`scenarioCache` in `preanalysisPlanningCore`) already existed; no new cache.

## Camp traverse fixture
- 17/17 solves before/after (1 main + 16 planning) — only progress metadata changed.
- Session wall ~660 ms; main 96 ms; planning stage 451 ms; 48 planning progress
  events for 16 checks.
- Default threshold: 16 recommendation calls, 0 threshold solves (early exit),
  16 unique signatures, 0 duplicates → each candidate solved exactly once;
  the count is legitimate planning work, not redundant iteration.

## Tight-threshold rebuild (forces greedy path)
- 96 requests (16 rec + 80 threshold over 5 steps), 16 cache hits:
  80 vs 96 uncached solves — memo avoids 16 recomputes.
- Cached vs uncached planning diagnostics byte-equal; run-to-run final-result
  deterministic.

## Honest limit
No wall-time speedup claimed for the default path (nothing redundant to cut).
