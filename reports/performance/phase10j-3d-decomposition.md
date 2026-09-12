# Phase 10J 3D native performance decomposition

Production-equivalent arms (automatic native full-Qxx route vs forced TypeScript), 1 warm-up + 5 measured runs.
Attribution: session solveTimingProfile buckets + native SparsePhaseTimings + JS wrapper walls.
C1/C2/C3 verification is wrapper-only (no isolated timing API — no sub-buckets invented).

| Fixture | cohort | stations | params | TS med ms | native med ms | native calls | Qxx elems | Qxx bytes | native phase med ms (asm/equ/an/fac/sol) | wrapper overhead med ms | TS+verify rest med ms | C1 max | C2 max | verified cols | reuse |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---|
| gps-3d-cov-08 | route | 10 | 24 | 5.67 | 7.62 | 5 | 2880 | 23040 | 0.009/0.004/0.015/0.003/0.017 | 0.084 | 7.45 | 2.12e-21 | 8.88e-16 | 16 | reused-final-dense-qxx |
| gps-3d-32 | route | 34 | 96 | 12.86 | 23.93 | 5 | 46080 | 368640 | 0.029/0.011/0.022/0.007/0.139 | 0.312 | 23.47 | 9.74e-21 | 2.22e-15 | 16 | reused-final-dense-qxx |
| gps-3d-64 | route | 66 | 192 | 39.49 | 77.35 | 5 | 184320 | 1474560 | 0.028/0.013/0.038/0.012/0.434 | 0.990 | 75.82 | 1.48e-20 | 5.33e-15 | 16 | reused-final-dense-qxx |
| gps-3d-128 | route | 130 | 384 | 209.37 | 350.14 | 5 | 737280 | 5898240 | 0.052/0.018/0.060/0.016/1.747 | 4.332 | 343.63 | 5.63e-20 | 1.24e-14 | 16 | reused-final-dense-qxx |
| gps-3d-256 | diagnostic-engine-only | 258 | 768 | 1310.51 | 591.24 | 5 | 2949120 | 23592960 | 0.103/0.034/0.110/0.029/6.962 | n/a (engine walls) | n/a (engine walls) | n/a (route-only) | n/a (route-only) | 0 | reused-final-dense-qxx |

## Controlled variant verdicts

| Variant | verdict | reason |
|---|---|---|
| covariance-only isolated timing | unavailable | selected covariance reachable only via full session/engine solve; no safe standalone production API |
| C1/C2/C3 isolated timing | unavailable | verifyNativeFullQxxSystems needs captured native systems; no safe public capture API — wrapper-only attribution |
| legacy all-pairs / damping variants | unavailable by design | would deviate from production numerics; measurement must stay production-equivalent |
| gps-3d-256 production route | ineligible (diagnostic cohort instead) | above the 384-param route cap; engine-level TS/native diagnostic with explicit cohort boundary |

## Attribution model (operations A/B/C/D)

- A (iteration solve): TS dense equation assembly + factorization + correction — solveTimingProfile equationAssemblyMs/matrixFactorizationMs.
- B (native Qxx query): capture → WasmSparseSelectedCovariance.querySelected → native selected covariance — SparsePhaseTimings per call + JS wrapper wall; overhead = wrapper − native sum.
- C (C1/C2/C3 verification): TS-side oracle/residual/physical checks — wrapper-only (totalWall − native wrapper sum, shared with D); sub-buckets unavailable.
- D (statistics + reuse + reporting): dense-Qxx reuse, precision propagation, report diagnostics — solveTimingProfile precision/statistics buckets; otherMs stays unattributed (no reconcile claims).

## Hypotheses

- H1 primary native sparse solve faster: INCONCLUSIVE for end-to-end behavior; native C++ phase timings are small, but TS and native session buckets are not an apples-to-apples isolated primary-solve pair.
- H2 full Qxx erases native solve advantage: SUPPORTED as a route-level observation; native route remains slower at 32/64/128 despite native Qxx kernel timings, but verification and JS work are coupled to this route.
- H3 dense Qxx JS/WASM transfer is major: NOT SUPPORTED; measured wrapper overhead is about 0.1–4.6 ms versus 24–355 ms native wall.
- H4 C1/C2/C3 is meaningful: INCONCLUSIVE; wrapper-only attribution cannot isolate verification from surrounding TypeScript work.
- H5 statistics/result reconstruction is significant: INCONCLUSIVE; session precision/report buckets are recorded, but no safe isolated variant exists.
- H6 break-even shifts with network size: INCONCLUSIVE; 256 is diagnostic-only and not comparable to the production route cohort.

## Scaling observations

- Qxx elements and bytes scale with numParams²; measured payload ranges from 2880 to 737280 elements across the production route cohort.
- Native covariance solve and wrapper walls rise with numParams, while native phase timings remain far below total route wall; these observations do not establish formal complexity.

## Validation and overhead

- Phase10J parity: production-route TS/native result max absolute difference 0; C1/C2 accepted on all route fixtures; statistics reuse active.
- C++ tests: 7/7; real-WASM tests: 41/41; industry parity: 25/25; browser WASM smoke: passed.
- Agent tier: 3 unrelated Study Desktop calibration/preflight failures caused by stale source-package expectations; 469 files passed, 1 skipped. No WebNet failure identified.
- Timing-disabled overhead: no production timing path was changed; dedicated enabled-vs-disabled benchmark is unavailable because timing is evidence-side and existing native metadata is already diagnostic-only.

## Recommendation

- Primary bottleneck: TypeScript-side route overhead dominated by verification/result work, with exact C1/C2/C3 contribution unresolved.
- Secondary bottleneck: dense Qxx materialization/transfer grows with numParams² but is not dominant in measured wrapper overhead.
- Phase 10K: instrument or redesign covariance-demand/verification boundaries in a separate evidence-first phase; do not remove C1/C2/C3, change routing, or alter covariance contracts until independent safety evidence exists.
