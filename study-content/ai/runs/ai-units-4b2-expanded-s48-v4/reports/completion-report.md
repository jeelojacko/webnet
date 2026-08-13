# Phase 4B.2 Expanded V4 Pilot Completion Report

## Run
- Run ID: ai-units-4b2-expanded-s48-v4
- Prompt spec: unit-authoring-v4
- Jobs: 48
- Batches: 6

## Sample
- Acts: 41
- Regulations/Bylaws: 7
- Unique documents: 16
- Category distribution: {"deadlines-time-periods":26,"discretionary-powers":40,"duties":42,"exceptions-qualifiers":33,"filing-registration":32,"legal-effect":32,"notice":17,"procedure":38,"regulation-making":26,"surveying-specific":37,"prohibitions":21,"definitions":6,"offence-penalty":12}
- Complexity distribution: {"stress-test":30,"medium":10,"complex":6,"simple":2}

## Validation
- Valid clean: 47
- Warning-valid: 1
- Invalid: 0
- Malformed: 0
- Stale: 0
- Duplicate: 0

## Warning Distribution
- UNSUPPORTED_NUMERIC_OR_REFERENCE: 1; affected proposals: 1

## Legal Fidelity
- Context leakage: 0
- Outside-focus leakage: 0
- Actor mismatch: 0
- Modality mismatch: 0
- Numeric/reference drift: 1
- Qualifier-loss warnings: 0
- Unsupported claims/errors: 0

## Evidence
- EVIDENCE_INCOMPLETE_FOR_ANSWER count: 0
- ANSWER_EXTENDS_BEYOND_EVIDENCE count: 0
- Average evidence items/objective: 1.00
- Preserved V3 pilot comparison is in v3-v4-comparison reports.

## Educational Diagnostics
- Generic questions: 0
- Duplicate questions: 0
- Long answers: 0
- Malformed questions: 0
- Too many objectives: 3
- Broad Map groups: 2

## V3/V4 Controls
- Mechanical comparison only; no human quality rating assigned.

## Map Revisions
- doc-community-planning-act Administrative, appeal, delegation, and transitional regulation powers: {"reason":"The approved focus combines public-purpose land, money handling, procedure, summary delivery, filing, and retroactivity rules, which is too broad for one durable retrieval-practice StudyUnit.","proposedGroups":[{"title":"Subdivision land or money for public purposes","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(10)","125(11)","125(12)"]}],"approximateLearningGoal":"Recall how public-purpose land and money rules apply to subdivision regulations."},{"title":"Procedure before making subdivision rural plan regulations","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(13)","125(14)"]}],"approximateLearningGoal":"Recall the Ministerial summary and delivery steps before making these regulations."},{"title":"Filing and retroactive effect of subdivision rural plan regulations","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(15)","125(16)"]}],"approximateLearningGoal":"Recall filing duties and limits on retroactive effect."}]}
- doc-community-planning-act Subdivision public-purpose land, money, procedure, summary, and filing rules: {"reason":"The approved focus combines public-purpose land, money handling, procedure, summary delivery, filing, and retroactivity rules, which is too broad for one durable retrieval-practice StudyUnit.","proposedGroups":[{"title":"Subdivision land or money for public purposes","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(10)","125(11)","125(12)"]}],"approximateLearningGoal":"Recall how public-purpose land and money rules apply to subdivision regulations."},{"title":"Procedure before making subdivision rural plan regulations","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(13)","125(14)"]}],"approximateLearningGoal":"Recall the Ministerial summary and delivery steps before making these regulations."},{"title":"Filing and retroactive effect of subdivision rural plan regulations","sourceKeys":["section:125"],"focusSelections":[{"sourceKey":"section:125","childLabels":["125(15)","125(16)"]}],"approximateLearningGoal":"Recall filing duties and limits on retroactive effect."}]}

## Artifacts
- Selection JSON: reports/expanded-pilot-selection.json
- Selection MD: reports/expanded-pilot-selection.md
- Jobs: study-content\ai\runs\ai-units-4b2-expanded-s48-v4/jobs
- Raw results: study-content\ai\runs\ai-units-4b2-expanded-s48-v4/results
- Validation: study-content\ai\runs\ai-units-4b2-expanded-s48-v4\reports/unit-validation.json and .md
- Proposals: study-content\ai\runs\ai-units-4b2-expanded-s48-v4\reports/unit-proposals.json
- Expanded review: study-content\ai\runs\ai-units-4b2-expanded-s48-v4\reports/expanded-pilot-review.json and .md
- Deterministic comparison: study-content\ai\runs\ai-units-4b2-expanded-s48-v4\reports/deterministic-comparison.json
- V3/V4 comparison: study-content\ai\runs\ai-units-4b2-expanded-s48-v4\reports/v3-v4-comparison.json and .md

## Checks
- npm install: passed
- lint: passed
- typecheck: passed
- focused tests: passed (`tests/study/study_ai_authoring.test.ts`, `tests/study/study_ai_unit_validation_calibration.test.ts`)
- full tests: passed
- build: passed

EXPANDED V4 PILOT READY FOR HUMAN REVIEW
