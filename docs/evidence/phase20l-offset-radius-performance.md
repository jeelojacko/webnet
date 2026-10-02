# Phase 20L — Offset-Radius Performance (measurements only)

Study harness `scripts/phase20lOffsetRadiusPerf.ts`. Full mode: 15 reps,
median. No thresholds, no gates — consolidation only. Machine-dependent;
re-run to compare.

## 1. Consolidated numbers (full, 15 reps, median)

| Stage | ms (median) | Work |
|---|---|---|
| exact offset construction | 5.6e-2 | 924 cells, pure arithmetic, no cache |
| chord-offset residual (warm cache) | 9.2e-4 | 1 shape, plan-shape + residual cache hit |
| chord-offset residual (cache miss) | 5.2e-2 | 1 shape, linearize + full station sweep |
| matrix batch (warm) | 8.3 | 11088 cells, fully cached |
| offset-strip audit | 8.5e-1 | 1 band + independent topology audit (O(F²) overlap sweep) |
| corpus generation | 3.1 | 48 bounded rows incl. topology rows |

(Values from `docs/evidence/phase20l/offset-radius-safety.md` §8, confirmed by
a fresh full-mode re-run during integration: 5.706e-2 / 9.100e-4 / 4.648e-2 /
8.155 / 8.639e-1 / 3.058 ms. Update this table only with a fresh full-mode
run on the same branch.)

## 2. Reading notes

- Construction is pure arithmetic (no cache involved); the warm residual is
  ~50× faster than cold because the plan shape and residual caches hit.
- The matrix batch is warm-cache dominated; cold behavior is bounded by the
  single-shape cold cost × uncached shapes.
- The strip audit cost is the O(F²) overlap sweep, linear in triangle pairs.
- Corpus generation includes the topology rows (the most expensive rows).

## 3. Reproduce

`npx tsx scripts/phase20lOffsetRadiusPerf.ts` (full) or with `--quick`
(3 reps, smoke only).
