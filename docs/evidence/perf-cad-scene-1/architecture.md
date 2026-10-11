# PERF-CAD-SCENE.1 — Base display-scene reuse for layer renames: architecture

- Baseline: `32930bd50615916fe2f8166a63fa64879ed633c3` (PR #263 merge).
- Branch: `perf/cad-scene-metadata-reuse-1` (pinned merge, no rebase/force
  push). 14 pre-existing stashes, ignored Study Desktop fixtures, and
  `.pi/lsp.json` untouched.
- Refs #188 ONLY. #186/#189/#190 behavior untouched; #188 stays open. Pi does
  not merge or change issue state.

## Problem

`useSurveyCadWorkspace` fed `displayScene` through a single `useMemo`:

```ts
useMemo(
  () => filterCadDisplaySceneForViewport(
    cadProject,
    buildCadDisplayScene(cadProject, { lineweightDisplay, ...sessionInputs }),
  ),
  [cadProject, lineweightDisplay, surfaceCache, surfaceRevisionIndex,
   surfaceContourInputs, surfaceVolumeInputs],
);
```

`buildCadDisplayScene` is the expensive pass: it builds the project lookup
tables and flat-maps every visible entity into primitives. It reads
`project.bounds`, `project.entities`, the layer tables (`color`, `lineTypeId`,
`lineweightMm`, `transparency`), the style/point/label tables, blocks,
annotation/dimension/leader/bearing/curve styles, `metadata.units`,
`annotationSettings`, `linetypeScale`, and (optionally) surfaces/volumes. It
**never reads a layer NAME** — lookups are by id and the viewport visibility
index reads layer `id/visible/frozen` only.

`LAYER_RENAME` (`cadTransactionsLayerCommands.ts`) patches `{ name }` through
`withLayer`, producing a shallow project spread with a new `layers` array and
every other top-level slice reference-identical. The pre-change memo therefore
rebuilt the entire base scene for a rename that cannot change it.

## Proven baseline (Phase 1)

A hook-integration probe (real hook, real `LAYER_RENAME`) measured:

- `buildCadDisplayScene` calls per rename: **1** (redundant).
- Top-level project slices whose reference differed: **`layers` only**.
- `filterCadDisplaySceneForViewport` output for the renamed project vs the
  uncached `filter(build(...))` baseline: **byte-identical** (deep JSON
  equality, 500 primitives; mixed-entity parity in the committed suite).

## Design — a pure guard + a hook-local cache

`src/engine/cad/cadViewportAppearance.ts` (the existing viewport-display
module) exports the pure guard `canReuseCadDisplaySceneBase(entry, project,
inputs)`. It accepts reuse iff:

- `entry` exists;
- build inputs are compatible: `lineweightDisplay` identical,
  `surfaceCache`/`surfaceRevisionIndex` identity-identical, and the
  contour/volume session inputs are interchangeable (see below);
- **every** top-level project slice except `layers` is reference-identical
  (same key set too — a gained/lost key forces a rebuild);
- `layers` has the same length and id order, and every layer field except
  `name` is identical.

The non-layer check is deliberately **fail-closed by omission**: a new field
added to `CadProject` later defaults to forcing a rebuild until a dedicated
proof widens the guard. No JSON signatures, no entity/style traversals, no
timing assumptions.

`useSurveyCadWorkspace.ts` owns the per-workspace cache inline. It is a
`useRef` scoped by `drawingId` — never a module/global cache, never retaining
another drawing's scene:

```ts
const scoped =
  displaySceneCacheRef.current?.drawingId === drawing.drawingId
    ? displaySceneCacheRef.current.entry
    : null;
const baseScene = canReuseCadDisplaySceneBase(scoped, cadProject, buildInputs)
  ? scoped.scene
  : buildCadDisplayScene(cadProject, { ...sessionOptions });
displaySceneCacheRef.current = { drawingId: drawing.drawingId, entry: { project: cadProject, scene: baseScene, inputs: buildInputs } };
return filterCadDisplaySceneForViewport(cadProject, baseScene); // ALWAYS current project
```

The viewport filter is re-run on the **current** `cadProject` every
evaluation, so OFF/frozen-layer and entity-visibility edits hide immediately
even when the base scene is reused.

### Why no new module

The guard and hook live in existing files on purpose: this repo pins the
CAD+F2F and full-`src` import graphs as golden fingerprints (`STRUCT-241.x`,
`STRUCT-195.x`), and prior perf work (PERF-186/187/188/188.2) recorded
"graphs unchanged". Adding a new `src` file would add a graph node and force
updating every structural pin. The guard adds no new import edge
(`cadViewportAppearance` already imports `cadTypes`), and the inlined hook
reuses `useSurveyCadWorkspace`'s existing `cadRenderer`/`cadViewportAppearance`
edges, so the pinned graphs (CAD+F2F 513/2486; full-src 1685/7597; digests)
are byte-identical. `cadViewportAppearance.ts` remains well within the file
size target and `useSurveyCadWorkspace.ts` stays under 900 lines.

### Contour/volume session inputs (version-stable)

The shell always passes `surfaceContourInputs`, and its memo closes over
`cadProject`, so its **object identity changes on every project commit** even
though contour geometry does not. A strict reference check would therefore
never reuse in production.

`buildContourLookup` derives from `project.surfaces`, `project.surfaceStyles`,
the session `surfaceCache`/`contourCache`, and the surface source revision
(geometry/point sources) — **never layer names**. The guard therefore accepts
two contour/volume inputs that differ in identity but share the same numeric
`version` tag (`sameVersionedSessionInput`). This is sound only in combination
with the project check above: reuse additionally requires every non-layer
project slice to be reference-identical, so the only accepted project
difference is layer names, which the getters do not read. A `version` bump or
a presence change (`undefined` ↔ object, which changes the scene shape) forces
a rebuild.

## Invalidation posture

Must rebuild (covered by negative controls in the suite):

- entity geometry / visibility / transforms; `bounds`; `metadata`;
  `linetypeScale`; `annotationSettings`;
- layer `color`/`lineTypeId`/`lineweightMm`/`transparency`/`visible`/`frozen`
  and every conservatively out-of-scope field (`locked`, `printable`,
  `description`, `role`, `defaultStyleId`, `LAYER_SET_CURRENT`);
- style library, point/label styles, point groups, block definitions,
  dimension/leader/bearing/curve styles;
- surfaces/surface styles/volume tables; `surfaceCache`/`surfaceRevisionIndex`
  identity changes; contour/volume `version` bumps; drawing switch; undo/redo
  of a scene-relevant op.

Undo/redo of a **rename** reuses (only layer names differ) — the correct,
content-preserving outcome.

## Boundaries intentionally preserved

- Parser/solver engine math, serialization, command semantics, undo history,
  UI menus, and agent config are untouched.
- `buildCadDisplayScene` itself is unchanged; export scenes
  (`cadExportScene.ts`), sheets, derived-view hooks, F2F, and transient
  previews build their own scenes and are unaffected.
- PERF-188.2 certified sync and its history undo/redo, PERF-186.1 index
  semantics, #189 retirement, and preview-append order are unchanged.
- StrictMode and stale-closure safety: the cache is a `useRef`; a new project
  identity retires the old entry.
