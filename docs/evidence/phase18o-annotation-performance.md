# Phase 18O Annotation Performance Evidence

Measurement only — no `src/` behavior changes. Probe:
`src/engine/cad/annotation/__tests__/cadAnnotationPerf.test.ts`
(`npx vitest run src/engine/cad/annotation/__tests__/cadAnnotationPerf.test.ts`,
verbose reporter; ~8 s wall for the whole file). No assertions on absolute
time — the file reports tables and asserts only structural invariants
(non-zero primitive count, exact entity count).

Representative mix on simple source geometry (one 20 m line per 4
annotations, 25 m grid): **40 % mtext, 20 % leaders, 25 % dimensions,
15 % bearing/distance labels**. Median of 3 runs for 100/1,000 entities and
1 run for 10,000, after one warm-up pass on a 1,000-entity drawing so the
first row is not inflated by cold JIT. Absolute values vary per machine and
run (sub-ms cells particularly); the conclusion is the scaling **shape**.

Run: 2026-09-19, Node + Vitest 4, single process.

## 1. Mixed annotation scaling (representative run)

| entities | primitives | derivedMs | boundsScanMs | snapQueryMs | hitTestMs | exportItems | exportSceneMs | svgMs | svgKB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 125 (100 ann) | 510 | 0.42 | 0.12 | 0.19 | 0.15 | 514 | 1.34 | 0.34 | 86 |
| 1,250 (1,000 ann) | 5,100 | 4.09 | 1.14 | 3.66 | 0.38 | 5,104 | 42.7 | 3.41 | 859 |
| 12,500 (10,000 ann) | 51,000 | 56.5 | 20.5 | 64.4 | 3.00 | 51,004 | 2,414.6 | 62.3 | 8,684 |

Columns:

- **derivedMs** — `buildCadDisplayScene(project)` (the `toPrimitives`
  derivation seam for every entity).
- **boundsScanMs** — one `entityIntersectsBounds(project, entity, bounds)`
  call per entity (the `cadSpatialBounds` predicate path).
- **snapQueryMs** — one production `buildCadSpatialIndex(project)
  .queryNearestSnap(..., visibleBounds)` call (bound-culled snap query).
- **hitTestMs** — `primitiveBounds` over every derived primitive
  (viewport hit-test preparation).
- **exportItems / exportSceneMs** — `buildExportSheetSceneWithResult`
  (SVG/PDF export-scene build) and its emitted item count.
- **svgMs / svgKB** — `serializeExportSceneToSvg` wall time and output size.

## 2. Per-entity / per-primitive cost (µs)

| entities | derived µs/entity | bounds µs/entity | hit-test µs/primitive | svg µs/entity |
| --- | --- | --- | --- | --- |
| 125 | 3.32 | 0.95 | 0.29 | 2.68 |
| 1,250 | 3.27 | 0.91 | 0.08 | 2.73 |
| 12,500 | 4.52 | 1.64 | 0.06 | 4.98 |

`hit-test` per-primitive cost is flat→falling (0.29 → 0.06 µs) with
primitive count growing exactly linearly: **hit-test preparation is linear**.
The remaining seams show a rising per-unit cost at 10,000.

## 3. Scaling ratio per decade (×10 entities each step)

| decade | derived | bounds | snap-query | hit-test | export-scene | svg |
| --- | --- | --- | --- | --- | --- | --- |
| 125 → 1,250 | 9.9× | 9.6× | 19.8× | 2.6× | 31.8× | 10.2× |
| 1,250 → 12,500 | 13.8× | 18.0× | 17.6× | 7.9× | 56.5× | 18.2× |

Linear would be 10× per decade. Repeated runs kept the same shape
(sub-ms first-decade cells varied ±~2×); the export-scene column was
32–57× in every run.

## 4. Associative update (1,000 lines + 1,000 bearing/distance labels)

Edit exactly one source line (`lines[0].toX += 5`), then re-derive.

| measurement | ms |
| --- | --- |
| affected label re-derivation (1 of 1,000) | 0.001 |
| all 1,000 labels derived standalone | 0.69 |
| full scene rebuild after the one edit (lines + labels) | 6.51 |
| scene rebuild, lines only (no labels) | 0.53 |
| label share of full rebuild | 5.98 |
| full rebuild ÷ affected | ~5,045× |
| label share ÷ all-labels | 8.7× |

## Findings

- **Hit-test preparation is linear.** `primitiveBounds` over derived
  primitives is O(primitives) with flat per-primitive cost; no full-drawing
  recompute per primitive.
- **Derived geometry is near-linear with a superlinear tail.** 9.9× then
  13.8× per decade. The 10,000 tail comes from the O(n) source lookup inside
  the label builders: `buildBearingLabelPrimitives` /
  `buildCurveLabelPrimitives` (`cadRenderer.ts`) and `entityIntersectsBounds`
  (`cadSpatialBounds.ts`) each call
  `project.entities.find(candidate => candidate.id === entity.sourceEntityId)`
  — once per label, so O(labels × entities).
- **The export scene is clearly superlinear: 32× then 57× per decade.**
  Item count is exactly linear (514 → 5,104 → 51,004), so per-item cost is
  growing ~10× per decade — i.e. **an accidental full-drawing recompute per
  annotation item**. Cause: `buildExportSheetSceneWithResult`
  (`cadExportScene.ts`) runs several `project.entities.find` / `.find`-on-layers
  lookups per emitted item (`correctPlotAppearance`, `layerFlagged`,
  `layerColorOf`) and `intentionallyUnplotted` does another per entity.
  At 51,004 items × 12,500 entities that is ~10⁹ comparisons and ~2.4 s.
- **Snap query is superlinear at 10,000.** `buildCadSpatialIndex` is a
  per-query closure (no built index) that bound-culls via
  `entityIntersectsBounds` and then builds candidates — the same per-label
  `.find` plus per-entity work shows up (19.8× / 17.6×).
- **SVG serialization is near-linear with allocation/GC pressure.** Per-entity
  cost rises only 2.68 → 4.98 µs while output grows to 8.7 MB; the 18.2×
  second-decade ratio is string/GC pressure, not per-item recompute.
- **Associative update re-derives the whole label set.** One edited source
  line costs ~0.001 ms to re-derive the affected label, but the production
  scene rebuild is ~6.5 ms — ~5,045× more. Its label share (5.98 ms) is
  8.7× the pure standalone derivation of all 1,000 labels (0.69 ms) because
  each label in the scene also pays the O(n) source lookup and primitive
  construction — but the decisive point is that it pays them for **all
  1,000 labels**, including the 999 unrelated ones. There is no per-entity
  memoization or dirty tracking in `buildCadDisplayScene`; after any edit it
  reconstructs every annotation. A targeted update would need an
  entity-keyed derivation cache (or a source-entity → dependent-labels
  index) that the current architecture does not have.

## Explicit non-gate

This probe is evidence, not a CI gate. It makes no absolute-time assertion
and must not be used to fail a build on a slow or loaded machine. If a
future change adds an assertion on time, it belongs in a benchmark script
(not this file) with an explicit, documented budget.

Tier note: the file lives in `src/engine/cad/annotation/__tests__/` and runs
in ~8 s, so it stays in the agent tier; `perf` is not a
`tests/testTierManifest` suspicious name, and no tier list was changed. If
it grows past the ~10 s rule or gains large repeated campaigns, reclassify
it per `scripts/testTiers.ts` / `tests/AGENTS.md`.
