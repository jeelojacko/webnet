# Phase 20A — 3D Feature Line Validation Evidence

**Branch:** `feat/cad-3d-feature-lines` · **Baseline:** `36416920` (PR #121 merge) ·
**Probe:** `scripts/phase20aFeatureLinePerf.ts` (`npx tsx scripts/phase20aFeatureLinePerf.ts [--quick]`) ·
**Browser QA:** `tests-browser/cad-feature-lines-20a.spec.ts` (17 tests: 4 browser flows + 13 store-level pins) ·
**Status:** verification of the uncommitted Phase 20A slices; one production perf fix
(`src/engine/cad/cadSurfaceRevision.ts`, see §3) landed during verification.

Machine: AMD Ryzen 7 5800X3D (8c/16t), 31 GiB RAM, Node v26.8.1. Gate times are
wall-clock on this box; tier membership is the contract, not absolute runtime.

## 1. Gate table

All commands run on the post-fix tree (uncommitted Phase 20A slices applied).

| # | Command | Result | Notes |
|---|---|---|---|
| 1 | `npm run lint` | **PASS** | 0 errors, 2 pre-existing warnings (`tests/evidence/phase10m_correction_stage_audit.test.ts:253`, `tests/gnssBaseline/gnssBaselinePerformance.test.ts:55` — untracked/untouched by this branch) |
| 2 | `npm run typecheck` | **PASS** | `tsc --noEmit`, clean |
| 3 | `npm run test:agent` | **PASS** | 6192 passed · 1 skipped · **3 pre-existing study-desktop fails carried** (§4) |
| 4 | `npm run test:wasm` | **PASS** | 74/74 (12 files) |
| 5 | `npm run parity:industry-reference` | **PASS** | **25/25** (required) |
| 6 | `npm run build` | **PASS** | built in ~11 s |
| 7 | `npm run check:portable-paths` | **PASS** | 4641 tracked paths, 0 violations |
| 8 | Focused: feature-line 20A + Surface 18F-Z + Parcel 19A-D + transform 18Q/18R + export/DXF/LandXML/WNCAD | **PASS** | 46 files / 566 tests (surface + feature-line batch), 24 files / 270 (parcel + 19A/19B), 27 files / 203 (transform + export + WNCAD) |
| 9 | `npx playwright test tests-browser/cad-feature-lines-20a.spec.ts` | **PASS** | 17/17 headless Chromium (4 browser flows 7.7 s + 13 store-level 1.1 s) |

Focused command details (Vitest, agent tier):

| Batch | Files | Tests | Result |
|---|---:|---:|---|
| `cad_feature_line_*_20a` | 6 | 59 | PASS |
| `cad_surface_*` + `compose*18z` + `volume_surface_wncad` | 41 | 512 | PASS |
| `cad_parcel_*` + `cad_survey_*19a` + `cad_sheet_*19b` | 24 | 270 | PASS |
| `cad_transform_*` + `cad_project_transform_*` + `cad_export_*` + `landxml_export*` + `*_wncad` + `cad_drawing_file` | 27 | 203 | PASS |

## 2. Performance evidence (§8 of the mission)

Probe: deterministic mixed line+arc chain (every 10th course a 90° minor arc,
`b = tan(π/8)`; Z rises 0.05 m per vertex), 5 timed reps after warmup, medians.
`station` / `elev` time `min(N, 20000)` station lookups; `bounds` =
`buildCadSpatialIndex`; `gradeEdit` = `setFeatureLineGradeSpan` over the full span;
`surfaceBreakline` = `collectSources` for a surface whose breakline is the feature
line at the default 0.001 m chord tolerance (arcs linearize; every generated vertex
rides the exact arc with station-interpolated Z).

| vertices | plan length m | resolve ms | station total ms | µs/lookup | elev total ms | µs/lookup | bounds ms | grade-edit ms | surface-breakline ms | breakline pts |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 119 | 0.20 | 0.07 | 0.68 | 0.03 | 0.32 | 0.45 | 0.11 | 0.59 | 590 |
| 1 000 | 11 293 | 0.82 | 0.06 | 0.06 | 0.05 | 0.05 | 1.81 | 0.38 | 5.52 | 5 900 |
| 10 000 | 113 030 | 4.04 | 1.10 | 0.11 | 0.55 | 0.06 | 13.7 | 3.16 | 49.1 | 59 000 |
| 100 000 | 1 130 402 | 50.2 | 1.71 | 0.09 | 1.31 | 0.07 | 200 | 50.5 | 762 | 590 000 |

Scaling exponents vs the previous scale (1.00 = linear, 2.00 = quadratic):

| transition | resolve | station | elev | bounds | grade-edit | surface-breakline | breakline pts |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 → 1 000 | 0.61 | −0.05 | 0.19 | 0.60 | 0.54 | 0.97 | 1.00 |
| 1 000 → 10 000 | 0.69 | 1.26 | 1.05 | 0.88 | 0.92 | 0.95 | 1.00 |
| 10 000 → 100 000 | 1.09 | 0.19 | 0.38 | 1.16 | 1.20 | 1.19 | 1.00 |

Verdict: **~linear at every scale, no O(n²)**. Per-lookup cost stays flat
(0.05–0.11 µs/lookup station, 0.05–0.32 µs/lookup elevation), confirming the
prefix-station binary search. `bounds`, `grade-edit` and `surface-breakline`
all track vertex count (exponent ≤ 1.20, noise band). 100 000 vertices
completes every stage in ≤ 762 ms.

## 3. Production perf fix found during verification

The first probe run showed `surface-breakline` going super-linear:
10 000 → 100 000 vertices gave exponent **2.24** (49 ms → **82 028 ms**).

**Root cause (new 20A code):** `appendOwnedBreaklinePoint`
(`src/engine/cad/cadSurfaceRevision.ts`) resolved a shared-XY vertex by scanning
`ctx.resolved.findIndex(...)` whenever the XY already existed. Every course
boundary after the first hits that branch (arc `from` == previous course `to`),
so the direct-Z leg was **O(courses × breakline vertices)**. The same linear scan
existed in the legacy survey-point fallback branch.

**Fix (behaviour-preserving):** the shared-XY map now stores the `resolved`
index (`xyToIndex`) instead of the Z value, so shared-vertex reuse is O(1) and
the Z comparison reads `resolved[priorIndex].z`. No output changes — identical
first-match index by construction (XY keys are unique in the initial deduped set
and only inserted when new).

Post-fix the 10 000 → 100 000 exponent is **1.19** and the 100 000 case drops
**82 028 ms → 762 ms (~108×)**. All Surface 18F–Z, 18W breakline, and the new
20A breakline suites stay green (`tests/cad_surface_*` 566/566 focused).

> No other production behaviour was changed during verification.

## 4. Pre-existing failures carried (not introduced)

`npm run test:agent` reports exactly **3 failed** across the run, all under
`study-desktop/tests/`:

1. `study-desktop/tests/study_ai_unit_calibration.test.ts` — frozen calibration data
2. `study-desktop/tests/study_ai_unit_calibration_v5.test.ts` — `sourcePackageId` fail-closed
3. `study-desktop/tests/study_ai_unit_preflight.test.ts` — frozen run preflight counts

Carried, not caused: the branch modifies **zero** `study-desktop/` paths
(`git status --short` lists none), the same 3 failures are recorded as the sole
agent-tier failures across every Phase 17/18/19 validation entry in `TODO.md`,
and earlier phases proved them via `git stash` against a clean baseline. The
counts match the pre-fix run exactly (6192 passed / 1 skipped / 3 failed before
and after the perf fix).

Lint carries 2 pre-existing warnings in untouched files
(`tests/evidence/phase10m_correction_stage_audit.test.ts`,
`tests/gnssBaseline/gnssBaselinePerformance.test.ts`).

## 5. Browser QA coverage (mission §104 A–O)

`tests-browser/cad-feature-lines-20a.spec.ts` — deterministic fixtures from the
real `createBlankCadDrawingDocument`; every browser test asserts **zero
page/console errors**.

| Letter | Item | Layer | Result |
|---|---|---|---|
| A | create from ordered survey points → exact XYZ snapshot (no live dependency) | store | PASS |
| B | constant elevation (ribbon create + prompted Z) | browser | PASS |
| C | "From Surface" vertex query, all-or-nothing off-surface block | store | PASS |
| D | set elevation single vertex + multi-vertex subset (Z only) | store | PASS |
| E | set grade across intermediates by plan station (0/30/70/100 → 100/100.6/101.4/102) | store | PASS |
| F | interpolate mixed line/arc by station, not vertex index | store | PASS |
| G | arc station/grade on the true circle + inquiry curve metrics | store | PASS |
| H | insert vertex on a line and on an arc (sub-arcs on-circle) | store | PASS |
| I | reverse (path kept, stations/grades/bulges flipped) | store | PASS |
| J | MOVE/ROTATE/MIRROR/SCALE/GridGround (Z rides verbatim) | store | PASS |
| K | surface breakline live → stale → rebuild | store | PASS |
| L | one feature line feeding two surfaces → per-surface staleness | store | PASS |
| M | Save Drawing round-trips ids, XYZ, bulges exactly | browser | PASS |
| N | SVG/PDF plan FULL; DXF 3D POLYLINE (straight FULL, arc warned); LandXML 3D PlanFeature (arc linearized + warned) | store | PASS |
| O | undo/redo restores untouched project and replays transactions | store | PASS |
| — | Survey Toolspace node + Properties expose exact spans/grades | browser | PASS |
| — | Home ribbon Feature Line group bounded + gated on selection | browser | PASS |

Playwright runner is available and works headless in this environment
(Chromium 1234): full spec 17/17, 8.8 s total.
