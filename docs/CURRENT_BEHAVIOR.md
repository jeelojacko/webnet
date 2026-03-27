# Current Behavior

## Purpose
This document is the maintained feature inventory for WebNet. It summarizes the current supported behavior and the status-sensitive areas that should be treated as existing product contract unless a task explicitly changes them.

This file intentionally replaces the old pattern of keeping a giant behavior inventory inside `AGENTS.md`.

## Product focus
WebNet is a browser-based least-squares adjustment application designed around mixed-observation survey networks. It aims to behave like an industry-standard-style adjustment package while staying browser-first, testable, and deterministic.

Core delivered outcomes include:
- mixed-observation least-squares adjustment
- control-point handling and weighted constraints
- residuals, local tests, and statistical summaries
- station precision, relative precision, and error ellipses
- processing summaries, industry-style listing output, and text exports
- map, review, compare, recovery, and staged-import workflows

## Current defaults and operator-facing posture
Current startup and workflow defaults include:
- run profile defaults to industry-standard parity mode
- cluster detection defaults to OFF
- auto-adjust is available but operator-controlled
- the active startup dataset is currently rotated to the traverse industry-parity case, including NewBrunswick83 double-stereographic startup defaults, curvature/refraction-enabled zenith reduction with traverse refraction `k=0.07`, and a preloaded traverse instrument library (`TRAV_DEFAULT`, `S9`, `SX12`, `TS11`)
- the active startup dataset may be rotated to the current industry-parity working case during parity-sensitive batches
- browser-local recovery restores workspace state but intentionally does not restore stale solve results without rerun

## Supported input model

### Supported record families
The current parser supports the main control, geodetic, conventional, field, GNSS, traverse, direction-set, and leveling families used by the app, including support for mixed observation sets and source-line traceability.

At a high level, supported input behavior includes:
- control and coordinate records with component fixity and standard errors
- total-station distance, angle, direction, bearing, zenith, and mixed-measurement families
- GNSS vector families with per-component sigma support and correlation support where applicable
- differential leveling families and loop diagnostics
- legacy and industry-style leveling pair syntax such as `L FROM-TO dH len [sigma]`, with `len` read in the active project linear units and converted to kilometers internally
- traverse families and closure diagnostics
- direction-set families with reduction and quality diagnostics
- field-style sideshot and GNSS-topo convenience records
- include expansion with scoped state restoration and deterministic hard-fail diagnostics

### Directive support
The parser supports a large inline-directive surface used for:
- units and coordinate-order control
- 2D and 3D mode control
- delta and map/reduction behavior
- centering, EDM, and weighting options
- correlation and robust options
- aliasing, description, and control-state behavior
- GPS, CRS, geoid, and coordinate-system controls
- run-mode, preanalysis, cluster, auto-adjust, and review-oriented toggles
- traverse instrument scoping through `.INST <code>`, which flushes the active direction-set block and applies the selected instrument to subsequent traverse/direction-set observations

See the parser modules and tests for the precise directive matrix. Keep this document at the feature-summary level rather than duplicating every parser token.

## Adjustment and stochastic behavior

### Solve model
Current solve behavior includes:
- iterative least-squares adjustment
- mixed 2D and 3D workflows
- weighted control and elevation constraints from station standard errors
- under-observed-station and setup diagnostics
- SEUW, DOF, condition diagnostics, chi-square summaries, local tests, and MDB values
- redundancy numbers and residual diagnostics
- point precision and relative precision
- deterministic review-oriented ranking and sorting

### Stochastic model highlights
Current stochastic behavior includes:
- instrument-driven and explicit sigma support
- EDM additive and propagated handling
- centering inflation and parity-sensitive geometry-aware centering behavior
- traverse parity grid slope distances now use a dedicated reduction path that applies the scale factor to the horizontal component before rebuilding the 3D slope length, while legacy/local paths retain the older derivative algebra to preserve established parity locks
- parity-profile `initial` sigma geometry is now limited to angular centering behavior; shared browser/run-session distance and zenith modeling continues to use live geometry so the traverse startup case matches the direct engine path
- leveling weight support, including fallback propagation into other leveling-producing paths
- a forward-facing instrument setting for differential leveling precision in `mm/km`, separate from the project-level `.LWEIGHT` fallback
- TS angular correlation support with diagnostics
- robust Huber reweighting with iteration summaries
- fixed-sigma override support and weighting-source traceability
- effective-distance reporting for angular observation families

### Numerical and stability behavior
Current numerical behavior includes:
- dense SPD normal-equation solving through scaled Cholesky factorization
- diagonal damping for ill-conditioned normals
- covariance recovery through pivoted symmetric `LDLᵀ` solving
- deterministic diagnostics for regularized and singular cases
- explicit tiny-negative covariance cleanup in precision propagation instead of broad absolute-value reflection

## Diagnostics and review workflows

### Residual, suspect, and review workflows
Current review behavior includes:
- standardized residual tables with source-line traceability
- residual diagnostic summaries by severity and family
- what-if suspect impact scoring with one-click exclude and rerun flows
- project-level suspect impact mode control (`AUTO` / `ON` / `OFF`); `AUTO` skips the extra re-solves once the main solve is already heavy
- robust-vs-classical suspect comparison when robust mode is enabled
- setup-level suspect metrics and ranking
- traverse, GPS loop, direction-repeatability, and leveling suspect tables
- synchronized report/map selection and review actions
- saved-run compare and baseline review workflows
- heavy jobs now defer full normal-equation covariance recovery until the final adjusted state; intermediate outer iterations solve only for the correction vector
- posterior-scaled precision reporting is now derived from the industry-standard precision model by deterministic scaling instead of rebuilding a second full precision model during solve

### Cluster and automatic review workflows
Current workflow behavior includes:
- cluster detection candidate review with approve/reject and retained-point selection
- dual-pass solving when approved merges are applied
- revert-cluster-merge workflow
- auto-adjust cycles with thresholds, limits, and deterministic tie-breaks
- automatic sideshot candidate detection for eligible non-redundant measurements
- worker status now exposes solve elapsed time, current stage, solve-count progress, and per-solve iteration progress while heavy runs are active
- processing-summary diagnostics now include a per-run solve timing breakdown for setup, equation assembly, factorization, precision propagation, and report/packaging overhead

## Reporting and export behavior

### Main output surfaces
Current output surfaces include:
- adjustment report
- processing summary
- industry-style listing output
- map and ellipse views
- text export in WebNet or industry-style output
- adjusted-points export
- observations-and-residuals CSV
- GeoJSON network export
- LandXML export
- QA bundle export presets

### Listing and report expectations
Current listing/report behavior includes:
- summary-first report ordering
- solve-profile diagnostics near the summary surface
- deterministic section ordering and tie-break rules
- padded, readability-focused listing tables
- adjusted-observation grouping by observation family
- expanded station and relative 95% ellipse sections
- connected-pair direction parity in relative sections
- observation-table formatting for zero-size ellipse and displayed sigma corner cases
- omission of processing-log lines from the industry-style listing output
- industry-style adjusted-observation sections always emit the full solved set; the old adjusted-observation row-limit control is no longer exposed in Project Options
- fixture-backed parity locks now include a small WebNet underground 2D reference case whose industry-style listing must remain exact from `Project Option Settings` to the file end

### Precision reporting
Current results support dual precision-reporting models:
- industry-style outputs default to unscaled propagated precision
- a persisted selector can switch to posterior-scaled reporting without rerun
- that selector persists through saved runs, browser recovery, and project save/load

## Coordinate-system and GPS behavior

### CRS and reduction behavior
Current coordinate-system behavior includes:
- Local/Grid mode state
- CRS directives and optional labels, scale, and convergence inputs
- Canada-first CRS catalog support including NAD83(CSRS) UTM, MTM, and key provincial entries
- CRS-ID normalization accepting canonical IDs and EPSG aliases
- projection-family-aware factor computation with numerical fallback diagnostics
- reduction-context-driven measured/grid behavior
- pre-solve gates for incompatible local/grid/geodetic mixes and unconfirmed GNSS frames
- datum hard-fail and soft-warn diagnostics where appropriate

### Geoid and grid behavior
Current geoid behavior includes:
- optional geoid model controls and height-datum conversion controls
- external GTX/BYN loading through parser/CLI and browser workflows
- deterministic fallback diagnostics
- Canada-first preset support for common workflows

### GNSS-specific behavior
Current GNSS behavior includes:
- network vs sideshot modes
- AddHiHt support
- rover-offset support
- loop-closure diagnostics independent of residual analysis
- GNSS-topo support for post-adjust coordinate-style output rows

## Import and interoperability behavior
Current import behavior includes:
- generic importer registry and normalized imported-data model
- first-party importers for OPUS/OPUS-RS, JobXML, industry-style survey-report HTML, FieldGenius raw, Carlson/TDS RW5-style raw, and DBX text/XML exports
- staged import-review modal before editor mutation
- setup-aware grouping and output-style presets
- angle-mode and 2D conversion controls during import review
- richer compare and reconcile workflows across multiple external sources
- conflict detection against the current editor and deterministic conflict-resolution choices
- persistence of import-review and reconciliation state through local draft recovery

For detailed import behavior, see `docs/IMPORT_WORKFLOW.md`.

## Workspace, performance, and delivery behavior

### Persistence and saved work
Current workspace behavior includes:
- project save/open for `.wnproj` style JSON
- browser-local recovery for input, settings, include bundles, recovery-sensitive UI state, geoid bytes, saved runs, and compare state
- saved-run snapshots with restore, compare, rename, note, and delete flows
- preservation of last successful results during reruns

### Performance and scalability
Current delivered performance architecture includes:
- worker-backed solve execution in the browser
- worker solve status now reports elapsed time, active run-session stage, solve-count progress, and per-solve iteration progress in the toolbar so long traverse/parity jobs no longer look frozen
- shared run-session orchestration for browser and CLI solve flows
- shared run-session workflows may perform multiple full re-solves after the main adjustment for suspect-impact, preanalysis-impact, robust-comparison, or auto-adjust diagnostics; long traverse cases can therefore spend minutes in `Solving` even when a single engine solve is only tens of seconds
- lazy-loaded heavy result views and modal bodies
- local report state with filter and windowing behavior
- dense-map review guards
- benchmark coverage for large browser projects and imported-job workflows
- asynchronous worker-backed artifact generation for heavy export flows

## CLI and batch behavior
Current CLI support includes:
- headless parser and engine execution
- profile, iteration, unit, coord-mode, preanalysis, and GNSS frame controls
- summary, JSON, listing, and LandXML style outputs
- deterministic exit codes
- smoke-test and regression coverage

## Parity status notes
Parity-sensitive behavior remains an explicit project concern. Current parity-oriented workflow includes:
- a computational parity harness across reference projects
- an industry-reference diff gate
- a committed four-case industry-example fixture set sourced from local `manual/` inputs/outputs and mirrored into `tests/fixtures/`
- normalized exact-text parity helpers that ignore only volatile header values (software version, run date, project folder, and data-file path lines)
- fixture-locked listing-format and error-propagation coverage
- exact levelling-only industry-listing parity from `Project Option Settings` through the file end for the active leveling reference case
- active traverse startup defaults and parser regression locks for `.INST`-scoped instrument selection across direction-set/traverse blocks
- slot-preserving mixed sigma parsing for traverse direction-set `DM` rows, so tokens such as `& & 30` apply default direction and distance weighting while keeping only the zenith sigma explicit
- traverse direction-set reductions and paired `DM` distance/zenith rows now share one global observation-ID stream and preserve the active set ID, which keeps set-scoped diagnostics and review selection deterministic on the traverse parity case
- derived grid lat/lon and projection factors for projected traverse stations are recomputed from the live adjusted coordinates unless the station came from explicit geodetic input, preventing stale factor reuse on the traverse parity case
- the active traverse parity startup now uses a dedicated NewBrunswick83 double-stereographic parity CRS with industry-matching convergence/grid-factor evaluation instead of the earlier EPSG:2953-style scale contract
- the active traverse parity startup now runs with curvature/refraction enabled (`verticalReduction='curvref'`, `k=0.07`) using the same coefficient convention as the industry reference output, which brings the traverse zenith summary into parity range
- pre-solve traverse bootstrapping that can resect unknown direction-set setups from known targets and forward-seed connected target coordinates before adjustment
- traverse statistical summaries now keep fixed azimuth/bearing observations out of the measured-direction family, matching the industry-style `Az/Bearings` split on the traverse parity case
- adjusted measured direction rows now print lateral residual distance in the `Distance` column, matching the industry traverse reference listing instead of showing the geometric line length
- grid-mode input gating that ignores CRS-derived inverse lat/lon on projected auto-created stations instead of treating them as original unknown-class geodetic input
- focused regression locks around angular stochastic behavior, centering geometry, displayed sigma behavior, and connected-pair precision rows

When a change affects parser semantics, weighting, reduction, residual display, confidence formatting, or listing/report ordering, treat it as parity-sensitive and consult `docs/PARITY_WORKFLOW.md`.

## What belongs here vs elsewhere
Keep this file as the maintained feature inventory and status summary.

Do not use this file for:
- implementation step checklists -> use `TODO.md`
- low-level coding instructions -> use `AGENTS.md`
- deep import workflow notes -> use `docs/IMPORT_WORKFLOW.md`
- deep parity procedure notes -> use `docs/PARITY_WORKFLOW.md`
