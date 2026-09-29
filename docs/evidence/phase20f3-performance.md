# Phase 20F.3 shell-equality performance (§25)

Measured 2026-09-29. Harness: `npx tsx scripts/phase20f3ShellPerf.ts`
(node v26.8.1, linux x64). No timing gate anywhere; figures are actual runs.

## Method

`cadWorkspaceSnapshotsEqual`
(`src/cad-app/shell/cadShellSnapshotEqual.ts`) is the exhaustive comparator
contract behind the shell-link publish gate. It partitions every
`CadWorkspaceSnapshot` key exactly once:

| partition | keys | comparator |
|---|---:|---|
| scalar | 20 | `===` / string-list / count+pref record |
| structured | 5 | `selectionPreview`, `layers`, `lineTypes`, `sheets`, `properties` |
| JSON subtree | 14 | deterministic `JSON.stringify` |

The 20F.3 fix added the previously missing nested fields
(`selectionPreview.type`, `layers[].role` and every other `CadLayer` field,
`lineTypes` name + `dashPattern`, and the full `DraftSheet` shape including
dims/orientation/margins/viewports/title-block ref+fields/objects).

**Timing isolation:** fixtures and `structuredClone` happen before the timed
regions, and every measured publish uses prebuilt states alternating between
two variants. Each rep therefore performs a real comparison (never an
accidental same-reference hit), and notify counts are meaningful. Fixture
construction is never inside a timed region.

## 1. Compared payload (loaded session, 39 keys, 528,373 JSON bytes)

| partition | keys | JSON bytes |
|---|---:|---:|
| scalar | 20 | 195 |
| structured (preview/layers/lineTypes/sheets/properties) | 5 | 5,883 |
| JSON subtrees | 14 | 522,295 |
| **total** | 39 | 528,373 |

Per structured key: `selectionPreview` 48 B, `layers` 471 B, `lineTypes`
110 B, `sheets` 5,239 B, `properties` 15 B.

Per JSON subtree (bytes): `gradingGroups` 216,950; `grading` 198,868; `f2f`
29,620; `survey` 23,583; `profile` 19,652; `surveyTable` 16,405; `parcel`
7,723; `section` 6,894; `annotation` 1,925; `surface` 342; `featureLine` 138;
`volume` 105; `blocks` 52; `analysis` 38.

## 2. `publish()` medians (fixtures prebuilt, 120 reps/case)

| path | publish ms (median) | notifications | expected |
|---|---:|---:|---:|
| same ref (fast path) | 0.0002 | 0 | 0 |
| semantic-equal (unique graphs, suppressed) | 2.0760 | 0 | 0 |
| change in `grading` (compare + notify) | 1.2917 | 120 | 120 |
| change in `gradingGroups` (compare + notify) | 2.1626 | 120 | 120 |
| change in `f2f` (compare + notify) | 0.4555 | 120 | 120 |
| change in `parcel` (compare + notify) | 0.4784 | 120 | 120 |
| change in `surveyTable` (compare + notify) | 0.4627 | 120 | 120 |
| change in `profile` (compare + notify) | 0.2466 | 120 | 120 |
| change in `survey` (compare + notify) | 0.0991 | 120 | 120 |
| change in `surface` (compare + notify) | 0.1000 | 120 | 120 |

The gate compares scalar → structured → JSON subtrees and short-circuits on
the first difference, so a change in a subtree never pays for the subtrees
after it. Full semantic-equal (everything compared, nothing changed) is the
worst case: ~2 ms on this loaded session.

## 3. Nested-gap changes added in 20F.3 (120 reps/case)

All ten must publish; each fired 120/120 notifications (the gate observes
every nested field). Medians are short-circuit costs (the structured change
precedes the JSON subtrees):

| nested field changed | publish ms (median) | notifications |
|---|---:|---:|
| `selectionPreview.type` | 0.0013 | 120 |
| `layers[].role` | 0.0016 | 120 |
| `layers[].color` | 0.0014 | 120 |
| `lineTypes` name | 0.0018 | 120 |
| `lineTypes` dashPattern | 0.0016 | 120 |
| `sheets` widthMm | 0.0019 | 120 |
| `sheets` margins | 0.0018 | 120 |
| `sheets` viewport | 0.0033 | 120 |
| `sheets` titleBlockFields | 0.0019 | 120 |
| `sheets` sheetObjects | 0.0040 | 120 |

## 4. Deepened sheet comparator + steady state

| sheet shape | change-case publish ms (median) |
|---|---:|
| 4 sheets × 4 viewports × 3 objects | 0.0032 |
| 8 sheets × 8 viewports × 6 objects | 0.0055 |
| 16 sheets × 16 viewports × 12 objects | 0.0087 |

Sheet comparison scales linearly with viewport/object count and stays in the
tens-of-microseconds range at 4× the representative sheet count.

- 200 semantic-equal publishes (prebuilt states, no clone): 228.9 ms total,
  1.1444 ms/attempt, 0 notifications.

## Verdict

The nested fields close the remaining display-staleness gaps without adding
meaningful cost: the heavy payload is still the grading/group result meshes
the shell must observe, and equal content never notifies (0/200 repeated
publishes). Same-reference publishes stay free, the cursor channel is
untouched, and publish cost is paid only on discrete state changes.

## Future path

If JSON ever dominates for much larger sessions: memoized per-subtree digests
or structural sharing at the snapshot-builder boundary. Do not drop compared
fields — the contract is compile-time exact, and any field the shell renders
must remain in it. No thresholds invented or gated.
