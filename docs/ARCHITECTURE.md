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
- named-project storage, manifest, and portable import/export workflows
- export dispatch
- report/map shared review state
- saved runs and compare workflows

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
- import-review modal
- Project Options modal
- workspace shell and toolbar components

The UI should treat solve results as the source of truth and avoid duplicating engine logic in view code.

## Data flow

### 1. Input and settings
The user edits main input text, include-file bundles, project settings, parser settings, instrument data, and export preferences.

Those browser-facing artifacts are stored in workspace state and can also be:
- recovered from local draft state
- saved into named local browser projects backed by a manifest + source-file workspace
- exported/imported as flattened portable `.wnproj` snapshots or zipped manifest bundles
- restored from saved run snapshots for compare workflows

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
- map and ellipse models
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
- memoized report-derived arrays and maps
- table windowing and load-more behavior for heavy sections
- dense-map guards for label suppression and clipped geometry
- parse and importer hot-path optimizations
- benchmark coverage for large browser workloads and imported-job flows

## Where to add new work
Use this routing guide when deciding where a change belongs:

- New directive or record-family parsing -> parser family/state modules under `src/engine/`
- New weighting, reduction, or precision logic -> solver/statistics/precision modules under `src/engine/`
- New report/listing/export section -> result builder or selector modules under `src/engine/`, then UI rendering under `src/components/`
- New operator workflow or modal behavior -> hooks plus focused component modules
- New regression contract -> `tests/` with focused fixture-backed coverage

## Related docs
- `docs/CURRENT_BEHAVIOR.md`
- `docs/PARITY_WORKFLOW.md`
- `docs/IMPORT_WORKFLOW.md`
