# Unit V5 production gate

- Run: `ai-units-2026-09-02-frozen-map-cal80-v5`
- **productionAuthorized: false**
- studyMapReopenRecommended: false

## Gate checks

| Check | Result |
| --- | --- |
| preflightValid | true |
| calibration80Completed | true |
| v5FidelityGateInstalled | true |
| postHumanQcRevalidationRan | true |
| postHumanQcInvalidUnits | 37/80 |
| allNamedQcFixturesCaught | true |
| remediation1RunComplete | false |
| humanDeltaReviewComplete | false |

## Blocking reasons

- The new V5 fidelity gate invalidates 37 of the 80 previously accepted units (dominant codes: SOURCE_COVERAGE_EXTRA_LABEL x63, EVIDENCE_NOT_EXACT_VERBATIM x37, SOURCE_COVERAGE_MISSING_SELECTED_LABEL x16); the frozen-run outputs are not yet production-grade.
- Remediation1 repair run (same 80 jobs, same frozen map) has not been executed.
- Human delta review of the remediated vs accepted units is not complete.
- The 4,251-job full production run remains unauthorized pending the above.
