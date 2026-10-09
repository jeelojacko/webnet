# STRUCT-194.4 — CAD surface-build + contour service-lifecycle extraction

Branch: `refactor/issue194-cad-surface-contour-service-lifecycle`
Baseline: `a958ba028e4c2e7893a1cd4bb984c24512ecdf14` (origin/main, PR #218 merge)
Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** — severity not
marked solved).

Behavior-preserving only. The surface-build control plane and the contour
derivation control plane are extracted from `src/components/SurveyCadWorkspace.tsx`
into two hooks called, back to back, at the exact former surface/contour render
position. No engine geometry, schema, persistence bytes, cache epoch, worker
protocol, hash, history, shell-link, action-ordering, status-notice or
visible-wording change. The two live refs and caches are still shared with the
downstream volume / grading / analysis / profile / section / compose control
planes, which keep their own render position and dependency arrays.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 2234 | 2058 | **-176 (-7.9%)** |
| Root primitive React hook call sites (`useState`/`useRef`/`useMemo`/`useEffect`/`useCallback` with `<` or `(`) | 140 | 123 | **-17** |
| — `useState` | 45 | 42 | -3 |
| — `useRef` | 17 | 14 | -3 |
| — `useMemo` | 45 | 37 | -8 |
| — `useEffect` | 32 | 29 | -3 |
| — `useCallback` | 1 | 1 | 0 |
| Root custom (non-primitive) hook-call sites | — | — | **+2** |

The primitive count drops by exactly the 17 `useState/useRef/useMemo/useEffect`
calls that moved into the two hooks (build: 2 `useState` + 3 `useRef` + 3
`useMemo` + 1 `useEffect`; contour: 1 `useState` + 4 `useMemo` + 2 `useEffect`).

The full pre-existing `surfaceMeshSessions`/cache/ref/service block
(root ~335–400) is gone, and the contour block (~401–535) is gone; both are
replaced by two hook calls at the identical render point. The remaining
downstream service lifecycles, the late surface-deletion effect (~1680), the
`shellLink` registration effects, the LandXML lifecycle call, and the
`shellActions` composition keep their exact positions.

The root remains above the repo 900-line guidance (2058 lines); this is the
fourth #194 slice and the root is smaller, not larger.

## New modules

| File | LOC | Hook-fn LOC | Responsibility |
| --- | ---: | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadSurfaceBuildLifecycle.ts` | 143 | 84 | Session TIN state + bounded revision index, per-drawing TIN cache, the three live refs (project / drawing / sessions), the version, the one-worker `SurfaceBuildService` + disposal, and the revision-keyed snapshot inputs. |
| `src/hooks/surveyCad/useSurveyCadContourLifecycle.ts` | 237 | 85 | Per-drawing contour cache + version, the `SurfaceContourService` + disposal, the stable auto-derive epoch + effect, and the contour scene-input memo. Sweep + lookup bodies are module-level pure helpers so the hook function stays linear and short. |

Both are UI-side (`src/hooks/surveyCad/`) and the engine never imports them.
Largest is 237 lines (repo warning at 600, hard cap 900); largest hook function
is 85 lines.

## Hook order (root, former block)

```
... surface UI state useState ...
useSurveyCadSurfaceBuildLifecycle({ activeDrawingId, cadProject, setFileStatusText })
useSurveyCadContourLifecycle({ activeDrawingId, cadProject, surfaceCache,
                               surfaceBuildVersion, activeProjectForBuildsRef,
                               drawingIdForBuildsRef, setFileStatusText })
... volumeService -> gradingService -> analysisPlane -> profileService ->
    sectionService -> composeService -> surface snapshots (unchanged) ...
```

Inside the build hook the flattened primitive order is exactly the original
sequence: `useState(surfaceMeshSessions)` → `useMemo(surfaceCache)` →
`useMemo(surfaceRevisionIndex)` → `useRef(project)` → `useRef(drawingId)` →
`useRef(sessions)` → `useState(version)` → `useMemo(service)` →
`useEffect(dispose)` → `useMemo(inputs)`. Inside the contour hook:
`useMemo(contourCache)` → `useState(contourVersion)` → `useMemo(service)` →
`useEffect(dispose)` → `useMemo(epoch)` → `useEffect(auto-derive)` →
`useMemo(scene inputs)`. No conditional hooks, no render-time factory.

## Preserved contracts

- **Live refs.** `activeProjectForBuildsRef` / `drawingIdForBuildsRef` /
  `surfaceMeshSessionsForBuildsRef` are assigned synchronously in the build
  hook every render, before the service memo reads them. `getProject` returns
  exactly `cadProject` (the original `activeProject`, never a derived value).
  The same ref objects are returned and consumed by the downstream services.
- **Cache identity.** TIN cache memoized once per `activeDrawingId`; contour
  cache memoized once per `activeDrawingId`; build service memoized per
  `[activeDrawingId, surfaceCache]`; contour service per
  `[activeDrawingId, surfaceCache, contourCache]`. No per-render recreation.
- **Bounded revision index.** `recordRevision` functional-updates the sessions
  map with `[...previous, revision].slice(-2)`; no mutation of prior state.
- **Disposal.** One `dispose()` per service on replace/unmount via
  `useEffect(() => () => service.dispose(), [service])`.
- **Build inputs.** `surfaceBuildInputs` keyed `[service, surfaceBuildVersion]`,
  exact shapes (`buildVersion`, `buildingSurfaceIds`, `sessionDiagnostics`,
  `syncFallbackRevisions`); no fresh cursor objects, no per-pointer-move
  republish.
- **Contour semantics.** Auto-derive deps equivalent to
  `[epoch, service, surfaceCache, contourCache]` with `epoch = [cadProject,
  surfaceBuildVersion]`; `contourVersion` intentionally excluded; style index
  first-wins; CURRENT-TIN required; cache-hit skip; revision-aware pending gate
  (A→B supersession); `computeContourGeometryRevision(toContourGeometrySpec(spec))`
  exact; stale retained sets are display-only and never promoted CURRENT;
  scene-input identity stable unless project / contour version changes.
- **Late deletion effect unchanged** in the root: clears deleted surface
  sessions, `surfaceCache.invalidate(id)`, `contourService.handleSurfaceDeleted(id)`,
  deps `[activeProject.surfaces, surfaceCache, contourService]`.
- **Notifications** (`notify` → `setFileStatusText`) are byte-identical; the
  only `exhaustive-deps` suppression that moved is the same one already on the
  service memos (custom-hook setter false positive).

## Callback / effect dependency matrix (after extraction)

| Seam | Dependencies | Notes |
| --- | --- | --- |
| build service memo | `[activeDrawingId, surfaceCache]` | Workspace suppression (setter false positive) preserved. |
| build dispose effect | `[surfaceBuildService]` | — |
| build inputs memo | `[surfaceBuildService, surfaceBuildVersion]` | — |
| contour cache memo | `[activeDrawingId]` | — |
| contour service memo | `[activeDrawingId, surfaceCache, contourCache]` | Workspace suppression preserved. |
| contour dispose effect | `[contourService]` | — |
| auto-derive epoch memo | `[cadProject, surfaceBuildVersion]` | — |
| auto-derive effect | `[contourAutoDeriveInput, contourService, surfaceCache, contourCache]` | `contourVersion` deliberately absent. |
| contour scene-input memo | `[contourVersion, surfaceCache, contourCache, cadProject]` | — |
| root late-deletion effect | `[activeProject.surfaces, surfaceCache, contourService]` | Unchanged, stays in root. |

## Worker URL parity

The original `new URL('../workers/surfaceWorker.ts', import.meta.url)` resolved
from `src/components/` to `src/workers/surfaceWorker.ts`. From
`src/hooks/surveyCad/` the same module is addressed as
`new URL('../../workers/surfaceWorker.ts', import.meta.url)`. Verified:

- Unit test asserts the constructed `Worker` URL pathname ends with
  `/src/workers/surfaceWorker.ts` (`tests/cad_surface_build_lifecycle_1944.test.tsx`).
- Production build emits exactly one worker chunk,
  `dist/assets/surfaceWorker-*.js`, referenced by the `survey-cad` chunk — the
  moved path and the remaining root services (volume/grading/analysis/profile/
  section/compose) dedupe to the same source module.
- The `typeof Worker === 'undefined'` / construction-throw fallback to `null`
  is byte-identical; the bounded sync fallback is unchanged.

## #194 roadmap (remaining)

Still monolithic in the root and queued:

1. Remaining service lifecycles (volume / grading / analysis / profile /
   section / compose) — same extraction pattern, lower coupling risk.
2. `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Geometry/snapshot handler bodies that read the live workspace.
