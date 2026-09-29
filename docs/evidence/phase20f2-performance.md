# Phase 20F.2 shell-equality performance (§25)

Measured 2026-09-29. Harness: `npx tsx scripts/phase20f2ShellPerf.ts`
(node v26.8.1, linux x64). No timing gate anywhere; figures are actual runs.

## Method

`snapshotsEqual` (`src/cad-app/shell/cadShellLink.ts`) compares 14 subtrees
by `JSON.stringify`; the shell-link 5-subtree fix added f2f, surveyTable,
parcel, grading, and gradingGroups. The harness builds a representative
loaded session (300 survey points, 3 surfaces, 8 gradings with 4 CURRENT
results carrying full result meshes, 3 groups with 2 results, 40 parcels,
150-row survey table, 4 profiles, 2 section groups, mid-size F2F) and
measures the REAL `createCadShellLink().publish()` path:

1. JSON bytes + `JSON.stringify` median per subtree (all 14; new-5 flagged).
2. `publish()` medians: same-ref fast path, deep-equal clone (full compare,
   notify suppressed), and single-subtree change (full compare + notify) for
   each new subtree plus the heaviest old ones.
3. 200 repeated deep-equal publishes (steady-state shell cost).

## Numbers (full run, quick mode off)

| subtree | new | JSON bytes | stringify ms (median) |
|---|:---:|---:|---:|
| survey | no | 23583 | 0.041 |
| surface | no | 342 | 0.001 |
| volume | no | 105 | 0.000 |
| analysis | no | 38 | 0.000 |
| profile | no | 19652 | 0.053 |
| section | no | 6894 | 0.021 |
| blocks | no | 52 | 0.000 |
| annotation | no | 1925 | 0.004 |
| f2f | yes | 29620 | 0.056 |
| surveyTable | yes | 16405 | 0.018 |
| parcel | yes | 7723 | 0.006 |
| grading | yes | 198868 | 0.360 |
| gradingGroups | yes | 216950 | 0.366 |
| featureLine | no | 138 | 0.000 |

- Total compared JSON: 522295 bytes; new-5 share 469566 bytes (89.9%).
- Summed stringify medians: 0.927 ms; new-5 share 0.808 ms (87.1%).

| publish path | ms (median) | notified |
|---|---:|---|
| same ref (fast path) | 0.0002 | no |
| deep-equal clone (full compare, suppressed) | 3.4951 | no |
| change in grading [new] | 5.7714 | yes |
| change in gradingGroups [new] | 6.5679 | yes |
| change in parcel [new] | 4.8712 | yes |
| change in surveyTable [new] | 4.8547 | yes |
| change in f2f [new] | 4.8081 | yes |
| change in profile | 4.6587 | yes |
| change in surface | 4.5324 | yes |

- 200 deep-equal publishes: 706.3 ms total, 3.5314 ms/attempt, 0 notifications.

## Verdict

No obvious shell regression from the added 5 subtrees. The new fields
dominate the compare (89.9% of bytes — grading/group rows embed full
CURRENT result meshes, which the shell must observe to refresh status and
metrics), but absolute cost is milliseconds per publish (~3.5 ms full
compare on a loaded session, ~5–6.5 ms with notify), and publishes fire on
discrete state changes only — cursor readout travels the separate fast
channel, and equal snapshots never notify. Per-change cost is flat across
old and new subtrees (every publish compares all 14), so no single new
field is a hotspot beyond its honest payload size.

If JSON ever dominates (much larger sessions): improve the architecture —
e.g. memoized per-subtree digests or structural sharing at the snapshot
builder boundary — rather than dropping compared fields. No thresholds
invented or gated.

## Session-state contract checklist (§36 cross-reference)

Full source-derived audit: `phase20f2-session-state-audit.md`.

- **Root cause / omitted fields**: `snapshotsEqual` omitted five built subtrees
  (`grading`, `gradingGroups`, `f2f`, `surveyTable`, `parcel`); this harness
  measures the cost of adding them back. Partial gaps left:
  `selectionPreview.type`, `layers[].role`, `lineTypes` name/dash, `sheets`
  beyond id/name.
- **Equality contract**: `publish` notifies iff `!snapshotsEqual`.
- **Cancellation policy**: `reconcilePendingWithProject()` retires moved
  in-flight runs; never auto-calculates. No perf gate is tied to it.
- **FAILED policy**: session overlay `deriveFailedEffectiveStatus` over
  UNBUILT/NEEDS_RECALC; display-only, no perf effect.
- **Cut/Fill policy**: defaults `2:1`/`3:1`, `nH:1V` round-trip; display-only.
- **Workflows / screenshots / errors**: see `phase20f2-browser-qa.md` (flows
  A–D, 48 PNG + `geometry.json`, 0 page / 0 console errors).
- **Remaining restrictions**: Relative Elevation, transitions, mixed-family
  groups, walls, corridors, radial, warped pads, DEM, boolean repair,
  selection-scoped GRIDGROUND.
