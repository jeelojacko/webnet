# Statistical testing in WebNet

Three separate questions, three separate tools. Do not mix them.

- **Global chi-square test** — "Is the network *globally consistent* with the
  stated precisions?" Uses SEUW and DOF at 95% confidence. PASS means the
  variance factor is statistically consistent; it says nothing about *which*
  observation is suspect.
- **Local (single-outlier) data snooping** — "Is this *individual residual
  unusually large* under the run policy?" Each testable scalar equation gets a
  standardized-residual statistic compared against one run-level critical
  value. A FAIL means *flagged/suspect*, never "proven blunder".
- **MDB (Minimal Detectable Bias)** — "What *bias size* would be detectable
  *here* under the reliability model?" A planning/detectability number per
  observation from redundancy, sigma, and SEUW — not a verdict.

## Standardized residual

The per-equation statistic is the internally studentized residual

```
tau = v / (seuw * sqrt(qvv))
```

where `v` is the residual, `qvv` its cofactor, and `seuw` the a-posteriori
standard error of unit weight. Dividing by SEUW (rather than the a-priori
sigma0) is what makes it tau rather than w.

## Local-test policies

Set in Project/Adjustment settings (Special tab). The default everywhere is
**legacy-fixed**, which preserves the historical 3.29 verdicts for testable
   equations. Narrow exception: equations with zero residual variance
   (r_unclamped ≤ 1e-12) are intentionally reported as not tested
   (pass=null, shown as '-') rather than receiving clamp-derived verdicts —
   a deliberate fail-closed correction, the sole intentional legacy verdict
   change.

- **Legacy fixed (3.29)** — compares |tau| against the fixed threshold 3.29.
  3.29 is a rounded approximation to the two-sided alpha = 0.001 normal
  quantile (≈3.2905; Baarda's α₀ = 0.001); the repo records no original
  rationale for adopting it, so treat that correspondence as inference,
  not history. Alpha/correction settings are ignored in this mode.
- **Baarda w-test** — sigma0 treated as *known*. WebNet's absolute
  a-priori covariance convention sets known sigma0 = 1, so w = v / sqrt(qvv),
  compared against the normal quantile at the effective alpha.
- **Pope τ-test** — sigma *estimated* (SEUW). Statistic tau = v / (seuw·sqrt(qvv)),
  compared against Pope's tau critical value with the run DOF. |tau| is
  bounded by sqrt(DOF); at DOF ≤ 1 tau degenerates and equations are
  *untestable* (verdict null, shown as `-`).

## Alpha semantics

Alpha is the **false-positive rate** (fraction of clean equations expected to
flag), not a "confidence level". The entered alpha is the two-sided nominal
significance: it is the per-test level when correction is None, and the
target family-wise level (split over m) under Bonferroni/Šidák. The run
default for formal policies is 0.05. Custom entries are bounded to (0, 0.5].

## Multiplicity corrections

Formal policies optionally reduce the entered (nominal) alpha to a per-test level
over the run **test count = testable scalar equations** (each GPS component
counts separately):

- **None** — per-test alpha equals the entered alpha (no family-wise control claimed).
- **Bonferroni** — alpha / m.
- **Šidák** — 1 − (1 − alpha)^(1/m).

Caveat: Bonferroni controls the family-wise error rate regardless of
dependence (usually conservative when statistics are correlated). Šidák is
exact under independence and conservative for classical jointly Gaussian
Baarda two-sided tests via the Gaussian Šidák inequality, but it is not
generally guaranteed for Pope tests (shared SEUW) or Huber (approximate) —
do not claim correlated residuals make both corrections universally conservative.

## Known vs estimated variance

Baarda-w conditions on sigma0 as known and uses normal critical values;
Pope-tau propagates the fact that sigma was estimated from the same data and
uses tau critical values with DOF. In large networks the two agree closely;
in small networks they differ, and tau is the honest one.

## Robust-mode approximation

With Huber reweighting active, formal w/tau significance is **approximate**
(classical distributions do not cover data-dependent robust reweighting). Formal runs under
robust mode carry a `robustApproximation` flag, surfaced in the report as a
"(robust approximation)" note. Legacy-fixed verdicts are unaffected.

## Blunder-detect threshold

Blunder-detect mode keeps its own separate screening threshold (3) and is
unchanged by the local-test policy.

## TS correlation

When TS angular correlation is enabled, statistics are computed with the
correlated weights, so verdicts already reflect the correlation modeling.

## GPS handling

Each GPS vector contributes one scalar test per component (E/N, plus U in 3D).
The report shows per-component E:N verdicts for 2D GNSS where available and
the aggregate verdict for 3D GNSS. The aggregate row verdict is OR/max over
the scalar component tests and is not a joint/vector multivariate test;
a vector test is not implemented.

## Reliability (MDB) models

Set in Project/Adjustment settings (Special tab), beside the local-test
policy. The default everywhere is **legacy-3.29**, which preserves the
historical MDBs bit-identically for old projects (no migration).

- **Legacy 3.29** — MDB = 3.29 · seuw · sigma / sqrt(r), with the
a-posteriori SEUW and the clamped diagonal redundancy r = qvv_clamped/qll.
Roughly 50% detection power; alpha/power settings are ignored. The legacy
computation is bit-identical to the pre-14B code path.
- **Statistical** — single-alternative Baarda MDB0 = δ0 · sqrt(qvv_ii) / |R_ii|,
with the a-priori residual cofactor qvv_ii (**no SEUW factor** — pure
a-priori per Teunissen), δ0 = z(1−α/2) + z(power) from normal theory,
and the correlated scalar-residual sensitivity R_ii = (Qvv·P)_ii =
1 − (A·Qxx·A′·P)_ii summed over the true weight-matrix column (see
below). The statistical MDB intentionally omits the SEUW multiplier; on
a diagonal-P seuw = 1 run the legacy/statistical ratio is exactly
δ0/3.29, but correlated blocks never share one clamped redundancy with
legacy (earlier text claiming they did was wrong).

### Correlated scalar-residual sensitivity

The project tests the scalar residual w_i = v_i / sqrt(qvv_ii), so the
matching single-alternative sensitivity is the diagonal of R = Qvv·P,
not the diagonal-only ratio qvv_ii/qll_ii (which equals R_ii only when P
is diagonal). R_ii = 1 − Σ_l (a_i·Qxx·a_l′)·P[l][i] runs over the rows
coupled to i: TS-correlation groups and GPS covariance blocks use their
full off-diagonal weights, everywhere else P[l][i] is exactly 0. Dense
and sparse row-product statistics evaluate the same sum (cross forms
come from B·a dots vs the row-product solver, including TS-group pairs),
so both paths agree. A row is testable under the statistical model when
|R_ii| > 1e-12 (finite); at or below that — or with a non-finite
qvv_ii/sensitivity/δ0 — the MDB is +Inf (untestable), never NaN.

Reference noncentralities (δ0):

| alpha | power 80% | power 90% | power 95% |
|-------|-----------|-----------|-----------|
| 0.05  | 2.802     | 3.242     | 3.605     |
| 0.01  | 3.417     | 3.857     | 4.221     |
| 0.001 | 4.132     | 4.572     | 4.935     |

(Default alpha 0.001 / power 80% gives δ0 = 4.132, λ0 = 17.07.)

### Alpha semantics (reliability)

The reliability alpha is a **separate single-alternative α₁** (default
0.001), independent of the local-test policy alpha. It is **not**
multiplicity-corrected: the statistical MDB is the single-alternative
Baarda upper bound (Rofatto), with no Bonferroni/Šidák adjustment even
when the local-test policy uses one — documented, not corrected.

### Power semantics

Power is the probability of detecting a bias of MDB magnitude under the
selected reliability model. The report labels the power input "Detection
Power" for exactly this meaning. Valid powers are finite 0.5 <= power < 1
(alpha stays finite in [1e-12, 0.5]); an out-of-range direct policy makes
the statistical summary unavailable (`available: false` with an
invalid-alpha/invalid-power reason, δ0 = +Inf) instead of being clamped
into range, and every per-row statistical MDB then reports +Inf.

### Pope approximation honesty

The normal-theory δ0 is exact for the Baarda w-test (sigma0 known). Under
the Pope τ-test (sigma estimated) the exact test needs a noncentral-t
noncentrality, so the run summary flags method
`approximation-normal-for-tau` and the report shows an "(approximate)"
note. Runs using the legacy-3.29 reliability model keep method
`legacy-3.29`; statistical reliability paired with the legacy-fixed local
policy uses that policy's tau-family statistic and is therefore flagged as
the same normal-for-tau approximation.

### Approximation and availability gates

- **Robust frozen weights**: under Huber reweighting the final weights are
data-dependent, so internal and external reliability are approximate
(flagged, never silent).
- **Free-datum gate**: on a free network (no fixed/weighted coordinate
components and no constraint rows) external influence is
datum-dependent and reported unavailable (`free-network-datum`). Any
anchored component keeps it available.
- **Sparse-route gate**: external reliability needs dense B/P rows; on the
sparse row-product route it is unavailable
(`sparse-route-unavailable`) — never a silent diagonal approximation.
Candidate TS and GPS equations always use the true P column. Correlated
CTRLXY rows are control constraints rather than candidate observation-bias
rows: their full block enters the normal matrix and Qxx, while observation
P columns have no cross-block weight to those constraints.
- **Preanalysis / data check**: preanalysis has no per-observation MDBs
and data check reports screening values only; external reliability is
unavailable there and the RELIABILITY strip is suppressed.
- **Untestable rows** (|R_ii| ≤ 1e-12, non-finite MDB) carry no external
influence (`untestable-no-mdb`). Under statistical selection the
propagated MDB is always the statistical one: an untestable statistical
row is never silently replaced by the legacy MDB.

### Sign and linearity

External influence is first-order / local-linear theory
(Baarda/Teunissen): dx̂ = +Qxx · A′ · P · eᵢ · ∇0, with the **positive**
sign verified empirically against brute-force perturb-by-MDB re-solves.
Effects scale linearly with the MDB; the shift vector is the +MDB
response.

### GPS component semantics

Scalar equations carry one `external` influence; multi-row observations
(GPS) carry per-component entries (`externalComponents` E/N/U). GPS
observations additionally carry per-component statistical MDBs
(`mdbStatisticalComponents` mE/mN, plus mU in 3D); the aggregate
`mdbStatistical` is the min over finite components. The
CoordEff column and worst-external ranking use the strongest component
(max primaryMm). The aggregate is a max over scalar component effects,
not a joint/vector multivariate influence; a vector test is not
implemented.

### Unit rules

Internal MDBs stay in native observation units (arcsec for angular,
length units for linear); angular rows additionally carry the linear
equivalent `mdbLinearMm`, computed from the **active run-model** MDB
(statistical when the run model is statistical, else legacy). Legacy
`obs.mdb` / `obs.mdbComponents` storage always keeps the historical
3.29-scaled value; the table, tooltips, worst-internal summary, and CSV
reliability columns select the active model at the display/export
boundary. In the observations/residuals CSV the legacy compatibility
columns (`mdb`, `mdbE`, `mdbN`) are unchanged, while the appended
active-model columns are explicitly prefixed (`reliabilityMdb`,
`reliabilityMdbLinearMm`, `reliabilityExternal*`). All external shifts are millimetres. Worst-
internal MDBs rank **within compatible unit groups only** (angular vs
linear); worst-external ranks by primaryMm in millimetres, which is
cross-type comparable and labeled "Coordinate influence".

## Stochastic group diagnostics (single-pass Förstner)

The report's STOCHASTIC MODEL DIAGNOSTICS section carries one row per
observation group with the single-pass Förstner component
s_k² = Ω_k / R_k, where Ω_k = v_k′P_kv_k uses the same weights as the
solve and R_k = tr(P_k·Qvv_k) is the full block trace (never a diagonal
sum). The sigma scale shown is s = √(Ω/R). Groups are ordered
deterministically (Angles, Directions, Distances, Az/Bearings, GPS,
Level Data, Zenith, then any Other group alphabetically).

Four related numbers must not be confused:

- **Legacy error factor** (Statistical Summary table): a descriptive
  sqrt(Ω_group/n_group)-style scaling, rescaled by the run totals. It is
  NOT Ω_g/r_g, uses no group redundancy, and must never be read as a
  variance component.
- **Descriptive factor** (diagnostics table): sqrt(Ω_k/n_k), purely
  descriptive, no statistical claim.
- **Förstner diagnostic s_k²** (diagnostics table): Ω_k/R_k, the first
  iteration of the IAUE scheme. Unbiased only under the **disjunctive
  group model**: groups mutually uncorrelated, arbitrary correlation
  within a group (GNSS covariance blocks included). Iterated to
  convergence it becomes Helmert/MINQUE/REML; what is reported here is
  deliberately the first iteration only, so between-group coupling is
  ignored and simultaneous multi-group VCE is deferred.
- **Full VCE**: not computed. There is no iterative re-solve and no
  automatic reweighting — diagnostics only.

Validity conditions and gates:

- **Constraint exclusion**: control-constraint rows carry no LS residual
  covariance in this formulation, so they are excluded from groups by
  design. Group quadforms therefore sum below the global vTPv by exactly
  the constraint contribution (plus the TS-correlation vTPv delta, which
  is distributed to groups via off-diagonal cross terms).
- **Correlated pairs spanning two groups** (e.g. an angle + direction at
  the same setup under setup-scoped TS correlation) are never split: every
  affected group is marked UNESTIMABLE, fail closed.
- **Robust mode** (Huber reweighting active), **preanalysis**, and
  **data-check** runs report UNAVAILABLE: classical VCE is inapplicable to
  frozen weights, and no LS residual covariance exists in the latter modes.
- **Chi-square confidence intervals apply to the global variance factor
  only** and are never attached to group components.
- The top-of-report pointer line ("Global stochastic model failed.
  Largest estimated group scale: …") appears ONLY when the global
  chi-square fails; a passing global test carries no per-group correctness
  implication. Scale reading is neutral: > 1 means observed variation
  exceeds stated precision, < 1 means stated sigmas look conservative,
  ≈ 1 means consistent subject to estimation uncertainty. No
  red/yellow/green threshold coloring is applied.

Overhead: the diagnostics consume the solve residuals and Qvv diagonal map
directly (no solver import, no re-solve — 0 extra solves). Measured mean
compute time 0.143ms for ~1k equations (vs ~2.5ms for a full
7-observation solve on the same machine, 2026-09-16).

## Preanalysis and data check

Formal local tests are disabled there: preanalysis predicts precision from
planning geometry (no residuals exist), and data check reports approximate
|t| screening values only. Neither mode is relabeled as Baarda/Pope; the
report shows the standard disabled-messaging sections instead.

## Language

Flagged observations are *suspect* and warrant review (re-observe, check
setup/sigma, exclude and re-run). They are never "proven blunders" — a local
test rejects "no blunder here", it does not prove one.
