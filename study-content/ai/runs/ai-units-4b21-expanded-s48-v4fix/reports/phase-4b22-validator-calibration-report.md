# Phase 4B.2.2 Validator Calibration Report

Run: ai-units-4b21-expanded-s48-v4fix

## Before
Clean-valid: 16
Warning-valid: 32
Invalid: 0
Total warnings: 125

- ANSWER_APPEARS_TRUNCATED: 66
- ANSWER_EXTENDS_BEYOND_EVIDENCE: 23
- EVIDENCE_INCOMPLETE_FOR_ANSWER: 9
- POSSIBLE_MODALITY_MISMATCH: 1
- UNSUPPORTED_NUMERIC_OR_REFERENCE: 26

## After
Clean-valid: 46
Warning-valid: 2
Invalid: 0
Total warnings: 2

- POSSIBLE_MODALITY_MISMATCH: 1
- UNSUPPORTED_NUMERIC_OR_REFERENCE: 1

## Deltas
Truncation warnings removed: 66
Reference warnings removed: 25
Evidence warnings removed: 32

## Remaining Warnings
- UNSUPPORTED_NUMERIC_OR_REFERENCE unit-2fa5132093e8c1e1/cpa125g3-2: section 53 - Objective cpa125g3-2 answer includes unsupported numeric or legal-reference token "section 53" for question "What kinds of powers may be vested or adapted for a zoning regulation or zoning provisions in a rural plan under section 125?".
- POSSIBLE_MODALITY_MISMATCH unit-e6cd7bbc18ac8615/euba491-2: answer=prohibition,duty; source=permission - Objective euba491-2 may change legal modality for question "What must have happened before a non-party regulator may assist the Board under subsection 49.1(2)?".

## Readiness
PHASE 4B.2.2 VALIDATOR CALIBRATION PASSED — READY FOR FULL-CORPUS BATCH PIPELINE
