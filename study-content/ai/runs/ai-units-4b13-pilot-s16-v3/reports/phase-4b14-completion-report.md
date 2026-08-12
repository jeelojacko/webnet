# Phase 4B.1.4 Unit Authoring Validation Calibration

Preserved baseline run:

```text
ai-units-4b13-pilot-s16-v3
```

Raw result JSONL was not edited.

## Existing Pilot Revalidation

Before: 36 warnings.

After: 27 warnings.

Remaining warning types:

```text
EVIDENCE_INCOMPLETE_FOR_ANSWER  22
ANSWER_EXTENDS_BEYOND_EVIDENCE   5
```

Removed warning classes:

```text
UNSUPPORTED_NUMERIC_OR_REFERENCE  removed
POSSIBLE_MODALITY_MISMATCH        removed
```

The removed numeric/reference warnings were caused by relative subsection references, plural relative references, standalone subsection labels, and decimal section parsing. The removed modality warnings were mixed-focus false positives where the approved focus included permission plus unrelated duty/prohibition language.

## Warning Precision

Remaining warnings identify proposalId, objectiveId, guided question, answer fragment, source/evidence fragment, and trigger terms in `unit-validation.json`.

## V4 Prompt

`unit-authoring-v4` retains v3 source and focus restrictions, then adds:

- evidence must demonstrate all substantive answer claims
- legal answer support is separate from evidence excerpt completeness
- broad groups require `authoringStatus: "needs-map-revision"` plus `mapRevisionSuggestion`
- qualifier attachment, question-framing, grammar, and Community Planning Act s.125 regression guidance

## Evidence

Answer support checks compare study answers against the full approved focus: approved sourceKeys, childLabels, definedTerms, and operative text.

Evidence completeness checks compare the selected `evidenceText` excerpts against the answer. If the focus supports the answer but excerpts are too thin, the warning is `EVIDENCE_INCOMPLETE_FOR_ANSWER`.

Evidence text must still be found in the approved authoring source. Context-only evidence remains invalid.

## Reference Parser

Demonstrated by focused tests:

```text
subsection (4) within section 18 -> subsection 18(4)
subsection 6(1) or (3) -> subsection 6(1), subsection 6(3)
section 49.1 remains section 49.1
paragraph/reference integers are not independent quantity claims
```

## Modality

Focused tests still catch:

```text
may -> must
shall not -> may
thirty days -> sixty days
Registrar General -> surveyor
subsection 18(4) -> subsection 18(5)
```

Mixed approved-focus modality no longer warns merely because a different selected clause contains duty or prohibition language.

## Community Planning Feedback Loop

Existing v3 s.125 raw output contains `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` but no v4 `mapRevisionSuggestion`, because raw pilot output is preserved.

Future v4 output should propose source-grounded finer groups. For s.125, a reasonable feedback shape is:

```text
125(10)-125(11): subdivision-regulation powers and modified subdivision rules
125(12)-125(13): public-purpose land and money
125(14)-125(16): pre-regulation procedure, written summary, and filing
```

Those revised groups were not processed into StudyUnits.

## Validation

Focused tests:

```text
npm run test:run -- tests/study/study_ai_unit_validation_calibration.test.ts tests/study/study_ai_authoring.test.ts
```

Read-only pilot revalidation:

```text
npm run study:ai:validate-unit-proposals -- --run ai-units-4b13-pilot-s16-v3
npm run study:ai:pilot-report -- --run ai-map-4b12-grounding-s9-v1 --unit-run ai-units-4b13-pilot-s16-v3
```

UNIT AUTHORING READY FOR EXPANDED PILOT

