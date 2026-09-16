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
- **First-pass diagnostic s_k²** (diagnostics table, Förstner-style):
  Ω_k/R_k, the first iteration of the IAUE scheme. This is an empirical
  first-pass diagnostic scale, NOT an unbiased variance-component estimate:
  under parameter coupling E[Ω_k] = Σ_l a_kl θ_l mixes the variance
  components of ALL groups, so group-uncorrelatedness alone (the
  disjunctive group model: groups mutually uncorrelated, arbitrary
  correlation within a group, GNSS covariance blocks included) does NOT
  imply unbiasedness — negligible between-group coupling through the
  parameters would additionally be required. Iterated to convergence the
  scheme becomes Helmert/MINQUE/REML; what is reported here is deliberately
  the first iteration only, so simultaneous multi-group VCE is deferred.
- **Full VCE**: not computed. There is no iterative re-solve and no
  automatic reweighting — diagnostics only.

Validity conditions and gates:

- **Constraint exclusion (reporting policy)**: weighted coordinate controls
  ARE finite-sigma pseudo-observations with L/A/P rows that enter the normal
  matrix, Qxx, and the global vTPv — they are not covariance-free (only truly
  fixed coordinates are). They are excluded from groups by reporting policy
  to keep datum/constraint semantics separate from observation-group
  diagnostics, not because they lack covariance. Group quadforms therefore
  sum below the global vTPv by exactly the constraint contribution (plus the
  TS-correlation vTPv delta, which is distributed to groups via
  off-diagonal cross terms).
- **Same-group TS correlation**: intra-group pairs enter R with the FULL
  cross-cofactor Qvv_AB = Qll_AB − a_A·Qxx·a_B', where
  Qll_AB = ρ·σ_A·σ_B for pairs sharing a TS-correlation group (same capped ρ
  as the weight build); Ω cross terms use the full P. Omitting the Qll term
  would understate same-group redundancy.
- **Correlated pairs spanning two groups** (e.g. an angle + direction at
  the same setup under setup-scoped TS correlation) are never split: every
  affected group is marked UNESTIMABLE, fail closed, with its
  quadform/descriptive values withheld (never shown as partial numbers).
- **Single-equation groups** are always UNESTIMABLE: one equation carries no
  redundancy check even when R looks positive.
- **Finiteness gates**: Ω, R, s², and the scale must each be finite; a
  non-finite anywhere yields UNESTIMABLE, never a NaN scale.
- **Robust mode** (Huber reweighting active), **preanalysis**, and
  **data-check** runs report UNAVAILABLE: first-pass diagnostics are
  inapplicable to frozen weights, and no LS residual covariance exists in
  the latter modes.
- **Standalone GNSS-baseline route**: runConstrainedGnssBaselineAdjustment
  builds no group diagnostics (no residual-covariance plumbing there), so
  stochastic diagnostics are unavailable for that route by contract. In the
  main route, static-GNSS baselines would join the GPS group as one 3-row
  full-covariance block each (equation counts, never observation counts).
- **Chi-square confidence intervals apply to the global variance factor
  only** and are never attached to group components.
- The top-of-report pointer line ("Global stochastic model check failed.
  First-pass pointer only … largest/smallest diagnostic group scale: …")
  appears ONLY when the global chi-square fails; a passing global test
  carries no per-group correctness implication. Upper-tail failure points at
  the largest scale (stated sigmas may be optimistic); lower-tail failure
  points at the smallest scale (stated sigmas may be conservative). The
  wording is deliberately first-pass ("may indicate"): parameter coupling
  means no single group is proven responsible. Scale reading is neutral:
  > 1 means observed variation exceeds stated precision, < 1 means stated
  sigmas look conservative, ≈ 1 means consistent subject to estimation
  uncertainty. No red/yellow/green threshold coloring is applied.
- Redundancy displays adaptively (tiny-but-positive R in exponential
  notation, never "0.000" beside a confident-looking scale), and
  low-redundancy diagnostic rows are labeled indicative-only.

Overhead: the diagnostics consume the solve residuals and the UNCLAMPED Qvv
diagonal map directly (no solver import, no re-solve — 0 extra solves). The
clamped per-equation qvv is never reused here: clamping hides R ≈ 0 and would
fabricate a diagnostic scale from a singular group. Measured mean
compute time 0.143ms for ~1k equations (vs ~2.5ms for a full
7-observation solve on the same machine, 2026-09-16).

## Leave-one-out influence

A what-if, not a verdict. Each candidate is re-solved with exactly that
observation excluded (BASE vs ALTERNATE vs IMPACT): the report compares the
base run against the alternate run and shows what changed — SEUW, global
chi-square, worst standardized residual, local-failure count, and the actual
coordinate shifts from the re-solve. Nothing is ever excluded automatically;
the only exclusion path is the explicit Exclude + Re-run action with a
confirm guard.

- **Candidates**: local-FAIL or |StdRes| >= 2, at most 3, ordered by the
  transparent hierarchy (ok first, base local-FAIL first, base |StdRes|
  descending, chi FAIL→PASS first, local-fail reduction, max shift,
  observation id). There is no heuristic score.
- **Observation-level deletion contract**: scalar rows delete one row; a GPS
  observation deletes the whole vector (the observation row stays listed with
  unavailable statistics but contributes no equations); correlated-TS setups rebuild fully;
  direction sets recompute (removing the last target removes the set).
- **CoordEff vs LOO shift**: CoordEff (reliability section) is a first-order
  MDB effect — the coordinate change a *just-detectable* bias would cause.
  The LOO shift is the *actual* re-solve change for *this* residual. The two
  must NOT match; one is a detectability scale, the other a measured
  what-if.
- **SEUW honesty**: a lower alternate SEUW is not "better" below 1 — it
  means the remaining residuals look small against their sigmas. The formal
  test is the global chi-square, reported before/after with T, DOF, p, and
  PASS/FAIL.
- **Chi-square DOF-change caveat**: excluding an observation changes the
  degrees of freedom, so base and alternate chi-square values live on
different distributions; the PASS/FAIL comparison is indicative, not a
  formal nested test.
- **Free-network runs**: absolute coordinate shifts are datum-dependent
  without fixed control, so shifts render unavailable-with-reason while the
  statistical comparison is kept.
- **Robust re-solves** are labeled as such: classical distributions do not
  cover data-dependent reweighting.
- **Aborted alternates** (singular, too few observations, solver failure)
  are marked failed with the reason and never ranked as improvements.
- **No blunder claims**: a large influence means "review this observation",
  never "proven blunder" (see Language).

Overhead: up to 3 extra full solves; auto mode skips them when the main
solve already took over 5 s.

## Preanalysis and data check

Formal local tests are disabled there: preanalysis predicts precision from
planning geometry (no residuals exist), and data check reports approximate
|t| screening values only. Neither mode is relabeled as Baarda/Pope; the
report shows the standard disabled-messaging sections instead.

## Language

Flagged observations are *suspect* and warrant review (re-observe, check
setup/sigma, exclude and re-run). They are never "proven blunders" — a local
test rejects "no blunder here", it does not prove one.
