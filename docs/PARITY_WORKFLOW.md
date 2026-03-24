# Parity Workflow

## Purpose
This document defines the validation posture for parity-sensitive changes in WebNet. Use it whenever a task may affect behavior that is intentionally kept close to an industry-standard reference workflow.

## What counts as parity-sensitive
Treat a change as parity-sensitive if it touches any of the following:

- parser semantics that change which rows are active or how they are interpreted
- default-vs-explicit sigma resolution
- weighting or stochastic-model behavior
- centering inflation
- angular modeling or display
- direction-set reduction or orientation handling
- GNSS preprocessing that changes modeled observation values or sigmas
- covariance propagation, ellipse derivation, or confidence scaling
- residual sign, displayed sigma, or standardized-residual behavior
- listing/report row inclusion, ordering, formatting, or displayed rounding
- connected-pair relative precision or azimuth-confidence sections
- industry-style output section ordering or column formatting

If uncertain, treat the change as parity-sensitive.

## Required validation for parity-sensitive work

### Minimum validation
Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run parity:industry-reference`

### Additional focused validation
Also run the narrowest relevant suites for the area changed. Examples:
- parser-family tests for directive or record changes
- precision-propagation tests for covariance/ellipse work
- listing-format tests for textual formatting changes
- computational parity harness tests for reference-case behavior

## Reference-diff rule
The reference diff gate is the primary machine-readable guard for parity-sensitive work.

Use this rule:
- if the reference diff improves or stays neutral, continue
- if the reference diff worsens, revert or revise the change unless there is a clear, intentional reason to update the expected baseline

Do not keep a parity-sensitive change merely because the general suite still passes.

## When it is acceptable to update fixtures or baselines
Fixture or baseline updates are acceptable only when at least one of the following is true:

1. The change fixes a known bug and the reference output should now shift.
2. The change aligns WebNet with an intentionally chosen industry-style behavior that the previous baseline did not reflect correctly.
3. The change is a deliberate product decision that supersedes the older parity target.

When updating fixtures or baselines:
- keep the delta as small as possible
- update only the affected expectations
- explain the reason in the test and nearby docs
- update `docs/CURRENT_BEHAVIOR.md` when the maintained product contract changed

## Key contracts to preserve

### Ordering and formatting
Preserve deterministic behavior for:
- section ordering
- row ordering
- tie-break ordering
- column spacing and padded output
- displayed precision and rounding

### Weighting and stochastic behavior
Preserve behavior for:
- default instrument and observation sigma resolution
- explicit sigma overrides
- centering-model geometry stage assumptions
- robust-vs-classical weighting behavior
- direction-set reduction and reduced sigma treatment
- fixed-sigma and weighting-source traceability

### Precision and confidence outputs
Preserve behavior for:
- covariance recovery path and diagnostics
- station sigma and ellipse sections
- relative precision rows
- connected-pair azimuth/distance orientation choice
- 95% confidence constants and display formatting

## Practical review checklist
Before finishing parity-sensitive work, verify:
- active observations are still the intended rows
- no unexpected rows were added or dropped from listing output
- displayed residual signs still match the intended convention
- displayed `StdRes` normalization still matches displayed weighting sigmas
- connected-pair relative sections still use the intended orientation source
- error-propagation sections still render deterministically

## Common traps
Common ways parity work regresses unexpectedly:
- small parser fallbacks change record activation or scoped state
- rounded constants are used where exact constants were previously required
- ordering changes come from sorting by display strings instead of canonical values
- output builders re-derive geometry from a broader pair list instead of the connected covariance row
- confidence or PPM values are computed from rounded display values instead of full adjusted values
- UI or output cleanup removes rows that are still contractually required by fixtures

## Related tests and artifacts
Parity-sensitive review often touches fixtures and tests such as:
- computational parity harness coverage
- industry-reference diff coverage
- listing-format regression tests
- precision propagation tests
- adjust/solver-focused regression tests
- centering geometry fixtures
- inline-option matrix and solve-profile output tests

Keep those suites aligned with the smallest intentional surface area possible.

## Process note
When a parity-sensitive batch is complete:
- update `TODO.md` if the parity task status changed
- update `docs/CURRENT_BEHAVIOR.md` if supported behavior changed
- keep `AGENTS.md` concise; do not move parity history back into the instruction files
