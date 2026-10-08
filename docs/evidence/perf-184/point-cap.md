# PERF-184 — Survey point table cap fast path (#191)

Branch `perf/issue184-cad-shell-snapshot-memo`. This section covers only the
point-cap work in `src/cad-app/shell/cadSurveySnapshot.ts`. Solver math,
schemas, and workers are untouched.

## Problem

`buildCadSurveySnapshot` materialized the full 20-field
`CadSurveyPointDisplayInfo` for **every** survey point (calling
`matchingPointGroups` + `resolveSurveyPointDisplay` per point and rebuilding
the `{ id }` style descriptor arrays inside each resolver call), then sliced
`table` to `SURVEY_POINT_TABLE_CAP` (500) and filtered `selected`. At 5000
points, 4500 of those fully-resolved rows were immediately discarded.

## Fix

One pass over `project.entities`:

1. Accumulates `pointCount`, `allPointIds` (original project order), and exact
   `memberCounts` for every group over **all** points.
2. Materializes a full info only when the survey-point index is inside
   `SURVEY_POINT_TABLE_CAP` **or** the point is selected. A point inside the
   cap that is also selected is materialized once and shared by both `table`
   and `selected` (same object reference, no duplicate resolver work).
3. Builds the id-only `pointStyleRefs` / `labelStyleRefs` descriptor arrays
   once per snapshot instead of per point.
4. Preserves `tableTruncated` from the **total** count, group counts beyond
   the cap, style/group priority, manual overrides, source text, station/
   point IDs, labels, selection outside the cap, and project ordering.

## Resolver work bound (measured)

`resolveSurveyPointDisplay` call counts, spied via the focused test
(`tests/cad_survey_snapshot_cap_191.test.ts`). The pre-#191 baseline is the
same algorithm resolving every point. Fixture selection =
`[0, 1, 250, 499, 500, 501, 2500, 4999]` filtered to the fixture size.

| Points | Selected | Before (#191 path) | After (this fix) | Table rows | `tableTruncated` |
| ---: | ---: | ---: | ---: | ---: | :---: |
| 0 | 0 | 0 | 0 | 0 | false |
| 1 | 1 | 1 | 1 | 1 | false |
| 499 | 3 | 499 | 499 | 499 | false |
| 500 | 4 | 500 | 500 | 500 | false |
| 501 | 5 | 501 | 501 | 500 | true |
| 5000 | 8 | 5000 | **504** | 500 | true |

Bound: `after = min(N, 500) + (selected points with index >= 500)`. At 5000
points with no selection that is exactly **500** (10x fewer resolver calls);
the 4 selected points beyond the cap add 4 more (504).

## Parity matrix

`tests/cad_survey_snapshot_cap_191.test.ts` compares the new snapshot to a
verbatim copy of the pre-#191 algorithm (`baselineSnapshot`) at every fixture
size. Equality is checked with both `toEqual` and `JSON.stringify` (so key
insertion order + array ordering are pinned, not just deep values).

| Points | `toEqual` + JSON parity | `pointCount` | `allPointIds` | `table` ids | `selected` ids |
| ---: | :---: | ---: | :---: | :--- | :--- |
| 0 | PASS | 0 | 0 | `[]` | `[]` |
| 1 | PASS | 1 | 1 | `[pt:0]` | `[pt:0]` |
| 499 | PASS | 499 | 499 | first 499 | selected (project order) |
| 500 | PASS | 500 | 500 | first 500 | selected (project order) |
| 501 | PASS | 501 | 501 | first 500 | selected incl. `pt:500` |
| 5000 | PASS | 5000 | 5000 | first 500 | selected incl. `pt:4999` |

Additional pinned behavior:

- Group counts cover all points, not the table: at 5000 points `All Points`
  = 5000, `Control Points` = 715, `Veg Override` = 455 (all > 500).
- A selected point inside the cap shares one materialized object between
  `table` and `selected` (`toBe` identity).
- A selected point beyond the cap is present in `selected` and absent from
  `table` (`pt:500` at 501; `pt:599` at 600; `pt:4999` at 5000).
- Style/label resolution priority and source labels are unchanged: manual
  override beats groups; group priority orders point vs label overrides
  independently; source text reports `Manual override`,
  `Point Group "<name>"`, `Base style`, `Drawing default`.

## Validation

- `node scripts/runVitest.mjs run tests/cad_survey_snapshot_cap_191.test.ts
  tests/cad_survey_display_commands_18d.test.ts tests/cad_shell_layout.test.ts
  tests/cad_shell_panels.test.tsx tests/cad_shell_parcel_report.test.tsx
  tests/cad_shell_registry.test.ts tests/cad_shell_snapshot_contract.test.ts
  tests/surveyCad_shell_chrome.test.tsx` → 8 files, 126 tests PASS.
- Survey workspace neighbours (`.01/.14/.46/.49/.50/.52`) → 6 files, 20 tests
  PASS.
- `node scripts/checkPortablePaths.mjs` → 6175 tracked paths, 0 violations.
- LSP diagnostics clean on both changed files.

## Fixes #191

Fully proven: the expensive display resolution is bounded to
`cap + selected-beyond-cap` while every observable output is byte-identical to
the pre-fix snapshot.
