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
a-posteriori SEUW and the same clamped redundancy r as the statistical
model. Roughly 50% detection power; alpha/power settings are ignored.
- **Statistical** — single-alternative Baarda MDB0 = δ0 · sigma / sqrt(r),
with the a-priori sigma (**no SEUW factor** — pure a-priori per
Teunissen) and δ0 = z(1−α/2) + z(power) from normal theory. The
statistical MDB intentionally omits the SEUW multiplier, so legacy and
statistical MDBs differ by δ0/(3.29·seuw); on a seuw = 1 run the ratio
is exactly δ0/3.29.

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
Power" for exactly this meaning.

### Pope approximation honesty

The normal-theory δ0 is exact for the Baarda w-test (sigma0 known). Under
the Pope τ-test (sigma estimated) the exact test needs a noncentral-t
noncentrality, so the run summary flags method
`approximation-normal-for-tau` and the report shows an "(approximate)"
note. Legacy-fixed runs keep method `legacy-3.29`.

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
Correlated equations (TS groups, GPS blocks, CTRLXY pairs) always use
the true P column.
- **Preanalysis / data check**: preanalysis has no per-observation MDBs
and data check reports screening values only; external reliability is
unavailable there and the RELIABILITY strip is suppressed.
- **Untestable rows** (r ≤ 1e-12, non-finite MDB) carry no external
influence (`untestable-no-mdb`).

### Sign and linearity

External influence is first-order / local-linear theory
(Baarda/Teunissen): dx̂ = +Qxx · A′ · P · eᵢ · ∇0, with the **positive**
sign verified empirically against brute-force perturb-by-MDB re-solves.
Effects scale linearly with the MDB; the shift vector is the +MDB
response.

### GPS component semantics

Scalar equations carry one `external` influence; multi-row observations
(GPS) carry per-component entries (`externalComponents` E/N/U). The
CoordEff column and worst-external ranking use the strongest component
(max primaryMm). The aggregate is a max over scalar component effects,
not a joint/vector multivariate influence; a vector test is not
implemented.

### Unit rules

Internal MDBs stay in native observation units (arcsec for angular,
length units for linear); angular rows additionally carry the linear
equivalent `mdbLinearMm`. All external shifts are millimetres. Worst-
internal MDBs rank **within compatible unit groups only** (angular vs
linear); worst-external ranks by primaryMm in millimetres, which is
cross-type comparable and labeled "Coordinate influence".

## Preanalysis and data check

Formal local tests are disabled there: preanalysis predicts precision from
planning geometry (no residuals exist), and data check reports approximate
|t| screening values only. Neither mode is relabeled as Baarda/Pope; the
report shows the standard disabled-messaging sections instead.

## Language

Flagged observations are *suspect* and warrant review (re-observe, check
setup/sigma, exclude and re-run). They are never "proven blunders" — a local
test rejects "no blunder here", it does not prove one.
