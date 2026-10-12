# SURV-BEARING-201.1 — validation

All commands run on branch `fix/issue201-bearing-format-and-dialect-parity`
(baseline `origin/main 76e7aa399eb2c0b107c2ff23bb3a9677d2fe5c25`). No commit,
push, or PR was made from this worker.

## Commands

| command | result |
| --- | --- |
| `node scripts/runVitest.mjs run tests/surv_bearing_2011_format_dialect.test.ts` | 1 file, **19 passed** |
| `node scripts/runVitest.mjs run tests/cad_cogo_arc_summaries_runtime_cycle_19513.test.ts …19511/19512/19514/1957/1958/1959/19510 + new file` | 9 files, **260 passed** |
| `node scripts/runVitest.mjs run <15 STRUCT-241.x graph guards>` | 15 files, **1168 passed** |
| `node scripts/runVitest.mjs run tests/cadCogo tests/cad_f2f_importers.test.ts tests/cad_cogo_reports.test.ts tests/external_importers_phase3.spec.ts tests/phase17c_import_integrity.test.ts tests/importReview` | 26 files, **215 passed** |
| `node scripts/runVitest.mjs run tests/cadCogo tests/cad_draft_labels.test.ts tests/cad_draft_tables.test.ts tests/cad_survey_export_legal_19a.test.ts tests/cad_line_l1_parsers.test.ts tests/cad_line_l1_batch.test.ts tests/cad_parcel_curved_outputs_19c.test.ts tests/cad_parcel_curved_exports_19c.test.ts tests/adjustedPointsExport` | 24 files, **228 passed** |
| `npm run check:portable-paths` | **6446 tracked paths, 0 violations** |
| `npm run build` | **clean** (`✓ built in 15.32s`; only the pre-existing chunk-size warning) |

`npm run test:agent` was intentionally not run (parent owns the single pre-PR
run). Lint/typecheck are owned by Husky at commit time.

### Round 2 (P1/P2 correction) commands

| command | result |
| --- | --- |
| `node scripts/runVitest.mjs run tests/surv_bearing_2011_format_dialect.test.ts` | 1 file, **28 passed** |
| `node scripts/runVitest.mjs run tests/external_importers_phase2.spec.ts tests/external_importers_phase3.spec.ts tests/cad_f2f_importers.test.ts tests/phase17c_closeout.test.ts tests/phase17c_import_integrity.test.ts tests/importReview tests/parse_*.test.ts` | 19 files, **129 passed** |
| `node scripts/runVitest.mjs run <22 rolled-forward structural guards> tests/cad_cogo_arc_summaries_runtime_cycle_19513.test.ts tests/landxml_import_review_selection.test.ts tests/landxml_import_build_glue_18m.test.ts tests/landxml_interchange.test.ts tests/landxml_export.test.ts` | 27 files, **1437 passed** |
| `npm run check:portable-paths` | **6446 tracked paths, 0 violations** |
| `npx tsc --noEmit` | **clean** |
| `npx eslint src/engine/importers/sharedText.ts tests/surv_bearing_2011_format_dialect.test.ts` | **clean** |

`npm run build` is not re-run in round 2 (only a runtime regex + tests + docs
changed; no import-graph/source-edge change). `npm run test:agent` is still
intentionally not run (parent owns the single pre-PR run).

## Formatter before-vs-after matrix

The frozen pre-refactor algorithm is reproduced inside the new test and every
assertion is checked through **both** public paths (summaries + cogoMath) and
the leaf, plus the curve/radial consumer.

Exact strings (unchanged):

| azimuth | string |
| --- | --- |
| `0` | `N00-00-00.00E` |
| `90` | `N90-00-00.00E` |
| `135` | `S45-00-00.00E` |
| `180` | `S00-00-00.00E` |
| `225` | `S45-00-00.00W` |
| `270` | `S90-00-00.00W` |
| `315` | `N45-00-00.00W` |
| `360` | `N00-00-00.00E` |
| `-90` | `S90-00-00.00W` |
| `-0.000000001` | `N00-00-00.00W` |
| `45.5` | `N45-30-00.00E` |
| `89.999999999` | `N90-00-00.00E` |
| `90.000000001` | `S90-00-00.00E` |
| `720.000000001` | `N00-00-00.00E` |
| carry `0.016666` | `N00-01-00.00E` |
| carry `179.983334` | `S00-01-00.00E` |
| carry `180.016666` | `S00-01-00.00W` |
| carry `359.983334` | `N00-01-00.00W` |

Non-finite baseline pinned as-is: `NaN`, `+Infinity`, `-Infinity` all render
`NNaN-NaN-00NaNW` (pinned, not "fixed"). A deterministic 1250-point finite grid
(±720 step 0.5 plus 500 LCG values) equals the frozen algorithm for every
public path. Binding identity
`summaries.formatCadBearing === cogoMath.formatCadBearing` is asserted, as are
the radial strings (`0 -> N90-00-00.00E`, `135 -> N45-00-00.00W`, …).

## Parser dialect before-vs-after

`45.3000` is the important measured correction: `dmsToRad` returns
`45.511111111111106` (binary `0.3` makes `Math.floor((absVal - d) * 100)` land
on `29`), **not** `45.5`. The gate preserves that exact value; the test pins it.
CAD keeps decimal `45.3` for the same token, so the test also asserts the two
dialects differ (`45.3 !== 45.511111111111106`) so a future unification fails.

`AR45.1234` stays DDD.MMSS `45.209444444444436` (45°12'34"). CAD clamp/wrap
(`N99E -> 90`, `N99W -> 270`, `360/720 -> 0`) vs importer raw (`99`, `261`,
`360`, `720`) is pinned. `parseTokenHelpers` keeps its decimal body
(`N45.3000E -> 45.3`). Malformed tokens now return CAD `null` / importer
`undefined`; `0-00-00` and `0.0000` remain valid `0`.

### FAIL-FIRST at the real importer boundary

A constructed Carlson RW5 `SS` record with `ARgarbage` is pushed through
`importExternalInput` + `parseInput`; the test asserts no `angle` observation
is emitted (and none with `obs === 0`). The same record with `AR45.1234`
still imports an angle observation ≈ `45.209…°`. This is the pre-gate failure
path: `resolveRw5ShotOrientation` used to receive `0` and emit a valid
0-degree measurement.

### Reviewer P1/P2 correction: strict DMS shape gate (round 2)

The first gate (`if (!/\d/.test(normalized)) return undefined`) only required
one digit anywhere, so `abc1` passed and `dmsToRad` returned `0` — the same
false 0-degree observation via `parseRw5AngleToken`. The interim P1 gate
(`/^[+-]?(?=.*\d)[\d.]+(?:-[\d.]+)*$/`) closed that hole but had two defects
that round 2 fixes:

- **P2 regression** — it rejected a trailing hyphen, but normalization maps
  `45°` -> `45-` and `45°30'` -> `45-30-`, so valid abbreviated symbols were
  rejected, contradicting architecture.md;
- **P1 hole** — `[\d.]+` accepted multiple dots and `(?:-[\d.]+)*` accepted a
  4th segment, so `0.0.0` and `0-00-00-1` passed and `dmsToRad` emitted a
  valid `0`.

The round-2 gate is a strict numeric DMS shape check on the already-normalized
token:

```ts
if (!/^[+-]?(?=.*\d)(?:\d+(?:\.\d*)?|\.\d+)(?:-(?:\d+(?:\.\d*)?|\.\d+)){0,2}-?$/.test(normalized)) {
  return undefined;
}
```

- single-dot segments reject `0.0.0` (and `45..30`, `.5.5`);
- `{0,2}` hyphen groups reject a 4th segment (`0-00-00-1`, `45-30-00-1`);
- the trailing `-?` restores abbreviated symbols: `45°` -> `45`,
  `45°30'` -> `45.5`, `45°30'00"` -> `45.5`; a literal `45-` keeps its
  pre-change value `45`.

Deliberate policy additions: consecutive separators (`45--30`) and exponent
notation (`1e3`, `1E3`) were leniently parsed pre-gate and are now rejected.

`dmsToRad`, the fieldbook path, CAD parsers, minute-overflow leniency, and the
formatter leaf are untouched. Coverage in
`tests/surv_bearing_2011_format_dialect.test.ts` is now **28 passed**
(round 1's suite was 23 passed; +5 new tests): malformed tokens `abc1`,
`45abc`, `12a34`, `1a2b3c`, `-abc`, `N/A1`, `0.0.0`, `0-00-00-1`,
`45-30-00-1`, `45--30`, `1e3`, `1E3`, `45..30`, `.5.5`, `--45`, `-`, `+`,
`.`, `` -> `undefined`; the RW5 boundary records `ARabc1`, `AR0.0.0` and
`AR0-00-00-1` each emit no angle observation (mirroring the `ARgarbage`
FAIL-FIRST test); and the full valid matrix (`45.3000` -> `45.511…`,
`-45.5`, `.5` -> `50/60`, `45.`, `045-30-00`/`-45-30-00`/`45-30-00.5`,
`45°`/`45°30'`/`45°30'00"`, literal `45-`, bare `45`/`0`/`720`,
`0-00-00`/`0.0000` -> `0`) is re-asserted unchanged.

Negative control: reverting the gate to the any-digit version
(`if (!/\d/…)`) fails **7 of the 28** tests — the digit-bearing malformed
loop, the P1 multi-dot/extra-segment loop, both regression controls, and the
three RW5 boundary records (`ARabc1`, `AR0.0.0`, `AR0-00-00-1`) — confirming
the new tests are non-vacuous.

No existing fixture uses a now-rejected shape: the 19 importer/parse suites
and 27 guard/landxml suites above are green, and a repo-wide scan found only
non-DMS uses of `0.0.0` (XML `applicationVersion`) and `1e3` (grading
arithmetic), neither of which reaches `parseDmsAngleDegrees`.

## Non-vacuous negative controls

The new suite mutates the frozen oracle and shows each mutation diverges from
the production result, so the pins would catch a real regression:

- swap the quadrant mapping -> `135` differs (`N45-…` vs `S45-00-00.00E`),
- break the SE/SW sign symmetry -> `225` differs,
- remove the `59.995s` carry -> `0.016666` differs,
- flip the compact-token dialect -> CAD `45.3` vs importer `45.511…`,
- accept malformed tokens -> `dmsToRad('abc') === 0` (untouched) while
  `parseDmsAngleDegrees('abc') === undefined`, proving the gate is boundary
  scoped.

## Structural graph guard roll-forward

The mandated leaf adds 1 node and 3 VALUE edges, so the pinned graph guards
were rolled forward to the measured values (see architecture.md). 22 guard
suites updated: the 15 `STRUCT-241.x` count+digest files, plus
`1957/1958/1959/19510/19511/19512/19514`. `19511` additionally gained an
independent `SURV-BEARING-201.1` authorization so the bearing edges are
independently allowlisted and cannot hide behind the trio/parcel/arc/geometry
change sets. Value SCC 0/0 and TYPE SCC 7/38 are unchanged.

## Out of scope / remaining

- Item 2 shared quadrant helper: not wired; `cadGeometryPrimitives` is a
  SHA-pinned zero-import leaf (STRUCT-195.14). See architecture.md.
- `importReviewFormatters.parseDirectionAngleTokenDeg` still maps malformed
  tokens to `0` (calls `dmsToRad` directly).
- #200 owns the broader quadrant/DMS dedup.
