# Engine guidance

## Scope
This directory contains parsing, adjustment, stochastic modeling, diagnostics, reduction modeling, precision propagation, output builders, and related engine workflows.

## Core invariants
- Internal math uses meters and radians.
- Do not move unit conversion into the solve core unless there is a strong reason and test coverage proves the change safe.
- Preserve deterministic solve, diagnostics, report, listing, and export ordering.
- Treat parser and solver changes as high risk because they affect parity fixtures, residuals, covariance propagation, and listing output.

## Parser changes
- Preserve source-file and source-line traceability.
- Do not silently drop directives, records, inline options, or include-state behavior.
- Prefer explicit diagnostics over permissive fallback when behavior is ambiguous.
- Include-scope state must restore correctly; child include state must not leak upward unless the design explicitly requires it.
- Alias and canonical-ID handling must remain stable before unknown-building and traceability output.

## Solver changes
- Avoid result-changing refactors unless the task explicitly calls for behavior change.
- Preserve deterministic weighting, reduction, covariance, and residual-summary behavior.
- Keep ellipse and precision-propagation logic numerically stable and well-covered.
- For regularization, conditioning, or factorization changes, preserve fail-cleanly behavior and update diagnostics and focused tests.

## Parity-sensitive areas
Treat the following as parity-sensitive:
- angular stochastic modeling
- centering inflation
- direction-set reduction and treatment
- residual sign and displayed sigma behavior
- confidence and ellipse formatting
- report or listing row inclusion and ordering
- connected-pair and relative-precision sections
- default-vs-explicit sigma resolution

## Validation when touching engine code
Run at minimum:
- the most relevant focused test file(s)
- `npm run lint`
- `npm run typecheck`
- `npm run test:run`

If the change affects parity-sensitive behavior, also run:
- `npm run parity:industry-reference`

If the parity baseline worsens, revert the change or update fixtures, tests, and `docs/PARITY_WORKFLOW.md` with a clear reason.
