# Phase 12E.2 — REAL-TBC commercial parity evidence

Evidence-only. No production math, parser semantics, tolerances, routing, UI, or CRS code was modified.

## Intake

- GVX: `Adjusting the Network.gvx` — 91 vectors, 182 POINT records, 16 unique NAMEs, frame NAD83(2011)@2010, GVX v1.0 converted by Trimble Business Center 42.0 (SOURCE_DATA application block).
- Report: `cafa0ac3.html` — project "Adjusting the Network", US State Plane 1983 / NAD 1983 (Conus), global WGS84, GEOID09, 2 iterations, ref factor 1.10, chi-square FAILED, DOF 228.
- CORRECTION to the phase brief: the Adjusted ECEF table carries 16 rows (one per station NAME), not 182. The 182 figure is the GVX POINT-record count. Per-station comparison is therefore NAME-keyed over all 16 stations.
- P041 fixed 2D+h at the higher-precision GVX coordinate (gate H: agrees with the TBC 4-decimal display within +-5e-5 m/component).

## Gates A-J

| Gate | Name | Verdict | Detail |
| --- | --- | --- | --- |
| A | GVX intake identity | PASS | vectors=91 marks=182 frame=NAD83(2011)@2010 GVX v1.0 (converter: Trimble Business Center 42.0 per SOURCE_DATA application block) |
| B | NAME grouping identity | PASS | 16 unique NAMEs; same-NAME coordinates identical within 1e-6 m. |
| C0 | TBC report parse | PASS | iterations=2 refFactor=1.1 chiSq=Failed dof=228 redundancy=228 constrained=P041 ecefRows=16 obs=91 |
| C | Observation-set identity (GVX <-> report) | PASS | all 91 GVX solutionIds present in report Adjusted GNSS Observations and vice versa. |
| C2 | settings.txt cross-check | PASS | centering=0.005 antenna=0.002 (report: 0.005/0.002); holds P041 fixed in 2D+h per settings note. |
| D | Spreadsheet ID reconciliation (GVX <-> xlsx col A) | PASS | all 91 GVX solutionIds present in xlsx col A and vice versa. rows=91 cols=19; col A reconciled below; other columns reported raw (semantics UNRESOLVED). |
| E | DOF cross-check | PASS | n=273 u=45 dof=228 (TBC 273/45/228); logicalObs=91 statistics=91 (Phase 12D). |
| F | SEUW vs TBC 1.10 display interval | FAIL | SEUW=2.100053 (displayed TBC 1.10 => underlying in [1.095,1.105)). |
| G | Per-station adjusted ECEF vs TBC table | NOTE | n=16 max3D=4.334e-3 m rms3D=2.236e-3 m; 1/16 within 4-decimal reference-resolution floor (5e-5 m/component). Residuals NOT compared (see gate J). |
| H | P041 GVX-vs-TBC datum agreement | PASS | dX=-2.938e-5 dY=-1.495e-5 dZ=-1.205e-5 m; each within +-5e-5 m display rounding — P041 fixed at higher-precision GVX coordinate justified. |
| I | vTPv vs implied TBC interval | FAIL | vTPv=1005.5307 (SEUW^2*dof); TBC-implied [273.3777,278.3937). |
| J | NOT-COMPARABLE ledger + frame reconciliation | NOTE | Residuals NOT COMPARABLE (TBC reports Az/DeltaHt/EllipDist derived quantities; WebNet solves raw ECEF DX/DY/DZ — no exact conversion derived). Precision/covariance display terms NOT COMPARABLE (a-posteriori/DRMS display, not raw Qxx). Frame: GVX NAD83(2011)@2010 vs report NAD83(Conus)+State Plane+GEOID09 — ECEF comparison only; grid/geodetic/orthometric NOT compared. |
| B-HYP | Model B setup-covariance hypothesis | NOTE | HYPOTHESIS (not TBC's formula): SEUW=1.102511 max3D=7.814e-5 rms3D=4.948e-5 — closer to 1.10 than Model A SEUW=2.100053. |

## Scorecard

- Observation-set identity (gate C): PASS — 91 GVX solutionIds vs 91 report IDs.
- DOF (gate E): WebNet n=273 u=45 dof=228 vs TBC 273/45/228.
- SEUW (gate F): WebNet 2.100053 vs TBC displayed 1.10 (underlying in [1.095,1.105)).
- vTPv (gate I): WebNet 1005.5307 vs TBC-implied [273.3777,278.3937).
- Coordinates (gate G): max3D 4.334e-3 m, rms3D 2.236e-3 m over 16 NAMEs; TBC 4-decimal rounding imposes a +-5e-5 m/component reference-resolution floor.

## Parity level: 1 / 4

Rubric (brief S30): L0 input parity (vector set/datum/frame/stochastic source identified); L1 structural (same n/u/dof/topology/control); L2 coordinate (adjusted ECEF within reference resolution); L3 stochastic (reference factor/covariance/precision after reconciliation); L4 residual (UNREACHABLE — TBC reports Az/DeltaHt/EllipDist derived quantities, not ECEF, so residual parity is NOT COMPARABLE without an exact conversion that was not derived).

## Model A (raw GVX, robust OFF)

SEUW 2.100053, vTPv 1005.5307, iterations 2, converged true, maxCorrection 4.096e-10 m, Phase-12D statistics blocks 91.

## Model B (setup-covariance HYPOTHESIS — RUN)

SEUW 1.102511, vTPv 277.1410, max3D 7.814e-5 m, rms3D 4.948e-5 m. HYPOTHESIS, not TBC's formula.

## Per-station ECEF differences (WebNet minus TBC, metres)

| Station | dX | dY | dZ | 3D norm |
| --- | --- | --- | --- | --- |
| 3 | -1.346e-3 | 3.326e-4 | 3.919e-6 | 1.386e-3 |
| 5 | -2.002e-4 | 3.715e-3 | 1.066e-3 | 3.870e-3 |
| B 412 | -2.127e-4 | 6.514e-4 | -3.289e-4 | 7.601e-4 |
| ENERGY | 5.147e-4 | 1.271e-3 | -7.659e-5 | 1.374e-3 |
| F 408 | 8.401e-4 | 1.926e-3 | 4.268e-4 | 2.144e-3 |
| HANNA | 8.770e-4 | 2.338e-3 | -1.087e-3 | 2.723e-3 |
| Jeffco Reset | -2.846e-4 | 2.377e-3 | 4.388e-4 | 2.434e-3 |
| P041 | -2.938e-5 | -1.495e-5 | -1.205e-5 | 3.510e-5 |
| PLTC | 1.552e-4 | 1.398e-3 | -1.864e-4 | 1.419e-3 |
| TMGO | -5.547e-4 | -3.047e-4 | 4.499e-4 | 7.765e-4 |
| barbara | 5.978e-4 | 9.022e-4 | -1.136e-4 | 1.088e-3 |
| filter | 1.039e-3 | 4.154e-3 | -6.668e-4 | 4.334e-3 |
| frey | 9.922e-4 | 2.559e-3 | -7.753e-4 | 2.852e-3 |
| fsi | -2.278e-4 | 2.753e-3 | 2.774e-4 | 2.776e-3 |
| hard | 3.616e-4 | 1.579e-3 | -4.387e-4 | 1.678e-3 |
| sixtwo | -9.199e-4 | 5.685e-5 | -7.877e-4 | 1.212e-3 |

## Frame reconciliation

GVX vectors/coordinates are NAD83(2011)@2010; the TBC report adjusts in NAD 1983 (Conus) with a State Plane projection and GEOID09. Comparison is performed on adjusted ECEF coordinates only; grid, geodetic, and orthometric quantities are NOT compared.

## NOT-COMPARABLE ledger

- Residuals: TBC Adjusted GNSS Observations are Az/DeltaHt/EllipDist derived quantities per vector; WebNet solves raw ECEF DX/DY/DZ. No exact conversion was derived, so residual parity is NOT COMPARABLE.
- Precision/covariance display: TBC a-posteriori errors, error ellipses, and precision ratios are DRMS display quantities, not raw Qxx — NOT COMPARABLE.
- vectorlist.xlsx columns beyond col A (solution IDs) carry UNRESOLVED semantics (no header row; raw values only).

## Recommended Phase 12E.3 scope (no production change made)

- Derive or source the exact TBC Az/DeltaHt/EllipDist residual conversion before any residual-parity claim.
- Resolve vectorlist.xlsx column semantics against TBC documentation.
- Decide whether the Model B setup-covariance hypothesis (or another weighting) explains the SEUW gap, or record the gap as an open modeling difference.
