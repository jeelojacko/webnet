# Phase 12J.8 — Evidence Plan (PRE-REGISTERED, frozen before new data)

Branch: `feat/gnss-raw-covariance-confirmation`
Baseline: `cd221b55` (origin/main = PR #60 merge, Phase 12J.7).
Date frozen: 2026-09-14. Status: EVIDENCE ONLY. No direct ingest. No production
stochastic-model change. No adjustment/R2B/free-network/math/tolerance changes.

12J.7 prior (external reference only, NOT a fitting constraint):
s1h ≈ 17.2 (characterization only, n=30 matched, VAL loop n=2 record-only).
Wettzell short-baseline prior s ≈ 1.5–1.6 kept separate.

## 1. Candidate models (frozen; no new families after results)

- F: C = Cformal (raw RTKLIB formal, reference rejection).
- S: C = s²·Cformal. One global scalar of standard deviation; variance multiplier s².
  Estimator (predeclared): s = sqrt(median(T_FIT_matched) / 2.36597), i.e. match
  FIT matched-pair median T to χ²(3) median 2.36597. Robust, no optimization
  toward 17.2. Fitted on FIT only.
- SD: duration-specific scalars s30/s60/s120/s24h, each by the same median
  estimator within its (duration, FIT) cell. Fitted on FIT only. No duration law
  imposed. Must materially improve VALIDATION calibration to beat S.
- SL: simple length-dependent scalar, ONLY if predeclared form below is used;
  diagnostic unless VALIDATION shows clear residual length trend after S:
  s(L) = s0·(L/L0)^k with L0=30km fixed, (s0,k) fitted on FIT matched T only.
  If length leverage fails §6 gate, SL is not fitted (SL_NOT_IDENTIFIABLE).
- ENU: Csurvey = Rᵀ(E + diag(h²,h²,v²))R, R = engine ecefToEnuRotation
  (geocentric lat, same as 12J.7 analysis mirror). Grid search on FIT matched
  median→2.36597, h∈[0,40]mm step 1mm, v∈[0,80]mm step 1mm, deterministic
  lexicographic tie-break. Preserves formal correlations. Fitted on FIT only.
- CL: σH_extra(L)² = aH²+(bH·L)², σV_extra(L)² = aV²+(bV·L)², added in ENU then
  rotated back (same R). Fit ONLY if gate passes (§5). FIT only. Constraints:
  aH,aV ≥ 0, bH,bV ≥ 0, no per-baseline constants, no negative floors.

REVIEW outcome (no certified scope) remains an allowed selection.

## 2. Corpus

- Dates: prefer 2026-05-04..2026-05-18 (DOY 124–138), 15 contiguous days.
  Minimum: ≥10 clean independent days. Hardware interval verified before
  processing; if equipment change, select another contiguous clean interval
  and document blocker.
- Core stations (frozen): WARE00BEL, TGRN00BEL, VOER00BEL, WERB00BEL
  (18.712 / 33.687 / 45.905 km cohort retained, exact antenna provenance).
- Added geometry (secondary only, ≤2 stations): one ~5–10 km and/or one
  ~55–80 km leg from WARE or existing station, same public Belgian/EPN sources,
  exact antenna/radome required, metadata clean. Never >100 km, never replaces
  core cohort. If none safe → document NO_EXTRA_GEOMETRY and proceed.
- Products: CODE final SP3 precise primary; broadcast NAV bounded secondary
  comparison only (same windows). ANTEX: deterministic subset architecture
  (12J.7 script), exact entries for any new station; record source hash,
  subset hash/size/included entries; reprove full-vs-subset parity on one leg.

## 3. Processing policy (exactly one primary, no per-baseline tuning)

GPS-only L1/L2 static FIXED, 10° mask, MARKER_TO_MARKER_ECEF, exact ANTEX subset,
precise ephemeris, same ambiguity settings as 12J.7 (`-p 3 -f 2 -m 10 -sys G -e -t`,
`pos1-sateph=precise`, `ant2-postype=rinexhead`, per-station anttype/delU,
`-r` base marker ECEF after `-k`, two-arg `-ts/-te`). Driver: extend
`gnss12j7Process.sh` deterministically (fail-closed, content-checked skip,
sorted timing, PAR comparison 1/2/4).

## 4. Windows (disjoint, no reuse inside one pool)

- 1h primary: 00–01, 06–07, 12–13, 18–19 UTC (4/day, non-overlapping).
- 30m: 00:00–00:30, 12:00–12:30 (2/day, disjoint from each other; secondary
  overlap with 1h windows is labelled correlated/exploratory, never in the
  primary matched pool with the overlapping 1h solution).
- 2h: 00–02, 12–14 UTC (2/day, non-overlapping).
- 24h: one/day full-day solution (reference/duration/FIX-reliability only,
  not overweighted; excluded from primary 1h matched pools).
- Target: 15d×4×3 = 180 one-hour core solutions; ≥100 independent FIXED 1h
  total; ≥30 FIXED per primary baseline.

## 5. Length-identifiability gate (§6/§25)

Before any ppm fit: report distinct baseline lengths + per-length n.
If all useful baselines cluster ~20–50 km with ≤3 distinct lengths → report
PPM_NOT_IDENTIFIABLE / CL_REJECTED_UNDERIDENTIFIED, do not fit CL/SL-ppm.
CL may only be fitted if (A) leverage passes, (B) residual length trend remains
after S/SD, (C) sample supports 4 parameters.

## 6. Partitions (frozen, no day moving for GNSS-quality reasons)

15-day mapping: FIT DOY 124–130 (days 1–7), VALIDATION DOY 131–134 (days 8–11),
TEST DOY 135–138 (days 12–15). For fewer clean days N≥10: FIT first 7,
VAL next ceil((N-7)/2), TEST remainder; frozen before fitting.
Exclusions only for missing/corrupt RINEX, hardware discontinuity, product
outage, processing failure (never FLOAT/poor quality). Recorded before evaluation.

## 7. Matched-pair schedule (primary; each solution ≤1 use per analysis)

Within each (pair, duration, eph, partition) cell, sort by (doy,tag), pair
adjacent solutions greedily: (1st,2nd), (3rd,4th), … Cross-partition pairs
forbidden in primary pools. Primary T: T=d′(Ci+Cj)⁻¹d ~ χ²(3),
thresholds 7.815/11.345/median 2.366 (engine mirror). All-pairs contrasts are
pseudoreplicated appendix only, labelled correlated/exploratory.

## 8. Loops (primary; ≥10 independent target)

Each loop = 3 legs on 3 non-overlapping windows (e.g. AB day d 00–01,
BC day d 06–07, CA day d 12–13), c = Σ oriented vectors, C = Σ survey
covariances, Tloop = c′C⁻¹c under the SAME frozen candidate model
(no loop-specific scaling). No solution reused between PRIMARY loops.
Same-session all-pair loops are correlated/exploratory only. Report count,
closure RMS, median/mean T, 95% exceedance per candidate.

## 9. Evaluation order (no refit after TEST)

1. F baseline on FIT/VAL (mean/med/p95/exc95/exc99 by duration+length).
2. Fit S, SD, ENU (+SL/CL only if gates pass) on FIT only.
3. Per-baseline s diagnostics (no production per-baseline params) + daily
   scale stability (median/range/IQR) on FIT.
4. VALIDATION selects among {S, SD, ENU, CL-if-admissible, REVIEW} with frozen
   params. Ranking: (1) avoids gross underestimation, (2) median T near χ²3,
   (3) exc95 near nominal, (4) no residual length trend, (5) no H/V trend,
   (6) loop consistency, (7) simplicity (simpler wins ties).
5. TEST run ONCE for the winner; no parameter/family/QC changes after.
6. Same-session cross-correlation (by length/component/duration) + graph
   sensitivity (star/MST/alternate deterministic trees, coordinate/SEUW spread)
   retested on expanded corpus; verdict SPANNING_TREE_SUFFICIENT_INITIAL or
   CROSS_COVARIANCE_REQUIRED.
7. Broadcast bounded subset + 61mm-outlier investigation; formal-covariance
   internal-consistency check (duration/geometry/length/epoch ordering);
   absolute-oracle search (EPN SINEX/EUREF/ROB/ITRF; else ACCURACY UNRESOLVED);
   cross-corpus comparison (Wettzell/Dataset-B external only, never pooled).

## 10. Certification rule

CONFIRMATION_PASSED only if: VALIDATION selects it; TEST remains plausible;
≥10 independent loops support it; no severe length trend in certified range;
no severe H/V underestimation; day-to-day parameters stable; no bias hidden
as variance. Certified scope states constellation/mode/solution/antenna/
elevation/ephemeris/length-range/duration/processor/reference/dependency
with no extrapolation. Else REVIEW_ONLY_FINAL (acceptable terminal result;
no automatic follow-up fitting phase). DIRECT_INGEST: NO in this phase.

## 11. Artifacts

- Report: `reports/gnss/phase12j8-covariance-confirmation.md` (§50 fields).
- Scripts/config only committed; no RINEX/SP3/ANTEX source corpus.
  Manifest: URLs/DOI/license/hashes/dates/stations/versions/options-hash.
- ANTEX verdict: PRODUCTION_READY_WITH_SUBSET / READY_WITH_SIZE_BOUND /
  REVIEW_ONLY / NO_GO. Graph verdict + DIRECT_INGEST:NO recorded.
