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

## MDB power limitation

MDB uses the legacy 3.29 detection scaling in every mode, which corresponds
to roughly **50% detection power**. Beta-aware (power-specified) MDB is
deferred to Phase 14B.

## Preanalysis and data check

Formal local tests are disabled there: preanalysis predicts precision from
planning geometry (no residuals exist), and data check reports approximate
|t| screening values only. Neither mode is relabeled as Baarda/Pope; the
report shows the standard disabled-messaging sections instead.

## Language

Flagged observations are *suspect* and warrant review (re-observe, check
setup/sigma, exclude and re-run). They are never "proven blunders" — a local
test rejects "no blunder here", it does not prove one.
