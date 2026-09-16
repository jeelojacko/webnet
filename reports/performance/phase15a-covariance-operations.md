# Phase 15A covariance operation counts and benchmark (evidence only)

Method: engine-level LSAEngine solves, 1 warm-up + 5 measured runs, medians.
Instrumentation is pre-existing test-only hooks (detailedSolveProfiler, qxxReuseProbe);
solveTimingProfile buckets are reported as-is. matrixFactorizationMs conflates
iteration factor/solve with final covariance — the detailed profiler is the primary source.
Counts are MEASURED (profiler/probe/tap) or TRACED (code-path walk) as labeled.
Distinct ops are never called "inversion": factorization, normal solve,
normal accumulation, Qxx recovery, row-product construction are separate rows.

## Benchmark matrix (dense-default path)

| Fixture | dim | iters | params | equations | NORMAL factorizations (M) | NORMAL solves (M) | FINAL accumulations (M) | FINAL Qxx recoveries (M) | STATS accumulations (M) | STATS Qxx recoveries (M) | reuse reason | Qvv rows traced | WASM transfers (M) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|
| chain-2d-32 | 2D | 4 | 64 | 130 | 4 | 4 | 1 | 1 | 1 | 1 | two-dimensional-legacy | 130 | 0 |
| chain-2d-64 | 2D | 4 | 128 | 258 | 4 | 4 | 1 | 1 | 1 | 1 | two-dimensional-legacy | 258 | 0 |
| chain-2d-128 | 2D | 4 | 256 | 514 | 4 | 4 | 1 | 1 | 1 | 1 | two-dimensional-legacy | 514 | 0 |
| gps-2d-64 | 2D | 4 | 128 | 386 | 4 | 4 | 1 | 1 | 1 | 1 | two-dimensional-legacy | 386 | 0 |
| gps-3d-32 | 3D | 4 | 96 | 259 | 4 | 4 | 1 | 1 | 0 | 0 | reused-final-dense-qxx | 259 | 0 |
| gps-3d-64 | 3D | 4 | 192 | 515 | 4 | 4 | 1 | 1 | 0 | 0 | reused-final-dense-qxx | 515 | 0 |
| gps-3d-128 | 3D | 4 | 384 | 1027 | 4 | 4 | 1 | 1 | 0 | 0 | reused-final-dense-qxx | 1027 | 0 |
| chain-2d-128+sparse-selected | 2D | 4 | 256 | 514 | 4 | 4 | 0 | 0 | 0 | 0 | sparse-row-products-active | 514 | 1 |

## Timing medians (ms)

| Fixture | wall | NORMAL assembly | NORMAL accumulate | NORMAL factor/solve | NORMAL state | FINAL assembly | FINAL accumulate | FINAL recover | STATS total | STATS assembly | STATS accumulate | STATS recover | STATS row-products | STATS per-equation | precision | report | packaging |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chain-2d-32 | 13.42 | 1.78 | 0.31 | 0.79 | 0.08 | 0.21 | 0.06 | 0.53 | 4.56 | 0.23 | 0.07 | 0.56 | 0.1 | 0.17 | 1 | 4 | 0 |
| chain-2d-64 | 25.72 | 1.63 | 0.61 | 2.35 | 0.06 | 0.42 | 0.18 | 3.21 | 10.34 | 0.39 | 0.18 | 3.33 | 0.21 | 0.26 | 3 | 7 | 1 |
| chain-2d-128 | 117.77 | 5.82 | 2.22 | 13.04 | 0.2 | 1.15 | 0.57 | 28.33 | 43.87 | 1.13 | 0.58 | 27.57 | 0.83 | 0.28 | 7 | 36 | 3 |
| gps-2d-64 | 37.3 | 3.81 | 1.03 | 2.19 | 0.1 | 0.89 | 0.29 | 3.57 | 13.43 | 0.86 | 0.29 | 3.55 | 0.28 | 0.47 | 4 | 9 | 1 |
| gps-3d-32 | 19.39 | 2.08 | 0.59 | 1.14 | 0.06 | 0.51 | 0.17 | 1.56 | 6.28 | 0.98 | 0 | 0 | 0.14 | 0.31 | 1 | 5 | 0 |
| gps-3d-64 | 61.38 | 5.68 | 2.11 | 6.03 | 0.12 | 1.26 | 0.58 | 11.45 | 13.4 | 1.38 | 0 | 0 | 0.52 | 0.57 | 4 | 9 | 1 |
| gps-3d-128 | 281.03 | 19.15 | 9.18 | 38.79 | 0.24 | 4.41 | 2.08 | 93.52 | 32.76 | 4.16 | 0 | 0 | 2.58 | 0.49 | 11 | 22 | 3 |
| chain-2d-128+sparse-selected | 51.52 | 4.29 | 2.77 | 11.22 | 0.21 | 0.45 | 0 | 1.71 | 10.65 | 0.42 | 0 | 0 | 2.22 | 0.43 | 4 | 6 | 3 |

## Feature-toggle marginal costs (identical geometry, flag-only diffs)

| Toggle | fixture | base wall | variant wall | delta wall | base iters | variant iters | base STATS recoveries | variant STATS recoveries | base reason | variant reason | numerics note |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| robust-huber-vs-none | chain-2d-64 | 25.96 | 26.42 | 0.46 | 4 | 4 | 1 | 1 | two-dimensional-legacy | two-dimensional-legacy | numerics differ by construction (Huber reweighting iterates further) |
| robust-huber-vs-none | gps-3d-64 | 59.88 | 70.4 | 10.52 | 4 | 4 | 0 | 1 | reused-final-dense-qxx | robust-mode-inadmissible | numerics differ by construction (Huber reweighting iterates further) |
| tscorr-on-vs-off | chain-2d-64 | 24.61 | 25.36 | 0.75 | 4 | 4 | 1 | 1 | two-dimensional-legacy | two-dimensional-legacy | numerics differ only if TS-correlation groups exist in the network |
| reliability-statistical-vs-legacy | chain-2d-64 | 24.14 | 26.25 | 2.11 | 4 | 4 | 1 | 1 | two-dimensional-legacy | two-dimensional-legacy | adjustment numerics unchanged (post-processing MDB only) |
| reliability-statistical-vs-legacy | gps-3d-64 | 56.99 | 56.53 | -0.46 | 4 | 4 | 0 | 0 | reused-final-dense-qxx | reused-final-dense-qxx | adjustment numerics unchanged (post-processing MDB only) |
| force-legacy-stats-vs-reuse | gps-3d-64 | 54.99 | 67.51 | 12.52 | 4 | 4 | 0 | 1 | reused-final-dense-qxx | force-legacy-oracle | adjustment numerics identical (oracle forces SP recompute path) |

## Session-level suspectImpact (chain-2d-32)

- off wall median ms: 7.51; stages: [{"id":"main-solve","solves":1,"ms":8}]
- auto wall median ms: 26.41; stages: [{"id":"main-solve","solves":1,"ms":6},{"id":"suspect-impact","solves":3,"ms":20}]
- Extra-solve counts come from the session stage profile (main-solve vs suspect-impact).

## Sparse selected-store arm (chain-2d-128)

- verdict: {"verdict":"measured","success":true,"converged":true,"wallMedianMs":51.52,"transfersMedian":1,"statsReason":"sparse-row-products-active","finalReason":"sparse-selected-store-captured","reliabilityAvailable":true,"relativePrecisionRows":0,"relativeCovarianceRows":255}

## External reliability availability (measured per-observation tally)

- dense vs sparse-selected: {"dense":{"chain-2d-64":{"components":258,"available":258,"reasons":{}},"chain-2d-128":{"components":514,"available":514,"reasons":{}},"gps-3d-64":{"components":515,"available":515,"reasons":{}}},"sparseSelected":{"components":514,"available":0,"reasons":{"sparse-route-unavailable":514}}}
- Expectation from code: sparse row-product runs carry no dense B/P, so
  computeExternalInfluences reports 'sparse-route-unavailable' per row.

## All-pairs relativePrecision note (no code changed)

Walls are machine-local medians and regenerate on rerun (counts/reasons stable).
Per-pair figures are UPPER BOUNDS (precision bucket includes station covariances).

| Fixture | unknowns traced | params | all-pairs rows | precision bucket ms (upper bound: incl. station covariances) | per-pair µs (upper bound) |
|---|---:|---:|---:|---:|---:|
| chain-2d-32 | 32 | 64 | 496 | 1 | 2.02 |
| chain-2d-64 | 64 | 128 | 2016 | 3 | 1.49 |
| chain-2d-128 | 128 | 256 | 8128 | 7 | 0.86 |
| gps-2d-64 | 64 | 128 | 2016 | 4 | 1.98 |
| gps-3d-32 | 32 | 96 | 496 | 1 | 2.02 |
| gps-3d-64 | 64 | 192 | 2016 | 4 | 1.98 |
| gps-3d-128 | 128 | 384 | 8128 | 11 | 1.35 |

## Operation-count method ledger

- normalFactorizations / normalSolves: MEASURED (= result.iterations; one factor+solve per iteration).
- finalNormalAccumulations / finalQxxRecoveries: MEASURED (qxxReuseProbe final-covariance event).
- statsNormalAccumulations / statsQxxRecoveries / reuse reason: MEASURED (probe statistics event).
- qvvRowConstructionsTraced: TRACED (= first-iteration equation count; B = A*Qxx has one row per equation).
- wasmTransfers: MEASURED test-side tap around querySelected (0 on every dense arm).
- Dense-matrix constructions (TRACED, not timed): FINAL builds N (n×n) + Qxx (n×n); legacy STATS builds N (n×n) + Qxx (n×n) + B (m×n); reuse STATS builds B (m×n) only.
- Reliability sensitivity products (TRACED): legacy model uses the diagonal only (0 full-column products); statistical model adds one full-P-column dot product per testable equation row.
- REPORT-ONLY: solveTimingProfile reportDiagnosticsMs + resultPackagingMs (production coarse timing, uninstrumented).
