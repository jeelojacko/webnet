# Phase 12F.2 §1 — R2 selected-covariance profile (evidence only)

Real-WASM `querySelected` over the exact R2 per-edge query builder (21 scalar queries/edge, no cross-edge dedup).
One native factorization + one bridge call per run; one triangular solve per unique queried column.

| case | params | edges | queries | uniqCols | analyze+factor (ms) | solve (ms) | bridge (ms) | pack (ms) | mirror (ms) | query wall (ms) | total (s) | dominant |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| chain@100 | 297 | 100 | 2085 | 297 | 0.2 | 3.1 | 1.3 | 0.5 | 1.1 | 4.4 | 0.0 | A |
| chain@250 | 747 | 250 | 5235 | 747 | 0.3 | 11.8 | 2.2 | 3.4 | 4.6 | 13.7 | 0.1 | A |
| chain@500 | 1497 | 500 | 10485 | 1497 | 0.5 | 42.9 | 3.0 | 20.5 | 19.5 | 45.6 | 0.3 | A |
| chain@750 | 2247 | 750 | 15735 | 2247 | 0.6 | 91.0 | 3.7 | 54.2 | 22.1 | 94.5 | 0.7 | A |
| chain@1000 | 2997 | 1000 | 20985 | 2997 | 1.0 | 172.7 | 4.7 | 114.6 | 56.2 | 177.5 | 1.3 | A |
| chain@1500 | 4497 | 1500 | 31485 | 4497 | 1.4 | 383.4 | 6.6 | 311.1 | 103.5 | 390.1 | 3.2 | A |
| chain@2000 | 5997 | 2000 | 41985 | 5997 | 1.7 | 634.3 | 7.7 | 660.1 | 108.9 | 642.2 | 6.0 | D |
| sparse-mesh@100 | 297 | 391 | 8046 | 297 | 0.8 | 7.0 | 2.5 | 13.5 | 0.8 | 9.6 | 0.2 | D |
| sparse-mesh@250 | 747 | 991 | 20691 | 747 | 6.2 | 67.3 | 4.6 | 108.1 | 2.4 | 77.0 | 1.0 | D |
| sparse-mesh@500 | 1497 | 1987 | 41607 | 1497 | 39.7 | 477.7 | 7.9 | 642.5 | 10.5 | 523.1 | 5.2 | D |
| sparse-mesh@750 | 2247 | 2992 | 62727 | 2247 | 120.7 | 1535.9 | 11.4 | 2044.4 | 61.7 | 1665.1 | 14.8 | D |
| sparse-mesh@1000 | 2997 | 3992 | 83727 | 2997 | 272.6 | 3517.5 | 15.4 | 3412.9 | 193.8 | 3801.9 | 34.2 | A |
| sparse-mesh@1500 | JS heap OOM (V8 ~4GB) in TS dense equation assembly; child-only kill, run continued | | | | | | | | | | | |
| sparse-mesh@2000 | JS heap OOM (V8 ~4GB) in TS dense equation assembly; child-only kill, run continued | | | | | | | | | | | |
| ring@250 | 747 | 334 | 6969 | 747 | 0.4 | 12.9 | 2.4 | 9.7 | 1.7 | 15.0 | 0.1 | A |
| hub-spoke@250 | 747 | 404 | 4734 | 747 | 0.3 | 6.9 | 2.3 | 15.3 | 1.5 | 8.8 | 0.2 | D |

| case | bridge calls | normal nnz | factor nnz | result bytes | JS heap Δ (MB) | native heap Δ (KB) | canonical blocks | canonical scalars | raw scalars |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chain@100 | 3 | 2673 | 2088 | 722352 | 3.1 | 0.0 | 198 | 1485 | 2085 |
| chain@250 | 3 | 6723 | 4635 | 4505952 | 56.2 | 0.0 | 498 | 3735 | 5235 |
| chain@500 | 3 | 13473 | 9384 | 18011952 | 98.4 | 6592.0 | 998 | 7485 | 10485 |
| chain@750 | 3 | 20223 | 12252 | 40517952 | 460.5 | 24000.0 | 1498 | 11235 | 15735 |
| chain@1000 | 3 | 26973 | 22779 | 72023952 | 940.9 | 65472.0 | 1998 | 14985 | 20985 |
| chain@1500 | 3 | 40473 | 33690 | 162035952 | 1747.3 | 171200.0 | 2998 | 22485 | 31485 |
| chain@2000 | 3 | 53973 | 32190 | 288047952 | 2097.0 | 319872.0 | 3998 | 29985 | 41985 |
| sparse-mesh@100 | 3 | 7731 | 16065 | 770040 | 59.2 | 0.0 | 479 | 4014 | 8046 |
| sparse-mesh@250 | 3 | 19935 | 85338 | 4629600 | 555.6 | 0.0 | 1232 | 10341 | 20691 |
| sparse-mesh@500 | 3 | 40113 | 311109 | 18260928 | 1176.9 | 6592.0 | 2478 | 20805 | 41607 |
| sparse-mesh@750 | 3 | 60471 | 663429 | 40893888 | 1622.4 | 35392.0 | 3734 | 31359 | 62727 |
| sparse-mesh@1000 | 3 | 80721 | 1146987 | 72525888 | 2891.1 | 85184.0 | 4984 | 41859 | 83727 |
| sparse-mesh@1500 | error | | | | | | | | |
| sparse-mesh@2000 | error | | | | | | | | |
| ring@250 | 3 | 8199 | 6678 | 4519824 | 53.3 | 0.0 | 580 | 4473 | 6969 |
| hub-spoke@250 | 3 | 5013 | 2880 | 4501944 | 91.6 | 0.0 | 403 | 2880 | 4734 |

Notes:

- A: repeated triangular solves (~full inverse: unique queried columns ~= parameter count).
- B: selected-inverse work (solve phase dominates on a genuinely sparse query set).
- C: bridge overhead (pack/query wrapper + native assembly/equilibration).
- D: buffer alloc-copy (TS-side design/weight packing).
- E: result representation (TS dense Qxx mirror fill).
- F: factorization (single analyze+factorize per call; duplication is zero).
- G: TS-side equation assembly (outside the native query).
- F duplication is zero by construction (single factorization per run).
- 1500/2000 rows document the scaling gate; TS dense assembly is the known OOM source.
