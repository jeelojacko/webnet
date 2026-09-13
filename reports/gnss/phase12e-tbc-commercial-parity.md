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

<!-- MANUAL dataset-B appendix: re-append after regenerating this file via `npm run gnss:tbc-parity`. Full machine evidence: reports/gnss/phase12e-tbc-dataset-b-parity.md (`npm run gnss:tbc-parity -- <datasetB-dir> --dataset b`). -->

## Dataset B — ProcessingGNSSBaselines zero-setup-error cross-check (CASE 1, parity level 3/4)

- Intake: `post-BL-processing-b4adjustment.gvx` (AUTHORITATIVE pre-adjustment input, 50 vectors / 100 POINTs / 8 NAMEs: 3, 5, filter, frey, fsi, hanna, P041, sixtwo, NAD83(2011)@2010) + `post-networkadjustment.gvx` (cross-check) + report body `netwrok adjustment report/200aae0c.html` (TOC/wrapper siblings identified by title/frameset content, same pattern as dataset A) + baseline summary `process baseline report/292d12a8.html` + both XLSX vectorlists. Full 71-file manifest (bytes + SHA-256) is recorded in the dataset-B report.
- Baseline processing (provenance only): processed 50 / passed 50 / flagged 0 / failed 0; all 50 rows Fixed.
- Reconciliation: pre-GVX <-> report 50/50 exact; pre-GVX <-> pre-XLSX 50/50 exact (FROM/TO are POINT IDs, e.g. PV27.1->PV27.2, so reconciliation is by solutionId, never FROM/TO alone).
- Pre-vs-post GVX: 50/50 matched, 32 bitwise equal, max|dDX/DY/DZ| <= 9.3e-10 m, covariance diff exactly 0 -> serialization; station marks carry the adjustment (max 1.03 cm), P041 bitwise stable (fixed datum).
- MODEL B0 (raw pre-adjustment GVX covariance, robust OFF, P041 fixed at full-precision pre-GVX coordinate, others free): n/u/dof = 150/21/129 EXACT (GATE), 2 iterations, SEUW 1.965038 vs TBC 1.97 display ([1.965,1.975)), vTPv 498.1172 vs implied [498.0980,503.1806).
- Coordinates: within TBC 3-decimal display floor (max|component| 4.92e-4 <= 5e-4 m) AND sub-nanometre vs post-GVX full precision (max3D 1.4e-9 m over 8 NAMEs) — other artifacts hunted before accepting rounding; the post-adjustment GVX export carries TBC adjusted positions at full precision.
- Precision: TBC per-component a-posteriori DRMS display (mm-rounded) is NOT raw Qxx -> NOT COMPARABLE as covariance; outcome-level only, WebNet posterior sigmas (qxx diag x SEUW) round to the same mm display within the floor.
- Residuals Az/DeltaHt/EllipDist -> NOT COMPARABLE (no exact conversion derived). Chi-square: TBC "Failed" vs WebNet vTPv outside standard 95% bounds [99.4,162.3] -> same reject outcome, construction unverified (outcome-consistent only).
- Verdict CASE 1: core least-squares validated for the zero-setup-error case. Dataset-A gap reclassified as setup-error stochastic; Model B stays HYPOTHESIS.

## Cross-dataset conclusion + Dataset A0 recommendation

- Dataset A (91v/16 stations, setup 0.005/0.002): structural parity L1 (DOF 228 exact), open stochastic gap (Model A SEUW 2.10 vs 1.10).
- Dataset B (50v/8 stations, setup 0.000/0.000): parity L3 (DOF 129 exact, SEUW compatible, coordinates sub-nanometre vs TBC's adjusted export).
- Together the engine reproduces TBC when the stochastic model is fully captured (raw GVX covariance, zero setup error); the dataset-A gap is isolated to setup-error stochastic modeling.
- Recommended external experiment Dataset A0 (no production change): re-adjust the original project with 0.000/0.000 setup errors, same 91 vectors/datum/scalar. Prediction: Model A SEUW converges to the displayed reference factor and coordinates agree within reference resolution. No production weighting change until proven.

<!-- MANUAL session-scout appendix: re-append after regenerating this file via `npm run gnss:tbc-parity`. -->

## Pre-experiment session/occupation metadata scout (read-only, no model fitting)

- All 91 vectors carry `SURVEY_SETUP_ID=PP`, a single project-level `Post-processed` block — not a physical occupation id. Zero `session`/`occupation` strings in the GVX; all equipment serials are `0` (receiver types `UNKNOWN`); endpoint equipment (E1–E4 antenna types) is inferable per POINT but is not an occupation key. Report `cafa0ac3.html` has no session/occupation grouping or per-vector timestamps.
- Proven shared occupations: NONE. Candidate groups only: ~41 exact-timestamp temporal groups (max ~6 vectors per identical interval, e.g. PV116/PV146 14:50–15:48 via Jeffco Reset) — identical times may be copied/trimmed records, so confidence is candidate, never proof.
- Metadata is INSUFFICIENT for a defensible per-occupation setup-covariance model; shared-session cross-baseline covariance is plausible but unprovable from this intake. A0/AC/AH runs remain necessary — setup-error identification is STOPPED until they are present.
- EXPERIMENTAL UPDATE (12E.2 controlled runs, see appendix below): the STOP is lifted. The independent-endpoint ENU model reproduces all four reference factors within display, so per-occupation / shared-session cross-baseline covariance is NOT REQUIRED for this stochastic — any such contribution is below display detectability (coordinate bound ~1.1e-4 m). No per-occupation model will be built.

<!-- MANUAL setup-error experiment appendix: re-append after regenerating this file via `npm run gnss:tbc-parity`. Machine evidence: stdout JSON of the four parameterized runs (`--model m0|mc|mh|mch --report <body>`); intake files are read-only local-only, never committed. -->

## Dataset A Controlled Setup-Error Experiment (A0/AC/AH/A)

Evidence-only: no production math, parser semantics, tolerances, routing, UI, or CRS code was changed. All four models run on the SAME original Dataset-A GVX (`Adjusting the Network.gvx`, 91 vectors, P041 fixed) through the same `runGnssBaselineAdjustment` TS-dense path; only the endpoint setup covariance added via the reused `setupCovarianceEcef` differs. CLI: `--model m0|mc|mh|mch` (single parameterized setup run; legacy `a`/`b` behavior byte-identical) with `--report <TBC body html>` (SEUW/vTPv compatibility intervals derive from that report's own displayed factor precision) and `--out` (parameterized runs skip the markdown report unless `--out` is given, so the canonical file above is never clobbered). Parser generalization (synthetic-fixture tested): `refFactorText` (raw display cell) plus per-station `xErr/yErr/zErr/err3d` display-error columns (`?` fixed cells decode as null).

### Manifest (roles identified BY CONTENT: BODY = `<title>Network Adjustment Report</title>` + `ReportSummary`; TOC = `<title>Table of Contents</title>` + `BodyFrame` targets; WRAPPER = `<frameset` + `BodyFrame`)

| Run | File | Role | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| A0 | 67233623.html | BODY | 218996 | f642f099f3f8937785f117130c441599c6f20e093c65730c0d7542627ded1d72 |
| A0 | 6723325e.html | TOC | 3956 | 8b4bca8c6455581350d54ef1f907ac93d7c295c1c5bddfe202fbd079a185f30d |
| A0 | Rpt66f0dd45.html | WRAPPER | 728 | b69101bbc02096ad3196ab3ddb602a35448eae96c8c9d90e93425b14f6b97611 |
| AC | ae143a18.html | BODY | 218918 | c710688ef1c2df95649ed5992a1a87ec0edd3692b16d6d6e22688840e64a8643 |
| AC | ae13888d.html | TOC | 3956 | 7e23ace67c187bf78a7396bb81b6846020ceafe6900811f64ab0e6283d349d37 |
| AC | Rptade0e6e4.html | WRAPPER | 728 | d0a2461d7db1272c3ea2f439806127c936098ab0d8122b49476fe9a7f8af277d |
| AH | d1844f73.html | BODY | 218994 | 6b5f47fa19c44a43d116a6df723194b46ada803aaf6017d0c83b7ef663efae9c |
| AH | d183d9d6.html | TOC | 3956 | a8a886a5bdddbbf3a47b18dc1290639610017e78b5e9ad584c2d54b856d99708 |
| AH | Rptd15149aa.html | WRAPPER | 728 | 32b4c12eca0ddeafc23a4d37be85a285f259d809a57984c078ad2a763415fed8 |
| A (orig) | cafa0ac3.html | BODY | 218925 | 86cf07aef5493db71622aa058274d393a6719c48c2a76927eab50e7665696145 |

Authoritative observations for ALL models: original Dataset-A GVX (249087 bytes, SHA-256 7e3cfe2b36c7f9671eb230d4a55e37dacfe701471d45d6b306f64dedabc85ccd).

### Invariant gate: PASS (all four runs)

Existing `parseTbcReport` over A0/AC/AH/A bodies proves identical non-experimental conditions: the same 91 solution IDs as sets (order differs only — table order; GVX set also exact), DOF 228 / redundancy 228, P041 `Local` Fixed/Fixed/Fixed, a-priori scalar 1.00, DRMS confidence, 2 iterations, chi-square Failed, same `.vce` project path, same State Plane 1983 / Colorado North 0501 / NAD 1983 (Conus) / WGS84 / GEOID09, no terrestrial/direction/distance/level sections in any body. The ONLY material differences are centering/height: A0 0.000/0.000, AC 0.005/0.000, AH 0.000/0.002, A 0.005/0.002 — exactly the expected matrix. (Gate C2 is NOTE for the variant runs because the original `settings.txt` describes the 0.005/0.002 project — expected, not a failure; PASS for A.) No other material setting differs: causality is isolated, no inference beyond setup errors is made.

### Four-run scorecard (WebNet DOF 228 in every run; TBC intervals assume half-up display rounding of the shown 2-decimal factor)

| Pair | TBC factor [interval] | WebNet SEUW | Factor diff | max comp | max 3D | RMS 3D | Worst station |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0/M0 (raw) | 2.10 [2.095,2.105) | 2.100053 PASS | +0.000053 | 4.991e-5 | 6.846e-5 | 5.089e-5 | filter |
| AC/MC (0.005/0) | 1.30 [1.295,1.305) | 1.297104 PASS | -0.002896 | 7.808e-5 | 1.073e-4 | 5.024e-5 | PLTC |
| AH/MH (0/0.002) | 1.99 [1.985,1.995) | 1.988831 PASS | -0.001169 | 5.036e-5 | 6.265e-5 | 4.892e-5 | 3 |
| A/MCH (0.005/0.002) | 1.10 [1.095,1.105) | 1.102511 PASS | +0.002511 | 5.115e-5 | 7.814e-5 | 4.948e-5 | filter |

vTPv (gate I PASS all runs): M0 1005.5307 vs implied [1000.6977,1010.2737); MC 383.6049 vs [382.3617,388.2897); MH 901.8426 vs [898.3713,907.4457); MCH 277.1410 vs [273.3777,278.3937). Per-run parity levels: A0/M0 = 3/4 (F PASS and max component within the 5e-5 rounding floor); AC/MC, AH/MH, A/MCH = 1/4 (F PASS; coordinates hairline-to-1e-4 above the strict component floor — AH by 0.4 um on one component, A by 1.1 um, AC by 2.8e-5 at PLTC).

Differential response (TBC displayed deltas vs model SEUW deltas; TBC delta quantum +-0.01 from 2-decimal display): A0->AC -0.80 vs -0.802949; A0->AH -0.11 vs -0.111222; A0->A -1.00 vs -0.997542; AC->A -0.20 vs -0.194593; AH->A -0.89 vs -0.886320. The model predicts TBC's response to each setup change within display.

### Height orientation (H1 vs H2)

H1 (ENU-up augmentation, the reused hypothesis) AGREES: MH SEUW 1.988831 in [1.985,1.995), coordinate/precision deltas agree (below). The H2 naive ECEF-Z-only negative control was therefore NOT run — recorded as not-triggered, not as skipped evidence.

### Precision-delta check A0->AC/AH/A (TBC per-station X/Y/Z/3D Error columns are mm-rounded a-posteriori DRMS display, NOT raw Qxx; model sigmas are SEUW x sqrt(qxx diag) via the engine param index)

Absolute ranges agree within display: M0 |sig| 3.4-5.3 mm vs TBC err3d 3-5 mm; MC 4.4-9.1 vs 4-9; MH 3.7-6.3 vs 4-6; MCH 3.9-8.0 vs 4-8. Deltas agree in direction everywhere the TBC display resolves a change (15/15 stations for C; every nonzero displayed H/B delta agrees — the `0.000` entries are sub-display, e.g. barbara C: TBC +0.000 vs model +0.0007; hard B model -0.0001 is negligible) and in magnitude within ~1 mm display quantum (e.g. station 3: C +0.004 vs +0.0038, H +0.001 vs +0.0010, B +0.003 vs +0.0027; filter: C +0.004 vs +0.0038; fsi: C +0.003 vs +0.0031). P041 excluded (fixed, `?` error cells).

### Verdicts

- Causal isolation: PASS. The pre-registered A0 prediction (raw Model A SEUW converges to the displayed factor, coordinates within reference resolution) is confirmed: A0/M0 reaches parity level 3/4, equal to Dataset-B level 3.
- Independent-endpoint ENU model: SUPPORTED (strongly, four runs) — NOT claimed PROVEN, because 2-decimal factors and 4-decimal coordinates cannot exclude nearby model variants (AC-PLTC exceeds the rounding floor at 1.07e-4).
- Centering sub-verdict: SUPPORTED (AC/MC factor, deltas, precision all agree). Height sub-verdict: SUPPORTED (AH/MH factor, deltas, precision all agree).
- Cross-baseline (shared-session) covariance: NO detectable effect — all four reference factors reproduce without it; any contribution is below display detectability (coordinate bound ~1.1e-4 m, worst case AC-PLTC).
- Brief S16 rotation-convention / failure-order analysis: NOT TRIGGERED (independent model succeeds; no tuning performed, none permitted).
- Dataset-A revised level: 3/4 via the controlled A0/M0 pair (original-report-only level was 1/4); the original A/MCH pair stays 1/4 by the letter of the strict component floor (single-component excess ~1 um).

### Phase 12E.3 production recommendation (supported by this evidence)

Propose OPTIONAL setup-error sigmas on the GNSS baseline input — e.g. per-run `setupCenteringM` / `setupAntennaM` defaulting to 0.000 (current raw behavior unchanged when unset) — applied as independent-endpoint ENU->ECEF augmentation exactly as validated here, with regression tests locked to the A0/AC/AH/A numbers above. No silent TBC defaults: unset means zero, and any nonzero default must be an explicit, documented operator choice. Docs (`docs/gnss/`, report 12E.3 scope) record the SUPPORTED-not-PROVEN status and the DRMS/not-comparable ledgers.
