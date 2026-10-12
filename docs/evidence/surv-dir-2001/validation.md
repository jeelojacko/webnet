# SURV-DIR-200.1 — validation

Branch: `fix/issue200-direction-face2-invalid-angle-gate`
Baseline: `071dd1680714bedc554f531c1fadf06d45a8c8fc`

## Focused regression run (current working tree)

```
npx vitest run tests/surv_dir_2001_face2_invalid_angle_gate.test.ts \
  tests/parse_direction_set_records.test.ts \
  tests/parse_direction_set_workflow.test.ts \
  tests/surv_bearing_2011_format_dialect.test.ts \
  tests/jobxml_industry_style_import.spec.ts \
  tests/parse tests/importReview tests/importConflictReview tests/importReviewWorkflowState
```

Result: `Test Files 34 passed (34)`, `Tests 225 passed (225)`.

- New file `tests/surv_dir_2001_face2_invalid_angle_gate.test.ts`: 15 tests.
- PR #266 bearing/dialect suite (`surv_bearing_2011_format_dialect.test.ts`): green.
- `npx tsc --noEmit`: clean.
- `npx eslint` on the 3 src files + new test: clean.
- `npm run check:portable-paths`: 6450 tracked paths, 0 violations.
- `npm run build`: clean (14.01s).

## Fail-first proof (pristine HEAD, detached worktree — no working-tree mutation)

The new test file was copied into a detached worktree at HEAD
(`/tmp/webnet-prefix-200`, symlinked `node_modules`) and run against the
unmodified sources:

```
Test Files  1 failed (1)
Tests  7 failed | 8 passed (15)
```

The 7 pre-fix failures are exactly the guard-sensitive assertions:

```
× returns undefined for every malformed class instead of a false zero
× returns null for malformed face-2 lines instead of 180-00-00.0
× skips the malformed target and leaves only the genuine synthetic backsight
× rejects malformed raw direction angles even though the low-level parser accepts them
× fails if the strict invalid->0 gate is removed
× fails if the face-2 -180 normalization is altered or the guard dropped
× fails if a raw malformed direction line is accepted downstream again
```

The worktree was removed afterward. The validation test still passes, so the
negative controls are non-vacuous.

## Downstream rejection proof

`parseAngleTokenRad` (the low-level token parser) still accepts the malformed
shapes — `45abc` -> 45, `0.0.0` -> 0, `0-00-00-1` -> 0 — which proves the new
DN/DM route gate is the load-bearing seam for raw fallback lines.

End-to-end `buildImportReviewText -> parseInput` (synthetic setup, face2,
`rowOverrides: { 'observation:0': 'DN 2 <token>' }`):

| token | pre-fix emitted line | pre-fix direction obs | post-fix |
| --- | --- | --- | --- |
| `abc1` | `DN 2 180-00-00.0` | `to 2`, 180° | no target-2 obs; only `DN 1000 000-00-00` |
| `45abc` | `DN 2 225-00-00.0` (0 -> -180 wrap) | `to 2` | no target-2 obs |
| `0.0.0` | `DN 2 180-00-00.0` | `to 2`, 180° | no target-2 obs |
| `0-00-00-1` | `DN 2 180-00-00.0` | `to 2`, 180° | no target-2 obs |

Post-fix every malformed class (alpha, alpha+digit, mixed digits, multi-dot,
extra-segment, lone sign, empty) across face2/normalize-on,
face2/normalize-off, face1, and unresolved leaves at most the legitimate
synthetic backsight `DN 1000 000-00-00` (0°).

Raw route (no import review): `['DB 1 1000', 'DN 2 45abc', 'DE']` yields zero
direction observations post-fix; `000-00-00`/`0.0000`/`180` still yield real
0°/180° direction observations; preanalysis `DN 2 ?` still yields a planned
direction.

## Valid matrix preserved

Pinned bit-identical to baseline: `0`, `180`, `360`, `90`, `270`,
`45.3000 -> 45.51111111111112`, `045-30-00 -> 45.5`, `45- -> 45`,
`45° -> 45`, `45°30' -> 45`, `45-30-00.5 -> 45.5001388888889`,
`-45.5 -> 314.5`, `0-00-00 -> 0`, `0.0000 -> 0`,
`.5 -> 0.8333333333333144`, `45. -> 45`. Normal face-2 subtraction
(`DN 2 000-00-00.0 -> DN 2 180-00-00.0`) and the DB/DN/DM/DE ordering plus F1
hint output are unchanged. `dmsToRad` itself is untouched
(`dmsToRad('abc1') === 0` still).

## Verdict

**GO.** No malformed class survives as a valid direction observation on either
touch point, valid values are bit-identical, and the fail-first suite
demonstrates the guard is required.

Not run (out of scope / not routine): `test:full`, `test:wasm`, parity,
browser certification.

## Graph-pin correction (shared leaf -> duplicated locals)

The predicate first shipped as a shared zero-import leaf
(`src/engine/directionAngleTokenShape.ts`), which added one full-`src` graph
node (1687 vs the pinned 1686) and broke the 15 STRUCT-24xx full-`src` graph
pins. The correction deletes the leaf and inlines the identical predicate
locally in both consumers with zero new imports/edges; the test file defines
its own local quadrant-predicate copy so it imports nothing new from
`src/engine` (test files are not graph nodes — the full-`src` scope scans `src`
only — but the deleted module import had to go regardless). Behavior and valid
values are unchanged. Verified: `tests/cad_block_command_type_leaf_2412.test.ts`
(36) + `cad_survey_layer_command_type_leaves_2411` + `..._24116` (107) pin
tests pass with the rolled-back 1686/7600 counts, and the focused direction
suites (new 22-test suite + bearing dialect + direction-set records/workflow +
parse.05/06 + importReview.01-03) all pass; `tsc`/`eslint` clean on touched files.

## P2 correction — quadrant-bearing raw DN/DM tokens

Re-run after the P2 fix (`isStrictQuadrantBearingToken` predicate + route gate):

```
npx vitest run tests/surv_dir_2001_face2_invalid_angle_gate.test.ts   -> 22 passed (22)
npx vitest run <new suite> surv_bearing_2011_format_dialect
  parse_direction_set_records parse_direction_set_workflow
  parse.05 parse.06 importReview.01/02/03                        -> 9 files / 110 passed
npx vitest run tests/importReview tests/importConflictReview
  importReviewUnitConfirm importReviewWorkflowState directions
  parse_direction_set_records parse_direction_set_workflow      -> 12 files / 42 passed
```

- `npx tsc --noEmit`: clean.
- `npx eslint` on the touched src files + suite: clean.

The suite grew 15 -> 22 tests. Added coverage: strict quadrant shape matrix
(`N45E`/`N45W`/`S45E`/`S45W`/`N45.3000E`/`N45-30-00E`/`N0-00-00E`/`n45e`/
`N.5E`/`N45-E`/`S45-W`/`n45-e`), lenient-body rejection (`N45abcE`/`N45EXE`/
`N0.0.0E`/`N0-00-00-1E`/`N45--E`/`N45Eextra`), raw DN and DM end-to-end
acceptance (`N45E` -> 45°, `N45W` -> 315°, `S45E` -> 135°, `S45W` -> 225°,
`N45-30-00E` -> 45.5°, `N45.3000E` -> 45.3°, `N45-E` -> 45°, `S45-W` -> 225°,
`n45-e` -> 45°), malformed still blocked, the documented face-2 `N45E`
baseline, and a non-vacuous negative control proving the lenient low-level
parser reads `N45abcE` as 45° while the route drops it.

## P2b correction — trailing hyphen before the E/W suffix

Re-run after allowing one optional trailing hyphen in
`isStrictQuadrantBearingToken`:

```
npx vitest run tests/surv_dir_2001_face2_invalid_angle_gate.test.ts \
  tests/surv_bearing_2011_format_dialect.test.ts \
  tests/parse_direction_set_records.test.ts \
  tests/parse_direction_set_workflow.test.ts \
  tests/parse/parse.05.spec.ts tests/parse/parse.06.spec.ts \
  tests/importReview/importReview.01.spec.ts \
  tests/importReview/importReview.02.spec.ts \
  tests/importReview/importReview.03.spec.ts
  -> 9 files / 110 passed
npx vitest run tests/cad_block_command_type_leaf_2412.test.ts
  -> 36 passed (full-src graph pins 1686/7600 hold)
```

- `npx tsc --noEmit`: clean.
- `npx eslint` on the touched src file + suite: clean.

Moved `N45-E` from malformed to accepted in both the predicate matrix and the
raw DN/DM end-to-end pins, adding the case variants `S45-W` and `n45-e`; `N45--E`
now stands in the rejected set as the double-hyphen negative control.

## P2c — symbol-bearing quadrant bodies stay fail-closed (parent fallback)

Reviewer-r4 asked the gate to admit `N45°30'E`. Source proof it must stay
rejected: `parseQuadrantBearingTokenToRad` sends a hyphen-free body through
`Number.parseFloat`, which truncates at the first symbol, so `N45°30'E`
misreads as 45° (true 45.5°) and `N45°30'W` as 315° (true 314.5°). Admitting
them would enshrine a fake reading; the gate already admits exactly the
parser-value-correct subset (plain numerics, hyphenated bodies incl. `N45-E`
abbrevs). Suite pins `N45°30'E`/`N45°30'00"E`/`N45°30'W`/`S45°W` to zero
observations end-to-end with the misread values asserted (23/23 pass).
Symbol handling in the quadrant parser belongs to a separate explicit phase.
Slot-2 worker model went unavailable mid-phase (3× upstream 400); the
test+docs-only P2c was applied as parent emergency fallback per routing
rules and needs no re-review of src/ (unchanged since r4).

## SURV-DMS-200.2 correction (post-hoc, append-only)

`dmsToRad`'s compact `DDD.MMSS` branch carried 4-digit minutes into seconds and
routed single-part negatives (`-45.5`) through the hyphenated branch. The fix
strips one leading sign before the branch decision and extracts the compact
body textually. Corrections to values pinned earlier:

| token / path | prior (carry / accident) | corrected |
| --- | --- | --- |
| `parseDirectionAngleTokenDeg('45.3000')` | `45.51111111111112` (45°30'40") | `45.5` (45°30'00") |
| `parseDirectionAngleTokenDeg('-45.5')` | `314.5` (hyphen-branch accident) | `314.1666666666667` (compact 45°50') |
| `normalizeDirectionLineFace2ToFace1('DM 5 45.3000 10.0000')` | `DM 5 225-30-40.0 10.0000` | `DM 5 225-30-00.0 10.0000` |

`parseDirectionAngleTokenDeg('-45.3000')` now reads compact 45°30' = 314.5
(previously the misroute read it as -45.3° and normalized to 314.7). The strict
shape gate is unchanged; malformed tokens remain undefined.
