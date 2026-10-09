# STRUCT-194.9 — CAD viewport lifecycle, analysis presentation, F2F catalog extraction

Branch: `refactor/issue194-cad-analysis-f2f-viewport-state`
Baseline: `bef47869f7c18ad96c2290b4c2150cf7f014d638` (exact origin/main = PR
#223 merge). Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** —
severity not marked solved).

Behavior-preserving only. Three contiguous seams in
`src/components/SurveyCadWorkspace.tsx` are extracted into focused UI hooks with
**zero** engine / schema / persistence / worker-protocol / hash / history /
shell-link / action-ordering / status-notice / visible-wording change. Every
extracted primitive keeps its exact call order and dependency array; each hook
is called unconditionally at the exact former seam.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 1258 | 1176 | **-82** |
| Root primitive hook call sites | 70 | 58 | **-12** |
| — `useState` | 40 | 38 | -2 |
| — `useRef` | 5 | 3 | -2 |
| — `useMemo` | 15 | 9 | -6 |
| — `useEffect` | 9 | 8 | -1 |
| — `useCallback` | 1 | 0 | -1 |
| Root custom (non-primitive) hook-call sites | 26 | 29 | +3 |

Root is now **1176 ≤ 1200**. Every moved primitive is verbatim; only the
enclosing scope changed.

## 3 hooks and their exact ordinal positions (flattened order preserved)

| # | Hook | Former seam | Internal hook sequence |
| --- | --- | --- | --- |
| A | `useSurveyCadViewportLifecycle` | viewport `useState` (after `useSurveyCadDrawingLifecycleState`, before `parcelLayoutState`) | `useState` → `useRef` → `useCallback` → `useState` |
| B | `useSurveyCadAnalysisPresentation` | `analysisSnapshot` memo (after `useSurveyCadComposeLifecycle`, before the F2F catalog) | `useMemo` ×4 |
| C | `useSurveyCadFieldToFinishCatalog` | `starterFallback` memo (after `analysisDisplay`, before `copiedEntityIdsRef` / the parcel hydration effects) | `useMemo` → `useRef` → `useEffect` → `useMemo` |

Root call-site order (line at extraction): A @~199, B @~447, C @~469. The
drawing-switch viewport reset effect (~625) and the `#194.8` derived-scene hook
(~487) keep their exact positions/deps after C.

### A — `useSurveyCadViewportLifecycle` (`src/hooks/surveyCad/`, 57 lines)

Original body moved verbatim:

```ts
const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
const viewportGenerationRef = useRef(0);
const applyViewport = useCallback<typeof setViewport>((action) => {
  viewportGenerationRef.current += 1;
  setViewport(action);
}, []);
const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneCadBounds(cadBounds));
```

- `viewportGenerationRef` is returned as `{ current: number }` (the
  `useSurveyCadWorkspace` arg type); `applyViewport` is returned as
  `Dispatch<SetStateAction<SurveyCadViewportTransform>>` where
  `SurveyCadViewportTransform` structurally equals the surface's local
  `CadPreviewViewport` (`{zoom,panX,panY}`).
- Lazy initializer preserved: `cadBounds` is read only on mount and cloned, so
  the caller's source object never aliases state.
- `useCallback` identity stable (empty deps); the generation bump happens
  **before** `setViewport(action)`, so a no-op or pan-only transform still
  invalidates a snap candidate stamped with the previous generation.
- The drawing-switch reset effect stays in the root and consumes
  `applyViewport` / `setViewBounds` unchanged: deps
  `[activeDrawing.drawingId, cadProject.bounds, cadProject.id, applyViewport]`.
- No new state, no new effect, no per-mousemove render.

### B — `useSurveyCadAnalysisPresentation` (`src/hooks/surveyCad/`, 152 lines)

Four `useMemo`s in this exact order with byte-identical dependency arrays and
the in-place `void` epoch reads:

1. `analysisSnapshot` — deps
   `[activeProject, surfaceCache, volumeCache, analysisPlane, analysisVersion, surfaceMeshSessions, selectedAnalysisId, selectedAnalysisLegendId]`;
   body `void analysisVersion; void surfaceMeshSessions;` then
   `buildCadAnalysisSnapshot(activeProject, surfaceCache, volumeCache, analysisPlane.cache, selectedAnalysisId, selectedAnalysisLegendId)`.
2. `analysisExportInput` — deps
   `[activeProject, analysisSnapshot, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]`;
   same two `void` epoch reads then
   `buildAnalysisExportInput(activeProject, analysisSnapshot, surfaceCache, analysisPlane.cache, units)`.
3. `exportCivilSources` — deps `[surfaceCache, profileCache, sectionCache]`;
   returns `{ surfaceCache, profileCache, sectionCache }` exactly.
4. `analysisDisplay` — deps
   `[activeProject, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]`;
   same two `void` epoch reads then
   `buildAnalysisSceneLayers(activeProject, surfaceCache, analysisPlane.cache, { area: analysisAreaUnit(units), volume: analysisVolumeUnit(units) })`.

`analysisVersion` and `surfaceMeshSessions` remain value-read-only epochs: the
analysis cache is mutated in place by the control plane, so a version bump / a
mesh source rebuild are the only reliable "results changed" triggers. The cache
identities stay stable, so an appearance-only edit repaints from cache without
an `arev1:` revision change. No argument-wrapping memo, no service instance, no
workspace-object dependency. Downstream `useSurveyCadPreGradingDerivedScene(
analysisDisplay)` and the shell snapshot `analysis` field keep reference
identity.

### C — `useSurveyCadFieldToFinishCatalog` (`src/hooks/surveyCad/`, 123 lines)

Primitive order is exactly `useMemo → useRef → useEffect → useMemo`; the two
handlers are plain fresh-per-render closures (never memoized):

```ts
const starterFallback = useMemo(() => cloneFeatureCatalog(STARTER_CATALOG), []);
const activeCatalog = activeProject.fieldToFinishCatalog ?? starterFallback;
const catalogIsFallback = activeProject.fieldToFinishCatalog === undefined;
const catalogStatus = getDrawingCatalogStatus(activeProject);
const catalogHasLegacyContent = catalogIsFallback && hasFieldToFinishContent(activeProject);
const featureCatalogRef = useRef<FeatureCodeCatalog>(activeCatalog);
useEffect(() => { featureCatalogRef.current = activeCatalog; }, [activeCatalog]);
const f2fReferenceCounts = useMemo(/* provenance-only GENERATED counts */, [activeProject.entities]);
const handleFeatureCatalogChange = (next) => {
  const change = classifyCatalogChange(featureCatalogRef.current, next);
  featureCatalogRef.current = next;
  workspace.replaceFieldToFinishCatalog(next, change); // exactly one txn
};
const handleFieldToFinishSettingsChange = (settings) =>
  workspace.updateFieldToFinishSettings({ ...settings });
```

- Truth is the HISTORY project, never workspace state:
  `catalogIsFallback` is true **only** when `fieldToFinishCatalog === undefined`;
  `catalogHasLegacyContent = fallback && hasFieldToFinishContent(project)`
  (MISSING_LEGACY fail-closed; the starter clone is surfaced but never written
  silently).
- The ref is advanced **before** `replaceFieldToFinishCatalog`, so a rapid
  edit / undo / redo / drawing switch always classifies against the current
  catalog.
- `f2fReferenceCounts` is provenance-only: `metadata.provenance.generatedBy ===
  'FIELD_TO_FINISH'` and a non-empty string `featureDefinitionId`; duplicates
  accumulate, geometry is never touched. The original `as`-cast provenance read
  is replaced by a `value is Record<string, unknown>` type guard (no `any`, no
  assertion; behavior-equivalent for non-object / null provenance).
- Workspace access is a `Pick<UseSurveyCadWorkspaceResult,
  'replaceFieldToFinishCatalog' | 'updateFieldToFinishSettings'>`; `activeProject`
  is the live history-present object.
- `handleFieldToFinishSettingsChange` shallow-copies the settings object and
  preserves `controlTokenAliases`.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadViewportLifecycle.ts` | 57 | Viewport transform state + generation ref + `applyViewport` + lazy bounds. |
| `src/hooks/surveyCad/useSurveyCadAnalysisPresentation.ts` | 152 | Analysis snapshot / export input / civil sources / display layers memos. |
| `src/hooks/surveyCad/useSurveyCadFieldToFinishCatalog.ts` | 123 | Drawing-owned catalog truth, ref sync, provenance counts, commit handlers. |

All are UI-side; the engine never imports them. Largest module 152 lines (repo
warning 600, hard cap 900); every hook function is far under the 120-line cap.

## Preserved contracts

- React hook order/count for all retained hooks; every extracted dependency
  array and `void` epoch read byte-identical; the three hooks call only their
  own primitives.
- `#183` pointer channel/cull, `#184` snapshot memo + point cap, `#185` surface
  revision + contour race, `#186` viewport filter, `#189` selection retirement,
  `#191` point cap.
- `#194.1`–`#194.8` extracted modules, the 97 `CadShellActions`,
  122 starters, 12 snapshot builders, both `shellLink` effects, the keyboard
  hook, LandXML lifecycle, and the JSX tree all untouched.
- No engine geometry / schema / hash / worker-protocol / persistence change.

## Remaining #194 roadmap

1. The `buildCadWorkspaceShellActions` call-site context assembly (~93 lines)
   and the remaining geometry/snapshot handler bodies.
2. Root is 1176 lines and now under the 1200 target; still above the repo
   900-line guidance. Honest progress: 1258 → 1176 (-82).
