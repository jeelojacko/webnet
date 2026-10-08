# PERF-184 — CAD shell-snapshot memo dependencies (memo part)

Branch `perf/issue184-cad-shell-snapshot-memo`, baseline `15870a64`. This
document covers the **shell-snapshot memo** slice only. The sibling
survey-snapshot point-cap work is recorded separately in
`docs/evidence/perf-184/point-cap.md` (different worker/scope).

## Root cause

`SurveyCadWorkspace.tsx` built the published shell snapshot in a `useMemo`
whose dependency array included the **whole `cadWorkspace` result object**. That
object is a plain literal returned by `useSurveyCadWorkspace`, so it gets a
fresh identity on every root render — including renders triggered by unrelated
internal state (`viewBounds` reset, drafting-panel toggle, cursor/snap
commits, parent re-renders).

The closure only ever reads seven fields off that object:

```
snapPreferences, commandInputValue, canUndo, canRedo,
historyDepth, redoDepth, annotationSnapshot
```

Every one of those is itself stable between genuine snapshot changes
(`snapPreferences` is snap state, `commandInputValue` is the command-session
value, the four history/undo scalars come from the history stacks, and
`annotationSnapshot` is memoized on `[cadProject, selection.selectedEntityIds]`).
Depending on the container object therefore re-ran all twelve snapshot builders
and re-invoked `shellLink.publish` for no data change.

Twelve builders per recompute:

```
buildCadSurveySnapshot          buildCadSurfaceSnapshot
buildCadSurveyTableSnapshot     buildCadVolumeSnapshot
buildCadParcelSnapshot          buildCadProfileSnapshot
buildCadFeatureLineSnapshot     buildCadSectionSnapshot
buildCadGradingSnapshot         buildCadBlockSnapshot
buildCadGradingGroupSnapshot    buildCadF2FSnapshot
```

## Fix

Destructure exactly those seven fields immediately before the memo, use the
destructured bindings inside the closure, and replace `cadWorkspace` in the
dependency array with the seven stable values. No wrapper object with a fresh
identity, no exhaustive-deps suppression, no ref indirection.

`src/components/SurveyCadWorkspace.tsx` (+24/−9):

```ts
const {
  snapPreferences, commandInputValue, canUndo, canRedo,
  historyDepth, redoDepth, annotationSnapshot,
} = cadWorkspace;

const shellSnapshot = useMemo(() => {
  ...
}, [
  ...,
  snapPreferences, commandInputValue, canUndo, canRedo,
  historyDepth, redoDepth, annotationSnapshot,
  ...
]);
```

## Dependency audit (all `shellSnapshot` memo inputs)

Every input was traced to its creation site on this branch. Only `cadWorkspace`
was fresh-per-render; everything else is a scalar, a React state value, or a
memoized derivation.

| Input | Creation site | Identity across unrelated renders |
| --- | --- | --- |
| `shellLink` | prop | stable |
| `activeDrawing` | `drawing ?? useMemo(legacyDrawing)` | stable |
| `activeProject` | hook `history.present.project` | stable (transaction-bound) |
| `activeCatalog` | `project.fieldToFinishCatalog ?? useMemo(starterFallback)` | stable |
| `catalogStatus` | `getDrawingCatalogStatus(activeProject)` → string | scalar |
| `selectionCount` | `selection.selectedEntityIds.length` | scalar |
| `selectedEntityIds` | hook `history.present.selection` | stable (selection-bound) |
| `selectedEntities` | `useMemo([cadProject, selection])` | stable |
| `propertiesPanelState` | `useMemo([cadProject, selectedEntities])` | stable |
| `activeCommandKey` | command state | scalar |
| `statusText` | command state prompt | scalar |
| `snapPreferences` (destructured) | snap state object | stable |
| `commandInputValue` (destructured) | command session value | scalar |
| `canUndo` / `canRedo` (destructured) | history stack lengths | scalar |
| `historyDepth` / `redoDepth` (destructured) | history stack lengths | scalar |
| `annotationSnapshot` (destructured) | `useMemo([cadProject, selection.selectedEntityIds])` | stable |
| `stationIds` | `useMemo([effectiveStations])`, `effectiveStations` memoized | stable |
| `dependencySummary` | `useMemo([...])` | stable |
| `units` | prop | scalar |
| `shellAvailableCommands` | `useMemo([copiedEntityIds.length, activeDrawing.drawingId])` | stable (intentional deps, eslint-disable pre-existing) |
| `surfaceCache` | `useMemo([drawingId])` | stable |
| `surfaceRevisionIndex` | `useMemo([surfaceMeshSessions])` | stable |
| `selectedSurfaceId` / `lastSurfaceInquiry` | React state | stable |
| `surfaceBuildInputs` | `useMemo([surfaceBuildService, surfaceBuildVersion])` | stable |
| `volumeCache` | `useMemo([drawingId])` | stable |
| `selectedVolumeId` | React state | stable |
| `surfaceVolumeInputs` | `useMemo([volumeService, version, caches])` | stable |
| `analysisSnapshot` | `useMemo([...])` | stable |
| `surfaceBulkSelection.summary` | hook `useMemo([selection, store, project, cache, buildingSurfaceIds])` | stable |
| `profileCache` | `useMemo([drawingId])` | stable |
| `surfaceProfileInputs` | `useMemo([profileService, profileVersion, caches])` | stable |
| `selectedProfileId` / `selectedProfileViewId` | React state | stable |
| `sectionCache` | `useMemo([drawingId])` | stable |
| `sectionService` | `useMemo([drawingId, surfaceCache, sectionCache])` | stable |
| `surfaceSectionInputs` | `useMemo([sectionService, sectionVersion, sectionCache])` | stable |
| `selectedSampleLineGroupId` / `selectedSampleLineId` / `selectedSectionViewId` | React state | stable |
| `blockInsertPick` | React state | stable |
| `gradingCache` | `useMemo([drawingId])` | stable |
| `selectedGradingId` | React state | stable |
| `gradingInputs` | `useMemo([gradingService, gradingVersion])` | stable |
| `groupCache` | `useMemo([drawingId])` | stable |
| `selectedGroupId` | React state | stable |
| `groupInputs` | `useMemo([gradingService, gradingVersion])` | stable |
| **`cadWorkspace`** | **hook return literal (new every render)** | **FRESH → removed** |

No other fresh-each-render input was found, so no further memoization was
needed. Intentionally **not** changed: `shellAvailableCommands`'s
`eslint-disable` deps (its output is a command-key list keyed on copied-entity
count and drawing id), any worker/service, and any engine math.

## Boundaries / out of scope

- No change to builders, engine geometry, worker protocol, DXF/export,
  persistence, undo, or the `CadShellLink` publish comparator.
- #183 pointer behaviour untouched: idle no-snap pointer moves still commit no
  root state (see `cad_pointer_perf_183.test.tsx`).
- #185 / #186 / #194 untouched.
