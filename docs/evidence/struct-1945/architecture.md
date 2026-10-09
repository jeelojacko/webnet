# STRUCT-194.5 — CAD volume / grading / analysis + profile / section lifecycles

Branch: `refactor/issue194-cad-civil-services-lifecycle`
Baseline: `26a5cebeb9eb740393c84b6ac28ae354ac224e22` (origin/main)
Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** — severity not
marked solved).

Behavior-preserving only. Two contiguous lifecycle regions are extracted from
`src/components/SurveyCadWorkspace.tsx` into two custom hooks, called
unconditionally and back-to-back at the exact former positions:

1. `src/hooks/surveyCad/useSurveyCadVolumeGradingAnalysisLifecycle.ts` — the
   volume, grading (+ group) and analysis derivation control planes. Called at
   the former `volumeService` position (after the build + contour lifecycles).
2. `src/hooks/surveyCad/useSurveyCadProfileSectionLifecycle.ts` — the profile
   and section derivation control planes. Called immediately after hook 1 at
   the former `profileCache` position.

No engine geometry, schema, persistence bytes, cache epoch, worker protocol,
hash, history, shell-link, action-ordering, status-notice or visible-wording
change. The early primitive state/memos that key these services
(`volumeVersion`, `volumeCache`, `gradingCache`, `gradingVersion`, `groupCache`,
`analysisVersion`) deliberately stay in the root at their original positions;
the hook receives them through grouped typed contexts. The late
`notifiedMeshRevisionsRef` effect + `surfaceVolumeInputs` memo, the compose
service/`pendingComposeModeRef`/APPLY transaction, all late deletion effects,
the 97-key shell mapping and the twin shellLink registration keep their exact
positions and dependency arrays.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 2059 | 1812 | **-247 (-12.0%)** |
| Root primitive hook call sites | 123 | 96 | **-27** |
| — `useState` | 42 | 40 | -2 |
| — `useRef` | 14 | 10 | -4 |
| — `useMemo` | 37 | 26 | -11 |
| — `useEffect` | 29 | 19 | -10 |
| — `useCallback` | 1 | 1 | 0 |
| Root custom (non-primitive) hook-call sites | 16 | 18 | **+2** |

The `useState`/`useRef`/`useMemo`/`useEffect` calls that moved are exactly the
27 that formed the two extracted regions:

- hook 1: 3 `useMemo` (volume/grading/analysis services) + 2 `useMemo` (grading
  / group inputs) + 2 `useEffect` (volume/grading disposal) + 1 `useEffect`
  (grading reconciliation) + 1 `useEffect` (analysis disposal) = 5 `useMemo` +
  4 `useEffect`.
- hook 2: 2 `useMemo` (profile/section caches) + 2 `useState` (profile/section
  versions) + 2 `useMemo` (profile/section services) + 2 `useEffect`
  (disposal) + 4 `useRef` (independent mesh/alignment diff refs) + 4
  `useEffect` (mesh/alignment notify) + 2 `useMemo` (profile/section snapshot
  inputs) = 6 `useMemo` + 2 `useState` + 4 `useRef` + 6 `useEffect`.

The root remains above the repo 900-line guidance (1812 lines); this is the
fifth #194 slice and the root is smaller, not larger.

## New modules

| File | LOC | Exported hook fn LOC | Helpers | Responsibility |
| --- | ---: | ---: | --- | --- |
| `src/hooks/surveyCad/useSurveyCadVolumeGradingAnalysisLifecycle.ts` | 228 | 106 | `createSurfaceWorkerTransport` | Volume + grading(+group) + analysis services, disposals, reconciliation sweep, snapshot inputs. |
| `src/hooks/surveyCad/useSurveyCadProfileSectionLifecycle.ts` | 247 | 94 | `createSurfaceWorkerTransport`, `useMeshRevisionNotify`, `useAlignmentDigestNotify` | Profile + section caches/versions/services, disposals, mesh-revision + alignment-digest notify effects, snapshot inputs. |

Largest module is 247 lines (repo warning 600, hard cap 900); largest exported
hook function is 106 lines (target 10-40, warning 75, hard cap 120). The two
notify effects are shared module-level helper hooks (`useMeshRevisionNotify`,
`useAlignmentDigestNotify`) that each own their diff `useRef` and `useEffect`,
invoked at the same positions as the original per-service `useRef` + `useEffect`
pair, so the emitted primitive sequence is unchanged. No conditional hooks, no
render-time factory.

## Flattened hook order (preserved)

```
... early root primitive state/memos (volumeVersion, volumeCache,
    gradingCache, gradingVersion, groupCache, analysisVersion) unchanged ...
useSurveyCadSurfaceBuildLifecycle(...)
useSurveyCadContourLifecycle(...)
useSurveyCadVolumeGradingAnalysisLifecycle({ drawingId, project, caches, state,
                                             activeProjectForBuildsRef,
                                             drawingIdForBuildsRef,
                                             setFileStatusText })
useSurveyCadProfileSectionLifecycle({ drawingId, project, surfaceCache,
                                      surfaceMeshSessions,
                                      activeProjectForBuildsRef,
                                      drawingIdForBuildsRef,
                                      setFileStatusText })
notifiedMeshRevisionsRef effect [surfaceMeshSessions, volumeService, analysisPlane]
surfaceVolumeInputs memo [volumeService, volumeVersion, surfaceCache, volumeCache]
... compose service, shell mapping, late deletions, LandXML, OSNAP unchanged ...
```

Inside hook 1 the flattened primitive order is the original sequence:
`useMemo(volumeService)` → `useEffect(volume dispose)` → `useMemo(gradingService)`
→ `useEffect(grading dispose)` → `useEffect(reconcile)` →
`useMemo(gradingInputs)` → `useMemo(groupInputs)` → `useMemo(analysisPlane)` →
`useEffect(analysis dispose)`.

Inside hook 2 the flattened primitive order is the original sequence:
`useMemo(profileCache)` → `useState(profileVersion)` → `useMemo(profileService)`
→ `useEffect(profile dispose)` → `useRef(profile mesh ref)` →
`useEffect(profile mesh notify)` → `useRef(profile alignment ref)` →
`useEffect(profile alignment notify)` → `useMemo(surfaceProfileInputs)` →
`useMemo(sectionCache)` → `useState(sectionVersion)` → `useMemo(sectionService)`
→ `useEffect(section dispose)` → `useRef(section mesh ref)` →
`useEffect(section mesh notify)` → `useRef(section alignment ref)` →
`useEffect(section alignment notify)` → `useMemo(surfaceSectionInputs)`. Each
`useRef` + notify `useEffect` pair runs inside its helper hook at the original
position, so the emitted primitive sequence is unchanged. No conditional hooks,
no render-time factory.

## Callback / effect dependency matrix (byte-identical to the pre-extraction root)

| Seam | Dependencies (after) | Original |
| --- | --- | --- |
| volume service memo | `[drawingId, surfaceCache, volumeCache]` | `[activeDrawing.drawingId, surfaceCache, volumeCache]` |
| volume dispose | `[volumeService]` | same |
| grading service memo | `[drawingId, surfaceCache, gradingCache, groupCache]` | `[activeDrawing.drawingId, surfaceCache, gradingCache, groupCache]` |
| grading dispose | `[gradingService]` | same |
| grading reconcile | `[project, gradingService]` | `[cadProject, gradingService]` |
| gradingInputs | `[gradingService, gradingVersion]` | same |
| groupInputs | `[gradingService, gradingVersion]` | same |
| analysis plane memo | `[drawingId, surfaceCache]` | `[activeDrawing.drawingId, surfaceCache]` |
| analysis dispose | `[analysisPlane]` | same |
| profile cache memo | `[drawingId]` | `[activeDrawing.drawingId]` |
| profile service memo | `[drawingId, surfaceCache, profileCache]` | `[activeDrawing.drawingId, surfaceCache, profileCache]` |
| profile dispose | `[profileService]` | same |
| profile mesh notify | `[surfaceMeshSessions, profileService]` | same |
| profile alignment notify | `[project, profileService]` | `[cadProject, profileService]` |
| surfaceProfileInputs | `[profileService, profileVersion, surfaceCache, profileCache]` | same |
| section cache memo | `[drawingId]` | `[activeDrawing.drawingId]` |
| section service memo | `[drawingId, surfaceCache, sectionCache]` | `[activeDrawing.drawingId, surfaceCache, sectionCache]` |
| section dispose | `[sectionService]` | same |
| section mesh notify | `[surfaceMeshSessions, sectionService]` | same |
| section alignment notify | `[project, sectionService]` | `[cadProject, sectionService]` |
| surfaceSectionInputs | `[sectionService, sectionVersion, sectionCache]` | same |

The two `createTransport` closures are replaced by a module-level
`createSurfaceWorkerTransport` in each hook. It captures nothing, is invoked
lazily by the service on first request, and returns `null` on the identical
`typeof Worker === 'undefined'` / construction-throw fallback. No stale closure.

## Preserved contracts

- **Manual Calculate only.** Mounting and unrelated rerenders issue zero worker
  requests (`#194.5` tests assert `requests` / `workerUrls` empty). The
  grading reconciliation sweep cancels stale pending work on a project-identity
  change and never calls a Calculate entry point; `notifyMeshBuilt` /
  `notifyAlignmentChanged` cancel in-flight work and never auto-start
  (`SurfaceVolumeService.notifyMeshBuilt` etc. unchanged).
- **Group + grading version sharing.** `gradingInputs` and `groupInputs` are
  independent memos over the shared `gradingVersion` (root primitive) and the
  same `gradingService`; group snapshot state is not a separate version.
- **Revision race.** A stale volume worker result (`revision: 'vrev1:stale'`)
  resolved after the source moved is discarded and the volume never reads
  CURRENT (pinned in the hook suite); source rebuild cancels in-flight work
  without starting a new request. `analysisPlane.notifySourceRebuilt` retires
  in-flight analysis work without a new request.
- **Cache identity / no extra renders.** Caches and services are memoized once
  per `drawingId`; `surfaceProfileInputs` / `surfaceSectionInputs` keep their
  identity across unrelated rerenders; a drawing switch builds fresh caches +
  services and disposes the old ones exactly once.
- **Independent profile / section refs.** The four diff refs are separate and
  are not reset on a `drawingId` change (the notify effects key on the live
  sessions/project, exactly as the original per-render refs did). Mesh
  revisions notify once per NEW revision (length or element diff); alignment
  notifies only when `JSON.stringify(entity)` changes and the prior digest
  exists (first observation is silent).
- **Late root effect and `surfaceVolumeInputs` stay in the root** with their
  exact dependency arrays and call order, so `#185` (surface revision memo +
  contour race) and the analysis source-rebuilt retirement are untouched.
- **Compose** (`composeService`, `pendingComposeModeRef`, the APPLY
  transaction) is deliberately not touched — it is the distinct 194.6 issue.

## Worker URL parity

`new URL('../../workers/surfaceWorker.ts', import.meta.url)` from
`src/hooks/surveyCad/` resolves the SAME `src/workers/surfaceWorker.ts` module
as the pre-extraction `../workers/surfaceWorker.ts` from `src/components/`.
Verified by the hook suites (every constructed `Worker` URL pathname ends with
`/src/workers/surfaceWorker.ts`) and by the production build emitting exactly
one worker chunk, `surfaceWorker-YQANEhD9.js` (unchanged hash), referenced by
the `survey-cad` chunk. The root's remaining compose service still constructs
the same module, so the bundle dedupes to one chunk; no extra worker.

## #194 roadmap (remaining)

1. Composing the surface compose (`SurfaceComposeService`) control plane —
   distinct 194.6 issue.
2. `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Geometry/snapshot handler bodies that read the live workspace.
