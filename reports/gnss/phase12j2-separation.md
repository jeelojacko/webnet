# Phase 12J.2 Batch D — Stochastic Separation (§§20–23)

EVIDENCE ONLY. No `src/` production changes, no math/tolerance changes, no vendor commits, no downloads.
Primary evidence (local corpus, read-only): `sett2.png` (Baseline Processing > Quality),
`sett4.png` (Default Standard Errors), B32 detail page `292d3b4c.7.html`,
`post-BL-processing-b4adjustment.gvx` (PV32 = S32 window: START 2006-06-14T17:24:30.00,
DX 5822.6458385167643 / DY −5654.8854499720037 / DZ −4846.085326617118).

## §20 — Quality thresholds: RESULT CLASSIFICATION, not weights

Verdict: **FLAG/FAIL thresholds are post-solution display labels; they do not enter the estimator or weights.**

Evidence: `sett2.png` Acceptance criteria — "If horizontal precision > [Flag] [Fail]", "If vertical
precision > …" — compare operator `>` against already-computed precisions; optional RMS criteria exist but
"Use optional acceptance criteria" is **unchecked**. The B32 footer prints the same table. Nothing feeds back
into variances. The 50/50 passed / 0 flagged / 0 failed counts (`292d12a8.html`) are outcome tallies.

Correction to the frozen config: its "H FLAG 0.020 m + 1 ppm" conflates Computation > Point Tolerances
(Survey 0.020 m, `sett1.png`) with Baseline Processing > Quality. The authoritative acceptance value is
**H FLAG 0.035 m + 1.0 ppm** per `sett2.png` AND the B32 report footer (both agree; V rows agree
everywhere: FLAG 0.050 + 1.0 ppm / FAIL 0.100 + 1.0 ppm; H FAIL 0.050 + 1.0 ppm).

S32 numeric thresholds at L = 9453.3312 m (1 ppm = 9.4533 mm):

- H FLAG = 0.035 + 9.4533e-3 = **44.453 mm**; H FAIL = 0.050 + 9.4533e-3 = **59.453 mm**
- V FLAG = 0.050 + 9.4533e-3 = **59.453 mm**; V FAIL = 0.100 + 9.4533e-3 = **109.453 mm**
- (Superseded frozen value: H FLAG 0.020 + 1 ppm = 29.453 mm — recorded, not used.)

TBC S32 result classification: H precision **0.007 m** (7 mm < 44.453 → **PASS**),
V precision **0.024 m** (24 mm < 59.453 → **PASS**). Consistent with 50 passed / 0 flagged / 0 failed.

## §21 — Trace: baseline report → pre-adjustment GVX → covariance → network adjustment (S32/B32)

Verdict: **unbroken chain with display-rounding only; the aposteriori covariance is what enters the adjustment.**

1. Baseline report (B32 page): Vector Errors s D X **0.005** / s D Y **0.019** / s D Z **0.015** m;
   Aposteriori Covariance Matrix (m²): XX 0.0000247718, XY 0.0000655581, YY 0.0003463746,
   XZ −0.0000531839, YZ −0.0002570615, ZZ 0.0002267204.
2. Pre-adjustment GVX (PV32): SDX **0.0049771295001947132** (= √2.47718e-5 ✓),
   SDY **0.018611142892783452** (= √3.4637e-4 ✓), SDZ **0.015057236856773216** (= √2.2672e-4 ✓);
   PXY 0.707740507593363 (= 6.55581e-5/(SDX·SDY) ✓), PXZ −0.70966909932397659 ✓,
   PYZ −0.9173153655589642 ✓ — every element reconciles; report = GVX rounded to mm display
   (0.005/0.019/0.015). DX/DY/DZ likewise (5822.6458 → 5822.646).
3. Network adjustment: 12E/12J.1 artifacts run Model B0 = **raw pre-adjustment GVX covariance**, robust OFF,
   TS dense → parity L3: SEUW **1.965038** vs displayed 1.97 (underlying in [1.965, 1.975));
   vTPv 498.1172 vs TBC-implied [498.0980, 503.1806); coordinates sub-nm vs post-GVX (max3D 1.397e-9 m);
   DOF 150/21/129 exact. `src/engine/gnssGvxImport.ts` contains no default/fallback substitution
   (grep: no `default`, `fallback`, or sigma literal) — GVX covariance passes through untouched.

## §22 — Default Standard Errors: HARD SEPARATION — not used in raw processing

Verdict: **Default Standard Errors (Error horizontal 0.005 m + 1.0 ppm; Error vertical 0.010 m + 2.0 ppm,
`sett4.png` > GNSS) DO NOT seed the stochastic model of any processed baseline. Fallback-only at most;
no artifact shows them consumed anywhere.**

Three independent exclusions (no guessing):

1. **Value mismatch (S32):** default formula at 9453.3312 m gives H = 5 + 9.4533 = **14.453 mm**,
   V = 10 + 18.9067 = **28.907 mm**. The PV32/B32 matrix is SDX 4.977 / SDY 18.611 / SDZ 15.057 mm with
   correlations +0.708 / −0.710 / −0.917 — a full estimated aposteriori matrix, irreconcilable with an
   H/V formula pair (which carries no correlation structure and wrong magnitudes).
2. **Corpus-wide:** all **50/50** pre-adjustment GVX vectors carry significant correlations
   (|P| > 0.05 on at least one term); **0/50** match the default H/V formula within 2% with near-zero
   correlations. No processed vector looks default-generated.
3. **No room in the adjustment:** Model B0 (raw GVX only, zero setup error) already reaches L3 with
   SEUW compatible and sub-nm coordinates. Any additive default-SE term would move vTPv/SEUW off the
   TBC-implied interval — the parity leaves no residual for it to explain.

Scope note: the only unconsumed role consistent with all artifacts is **fallback for vectors that arrive
without an estimated covariance** (e.g. keyed-in/imported vectors) — but no artifact in 12E/12J.1/12J.2
contains such a vector, so even the fallback role is unsourced. It is therefore NOT adopted as a claim;
see §23 for the experiment that would source it.

## §23 — Default-SE consumption: EXPLICITLY UNRESOLVED as a general claim; operator causal experiment spec

Verdict: **consumption EXPLICITLY UNRESOLVED beyond the §22 exclusion.** Proven: Default SE does not enter
processed-baseline stochastic models (S32 + 50/50 corpus). Unproven: whether TBC ever consumes Default SE
as a fallback (and under exactly which trigger), because the artifacts contain no covariance-free vector.

Operator causal experiment spec (TBC-side, no production change; writes into this report's future revision):

1. In a COPY of the ProcessingGNSSBaselines project, key in (or import) one manual GNSS vector of known
   length L (≈ 5–10 km) between two existing marks WITHOUT running baseline processing on it, so it carries
   no estimated covariance. Predict under the fallback hypothesis: its adjustment weight equals the Default
   SE formula (H = 0.005 + L·1e-6, V = 0.010 + L·2e-6, ENU-diagonal at each endpoint) while setup errors stay
   0.000/0.000.
2. Export pre-adjustment GVX; read that vector's SDX/SDY/SDZ + correlations. Fallback CONFIRMED iff the
   exported matrix is ENU-diagonal-per-endpoint with the formula magnitudes (correlations ≈ 0 in ENU) rather
   than an estimated full matrix. Fallback REFUTED iff TBC refuses the vector, assigns zero/NaN weight, or
   substitutes a different documented value.
3. Second arm (additivity test): set Default Standard Errors to an exaggerated pair (e.g. 0.050 + 10 ppm /
   0.100 + 20 ppm), re-export GVX WITHOUT reprocessing baselines, and diff all 50 covariance blocks.
   No-change CONFIRMS the §22 separation for processed vectors; any change reopens §§21–22.
4. Record TBC version (42.0 per GVX SOURCE_DATA), screenshots of the edited settings, and both GVX
   SHA-256 hashes in the report. Until this runs, no WebNet code path may reference Default SE values.
