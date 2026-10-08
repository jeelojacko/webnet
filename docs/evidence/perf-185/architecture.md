# PERF-185 — CAD surface source-revision reuse + contour auto-derive effect

Branch `perf/issue185-surface-revision-cache`, baseline `5bb1a320`
(= PR #213 merge / `origin/main`). Scope: production performance of the CAD
surface **display/derivation read paths** only. No schema, worker protocol,
revision-hash, contour-geometry, undo, or export change.

## Root cause

`SurveyCadWorkspace.tsx` drove contour auto-derivation from a `useEffect` with
**no dependency array**. React therefore re-ran the whole sweep on every commit
of the workspace root — including renders caused by unrelated internal state
(viewport reset, drafting-panel toggle, cursor/snap commits, parent re-renders).
Each sweep did, per surface:

```
backfillCadSurfaceStyles(project.surfaceStyles).find(...)   // full style clone
computeCadSurfaceSourceRevision(project, surface)           // full source hash
```

Independently, **four** UI read paths each recomputed the same source revision
from scratch on every call:

- the auto-derive effect,
- `surfaceContourInputs.getContours` (scene contours),
- `buildSurfaceDisplayLayer` (viewport display layer),
- `buildCadSurfaceSnapshot` (published shell snapshot),

and `buildSurfaceDisplayLayer` / `resolveSurfaceDisplayOptions` additionally
allocated a full style clone **per surface** just to read one style.

The result was O(renders × surfaces) clones + O(renders × surfaces) source
hashes, even when neither the project nor the surface content had changed
(project/surface objects are immutable per history transaction).

## Fix

### 1. Stable, complete dependency set for the auto effect

`SurveyCadWorkspace.tsx` (~L604-660, uncommitted partial work preserved):

```ts
const contourAutoDeriveInput = useMemo(
  () => ({ project: cadProject, buildVersion: surfaceBuildVersion }),
  [cadProject, surfaceBuildVersion],
);
useEffect(() => {
  const project = contourAutoDeriveInput.project;
  const styleById = indexCadSurfaceStylesById( // one style clone per sweep, first wins
    project.surfaceStyles,
  );
  for (const surface of project.surfaces ?? []) {
    const style = styleById.get(surface.styleId ?? '');
    if (!style) continue;
    const spec = contourLevelSpecFromStyle(style);
    if (!spec) continue;
    const revision = surfaceContentRevision(project, surface);
    if (!surfaceCache.get(surface.id, revision)) continue;         // CURRENT TIN
    const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
    if (contourCache.get(surface.id, revision, geometryRevision)) continue; // cached set
    // Revision-aware pending gate (PERF-185.1 correction): skip only when the
    // in-flight request already matches the current (source revision,
    // geometry revision); otherwise fall through and supersede it.
    const pending = contourService.pendingContourRequest(surface.id);
    if (pending != null && pending.revision === revision &&
        pending.geometryRevision === geometryRevision) continue;
    contourService.requestContours(surface.id, spec);
  }
}, [contourAutoDeriveInput, contourService, surfaceCache, contourCache]);
```

- The epoch object bundles **project identity** + **mesh-build version**, so the
  effect only re-runs on a genuine project transaction or TIN completion —
  never on an unrelated render.
- `contourService` / `surfaceCache` / `contourCache` are each memoized per
  drawing, so a drawing switch changes the effect identity too.
- The gate is strict: style enables contours, spec parses, parent TIN is CURRENT
  for the *current* source revision, no cached set for the *current*
  (source revision, geometry revision), and no in-flight request **that
  already matches the current (source revision, geometry revision)**. A fresh
  source revision with no rebuilt TIN therefore **never** promotes a stale
  contour.
- One style clone per sweep (never per surface). The sweep iterates the
  surface list directly; the surface index lives separately in
  `surfaceContourInputs`.

### 1a. PERF-185.1 correction — revision-aware pending gate

The original gate skipped a surface whenever *any* contour request was
pending (`buildingContourIds().has(surface.id)`). That stranded a new
derivation when the style/geometry changed under an in-flight request:

1. interval A is deriving (pending);
2. the user changes the interval to B → new project identity → the sweep
   re-runs, sees A pending, and skips B;
3. A completes and is cached for its own `(revision, geometryA)` key; the
   service discards it as stale for B and bumps `contourVersion`;
4. `contourVersion` is intentionally not an effect dependency, so B is not
   requested until an unrelated project edit or TIN build.

`SurfaceContourService` now exposes `pendingContourRequest(surfaceId)` — the
in-flight request identity `{revision, geometryRevision}` (or `null`). The
sweep skips only when that identity already matches the current one. On a
mismatch it calls `requestContours`, which supersedes the stale request
before starting the new one (latest-wins). Because the pending entry is
replaced, the stale completion's `requestId` no longer matches and is
discarded — it can never become CURRENT or clear B. This preserves the
no-infinite-loop guarantee without reintroducing `contourVersion` as a
dependency: the effect still runs only on a genuine project transaction or
TIN completion, and the matching-pending gate converges on the next pass.

`buildingContourIds()` is retained (snapshot/status seam); only the sweep's
gate changed.

**`contourVersion` is deliberately not a dependency.** The contour service
bumps it on every pending/diagnostic/completion transition. Adding it re-runs
the sweep after each transition and, because `requestContours` supersedes any
in-flight request before starting a new one, produces repeated
`deriveContours` bursts. This is pinned empirically: the focused browser spec
`tests-browser/cad-surface-revision-185.spec.ts` passes with the effect as
written above and fails on the drawing-switch step (derive count 15 vs 5) when
`contourVersion` is added back. The cache/pending/CURRENT-TIN gates converge
without it. This is an evidence-backed deviation from the original plan's
dependency list; the accepted behavior is "no unbounded loops".

### 2. Canonical revision memo shared by all four read paths

`src/engine/cad/cadSurfaceView.ts`:

```ts
const sourceRevisionCache = new WeakMap<
  CadProject,
  Map<string, { surface: CadSurface; revision: string }>
>();

export const surfaceContentRevision = (project, surface): string => {
  let byId = sourceRevisionCache.get(project);
  if (byId === undefined) { byId = new Map(); sourceRevisionCache.set(project, byId); }
  const cached = byId.get(surface.id);
  if (cached !== undefined && cached.surface === surface) return cached.revision;
  const revision = computeCadSurfaceSourceRevision(project, surface); // byte-identical truth
  byId.set(surface.id, { surface, revision });
  return revision;
};
```

- Memo key = immutable project object identity **and** surface object identity.
  The stored value is `computeCadSurfaceSourceRevision` verbatim — the canonical
  engine hash is unchanged and remains the single source of truth.
- The memo lives in the shared module, so the auto effect, `getContours`, the
  display layer and the shell snapshot all hit it automatically with **no
  signature change** (backward-compatible builders; no optional lookup wiring
  required). The weak project key means no drawing is retained.
- Contract: production writers replace project/surface objects per transaction;
  in-place mutation of the *same* objects is out of contract and is pinned as
  such by `tests/cad_surface_source_revision_memo_185.test.ts`.

Covered definition families (all byte-identical to the canonical hash):
native point source, point-group, breaklines, boundaries/voids, edits,
broken refs, imported TIN, baked explicit TIN. Style-only changes never alter
the source revision (styleId/layerId are excluded by the canonical hash).

### 3. Read-only style lookup

`src/engine/cad/cadSurfaceStyles.ts` adds `findCadSurfaceStyle(styles, styleId)`
— a non-cloning lookup (seeds only when the array is absent). The display/status
paths in `cadSurfaceView.ts` use it instead of allocating a clone per surface.
It is behaviorally identical to `backfillCadSurfaceStyles(styles).find(...)`
(that helper only shallow-clones arrays plus `minorContour`/`majorContour`).

### 4. Scene/snapshot input reuse

`SurveyCadWorkspace.tsx` `surfaceContourInputs` now builds one `styleById` and
one `surfaceById` index per project revision (rebuilt also on `contourVersion`
contour-state changes, which carry no project revision) and reuses them for
every `getContours` call, with `cadProject` in the dependency array (the previous
deps omitted the project identity and read the project through a ref).

## Scope boundaries

- No change to `computeCadSurfaceSourceRevision` / `surfaceContourGeometryRevision`.
- `SurfaceContourService` gains only the read-only `pendingContourRequest`
  getter and the auto-effect gate change; cache keying, worker protocol, and
  the `srev1:`/`scg1:` hash prefixes are unchanged.
- #183 pointer/culling, #184 shell-snapshot memo, #191 point-cap, provider
  correction `ba12f8e8` untouched.
- Imported/baked topology, group/breakline/boundary/edits/broken-ref revision
  semantics preserved (byte parity pinned by test).
