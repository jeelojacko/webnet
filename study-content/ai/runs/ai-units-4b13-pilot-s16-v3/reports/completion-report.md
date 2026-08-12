# Phase 4B.1.3 Unit Authoring Pilot Completion Report

## Run

- Run ID: `ai-units-4b13-pilot-s16-v3`
- Source Map run: `ai-map-4b12-grounding-s9-v1`
- Prompt spec: `unit-authoring-v3`
- Jobs: 16
- Batches: 2 batches of 8 jobs

## Validation

- Unit proposals: 16
- Valid without warnings: 3
- Warning-valid: 13
- Invalid: 0
- Malformed: 0
- Duplicate: 0
- Stale: 0

## Legal Fidelity Diagnostics

- Context leakage: 0 blocking errors
- Outside-focus leakage: 0 blocking errors
- Actor mismatch: 0 warnings
- Modality mismatch: 19 conservative warnings
- Unsupported numeric/reference: 12 conservative warnings
- Unsupported answer claim: 5 conservative warnings

## Educational Diagnostics

- Generic question warnings: 0
- Duplicate question warnings: 0
- Long answer warnings: 0
- Too many objectives warnings: 0
- Broad Map group warnings: 1

## Community Planning Stress Test

Community Planning Act s.125 group 3 produced a usable but broad proposal and was flagged with `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` for human review.

## Artifacts

- Jobs: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/jobs/`
- Raw results: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/results/`
- Validation: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/reports/unit-validation.json`
- Proposals: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/reports/unit-proposals.json`
- Pilot review JSON: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/reports/pilot-unit-authoring-review.json`
- Pilot review Markdown: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/reports/pilot-unit-authoring-review.md`
- Deterministic comparison: `study-content/ai/runs/ai-units-4b13-pilot-s16-v3/reports/deterministic-comparison.json`

UNIT AUTHORING PILOT READY FOR HUMAN REVIEW
