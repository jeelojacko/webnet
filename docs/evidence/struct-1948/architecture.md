# STRUCT-194.8 — CAD derived-scene presentation, keyboard/cursor effects, session-result retirement extraction

Branch: `refactor/issue194-cad-effects-derived-scene-extraction`
Baseline: `b7fdf2302cbff76c2b2136622a11af0f4a9bfac7` (exact origin/main, = PR
#222 merge). Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** —
severity not marked solved).

Behavior-preserving only. Seven contiguous/ordinal seams in
`src/components/SurveyCadWorkspace.tsx` are extracted into focused UI hooks
with **zero** engine / schema / persistence / worker-protocol / hash / history /
shell-link / action-ordering / status-notice / visible-wording change.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 1461 | 1258 | **-203 (-13.9%)** |
| Root primitive hook call sites | 93 | 70 | **-23** |
| — `useState` | 40 | 40 | 0 |
| — `useRef` | 9 | 5 | -4 |
| — `useMemo` | 25 | 15 | -10 |
| — `useEffect` | 18 | 9 | -9 |
| — `useCallback` | 1 | 1 | 0 |
| Root custom (non-primitive) hook-call sites | 19 | 26 | +7 |
| Inline derived-scene/retirement effect LOC | ~270 | 0 | ~-270 |

Net root reduction is **-203 lines**, exceeding the ≥130 target. The root
remains above the repo 900-line guidance (1258); this is the eighth #194 slice
and the root is smaller, not larger. Every extracted memo/effect/ref was moved
verbatim; only the enclosing scope changed.

## 7 hooks and their exact ordinal positions (flattened order preserved)

The root calls the hooks in this file order, each at the exact former
seam position. Because each hook calls all of its internal hooks
unconditionally, the flattened primitive hook sequence is byte-identical to the
pre-extraction render.

| # | Hook | Former seam | Internal hook sequence |
| --- | --- | --- | --- |
| 1 | `useSurveyCadPreGradingDerivedScene` | first pre-grading memo (`displaySceneWithParcelLabelToggle`) | `useMemo` ×7 |
| 2 | `useSurveyCadShellCursorAndInsertKeyEffects` | block-INSERT Escape effect | `useEffect` ×2 |
| 3 | `useSurveyCadSurfaceEditHotkeys` | 18S/18T/18V Esc/Enter effect | `useEffect` ×1 |
| 4 | `useSurveyCadGradingEditOverlayScene` | `surfaceEditOverlayPrimitives` / grading memos | `useMemo` ×3 |
| 5 | `useSurveyCadAnalysisVolumeRetirement` | `knownAnalysisIdsRef` | `useRef`, `useEffect`, `useEffect`, `useRef`, `useEffect` |
| 6 | `useSurveyCadProfileSectionRetirement` | `knownProfileIdsRef` (after the pure inquiry factory) | `useRef`, `useEffect`, `useRef`, `useEffect` |
| 7 | `useSurveyCadSurfaceRetirement` | surface mesh-session effect | `useEffect` ×1 |

Root call-site order (line at extraction): hook 1 @569, hook 2 @833, hook 3
@884, hook 4 @893, hook 5 @905, hook 6 @936, hook 7 @947. The pure
`createCadCivilInquiryHandlers` factory stays between hooks 5 and 6; the
`surfaceEditSessions`/`surfacePointEditSessions` hooks stay between hooks 2 and
3; `runSurfaceBuild`/`rebuildAllSurfaces` stay between hooks 2 and 3.

### Hook 1 — `useSurveyCadPreGradingDerivedScene`

Seven `useMemo`s in their original order with byte-identical dependency arrays
and the in-place `void` epoch reads:

1. `displaySceneWithParcelLabelToggle` — `[displayScene, showParcelLabels]`;
   filters only `text` primitives whose id ends `:parcel-label`.
2. `profileViewLayers` — `[activeProject, profileCache, surfaceProfileInputs]`
   with `void surfaceProfileInputs.version`.
3. `displaySceneWithProfiles` — `[activeProject, displaySceneWithParcelLabelToggle, profileViewLayers]`.
4. `sampleLineLayers` — `[activeProject, surfaceSectionInputs]` with
   `void surfaceSectionInputs.version`.
5. `sectionViewLayers` — `[activeProject, sectionCache, surfaceSectionInputs]`
   with `void surfaceSectionInputs.version`.
6. `displaySceneWithSections` — `[activeProject, displaySceneWithProfiles, sampleLineLayers, sectionViewLayers, analysisDisplay]`;
   `withBlockHoverTitles` metadata pass + `filterCadDerivedLayersForViewport`
   attach of sample/section/analysis layers.
7. `reportedComputationEntities` — `[activeProject.entities, reportedComputation]`.

Returns `{ displaySceneWithSections, reportedComputationEntities }`.

### Hook 2 — `useSurveyCadGradingEditOverlayScene`

- `gradingDisplayLayers` — `[shellSnapshot]`.
- `groupGradingDisplayLayers` — `[shellSnapshot, gradingService]`; maps
  `gradingService.groupGradingDiagnostics()` into the `failedErrors` map.
- `displaySceneWithGrading` — `[activeProject, displaySceneWithSections, gradingDisplayLayers, groupGradingDisplayLayers]`.
- Plain post-filter append of the four preview arrays in the exact
  **edit → point → bulkSelection → bulkEdit** order; returns the
  `displaySceneWithGrading` reference unchanged when zero previews exist.

Never merged with hook 1 (a different ordinal location with intervening hooks).

### Hook 3 — `useSurveyCadShellCursorAndInsertKeyEffects`

- Effect A (block-INSERT Escape): deps `[blockInsertPick]`, document capture
  listener, cleanup removes it; only disarms when the target is not
  INPUT/TEXTAREA/SELECT.
- Effect B (cursor readout, PERF-183.1): deps
  `[shellLink, cursorActiveSnap, cursorPointerWorldPointRef, subscribeCursorPointerWorldPoint]`;
  snap → `{x,y,label:snap.label}`, else raw → 3-decimal `x,y` label, else
  `null`; publishes once on subscribe; cleanup is the unsubscribe. No root
  `setState` on an idle pointer move.

### Hook 4 — `useSurveyCadSurfaceEditHotkeys`

Single capture-phase effect. Escape priority: `edit → point → bulkSelection →
bulkEdit` cancel + one `'Surface edit session ended.'` notice. Enter priority:
`point → bulkEdit → bulkSelection → edit` commit (each consumes the event only
when it commits). Typing targets keep their own keys. Deps
`[surfaceEditSessions, surfacePointEditSessions, surfaceBulkSelection, surfaceBulkEditSessions]`
with the original targeted `exhaustive-deps` suppression.

### Hook 5/6/7 — session-result retirement matrix

| Domain | Memo/state | Effect deps | Deleted hook (once per removed id) | Selection clear |
| --- | --- | --- | --- | --- |
| analysis maps | `knownAnalysisIdsRef` | `[analysisMaps, analysisPlane, selectedAnalysisId]` | `analysisPlane.handleAnalysisDeleted(id)` | `setSelectedAnalysisId(null)` |
| analysis legends | none | `[analysisLegends, selectedAnalysisLegendId]` | — | `setSelectedAnalysisLegendId(null)` |
| volumes | `knownVolumeIdsRef` | `[volumeSurfaces, volumeService, selectedVolumeId]` | `volumeService.handleVolumeDeleted(id)` | `setSelectedVolumeId(null)` |
| profiles | `knownProfileIdsRef` | `[surfaceProfiles, profileService, selectedProfileId]` | `profileService.handleProfileDeleted(id)` | `setSelectedProfileId(null)` |
| sample-line groups | `knownSectionGroupIdsRef` | `[sampleLineGroups, sectionService, selectedSampleLineGroupId]` | `sectionService.handleGroupDeleted(id)` | `setSelectedSampleLineGroupId(null)` + `setSelectedSampleLineId(null)` |
| surfaces | functional updater | `[surfaces, surfaceCache, contourService]` (suppressed) | `surfaceCache.invalidate(id)` + `contourService.handleSurfaceDeleted(id)` | — |

The surface updater is byte-equivalent: builds the live id set, retains live
revisions by reference, invalidates + cancels only retired ids, and returns the
**previous** record object when nothing was deleted. Refs persist across
drawing switches (created once inside a custom hook just as the original
per-render refs were) and are only written by their own effect.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadPreGradingDerivedScene.ts` | 150 | Parcel toggle + profile/sample/section/analysis derived scene + reported entities. |
| `src/hooks/surveyCad/useSurveyCadGradingEditOverlayScene.ts` | 100 | Grading/group layers + post-filter surface-edit preview append. |
| `src/hooks/surveyCad/useSurveyCadShellCursorAndInsertKeyEffects.ts` | 92 | Block-INSERT Escape + imperative shell cursor readout. |
| `src/hooks/surveyCad/useSurveyCadSurfaceEditHotkeys.ts` | 76 | 18S/18T/18V Esc/Enter priority. |
| `src/hooks/surveyCad/useSurveyCadAnalysisVolumeRetirement.ts` | 83 | Analysis map/legend + volume retirement. |
| `src/hooks/surveyCad/useSurveyCadProfileSectionRetirement.ts` | 75 | Profile + sample-line-group retirement. |
| `src/hooks/surveyCad/useSurveyCadSurfaceRetirement.ts` | 58 | Surface mesh-session retirement. |

All are UI-side (`src/hooks/surveyCad/`); the engine never imports them. Largest
module is 150 lines (repo warning 600, hard cap 900); every hook function is
well under the 120-line cap. The spec's single
`useSurveyCadProfileSectionSurfaceRetirement` was delivered as two hooks
(`...ProfileSectionRetirement`, `...SurfaceRetirement`) called back-to-back at
the same position so the retirement sequence and the "7 hooks" acceptance both
hold; no effect moved.

## Preserved contracts

- React hook order/count for all retained hooks; every extracted dependency
  array and `void` epoch read byte-identical.
- `#183` pointer channel/cull, `#184` snapshot memo + point cap, `#185`
  surface revision + contour race, `#186` viewport filter, `#189` selection
  retirement, `#191` point cap.
- `#194.1`–`#194.7` extracted modules untouched.
- 97 `CadShellActions` keys/signatures, 122 starter registry, 12 shell-snapshot
  builders, both `shellLink` effects, `buildCadWorkspaceShellActions`
  composition, the keyboard hook, and the JSX tree all untouched.
- No base-scene refilter: hook 2 reuses
  `displaySceneWithGrading.primitives` by reference when previews are empty.
- No engine geometry / schema / hash / worker-protocol / persistence change.

## Remaining #194 roadmap

1. The `buildCadWorkspaceShellActions` call-site context assembly (~120 lines)
   and the remaining geometry/snapshot handler bodies.
2. Root is still 1258 lines (repo 900-line guidance). Honest progress:
   1461 → 1258 (-203).
