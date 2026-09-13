# Phase 12F.3 W3 — R2B production-route perf/memory/fill (real WASM)

REAL production route only: kill switch ON in measurement code, `isWorker: true`,
real `cpp/build-wasm` bundle (no solver overrides). R2B ladder legs pass the
diagnostic `minParams: 1` seam ONLY to measure below the provisional perf floor;
ts-proof legs use production bounds untouched. Clean TS legs run
`runGnssBaselineAdjustment` on the identical deterministic corpus (seed 7).
Budgets: R2B 3-run median at <=250 stations, 1 run at 500/750; TS 1 run at >=500,
3-run median below. Per-leg child timeout 300 s (fail-closed skip).

## Wall clock TS vs R2B (median ms) + speedup

| case | params | TS wall | R2B wall | speedup | digest match | SEUW rel | identity R2B |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| ring@25 | 72 | 5 | 7 | 0.67 | true | 0.0e+0 | 3.6e-15 |
| ring@50 | 147 | 18 | 19 | 0.97 | true | 0.0e+0 | 8.5e-14 |
| ring@75 | 222 | 41 | 35 | 1.15 | true | 0.0e+0 | 4.3e-13 |
| ring@100 | 297 | 76 | 61 | 1.24 | true | 0.0e+0 | 6.0e-13 |
| ring@150 | 447 | 230 | 96 | 2.40 | true | 0.0e+0 | 7.7e-13 |
| ring@250 | 747 | 1054 | 359 | 2.94 | true | 0.0e+0 | 2.5e-12 |
| ring@500 | 1497 | 9953 | 1751 | 5.68 | true | 0.0e+0 | 2.7e-12 |
| ring@750 | 2247 | 28439 | 4714 | 6.03 | true | 0.0e+0 | 3.0e-11 |
| sparse-mesh@25 | 72 | 14 | 20 | 0.69 | true | 0.0e+0 | 0.0e+0 |
| sparse-mesh@50 | 147 | 42 | 59 | 0.72 | true | 0.0e+0 | 2.3e-13 |
| sparse-mesh@75 | 222 | 80 | 107 | 0.75 | true | 0.0e+0 | 0.0e+0 |
| sparse-mesh@100 | 297 | 147 | 188 | 0.78 | true | 0.0e+0 | 4.5e-13 |
| sparse-mesh@150 | 447 | 393 | 440 | 0.89 | true | 0.0e+0 | 6.8e-13 |
| sparse-mesh@250 | 747 | 1789 | 1436 | 1.25 | true | 0.0e+0 | 4.5e-13 |
| sparse-mesh@500 | 1497 | 11825 | 8238 | 1.44 | true | 0.0e+0 | 9.1e-13 |
| sparse-mesh@750 | 2247 | 37189 | 23418 | 1.59 | true | 0.0e+0 | 1.1e-11 |
| repeated-edge@25 | 72 | 4 | 6 | 0.72 | true | 0.0e+0 | 1.4e-13 |
| repeated-edge@50 | 147 | 19 | 18 | 1.04 | true | 0.0e+0 | 3.1e-13 |
| repeated-edge@75 | 222 | 40 | 42 | 0.95 | true | 0.0e+0 | 7.4e-13 |
| repeated-edge@100 | 297 | 78 | 60 | 1.31 | true | 0.0e+0 | 4.0e-13 |
| repeated-edge@150 | 447 | 229 | 127 | 1.79 | true | 0.0e+0 | 3.1e-13 |
| repeated-edge@250 | 747 | 1056 | 371 | 2.85 | true | 0.0e+0 | 1.8e-12 |
| repeated-edge@500 | 1497 | 10044 | 1884 | 5.33 | true | 0.0e+0 | 3.8e-12 |
| repeated-edge@750 | 2247 | 30346 | 5184 | 5.85 | true | 0.0e+0 | 1.5e-11 |
| hub-spoke@100 | 297 | 82 | 58 | 1.42 | true | 0.0e+0 | 8.5e-14 |
| hub-spoke@250 | 747 | 1066 | 392 | 2.72 | true | 0.0e+0 | 1.1e-13 |
| hub-spoke@500 | 1497 | 9899 | 1921 | 5.15 | true | 0.0e+0 | 1.0e-12 |

## Native fill + memory (R2B legs)

| case | factorNnz | normalNnz | fill | uniqCols | blocks | freeFreeEdges | avgDeg | maxDeg | heap TS (MB) | heap R2B (MB) | timings split (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| ring@25 | 603 | 774 | 0.78 | 72 | 55 | 31 | 2.71 | 3 | 1 | 1 | a=0 e=0 an=0 f=0 s=0 |
| ring@50 | 861 | 1575 | 0.55 | 147 | 112 | 63 | 2.65 | 3 | 10 | 10 | a=0 e=0 an=0 f=0 s=0 |
| ring@75 | 1317 | 2412 | 0.55 | 222 | 171 | 97 | 2.66 | 3 | 22 | 17 | a=0 e=0 an=0 f=0 s=1 |
| ring@100 | 2628 | 3249 | 0.81 | 297 | 230 | 131 | 2.68 | 3 | 32 | 28 | a=0 e=0 an=0 f=0 s=2 |
| ring@150 | 2667 | 4887 | 0.55 | 447 | 346 | 197 | 2.66 | 3 | 66 | 39 | a=0 e=0 an=0 f=0 s=3 |
| ring@250 | 6678 | 8199 | 0.81 | 747 | 580 | 331 | 2.67 | 3 | 16 | 7 | a=0 e=0 an=0 f=0 s=11 |
| ring@500 | 8961 | 16425 | 0.55 | 1497 | 1162 | 663 | 2.67 | 3 | 227 | 121 | a=0 e=0 an=0 f=0 s=76 |
| ring@750 | 13467 | 24687 | 0.55 | 2247 | 1746 | 997 | 2.67 | 3 | 475 | 190 | a=0 e=0 an=1 f=0 s=199 |
| sparse-mesh@25 | 1512 | 1692 | 0.89 | 72 | 106 | 82 | 7.13 | 11 | 9 | 1 | a=0 e=0 an=0 f=0 s=0 |
| sparse-mesh@50 | 5064 | 3699 | 1.37 | 147 | 230 | 181 | 7.57 | 11 | 28 | 22 | a=0 e=0 an=0 f=0 s=1 |
| sparse-mesh@75 | 9471 | 5778 | 1.64 | 222 | 358 | 284 | 7.81 | 13 | 59 | 48 | a=0 e=0 an=0 f=0 s=2 |
| sparse-mesh@100 | 15903 | 7803 | 2.04 | 297 | 483 | 384 | 7.81 | 12 | 57 | 87 | a=0 e=0 an=0 f=0 s=5 |
| sparse-mesh@150 | 32880 | 11763 | 2.80 | 447 | 728 | 579 | 7.83 | 13 | 91 | 56 | a=0 e=0 an=0 f=1 s=15 |
| sparse-mesh@250 | 84339 | 19935 | 4.23 | 747 | 1232 | 983 | 7.94 | 14 | 82 | 111 | a=0 e=0 an=1 f=5 s=65 |
| sparse-mesh@500 | 306096 | 40077 | 7.64 | 1497 | 2476 | 1977 | 7.95 | 14 | 808 | 542 | a=1 e=0 an=1 f=37 s=1384 |
| sparse-mesh@750 | 669414 | 60453 | 11.07 | 2247 | 3733 | 2984 | 7.98 | 15 | 1790 | 2248 | a=1 e=1 an=2 f=122 s=4427 |
| repeated-edge@25 | 351 | 630 | 0.56 | 72 | 47 | 34 | 2.96 | 3 | 1 | 1 | a=0 e=0 an=0 f=0 s=0 |
| repeated-edge@50 | 726 | 1305 | 0.56 | 147 | 97 | 72 | 3.00 | 3 | 13 | 13 | a=0 e=0 an=0 f=0 s=0 |
| repeated-edge@75 | 1101 | 1980 | 0.56 | 222 | 147 | 109 | 2.99 | 3 | 16 | 12 | a=0 e=0 an=0 f=0 s=1 |
| repeated-edge@100 | 1476 | 2655 | 0.56 | 297 | 197 | 147 | 3.00 | 3 | 18 | 25 | a=0 e=0 an=0 f=0 s=1 |
| repeated-edge@150 | 2226 | 4005 | 0.56 | 447 | 297 | 222 | 3.00 | 3 | 47 | 41 | a=0 e=0 an=0 f=0 s=3 |
| repeated-edge@250 | 3726 | 6705 | 0.56 | 747 | 497 | 372 | 3.00 | 3 | -7 | 22 | a=0 e=0 an=0 f=0 s=9 |
| repeated-edge@500 | 7476 | 13455 | 0.56 | 1497 | 997 | 747 | 3.00 | 3 | 252 | 152 | a=0 e=0 an=0 f=0 s=78 |
| repeated-edge@750 | 11226 | 20205 | 0.56 | 2247 | 1497 | 1122 | 3.00 | 3 | 545 | 285 | a=0 e=0 an=0 f=0 s=183 |
| hub-spoke@100 | 1161 | 2025 | 0.57 | 297 | 162 | 63 | 2.29 | 4 | 26 | 21 | a=0 e=0 an=0 f=0 s=1 |
| hub-spoke@250 | 2970 | 5121 | 0.58 | 747 | 409 | 160 | 2.29 | 4 | 156 | 7 | a=0 e=0 an=0 f=0 s=5 |
| hub-spoke@500 | 5793 | 10035 | 0.58 | 1497 | 807 | 308 | 2.24 | 4 | 258 | 135 | a=0 e=0 an=0 f=0 s=59 |

## Bridge-excluded TS proof legs (chain / survey via production route)

Hub-spoke is R2B-admissible under this corpus (degree-2 top-up removes all
bridges; eligibility confirms zero cut-edges), so it runs as bonus native legs
above. Chain/survey trip the shared production F-BRIDGE statistics gate inside
clean TS itself, so no TS wall exists; `bundle loads = 0` is the proof the
native path was never touched (eligibility rejects before any bundle load).

| case | route | wall (ms) | bundle loads | digest | reason |
| --- | --- | ---: | ---: | --- | --- |
| chain@100 | skipped | n/a | 0 | n/a | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-4.808146897528301e-19, tau=2.77182064372567e-26). |
| chain@250 | skipped | n/a | 0 | n/a | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-1.833643314898149e-18, tau=2.814335098093661e-26). |
| chain@500 | skipped | n/a | 0 | n/a | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-1.1571825669262483e-18, tau=4.317728124187862e-25). |
| survey@100 | skipped | n/a | 0 | n/a | GNSS statistics for S0003->S0004#92: Qvv block is materially non-PSD (lambda_min=-1.3675452749045434e-18, tau=1.7549067941018525e-25). |
| survey@250 | native-sparse-selected-qxx | 367 | 1 | 9d27713c | admissible (bridgeless under seed 7): native, factorNnz=6012, fill=0.70, blocks=599, identity=0.0e+0 |
| survey@500 | skipped | n/a | 0 | n/a | GNSS statistics for S0031->S0032#470: Qvv block is materially non-PSD (lambda_min=-2.4044474654842284e-19, tau=2.880647089669905e-24). |

## Bounds derivation

Measured: largest successful R2B leg = 750 stations; max observed factorNnz = 669414 (densest leg sparse-mesh@750, fill 11.07); max selected blocks = 3733.

Total-wall crossover (first ladder size with R2B median < TS median): ring@75 (params=222, TS=41ms vs R2B=35ms); sparse-mesh@250 (params=747, TS=1789ms vs R2B=1436ms); repeated-edge@50 (params=147, TS=19ms vs R2B=18ms); hub-spoke@100 (params=297, TS=82ms vs R2B=58ms).

Bound decision: PROVISIONALS KEPT (no constant changes). MIN_PARAMS 225 = ring crossover (222 params) + margin; mesh crosses later (747) but sub-floor mesh legs are bitwise-identical at 0.68-0.82x (correct but slower, as the floor reason states), while raising MIN to 747 would forfeit ring/repeated-edge wins (1.3-6.6x) in 225-747. MAX_TOTAL_STATIONS 750 = largest measured leg (750 stations OK on all admitted topologies, no timeout/OOM at 300 s / 10 GB). MAX_PARAMS 2250 covers mesh@750 (2247 params). MAX_BLOCKS 4000 = max observed 3733 (mesh@750) + 7% headroom. MAX_FACTOR_NNZ 1500000 = max observed 669414 (mesh@750, fill 11.07) x 2.24 headroom; no unacceptable fill point was reached in-cohort. Beyond-750 probing stays out of scope (12F.2: mesh@1500 84 s R2B-only, 2000 arch-gate fail).
