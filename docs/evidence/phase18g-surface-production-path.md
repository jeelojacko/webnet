# Phase 18G — Surface production path (baseline, pre-migration)

Baseline: `origin/main` = `6d446c70948384b7894c60d2b0b50218eec6b566`
(PR #96 merge, Phase 18F). Branch: `perf/cad-surface-production-hardening`.
`origin/main` did NOT advance past the mission-creation SHA; baseline is exact.

## 1. Production rebuild path (synchronous, main thread)

`src/components/SurveyCadWorkspace.tsx`

- `:51` — `import { buildCadSurface, computeCadSurfaceSourceRevision }
  from '../engine/cad/cadSurfaces';`
- `:332` — `surfaceCache = useMemo(() =>
  createCadSurfaceCache(activeDrawing.drawingId), [activeDrawing.drawingId])`
  (one cache per drawing id; recreated on drawing switch).
- `:331` — `surfaceMeshSessions: Record<string, string[]>` session state;
  `:336` — `surfaceRevisionIndex` derived from it (resolves stale meshes).
- `runSurfaceBuild` (`:730-760`), fully synchronous on the UI thread:
  1. `:731-732` find surface or return `'Surface not found.'`
  2. `:733` `revision = computeCadSurfaceSourceRevision(activeProject, surface)`
  3. `:734-736` cache hit → `"…" is already current.` (no build)
  4. `:739` `result = buildCadSurface(activeProject, surface)` in try/catch
  5. `:744-751` non-`ok` outcome → `insufficient`/`blocked` string, nothing cached
  6. `:749-755` `surfaceCache.set(...)` with deep-copied points/triangles/stats
  7. `:756-759` append revision to `surfaceMeshSessions` (stale-mesh lookup)
- `rebuildAllSurfaces` (`:762-779`): serial `for` loop over drawing order,
  cache-hit skip, inline `runSurfaceBuild`, recount via cache. No await, no
  worker, no cancellation, no progress.
- Entry points: `shellActions.rebuildSurface` (`:828`),
  `shellActions.rebuildAllSurfaces` (`:829`), Toolspace Rebuild
  (`CadToolspace.tsx:564`), Ribbon (`CadRibbon.tsx:159-160`), `SURFREBUILD`
  (`cadCommandRegistry.ts:245`), manager per-row Rebuild
  (`CadSurfaceManager.tsx:275`).
- Explicit marker: `:727-729` ponytail comment
  *"main-thread build; move to surfaceWorker when a TIN profile demands it
  (protocol + cache guards already exist)."*

## 2. Worker path (exists, test-only, not production-connected)

- `src/workers/surfaceWorkerHandler.ts` — pure handler: `build`/`cancel`
  request messages with `requestId` + `SurfaceBuildRequest`
  (surface id + source revision + compact point snapshot); responses
  `progress(queued|building|finalizing)` / `success` / `failure` / `cancelled`.
- `buildSurfaceMeshFromRequest` (`:84-131`) rebuilds a minimal `CadProject`
  from the snapshot and calls `buildCadSurface` (`:127`) — engine stays the
  single math owner.
- Latest-wins: `latestRevisionBySurface` drops superseded results (`:172,:192`).
- `src/workers/surfaceWorker.ts` — real `self.onmessage` entry. **No runtime
  caller**: no `new Worker(...surfaceWorker...)` anywhere in `src/` (only
  adjustment/gnss/artifact/study workers). Sole test consumer:
  `tests/cad_surface_transactions_worker.test.ts`.
- Cache apply guards `applySurfaceBuildSuccess` / `applySurfaceBuildFailure`
  (`src/engine/cad/cadSurfaceCache.ts:62-107`) enforce revision match before
  caching / writing `cachedRevision` / `buildDiagnostic` — also dead in
  production today; only that test imports them.

## 3. Why the worker is not yet production-connected

1. No `SurfaceWorkerClient` exists (no `build/cancel/dispose`, no session
   lifecycle, no drawing-identity ownership).
2. `runSurfaceBuild`/`rebuildAllSurfaces` call the engine directly; no hook or
   service seam sits between UI intent and `buildCadSurface`.
3. `BUILDING` is unreachable: `deriveSurfaceStatus(..., { building: true })`
   (`cadSurfaces.ts:281-297`) has no production caller; status text
   (`cadSurfaceView.ts:34-45`) and `resolveSurfaceDisplayStatus`
   (`:118-165`) can render `Building` but never receive it.
4. `surface.cachedRevision` is never written in-session (production CURRENT is
   session-cache-derived); the worker apply helpers that WOULD write it are
   unused, so wiring the worker without them drifts status.

## 4. Cache / revision / status source of truth (18F)

- `createCadSurfaceCache(scopeId)` (`cadSurfaceCache.ts:37-59`): `Map` keyed
  `scopeId::surfaceId@revision`. Scoped, not global. **Unbounded**: `set`
  never evicts older revisions; `invalidate(id)` only on surface delete
  (`SurveyCadWorkspace.tsx:782-798`); `clear()` has no production caller.
  `surfaceMeshSessions` is not keyed by drawing while the cache is recreated
  per drawing id — entries orphan (not wrong) across drawing switches.
- Revision: `computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts:266-317`),
  geometry-only FNV-1a `srev1:<hex>`; style/layer excluded by construction.
- Status: `deriveSurfaceStatus` order = building → BROKEN_REFERENCE →
  INSUFFICIENT_DATA (<3 pts, collinear) → FAILED (duplicate-Z conflict,
  breakline/boundary error) → UNBUILT (`cachedRevision == null`) →
  CURRENT/NEEDS_REBUILD by revision match. UI `resolveSurfaceDisplayStatus`
  layers session cache + stale-mesh fallback on top.

## 5. Domain filtering (centroid-based — the 18G target)

- `src/engine/cad/tin/tinDomainFilter.ts` — `filterTinDomain` keeps a triangle
  iff its **centroid** is inside every outer ring and inside no void ring
  (`:32-40`, ray-cast `pointInRing`), then optional max-edge drop, then
  planimetric area = sum of retained triangle areas.
- `tinBuild.ts` (`buildConstrainedTin`): base Delaunay → constrained-edge
  recovery (breakline segments only) with bounded Steiner restart rounds →
  legalize → centroid domain filter. **Outer/void rings are NOT passed as
  constrained segments** — only breaklines become `segments`
  (`cadSurfaces.ts` builds `segments` from breakline chains alone). Boundary
  edges therefore do not exist in mesh topology, and straddling-triangle
  classification is approximate by construction.
- Interpolation grid (`buildSurfaceGrid(finalPoints, tin.triangles)`) indexes
  retained triangles only — but retention itself is the approximation.
- No materialized adjacency (derivable, not stored); no constrained-edge flags.

## 6. What 18G must change (migration checklist)

1. One production build service/hook owning worker request lifecycle.
2. Narrow typed `SurfaceWorkerClient` (build/cancel/dispose, bounded lifecycle).
3. Request ownership: requestId + surfaceId + sourceRevision + drawing/session
   id; apply only on full match (latest-generation + cross-drawing isolation).
4. Real BUILDING session state; FAILED session diagnostic; previous-stale-mesh
   display policy; no fake progress.
5. Rebuild-all through one worker / serialized queue with per-surface report.
6. Bounded sync fallback (if any) with disclosed size limit; else remove direct
   UI `buildCadSurface` imports (keep engine pure for worker/tests).
7. Exact constrained domain classification (boundary segments as topology
   constraints + flood/label, not centroids) with concave-outer / narrow-void /
   multi-void / touching-breakline / invalid-relation oracles.
8. Materialized adjacency + constrained-edge flags + `validateTinMesh` +
   area/interpolation restricted to retained domain.
9. Bounded cache (current + ≤1 stale) with drawing-replace/document-close
   disposal; transfer/memory/display-edge measurement; 10k/50k/100k evidence.
10. Playwright `tests-browser/cad-surface-18g.spec.ts` (core + async +
    supersession + responsiveness) + manual QA at 3 resolutions + reviewer gate.
