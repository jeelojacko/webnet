# SURV-BEARING-201.1 — architecture

Branch: `fix/issue201-bearing-format-and-dialect-parity`
Baseline: `origin/main 76e7aa399eb2c0b107c2ff23bb3a9677d2fe5c25` (PR #265 merge)
Refs: #201 only (never Closes/Fixes; #201 stays OPEN). #200 untouched.

## Scope

1. Consolidate the byte-identical CAD bearing formatter into one leaf.
2. Audit (and keep) the intentionally different CAD vs importer DMS dialects.
   The optional shared quadrant helper was **not wired** (see below).
3. Add a scoped `INVALID -> 0` shape gate at the importer boundary only.

No solver/numerical change, no fixture edit, no UI/menu/command change, no
settings change, and no accepted-valid-input value change.

## 1. Formatter consolidation

New zero-import leaf `src/engine/cad/cadBearingFormat.ts` owns the single
`formatCadBearing` (algorithm moved verbatim, including the `seconds >= 59.995`
carry, the `minutes >= 60` carry, the `degrees > 90` defensive clamp, and the
`Ndd-mm-ss.ssE` template). Its `padInteger` is private to the leaf.

- `cadCogoSummaries.ts` imports the leaf and re-exports it
  (`import { formatCadBearing } from './cadBearingFormat'; export { formatCadBearing };`).
  The public path and binding identity are preserved. `cadCogoSummaries` keeps
  its own private `padInteger` because `formatCadNorthAzimuthDms` and
  `formatCadSweepDms` still use it; those are different formatters.
- `cadCogoCurveMath.ts` imports the leaf, deletes `formatCadBearingForCurve`
  and its duplicated `padInteger`, and `cadRadialBearingAtArcAngle` now calls
  the shared function.
- `cadBatchCogoParsing.ts` binds `formatCadBearing` from the leaf (its
  `cadPointFromBearingDistance` import still comes from the `./cadCogo` facade).

String shape is unchanged. Binding identity
`summaries.formatCadBearing === cogoMath.formatCadBearing === leaf` holds.

### Import-graph note

The leaf has zero imports. New edges (all VALUE):

| from | to |
| --- | --- |
| `src/engine/cad/cadCogoSummaries.ts` | `src/engine/cad/cadBearingFormat.ts` |
| `src/engine/cad/cadCogoCurveMath.ts` | `src/engine/cad/cadBearingFormat.ts` |
| `src/engine/cad/cadBatchCogoParsing.ts` | `src/engine/cad/cadBearingFormat.ts` |

Measured graph deltas (`scripts/cadTypeImportGraph.mjs`):

| scope | nodes | edges | value/mixed edges | unique VALUE pairs | VALUE sha256 |
| --- | --- | --- | --- | --- | --- |
| CAD+F2F before | 513 | 2486 | 1585 | 1567 | `0bc9bae1…` |
| CAD+F2F after | **514** | **2489** | **1588** | **1570** | `f1ef85bbd9e6cc3f0a7d9d82407a133dc92cf8f041640626036c34a7c90552d1` |
| full `src` before | 1685 | 7597 | 4444 | 4385 | `415f97f0…` |
| full `src` after | **1686** | **7600** | **4447** | **4388** | `e1bad92e1864e6093b9399f95e08464d1fa3e1bbb94f3767bbaa6017205bc410` |

No new VALUE or TYPE cycle was introduced (VALUE 0/0, TYPE 7 SCC / 38 nodes
unchanged). The 22 pinned structural guard suites were rolled forward with the
new counts, VALUE digests, and a `SURV_2011_ADDED_NODES`/`EDGES` (1/3) delta.

## 2. Quadrant helper — not wired (documented)

The NE/SE/SW/NW mapping is trivially byte-equivalent across the three call
sites, but `src/engine/cad/cadGeometryPrimitives.ts` is a **SHA-pinned
zero-import leaf** from STRUCT-195.14: `tests/cad_geometry_primitives_runtime_cycle_19514.test.ts`
pins its raw body SHA256 and asserts zero import/export specifiers and zero
VALUE out-edges. Extracting a shared quadrant helper and importing it there
would break that frozen architecture boundary. It would also pull the
importer/engine helper into `#200`'s angle-dedup territory.

Decision: keep each caller's local mapping (clamp stays in CAD, raw stays in
the importer, `dmsToRad` body stays in `parseTokenHelpers`). The three current
behaviours are pinned byte-for-byte by the new dialect matrix instead.

## 3. Importer invalid-to-zero gate

`parseDmsAngleDegrees` (`src/engine/importers/sharedText.ts`) requires a strict
numeric DMS shape in the normalized token before calling `dmsToRad`:

```ts
if (!/^[+-]?(?=.*\d)(?:\d+(?:\.\d*)?|\.\d+)(?:-(?:\d+(?:\.\d*)?|\.\d+)){0,2}-?$/.test(normalized)) {
  return undefined;
}
```

Normalization above has already rewritten degree symbols to hyphens and
stripped whitespace/quotes. The shape encodes three deliberate rules:

1. **single-dot segments** — each hyphen-separated segment is `\d+.\d*` or
   `.\d+`, so a multi-dot numeric like `0.0.0` is rejected (the interim
   `[\d.]+(?:-[\d.]+)*` gate accepted it and `dmsToRad` read `0`).
2. **at most three hyphen parts** (degree/minute/seconds) — a 4th segment
   like `0-00-00-1` / `45-30-00-1` is rejected instead of being silently
   truncated to `0` / `45`.
3. **one optional trailing hyphen** — degree-symbol normalization turns
   `45°` into `45-` and `45°30'` into `45-30-`; `dmsToRad` reads the empty
   trailing part as `0`, so abbreviated DMS stays valid (`45°` -> `45`,
   `45°30'` -> `45.5`). A literal `45-` (no symbol) therefore keeps its
   pre-change value `45`; this is preserved behavior, not "fixed".

Accepted: compact DDD.MMSS, hyphenated DMS (incl. a fractional final
segment), `.5`, `45.`, bare/negative numbers, full and abbreviated
degree-symbol forms, and `0-00-00` / `0.0000` (valid `0`). Rejected:
letters-only and digit-bearing garbage (`abc1`, `45abc`, `12a34`, `1a2b3c`,
`-abc`, `N/A1`), multi-dot/extra-segment numerics (`0.0.0`, `0-00-00-1`),
consecutive separators (`45--30`), lone sign/dot/empty, and exponent notation
(`1e3`, `1E3`). Consecutive-separator and exponent inputs were leniently
parsed before the gate; their rejection is a deliberate policy choice, not a
regression. (Reviewer P1 round 2 corrected the interim `[\d.]+(?:-[\d.]+)*`
gate, which had both a P2 abbreviated-symbol regression and a P1 multi-dot /
4th-segment hole.)

`dmsToRad` (and `toDegrees`/`parseAngleTokenRad`, minute-overflow leniency)
are untouched. Malformed tokens (`abc`, `NaN`, quadrant-letters-only, empty,
plus digit-bearing garbage like `abc1`/`45abc`)
now return `undefined` instead of passing `dmsToRad`'s `0` through as a valid
0-degree value. Legitimate values are unchanged:

- compact DDD.MMSS `45.3000` -> `45.511111111111106`
  (`dmsToRad`'s measured value; the "45.5" in the issue text is the
  mathematical DDD.MMSS value, not the current implementation output — see
  validation.md),
- RW5 `AR45.1234` -> `45.209444444444436` (45°12'34"),
- hyphenated DMS `45-30-00` -> `45.5`,
- degree-symbol forms normalize the same way,
- `0-00-00` / `0.0000` stay valid `0`.

## Dialect matrix (measured, do not unify)

| token | CAD `cadParse*` | importer `parse*` | `parseTokenHelpers` |
| --- | --- | --- | --- |
| `45.3000` (compact) | decimal `45.3` | DDD.MMSS `45.511111111111106` | (`N45.3000E`) decimal body `45.3` |
| `45-30-00` | DMS `45.5` | DMS `45.5` | DMS `45.5` |
| `N99E` | clamp `90` | raw `99` | clamp `90` |
| `N99W` | clamp→`270` | raw `261` | clamp→`270` |
| bare `360` / `720` | wrap `0` | raw `360` / `720` | n/a |
| `abc` / `NaN` / `NNE` | `null` | `undefined` | `null` |
| `0-00-00` / `0.0000` | `0` | `0` | — |

## Files changed

Source:
- new `src/engine/cad/cadBearingFormat.ts`
- `src/engine/cad/cadCogoSummaries.ts`
- `src/engine/cad/cadCogoCurveMath.ts`
- `src/engine/cad/cadBatchCogoParsing.ts`
- `src/engine/importers/sharedText.ts`

Tests:
- new `tests/surv_bearing_2011_format_dialect.test.ts`
- 22 structural guard suites rolled forward (15 `STRUCT-241.x` count/digest
  files, `1957/1958/1959/19510/19511/19512/19514`).

## Remaining #201 parser work

`importReviewFormatters.parseDirectionAngleTokenDeg` calls `dmsToRad`
directly, so a malformed token there still becomes `0`; it was intentionally
out of this scoped change. The broader cross-module quadrant/DMS dedup remains
#200.

## SURV-DMS-200.2 correction (post-hoc, append-only)

`dmsToRad`'s compact `DDD.MMSS` branch read the fractional body through
floating-point subtraction, so 4-digit minutes could carry into seconds. The
SURV-DMS-200.2 fix strips one leading sign before the hyphen/compact decision
and extracts `MM`/`SS`/fractional tail textually; the hyphenated branch math is
unchanged (and the historical lenient `parseFloat` body is preserved for
non-numeric shapes such as `45abc`). Float-carry values recorded above are
corrected as follows:

| token | prior (carry) | corrected (oracle) |
| --- | --- | --- |
| `45.3000` | `45.511111111111106` (45°30'40") | `45.5` (45°30'00") |
| `N45.3000E` | `45.511111111111106` | `45.5` |
| `45.1234` | `45.209444444444436` (last-bit) | `45.20944444444445` (`45 + 12/60 + 34/3600`) |

Files: `src/engine/angles.ts` (compact branch only) and
`tests/surv_bearing_2011_format_dialect.test.ts` (goldens corrected with
truth-in-history comments); new `tests/dms_compact_carry_2002.test.ts`.
