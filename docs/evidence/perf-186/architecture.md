# PERF-186.1 — single viewport visibility filter architecture

Branch `perf/issue186-single-viewport-filter`, baseline
`a64c35681d1e2f793c08fbdb460f57feccbd8e0b` (= PR #214 merge / `origin/main`).
Scope: the CAD viewport display-visibility pipeline only (#186). No geometry,
schema, hash, worker, export, or protocol change. #194 is separate.

## Root cause

`filterCadDisplaySceneForViewport` (in `src/engine/cad/cadViewportAppearance.ts`)
rebuilt an entity `Map` and linear-scanned `project.layers` for every display
primitive on every call:

```
const entities = new Map(project.entities.map((entity) => [entity.id, entity]));   // O(E)
scene.primitives.filter((primitive) => {
  const entity = entities.get(primitive.sourceEntityId);
  ...
  resolveCadEntityAppearance({ entity, layer: project.layers.find(...) });          // O(L)
  if (primitive.layerId !== entity.layerId) isLayerHidden(project, primitive.layerId); // O(L)
});
```

The production display path called it **four times per mount/transaction**:

1. `useSurveyCadWorkspace` hook — `displayScene = filter(buildCadDisplayScene(...))`
   (needed: command/grip/snap previews read `displayScene.primitives`).
2. `SurveyCadWorkspace` — `displaySceneWithProfiles` attached derived
   profile-view layers and re-filtered the whole scene.
3. `displaySceneWithSections` attached sample/section/analysis layers and
   re-filtered the whole scene (plus a metadata-only `withBlockHoverTitles`
   pass).
4. `displaySceneWithGrading` attached grading/group-grading layers and
   re-filtered the whole scene.

Stages 2–4 re-scanned primitives (and the already-filtered derived layers)
that stage 1 had just processed; only the newly attached derived arrays
actually needed the OFF/FROZEN contract. Total work was O(4·P·L + 4·E).

## Fix

### 1. Indexed visibility — `src/engine/cad/cadViewportVisibilityIndex.ts`

One small cohesive module builds an index per **immutable project version**:

- `layerHiddenById` — first-wins hidden state per layer id (matches
  `project.layers.find(...)`), so `isLayerHidden` is O(1).
- `visibilityById` — one `resolveCadEntityAppearance` per unique entity id
  (first-wins), passing a first-wins `styleById` so the resolver never
  `.find`s the style list either. Stores `{ visible, layerId }`.
- `legendById` / `analysisById` — first-wins, for the analysis-legend
  parent-map `'general'` fallback.
- `hiddenEntityIds` — the selection-retirement set, materialized once.

**Immutability contract:** `CadProject` values are replaced per transaction
(`cadTransactions` never mutates in place). The index is memoized in a
`WeakMap<CadProject, CadViewportVisibilityIndex>` keyed on project identity:

- a replaced project (even with identical ids) rebuilds;
- no id-only / signature state exists, so a new drawing can never read a
  stale index;
- the weak key means no project is strongly retained.

In-place mutation of a live project/layer/entity is out of contract and is
pinned as such by `tests/cad_viewport_filter_186.test.ts`.

### 2. Full filter (kept, now indexed) — `filterCadDisplaySceneForViewport`

Public behavior is unchanged for all consumers (viewport canvas, sheet
viewports, tests): one primitive scan, all nine derived-layer families
filtered, unknown/missing layers visible, preview primitives without a
backing entity kept, synthesized labels hidden under either the `labels`
layer or the backing entity's layer, analysis-legends falling back to the
`'general'` map layer. The only change is that each entity/layer lookup is an
O(1) index query instead of a rebuilt map + linear scan.

### 3. Derived-layer-only filter — `filterCadDerivedLayersForViewport`

```ts
filterCadDerivedLayersForViewport(project, base, patch)
```

Filters **only** the derived-layer arrays present in `patch`; every other
field (including the already-filtered `base.primitives`) is reused by
reference. `primitives` may be supplied only as a metadata-only rewrite
(`withBlockHoverTitles`), which maps primitives in place and adds/removes
none — pinned by test. There is no hidden full scan: the primitive list is
never re-evaluated.

### 4. Pipeline once — `SurveyCadWorkspace.tsx`

```
hook:        displayScene              = filterCadDisplaySceneForViewport(project, buildCadDisplayScene(...))   // 1 full scan
stage 1:     displaySceneWithProfiles  = filterCadDerivedLayersForViewport(project, displaySceneWithParcelLabelToggle, { profileViewLayers })
stage 2:     displaySceneWithSections  = filterCadDerivedLayersForViewport(project, displaySceneWithProfiles, {
               primitives: withBlockHoverTitles(project, displaySceneWithProfiles.primitives),
               sampleLineLayers, sectionViewLayers, analysisLayers, analysisLegendLayers })
stage 3:     displaySceneWithGrading   = filterCadDerivedLayersForViewport(project, displaySceneWithSections, {
               gradingLayers, groupGradingLayers })
```

`surfaceEditOverlayPrimitives` are still appended **after** the final filter,
so staged surface-edit previews stay visible.

Result: **one full primitive scan per transaction/scene creation** and **one
indexed lookup per immutable project version** (memoized WeakMap). Only newly
attached derived layers are filtered afterwards.

### 5. #189 — selection retirement single scan

`useSurveyCadWorkspace` computes `viewportHiddenEntityIds(cadProject)` once per
render (now an O(1) index read). The `applyHistoryUpdate` callback reuses that
captured `ReadonlySet` **only when `current.present.project === cadProject`**,
and otherwise recomputes from `current.present.project` — so a
transaction/undo that swaps the project can never retire the wrong grips.
Baseline recomputed it twice per retirement; after the fix the history updater
does not recompute.

## Invariants preserved

- OFF/FROZEN semantics, unknown/missing default-visible, preview keep-rule,
  label layer + backing rule, analysis-legend `'general'` fallback.
- Primitive ordering, ids, `sourceEntityId`, `sourceSegmentId`, appearance
  (`opacity`, dash, stroke), and all derived-layer arrays/order.
- #183 (pointer/culling, static memo), #184 (seven-field snapshot memo,
  500+selected cap), #185 (WeakMap revision memo, bounded contour
  auto-derive, latest-wins) — untouched and green.
- `filterCadDisplaySceneForViewport` remains the exported consumer filter
  (sheet viewports unchanged).

## Out of scope

No change to `buildCadDisplayScene`, export scenes, snapping, selection
semantics, history/undo, persistence, DXF/LandXML, worker protocol, or
surface/contour revision hashes. Production OSNAP is untouched; the browser
spec only *uses* real endpoint OSNAP as an input path so the filtered scene is
proven stable when a command picks an existing segment endpoint (badge read +
pinned snapped vertex, `docs/evidence/perf-186/validation.md`).
