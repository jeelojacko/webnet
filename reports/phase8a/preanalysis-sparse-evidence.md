# Phase 8A preanalysis sparse evidence (test-only, no routing)

- cases=4 contractPass=4 autoRouteRejectsPreanalysis=true
- rowProductsCalls=0 expected for every case (preanalysis skips standardized residuals by construction).

| id | dof | seuw | iter | solves | stnCov | relPrec | corrCalls | selCovCalls | rowProd | fallbacks | maxCoord | maxCovAbs | maxCovRel | maxRelCovAbs | maxRelCovRel | maxRelPrecAbs | maxRelPrecRel | S0 | S1 | S2 | S3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| p-small-2d | 2 | 1 | 1 | 11 | 2 | 1 | 11 | 11 | 0 | 0 | 0.00e+0 | 4.34e-19 | 4.34e-19 | 4.34e-19 | 4.34e-19 | 1.36e-20 | 1.36e-20 | pass | pass | pass | pass |
| p-plan-2d | 3 | 1 | 1 | 11 | 2 | 1 | 11 | 11 | 0 | 0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 6.78e-21 | 6.78e-21 | 6.78e-21 | 6.78e-21 | pass | pass | pass | pass |
| p-gps-2d | 6 | 1 | 1 | 11 | 2 | 1 | 11 | 11 | 0 | 0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 | pass | pass | pass | pass |
| p-camp-bounded | 365 | 1 | 1 | 17 | 43 | 1032 | 17 | 17 | 0 | 0 | 0.00e+0 | 1.05e-7 | 1.05e-7 | 2.94e-8 | 2.94e-8 | 1.11e-7 | 1.11e-7 | pass | FAIL | FAIL | FAIL |

## Recommendation

Preanalysis sessions stay single-iteration-per-solve, so S3 every-iteration coverage is cheap to keep honest where the planning geometry is well-conditioned; any future production strategy must gate on the recorded condition estimate (fail closed above a calibrated threshold) and cap admitted session solve counts (template + impact scenarios) alongside the existing unknown-count cap before claiming S1-S3. S0 (static admission + final agreement) is supportable for ill-conditioned planning geometries since the correction is discarded.
