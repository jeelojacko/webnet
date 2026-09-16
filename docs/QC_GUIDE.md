# Statistical quality-control guide

Workflow-first reading order for the adjustment QC chain. Each step says what
question it answers, how to read the verdict, and where the math lives. Deep
formulas stay in [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md) (the
authoritative math reference); this guide is the route through it. Canonical
concept definitions match the registry in
`src/engine/statisticalSemantics.ts` verbatim in meaning (see Glossary).

Read top to bottom: each step narrows the previous one.

## 1. Overall network test (GLOBAL STATISTICAL TEST)

Question: "Is the network *globally consistent* with the stated precisions?"
Read SEUW first, then the verdict: the global chi-square test of the variance
factor at 95% confidence is the formal verdict — PASS means globally
consistent, and it says nothing about *which* observation is suspect. SEUW
near 1 usually indicates realistic stochastic modeling, but SEUW alone is not
the verdict.
Math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#global-statistical-test-global-statistical-test).

## 2. Individual tests (LOCAL OBSERVATION TESTING)

Question: "Is this *individual residual unusually large* under the run
policy?" Each testable scalar equation gets one standardized-residual
statistic compared against one run-level critical value. A FAIL means
*flagged/suspect warranting review* — never proven blunder. Statistic symbol
follows the run policy (w when sigma0 known, τ when estimated), never bare
"t"; 2D GNSS shows per-component E/N verdicts where available.
Policies and math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#local-observation-testing-local-observation-testing).

## 3. Reliability (RELIABILITY)

Question: "What *bias size* would be detectable *here*?" The MDB is a
planning/detectability number per observation, not a verdict. Two models:
legacy 3.29 scaling (roughly 50% detection power) and the statistical
single-alternative Baarda MDB0 from the run reliability alpha/power — the two
are not interchangeable. Coordinate influence (CoordEff) is the first-order
displacement a just-detectable bias would cause: a detectability scale, not a
measurement.
Math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#reliability-reliability).

## 4. Stochastic diagnostics (STOCHASTIC MODEL DIAGNOSTICS)

Question: "Are any observation *group's* stated precisions off?" One
first-pass Förstner-style scale per group, s = √(Ω/R). Keep the four group
numbers apart: legacy error factor (descriptive, no redundancy), descriptive
factor √(Ω/n) (no claim), first-pass diagnostic s² = Ω/R (empirical scale,
not unbiased VCE), full VCE (not computed — no auto-reweighting). The
top-of-report pointer appears only when the global test fails, and it names a
first-pass pointer only.
Math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#stochastic-model-diagnostics-stochastic-model-diagnostics).

## 5. Leave-one-out influence (LEAVE-ONE-OUT INFLUENCE)

A what-if, not a verdict: each candidate is re-solved with exactly that
observation excluded, and the report compares base vs alternate (SEUW, global
chi-square, worst standardized residual, local-failure count, actual
coordinate shifts). Nothing is ever excluded automatically. CoordEff (step 3)
is the coordinate change a *just-detectable* bias would cause; the LOO shift
is the *actual* re-solve change for *this* residual — the two must not match.
Math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#leave-one-out-influence-leave-one-out-influence).

## 6. Systematic patterns (SYSTEMATIC PATTERN DIAGNOSTICS)

Descriptive residual-pattern shape summaries (setup means, distance trend,
face balance, repeats, zenith, leveling drift, GNSS means, sign runs) with no
formal tests, no p-values, no significance claims — residuals are correlated
with rank-deficient covariance, so IID-based tests do not apply. Heuristic
ordering scores stay labeled as such: ranking aids, not statistics.
Math: [`STATISTICAL_TESTING.md`](STATISTICAL_TESTING.md#systematic-pattern-diagnostics-systematic-pattern-diagnostics).

## 7. Robust and free-network limitations

- Robust (Huber) reweighting: formal w/τ significance is approximate
  (classical distributions do not cover data-dependent reweighting); reported
  with a "(robust approximation)" note. Legacy-fixed verdicts unaffected.
- Free networks: absolute LOO shifts are datum-dependent (unavailable with
  reason; statistical comparison kept); external influence is unavailable
  (`free-network-datum`). Residual descriptors themselves are datum/gauge
  invariant.
- Sparse route: external reliability needs dense rows
  (`sparse-route-unavailable`) — never a silent diagonal approximation.
- Preanalysis / data check: formal local tests disabled (no residuals in
  preanalysis; screening values only in data check); no per-observation MDBs
  in preanalysis.

## Glossary

Kinds: **formal** = statistical test with a verdict; **formal-adjacent** =
supporting statistic with no verdict of its own (feeds a formal test);
**descriptive** =
summary number with no verdict; **what-if** = comparison re-solve, never
automatic. Wording matches `STATISTICAL_SEMANTICS` in
`src/engine/statisticalSemantics.ts`.

- **Standard error of unit weight** (SEUW; formal-adjacent; unitless): SEUW =
  sqrt(vTPv / DOF): overall consistency of residuals with stated precisions.
  Values near 1 usually indicate realistic stochastic modeling; the formal
  verdict is the global chi-square test, not SEUW alone.
- **Global chi-square model test** (CHI-SQUARE 95%; formal; T statistic,
  p-value, variance-factor interval): global model test of the variance
  factor against its 95% confidence interval. PASS means globally consistent
  with stated precisions; it says nothing about which observation is suspect.
- **Standardized residual** (StdRes; formal-adjacent; unitless): internally
  studentized residual tau = v / (seuw·sqrt(qvv)): residual divided by its
  a-posteriori standard error. |StdRes| > 1 warns, > 3 flags; this is the tau
  statistic (SEUW estimated), never plain "t". Only the local test beside it
  carries PASS/FAIL.
- **Local single-outlier data-snooping test** (Local; formal; verdict
  PASS/FAIL, - when not tested): per-equation single-outlier test of the
  standardized residual against one run-level critical value. A FAIL means
  flagged/suspect warranting review, never proven blunder; statistic symbol
  follows the run policy (w when sigma0 known, τ when estimated) — never
  bare "t".
- **Redundancy number** (Redund; descriptive; unitless 0–1): redundancy
  number r (0–1 checkability): fraction of an observation controlled by the
  network. Higher means better blunder detectability; low redundancy means
  weak checkability, not a failed test.
- **Minimal Detectable Bias, legacy 3.29** (MDB; descriptive; native
  observation units — arcsec angular, length linear): smallest bias
  detectable here from sigma and redundancy: MDB = 3.29 · seuw · sigma /
  sqrt(r). Legacy scaling at roughly 50% detection power; a
  planning/detectability number per observation, not a verdict — and not
  interchangeable with the statistical MDB.
- **Minimal Detectable Bias, statistical** (MDB; descriptive; native
  observation units): single-alternative Baarda MDB0 = δ0 · sqrt(qvv) / |R|
  from a-priori geometry with δ0 = z(1−α/2) + z(power). Pure a-priori (no
  SEUW factor); uses the run reliability alpha/power, never
  multiplicity-corrected — not interchangeable with legacy 3.29 scaling.
- **Coordinate influence of an MDB-sized bias** (CoordEff; descriptive; mm —
  horizontal magnitude in 2D, 3D magnitude in 3D): max station-coordinate
  displacement caused by an MDB-sized bias under the run reliability model. A
  first-order detectability scale for a just-detectable bias — unlike the
  leave-one-out shift, which is the actual re-solve change for this residual;
  the two must not be expected to match.
- **Leave-one-out coordinate shift** (Coord Shift; what-if; display length
  units, mm detail in tooltips): actual coordinate change from a what-if
  re-solve with exactly this observation excluded. Comparison only — nothing
  is ever auto-excluded. A large shift means "review this observation", never
  proven blunder.
- **First-pass stochastic group diagnostic scale** (Scale; descriptive;
  unitless factor ×): group sigma scale s = sqrt(Ω/R): observed variation
  relative to stated precision for this observation group. First-pass
  Förstner-style diagnostic only — not an unbiased variance-component
  estimate (no VCE computed, no automatic reweighting); > 1 means observed
  variation exceeds stated precision, < 1 means stated sigmas look
  conservative, ≈ 1 means consistent subject to estimation uncertainty.
- **Descriptive group factor** (Descr; descriptive; native group units):
  purely descriptive group spread sqrt(Ω/n) with no redundancy model. No
  statistical claim of any kind; never read as a variance component.
- **Legacy per-type error factor** (Error Factor; descriptive; unitless):
  industry-style descriptive scaling sqrt(Ω_group/n_group) rescaled by run
  totals; uses no group redundancy. Not Ω/R and never a variance component —
  must not be confused with the first-pass diagnostic scale s = sqrt(Ω/R).
- **Systematic residual-pattern descriptor** (Pattern; descriptive; as
  labeled per pattern): descriptive residual-pattern shape summary (means,
  slopes, runs) with no formal test. No p-values and no significance claims
  anywhere: residuals are correlated with rank-deficient covariance, so
  IID-based tests do not apply.
- **Heuristic ordering score** (Heuristic score; descriptive; unitless rank
  score): deterministic ordering aid only — prioritizes likely suspect rows
  for review. Not a statistical test, probability, or significance; stable
  ranking only.
