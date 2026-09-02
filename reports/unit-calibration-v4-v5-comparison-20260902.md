# Unit calibration V4 → V5 comparison — 20260902

V4 run: `ai-units-2026-09-02-frozen-map-cal80-v4` · V5 run: `ai-units-2026-09-02-frozen-map-cal80-v5` · generated at `2026-09-02T00:00:00.000Z`
cohort: 80 jobs matched by crosswalk seq (crosswalk sha256 ca5d0c62671319c6b44b7f0ee8816dc938b6732696be617ae1cf887f8b215fea)
spec sha256 — v4 `ecbb97301866b900ff82e8cbd632f9af65f6f3a7929c2b283939329fd27a683b` · v5 `8987b7daf346c61e312f2c381752049944d6316f655829f697e0283a858169bd`

## Per-run outcomes

### v4 — ai-units-2026-09-02-frozen-map-cal80-v4

model Qwen3.8-27B-UD-IQ4_XS · endpoint `http://127.0.0.1:8080/v1` · concurrency 1
prompt spec `unit-authoring-v4` · spec sha256 `ecbb97301866b900ff82e8cbd632f9af65f6f3a7929c2b283939329fd27a683b`

| status | jobs |
| --- | ---: |
| accepted | 80 |
| semantic-failed | 0 |
| provider-incomplete | 0 |
| nothing | 0 |
| jobs total | 80 |

rejected attempt files: 15 (semantic 15 / provider 0)
worst retry job: `unit-07fa6fc1208594ca` (4 rejected attempt files)

### v5 — ai-units-2026-09-02-frozen-map-cal80-v5

model Qwen3.8-27B-UD-IQ4_XS · endpoint `http://127.0.0.1:8080/v1` · concurrency 1
prompt spec `unit-authoring-v5` · spec sha256 `8987b7daf346c61e312f2c381752049944d6316f655829f697e0283a858169bd`

| status | jobs |
| --- | ---: |
| accepted | 80 |
| semantic-failed | 0 |
| provider-incomplete | 0 |
| nothing | 0 |
| jobs total | 80 |

rejected attempt files: 69 (semantic 69 / provider 0)
worst retry job: `unit-332a2ef669d3f464` (5 rejected attempt files)

## Status transition matrix (v4 row → v5 column)

| v4 \ v5 | generated | total |
| --- | ---: | ---: |
| generated | 45 | 45 |
| needs-map-revision | 35 | 35 |

total rows: 80

## V5 revision consistency (target: all zero)

_All five V5 revision-consistency buckets are zero._

## Warning histogram (canonical-validation warning codes)

| code | v4 | v5 |
| --- | ---: | ---: |
| ANSWER_APPEARS_TRUNCATED | 13 | 15 |
| APPROVED_FOCUS_NOT_COVERED | 49 | 16 |
| DEFINITION_ANSWER_MISSING_TERM_MEANING | 2 | 2 |
| GUIDED_QUESTION_TOO_LONG | 18 | 0 |
| MAIN_QUESTION_TOO_LONG | 22 | 0 |
| POSSIBLE_MODALITY_MISMATCH | 3 | 6 |
| UNCOVERED_SUBSTANTIVE_SOURCE | 37 | 10 |
| UNSUPPORTED_NUMERIC_OR_REFERENCE | 27 | 13 |
| total | 171 | 62 |

V4 coverage-warning audit reconciliation:
- expected: APPROVED_FOCUS_NOT_COVERED 49 / UNCOVERED_SUBSTANTIVE_SOURCE 37 (total 86)
- recomputed: APPROVED_FOCUS_NOT_COVERED 49 / UNCOVERED_SUBSTANTIVE_SOURCE 37 (total 86)
- matched: true

## Question lengths (chars)

| run | main n | main mean | main >180 | main >240 | guided >160 | guided >220 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
v4
80
213.06
56
22
90
18
v5
80
164.2
24
0
28
0

## Objective-count histogram (accepted proposals)

| objectives | v4 | v5 |
| --- | ---: | ---: |
| 1 | 12 | 7 |
| 2 | 26 | 33 |
| 3 | 24 | 16 |
| 4 | 17 | 22 |
| 5 | 1 | 2 |

## Regression anchors (7)

| seq | v4JobId → v5JobId | v4 status | v5 status | v4 warnings | v5 warnings | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | `unit-5fadda40929f11f0` → `unit-99bdb6cd6f15f777` | needs-map-revision | generated | MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT | — | status-change |
| 30 | `unit-09121fea0dce567b` → `unit-addc04e113bb4ae1` | generated | generated | — | — | stable |
| 31 | `unit-e60f2ed653e5363a` → `unit-c9285cd7f533a2ab` | needs-map-revision | generated | — | — | status-change |
| 32 | `unit-21c62d64fd32c92f` → `unit-5eefb3ed8c3ce251` | needs-map-revision | generated | MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT | — | status-change |
| 33 | `unit-806dcd5f7b8ca4e8` → `unit-bfebe45a58764cbf` | generated | generated | — | — | stable |
| 34 | `unit-24d4ce03d041f274` → `unit-061b46bb0538188c` | generated | generated | — | — | stable |
| 35 | `unit-00066425d3dd3645` → `unit-dc047ee16ef0e408` | needs-map-revision | generated | — | — | status-change |

## OCR case — Land Surveyors Act s.18(2) cohort job

crosswalk seq 70 · v4 `unit-07fa6fc1208594ca` → v5 `unit-0344f31b1107b2dc`
group: g-18-2-registration-entry-conditions · title: Conditions for entering a name in the register
- `by - laws` in v4 job exactSourceText: true · v4 evidence union: true · v5 evidence union: true · v5 objective ids: obj-18-2-authorization
- `Registr ar` in v4 job exactSourceText: true · v4 evidence union: true · v5 evidence union: true · v5 objective ids: obj-18-2-evidence-entitlement

## Named subsets (v4→v5 status pairs)

### final-qc-20 (20)

| seq | v4JobId | v5JobId | v4 status | v5 status |
| --- | --- | --- | --- | --- |
| 1 | `unit-40730d04faf14076` | `unit-e3f6eb223f9c6b22` | generated | generated |
| 2 | `unit-f1d3de4004dd0d17` | `unit-f463819104abd315` | generated | generated |
| 3 | `unit-02c1922ab2c2961a` | `unit-5ba258431f90f343` | needs-map-revision | generated |
| 4 | `unit-9ceefa172c31deea` | `unit-fcc8bb2c8653b95d` | needs-map-revision | generated |
| 5 | `unit-d9b1e53de714665c` | `unit-d4b1280dd51c16a3` | generated | generated |
| 6 | `unit-1d069dae182e4d4a` | `unit-332a2ef669d3f464` | needs-map-revision | generated |
| 7 | `unit-ad5f94891873617a` | `unit-6f65dea4a13630e9` | generated | generated |
| 8 | `unit-e9fe22342cc56c8a` | `unit-44a5e5a34f069c1d` | generated | generated |
| 9 | `unit-ea7e4c75c7a425ce` | `unit-79cacfaeddf74f82` | needs-map-revision | generated |
| 10 | `unit-892e38efffb31976` | `unit-6480451b3fe42be2` | needs-map-revision | generated |
| 11 | `unit-b176ebe94507fd17` | `unit-c562d9132d24d3e6` | needs-map-revision | generated |
| 12 | `unit-9aa4dea732c4bc43` | `unit-db1eb97629092cb5` | generated | generated |
| 13 | `unit-de14b7aae121ea5a` | `unit-9ff278807624e3ae` | generated | generated |
| 14 | `unit-df983b36ee36be82` | `unit-23337f055c22b192` | generated | generated |
| 15 | `unit-2f3e7edff1d80df7` | `unit-6e340018655584a7` | needs-map-revision | generated |
| 16 | `unit-15fa5c5ac251dfa1` | `unit-d0fd18f6457af793` | needs-map-revision | generated |
| 17 | `unit-6a94737b69e069ce` | `unit-e944b3a49f4b9bac` | needs-map-revision | generated |
| 18 | `unit-fdccd69202d3a203` | `unit-d1742361c5ae3778` | generated | generated |
| 19 | `unit-ade0ea76fa6d04ef` | `unit-bc439b485e0a8ce3` | generated | generated |
| 20 | `unit-dc58323956b9fd42` | `unit-f91b57371792a0bb` | needs-map-revision | generated |

transitions: generated → generated 10 · needs-map-revision → generated 10

### anchors-7 (7)

| seq | v4JobId | v5JobId | v4 status | v5 status |
| --- | --- | --- | --- | --- |
| 27 | `unit-5fadda40929f11f0` | `unit-99bdb6cd6f15f777` | needs-map-revision | generated |
| 30 | `unit-09121fea0dce567b` | `unit-addc04e113bb4ae1` | generated | generated |
| 31 | `unit-e60f2ed653e5363a` | `unit-c9285cd7f533a2ab` | needs-map-revision | generated |
| 32 | `unit-21c62d64fd32c92f` | `unit-5eefb3ed8c3ce251` | needs-map-revision | generated |
| 33 | `unit-806dcd5f7b8ca4e8` | `unit-bfebe45a58764cbf` | generated | generated |
| 34 | `unit-24d4ce03d041f274` | `unit-061b46bb0538188c` | generated | generated |
| 35 | `unit-00066425d3dd3645` | `unit-dc047ee16ef0e408` | needs-map-revision | generated |

transitions: generated → generated 3 · needs-map-revision → generated 4

### retry-9 (9)

| seq | v4JobId | v5JobId | v4 status | v5 status |
| --- | --- | --- | --- | --- |
| 21 | `unit-047b933c1567c5dd` | `unit-ab80c5ba40812a83` | needs-map-revision | generated |
| 22 | `unit-2e7e67eb0f35fe35` | `unit-3e12091103f6ec16` | generated | generated |
| 23 | `unit-019c765ae138d8b5` | `unit-1778139a242e733a` | needs-map-revision | generated |
| 24 | `unit-143fc780953799e6` | `unit-aca8067647cbf88f` | generated | generated |
| 25 | `unit-2eedbe7a21cb2c32` | `unit-da8aeea638cab3fd` | generated | generated |
| 26 | `unit-023c1a4ddb31e2c5` | `unit-9444b4424f6fa00b` | needs-map-revision | generated |
| 27 | `unit-5fadda40929f11f0` | `unit-99bdb6cd6f15f777` | needs-map-revision | generated |
| 28 | `unit-5d2a9f36002162d0` | `unit-71e27c24590d3242` | needs-map-revision | generated |
| 29 | `unit-c7dc47a1735eb69d` | `unit-90ab6499b6928ad2` | needs-map-revision | generated |

transitions: generated → generated 3 · needs-map-revision → generated 6

### repealed-mix-16 (16)

| seq | v4JobId | v5JobId | v4 status | v5 status |
| --- | --- | --- | --- | --- |
| 3 | `unit-02c1922ab2c2961a` | `unit-5ba258431f90f343` | needs-map-revision | generated |
| 4 | `unit-9ceefa172c31deea` | `unit-fcc8bb2c8653b95d` | needs-map-revision | generated |
| 5 | `unit-d9b1e53de714665c` | `unit-d4b1280dd51c16a3` | generated | generated |
| 6 | `unit-1d069dae182e4d4a` | `unit-332a2ef669d3f464` | needs-map-revision | generated |
| 7 | `unit-ad5f94891873617a` | `unit-6f65dea4a13630e9` | generated | generated |
| 8 | `unit-e9fe22342cc56c8a` | `unit-44a5e5a34f069c1d` | generated | generated |
| 9 | `unit-ea7e4c75c7a425ce` | `unit-79cacfaeddf74f82` | needs-map-revision | generated |
| 15 | `unit-2f3e7edff1d80df7` | `unit-6e340018655584a7` | needs-map-revision | generated |
| 16 | `unit-15fa5c5ac251dfa1` | `unit-d0fd18f6457af793` | needs-map-revision | generated |
| 17 | `unit-6a94737b69e069ce` | `unit-e944b3a49f4b9bac` | needs-map-revision | generated |
| 18 | `unit-fdccd69202d3a203` | `unit-d1742361c5ae3778` | generated | generated |
| 22 | `unit-2e7e67eb0f35fe35` | `unit-3e12091103f6ec16` | generated | generated |
| 29 | `unit-c7dc47a1735eb69d` | `unit-90ab6499b6928ad2` | needs-map-revision | generated |
| 32 | `unit-21c62d64fd32c92f` | `unit-5eefb3ed8c3ce251` | needs-map-revision | generated |
| 33 | `unit-806dcd5f7b8ca4e8` | `unit-bfebe45a58764cbf` | generated | generated |
| 79 | `unit-0ff46d399379a99b` | `unit-c3d97c72d0c68c39` | generated | generated |

transitions: generated → generated 7 · needs-map-revision → generated 9

