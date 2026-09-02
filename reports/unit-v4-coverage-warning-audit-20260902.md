# unit-v4-coverage-warning-audit (20260902)

run: ai-units-2026-09-02-frozen-map-cal80-v4
run.json sha256: 28070b348becdc4fa921f3b168501427fc1c141487e5e56b384c8e3565807210
proposals audited: 80
generatedAt: 2026-09-02T00:00:00.000Z

Expected totals: APPROVED_FOCUS_NOT_COVERED 49, UNCOVERED_SUBSTANTIVE_SOURCE 37, total 86.
Actual totals: APPROVED_FOCUS_NOT_COVERED 49, UNCOVERED_SUBSTANTIVE_SOURCE 37, total 86.
Classification totals: A 49, B 0, C 37 (A + B + C = 86).

## Per-code classification

| code | A | B | C | total |
| --- | --- | --- | --- | --- |
| APPROVED_FOCUS_NOT_COVERED | 12 | 0 | 37 | 49 |
| UNCOVERED_SUBSTANTIVE_SOURCE | 37 | 0 | 0 | 37 |

## Per-job warning counts

| jobId | total | APPROVED_FOCUS_NOT_COVERED | UNCOVERED_SUBSTANTIVE_SOURCE |
| --- | --- | --- | --- |
| unit-00066425d3dd3645 | 4 | 2 | 2 |
| unit-01074d54d55e4fde | 4 | 2 | 2 |
| unit-01093fbff98ef4eb | 1 | 1 | 0 |
| unit-0167053e440a24d5 | 6 | 3 | 3 |
| unit-02657c4c14328d82 | 6 | 3 | 3 |
| unit-043b932fc33b70cc | 4 | 2 | 2 |
| unit-0449049d27b547c9 | 2 | 1 | 1 |
| unit-046240c47aa8f95b | 1 | 1 | 0 |
| unit-049d27943f637422 | 2 | 2 | 0 |
| unit-05e06222bdb9d406 | 4 | 4 | 0 |
| unit-07fa6fc1208594ca | 1 | 1 | 0 |
| unit-08d0057dc07a46d5 | 4 | 2 | 2 |
| unit-08f6d682936a16dc | 1 | 1 | 0 |
| unit-09121fea0dce567b | 6 | 3 | 3 |
| unit-0c0bbda20e7199b5 | 6 | 3 | 3 |
| unit-0f35a3d73578f1dc | 4 | 2 | 2 |
| unit-1d069dae182e4d4a | 2 | 1 | 1 |
| unit-21c62d64fd32c92f | 2 | 1 | 1 |
| unit-5d2a9f36002162d0 | 10 | 5 | 5 |
| unit-5fadda40929f11f0 | 2 | 1 | 1 |
| unit-806dcd5f7b8ca4e8 | 2 | 1 | 1 |
| unit-a795aa5cbc9d3ee6 | 2 | 2 | 0 |
| unit-ad5f94891873617a | 4 | 2 | 2 |
| unit-dc58323956b9fd42 | 2 | 1 | 1 |
| unit-ea7e4c75c7a425ce | 2 | 1 | 1 |
| unit-f1d3de4004dd0d17 | 2 | 1 | 1 |

## A — real coverage defect worth diagnosing

| jobId | code | sourceKey | label | twin | objectiveIds | basis |
| --- | --- | --- | --- | --- | --- | --- |
| unit-00066425d3dd3645 | UNCOVERED_SUBSTANTIVE_SOURCE | section:125 | 125(8) | APPROVED_FOCUS_NOT_COVERED | obj-1 | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-00066425d3dd3645 | UNCOVERED_SUBSTANTIVE_SOURCE | section:125 | 125(9) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-01074d54d55e4fde | UNCOVERED_SUBSTANTIVE_SOURCE | section:50 | 50(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-01074d54d55e4fde | UNCOVERED_SUBSTANTIVE_SOURCE | section:50 | 50(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-01093fbff98ef4eb | APPROVED_FOCUS_NOT_COVERED | section:14 | 14 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-0167053e440a24d5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:36 | 36(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0167053e440a24d5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:36 | 36(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0167053e440a24d5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:36 | 36(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-02657c4c14328d82 | UNCOVERED_SUBSTANTIVE_SOURCE | section:43 | 43(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-02657c4c14328d82 | UNCOVERED_SUBSTANTIVE_SOURCE | section:43 | 43(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-02657c4c14328d82 | UNCOVERED_SUBSTANTIVE_SOURCE | section:43 | 43(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-043b932fc33b70cc | UNCOVERED_SUBSTANTIVE_SOURCE | section:6 | 6(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-043b932fc33b70cc | UNCOVERED_SUBSTANTIVE_SOURCE | section:6 | 6(4) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0449049d27b547c9 | UNCOVERED_SUBSTANTIVE_SOURCE | section:88 | 88(8) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-046240c47aa8f95b | APPROVED_FOCUS_NOT_COVERED | section:13.2 | 13.2 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-049d27943f637422 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 26 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-049d27943f637422 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 27 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-05e06222bdb9d406 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 16 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-05e06222bdb9d406 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 18 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-05e06222bdb9d406 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 19 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-05e06222bdb9d406 | APPROVED_FOCUS_NOT_COVERED | schedule:schedule-d | 32 | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-07fa6fc1208594ca | APPROVED_FOCUS_NOT_COVERED | section:18(2) | 18(2) | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-08d0057dc07a46d5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:84 | 84(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-08d0057dc07a46d5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:84 | 84(4) | APPROVED_FOCUS_NOT_COVERED | obj-boundary-representation | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-08f6d682936a16dc | APPROVED_FOCUS_NOT_COVERED | section:12(2) | 12(2) | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-09121fea0dce567b | UNCOVERED_SUBSTANTIVE_SOURCE | section:10 | 10(4) | APPROVED_FOCUS_NOT_COVERED | obj-10-4-parties | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-09121fea0dce567b | UNCOVERED_SUBSTANTIVE_SOURCE | section:10 | 10(5) | APPROVED_FOCUS_NOT_COVERED | obj-10-5-notice-duty | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-09121fea0dce567b | UNCOVERED_SUBSTANTIVE_SOURCE | section:10 | 10(6) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0c0bbda20e7199b5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0c0bbda20e7199b5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0c0bbda20e7199b5 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0f35a3d73578f1dc | UNCOVERED_SUBSTANTIVE_SOURCE | section:1 | 1(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-0f35a3d73578f1dc | UNCOVERED_SUBSTANTIVE_SOURCE | section:1 | 1(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-1d069dae182e4d4a | UNCOVERED_SUBSTANTIVE_SOURCE | section:13 | 13(5) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-21c62d64fd32c92f | UNCOVERED_SUBSTANTIVE_SOURCE | section:18 | 18(5) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5d2a9f36002162d0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5d2a9f36002162d0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5d2a9f36002162d0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(3) | APPROVED_FOCUS_NOT_COVERED | obj-44-23-deed-variation-savings | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5d2a9f36002162d0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(4) | APPROVED_FOCUS_NOT_COVERED | obj-44-45-buy-in-definitions | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5d2a9f36002162d0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:44 | 44(5) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-5fadda40929f11f0 | UNCOVERED_SUBSTANTIVE_SOURCE | section:9 | 9(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-806dcd5f7b8ca4e8 | UNCOVERED_SUBSTANTIVE_SOURCE | section:19 | 19(5) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-a795aa5cbc9d3ee6 | APPROVED_FOCUS_NOT_COVERED | section:16(2) | 16(2) | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-a795aa5cbc9d3ee6 | APPROVED_FOCUS_NOT_COVERED | section:17(1) | 17(1) | — |  | no coverage child entry exists for the approved childLabel and it is not among the source's in-scope subsections, so only the approved-focus checker can flag it |
| unit-ad5f94891873617a | UNCOVERED_SUBSTANTIVE_SOURCE | section:13 | 13(3) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-ad5f94891873617a | UNCOVERED_SUBSTANTIVE_SOURCE | section:13 | 13(4) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-dc58323956b9fd42 | UNCOVERED_SUBSTANTIVE_SOURCE | section:90 | 90(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-ea7e4c75c7a425ce | UNCOVERED_SUBSTANTIVE_SOURCE | section:13 | 13(2) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |
| unit-f1d3de4004dd0d17 | UNCOVERED_SUBSTANTIVE_SOURCE | section:71 | 71(1) | APPROVED_FOCUS_NOT_COVERED |  | primary diagnostic: the approved childLabel has no coverage child entry, which the approved-focus checker also presents (APPROVED_FOCUS_NOT_COVERED twin) |

## B — false positive (raw predicate recompute says no warning)

_No instances in this classification._

## C — duplicate presentation (same omission also flagged as UNCOVERED_SUBSTANTIVE_SOURCE)

| jobId | code | sourceKey | label | twin | objectiveIds | basis |
| --- | --- | --- | --- | --- | --- | --- |
| unit-00066425d3dd3645 | APPROVED_FOCUS_NOT_COVERED | section:125 | 125(8) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-1 | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:125, 125(8)) |
| unit-00066425d3dd3645 | APPROVED_FOCUS_NOT_COVERED | section:125 | 125(9) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:125, 125(9)) |
| unit-01074d54d55e4fde | APPROVED_FOCUS_NOT_COVERED | section:50 | 50(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:50, 50(2)) |
| unit-01074d54d55e4fde | APPROVED_FOCUS_NOT_COVERED | section:50 | 50(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:50, 50(3)) |
| unit-0167053e440a24d5 | APPROVED_FOCUS_NOT_COVERED | section:36 | 36(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:36, 36(1)) |
| unit-0167053e440a24d5 | APPROVED_FOCUS_NOT_COVERED | section:36 | 36(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:36, 36(2)) |
| unit-0167053e440a24d5 | APPROVED_FOCUS_NOT_COVERED | section:36 | 36(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:36, 36(3)) |
| unit-02657c4c14328d82 | APPROVED_FOCUS_NOT_COVERED | section:43 | 43(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:43, 43(1)) |
| unit-02657c4c14328d82 | APPROVED_FOCUS_NOT_COVERED | section:43 | 43(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:43, 43(2)) |
| unit-02657c4c14328d82 | APPROVED_FOCUS_NOT_COVERED | section:43 | 43(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:43, 43(3)) |
| unit-043b932fc33b70cc | APPROVED_FOCUS_NOT_COVERED | section:6 | 6(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:6, 6(3)) |
| unit-043b932fc33b70cc | APPROVED_FOCUS_NOT_COVERED | section:6 | 6(4) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:6, 6(4)) |
| unit-0449049d27b547c9 | APPROVED_FOCUS_NOT_COVERED | section:88 | 88(8) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:88, 88(8)) |
| unit-08d0057dc07a46d5 | APPROVED_FOCUS_NOT_COVERED | section:84 | 84(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:84, 84(3)) |
| unit-08d0057dc07a46d5 | APPROVED_FOCUS_NOT_COVERED | section:84 | 84(4) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-boundary-representation | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:84, 84(4)) |
| unit-09121fea0dce567b | APPROVED_FOCUS_NOT_COVERED | section:10 | 10(4) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-10-4-parties | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:10, 10(4)) |
| unit-09121fea0dce567b | APPROVED_FOCUS_NOT_COVERED | section:10 | 10(5) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-10-5-notice-duty | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:10, 10(5)) |
| unit-09121fea0dce567b | APPROVED_FOCUS_NOT_COVERED | section:10 | 10(6) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:10, 10(6)) |
| unit-0c0bbda20e7199b5 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(1)) |
| unit-0c0bbda20e7199b5 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(2)) |
| unit-0c0bbda20e7199b5 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(3)) |
| unit-0f35a3d73578f1dc | APPROVED_FOCUS_NOT_COVERED | section:1 | 1(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:1, 1(1)) |
| unit-0f35a3d73578f1dc | APPROVED_FOCUS_NOT_COVERED | section:1 | 1(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:1, 1(2)) |
| unit-1d069dae182e4d4a | APPROVED_FOCUS_NOT_COVERED | section:13 | 13(5) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:13, 13(5)) |
| unit-21c62d64fd32c92f | APPROVED_FOCUS_NOT_COVERED | section:18 | 18(5) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:18, 18(5)) |
| unit-5d2a9f36002162d0 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(1)) |
| unit-5d2a9f36002162d0 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(2)) |
| unit-5d2a9f36002162d0 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(3) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-44-23-deed-variation-savings | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(3)) |
| unit-5d2a9f36002162d0 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(4) | UNCOVERED_SUBSTANTIVE_SOURCE | obj-44-45-buy-in-definitions | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(4)) |
| unit-5d2a9f36002162d0 | APPROVED_FOCUS_NOT_COVERED | section:44 | 44(5) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:44, 44(5)) |
| unit-5fadda40929f11f0 | APPROVED_FOCUS_NOT_COVERED | section:9 | 9(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:9, 9(2)) |
| unit-806dcd5f7b8ca4e8 | APPROVED_FOCUS_NOT_COVERED | section:19 | 19(5) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:19, 19(5)) |
| unit-ad5f94891873617a | APPROVED_FOCUS_NOT_COVERED | section:13 | 13(3) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:13, 13(3)) |
| unit-ad5f94891873617a | APPROVED_FOCUS_NOT_COVERED | section:13 | 13(4) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:13, 13(4)) |
| unit-dc58323956b9fd42 | APPROVED_FOCUS_NOT_COVERED | section:90 | 90(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:90, 90(1)) |
| unit-ea7e4c75c7a425ce | APPROVED_FOCUS_NOT_COVERED | section:13 | 13(2) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:13, 13(2)) |
| unit-f1d3de4004dd0d17 | APPROVED_FOCUS_NOT_COVERED | section:71 | 71(1) | UNCOVERED_SUBSTANTIVE_SOURCE |  | duplicate presentation of the same omission: an UNCOVERED_SUBSTANTIVE_SOURCE instance exists for the same (section:71, 71(1)) |

