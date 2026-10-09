# STRUCT-194.3 — CAD drawing-file lifecycle + LandXML import orchestration extraction

Branch: `refactor/issue194-cad-drawing-lifecycle-extraction`
Baseline: `025c0d75273385453c727d3aea879a7dcae45529` (origin/main)
Refs #194 (`TODO.md` in-progress note; **STILL OPEN** — severity not marked solved).

Behavior-preserving only. The drawing-file control plane (New / Open / Save /
Import-adjusted) and the LandXML import control plane (stage / select / commit)
plus its three follow-up effects are extracted from
`src/components/SurveyCadWorkspace.tsx` into three cohesive hooks. No engine
geometry, schema, persistence bytes, cache epoch, worker protocol, hash,
history, shell-link, action-ordering, or visible-wording change.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 2378 | 2234 | **-144 (-6.1%)** |
| Root primitive React hook invocations (`useState/useRef/useMemo/useEffect/useCallback`, incl. generic forms) | 155 | 146 | **-9** |
| — `useState` | 50 | 47 | -3 |
| — `useRef` | 21 | 18 | -3 |
| — `useEffect` | 36 | 33 | -3 |
| — `useMemo` | 46 | 46 | 0 |
| — `useCallback` | 2 | 2 | 0 |
| Root hook-call sites (same `useXxx(...)` metric used by 194.1/194.2) | 109 | 108 | -1 |
| Root custom (non-primitive) hook-call sites | 11 | 14 | +3 |

The root keeps the same `shellActions` composition position and both
`shellLink` registration effects byte-for-byte.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadDrawingLifecycleState.ts` | 63 | Early, unconditional state hub: hidden drawing + LandXML file-input refs, staged LandXML preview, pending imported-surface ids, watched imported-surface id set, single file-status line. |
| `src/hooks/surveyCad/useSurveyCadDrawingFileLifecycle.ts` | 177 | New (blank in current units + `cad-created`), Save (`buildCadDrawingFileName`/`serializeCadDrawingFile`/`saveBrowserTextFile` + `CAD_DRAWING_FILE_TYPES`), Open (size gate → read → parse → error status / `cad-opened`), Import-adjusted (bridge-snapshot precedence + legacy gate), and `replaceActiveDrawing` with the exact emit → project → status order. |
| `src/hooks/surveyCad/useSurveyCadLandXmlImportLifecycle.ts` | 198 | LandXML stage / selection / commit, plus the three follow-up effects (schedule, materialization diagnostics, drawing-switch cleanup). |

All three are UI-side and never imported by the engine. Largest is 198 lines
(repo rule: warning at 600, hard cap 900).

## Hook / effect order inventory (TASK A baseline → after)

Baseline early hooks (root 262–272, immediately after the dependency-summary
`useMemo`, before `useState(viewport)`):

```
useRef(fileInputRef) -> useRef(landXmlImportInputRef)
-> useState(stagedLandXmlImport) -> useState(pendingImportedSurfaceIds)
-> useRef(importedSurfaceIdsRef) -> useState(fileStatusText)
-> useState(viewport) ...
```

After: the same six primitives live, in the same inner order, inside
`useSurveyCadDrawingLifecycleState()` called at the identical position (root
~236–250); `useState(viewport)` follows immediately. The hook is unconditional
and is the only place these handles are created, so `setFileStatusText` is
available before the worker-service `useMemo`s (root ~355) and the input refs
are identity-stable across renders, shell registration, and the manager tree.

Baseline handler/effect region (root 1218–1362), in order:

```
replaceActiveDrawing / handleNewDrawing / handleSaveDrawing / handleOpenDrawingChange
handleLandXmlImportChange / handleLandXmlSelectionChange / handleLandXmlImportSelected
useEffect(schedule [pendingImportedSurfaceIds, surfaceBuildService])
useEffect(diagnostics [surfaceBuildVersion, surfaceBuildService, activeProject.surfaces])
useEffect(cleanup [activeDrawing.drawingId])
```

After (root ~1204–1245), at the exact former handler position, after
`useEffect(applyViewport)`:

```
useSurveyCadDrawingFileLifecycle()   // no effects
useSurveyCadLandXmlImportLifecycle() // effects: schedule -> diagnostics -> cleanup
```

The drawing hook fires no effects, so the LandXML hook's three effects occupy
the same ordinal positions with the same dependency arrays and bodies. The
surrounding surface/profile/section/contour/volume/analysis/grading service
lifecycles, their disposal effects, and the `shellLink` notify cadence are
untouched.

## Contract details (preserved)

- `replaceActiveDrawing(next, status)` remains
  `emitDrawingChange(next)` → `replaceCadProject(next.project, status)` →
  `setFileStatusText(status)` (pinned by the 194.3 test).
- New = `createBlankCadDrawingDocument({ units })` + `onDrawingLifecycle('cad-created', null)`.
- Save = file name / serialized bytes / `CAD_DRAWING_FILE_TYPES`; status +
  `cad-saved` only when `saveBrowserTextFile` resolves `true`.
- Open = `assertBrowserFileSize(file, MAX_CAD_DRAWING_TEXT_BYTES, '<name> CAD drawing')`
  **first**, then read, then `parseCadDrawingFile`; parse errors join to status;
  success replaces + `cad-opened`; the input value is reset before any await.
- Import-adjusted = explicit `adjustmentSnapshot` precedence via
  `importSnapshotIntoCadDrawing`, else the legacy gate
  `result != null && canFeedDraftingFromResult && resultDependencyIdentity`
  routed through `importAdjustedPointsIntoCadDrawing` with
  `sourceName: 'Current adjustment'`; the blocked text is verbatim.
- LandXML stage re-reads `drawingIdForBuildsRef.current` after the await and
  refuses to bind when it no longer matches the render's `activeDrawing.drawingId`.
- LandXML commit goes through `commitAndScheduleLandXmlImport` once; only
  `outcome.scheduledSurfaceIds` reach `setPendingImportedSurfaceIds`;
  `importedSurfaceIdsRef` receives ids only when `outcome.committed`; the staged
  preview is always released. Rejections schedule nothing; the modal never
  dispatches a worker.

## Lint-suppression rationale

`react-hooks/exhaustive-deps` cannot prove that a custom hook's returned
`useState` setter / `useRef` object is stable, so the worker-service `notify`
`useMemo`s (8), the surface-edit Escape effect (1) in the root, and the three
LandXML follow-up effects carry `eslint-disable-next-line
react-hooks/exhaustive-deps`. This keeps the exact dependency arrays (no new
reactive deps) and restores the repo's clean `src` lint baseline. The setters /
refs are genuinely stable; the suppression is a known false-positive class
already used 45× elsewhere in `src`.

## #194 roadmap (remaining)

Still monolithic in the root and queued:

1. Surface/profile/section/contour/volume/analysis/grading service lifecycles
   (~350–980) — the largest remaining block.
2. `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Geometry/snapshot handler bodies that read the live workspace.
