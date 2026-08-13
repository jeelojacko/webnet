# Phase 4B.2.1 Remediation Report

Old run: ai-units-4b2-expanded-s48-v4
New run: ai-units-4b21-expanded-s48-v4fix

## Provenance
- Phase 4B.2 result JSONL was produced by scripts/studyPhase4b2Pilot.ts deterministic helper authoring, not genuine per-job external Codex reasoning.
- Deterministic local Unit prose authoring is now disabled in the Phase 4B.2 pilot script.

## Deterministic Validation Outcome
- Preserved old proposals: 48
- Clean: 0
- Warning-valid: 46
- Invalid: 2

## Educational Diagnostics
- Generic main questions: 48
- Generic guided questions: 117
- Suspected truncation: 166
- Definition responsiveness failures: 6
- Duplicate/nonresponsive answer diagnostics: 8

## New Run
- Same-48 V4-fix job run prepared: yes
- Genuine external-authored result lines present: 0
- Human educational-quality outcome: pending review after genuine external authoring results are supplied.
- Full-corpus generation: not started.

## Issue Counts
- ANSWER_APPEARS_TRUNCATED: 166
- GENERIC_MAIN_QUESTION: 48
- GENERIC_GUIDED_QUESTION: 117
- DEFINITION_ANSWER_MISSING_TERM_MEANING: 6
- DUPLICATE_NONRESPONSIVE_ANSWER: 8
- MAP_REVISION_UNSUPPORTED_CONCEPT: 2
