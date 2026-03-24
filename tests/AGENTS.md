# Test guidance

## Principles
- Add focused regression coverage for every non-trivial parser, solver, export, import, or UI workflow change.
- Prefer fixture-backed tests when output structure, ordering, spacing, or traceability matters.
- Do not loosen tolerances or rewrite fixtures casually.

## Parity and fixture rules
- Treat parity fixtures and deviation baselines as contract tests.
- If output changes intentionally, update only the affected fixtures and explain the reason in the test or nearby docs.
- Preserve deterministic ordering in expected outputs.

## Coverage expectations
Add or update focused tests for:
- parser directives and record-family behavior
- solver math and diagnostics
- listing or text export formatting
- import-review workflows
- report, map, and operator workflows
- project save/load or recovery behavior

## Before finishing
- Run the narrowest relevant tests first.
- Then run the full suite before considering the change complete.
