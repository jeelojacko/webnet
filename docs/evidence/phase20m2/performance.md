# Phase 20M.2 performance (measurement-only)

Harness: `scripts/measureTransition20m2.ts` (n=200, machine-local, correctness first — no tuning claims).

| Path | Median | p95 |
| --- | --- | --- |
| Legacy (no intent) | 0.125 ms | 0.276 ms |
| Admitted transition | 0.137 ms | 0.298 ms |
| Ratio | **1.10×** | — |

The transition path adds one bounded policy check + expectation derivation + agreement recheck;
no mesh-size-dependent work is added (blended interval reuses the existing strip tiling).
Robustness pins (Wave J, `tests/cad_grading_transition_robust_20m2.test.ts` 7/7): translations 1e6/1e8
dev 0, mirror exact, reversal pinned, short members oriented, width boundaries exact
(40 admits / 40.000001 rejects; asymmetric 20 admits / 20.5 rejects), scalar extremes
(1e-6/20/40 finite + oriented; 1e6 beyond maxSearch → `MEMBER_NO_SOLUTION`; NaN/Inf fail closed),
3× determinism bit-identical.
