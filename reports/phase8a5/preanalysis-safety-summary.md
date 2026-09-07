# Phase 8A.5 preanalysis safety calibration (test-only, no routing)

- corpus=38 workerRuns=6 stressSessions=50 cancelSupported=true
- P0 admits=33 falseAdmits=4 falseRejects=5 | P1 admits=8 falseAdmits=0 falseRejects=26 | P2 admits=5 falseAdmits=0 falseRejects=29 | P3 admits=6 falseAdmits=0 falseRejects=28 | P4 admits=1 falseAdmits=0 falseRejects=33

## Does condition predict user-visible error? No (absolute form)

The recorded condition is the raw normal-matrix norm product, which scales
with weight magnitudes: healthy star cases condition at ~1e16-1e17 while the
healthy maximum here is 3.088e+17 and GPS cases sit near 4e8.
The production warn threshold 1e12 therefore rejects healthy cases, so an
absolute condition gate cannot predict the user-visible final contract — the
planning correction is computed then discarded, and the final covariance
contract passes regardless. Condition predicts only dense-oracle correction
agreement (P2), where the camp case separates by ~35 orders of magnitude.

## Camp diagnosis

- p-camp-bounded conditions at 1.16e+51 (dof 365, solves 17);
  the dense oracle disagrees with every backend correction while the final
  contract still passes exactly (correction discarded). P1-P4 reject it
  conservatively (P1, P2, P4 false rejects counted);
  P0 admits it. Any future strategy must treat high-condition planning
  geometry as correction-unverifiable, never as result-wrong.

## Proposed caps (evidence-based, not enforced)

- Unknown cap 128 (existing evidence cap): the 256-unknown case runs direct-TS
  but P0 rejects it; all worker runs stay within cap.
- Session solve cap 64 (proposal): maximum observed session solves fit below it;
  caps template + impact scenarios alongside the unknown cap.
- Condition: warn-only, never a preanalysis reject gate (correction discarded).

## Phase 8B GO / NO-GO

- NO-GO for automatic sparse preanalysis routing on any absolute condition gate.
- Conditional GO only for a bounded S0+P3-sentinel evidence path: static admission,
  session solve cap, final-contract sentinel agreement, warn-only condition.
- Rank/underdetermined geometries stay excluded: static admission cannot see rank
  (expected P0 false admits recorded above). P0 false rejects are deliberate policy:
  the 256-unknown over-cap case plus the 3D/GPS-covariance/robust/TS-correlation
  exclusions, all with passing direct-TS solves.

## Limitations

- P3 sentinel is test-only dense-vs-sparse from the existing result contract;
  true selected-vs-dense covariance capture was not attempted (invasive).
- Direct-only cases fail P2/P3 closed (no oracle/sentinel evidence by design).
- Timings are scaling evidence only and never gated.
