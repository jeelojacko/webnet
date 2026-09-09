# Phase 9D Scenario Audit and Timing

Fixture: `tests/fixtures/camp_design_preanalysis_traverse_only.dat`

## Default camp audit

The exact default request performed one template-source solve, one main solve, and 16 recommendation `solveScenario` calls: 18 total solve-engine invocations. Its base worst station major was `4.166738932165176e-6 m`, below the `0.001 m` target, so threshold planning correctly performed zero scenario calls.

| Metric | Baseline |
|---|---:|
| Recommendation calls | 16 |
| Threshold-plan calls | 0 |
| Unique normalized scenarios | 16 |
| Duplicate calls | 0 |
| Total solve-engine invocations | 18 |

Scenario identity uses `resolveAppliedPreanalysisActionState(...).normalizedScenarioIds`, serialized in canonical normalized order. The audit recorded raw IDs, normalized IDs, stage, duplicate status, and wall time. The planning consumers were verified read-only; cached `AdjustmentResult` references are safe to reuse.

A forced-threshold regression (target `0`, one planning step) exercised the overlap: 32 scenario requests, 16 underlying solves, 16 cache hits, and 16 peak cache entries. Failed solves are not inserted into the cache.

## Timing

One warmup and three measured default-camp runs were performed on the development machine after the session-local memo was enabled.

| Measurement | Median |
|---|---:|
| Phase 9C baseline production | 2659.2 ms |
| Phase 9D production | 2475.6 ms |
| Absolute saving | 183.6 ms |
| Improvement | 6.9% |
| Main solve stage | 29 ms |
| Recommendation/threshold impact stage | 577 ms |

The existing session profile does not separately time the uncaptured template-source solve; it is counted as one known setup solve and remains outside the solve invocation count. Timing is a development-machine measurement, not a CI gate.

The default camp has no duplicate threshold calls to remove, so the observed improvement is neutral-to-positive runtime variation rather than a direct duplicate-removal gain. The cache is still required for threshold-plan scenarios when the target is unmet or for active-template cases. The forced-threshold audit predicts the removed work as 16 duplicate scenario solves; its benefit is approximately duplicate solves multiplied by their average solve cost.
