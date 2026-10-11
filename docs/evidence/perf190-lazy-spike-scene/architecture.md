# PERF-190 — Lazy CAD spike scene derivation: architecture

- Baseline: `origin/main ff9849efb660d3cadf3ccf60d5093c8186ae1099` (STRUCT-241.16 PR #259 merge).
- Branch: `fix/perf190-lazy-spike-scene` (from pinned main, no rebase).
- Issue: #190 (`buildMlightcadSpikeScene maps every entity on every project change`). #241 stays OPEN (out of scope); #195/#240 stay CLOSED.

## Problem

`useSurveyCadWorkspace` eagerly ran

```ts
const mlightcadScene = useMemo(() => buildMlightcadSpikeScene(cadProject), [cadProject]);
```

and returned it unconditionally. `buildMlightcadSpikeScene` (`src/engine/cad/cadMlightcadAdapter.ts:306`)
maps ALL layers/entities (`layers.map`, `entities.map(toMlightcadEntity)`, O(N)) into new
records. Every `cadProject` identity change paid one full build even though the
workspace shell never reads the scene.

Verified consumer absence (parent + scout):
- Only `src/hooks/surveyCad/useSurveyCadWorkspace.ts` (producer) and
  `useSurveyCadWorkspace.types.ts:37` (required `mlightcadScene: MlightcadSpikeScene`) reference
  the hook-result field. Test files call the adapter directly, never the hook field.
- `src/components/SurveyCadWorkspace.tsx:387-422,640-648` destructures `cadWorkspace`
  without `mlightcadScene`. `useSurveyCadComposeLifecycle` receives the whole object but
  reads only `runLayerCommand` (identity memo dep only — no getter invocation).
- No `...cadWorkspace` / `Object.assign` / `JSON.stringify` / `Object.entries` over the
  hook result anywhere in `src/`. Passing the object by identity does not evaluate the getter.

## Change (one narrow hook edit, same required API)

`src/hooks/surveyCad/useSurveyCadWorkspace.ts`:
- Unconditional `useMemo` now builds a per-`cadProject`-identity lazy thunk closing over the
  current `cadProject` plus a nullable `cached: MlightcadSpikeScene | undefined`:

```ts
const getMlightcadScene = useMemo(() => {
  let cached: MlightcadSpikeScene | undefined;
  return (): MlightcadSpikeScene => {
    if (cached === undefined) cached = buildMlightcadSpikeScene(cadProject);
    return cached;
  };
}, [cadProject]);
```

- Return object exposes `get mlightcadScene() { return getMlightcadScene(); }`.
  The `UseSurveyCadWorkspaceResult` type is unchanged (accessor satisfies the required
  property contract). Hook call order unchanged (`useMemo` unconditional).

Semantics:
- 0 builds for renders/identity updates that never read the scene.
- Exactly 1 build on FIRST read per project identity; same reference on repeat reads.
- New identity retires the old closure (old project + obsolete scene GC-able); no global
  cache, no `Map` retaining history, no rebuild-per-read.
- Destructuring/spread of the whole result would evaluate the getter — no such code exists;
  future readers that destructure `mlightcadScene` get the same typed value with one build.
- Adapter (`buildMlightcadSpikeScene` / `toMlightcadEntity`), `displayScene` pipeline,
  selection/history/undo/redo/drawing semantics untouched.

## Files

- `src/hooks/surveyCad/useSurveyCadWorkspace.ts` (+18/-2).
- `tests/cad_spike_scene_laziness_perf190.test.tsx` (new, 7 tests).
- `docs/evidence/perf190-lazy-spike-scene/{architecture,validation}.md` (this pair).
- No adapter/type/consumer/DOM/config changes.
