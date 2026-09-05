# Phase 7D release hardening

Bounded audit of the Phase 7C worker-only sparse route. No cohort widening, no main merge.

Gates: 12/12 passed.

- [x] **boundary-cap** — evidence-based cap is exactly 64 unknowns (SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT=64)
- [x] **boundary-63** — 63 unknowns admitted (no reasons)
- [x] **boundary-64** — 64 unknowns admitted (no reasons)
- [x] **boundary-65** — 65 unknowns rejected (size guard: 65 unknowns exceed SPARSE_PRODUCTION_MAX_UNKNOWN_COUNT=64)
- [x] **kill-switch-default** — auto-route enabled by default (isSparseAutoRouteEnabled()=true)
- [x] **exclude-preanalysis** — preanalysis sessions rejected (preanalysis mode not cleared for sparse auto-route)
- [x] **exclude-inline-autoadjust** — inline .AUTOADJUST directive rejected (inline auto-adjust directive not cleared for sparse auto-route (single-solve sessions only))
- [x] **exclude-gps-covariance** — GPS covariance weighting rejected (GPS covariance weighting not cleared for sparse auto-route | preflight: weak control: 1 fixed stations (minimum 2 for sparse preflight) | preflight: no redundancy: dof=0 (equations=2, params=2) | preflight: under-observed free stations: B | GPS covariance weighting not cleared for sparse production | rank risk 'suspect': datum/weak-geometry risk not cleared)
- [x] **verifier-empty-capture** — empty capture rejected (s3: no correction systems captured (fail-closed))
- [x] **verifier-capture-bound** — capture bound pinned at 512 systems (oracle bound: capture truncated at 512 systems (fail-closed; every-iteration coverage unproven) | s3: no correction systems captured (fail-closed))
- [x] **condition-warn-only** — condition-threshold excess warns without rejecting (iteration 1: normal matrix appears ill-conditioned (estimate=1.725e+14, threshold=1.000e+0, source=ts-packed). | iteration 2: normal matrix appears ill-conditioned (estimate=1.720e+14, threshold=1.000e+0, source=ts-packed). | iteration 3: normal matrix appears ill-conditioned (estimate=1.720e+14, threshold=1.000e+0, source=ts-packed). | iteration 4: normal matrix appears ill-conditioned (estimate=1.720e+14, threshold=1.000e+0, source=ts-packed).)
- [x] **condition-parity** — sparse result.condition agrees with TypeScript within 1e-9 relative (expected=1.725e+14 actual=1.725e+14 iterations=4 captured=4)
