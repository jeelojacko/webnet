# Phase 9C Fast Routing Performance

Fixture: `tests/fixtures/camp_design_preanalysis_traverse_only.dat`

Effective solve-preparation scope: 86 coordinates + 84 orientations = 170 predicted (46 station unknowns). The 92-coordinate figure in `baseline-routing-performance.json` is the preserved historical Phase 9B.1 runtime scope (upper range 176), not the effective preflight count.

One warm-up and three measured runs were used.

| Mode | Median |
|---|---:|
| Historical old production cap128 | 5276 ms |
| Fresh forced TypeScript | 2660.3 ms |
| Fresh Phase 9C production | 2659.2 ms |
| Fresh preflight | 4.9 ms |

The Phase 9C route made no sparse attempt, loaded no WASM bundle, delegated zero native corrections and zero native covariance calls, and did not restart. The returned TypeScript result contract passed.

The historical 5276 ms measurement is preserved separately in `baseline-routing-performance.json`; it was not rerun for this result. New measurements are local diagnostics, not timing gates. C2 follow-up (native and TypeScript-reference C2 failures, `~1.1645e51` condition estimate) remains conditioning-aware research with unchanged mathematics and tolerances.
