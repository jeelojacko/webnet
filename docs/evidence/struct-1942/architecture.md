# STRUCT-194.2 — CAD shell-action control-plane extraction

Branch: `refactor/issue194-cad-shell-actions-control-plane`
Baseline: `e781d269b85999d08aa842cd1d81e7674ea6b0af` (origin/main)
Refs #194 (`TODO.md` in-progress note; **NOT CLOSED**).

Behavior-preserving only. The ~559-line `const shellActions: CadShellActions =
{...}` literal in `src/components/SurveyCadWorkspace.tsx` is gone; the action
object is now composed on every render from four cohesive,
side-effect-free-at-construction factories plus one small composer. No engine
geometry, schema, hash, worker protocol, drawing-serialization, cache-epoch,
shell-link, or action-ordering behavior changed.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 2862 | 2378 | **-484 (-16.9%)** |
| Inline `shellActions` literal LOC | 561 | 0 | -561 |
| Root hook-call sites | 109 | 109 | 0 |
| `CadShellActions` keys | 97 | 97 | 0 |

The root keeps the same two `shellLink` registration effects and the same
render position of the action object; the literal body is replaced with one
`buildCadWorkspaceShellActions({...})` call whose sub-objects carry the current
root values.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/components/surveyCad/cadWorkspaceShellActionsCore.ts` | 278 | Command start, history, selection, parcel/layer/survey/feature-line commands, survey + block + annotation managers, snap, New/Open/Save/LandXML, panel toggles, dock Enter/Escape/text. |
| `src/components/surveyCad/cadWorkspaceShellActionsCivil.ts` | 372 | Surface + volume + analysis actions, surface compose, TIN edit sessions, breakline/boundary describe + preflight. |
| `src/components/surveyCad/cadWorkspaceShellActionsLinear.ts` | 134 | Profile + sample-line/section actions; routes the long `createSectionViews` through the pure layout helper. |
| `src/components/surveyCad/cadWorkspaceShellActionsGrading.ts` | 165 | Grading + grading-group definition/Calculate/Extract/Bake actions. |
| `src/components/surveyCad/cadWorkspaceShellActions.ts` | 40 | Composer: `CadWorkspaceShellActionsContext -> CadShellActions`. |
| `src/components/surveyCad/cadWorkspaceSectionViewLayout.ts` | 71 | Pure `planSectionViewLayout`: cross-group clearance, gap stepping, failure/status plan. |

All modules are UI-side (`src/components/surveyCad/`); the engine never imports
them. No module is a 600-line monolith; the largest is 372 lines.

## Contract

Each factory takes one explicit, domain-typed context slice (no `any`, no
unsafe casts, no 80-field flat prop bag) and returns a
`Pick<CadShellActions, ...>` slice:

- `CadWorkspaceShellCoreContext` — `link`, `starters`, `workspace`
  (a signature-typed subset of `UseSurveyCadWorkspaceResult`), `project`,
  `selectedEntityIds`, history/selection handlers, file + panel setters,
  `editSessions`.
- `CadWorkspaceShellCivilContext` — `project`, `snapshot`, selection ids,
  `surfaceCache`, `volumeService`, `analysisPlane`, `composeService`,
  `pendingComposeModeRef`, `runSurfaceBuild`, `rebuildAllSurfaces`, the
  describe delegates, four surface edit-session handles, and the relevant
  setters.
- `CadWorkspaceShellLinearContext` — `project`, `selectedProfileId`,
  `sectionCache`, `profileService`, `sectionService`, describe delegates,
  selection/status setters.
- `CadWorkspaceShellGradingContext` — `snapshot`, `workspace`, `gradingService`
  and the grading/group manager setters.

The root calls the composer **each render** with current values, so every
closure captures the render's live project, caches, selected ids, snapshots,
services and edit sessions. There is no `useMemo([])`, no stale ref, no global
registry, and no hook inside a factory. The returned object is a new identity
each render, exactly like the former inline literal.

## Preserved `shellLink` effects (byte-identical)

```ts
useEffect(() => {
  if (!shellLink) return;
  shellLink.actions = shellActions;
}); // no dep array — reassigns fresh handlers after every render
useEffect(() => {
  if (!shellLink) return;
  const link = shellLink;
  link.notifyActions();
  return () => {
    link.actions = null;
    link.notifyActions();
  };
}, [shellLink]); // notify only on mount/unmount
```

`getActionsVersion()` therefore changes only on the `shellLink` mount/unmount
transition; a same-link rerender re-registers fresh closures **without**
notifying subscribers. `notifyActions` is never called per render.

## Baseline key inventory (domain -> keys, all 97 present)

Signatures are pinned by `CadShellActions`; the factories return exact `Pick`
slices so a missing/renamed key or changed signature fails TypeScript.

| Domain | Keys |
| --- | --- |
| Core (command) | `startCommand`, `cancelCommand`, `confirmCommandInput`, `submitSessionText?`, `setSessionInputValue?` |
| History | `undo`, `redo` |
| Selection | `selectAll`, `clearSelection`, `eraseSelection`, `selectEntities`, `selectAllSurveyPoints`, `selectSurveyGroupPoints` |
| Edit | `editField`, `runParcelLinkAction?`, `startParcelSharedEdit?`, `zoomToParcel?` |
| Layers / survey | `runLayerCommand`, `runSurveyCommand`, `runFeatureLineCommand?`, `setCurrentLayer`, `openLayerManager`, `openSurveyManager`, `openSurveyTableManager?` |
| Blocks / annotations | `openBlockManager?`, `runBlockOp?`, `ensureBlockSymbols?`, `armInsertPick?`, `cancelInsertPick?`, `explodeSelectedBlocks?`, `openAnnotationManager?`, `runAnnotationOp?` |
| File / chrome | `newDrawing`, `openDrawingFile`, `saveDrawing`, `requestLandXmlImport`, `toggleDraftingPanel`, `toggleExportCenter`, `setSnapPreference` |
| Grading (single) | `runGradingCommand?`, `selectGrading?`, `openGradingManager?`, `requestGradingCalculate?`, `extractGradingDaylight?`, `bakeGradingSurface?` |
| Grading (group) | `runGradingGroupCommand?`, `selectGradingGroup?`, `openGradingGroupManager?`, `requestGroupGradingCalculate?`, `extractGroupDaylight?`, `bakeGroupSurface?` |
| Surface | `selectSurface`, `startSurfacePick`, `querySurfaceElevation`, `querySurfaceSlope`, `rebuildSurface`, `rebuildAllSurfaces`, `describeBreaklineSource`, `describeBoundarySource`, `describeBreaklineChain?`, `describeSurveyPointCoords?`, `describeBoundarySourceDetail?`, `preflightBoundaryVertexEdit?`, `preflightBoundaryCandidate?`, `preflightDesignApply?` |
| Surface edit | `startSurfaceEditSession?`, `cancelSurfaceEditSession?`, `selectSurfacePoints?`, `setSurfacePointSelectionFilter?`, `clearSurfacePointSelection?`, `startSurfaceBulkEditSession?` |
| Compose | `previewSurfaceCompose?`, `requestSurfaceCompose?` |
| Volume | `selectVolume`, `requestVolume`, `calculateSelectedVolume`, `startVolumePick`, `queryVolumeDifference` |
| Analysis | `selectAnalysis?`, `selectAnalysisLegend?`, `createAnalysis?`, `requestAnalysis?`, `calculateSelectedAnalysis?`, `startAnalysisPick?`, `queryAnalysis?` |
| Profile | `selectProfile`, `rebuildProfile`, `createProfileView`, `selectProfileView`, `queryProfileElevation` |
| Section | `selectSampleLineGroup`, `selectSampleLine`, `rebuildSections`, `rebuildSectionLine`, `createSectionViews`, `selectSectionView`, `querySectionElevation` |

Return types / sync behavior / side effects are preserved verbatim: boolean
`startCommand`, `runLayerCommand`, `runSurveyCommand`, `runFeatureLineCommand`,
`runGradingCommand`, `runGradingGroupCommand`, `setCurrentLayer`,
`startSurfaceEditSession`, `startSurfaceBulkEditSession`, `selectSurfacePoints`,
`startParcelSharedEdit`; `void` history/selection/manager/file actions;
`string` grading/profile/section/compose messages and inquiry text; `string |
null` surface/volume/analysis/compose previews; `number`
`explodeSelectedBlocks`/`ensureBlockSymbols`.

## Command payload / status / cache matrix (preserved)

| Action | Dispatch | Gate | Payload / status |
| --- | --- | --- | --- |
| `extractGradingDaylight` | `runLayerCommand(GRADINGEXTRACTDAYLIGHT)` | `row.extractable` + `currentResult` + `revision` | `result: row.currentResult`, `expectedRevision: row.revision`, `sessionCurrent: true`; verbatim notices on miss/reject. |
| `bakeGradingSurface` | `runLayerCommand(GRADINGBAKE)` | `row.bakeable` + current | same CURRENT-result pin + `sessionCurrent: true`. |
| `extractGroupDaylight` / `bakeGroupSurface` | `GROUPEXTRACTDAYLIGHT` / `GROUPBAKE` | group-row equivalents | same shape, group id. |
| `requestGradingCalculate` / `requestGroupGradingCalculate` | `gradingService.requestGrading` / `requestGroupGrading` then `setGradingVersion(+1)` | explicit only | never auto-started, never recomputes history. |
| `previewSurfaceCompose` | pure engine `composeSurfaceMeshes` | distinct ids + both CURRENT cached meshes | `null` on same/missing/stale — never a stale promotion. |
| `requestSurfaceCompose` | `composeService.requestCompose` + pending-mode ref | worker/service | mode keyed `${base}|${overlay}`. |
| `createSectionViews` | repeated `runLayerCommand(SECTION_VIEW_CREATE)` | `planSectionViewLayout` | deterministic stack below the lowest cross-group frame; failure count in status. |

## Limitations / #194.3 roadmap

- The root is still 2378 lines and remains above the repo 900-line guidance;
  this is phase 2 of the #194 split (after 194.1) and it is smaller, not larger.
- The context slices carry ~50 grouped fields for civil/linear because the
  closures genuinely read the live workspace state; they are typed by domain,
  not flattened into one bag.
- Still monolithic in the root and queued for later phases:
  1. `New/Open/Save` + LandXML async review/scheduling (~1350-1530).
  2. Surface/profile/section/contour/worker service lifecycles (~500-1120).
  3. `SurveyCadWorkspaceSurface` drawing/pick handler bodies (kept in the
     parent by design).
