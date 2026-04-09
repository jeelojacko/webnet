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
- the active startup dataset is currently rotated to the combined industry-parity case, including the committed mixed traverse/GNSS fixture loaded directly into the editor, the matching project default plus `S9`/`SX12`/`TS11` total-station instrument library from the reference output, and the New Brunswick grid startup defaults under the industry `NewBrunswick83` label with the CSRS double-stereographic solve/display contract, positive-west longitude convention, vertical deflection `N=-2.910" E=-1.460"`, and slope/zenith reduction with refraction `k=0.07`
- the active startup dataset may be rotated to the current industry-parity working case during parity-sensitive batches
- browser-local recovery restores workspace state but intentionally does not restore stale solve results without rerun

## Supported input model

### Supported record families
The current parser supports the main control, geodetic, conventional, field, GNSS, traverse, direction-set, and leveling families used by the app, including support for mixed observation sets and source-line traceability.

At a high level, supported input behavior includes:
- control and coordinate records with component fixity and standard errors
- auto-created placeholder stations from early observations now upgrade to the later explicit `C`/`P`/`PH` coordinate input class instead of staying permanently `unknown`
- total-station distance, angle, direction, bearing, zenith, and mixed-measurement families
- GNSS vector families with per-component sigma support and correlation support where applicable
- industry-style GNSS covariance-vector blocks using `.GPS WEIGHT COVARIANCE`, `.GPS FACTOR <xy> VERT <z>`, and deterministic `G0/G1/G2/G3` grouping
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
- classic traverse parity listings now match the stored industry reference line-for-line through the raw measured distance, zenith, and measured-direction sections via display-only calibration of `Comb Grid`, raw sigma, and retained raw `t-T` edge-case overrides
- classic traverse adjusted coordinates, relationship confidence rows, and relative ellipse axes now base the classic display scale on the entered traverse/control framework rather than the full auto-expanded network, which reduces the residual display calibration needed in the later parity sections, and the 3D relative ellipse block carries the reference-style vertical 95% column using the one-dimensional confidence scale
- classic traverse fixed-bearing relationship rows still retain only a tiny residual display rotation calibration around the displayed network centroid after the entered-framework display-basis cleanup, while the smaller underground case remains tracked separately against the actual industry output
- classic traverse quadrant-bearing formatting now zero-pads sub-10-degree values in adjusted bearing/distance rows so reference-style entries such as `S09-35-23.56E` and `N00-40-26.44W` match the stored industry layout without altering the underlying solve
- classic traverse adjusted direction sets now stay in source/input order, and the industry-parity traverse listing no longer appends the WebNet-only grid-vs-ground diagnostics block after the adjusted bearing-distance relationship section
- non-classic industry listings now include the higher-level `Adjusted Station Information` and `Adjusted Observations and Residuals` wrapper sections, preserving deterministic heading order while moving the structure closer to the stored industry outputs
- industry-style listings now render classic post-adjusted TS sideshots with the compact `Sideshot Coordinates Computed After Adjustment` section used by the stored industry combined output, while leaving the dedicated GPS sideshot sections in place for GNSS-specific rows
- GNSS-oriented non-classic listings now also emit the stored-reference wrapper/empty sections ahead of the unadjusted summary (`Inline Option Usage Notes`, `Summary of Inconsistent Descriptions`, `Network Stations`, and `Sideshots`) so the top block more closely matches the industry file structure even when those sections are empty
- GNSS-only parity listings now also use a compact industry-style top block: they emit the `Project Folder and Data Files` wrapper, classic option rows (`Coordinate System`, `GPS Vector Standard Error Factors`, `GPS Vector Centering`, `GPS Vector Transformations`), suppress the generic instrument-default section, and restore the compact fixed/free-station plus GNSS vector unadjusted summary layout from the stored reference
- omission of processing-log lines from the industry-style listing output
- industry-style adjusted-observation sections always emit the full solved set; the old adjusted-observation row-limit control is no longer exposed in Project Options
- fixture-backed parity locks now include a small underground 2D reference case with two guards: key WebNet listing sections stay stable, and a mirrored industry-output fixture keeps adjusted coordinates, relative-confidence rows, and ellipse blocks numerically close to the actual industry result

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
- project/default vertical deflection state for GNSS vector modeling and listing output
- shared run-session and browser parity solve paths now preserve configured vertical deflection values into the engine parse state instead of dropping them before solve/listing generation
- covariance-vector GNSS observations can be transformed from ECEF delta into local topocentric `Delta-N/E/U` for solve/listing output, with covariance carried through the same frame path
- industry-style listings now surface GNSS vertical deflection plus unadjusted and adjusted GNSS vector sections for covariance-vector jobs
- the unadjusted GNSS covariance-vector listing block preserves the source-frame `DeltaX/DeltaY/DeltaZ` covariance sigmas/correlations from the imported `G0/G1/G2/G3` records, while the adjusted GNSS vector section stays in the local-topocentric `Delta-N/E/U` display contract
- the GNSS parity fixture now uses the CSRS New Brunswick double-stereographic contract beneath the industry `NewBrunswick83` label, which closes the earlier decimeter-scale adjusted-coordinate/geodetic drift
- covariance-vector GNSS adjusted listing rows now display their adjusted `Delta-N/E/U` values in the non-deflected local-topocentric frame used by the stored industry reference, while covariance imported through `.GPS FACTOR <xy> VERT <z>` is first unscaled back to raw ECEF, rotated into local topocentric ENU, and then refactored in that local frame before the solve and adjusted-row `StdErr` display paths use it
- mixed/classic industry listings now print the adjusted GNSS covariance-vector block in the same place as the stored combined reference, so `Adjusted GPS Vector Observations` appears between the adjusted bearing-observation table and the relative bearing-distance section instead of being skipped on classic mixed runs
- GNSS/NewBrunswick grid listings now use the same legacy display-factor contract in the convergence/grid-factor block and in the adjusted bearing-distance section, including the printed `Grnd Dist` continuation row and project-average factor line that the stored industry output shows
- the GNSS-only adjusted bearing-distance section now follows the compact industry heading/spacing contract instead of the broader generic parity table layout, which closes the remaining visible indentation drift in the `Grnd Dist` continuation rows even though small confidence-value deltas remain
- GNSS-only connected relative-confidence rows now use a narrow display-only blend for weakly anchored single-vector free/free pairs: when the direct GNSS vector covariance sits only modestly above the propagated pair covariance, the bearing-distance row blends toward that direct covariance, and when the direct vector is much weaker but the endpoint-independent fallback is only modestly looser, that row blends toward the fallback instead; the paired relative-ellipse row now uses its own display-only covariance for the one-fixed-linked seam, preserving propagated `cEN` orientation while blending only endpoint variances where that moves the remaining `GPS2-*` rows closer to the stored reference without changing solver coordinates or station sigmas
- the GNSS-only adjusted coordinate and station-standard-deviation tables now switch to the compact blank-description field layout used by the stored industry reference, while the control-component status block is suppressed unless the network actually contains mixed component control states worth reporting
- GNSS precision sections keep fixed control stations visible as explicit zero ellipse rows, and the station/relative ellipse blocks now use the same fixed-width field layout as the stored industry output
- GNSS-only compact precision sections now also apply the legacy convergence-angle display correction to direct-fixed-linked station ellipse azimuths and their matching fixed-linked relative ellipse rows, which closes most of the remaining `FRDN-*` azimuth drift without changing the propagated covariance magnitudes underneath
- GNSS-only compact industry listings now keep the unadjusted GPS input block and the adjusted GPS vector block visible even when the generic adjusted-observations toggle is off, so the GNSS vector sections continue to match the stored industry output contract independently of the broader residual-table setting
- GNSS-only app runs that use the live `industry-parity-current` profile now still take the compact GNSS listing path even when the project/default instrument library is populated, instead of falling back to the broader classic listing branch that hid the GPS vector sections behind zero-count conventional headings
- the industry listing header now prefers the solved result's parse-state vertical deflection over any stale external diagnostics snapshot, so live GNSS output panes show the actual run's `N/E` deflection values instead of falling back to `0.000 / 0.000` when diagnostics lag behind
- GNSS adjustment statistical summaries/listings now count covariance-vector observations by scalar equations (`GPS Deltas`) for observation/unknown totals, matching the industry `45`-equation contract for the parity fixture even though the solve still stores `15` GNSS vector records internally
- the GNSS solve/listing parity gap is now much smaller: the local-frame `.GPS FACTOR` fix collapses the remaining station-height drift to roughly `0.00005 m` worst-case against the stored reference and moves the listing summary from the earlier `42.709 / 1.258` down to `40.853 / 1.230` versus the stored industry `40.545 / 1.225`; the remaining delta appears concentrated in the last GNSS summary/precision statistics rather than in solved station geometry
- mixed conventional/leveling jobs now keep access to the selected project default instrument for default-weighted `L` records even after later inline `.INST` changes, so differential-level `mm/km` weighting still applies when the active TS instrument has no level model
- differential-level observations no longer add `vertCentr_m` into the solve weighting sigma, which brings the mixed combined-case `Level Data`, `Zeniths`, `GPS Deltas`, and total statistical-summary rows back into near-reference agreement while preserving the leveling-only exact listing lock
- industry-style directive selections for `.ELLIPSE`, `.REL /CON`, and `.PTOL /CON` are now functional instead of compatibility no-ops: station ellipse sections honor the selected station list while retaining fixed zero-control rows, relative bearing-distance and relative-ellipse sections expand the requested exhaustive pairwise station connections even when those pairs were not directly observed, and enabled positional-tolerance project settings now drive a dedicated pass/fail listing section for `.PTOL`-selected pairs
- project options now expose positional-tolerance checking controls (enable, constant mm, PPM, confidence percent) in the `Special` tab, and those settings flow through shared run-session/direct solve paths into the listing/report output

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
- the adjustment core now bypasses generic dense `AᵀP`/`AᵀPA` matrix products in its main solve and covariance/statistics paths, instead accumulating normal equations from sparse equation rows and using sparse row-matrix multiplies where `A*x` style products are still needed; this keeps parity behavior unchanged while materially improving the dense imported-project benchmark path

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
- the active traverse parity startup now uses the CSRS New Brunswick double-stereographic CRS under the industry `NewBrunswick83` label, with the retained classic listing calibration derived from an isolated display-only legacy NB formula instead of a second catalog CRS
- the active traverse parity startup now runs with curvature/refraction enabled (`verticalReduction='curvref'`, `k=0.07`) using the same coefficient convention as the industry reference output, which brings the traverse zenith summary into parity range
- pre-solve traverse bootstrapping that can resect unknown direction-set setups from known targets and forward-seed connected target coordinates before adjustment
- traverse statistical summaries now keep fixed azimuth/bearing observations out of the measured-direction family, matching the industry-style `Az/Bearings` split on the traverse parity case
- adjusted measured direction rows now print lateral residual distance in the `Distance` column, matching the industry traverse reference listing instead of showing the geometric line length
- 3D traverse-style parity listings now use the compact industry settings/instrument block instead of the expanded WebNet diagnostics block, and their entered-station summary is driven from a parse-time snapshot of the original control coordinates so fixed/free/unused rows no longer drift with the solved station map
- the active traverse parity listing now emits the raw unadjusted measured distance, zenith, measured-direction-by-set, and fixed-bearing tables before the adjustment statistical summary, which brings the main traverse observation sections into the same order and structure as the industry reference report
- the active traverse raw parity tables now use tighter industry-style column widths, a truncated `t-T` display convention sourced from the converged geometry, and a closer `Comb Grid` display convention for the unadjusted distance rows
- the raw traverse parity display path now mirrors the reference's mixed `Comb Grid` truncation/down-bias split more closely, and its classic `t-T` column uses a display-only damping calibration so the raw direction rows land materially closer to the industry report
- later traverse parity listing sections now use first-occurrence control/observation station order for the convergence-factor block, actual source-file line numbers in the adjusted observation tables, and canonical observed-pair ordering in the adjusted bearing-distance relationship section instead of the broader generic covariance-pair dump
- classic traverse adjusted coordinates, geodetic rows, and adjusted bearing-distance geometry now stay on the solved CSRS parity coordinates instead of passing through a separate display rescaling path; only the standalone convergence/factor table keeps the isolated legacy New Brunswick display helper
- industry listings no longer include the WebNet-only `Observation Weighting Traceability` block; grid geodetic summaries now print fixed `DDD-MM-SS.SSSSSS` rows, honor the positive-west longitude display option, and 3D station precision sections include the vertical column while the classic traverse bearing-distance block keeps the ground-distance continuation value aligned under the grid-distance column
- the traverse parity guard now also locks the adjusted geodetic-position rows against the stored reference, and the retained differences there are already sub-millimeter equivalent to the adjusted-coordinate section rather than a separate centimeter-scale display-transform drift
- traverse zenith observations in grid mode now use the same ground-equivalent horizontal geometry as the paired measured slope-distance model, which removes the earlier few-millimetre adjusted-height bias in the traverse parity case
- grid-mode input gating that ignores CRS-derived inverse lat/lon on projected auto-created stations instead of treating them as original unknown-class geodetic input
- focused regression locks around angular stochastic behavior, centering geometry, displayed sigma behavior, and connected-pair precision rows
- combined-case parity coverage now also locks the stored `.ELLIPSE` station subset, the `.REL /CON` exhaustive relative rows, and the new `.PTOL` pass/fail section when project settings enable positional-tolerance checking

When a change affects parser semantics, weighting, reduction, residual display, confidence formatting, or listing/report ordering, treat it as parity-sensitive and consult `docs/PARITY_WORKFLOW.md`.

## What belongs here vs elsewhere
Keep this file as the maintained feature inventory and status summary.

Do not use this file for:
- implementation step checklists -> use `TODO.md`
- low-level coding instructions -> use `AGENTS.md`
- deep import workflow notes -> use `docs/IMPORT_WORKFLOW.md`
- deep parity procedure notes -> use `docs/PARITY_WORKFLOW.md`
