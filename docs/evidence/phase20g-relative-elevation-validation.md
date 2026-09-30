# Phase 20G — Grade to Relative Elevation: numerical validation

Branch: `feat/cad-grading-relative-elevation`
Baseline: `23a27721b894673715f8dad90ba8bbd116c6788c` (live `origin/main`)

Every oracle below is hand-computable and independent of the implementation:
expected values were derived by hand from the published equations
(`d = Δ/g`, `Zlimit(u) = Zsrc(u) + Δ`, `d` constant; `Zlimit = E` for absolute
Elevation), then compared against actual engine output. All figures are actual
test results.

Test files:

| file | tests |
|---|---:|
| `tests/cad_grading_relative_elevation_oracles_20g.test.ts` | 23 |
| `tests/cad_grading_relative_elevation_20g.test.ts` | 19 |
| `tests/cad_grading_group_relative_elevation_20g.test.ts` | 19 |
| `tests/cad_grading_relative_elevation_ui_20g.test.tsx` | 19 |
| `tests/cad_grading_relative_elevation_authority_20g.test.ts` | 12 |
| **Phase 20G total** | **92** |

---

## A. Level straight source

Source `(0,0,100) → (100,0)`, panel length 100 m, `side = right`,
`g = −0.5`, `Δ = −10`.

| quantity | expected (hand) | actual |
|---|---|---|
| `d` | `(−10)/(−0.5) = 20` at both ends | `[20, 20]` |
| limit points | `(0,−20,90)`, `(100,−20,90)` | `[0,−20,90, 100,−20,90]` (exact array equality) |
| accuracy | `EXACT` | `EXACT` |
| plan area | `100 × 20 = 2000` m² | `2000` (9 dp) |
| min/max/mean projection | `20 / 20 / 20` | `20 / 20 / 20` (bit-exact) |
| region | one `FIXED` spanning `[0,100]` | `[{FIXED,[0,100]}]` |
| cut/fill/tied source length | `0 / 0 / 0` | `0 / 0 / 0` |
| candidate / intersection / multiple counts | `0 / 0 / 0` | `0 / 0 / 0` |

## B. Sloped straight source

Source `(0,0,100) → (100,0,102)`, `g = −0.5`, `Δ = −10`.

| quantity | expected (hand) | actual |
|---|---|---|
| `d` | `20` at both ends (constant — Δ fixed, g fixed) | `[20, 20]` |
| limit points | `(0,−20,90)`, `(100,−20,92)` | `[0,−20,90, 100,−20,92]` (exact) |
| plan area | `100 × 20 = 2000` m² | `2000` (9 dp) |
| limit globally level? | **no** — follows the 2 % source grade | limit Z spans 90→92 |

## C. Distance equivalence

Same sloped source. Relative `Δ = −10, g = −0.5` vs Distance `D = 20, g = −0.5`.

| comparison | result |
|---|---|
| `daylightFlat`, `distances`, `nodeStations`, `sourcePts`, `regions`, `diagnostics` | **identical** |
| `gradingMesh.points`, `gradingMesh.triangles`, `daylightPoints` | **identical** |
| plan area, 3D area, min/max/mean projection | **identical** |
| zero counts | identical (`0/0/0`) |
| accuracy | identical (`EXACT`) |

Confirmed by digest equality in the performance harness
(`1183c0dccc5edce6` for both).

## D. Absolute Elevation non-equivalence

Same sloped source, `g = −0.5`.

| method | derived `d` | limit points | plan area |
|---|---|---|---|
| Relative Elevation `Δ = −10` | `20` constant | `(0,−20,90)` → `(100,−20,92)` | 2000 m² |
| absolute Elevation `E = 90` | `20` → `24` | `(0,−20,90)` → `(100,−24,90)` | 2200 m² |

The endpoint arrays are asserted **not equal**; the areas differ by >100 m².

## E. Wrong direction fails closed

| case | expected | actual |
|---|---|---|
| `g = +0.5`, `Δ = −10` → `d = −20` | `NO_SOLUTION` / `GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION` | exact match |
| `g = −0.5`, `Δ = +10` → `d = −20` | same | exact match |

The mirrored case proves the gate is not a one-direction special case, and no
value is averaged, negated or clamped.

## F. Upward grading is valid

Source `(0,0,100) → (100,0)` level, `g = +0.5`, `Δ = +10` → `d = 20`.

| quantity | expected | actual |
|---|---|---|
| `d` | `20` | `[20, 20]` |
| limit points | `(0,−20,110)`, `(100,−20,110)` — 10 m **above** the source | exact match |
| plan area | 2000 m² | `2000` (9 dp) |

## G. Over-search fails without clamping

`g = −0.5`, `Δ = −20` → `d = 40`, `maxSearchDistance = 30`.

| quantity | expected | actual |
|---|---|---|
| code | `MAX_DISTANCE_REACHED` | exact |
| detail | `GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH` | exact |
| clamped point returned | **none** | no solve returned |

Boundary control: `Δ = −15` → `d = 30 == maxSearchDistance` is **accepted** with
`distances = [30, 30]`, proving the gate has no off-by-one and no epsilon.

## H. Zero / malformed inputs fail closed

`validateGradingCriterion` rejects: `g = 0`, `Δ = 0`, `g = NaN`,
`g = +∞`, `Δ = NaN`, `Δ = +∞`; accepts `Δ = −10, g = −0.5` and
`Δ = +10, g = +0.5`.

Kernel returns `NO_SOLUTION` / `GRADING_BAD_CRITERION` for all four malformed
inputs. Structural equality is exact:

| pair | expected | actual |
|---|---|---|
| `(−0.5,−10)` vs `(−0.5,−10)` | equal | `true` |
| `(−0.5,−10)` vs `(−0.5,−10.000000001)` | not equal | `false` |
| `(−0.5,−10)` vs `(−0.500000001,−10)` | not equal | `false` |
| relative vs Distance / Elevation / Fixed | not equal | `false` (all three) |

## I. Large projected coordinates

Source translated to `E ≈ 2,000,000`, `N ≈ 7,000,000`, `g = −0.5`, `Δ = −10`.

| quantity | expected | actual |
|---|---|---|
| max translated limit-coordinate difference vs local origin | `< 1e-6` m | `< 1e-6` m |
| derived `d` | unchanged | `[20, 20]` |

## J. Closed 100 × 100 pad oracle

Closed CCW square, source `Z = 10`, `side = right` (outward), `g = −0.5`,
`Δ = −10` → `d = 20`.

| quantity | expected (hand) | actual |
|---|---|---|
| grading plan area | `10000 → 19600`, shell `9600` m² | `9600` (6 dp) |
| source area (shoelace) | `10000` m² | `10000` (6 dp) |
| outer limit area (shoelace) | `140 × 140 = 19600` m² | `19600` (6 dp) |
| outer bounding box | `X −20…120`, `Y −20…120` | exact (9 dp) |
| corner count / classification | 4 `GAP` | 4 `GAP` |
| corner tie points | `(120,−20,0), (120,120,0), (−20,120,0), (−20,−20,0)` | exact set equality |
| miter extent at every corner | `20√2 = 28.284271…` m | `28.284271…` (9 dp) |
| limit Z | `10 + (−10) = 0` | `min = max = 0` (9 dp) |
| mesh | real triangles | real points + triangles asserted non-empty |
| min/max projection | `20 / 20` | `20 / 20` (9 dp) |

Geometry-equivalence controls on this *flat* source: the Relative result is
byte-identical (digest) to both the Distance `D = 20` result and the absolute
`E = 0` result for limit points, mesh and areas — which is expected and is the
point of the oracle: they coincide only because the source is flat. §D proves
they diverge as soon as the source slopes.

## K. Arc convergence

Quarter circle `R = 100`, `g = −0.5`, `Δ = −10` → `d = 20`;
`curveChordTolerance` ∈ {1, 0.1, 0.01}; both sides.

| quantity | expected | actual |
|---|---|---|
| subdivision count ordering | coarse < medium < fine | 6 < 18 < 56 |
| mesh vertex growth | strictly increasing | asserted |
| accuracy | `CURVE_APPROXIMATED` | `CURVE_APPROXIMATED` |
| source points on the true arc | `< 1e-9` m radial error | `< 1e-9` m |
| projection distance | constant `20` | `min = max = 20` (bit-exact) |
| `Zlimit` (level source) | `Zsrc − 10 = 0` | `min = max = 0` (9 dp) |
| limit radial convergence to `R+20` (right) / `R−20` (left) | monotone as tolerance shrinks, fine `< 0.01` m | monotone; fine `< 0.01` m |
| branch jumps | none | none (constant projection asserted) |

## L. Determinism

| case | repeats | unique digests |
|---|---:|---:|
| standalone chord solve | 2 | 1 |
| closed 100 × 100 group | 2 | 1 |
| standalone `computeGradingFromSnapshots` | 2 | 1 |
| standalone (performance harness) | 25 | 1 |
| 20-course open group (performance harness) | 15 | 1 |

## M. Same-family group overrides

Closed square, default `Δ = −10`.

| case | expected | actual |
|---|---|---|
| sparse override `Δ = −12` on one course | kept (1 record) | 1 record |
| override exactly equal to the default | dropped (sparse reset) | `[]` |
| override-free group | resolves to the default everywhere | `[−10,−10,−10,−10]`, not materialized |
| uniform per-course `Δ = −10` | solves; 4 `GAP` corners; `9600` m²; miter `20√2` | all asserted |
| one course overridden to `Δ = −12` (flat source) | fails closed — the two limit lines disagree in Z | `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z` |
| `validateGroupTerminationCriteria(REL, [Distance])` | rejected, naming `Relative Elevation` | exact message asserted |
| `validateGroupTerminationCriteria(REL, [REL(−12), REL(+5,+10)])` | accepted (homogeneous family) | `null` |

No first-member shortcut and no default materialization: an override-free group
keeps `courseCriteria` absent.

---

## Revision byte-identity (legacy freeze)

Forty legacy `grev1:`/`ggrev1:` keys were captured at baseline `23a27721`
**before** any Phase 20G edit, covering fixed / cut-fill / distance / elevation
× straight / arc × {bare, target-bearing, group, group+target, group+override}.
All 40 are pinned in `LEGACY_PINS` in
`tests/cad_grading_relative_elevation_20g.test.ts` and all 40 remain
byte-identical. Notable pins proving group dormant-target invariance:

```
ggrev1/distance/line     = ggrev1:3e255a12   ==  ggrev1/distance/line/tgt
ggrev1/elevation/line    = ggrev1:b7de6085   ==  ggrev1/elevation/line/tgt
ggrev1/distance/arc      = ggrev1:3f1a0aba   ==  ggrev1/distance/arc/tgt
```

Relative Elevation revisions move when `Δ` changes and when `g` changes
(distinct hashes asserted), and a dormant `targetSurfaceId` does not move a
Relative Elevation revision on the real `resolveGradingInputs` path.

## Persistence, transform and provenance

| check | result |
|---|---|
| newly authored Relative Elevation has no `targetSurfaceId` key | asserted (`'targetSurfaceId' in grading === false`) |
| criterion round-trips verbatim through `cloneCadGrading` | asserted |
| malformed definitions dropped fail-closed; valid one kept verbatim | 4 malformed dropped, 1 kept |
| WNCAD serialize → parse preserves the criterion | asserted |
| no result/status/accuracy bytes persisted | asserted |
| `schemaVersion` unchanged | asserted |
| PROJECTTRANSFORM(×4): `Δ`, `g`, side invariant; `maxSearchDistance` 30→120; `curveChordTolerance` 0.01→0.04 | asserted |
| Distance still scales (20→80) — deliberately different contract | asserted |
| group transform scales neither `Δ` nor the default; sparse overrides stay sparse | asserted (`courseCriteria` stays `undefined` when absent) |
| selection-scoped transform (SCALE about a point) moves the selected geometry but leaves the grading definition verbatim (`Δ`, `g`, `maxSearchDistance`, `curveChordTolerance` unchanged) — contrasted against the project transform, which does rewrite lengths | asserted |
| design-patch provenance records `targetKind: 'relative-elevation'` + `relativeElevation`, omits `targetSurfaceId`/`targetElevation`/`criterionDistance` | asserted |
| group/standalone bake provenance normalizes and emits the canonical leg `relative-elevation:-10` | asserted |
| legacy surface provenance normalization unchanged and carries no relative field | asserted |
| legacy surface / distance / elevation revision legs unchanged (`distance:20`, `elevation:5`) | asserted |

## UI / shell contract (jsdom)

| check | result |
|---|---|
| `gradingMethodLabel('relative-elevation') === 'Relative Elevation'` (never `Elevation`) | asserted |
| `formatGradingCriterion` / `gradingTargetSummary` distinct from absolute Elevation, containing `offset 20.000` and `−10.000 m relative` | asserted |
| draft parse of a valid relative draft → `{kind:'relative-elevation', gradeRatio:−0.5, relativeElevation:−10}` | asserted |
| draft summary `Grade -50.000% → relative elev -10.000 m · offset 20.000 m` | asserted |
| draft round-trip through `gradingCriterionDraftFromCriterion` | asserted |
| zero grade / zero Δ / non-numeric / opposite-sign drafts all `null`; never parsed as `fixed` | asserted |
| wrong-direction diagnosis text surfaced before Calculate | asserted |
| upward draft accepted | asserted |
| method `<select>` offers exactly `Surface / Distance / Elevation / Relative Elevation` | asserted |
| own signed field with label + help text; absolute-elevation field and target-surface slot absent | asserted |
| locked group composer: no method select, locked label, relative field present, distance field absent | asserted |
| `GRADETORELATIVEELEVATION` + `GTRE` resolve to the same key; `GTR` does **not** resolve | asserted |
| `gradingShellMethod` maps the new key; `GRADING_SHELL_KEYS` contains it | asserted |
| snapshot row: `method='relative-elevation'`, `analytic=true`, `targetName='—'`, `boundaryLabel='Grading Limit'`, `cutFillApplicable=false`, `calculable=true` with **no surface present**, initial status `UNBUILT` | asserted |
| matching revision → `CURRENT`; a stale revision → `NEEDS_RECALC` (not exportable) | asserted |
| Properties renders Method/grade/Δ/derived offset | asserted |
| inquiry report shows `Target: Relative Elevation -10.000 m relative · grade -50.000%`, `cut — · fill — · tied —`, `Grading Limit vertices`, and never `Target: —` | asserted |
| CSV header uses `Limit`, never `Daylight`, and never claims an absolute elevation | asserted |
| group member rows: type `Relative Elevation`, source Default/Override, target value `-10.000 m relative` / `-12.000 m relative`, fixed/cut/fill columns `—`, grading area `—` | asserted |

## Legacy non-regression

| gate | result |
|---|---|
| pre-Phase-20G grading suites (31 files) | 388 tests, all pass |
| post-Phase-20G grading suites (35 files) | **468 tests, all pass** (PR-head rerun) |
| post-review-fix grading suites (36 files) | **480 tests, all pass** |
| Phase 20G suites after the review fix round (5 files) | **92 tests, all pass** |
| Phase 20F expected values updated | **none** |
| legacy revision pins | 40/40 byte-identical |
| old provenance revision legs | byte-identical |

No numerical expected value from `src/engine/cad/grading/gradingTypes.ts`'s
previous behaviour was changed to make a test pass.

---

## Independent review fix round

An independent reviewer inspected PR #136 at head `a19af14c` and returned
**REQUEST CHANGES / NO-GO** with six findings. All six were fixed and
regression-covered in `tests/cad_grading_relative_elevation_authority_20g.test.ts`
(12 tests); no reviewer-authored code change was needed.

| # | severity | finding | fix |
|---|---|---|---|
| 1 | high | A non-finite limit sum was accepted as an `ok` result: `sourceZ = g = Δ = 1e308` yielded `Infinity` limit vertices and a `NaN` 3D area. | `resolveAnalyticCriterionAt` now checks `Number.isFinite(sourceZ + Δ)` and fails closed with `NO_SOLUTION` / `GRADING_BAD_CRITERION`. |
| 2 | high | Finite source endpoints could overflow the derived longitudinal grade: end Z `1e308 → −1e308` produced `gs = −Infinity`, so a valid criterion emitted a mesh containing `NaN`/infinities. | `resolveAnalyticFrame` computes `gs` once and rejects a non-finite value with `NO_SOLUTION` / `GRADING_BAD_SOURCE` before any geometry is produced. |
| 3 | medium | The corner solver held a second closed-form authority, independently computing `Δ/g` and `(E − Zsrc)/g`, which could drift from the chord diagnostics. | `analyticTerminalLine` now resolves both `elevation` and `relative-elevation` through `resolveAnalyticCriterionAt` and takes the search bound as a parameter; all existing corner gates (direction, finiteness, Z agreement, side half-planes, miter extent) are unchanged. Distance keeps its legacy construction byte-for-byte. |
| 4 | medium | A fresh Relative Elevation authoring call could persist a passed `targetSurfaceId`, contradicting target-free authoring. | `toGrading` omits the target id for `relative-elevation` fresh creates; `sanitizeCadGradings` explicitly re-attaches a *stored* dormant id on the load path (never gated, never rebound). Legacy Distance/Elevation dormant-id create semantics are unchanged. |
| 5 | low | The requested Relative-vs-Distance performance ratio was absent. | The harness now reports a paired batched ratio (4000 solves × 3 interleaved runs) and labels the sub-resolution single-solve medians as not meaningful. |
| 6 | low | Documentation inventory inconsistencies: a delivered item still listed under "deferred", a stale 4-way label count, and a stale suite count. | `TODO.md` deferred list, `docs/CURRENT_BEHAVIOR.md` and this document corrected. |

Additionally, the chord solve now writes the shared helper's exact signed-Δ
limit (`Zlimit = Zsrc + Δ`) for `relative-elevation` instead of the
algebraically equivalent `Zsrc + g·(Δ/g)`, which is more faithful to the
published contract and removes a 1-ulp round-trip. Distance and absolute
Elevation keep the legacy construction byte-for-byte, so all 40 legacy revision
pins and every Phase 20F expected value remain unchanged.

Post-fix validation: typecheck 0 errors, lint 0 errors, **36 grading files /
480 tests pass**, **5 Phase 20G files / 92 tests pass**, WASM 74/74, parity
25/25, build clean, portable-paths 5380/0, and the Chromium suite re-run green
against a freshly built bundle (14/14, zero page/console/unhandled errors) with
a pixel-diff proof that regenerated screenshots changed only in the seeded
filename band.
