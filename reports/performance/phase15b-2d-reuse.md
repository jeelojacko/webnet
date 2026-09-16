# Phase 15B 2D final-Qxx statistics reuse (evidence)

Method: engine-level LSAEngine solves, 1 warm-up + 5 measured clean wall runs per arm, medians; one instrumented solve per arm for op counts/parity/profiler. BEFORE = forceLegacyStatisticsQxx oracle (pre-15B legacy path); AFTER = production default (reuse).

## §25 Operation counts (mandatory proof)

| Fixture | BEFORE FINAL accum/recover | BEFORE STATS accum/recover | AFTER FINAL accum/recover | AFTER STATS accum/recover | Total dense Qxx recoveries | AFTER reason |
|---|---|---|---|---|---|---|
| chain-2d-32 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |
| chain-2d-64 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |
| chain-2d-128 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |
| gps-2d-64 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |
| gps-2d-128 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |
| gps-3d-64 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 2 → 1 | reused-final-dense-qxx (before: force-legacy-oracle) |

## §26 Timing medians (same machine/process, warm-up, medians)

| Fixture | dim | params | equations | BEFORE wall ms | AFTER wall ms | delta ms | delta % | BEFORE stats-recover ms | AFTER stats-recover ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chain-2d-32 | 2D | 64 | 130 | 26.67 | 15.09 | -11.58 | -43.42 | 0.66 | 0 |
| chain-2d-64 | 2D | 128 | 258 | 57.57 | 41.67 | -15.9 | -27.62 | 6.15 | 0 |
| chain-2d-128 | 2D | 256 | 514 | 241.98 | 178.05 | -63.93 | -26.42 | 67.53 | 0 |
| gps-2d-64 | 2D | 128 | 386 | 75.24 | 69.14 | -6.1 | -8.11 | 7.72 | 0 |
| gps-2d-128 | 2D | 256 | 770 | 277.66 | 229.82 | -47.84 | -17.23 | 56.33 | 0 |
| gps-3d-64 | 3D | 192 | 515 | 150.28 | 115.48 | -34.8 | -23.16 | 21.89 | 0 |

## §10 3D regression

- gps-3d-64 row above compares oracle vs production on this branch (proves the admitted 3D cohort still reuses with parity). Cross-branch 3D non-regression: the 15B diff only removes the 2D early-return (unreachable for 3D inputs); the Phase 10E agent suite passes on this branch (see validation).

## §28 Memory (evidence only)

- Qxx bytes (n×n×8): 524288; legacy peak covariance 1048576 vs reuse 524288; row-product transient (m×n×8) 1052672 on both arms.
- heapUsed delta around one clean solve (median of 3, GC-unsupervised): legacy 58233712 B vs reuse 38018904 B. No verdict from heapUsed — it is dominated by retained result + uncollected garbage and flips sign between runs; the analytic byte counts above are the memory claim.
- reuse prolongs final-Qxx lifetime through statistics (shared read-only, no copy); legacy peak holds two Qxx simultaneously only transiently during stats recovery.

## §24 Telemetry samples (qxxReuseProbe statistics/final-covariance events)

- {"fixture":"chain-2d-32","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":64,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":64,"qxxDimension":64,"normalAccumulations":1,"inversions":1}}
- {"fixture":"chain-2d-64","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":128,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":128,"qxxDimension":128,"normalAccumulations":1,"inversions":1}}
- {"fixture":"chain-2d-128","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":256,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":256,"qxxDimension":256,"normalAccumulations":1,"inversions":1}}
- {"fixture":"gps-2d-64","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":128,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":128,"qxxDimension":128,"normalAccumulations":1,"inversions":1}}
- {"fixture":"gps-2d-128","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":256,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":256,"qxxDimension":256,"normalAccumulations":1,"inversions":1}}
- {"fixture":"gps-3d-64","statistics":{"stage":"statistics","reused":true,"reason":"reused-final-dense-qxx","normalDimension":null,"qxxDimension":192,"normalAccumulations":0,"inversions":0},"finalCovariance":{"stage":"final-covariance","reused":false,"reason":"dense-final-covariance-captured","normalDimension":192,"qxxDimension":192,"normalAccumulations":1,"inversions":1}}

## Validation

- Focused evidence test `tests/evidence/phase15b_2d_reuse_benchmark.test.ts` (evidence tier, `phase15b` suite): 1/1 PASS — asserts §25 op counts, reuse reasons, and cross-arm full-result parity on all 6 fixtures.
- `tests/phase10e_production_qxx_reuse.test.ts` + tier-manifest: 18/18 PASS on this branch (3D cohort + wiring unchanged).
- `npm run lint`: 0 errors (2 pre-existing warnings); `npm run typecheck`: clean.
- No production changes in this batch (evidence + report + tier wiring only); no `test:full`/evidence `all` run per mission scope.
