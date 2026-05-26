# Architecture

## Purpose
This document describes the current WebNet module layout, the main data flow, and the repository seams that matter most when making changes.

## High-level shape
WebNet is a browser-first TypeScript application built around a strict parser + solver + result-model pipeline, with React UI layers that consume deterministic solve results and review metadata.

At a high level:

1. Input text and project settings are edited in the browser.
2. Parse state, include bundles, instrument data, and import-review decisions are normalized.
3. The engine parses input records into stations, observations, directives, diagnostics, and traceability metadata.
4. The solver builds adjustment equations, iterates corrections, computes residuals and precision metrics, and assembles review diagnostics.
5. Derived output builders shape report, listing, export, map, and comparison models from the same solve result.
6. The UI renders those models through report, map, import-review, export, compare, and workspace-recovery workflows.

## Major areas

### App shell and browser workflows
Primary app-facing state and workflow orchestration live in the app shell plus hooks:

- `src/App.tsx`
- `src/appStateTypes.ts`
- `src/hooks/useWorkspaceProjectState.ts`
- `src/hooks/useProjectOptionsState.ts`
- `src/hooks/useProjectOptionsModalController.ts`
- `src/hooks/useImportReviewWorkflow.ts`
- `src/hooks/useAdjustmentWorkflow.ts`
- `src/hooks/useProjectFileWorkflow.ts`
- `src/hooks/useWorkspaceRecovery.ts`
- `src/hooks/useExportWorkflow.ts`
- `src/hooks/useReportViewState.ts`
- `src/hooks/useWorkspaceReviewState.ts`

These modules coordinate:
- input text and include bundles
- project and parser settings
- worker-backed run orchestration
- import-review modal state
- save/load and local recovery
- named-project storage, manifest, checked/open/focused file workspace state, and portable import/export workflows
- planning-map UI state for preanalysis feasibility overlays, blocked polygons, obstacle footprints, and scenario-family toggles
- export dispatch
- report/map shared review state
- saved runs and compare workflows
- post-solve hydration timing, deferred QA-derived review state, and staged heavy-tab warmup

### Engine core
The engine is centered under `src/engine/`.

Important seams include:

- parsing entry and extracted parser sub-pipelines
- preprocessing and constraint planning
- equation assembly and iteration control
- statistics, diagnostics, and result assembly
- output builders for report, listing, export, and LandXML
- shared result-derived selector models for report/map/listing flows

Representative modules include:

- `parse.ts`
- `adjust.ts`
- `runSession.ts`
- `solveEngine.ts`
- `directRunPipeline.ts`
- `preanalysisPlanning.ts`
- `planningMapState.ts`
- `runProfileBuilders.ts`
- `runResultsTextBuilder.ts`
- `runOutputBuilders.ts`
- `resultDerivedModels.ts`
- `projectWorkspace.ts`
- `projectStorage.ts`
- `projectBundle.ts`

### Parser decomposition
Parser responsibilities are now split across focused modules. The main parser delegates to extracted families and state helpers such as:

- `parseDirectiveRegistry.ts`
- `parseDirectiveState.ts`
- `parseIncludes.ts`
- `parseIncludeScope.ts`
- `parseAliasPipeline.ts`
- `parseSigmaResolution.ts`
- `parsePostProcessing.ts`
- `parseControlRecords.ts`
- `parseConventionalObservationRecords.ts`
- `parseFieldObservationRecords.ts`
- `parseTraverseRecords.ts`
- `parseDirectionSetRecords.ts`
- `parseDirectionSetWorkflow.ts`

Use these modules when changing:
- directive semantics
- include behavior
- alias or canonical-ID handling
- default sigma resolution
- record-family parsing
- traceability and parser log shaping

### Solver decomposition
Adjustment and diagnostic work is similarly split into focused seams such as:

- `adjustmentPreprocessing.ts`
- `adjustmentConstraints.ts`
- `adjustmentEquationAssembly.ts`
- `adjustmentIteration.ts`
- `adjustmentStatisticsBuilders.ts`
- `adjustmentResultBuilder.ts`
- `adjustmentClusterWorkflow.ts`
- `adjustmentStatisticalMath.ts`
- `adjustmentWeakGeometry.ts`
- `adjustmentLoopDiagnostics.ts`
- `adjustmentSetupTraverseDiagnostics.ts`
- `adjustmentReviewDiagnostics.ts`
- `precisionPropagation.ts`
- `reductionUsageSummary.ts`

Use these modules when changing:
- solve planning
- equation row construction
- conditioning or covariance recovery
- review diagnostics
- parity-sensitive precision and confidence sections
- cluster or auto-review workflows
- loop and traverse diagnostics

### UI composition
UI modules live primarily under `src/components/`.

Representative areas:
- `InputPane`
- `ReportView` and `src/components/report/*`
- `MapView`
- `SurveyCadWorkspace` plus `src/components/surveyCad/*` as the current CAD spike entry seam
- import-review modal
- Project Options modal
- workspace shell and toolbar components

Current Survey CAD spike seams:
- `src/engine/cad/cadTypes.ts` defines native CAD entities, including the current manual `polyline` spike family, plus layers, bounds, display primitives, and inferred external adapter payloads
- `src/engine/cad/cadModel.ts` builds a native CAD project from current WebNet input or solved results
- `src/engine/cad/cadProjectState.ts` owns CAD project bounds/signature helpers used by renderer and history layers
- `src/engine/cad/cadLayers.ts` and `src/engine/cad/cadStyles.ts` define the current default layer/style/linetype/symbol tables for the spike
- `src/engine/cad/cadCogo.ts` owns the first explicit COGO helper layer for inverse summaries, survey bearing formatting, bearing-distance point creation, and line-like intersections
- `src/engine/cad/cadSelection.ts` owns deterministic selection-set state over native entity IDs
- `src/engine/cad/cadSpatialIndex.ts` owns snap/select candidate search over native CAD entities, including line/polyline segment snapping and intersections
- `src/engine/cad/cadGeometry.ts` owns reusable 2D CAD geometry helpers such as inverse, midpoint, segment nearest-point, intersection, and azimuth-distance resolution
- `src/engine/cad/cadRenderer.ts` converts native entities into renderer-neutral display primitives
- `src/engine/cad/cadMlightcadAdapter.ts` converts the same native entities into an inferred `mlightcad`-target scene contract while preserving native IDs
- `src/engine/cad/cadTransactions.ts` and `src/engine/cad/cadUndoRedo.ts` own the first command registry, transaction journal, and undo/redo replay seam, now including explicit `COGO_POINT` and `INTERSECT_POINT` commits
- `src/hooks/surveyCad/useSurveyCadCommands.ts` owns interactive command sessions for typed input plus snap-fed `POINT`, `COGO PT`, `LINE`, `PLINE`, `INVERSE`, `MOVE`, and `COPY`, including coordinate, azimuth-distance, and survey bearing-distance entry
- `src/hooks/surveyCad/useSurveyCadWorkspace.ts` wires native CAD project state into selection, command history, and renderer outputs for the Survey CAD workspace
- `src/hooks/surveyCad/useSurveyCadSnapping.ts` resolves point-node / endpoint / midpoint / nearest snaps from the native spatial index
- `src/components/surveyCad/SurveyCadPreview.tsx` proves the adapter path through an internal SVG renderer without changing the main map stack
- `src/components/surveyCad/SurveyCadCommandLine.tsx` and `src/components/surveyCad/SurveyCadStatusBar.tsx` expose the first command/status surface for selection and edit-history work

The UI should treat solve results as the source of truth and avoid duplicating engine logic in view code.

`MapView` now has an explicit 2D layered-render split under `src/components/mapView/`:
- `mapViewWebgl2d.ts` owns the preferred WebGL2 render controller for OSM tiles plus non-selected static geometry
- `mapViewWebglBuffers.ts` builds GPU-ready line/point/ellipse/preview buffers from the same projected survey geometry used elsewhere, including the visibility-oriented halo passes and screen-readable point sizing used to keep map symbols legible over imagery
- `mapViewTileStore.ts` owns imperative tile lifecycle, fallback coverage, and eviction state
- `mapView2d.ts` now stages 2D map derivation into base projected geometry, base-space viewport culling, base-space selection/minor-geometry filtering, and final screen-space view application so pan/zoom avoids reprojecting and retranslating the full network every frame
- `mapViewCanvas2d.ts` now also owns a dedicated planning-overlay canvas pass for non-selected obstacle/blocked polygon bodies and raw input-point markers; that pass stays active even when the main 2D background renderer is WebGL
- `MapView.tsx` now stacks the 2D layers as basemap -> non-selected planning polygons -> non-selected survey geometry -> SVG labels/selections/tools, and its hit path resolves point hits first, then line hits, then planning polygons so draw priority and click priority match
- `MapViewSvg2d.tsx` remains the interaction/label/edit surface for selections, labels, selected planning outlines, edit handles, and tool affordances, but its 2D overlay tree is now split into memoized world-content sections behind lightweight transform wrappers so live pan/zoom can update the SVG transform without forcing the heavier label/planning/selection subtree to rebuild every frame
- during active 2D interaction, `MapView.tsx` now freezes the non-critical SVG label/planning bodies at the last settled snapshot while keeping the transform shell, active selections, edit handles, and hit-testing live, so pan/zoom stays smooth without changing the settled geometry result
- the final SVG label pass now owns both normal station labels and synthetic brace/setup preview labels, so the shared `Show labels` toggle and top-most label ordering apply consistently across real and synthetic map points
- `mapViewCanvas2d.ts` remains the automatic fallback renderer when WebGL2 is unavailable or initialization fails
- `mapViewPerf.ts` provides opt-in internal timing/counter capture so focused tests can profile the staged 2D derived-state passes, hit-index, tile, WebGL, canvas, and SVG work without changing operator-facing behavior
- live drag motion is now frame-coalesced in `MapView.tsx` before it reaches the 2D pan or 3D orbit/pan update path, so dense raw `mousemove` bursts are reduced to one applied drag step per animation frame
- `MapView.tsx` now also keeps a stable map snapshot boundary for the app shell: live `view2d` pan/zoom frames continue inside the map, but the persisted `MapViewSnapshot` only advances once 2D interaction settles back to `idle`, which avoids propagating whole-shell rerenders on every intermediate drag frame
- during active middle-drag 2D panning, `MapView.tsx` now applies a compositor-style preview translate to a shared render-surface wrapper instead of translating each layer independently, measures drag deltas in raw client pixels instead of transformed SVG coordinates, and keeps the drag-start derived viewport/culling basis frozen until release; the actual `view2d.panX/panY` commit happens once the drag ends so survey geometry stays visually planted while the camera motion stays smooth
- the `MapView.tsx` render surface is now aspect-locked to the fixed internal survey viewport with a uniform cover-fit inside the container, so layout width/height changes do not stretch the 2D geometry and do not leave letterboxed bars around the live map surface
- the WebGL basemap path now caches warped tile mesh GPU buffers per tile signature, requests a coarser tile zoom and lighter mesh during active interaction, enforces a smaller interaction-time tile budget before descriptor expansion, reuses the last settled basemap descriptor set while interaction is live, and defers tile-arrival-triggered redraws until interaction settles so OSM tile churn does not fight the compositor-style pan/zoom preview
- `MapView.tsx` now keeps interaction-time OSM descriptor refreshes on a bucketed view separate from the settled `view2d` state, and `mapViewTileStore.ts` caches resolved tile surfaces by descriptor signature so unchanged wheel frames can reuse the last settled basemap coverage instead of re-resolving the full tile set
- the OSM tile path now also separates render coverage from idle prefetch coverage: `MapView.tsx` renders the tighter visible ring, waits for a short idle pause, then opportunistically requests one wider off-screen ring only when the store is quiet; `mapViewTileStore.ts` keeps a larger in-memory tile budget so revisiting recently viewed areas can reuse cached tiles instead of immediately re-fetching them
- the shared 2D style selectors now size point/line/ellipse symbols from a screen-visibility target before converting back into world units, so zoomed-in geometry stays readable without changing its actual projected location
- the `MapView.tsx` pane chrome now keeps only the top/bottom separators around the live map surface, so the aspect-locked render slab keeps more horizontal room without adding side-border clutter

Focused map profiling coverage now includes a Camp Design preanalysis matrix under `tests/map_view_camp_design_profile.test.tsx`, driven by `tests/fixtures/map_view_camp_design_profile_matrix.json` plus helper setup in `tests/helpers/campDesignMapPerfHarness.ts`, so feature-toggle and renderer comparisons can be reproduced before changing the live map stack.

For real-browser interaction debugging, `map-pan-harness.html` plus `src/dev/mapPanHarness.tsx` provide a dedicated Camp startup map page with feature toggles plus opt-in map-perf capture hooks, and the Chromium Playwright harness now covers both `tests-browser/map-pan.spec.ts` for middle-mouse pan stability and `tests-browser/map-basemap-perf.spec.ts` for OSM-on pan/zoom/toggle profiling against the live `MapView` stack.

## Data flow

### 1. Input and settings
The user edits untitled input text or a named-project source-file workspace, along with project settings, parser settings, instrument data, and export preferences.

Those browser-facing artifacts are stored in workspace state and can also be:
- recovered from local draft state
- saved into named local browser projects backed by a manifest + source-file workspace
- exported/imported as flattened portable `.wnproj` snapshots or zipped manifest bundles
- restored from saved run snapshots for compare workflows

Named-project source-file workspaces now distinguish:
- checked project files for run assembly
- open editor tabs
- one focused editor tab that drives the visible textarea

For the detailed ordered checked-file run contract, see `docs/run-semantics.md`.

### 2. Optional external import review
If an external file is imported, the importer registry normalizes the source into staged rows and groups. The staged import-review workflow allows:
- grouping and reshaping rows
- excluding or fixing rows
- reconciling conflicts with current editor content
- comparing multiple import sources
- committing grouped WebNet text back into the editor

### 3. Parse stage
The parser:
- expands includes
- applies inline directives and scoped state
- canonicalizes IDs and alias mappings
- parses control, geodetic, conventional, field, GNSS, traverse, direction-set, and leveling families
- records diagnostics and traceability metadata
- produces normalized stations, observations, unknowns, and parser logs

### 4. Solve stage
The solver:
- preprocesses observations and control constraints
- builds active equation rows
- assembles normal equations
- iterates corrections
- computes residuals, precision, and covariance-derived products
- produces statistical summaries, local-test outputs, diagnostics, and review metadata

### 5. Result shaping
Result builders then generate:
- WebNet report sections
- industry-style listing sections
- processing-summary sections
- map and ellipse models, including preanalysis planning preview geometry and obstacle overlays
- adjusted-points and CSV/GeoJSON style exports
- LandXML output
- QA comparison models and bundle-export metadata

### 6. UI rendering and review
The UI renders those shaped models through:
- report tabs and filters
- map review and context tools
- compare workflows
- saved-run restore and comparison
- export selector flows
- local workspace recovery

After a successful run, the app shell now follows a two-phase handoff:
- the urgent phase commits the core result, active tab, and minimal run metadata so the report surface becomes interactive first
- a deferred phase computes QA-derived review/map models, warms heavy tabs sequentially, and lets `Processing Summary`, `Industry Standard Output`, and `Map` mount progressively on idle or first open

In dev builds, app-side UI timing helpers record worker-success, result-commit, deferred-build, tab-ready, and first-tab-click milestones without changing engine or parity-sensitive output contracts.

## Boundary rules

### Parser boundary
Parser modules should:
- resolve input syntax and scoped state
- preserve traceability
- avoid presentation formatting concerns

### Solver boundary
Solver modules should:
- operate on normalized internal units
- avoid UI-specific shaping
- emit structured diagnostics rather than formatted prose when possible

### Output-builder boundary
Output-builder modules should:
- shape result payloads into deterministic textual or export forms
- avoid re-solving or mutating engine state

### UI boundary
UI modules should:
- consume derived result models
- manage interaction state
- avoid duplicating numerical logic already owned by the engine

## Performance and scaling notes
Current performance-oriented architecture includes:
- worker-backed browser run execution
- shared run-session orchestration between browser and CLI paths
- lazy-loaded heavy result views and modals
- staged, cancellable post-solve heavy-tab prewarm instead of eager multi-tab remounts
- deferred QA-derived review/map model construction after the urgent result commit path
- memoized report-derived arrays and maps
- cached processing-summary text generation keyed by result identity plus narrow diagnostics inputs
- table windowing and load-more behavior for heavy sections
- dense-map guards for label suppression and clipped geometry
- a WebGL2-first 2D map pipeline for the OSM basemap and static non-selected survey geometry, with automatic layered-canvas fallback
- shader-uniform pan/zoom updates for WebGL map motion so the renderer can keep survey geometry grounded in the same projected world coordinates without CPU reprojection on every interaction frame
- imperative tile upload/cache lifecycle for the 2D map so OSM tile loads do not trigger broad React rerenders
- deferred 2D visibility-density derivation during live pan/zoom so the heavy point/line culling and label-density work does not have to fully recompute on every interaction frame
- dev-only UI performance instrumentation for post-solve responsiveness and browser long-task visibility
- parse and importer hot-path optimizations
- benchmark coverage for large browser workloads and imported-job flows

## Where to add new work
Use this routing guide when deciding where a change belongs:

- New directive or record-family parsing -> parser family/state modules under `src/engine/`
- New weighting, reduction, or precision logic -> solver/statistics/precision modules under `src/engine/`
- New report/listing/export section -> result builder or selector modules under `src/engine/`, then UI rendering under `src/components/`
- New operator workflow or modal behavior -> hooks plus focused component modules
- New Survey CAD model/command/COGO work -> planned `src/engine/cad/`, `src/hooks/surveyCad/`, and `src/components/surveyCad/` seams described in `docs/webnet-survey-cad-master-plan.md`
- New regression contract -> `tests/` with focused fixture-backed coverage
- Canadian CRS synthetic harness foundation -> `src/engine/canadianCrsTestCatalog.ts`, `src/engine/generateSyntheticCanadianNetwork.ts`, `src/engine/generateSyntheticObservations.ts`, `src/engine/runSyntheticCrsAdjustmentTest.ts`, and `tests/canadian_crs_harness.spec.ts`

## Related docs
- `docs/CURRENT_BEHAVIOR.md`
- `docs/PARITY_WORKFLOW.md`
- `docs/IMPORT_WORKFLOW.md`
- `docs/webnet-survey-cad-master-plan.md`
