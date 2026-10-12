# SURV-DIR-200.1 — architecture

Branch: `fix/issue200-direction-face2-invalid-angle-gate`
Baseline: `071dd1680714bedc554f531c1fadf06d45a8c8fc` (PR #266 merge)
Refs: #200 only. No settings/tools/model/secret changes. No git
reset/clean/stash. Stashes and ignored `study-desktop` fixtures untouched.

## Problem (proven pre-fix)

`parseDirectionAngleTokenDeg` called `dmsToRad(trimmed)` first. `dmsToRad`
returns literal `0` for unparseable input (`src/engine/angles.ts:31-32`), so the
`parseFloat` fallback never fired and garbage became a valid zero:

| token | pre-fix `parseDirectionAngleTokenDeg` |
| --- | --- |
| `abc1`, `garbage` | `0` |
| `45abc` | `45` (old `parseFloat` fallback) |
| `0.0.0` | `0` |
| `0-00-00-1` | `0` |
| `+` | `0` |

For a face-2 row, `normalizeDirectionLineFace2ToFace1` then subtracted 180 and
fabricated `180-00-00.0`. The `?? entry.line` fallback in
`buildFaceAwareDirectionSetLines` additionally leaked the raw malformed shape
past the formatter, where `parseAngleTokenRad`/`dmsToRad` still accepted
`45abc` (as 45), `0.0.0` (as 0) and `0-00-00-1` (as 0) as authoritative
measurements (`src/engine/parseDirectionSetRecords.ts` DN/DM path).

## Fix (narrow, two seams, deliberately duplicated predicate)

1. The strict DMS/numeric shape predicate `isStrictDirectionAngleToken` is
   defined **locally in both consumers** (`src/engine/importReviewFormatters.ts`
   and `src/engine/parseDirectionSetRecords.ts`) with zero new imports. It
   mirrors the `sharedText.ts` dialect (`°`/`º`/`'` -> `-`, strip `"`/whitespace,
   single-dot segments, at most three hyphen parts, one optional trailing
   hyphen) so both call sites share the exact same rejection set without adding
   a core-parser -> import-review dependency and without touching `dmsToRad`.

   Duplication rationale: the predicate was first shipped as a shared zero-import
   leaf (`src/engine/directionAngleTokenShape.ts`), but any new file adds a
   full-`src` graph node (1687 vs the pinned 1686) and any new cross-module
   import edge breaks the 15 STRUCT-24xx full-`src` graph pins (nodes 1686 /
   edges 7600 + pairDigest). File-content-only changes do not affect the digest
   (it hashes structure), so the fix inlines the identical predicate in both
   consumers. Each copy carries a one-line comment naming its sibling.

2. `src/engine/importReviewFormatters.ts:83` gates
   `parseDirectionAngleTokenDeg` on that predicate **before** `dmsToRad`.
   Malformed -> `undefined`; `normalizeDirectionLineFace2ToFace1` then returns
   `null` (no fabricated 180) and the raw fallback keeps the original line.

3. `src/engine/parseDirectionSetRecords.ts:193-199` gates the DN/DM direction
   angle in the parseInput route. Malformed raw fallback lines are skipped with
   the existing `Invalid direction angle ... skipping` log. Preanalysis planned
   tokens (`?`/empty) stay valid. Only `parts[2]` (the direction angle) is
   gated; the DM vertical/dist tokens and every other parser are untouched.

`buildFaceAwareDirectionSetLines` normal face-2 `-180` subtraction is
unchanged, DB/DN/DM/DE ordering and face hints are unchanged, and no DN/DM/DB/
DE override/provenance/serialization behavior changed.

### Touch points

| file | change |
| --- | --- |
| `src/engine/importReviewFormatters.ts` | local `isStrictDirectionAngleToken` + 1-line gate at `:83` |
| `src/engine/parseDirectionSetRecords.ts` | local `isStrictDirectionAngleToken` + `isStrictQuadrantBearingToken` + gate at `:193-199` |

Not touched: `src/engine/angles.ts` (`dmsToRad`), `importers/sharedText.ts`
(`parseDmsAngleDegrees`, #266 pin), CAD formatter, solver, WNCAD/F2F contracts.

## Valid-value preservation

Every previously-finite value stays bit-identical (gate only; computation
unchanged). Pinned in the test matrix, e.g. `0`/`180`/`360`/`90`/`270`,
`45.3000 -> 45.51111111111112`, `045-30-00 -> 45.5`, `45- -> 45`,
`45° -> 45`, `45°30' -> 45`, `45-30-00.5 -> 45.5001388888889`,
`-45.5 -> 314.5`, `0-00-00 -> 0`, `0.0000 -> 0`, `.5 -> 0.8333333333333144`,
`45. -> 45`.

Note: the recurrence target `45.3000 -> 45.511111111111106` is the raw
`dmsToRad('45.3000') * RAD_TO_DEG` value. `parseDirectionAngleTokenDeg` has
always applied `normalizeDirectionAngleDeg` after conversion (the `%360`
round-trip), so the historical, still-current result is
`45.51111111111112`. The gate preserves that exact baseline value.

## P2 correction — quadrant-bearing raw DN/DM tokens

Reviewer finding `reviewer-dir2001-final` (blocking): the strict DMS/numeric
gate at `parseDirectionSetRecords.ts:191-197` also rejected valid quadrant
bearings (`DN 2 N45E` / `DM 2 N45E`) that `parseAngleTokenRad` genuinely
accepts on the DN/DM route via `parseQuadrantBearingTokenToRad`
(`src/engine/parseTokenHelpers.ts:328-330`). The new suite lacked that path.

Confirmed from source: `parseObservedAngleToken(ang, 'dms')` ->
`parseAngleTokenRad` tries `parseQuadrantBearingTokenToRad` first, so `N45E`
-> 45°, `N45-30-00E` -> 45.5°, `S45W` -> 225°, lowercase `n45e` -> 45°.
`parseDirectionAngleTokenDeg` (import-review formatter) does **not** support
quadrant tokens (`dmsToRad('N45E')` is literal 0), so widening the shared
predicate would have re-broken the review path.

Narrow fix: `src/engine/parseDirectionSetRecords.ts` now also defines
`isStrictQuadrantBearingToken` locally (same single-dot/<=3-part DMS body grammar,
wrapped in `[NS]...[EW]`, case-insensitive).
`src/engine/parseDirectionSetRecords.ts` admits a token when it is a strict
DMS/numeric token **or** a strict quadrant bearing. The import-review formatter
gate is untouched.

This keeps the route fail-closed: `parseQuadrantBearingTokenToRad` is lenient
(`N45abcE` -> 45, `N45EXE` -> 45, `N0.0.0E` -> 0), so the strict quadrant
predicate, not the low-level parser, is the gate. `N45abcE`/`N45EXE`/
`N0.0.0E`/`N0-00-00-1E`/`N45--E`/`N45Eextra` stay rejected.

Face-2 `N45E` baseline (documented, not invented): the review formatter
returns `undefined`/`null` for the quadrant token, the raw line is preserved
(no fabricated `180-00-00.0`), and the route then reads it as 45° with a
face-1 fallback. Pinned in the suite.

### P2 touch points

| file | change |
| --- | --- |
| `src/engine/parseDirectionSetRecords.ts` | local `+ isStrictQuadrantBearingToken` predicate + gate condition admits strict quadrant bearings |
| `src/engine/parseDirectionSetRecords.ts` | gate condition admits strict quadrant bearings |
| `tests/surv_dir_2001_face2_invalid_angle_gate.test.ts` | `+7` quadrant regression/negative-control tests (15 -> 22) |

## P2b correction — trailing hyphen before the E/W suffix

Reviewer finding `reviewer-dir2001-r3` (blocking): the P2 quadrant predicate
required a numeric body immediately before the E/W suffix, so the abbreviated
DMS form `N45-E` was classified malformed even though
`parseQuadrantBearingTokenToRad` reads it as 45°. This was inconsistent with the
strict numeric predicate, which already allows one optional trailing hyphen
(`...-?$` at `parseDirectionSetRecords.ts:24`), so `45-` quantified as 45° on
the numeric side while `N45-E` was dropped as a quadrant token.

Source-confirmed parser agreement (body between `[NS]` and `[EW]` -> `dmsToRad`
when a hyphen is present):

| token | parser body | `parseQuadrantBearingTokenToRad` |
| --- | --- | --- |
| `N45-E` | `45-` | 45° |
| `S45-W` | `45-` | 225° |
| `n45-e` | `N45-E` (uppercased) | 45° |

Narrow fix: `isStrictQuadrantBearingToken` changed
`...(?:-(?:\d+(?:\.\d*)?|\.\d+)){0,2}[EW]$` to
`...(?:-(?:\d+(?:\.\d*)?|\.\d+)){0,2}-?[EW]$`, adding exactly one optional
trailing hyphen before the suffix. This mirrors the numeric predicate's `-?$`
allowance. Still rejected: `N45--E` (two hyphens), `N45Eextra`, `N45abcE`,
`N0.0.0E`, `N0-00-00-1E`, empty body. No new files, imports, or graph edges;
the STRUCT pins (full-`src` nodes 1686 / edges 7600) are unchanged.
