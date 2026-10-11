# PERF-CAD-SCENE.1 — Base display-scene reuse for layer renames: validation

- Baseline: `32930bd50615916fe2f8166a63fa64879ed633c3`.
- Branch: `perf/cad-scene-metadata-reuse-1`.
- Suite: `tests/cad_display_scene_reuse_perf_cad_scene_1.test.tsx` (31 tests, after P1).

## Phase 1 — proof (recorded before the fast path shipped)

Hook-integration probe on the real `useSurveyCadWorkspace` (real
`LAYER_RENAME`, `vi.mock` counters on the real renderer/filter imports):

| Check | Result |
| --- | --- |
| `buildCadDisplayScene` calls per rename (pre-change) | 1 (redundant) |
| Top-level project refs that changed | `layers` only |
| Rebuilt scene vs uncached baseline | byte-identical (deep JSON) |
| Filter runs per rename | 1 (unchanged) |

The committed suite re-proves this: `rebuilds once on mount, then zero base
rebuilds for repeated renames` asserts `mount builds = 1`, then exactly `1`
viewport filter and `0` base builds per rename, plus byte-identical output.

## Correctness / parity

- `expectSceneParity` compares the fast-path `displayScene` against an uncached
  `filterCadDisplaySceneForViewport(project, buildCadDisplayScene(project,
  { lineweightDisplay }))` baseline by full JSON equality, primitives-order
  equality, and bounds equality.
- Covered after each rename on a mixed project (line, arc, circle, polyline
  with an arc bulge, parcel with an arc course, survey point, text, block
  reference with line/arc/text children) and after the geometry-invalidation
  path.
- Fast-path vs uncached parity is asserted in both the reuse path and the
  rebuild path.

## Negative controls (each must rebuild)

| Edit | Assertion |
| --- | --- |
| entity geometry move | `build >= 1` + parity |
| entity visibility toggle | `build >= 1` + parity |
| `LAYER_VISIBILITY` OFF / `LAYER_FROZEN` | `build >= 1` + parity |
| `LAYER_COLOR` / `LAYER_LINETYPE` / `LAYER_LINEWEIGHT` / `LAYER_TRANSPARENCY` | `build >= 1` |
| `LAYER_LOCKED` / `LAYER_PRINTABLE` / `LAYER_DESCRIPTION` / `LAYER_SET_CURRENT` (conservative rename-only scope) | `build >= 1` |
| undo/redo of a scene-relevant layer op | `build >= 1` |
| new reference for entities / bounds / metadata / styleLibrary / pointStyles / labelStyles / pointGroups / blockDefinitions / dimension / leader / bearing / curve styles / annotationSettings / linetypeScale / surfaces / surfaceStyles / volumeSurfaces / volumeSurfaceStyles / analysisMaps / analysisLegends / surveyTableStyles / cogoComputations | `build >= 1` |
| drawing switch (same project ref) | `build >= 1` |
| contour/volume `version` bump, presence change, cache/revision identity change (`lineweightDisplay`) | guard returns `false` |
| layer length / order / id / non-name field change; gained/lost top-level key | guard returns `false` |

Falsifiability: the guard unit suite includes a deliberately loosened guard
that ignores entity references and proves it **would** accept an entity edit
while the real guard rejects it — so the negative controls are not vacuous.

## Production shell

`production SurveyCadWorkspace shell > reuses the base scene on LAYER_RENAME
with contour inputs present` mounts the real `SurveyCadWorkspace` with a
controlled drawing round-trip and the always-present `surfaceContourInputs`:
two renames produce **0** base builds, and a `LAYER_VISIBILITY` edit still
rebuilds. (Without the version-stable input contract the shell would rebuild
on every rename because the contour closure is recreated per project commit.)

## P1 correction (controller review of 9de39f50)

Controller found the shipped `sameVersionedSessionInput` accepted any two
objects with an equal numeric `version`, without pinning the cache identities
the renderer actually reads (`tinCache`/`volumeCache`/`contourCache`). Fixed
in `f398146b` with field-aware comparators: contour slot = presence +
`version ===` + `contourCache ===` (top-level `surfaceCache` already pinned);
volume slot = presence + `version ===` + `tinCache ===` + `volumeCache ===`.
`contourCache` provenance is threaded through `SurveyCadContourInputs`
(`useSurveyCadContourLifecycle.ts`). `buildingVolumeIds`/`sessionDiagnostics`
never reach `buildCadDisplayScene` and are deliberately not gated. New fields
fail closed via own-key-set checks. The cache entry is now published in a
`useLayoutEffect` keyed on the memo result (no ref write during render).
Side effect: StrictMode mount builds twice (exactly 2, bounded) because
neither render pass sees a committed entry; every rename still reuses
(0 builds). Suite grew 24 -> 31 with same-version cache-swap divergence
tests (old guard fails them) plus real-hook live surface/volume integration.

## Benchmark (paired end-to-end, same machine/toolchain, corrected HEAD)

Reusable harness (kept outside the repo): real-hook `LAYER_RENAME` +
`replaceCadProject` invalidation timed around `act()`, `vi.mock` build/filter
counters, fixtures outside timed windows, no contour/surface inputs,
`ROUNDS=8 x REPS=3` interleaved, Node v26.10.0. BEFORE = temp worktree at
`32930bd5`; AFTER = temp worktree at corrected `f398146b`. Medians, n=24/side:

| op | 1k BEFORE | 1k AFTER | net | 10k BEFORE | 10k AFTER | net | builds/op |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rename | 3.114 | 2.733 | **-0.381** | 20.977 | 16.916 | **-4.062** | b1->b0, f1->f1 |
| invalidate | 2.846 | 3.296 | +0.449 | 18.361 | 21.530 | +3.170 | b1->b1, f1->f1 |
| micro-build (NOT net) | 0.246 | 0.430 | +0.184 | 3.443 | 4.280 | +0.837 | b1 |
| micro-filter | 0.031 | 0.032 | +0.001 | 0.358 | 0.361 | +0.003 | f1 |

Rename win is rep-consistent with call-count proof (1->0 base builds, filter
still 1). Guard overhead is micro (filter delta +0.001..0.003 ms; standalone
guard ~0.003 ms), exceeded 1000x by the 10k rename saving.

Honest caveat: the 10k invalidate +3.17 ms has IDENTICAL call counts and
persists invalidate-only (before 18.424 vs after 23.853, fresh processes) and
reversed-order (after-first 22.729 vs before-second 20.229), so it is not run-
order bias. It cannot be guard cost (guard is microseconds; micro-filter
delta +0.003). Supporting artifact evidence: micro-build on the IDENTICAL
untouched function drifts +0.84 ms, and after-side variance is wider
(sd 1.73 vs 0.71) — a GC/process signature, plausibly from the one retained
scene+project in the tight loop. No mechanism proven; production does one op
per gesture with idle GC, unlike the loop. Correctness unregressed (exactly 1
rebuild per invalidation both sides). Prior 9de39f50 campaign was near-
identical (rename -0.73/-4.37; invalidate +0.42/+3.34). Flagged explicitly for
reviewer/controller adjudication; full logs stay outside the repo.

## Commands

- New suite: **31/31** (StrictMode mount now exactly 2 bounded builds, renames 0).
- **Structural graph pins unchanged** (repo convention "graphs unchanged"):
  the 18 previously-red CAD+F2F / full-`src` import-graph pin suites
  (`STRUCT-241.x` ×15, `STRUCT-195.11/195.12/195.14`) pass **1253/1253** with
  the pinned CAD+F2F `513/2486` and full-src `1685/7597` totals and digests.
  The guard adds no new `src` module/edge.
- Neighbour suites (PERF-186 root, PERF-186 filter, PERF-190, PERF-188/188.2,
  renderer labels/standards, derived-scene/viewport lifecycle, sheet parity,
  persistence/entities, spike model): **12 files / 132 tests**.
- `npm run typecheck` clean; `npx eslint` on the three changed files clean;
  `npm run check:portable-paths` **6445 tracked paths / 0 violations**.
- The only remaining agent-tier failures are the 3 known pre-existing
  study-desktop real-data suites (calibration, calibration_v5, preflight).
