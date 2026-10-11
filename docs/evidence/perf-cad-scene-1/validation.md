# PERF-CAD-SCENE.1 — Base display-scene reuse for layer renames: validation

- Baseline: `32930bd50615916fe2f8166a63fa64879ed633c3`.
- Branch: `perf/cad-scene-metadata-reuse-1`.
- Suite: `tests/cad_display_scene_reuse_perf_cad_scene_1.test.tsx` (24 tests).

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

## Benchmark (same hardware, logged; 3 runs)

`BEFORE build` = the skipped `buildCadDisplayScene` per rename;
`BEFORE filter` = the filter that BOTH paths still run; `AFTER hookRename` =
end-to-end controlled commit; `guard` = `canReuseCadDisplaySceneBase`.

| Entities | BEFORE build | BEFORE filter | AFTER hookRename | variability | guard/check | net saving/rename |
| --- | --- | --- | --- | --- | --- | --- |
| 1k | 1.06 / 1.08 / 1.10 ms | 0.26–0.28 ms | 2.12 / 2.14 / 2.20 ms | 0.20–0.31 ms | ~0.0033 ms | ~1.05–1.09 ms |
| 10k | 7.49 / 9.18 / 9.54 ms | 1.94–2.15 ms | 20.0 / 20.6 / 22.1 ms | 2.32–6.20 ms | ~0.0026 ms | ~7.49–9.54 ms |

- For both sizes `renameBuilds = 0` and `median(build) > median(guard)`.
- Invalidation is unregressed: a same-size entity edit still rebuilds
  (`geometryRebuild` 7.5–9.6 ms at 1k, 68.7–70.7 ms at 10k, `builds = 1`).
- `AFTER hookRename` is dominated by React render/commit overhead
  (~1–15 ms); the *skipped* work is the `BEFORE build` column, which is
  removed from the pipeline in the reuse path.

## Commands

- New suite: **24/24**.
- **Structural graph pins unchanged** (repo convention "graphs unchanged"):
  the 18 previously-red CAD+F2F / full-`src` import-graph pin suites
  (`STRUCT-241.x` ×15, `STRUCT-195.11/195.12/195.14`) pass **1253/1253** with
  the pinned CAD+F2F `513/2486` and full-src `1685/7597` totals and digests.
  The guard adds no new `src` module/edge.
- Neighbour suites (PERF-186 root, PERF-186 filter, PERF-190, PERF-188/188.2,
  renderer labels/standards, derived-scene/viewport lifecycle, sheet parity,
  persistence/entities, spike model): **12 files / 132 tests**.
- `npm run typecheck` clean; `npx eslint` on the three changed files clean;
  `npm run check:portable-paths` **6442 tracked paths / 0 violations**.
- The only remaining agent-tier failures are the 3 known pre-existing
  study-desktop real-data suites (calibration, calibration_v5, preflight).
