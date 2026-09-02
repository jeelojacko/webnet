# Calibration-80 Result Audit — 20260902

Run: `ai-units-2026-09-02-frozen-map-cal80-v4` · prompt spec `unit-authoring-v4` · generated at `2026-09-02T00:00:00.000Z`
Selection report: `/home/jacko/Code/webnet/reports/unit-calibration-80-20260902.json`

## Completion

| status | jobs |
| --- | ---: |
| expected | 80 |
| accepted | 80 |
| semantic-failed | 0 |
| provider-incomplete | 0 |
| nothing | 0 |

### Per batch

| batch | expected | accepted | semantic-failed | provider-incomplete | nothing |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 8 | 8 | 0 | 0 | 0 |
| 2 | 8 | 8 | 0 | 0 | 0 |
| 3 | 8 | 8 | 0 | 0 | 0 |
| 4 | 8 | 8 | 0 | 0 | 0 |
| 5 | 8 | 8 | 0 | 0 | 0 |
| 6 | 8 | 8 | 0 | 0 | 0 |
| 7 | 8 | 8 | 0 | 0 | 0 |
| 8 | 8 | 8 | 0 | 0 | 0 |
| 9 | 8 | 8 | 0 | 0 | 0 |
| 10 | 8 | 8 | 0 | 0 | 0 |

## Priority gap reconciliation (selected = accepted + failed + incomplete + nothing)

| priority | target | selected | accepted | semantic-failed | provider-incomplete | nothing | gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P1 | 24 | 24 | 24 | 0 | 0 | 0 | 0 |
| P2 | 28 | 28 | 28 | 0 | 0 | 0 | 0 |
| P3 | 20 | 20 | 20 | 0 | 0 | 0 | 0 |
| P4 | 8 | 8 | 8 | 0 | 0 | 0 | 0 |

Gap exact: **yes**

> Per priority the frozen selection distribution must equal the number of selected job rows found in the run (accepted + semanticFailed + providerIncomplete + nothing); a nonzero gap means a selected job has no row at all (never attempted).

## Audit errors

- none

## Findings (counted; expected data unless flagged)

- **ADVISORY_MAP_REVISION_SUGGESTION_ON_GENERATED**: 27 — mapRevisionSuggestion present on a generated-status proposal (advisory; expected data).
  - unit-00786855a793bc06
  - unit-01114cfaf3709c7d
  - unit-022c7285b5e97c06
  - unit-03718a2726419ffc
  - unit-04e2ecadf458dfc2
  - unit-057a72bc46425aef
  - unit-05aad567930a651b
  - unit-05e06222bdb9d406
  - unit-064dc209bd43e63c
  - unit-07144e70868a71ec
  - unit-07fded70d557bb42
  - unit-08d0057dc07a46d5
  - unit-09121fea0dce567b
  - unit-098b09224e6386c2
  - unit-0c0bbda20e7199b5
  - unit-0ff46d399379a99b
  - unit-24d4ce03d041f274
  - unit-2eedbe7a21cb2c32
  - unit-38731a2761d264ad
  - unit-40730d04faf14076
  - unit-9aa4dea732c4bc43
  - unit-a795aa5cbc9d3ee6
  - unit-ad5f94891873617a
  - unit-ade0ea76fa6d04ef
  - unit-de14b7aae121ea5a
  - unit-e9fe22342cc56c8a
  - unit-f1d3de4004dd0d17
- **NEEDS_MAP_REVISION_WITHOUT_BROAD_WARNING**: 21 — authoringStatus needs-map-revision but MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT warning absent.
  - unit-00066425d3dd3645
  - unit-0070dd224c8bb7a5
  - unit-009ff72aba3f0d45
  - unit-00cb6e97353458dc
  - unit-023c1a4ddb31e2c5
  - unit-02c1922ab2c2961a
  - unit-02c520678fcbb6c2
  - unit-0445d8337e77a7c6
  - unit-046240c47aa8f95b
  - unit-047b933c1567c5dd
  - unit-06587c365a55bf49
  - unit-07fa6fc1208594ca
  - unit-092be74ad4e22fc6
  - unit-0de35b1dafe93ecb
  - unit-15fa5c5ac251dfa1
  - unit-2f3e7edff1d80df7
  - unit-79f54c297756d4aa
  - unit-b176ebe94507fd17
  - unit-c7dc47a1735eb69d
  - unit-e60f2ed653e5363a
  - unit-ea7e4c75c7a425ce
- **NEEDS_MAP_REVISION_WITHOUT_SUGGESTION**: 5 — authoringStatus needs-map-revision but mapRevisionSuggestion absent (spec pair rule).
  - unit-00cb6e97353458dc
  - unit-02c520678fcbb6c2
  - unit-046240c47aa8f95b
  - unit-047b933c1567c5dd
  - unit-092be74ad4e22fc6

## Identity & priority protection

Checked accepted proposals: 80
suggestedPriority matches frozen: 80
suggestedPriority mismatches: 0
identity errors: 0

## Validator re-run (canonical)

| status | proposals |
| --- | ---: |
| revalidated | 80 |
| valid | 28 |
| warnings | 52 |
| invalid | 0 |
| not-revalidated | 0 |

Issue codes (count):

- `ANSWER_APPEARS_TRUNCATED`: 13
- `APPROVED_FOCUS_NOT_COVERED`: 49
- `DEFINITION_ANSWER_MISSING_TERM_MEANING`: 2
- `GUIDED_QUESTION_TOO_LONG`: 18
- `MAIN_QUESTION_TOO_LONG`: 22
- `POSSIBLE_MODALITY_MISMATCH`: 3
- `UNCOVERED_SUBSTANTIVE_SOURCE`: 37
- `UNSUPPORTED_NUMERIC_OR_REFERENCE`: 27

Issue severities:

- `error`: 0
- `warning`: 171

## Distributions

### authoringStatus

- `generated`: 45
- `needs-map-revision`: 35

### suggestedPriority (accepted)

- `P1`: 24
- `P2`: 28
- `P3`: 20
- `P4`: 8

### confidence

- `high`: 79
- `medium`: 1

### warnings

- `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT`: 14
- `OUTSIDE_APPROVED_FOCUS`: 2

### objectives per unit

- `1`: 12
- `2`: 26
- `3`: 24
- `4`: 17
- `5`: 1

### domains (selection tags)

- `adjacent`: 18
- `cadastral`: 28
- `core`: 34

### focus styles

- `multiple`: 2
- `single`: 78

### mapDisposition

- `combine`: 2
- `split`: 53
- `standalone`: 25

### parent kind

- `combine`: 2
- `split`: 53
- `standalone`: 25

### source count (per unit)

- `1`: 78
- `2`: 2

### size buckets

- `large`: 15
- `medium`: 35
- `small`: 30

### provenance

- `final-QC-adjudicated`: 20
- `human-adjudicated`: 3
- `original`: 50
- `recovered`: 1
- `retry-promoted`: 6

### attempts used per job

- `1`: 68
- `2`: 11
- `5`: 1

### issue codes across attempts

- `ANSWER_APPEARS_TRUNCATED`: 2
- `APPROVED_FOCUS_NOT_COVERED`: 7
- `EVIDENCE_NOT_FOUND`: 14
- `MAIN_QUESTION_TOO_LONG`: 2
- `MAP_REVISION_SUGGESTION_REQUIRED`: 4
- `OUTSIDE_APPROVED_FOCUS`: 14
- `POSSIBLE_MODALITY_MISMATCH`: 4
- `UNCOVERED_SUBSTANTIVE_SOURCE`: 5
- `UNSUPPORTED_NUMERIC_OR_REFERENCE`: 10

### provider event references per job

- `0`: 80

## Named subsets

final-QC corrections: 20 units across 8 parents
- Registry Act s.71 (2)
- Clean Water Act s.40 (3)
- Clean Water Act s.13 (4)
- Trespass Act s.1 (2)
- Crown Lands and Forests Act s.95 (3)
- Registry Act s.66 (1)
- Public Health Act s.68 (3)
- Aquaculture Act s.90 (2)

regression anchors: 7
- Boundaries Confirmation Act s.10 → unit-09121fea0dce567b [accepted]
- Surveys Act s.1 → unit-e60f2ed653e5363a [accepted]
- Land Titles Act s.18 → unit-21c62d64fd32c92f [accepted]
- Registry Act s.19 → unit-806dcd5f7b8ca4e8 [accepted]
- Regulation 95-166 s.3 → unit-24d4ce03d041f274 [accepted]
- Community Planning Act s.125 → unit-00066425d3dd3645 [accepted]
- Occupational Health and Safety Act s.9 → unit-5fadda40929f11f0 [accepted]

retry targets: 9
- Assessment Act s.15.3 → unit-047b933c1567c5dd [accepted]
- Community Planning Act s.1 → unit-2e7e67eb0f35fe35 [accepted]
- Community Planning Act s.75 → unit-019c765ae138d8b5 [accepted]
- Gas Distribution Act s.52 → unit-143fc780953799e6 [accepted]
- Mining Act s.68 → unit-2eedbe7a21cb2c32 [accepted]
- Municipalities Act s.100 → unit-023c1a4ddb31e2c5 [accepted]
- Occupational Health and Safety Act s.9 → unit-5fadda40929f11f0 [accepted]
- Property Act s.44 → unit-5d2a9f36002162d0 [accepted]
- Registry Act s.44 → unit-c7dc47a1735eb69d [accepted]

containsRepealedSubprovision probes: 16
- unit-02c1922ab2c2961a
- unit-0ff46d399379a99b
- unit-15fa5c5ac251dfa1
- unit-1d069dae182e4d4a
- unit-21c62d64fd32c92f
- unit-2e7e67eb0f35fe35
- unit-2f3e7edff1d80df7
- unit-6a94737b69e069ce
- unit-806dcd5f7b8ca4e8
- unit-9ceefa172c31deea
- unit-ad5f94891873617a
- unit-c7dc47a1735eb69d
- unit-d9b1e53de714665c
- unit-e9fe22342cc56c8a
- unit-ea7e4c75c7a425ce
- unit-fdccd69202d3a203

## Inputs

selection report sha256: `ccbfb158cf383a35f4b32712b120a1ae897270e13361e702b1fb153e1c681306`
run.json sha256: `28070b348becdc4fa921f3b168501427fc1c141487e5e56b384c8e3565807210`
local-run-metadata sha256: `fd073009a489fcdde75deac9c3e2631f2504621d91729dd74b835f23bd0f798f`
local-unit.results.jsonl sha256: `ef827469c24d15a778f90f674b4069df40c78e0545c8e0e8b6ab929cbe368f7c`
package sha256: `ae93a1e75b814dd0463e065a5f8b3eeb9e035adc9054d442fab132cfdaa4b56b`
spec sha256: `ecbb97301866b900ff82e8cbd632f9af65f6f3a7929c2b283939329fd27a683b`

batch files:

- `batch-001.jobs.jsonl` 1ac12b4ad36b83b1ece9991be0a372a4653e1bfcec848c9ad45c9302c9b7a8b9
- `batch-002.jobs.jsonl` 10806fb78b80932cb0f9fedad42b4fd310ef373fecf46a1369ed673cc1a1b83a
- `batch-003.jobs.jsonl` fd5bdf43488199afe3439a324b83cc2ccf5adf66b192804462795248d32adfd0
- `batch-004.jobs.jsonl` 54954b5ee02471ccbdc2977a2a09878c563e58564c545f04ef5bfbe9ab2f39f7
- `batch-005.jobs.jsonl` 58eef9121b317d5d0b95c940639c8e78d6aa773c922649605f237d9d06a722a7
- `batch-006.jobs.jsonl` d831930a579cb23490a3d1c6d228153a7e10669a863f204730b2981a450288dc
- `batch-007.jobs.jsonl` 76c3c364fc2c165df5246a0882b6aa387d232ffe70da91d14b8d76ffe2dbc1ce
- `batch-008.jobs.jsonl` db039aac5bb11995d6d4849c55a9cef9fdcd1e8c56c227e856c85d56687cd85f
- `batch-009.jobs.jsonl` 53d3b897e02c273873c0b9561f496bc1a8c647babe5ed9eaf04a960ccf54bda5
- `batch-010.jobs.jsonl` cd61445429f05cba567553e1a6809575519d9c5bfbc63ee468c6fe35fe0801b5

metadata jobIds match selection: yes
metadata jobCount: 80; selection jobCount: 80
