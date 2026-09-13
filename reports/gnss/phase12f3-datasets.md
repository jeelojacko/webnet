# Phase 12F.3 W4 — Dataset A/B commercial + setup-regression evidence (REAL R2B route)

REAL production route only: kill switch ON in-script, `isWorker: true`, real
`cpp/build-wasm` bundle (no solver overrides). Each leg passes the diagnostic
`minParams: 1` seam ONLY to force-admit these small nets (16/8 stations, ~45/21
params) BELOW the MIN 225 perf floor. The floor is economics-only (correct-but-slower
below floor, bitwise-proven per the perf report); parity is floor-independent.
Clean TS oracle is `runGnssBaselineAdjustment` on the identical input.
DatasetB-AC/AH/A legs are INTERNAL setup regressions, not commercial claims.
Numbers only; no vendor content (vector/station counts, no paths).

## Per-leg parity (R2B vs TS)

| leg | claim | status | coords maxAbs | SEUW rel | resid maxAbs | stnCov abs/rel | Qvv rel | Cvv rel | redTr diff | blockT abs | id TS | id R2B | route | blocks | factorNnz |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| DatasetA-A0 | commercial controlled TBC adjustment | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 7.6e-21 / 2.9e-15 | 1.0e-14 | 9.9e-15 | 0.0e+0 | 2.1e-14 | 0.0e+0 | 0.0e+0 | native-sparse-selected-qxx | 52 | 585 |
| DatasetA-AC | commercial controlled TBC adjustment | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 5.1e-20 / 8.0e-15 | 1.7e-14 | 1.7e-14 | 0.0e+0 | 3.6e-14 | 5.7e-14 | 5.7e-14 | native-sparse-selected-qxx | 52 | 585 |
| DatasetA-AH | commercial controlled TBC adjustment | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.1e-20 / 4.4e-15 | 1.4e-15 | 1.4e-15 | 0.0e+0 | 3.9e-14 | 2.8e-14 | 2.8e-14 | native-sparse-selected-qxx | 52 | 585 |
| DatasetA-A | commercial controlled TBC adjustment | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.7e-20 / 4.0e-15 | 3.2e-15 | 3.2e-15 | 5.7e-14 | 2.8e-14 | 2.8e-14 | 2.8e-14 | native-sparse-selected-qxx | 52 | 585 |
| DatasetB-B0 | commercial zero-setup | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 6.1e-21 / 5.6e-15 | 1.4e-14 | 1.4e-14 | 0.0e+0 | 7.1e-15 | 2.8e-14 | 2.8e-14 | native-sparse-selected-qxx | 26 | 222 |
| DatasetB-AC | INTERNAL setup regression (not commercial) | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 9.3e-21 / 5.6e-14 | 3.1e-15 | 3.0e-15 | 0.0e+0 | 5.3e-15 | 2.8e-14 | 2.8e-14 | native-sparse-selected-qxx | 26 | 222 |
| DatasetB-AH | INTERNAL setup regression (not commercial) | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.1e-20 / 4.7e-15 | 1.1e-15 | 1.0e-15 | 2.8e-14 | 2.7e-14 | 2.8e-14 | 0.0e+0 | native-sparse-selected-qxx | 26 | 222 |
| DatasetB-A | INTERNAL setup regression (not commercial) | PASS | 0.0e+0 | 0.0e+0 | 0.0e+0 | 6.8e-21 / 6.5e-13 | 3.2e-15 | 3.1e-15 | 0.0e+0 | 3.6e-15 | 2.8e-14 | 2.8e-14 | native-sparse-selected-qxx | 26 | 222 |

## TS SEUW pin verification

| leg | TS SEUW | pin | match |
| --- | ---: | ---: | --- |
| DatasetA-A0 | 2.100053 | 2.100053 | true |
| DatasetA-AC | 1.297104 | 1.297104 | true |
| DatasetA-AH | 1.988831 | 1.988831 | true |
| DatasetA-A | 1.102511 | 1.102511 | true |
| DatasetB-B0 | 1.965038 | 1.965038 | true |
| DatasetB-AC | 1.123544 | n/a (INTERNAL, no pin) | n/a |
| DatasetB-AH | 1.885533 | n/a (INTERNAL, no pin) | n/a |
| DatasetB-A | 0.958125 | n/a (INTERNAL, no pin) | n/a |

## Loop QC + sizing

| leg | stations | vectors | params | obs | dof | loops | cycleRank | loopMatch | iters |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| DatasetA-A0 | 16 | 91 | 45 | 273 | 228 | 76 | 76 | true | 2 |
| DatasetA-AC | 16 | 91 | 45 | 273 | 228 | 76 | 76 | true | 2 |
| DatasetA-AH | 16 | 91 | 45 | 273 | 228 | 76 | 76 | true | 2 |
| DatasetA-A | 16 | 91 | 45 | 273 | 228 | 76 | 76 | true | 2 |
| DatasetB-B0 | 8 | 50 | 21 | 150 | 129 | 43 | 43 | true | 2 |
| DatasetB-AC | 8 | 50 | 21 | 150 | 129 | 43 | 43 | true | 2 |
| DatasetB-AH | 8 | 50 | 21 | 150 | 129 | 43 | 43 | true | 2 |
| DatasetB-A | 8 | 50 | 21 | 150 | 129 | 43 | 43 | true | 2 |
