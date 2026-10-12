# PERF-CAD-RENDER.1 — per-pass CAD render/lookup hot paths: architecture

- Baseline: pinned `main 32930bd50615916fe2f8166a63fa64879ed633c3`.
- Branch: `perf/cad-render-per-pass-hotpath-1` (parent owns PR/CI/merge).
- Scope: two small, per-pass-only hot-path loops. No retention, no cache, no
  new modules, no signature changes.

## Problem

`buildCadDisplayScene` (the scene every render, viewport filter, sheet, and
export pass consumes) built its primitive list with a two-pass
`filter().flatMap()` chain, and `cadProjectLookup.byId` (built once per render
pass by the workspace) built every id map through a `map()` tuple array. Both
allocate intermediate arrays on every pass.

## Change 1 — `buildCadDisplayScene` single strict-order pass

`src/engine/cad/cadRenderer.ts`:

```ts
// before
primitives: project.entities
  .filter((entity) => entity.visible)
  .flatMap((entity) => toPrimitives(project, ctx, entity)),

// after
const primitives: CadDisplayPrimitive[] = [];
for (const entity of project.entities) {
  if (!entity.visible) continue;
  const entityPrimitives = toPrimitives(project, ctx, entity);
  for (const primitive of entityPrimitives) primitives.push(primitive);
}
return { bounds: project.bounds, primitives, surfaceLayers: ..., volumeLayers: ... };
```

Preserved contract:

- truthy visibility check (`if (!entity.visible) continue`), not strict `=== true`;
- entity order × per-entity primitive order (appended in sequence);
- a fresh output array per call (no cross-call or global cache);
- `bounds` by reference; `surfaceLayers` / `volumeLayers` `[]` when the
  matching option is absent (empty, never absent);
- a per-entity throw propagates all-or-nothing (the local array is discarded);
- `options.lookup` threading unchanged (`sceneRenderContext` still builds a
  lookup only when none is supplied);
- layer-hidden entities are still retained for the export scene
  (`filterCadDisplaySceneForViewport` remains the separate consumer filter).

## Change 2 — `cadProjectLookup.byId` one-pass `Map.set`

`src/engine/cad/cadProjectLookup.ts`:

```ts
// before
new Map((entries ?? []).map((entry) => [entry.id, entry]));

// after
const map = new Map<string, T>();
for (const entry of entries ?? []) map.set(entry.id, entry);
```

`Map.set` overwrites the value of a duplicate key while keeping the key's
FIRST insertion position, so the previous behavior is preserved exactly:
duplicate-id LAST-wins, first-insertion order, and `undefined` entry tables
produce an empty map. No memoization, no `WeakMap`, no signature change, no
retained reference beyond the returned map.

## Retention / import graph

- Both changes allocate only local values; nothing is stored on a module,
  closure, or project. Zero retained scene/project references outside the call.
- No imports were added or removed; no new modules. The extraction/import-graph
  count pins (nodes/edges) are unchanged.
- File sizes stay within guidance: `cadRenderer.ts` 1700 → 1731 lines is
  pre-existing large-file state (not grown by this change beyond the local
  loop); `cadProjectLookup.ts` 73 → 86 lines.

## Files

- `src/engine/cad/cadRenderer.ts` — change 1.
- `src/engine/cad/cadProjectLookup.ts` — change 2.
- `tests/cad_render_per_pass_hotpath.test.ts` — 17 semantics/negative-control tests.
- `scripts/perfCadRenderPerPassHotpath.ts` — cross-process measurement harness.
- `docs/evidence/perf-cad-render-per-pass-1/{architecture,validation}.md`.
