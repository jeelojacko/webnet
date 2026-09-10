# Phase 10C — 3D Covariance / Statistics Dense-Tail Evidence

## Repository

- Branch: `feat/3d-covariance-statistics-evidence`
- Baseline: `9acc178d837d2ea374553078b70fa20994d51879`
- HEAD: `f6b80cfbea4c917b3885ba109299520f0669510f`
- PR: [#17](https://github.com/jeelojacko/webnet/pull/17)

## Contract

- Production behavior changed: NO
- Mathematical contract changed: NO
- Public result contract changed: NO
- Production routing changed: NO


Evidence-only dense TypeScript campaign on the genuine 3D corpus. Timings: Node process, 1 warm-up + 3 measured uninstrumented runs and 1 warm-up + 3 measured profiled runs; medians reported. industry_demo is inadmissible (weak-case observation). Qxx equivalence/reuse and A/B/C demand modes are NOT implemented or measured.

| Fixture | params | rows | iters | TS wall ms | cov+stats ms | cov calls | stats calls | stdres calls | all-pairs rows | all-pairs expected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| industry_demo-3d-terrestrial | 9 | 17 | 10 | 4.96 | 0.79 | 1 | 1 | 1 | 3 | 3 |
| gps-3d-cov-08 | 24 | 75 | 4 | 4.18 | 1.33 | 1 | 1 | 1 | 28 | 28 |
| gps-3d-16 | 48 | 147 | 4 | 6.02 | 2.33 | 1 | 1 | 1 | 120 | 120 |
| gps-3d-32 | 96 | 291 | 4 | 14.56 | 6.59 | 1 | 1 | 1 | 496 | 496 |
| gps-3d-64 | 192 | 579 | 4 | 54.53 | 32.51 | 1 | 1 | 1 | 2016 | 2016 |
| gps-3d-128 | 384 | 1155 | 4 | 302.32 | 220.86 | 1 | 1 | 1 | 8128 | 8128 |

## Profiler stages (medians, ms)

| Fixture | assembly | accumulate | factor/solve | state upd | cov assembly | cov accumulate | cov invert | statistics | precision propagation | row products | stats Qxx invert |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| industry_demo-3d-terrestrial | 0.63 | 0.04 | 0.76 | 0.03 | 0.07 | 0.01 | 0.11 | 0.61 | 0.11 | 0.00 | 0.12 |
| gps-3d-cov-08 | 0.57 | 0.07 | 0.12 | 0.02 | 0.13 | 0.02 | 0.07 | 1.10 | 0.37 | 0.02 | 0.07 |
| gps-3d-16 | 0.77 | 0.18 | 0.28 | 0.01 | 0.21 | 0.05 | 0.27 | 1.80 | 0.69 | 0.04 | 0.27 |
| gps-3d-32 | 2.24 | 0.57 | 1.17 | 0.04 | 0.44 | 0.16 | 1.46 | 4.53 | 1.56 | 0.14 | 1.46 |
| gps-3d-64 | 4.79 | 2.06 | 6.75 | 0.07 | 1.05 | 0.56 | 11.67 | 19.23 | 3.70 | 0.52 | 11.71 |
| gps-3d-128 | 16.74 | 8.11 | 39.65 | 0.25 | 4.24 | 2.03 | 100.35 | 114.24 | 10.64 | 2.20 | 90.39 |

## Call graph

- LSAEngine.solve (src/engine/adjustSolveWorkflow.ts) iterates correction loop then runs post-solve statistics on the converged state.
- Per nonlinear iteration: assembleAdjustmentEquations (src/engine/adjustmentEquationAssembly.ts) -> accumulateNormalEquationsFromSparseRows (src/engine/matrix.ts) -> dense factor/solve -> state update; instrumented per-iteration by DetailedSolveProfiler.recordIteration.
- Final covariance: recoverFinalNormalCovariance (src/engine/adjustCovarianceRecovery.ts) reassembles the full equation system at converged geometry (duplicate of last loop assembly by design), accumulates the normal matrix, and inverts via invertNormalMatrixForStats; instrumented as covariance assembly/accumulate/invert with call counts.
- Standardized residuals: computeStandardizedResidualStatistics (src/engine/adjustStatisticsStandardizedResiduals.ts) reassembles statistics equations, accumulates a statistics normal system, inverts a statistics Qxx, builds row products (tryQueryStandardizedResidualRowProducts, src/engine/adjustStatisticsRowProducts.ts), then per-equation stats with GPS cross-product transforms; instrumented as 8 sub-stages with call counts.
- Precision propagation: propagateAdjustmentPrecision (src/engine/adjustStatisticsPrecision.ts) reads dense Qxx entries and computes station blocks plus the legacy all-pairs relativePrecision loop (n*(n-1)/2 rows) over identical dense formulas, plus connected/requested relativeCovariance rows; timed as statisticsDetail.precisionPropagationMs.
- Public contract: dense Qxx, stationCovariances, relativePrecision (all-pairs), relativeCovariances, and statistical rows are unchanged by this campaign; the profiler lives outside AdjustmentResult behind test-only EngineOptions.

## Contracts and non-claims

- Qxx equivalence between dense and any selected/sparse covariance route is NOT measured here; no selected-covariance solver is injected on the headline path.
- Qxx reuse across the final-covariance inversion and the statistics Qxx inversion is NOT implemented or measured; the profile records two separate inversion stages.
- Covariance demand modes A (dense all-entry), B (legacy all-pairs compat), C (selected-network) are NOT implemented or measured in this campaign; all-pairs counts below describe the dense legacy contract only.
- Real-WASM injected-correction probe (when the artifact exists) exercises the test-only sparseCorrectionSolver seam for one solve per fixture and compares row counts only; it does not claim numeric Qxx/statistics equivalence and does not alter production routing (3D stays ineligible for production sparse dispatch).

## Recommendation

MORE EVIDENCE REQUIRED: this campaign quantifies the dense covariance + statistics tail and its all-pairs counts, but measures no selected/sparse alternative, no Qxx equivalence, and no reuse. Do not route covariance or statistics off the dense path until a follow-up campaign measures those modes.
