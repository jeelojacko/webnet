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
- run profile defaults to strict industry parity mode
- cluster detection defaults to OFF
- auto-adjust is available but operator-controlled
- the top toolbar now includes the only `Survey CAD` launcher beside `Project Options`; today it opens a dedicated full-page Survey CAD workspace that hides the input editor/results chrome while active, removes the duplicate results-area CAD tab, keeps the page trimmed to CAD toolbar plus model space, keeps that CAD shell visually flattened to one continuous dark-blue workspace instead of framed top/bottom bars, builds native CAD entities from current WebNet input or solved results, renders them through an internal SVG viewport, exposes native selection plus transaction-history seams (`Select All`, `Clear Selection`, `ERASE`, `Undo`, `Redo`), adds internal point-node / endpoint / midpoint / center / arc-midpoint / quadrant / intersection / apparent-intersection / extension / perpendicular / parallel / tangent / nearest snap feedback over the preview surface with a viewport `Snaps` drop-up toggle menu, now includes arc endpoints, nearest-on-curve, line-arc intersections, arc-arc intersections, command-context construction snaps for extension/perpendicular/parallel, visible-arc tangent snaps from the active base point, and apparent intersections for line-line, infinite-line-to-visible-arc, and full-circle arc-arc crossings whose visible sweeps do not actually meet, all inside that same native snap engine, supports typed/snap-driven `POINT`, `COGO PT`, `LINE`, `PLINE`, `TRAVERSE`, split-button `ARC` creation modes (`3 Point`, `Start Center End`, `Start Center Angle`, `Start Center Length`, `Start End Angle`, `Start End Direction`, `Start End Radius`, `Center Start` aliases, `Tangent Curve`, `Continue Curve`), `INVERSE`, `MOVE`, `COPY`, `PASTE`, selection-driven `INTX`, and selection-driven `PARCEL` promotion workflows with coordinate, azimuth-distance, survey bearing-distance, tangent-curve radius entry, and `Ctrl` reverse-direction arc input plus inverse bearing readout, keeps the page chrome fully inside the browser viewport, uses direct CAD-style viewport interaction (click-select, left-to-right window selection, right-to-left crossing selection, wheel zoom, middle-mouse pan, middle-double-click zoom extents), paints live in-progress preview geometry for draw/move/copy/curve commands, keeps selection-only changes out of the undo/redo stack, keeps cursor picks aligned with the visible viewport even when the SVG is letterboxed, overlays command status in the lower-left plus the active command text input at bottom-center, shows a small live viewport `Ctrl = Flip Arc` hint while flip-capable arc commands are active, shows a small live base-point construction hint while construction/tangent snaps are armed from a captured point, removes the old generic idle helper sentence from the lower-left viewport, routes active command typing into the overlay command bar without requiring an input click first, keeps keyboard undo/redo active even after toolbar-button-driven viewport draws, uses keyboard paste as a real insertion-point workflow instead of a fixed offset duplicate, avoids surprise auto-reframe after normal entity edits, uses intentionally widened point/line/ellipse hit targets so selection is less fussy than the visible stroke alone, renders arcs as true SVG arc paths instead of blocky sampled line strips, now renders `TRAVERSE` segment annotations as north-azimuth-over-distance labels aligned to the segment itself while auto-flipping them upright instead of upside down, derives native arc labels from the actual curve geometry (delta, radius, arc length) instead of persisted text entities, keeps center-driven and reverse-sweep arc modes faithful to the operator-picked center/start/end points even on clockwise or major-arc cases, keeps `Continue Curve` tangent continuity consistent for both clockwise and counterclockwise source arcs, rejects `Start Center End` arc commits when the supplied endpoint is off the chosen center radius instead of silently shifting the curve, omits anchored point text labels for traverse-created parcel/traverse stations, shows parcel center labels as stacked horizontal area/perimeter text using `m²`, shows a selected-parcel closure report overlay with area/perimeter/closure values plus ordered course azimuth-distance rows derived from parcel geometry, and persists its Survey CAD project snapshot through WebNet project files, manifest bundles, and local recovery when the underlying source-signature still matches, without yet installing GPL-touched DWG viewer packages into core WebNet
- `Run Comparison` and `Review Queue` workspace panels now default to hidden and can be re-enabled from `Project Options -> General`
- the active startup dataset is currently rotated to the Camp Design preanalysis case, including the committed planning-network fixture loaded directly into the editor, the matching Camp Design project default plus `S9`/`SX12` instrument library from the reference settings, and the UTM83-19 grid startup defaults with positive-west longitude convention, preanalysis run mode, and slope/zenith reduction with refraction `k=0.07`
- the active startup dataset may be rotated to the current industry-parity working case during parity-sensitive batches
- browser-local recovery restores workspace state but intentionally does not restore stale solve results without rerun

## Supported input model

### Named-project multi-file runs
Current named-project behavior includes:
- the Input Data `Project Files` button remains available even before a named project exists and can bootstrap a named local project from the current untitled workspace
- the toolbar folder/open-project entry opens the Project Options workspace tab directly so local project create/open actions always land in the same `Project Files` workflow surface
- checked project files define the run set
- open tabs define the editor workspace
- one focused tab drives the visible editor text
- checked project files run in manifest order as one shared adjustment
- parser defaults reset at each checked project-file boundary while alias definitions and accumulated network state carry forward across files
- `.INCLUDE` remains valid inside checked project files, and duplicate project-file includes are warned and skipped
- open editor tabs preserve their own tab-strip order even if the underlying project-file manifest order is rearranged for run sequencing
- the Input Data `Project Files` popover now exposes quick `Add Source`, `New File`, per-file `Open`/`Edit`/`Duplicate`/`Remove`, and a direct `Project Options` jump so common project-file actions no longer depend on the right-click menu or toolbar detour

For the exact ordered run contract, see `docs/run-semantics.md`.

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
- leveling-weight precedence is deterministic: explicit inline sigma token first, then active inline/project `.LWEIGHT`, then the instrument differential-level `mm/km` model as a fallback
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
- explicit run-state freshness strip (`Ready`, `Dirty`, `Running`, `Result stale`, `Reviewing`) plus blocking-reason badges near the main run workflow
- standardized residual tables with source-line traceability
- residual diagnostic summaries by severity and family
- what-if suspect impact scoring with one-click exclude and rerun flows
- preanalysis planning recommendations now work as weak-geometry-driven added setup-set, brace-point, promoted-setup, synthetic-setup, and cross-tie trials rather than single-observation remove/add-back toggles; the report surfaces the top recommendation scenarios, supports one-click synthetic scenario apply+rerun, and can build a greedy threshold plan against an optional worst-station semi-major target with a max-added-set cap
- preanalysis recommendation ranking is now path-aware instead of family-biased: the planner traces each weak station back toward fixed control through connected-pair precision bottlenecks, targets the current worst station and its largest path bottleneck first, and only then uses broader network metrics as tie-breakers
- the bounded preanalysis recommendation solve pool now spends its expensive re-solves on scenarios that touch the current worst station's path back to control first, especially the active bottleneck pair and adjacent corridor stations, while keeping deterministic tie-break ordering once path impact is exhausted
- preanalysis recommendations now also emit non-additive transform actions alongside applyable additive scenarios: bypassing weak intermediate hops with direct ties, decommissioning only removable free intermediates that stay connected once the bypass is added, and moving synthetic geometry toward the active bottleneck corridor; these transform rows can now be applied from the report like additive rows, but they still stay outside the additive-only threshold planner
- move-synthetic advisories are now state-aware: when a planner-generated synthetic brace/setup is already active, the planner can recommend relocating that active synthetic geometry to a stronger current bottleneck corridor instead of only listing generic alternate synthetic candidates
- when multiple control paths are equally weak, preanalysis now resolves the canonical anchor path deterministically by bottleneck, total path weakness, hop count, and finally lexical station order so repeated reruns keep the same path rationale unless the network metrics actually change
- applying a synthetic preanalysis scenario now feeds the appended planned observations back through the shared solve pipeline instead of only updating run-state metadata, so observation counts, recommendation deltas, and projected worst-major metrics respond to the active added scenarios
- preanalysis planning scenarios now publish preview geometry; the 2D map renders proposed and applied synthetic points as pink overlay markers and draws preview sight lines / cross-ties so operators can see the suggested geometry before editing the plan text
- preanalysis planning can now consume a persistent planning-map state with OSM basemap toggle, raw input-point layer, OSM-derived obstacle footprints for georeferenced runs, and user-drawn blocked polygons that feed directly into obstacle-aware candidate rejection
- the 2D OSM basemap now renders on a WebGL2-first background layer with per-tile mesh warping sampled in Web Mercator space, adaptive mesh density by on-screen tile size, texture-backed parent fallback coverage, and no blanking once nearby tile coverage has been loaded; stations, labels, polygons, and tool affordances remain on the existing SVG interaction layer
- the 2D map renderer now prefers one WebGL canvas for the basemap plus non-selected static geometry, while automatically falling back to the prior layered basemap/geometry canvases when WebGL2 is unavailable or initialization fails
- OSM tile lifecycle is now handled by an internal imperative cache with `requested / loaded / uploaded / visible / evictable` state, so tile arrivals no longer force broad React rerenders and the map keeps valid basemap coverage more reliably during pan/zoom
- the WebGL basemap renderer now caches warped tile mesh GPU buffers per tile signature instead of re-uploading the same warped tile vertices every draw, and it also uses a coarser interaction-time tile zoom plus lighter interaction mesh density to keep OSM-on pans and zooms closer to the no-basemap path
- the 2D render surface is now aspect-locked with a cover-fit inside the `Map & Ellipses` pane instead of stretching or letterboxing to the container bounds, so collapsing the input sidebar or changing the workspace width no longer distorts survey geometry and no longer leaves empty side/top/bottom bars around the live map
- the `Map & Ellipses` pane now drops the left/right chrome borders around the live map surface while keeping the top/bottom pane separators, which preserves more horizontal map real estate without changing the internal survey geometry frame
- default 2D survey symbols now use a consistent bright orange center plus vivid blue border across zoom levels, with blue-accent linework/ellipses so points and linework stay readable over the basemap instead of washing out against beige or white map content
- zoomed-in 2D point radii, line widths, marker sizes, and ellipse strokes now follow a screen-visibility-first scale instead of shrinking toward sub-pixel widths, so geometry stays legible at higher zoom levels while preserving the same projected coordinates
- the non-selected geometry renderers now add a light survey halo behind points and survey lines in both WebGL and canvas paths, which improves contrast against imagery without changing selection semantics or map coordinates
- synthetic brace/setup preview point IDs are now allocated as clean `B-#` and `P-#` names instead of long generated tokens, so recommendation overlays and active synthetic stations stay readable in the map and report surfaces
- synthetic brace/setup labels now obey the shared `Show labels` toggle and render in the same top label pass as normal station labels, so turning labels off hides both together and turning them on keeps all labels above polygons and preview geometry
- the WebGL path keeps pan/zoom and SVG overlays synchronized by applying the same view transform in shader uniforms rather than rebuilding projected geometry on every interaction frame, while the fallback layered-canvas path remains layout-synced for unsupported environments
- the 2D map now also uses a dedicated planning-overlay canvas for non-selected blocked/obstacle polygon bodies plus raw input-point markers, which removes those high-count bodies from the SVG hot path while keeping selected outlines, edit handles, and labels in SVG
- that planning-overlay canvas now renders in both `WebGL2` and canvas-fallback sessions, so non-selected obstacles remain visible even when the background/static-geometry layer is using WebGL
- the 2D draw and hit-test stack now consistently prioritizes station labels/points first, then selected or unselected lines, then non-selected planning polygons, then the basemap; clicks on points/lines therefore win over polygon hits, and selected points/lines use a stronger gold-plus-cyan highlight so active picks remain obvious over OSM content
- when the planning map is opened before the first solve via `Load points`, map-origin point/line selections now persist instead of being cleared immediately by the no-result workspace review path
- the OSM-backed planning path now keeps point and line symbol sizing screen-consistent in the WebGL renderer, continues to render point labels with the basemap on, and fetches obstacle polygons from the loaded planning extent without requiring the OSM basemap toggle itself to trigger the request
- planning-polygon click and right-click selection now use geometry hit-testing in map space instead of relying on SVG polygon DOM targets, so obstacle cleanup/edit workflows still work even though most polygon bodies no longer render as SVG elements
- internal map-performance coverage now includes an opt-in Camp Design profiling harness that runs feature-toggle matrices plus scripted pan/zoom sweeps against the real `MapView` stack, with process-level counters/timings for derived-state, hit-index, SVG, tile, canvas, and WebGL paths
- the planning map now shows the proper OpenStreetMap attribution overlay (`© OpenStreetMap contributors`) when the OSM basemap toggle is on
- the 2D map now shows a small renderer status badge in the lower-left corner so operators can confirm whether the current session is using `WebGL2` or the canvas fallback path
- during active 2D interaction, the live pan/zoom transform now updates immediately while the heavier visibility-density derivation work trails through a deferred view state, which reduces recompute churn without changing the underlying survey geometry or settled placement
- 2D map derivation now caches base projected survey geometry separately, culls the current viewport in that base projected space first, applies selection/minor-geometry filtering there where possible, and only then applies the deferred pan/zoom transform to the surviving subset; this keeps dense Camp-style zoom/pan sweeps from retransforming the full network each frame
- the internal Camp Design profiling harness now reports the staged 2D derived-state passes separately instead of one monolithic `map:build-derived-state` block, so follow-up tuning can distinguish viewport culling, base-space filtering, label work, and interaction-density work from the remaining `svg:render` cost
- the 2D SVG interaction layer now splits its world-content into memoized label, planning, selection, and transformed-overlay sections behind cheap `view2d` transform shells, so live pan/zoom updates no longer have to rebuild the full SVG subtree when only the camera motion changed
- during active 2D pan/zoom, non-selected labels and planning polygon bodies now stay on their last settled snapshot until the interaction settles, while the transform shell, selected geometry, edit handles, and map hit-testing remain live and exact
- live drag motion in the map now coalesces raw `mousemove` bursts to one applied drag step per animation frame before updating 2D pan or 3D camera motion, which reduces interaction churn during fast pans/orbits without changing final camera placement
- live 2D pan/zoom still updates immediately inside the map, but the persisted `MapViewSnapshot` is now held at the last idle view until interaction settles; this keeps `Map & Ellipses` state restorable without forcing app-shell snapshot churn on every drag or wheel frame
- active middle-drag 2D panning now previews motion by translating a shared render-surface wrapper as one slab while the drag-start derived viewport/culling basis stays frozen, it measures the drag in raw client pixels instead of transformed SVG coordinates, and it commits the actual pan once the drag ends; this avoids the real-browser feedback loop where the moving SVG frame distorted pan deltas and could cancel/ghost the drag
- during active OSM-backed pan/zoom, the map now keeps the last settled basemap descriptor set active and reuses the already resolved tiles instead of re-walking the tile store on every interaction frame; exact tile requests and descriptor swaps resume once interaction settles so motion stays lighter while the view remains survey-true
- during active OSM-backed wheel zoom, descriptor refresh now advances only when the view crosses a tile-meaningful zoom/count bucket, and unchanged buckets reuse resolved tile surfaces from a descriptor-signature cache instead of recomputing full basemap coverage on every wheel delta
- during active OSM-backed zoom, the basemap descriptor builder now enforces a smaller interaction-time tile budget and lighter mesh density before WebGL draw submission, so fast zoom gestures request and draw fewer tiles/triangles than the settled idle view
- after a short idle pause in 2D OSM mode, the map now warms one wider off-screen basemap ring in memory when the tile store is otherwise quiet, keeps a larger tile-entry budget for revisits, and treats off-screen prefetch tile arrivals as cache-only events until they enter the visible ring; this makes pan-back revisits feel more like a warm map instead of a fresh fetch every time
- browser-only map interaction regressions can now be reproduced on the dedicated `map-pan-harness.html` Camp startup page and checked with `npm run test:map-browser`, which now includes both the middle-mouse pan regression and an OSM-on profiling matrix that runs fast/medium/slow pan sweeps, zoom sweeps, and overlay toggles against the live Chromium map stack
- during active OSM-backed interaction, tile-arrival-triggered redraws are now deferred until interaction settles, so in-flight network tile loads do not interrupt the compositor-style pan preview or force extra redraw churn mid-gesture
- the `Map & Ellipses` tab can now be opened before the first solve; operators can use `Load points` to parse the current editor/project inputs into a planning-only point layer, fetch OSM overlays, and draw/edit/delete blocked polygons before running preanalysis
- OSM obstacle fetches are now bounded to the measured-network extents plus a 100 m buffer, and input coordinate outliers that are not referenced by observations are excluded from that planning extent when possible
- planning obstacle editing now supports selecting either user blocks or OSM-derived polygons on the map, editing polygon vertices directly, and deleting the selected obstacle through the right-click context menu
- the map right-click `Inverse` and `Angles Between` tools now keep their text boxes truly editable, keep the dropdown and freeform text entry synchronized through station-id resolution, expose per-field `Pick` buttons for on-screen point capture, and highlight the currently involved points/legs directly on the map while the tool is open
- empty background click and `Escape` now clear current map selection state, and the 2D planning map supports a two-click box-selection workflow for selecting multiple obstacle polygons before deleting them
- the 2D planning box-selection overlay now renders in screen space so the drawn rectangle stays under the cursor, and once multiple obstacle polygons are selected a right-click anywhere on the map keeps that multi-selection active and opens the batch-delete context action instead of collapsing back to a single polygon
- directional obstacle box selection now matches CAD-style behavior: left-to-right boxes use `window` semantics and only select polygons fully enclosed by the box, while right-to-left boxes use `crossing` semantics and select polygons that touch or fall inside the box; the two directions render with different overlay colors
- 2D point and observation hit-testing now uses a lightweight screen-space bucket index before the final distance checks, which keeps map selection behavior the same while reducing full-array scans on dense views
- preanalysis planning now treats user blocks and building obstacles as hard no-shoot barriers, while wooded OSM polygons are treated as soft last-resort obstacles that are avoided first but can still be used if no feasible hard-clear candidate exists
- project-level suspect impact mode control (`AUTO` / `ON` / `OFF`); `AUTO` skips the extra re-solves once the main solve is already heavy
- robust-vs-classical suspect comparison when robust mode is enabled
- setup-level suspect metrics and ranking
- traverse, GPS loop, direction-repeatability, and leveling suspect tables
- synchronized report/map selection and review actions
- shared issue-driven review queue across import conflicts, suspect observations, cluster candidates, and compare diffs, with deterministic ordering and queue-to-report/map/source-line navigation
- queue filtering by severity/source/unresolved/imported-group and next-unresolved navigation
- safety confirmations for high-risk review/import actions, with explicit action scope in confirmation copy and inline disabled-reason hints on unavailable controls
- saved-run compare and baseline review workflows
- heavy jobs now defer full normal-equation covariance recovery until the final adjusted state; intermediate outer iterations solve only for the correction vector
- industry-standard propagated precision is the only live precision-reporting mode exposed in the app and project workflow

### Cluster and automatic review workflows
Current workflow behavior includes:
- cluster detection candidate review with approve/reject and retained-point selection
- dual-pass solving when approved merges are applied
- revert-cluster-merge workflow
- auto-adjust cycles with thresholds, limits, and deterministic tie-breaks
- auto-adjust now follows the same iterative exclusion contract in both direct engine solves and shared browser/CLI run-session solves, with diagnostics preserved on the final result payload
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
- the WebNet report now uses stronger progressive disclosure for heavy late-report sections: `Residual Diagnostics` downward, including lower-priority diagnostics, observation-family residual tables, and the final `Processing Log`, start collapsed and do not render their inner table/log content until opened
- `Direction Face Treatment Diagnostics` is hidden in preanalysis reports and, for regular adjustment runs, is rendered as a late collapsed diagnostics block immediately above `Processing Log`
- report table windowing now defaults to 25 rows per section instead of 100, and windowed sections expose both `Show more` and `Show all`
- `Data Check` and `Blunder Detect` runs now promote their mode-specific summary block to the top of the WebNet report and suppress the generic `Adjustment Summary` banner there
- when cluster detection or auto-adjust diagnostics are active in a normal adjustment run, those workflow sections are promoted above solve-profile, adjusted-coordinate, and lower-priority review tables so operator action items stay at the top
- solve-profile diagnostics near the summary surface
- deterministic section ordering and tie-break rules
- padded, readability-focused listing tables
- the Industry Standard Output tab now supports a right-click menu with `Go to section` (auto-detected heading jump list) and `Sort by` shortcuts that update persisted listing sort settings (`Point Name`, `Input Order`, `Residual`, `Std Error`, `Std Residual`)
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
- `Data Check` report mode now suppresses adjustment-derived sections that do not apply there, including adjusted-coordinate, residual-diagnostics, and observation-residual review tables
- `Data Check` now runs a bounded provisional coordinate-fit stage before computing final inverse-difference rows; direction rows reuse that provisional geometry only when it lands within a tight trust window, and otherwise fall back to reduced-direction internal consistency metrics so weak provisional geometry does not show false giant direction mismatches on coherent reduced field sets
- TS sideshot post-adjust coordinates now stay on the solved projected/grid azimuth basis for setup- and target-derived bearings, and they use occupied-station reduction factors plus curvature/refraction-aware zenith inversion so the combined-case `Chimney` and `Meridian` rows stay within low-millimeter parity of the stored industry output
- GNSS-oriented non-classic listings now also emit the stored-reference wrapper/empty sections ahead of the unadjusted summary (`Inline Option Usage Notes`, `Summary of Inconsistent Descriptions`, `Network Stations`, and `Sideshots`) so the top block more closely matches the industry file structure even when those sections are empty
- GNSS-only parity listings now also use a compact industry-style top block: they emit the `Project Folder and Data Files` wrapper, classic option rows (`Coordinate System`, `GPS Vector Standard Error Factors`, `GPS Vector Centering`, `GPS Vector Transformations`), suppress the generic instrument-default section, and restore the compact fixed/free-station plus GNSS vector unadjusted summary layout from the stored reference
- omission of processing-log lines from the industry-style listing output
- industry-style adjusted-observation sections always emit the full solved set; the old adjusted-observation row-limit control is no longer exposed in Project Options
- fixture-backed parity locks now include a small underground 2D reference case with two guards: key WebNet listing sections stay stable, and a mirrored industry-output fixture keeps adjusted coordinates, relative-confidence rows, and ellipse blocks numerically close to the actual industry result

### Precision reporting
Current results use one live precision-reporting model:
- industry-style outputs use unscaled propagated precision
- older project/saved-run payloads that carried legacy precision/profile selections are normalized back to the strict industry-parity defaults on load/save
- older project payloads that carried the retired legacy CRS-transform UI fields are normalized back to `crsTransformEnabled=false`, `crsProjectionModel=legacy-equirectangular`, and a blank `crsLabel` on load/save
- the WebNet processing summary and report diagnostics no longer show the retired legacy `CRS / Projection` block; active grid-scale and convergence diagnostics still remain in those outputs
- the WebNet report and processing-summary component prop contracts no longer carry the retired CRS-transform fields; those values remain only in engine/listing diagnostics where the parity-backed industry listing still uses them
- the shared WebNet `RunDiagnostics` contract no longer carries the retired CRS-transform trio; the parity-backed industry listing continues to source those values from parse state when it still needs to display them
- parser directive normalization now always uses the current unique-prefix matching contract, and unknown inline directives follow only the live strict-vs-legacy `parseCompatibilityMode` path; the retired override knobs for directive-abbreviation mode and unknown-directive policy are no longer carried in parse options
- `.VLEVEL` remains accepted as a compatibility directive and still logs the selected legacy mode, but the hidden `vLevelMode` / `vLevelNoneStdErrMeters` parse-state fields have been removed because they no longer drive any solve or report behavior

## Coordinate-system and GPS behavior

### CRS and reduction behavior
Current coordinate-system behavior includes:
- Local/Grid mode state
- CRS directives and optional labels, scale, and convergence inputs
- Canada-first CRS catalog support including NAD83(CSRS) UTM, MTM, and key provincial entries
- Priority 1 post-Phase-18 provincial expansion now includes Quebec MTQ Lambert (`CA_NAD83_CSRS_QC_LAMBERT`, EPSG:3799) plus Nova Scotia MTM 2010 zones 4/5 (`CA_NAD83_CSRS_NS_MTM_2010_4`, EPSG:8082 and `CA_NAD83_CSRS_NS_MTM_2010_5`, EPSG:8083), with canonical-id and EPSG-ID normalization through parser and CLI paths
- Phase 19 expansion now includes Saskatchewan ATS and Manitoba 3TM workflow IDs (`CA_NAD83_CSRS_SK_ATS`, `CA_NAD83_CSRS_MB_3TM`) plus Yukon/NWT TM workflow aliases (`CA_NAD83_CSRS_YT_TM`, `CA_NAD83_CSRS_NT_TM`), Nunavut projected alias mapped to EPSG:3977 (`CA_NAD83_CSRS_NU_STEREOGRAPHIC`), and Quebec municipal LCC compatibility coverage (`CA_NAD83_CSRS_QC_MUNICIPAL_LCC`, EPSG:6622); alias rows are explicitly documented where EPSG does not publish a distinct province/territory title
- Phase 19 Priority-4 CSRS closeout now adds six remaining cleaned-audit rows: Alberta 10-TM Forest (`CA_NAD83_CSRS_AB_10TM_FOREST`, EPSG:3402), Yukon Albers (`CA_NAD83_CSRS_YT_ALBERS`, EPSG:3579), NWT Lambert (`CA_NAD83_CSRS_NT_LAMBERT`, EPSG:3581), Canada Atlas Lambert (`CA_NAD83_CSRS_CA_ATLAS_LAMBERT`, EPSG:3979), Teranet Ontario Lambert (`CA_NAD83_CSRS_ON_TERANET_LAMBERT`, EPSG:5321), and Arctic zone 3-29 (`CA_NAD83_CSRS_ARCTIC_LCC_3_29`, EPSG:6103)
- the current Canada-first CRS catalog now contains 57 rows total (16 UTM, 17 MTM, 24 provincial), including all planned Phase 19 Priority 1-4 additions
- Phase 20 USA State Plane expansion now includes a unit-paired NAD83(2011) set with canonical IDs plus EPSG alias normalization for New York East/Central/West (`US_NAD83_2011_SPCS_NY_EAST`, `US_NAD83_2011_SPCS_NY_CENTRAL`, `US_NAD83_2011_SPCS_NY_WEST` + `*_FTUS`; EPSG:6536/6534/6540 and 6537/6535/6541), California zones 1-6 (`US_NAD83_2011_SPCS_CA_ZONE_1` through `US_NAD83_2011_SPCS_CA_ZONE_6` + `*_FTUS`; EPSG:6415/6417/6419/6421/6423/6425 and 6416/6418/6420/6422/6424/6426), Connecticut (`US_NAD83_2011_SPCS_CT` + `US_NAD83_2011_SPCS_CT_FTUS`; EPSG:6433/6434), Delaware (`US_NAD83_2011_SPCS_DE` + `US_NAD83_2011_SPCS_DE_FTUS`; EPSG:6435/6436), Pennsylvania North/South (`US_NAD83_2011_SPCS_PA_NORTH`, `US_NAD83_2011_SPCS_PA_SOUTH` + `*_FTUS`; EPSG:6562/6564 and 6563/6565), Texas North/North Central/Central/South Central/South (`US_NAD83_2011_SPCS_TX_NORTH`, `US_NAD83_2011_SPCS_TX_NORTH_CENTRAL`, `US_NAD83_2011_SPCS_TX_CENTRAL`, `US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL`, `US_NAD83_2011_SPCS_TX_SOUTH` + `*_FTUS`; EPSG:6581/6583/6577/6587/6585 and 6582/6584/6578/6588/6586), Florida East/North/West (`US_NAD83_2011_SPCS_FL_EAST`, `US_NAD83_2011_SPCS_FL_NORTH`, `US_NAD83_2011_SPCS_FL_WEST` + `*_FTUS`; EPSG:6437/6440/6442 and 6438/6441/6443), Georgia East/West (`US_NAD83_2011_SPCS_GA_EAST`, `US_NAD83_2011_SPCS_GA_WEST` + `*_FTUS`; EPSG:6444/6446 and 6445/6447), North Carolina statewide (`US_NAD83_2011_SPCS_NC` + `US_NAD83_2011_SPCS_NC_FTUS`; EPSG:6542/6543), Alabama East/West (`US_NAD83_2011_SPCS_AL_EAST`, `US_NAD83_2011_SPCS_AL_WEST` + `*_FTUS`; EPSG:6355/6356 and 9748/9749), Tennessee statewide (`US_NAD83_2011_SPCS_TN` + `US_NAD83_2011_SPCS_TN_FTUS`; EPSG:6575/6576), Kentucky North/Single Zone/South (`US_NAD83_2011_SPCS_KY_NORTH`, `US_NAD83_2011_SPCS_KY_SINGLE_ZONE`, `US_NAD83_2011_SPCS_KY_SOUTH` + `*_FTUS`; EPSG:6470/6472/6474 and 6471/6473/6475), Kansas North/South (`US_NAD83_2011_SPCS_KS_NORTH`, `US_NAD83_2011_SPCS_KS_SOUTH` + `*_FTUS`; EPSG:6466/6468 and 6467/6469), Louisiana North/South (`US_NAD83_2011_SPCS_LA_NORTH`, `US_NAD83_2011_SPCS_LA_SOUTH` + `*_FTUS`; EPSG:6476/6478 and 6477/6479), Maine East/West (`US_NAD83_2011_SPCS_ME_EAST`, `US_NAD83_2011_SPCS_ME_WEST` + `*_FTUS`; EPSG:6483/6485 and 6484/6486), Maryland (`US_NAD83_2011_SPCS_MD` + `US_NAD83_2011_SPCS_MD_FTUS`; EPSG:6487/6488), Massachusetts Island/Mainland (`US_NAD83_2011_SPCS_MA_ISLAND`, `US_NAD83_2011_SPCS_MA_MAINLAND` + `*_FTUS`; EPSG:6489/6491 and 6490/6492), Minnesota North/Central/South (`US_NAD83_2011_SPCS_MN_NORTH`, `US_NAD83_2011_SPCS_MN_CENTRAL`, `US_NAD83_2011_SPCS_MN_SOUTH` + `*_FTUS`; EPSG:6502/6500/6504 and 6503/6501/6505), Illinois East/West (`US_NAD83_2011_SPCS_IL_EAST`, `US_NAD83_2011_SPCS_IL_WEST` + `*_FTUS`; EPSG:6454/6456 and 6455/6457), Indiana East/West (`US_NAD83_2011_SPCS_IN_EAST`, `US_NAD83_2011_SPCS_IN_WEST` + `*_FTUS`; EPSG:6458/6460 and 6459/6461), Mississippi East/TM/West (`US_NAD83_2011_SPCS_MS_EAST`, `US_NAD83_2011_SPCS_MS_TM`, `US_NAD83_2011_SPCS_MS_WEST` with ftUS companions for East/West; EPSG:6506/6508/6509 and 6507/6510), Missouri East/Central/West (`US_NAD83_2011_SPCS_MO_EAST`, `US_NAD83_2011_SPCS_MO_CENTRAL`, `US_NAD83_2011_SPCS_MO_WEST`; EPSG:6512/6511/6513), Nevada East/Central/West (`US_NAD83_2011_SPCS_NV_EAST`, `US_NAD83_2011_SPCS_NV_CENTRAL`, `US_NAD83_2011_SPCS_NV_WEST` + `*_FTUS`; EPSG:6520/6518/6522 and 6521/6519/6523), Nebraska (`US_NAD83_2011_SPCS_NE` + `US_NAD83_2011_SPCS_NE_FTUS`; EPSG:6516/6517), New Hampshire (`US_NAD83_2011_SPCS_NH` + `US_NAD83_2011_SPCS_NH_FTUS`; EPSG:6524/6525), New Jersey (`US_NAD83_2011_SPCS_NJ` + `US_NAD83_2011_SPCS_NJ_FTUS`; EPSG:6526/6527), New Mexico East/Central/West (`US_NAD83_2011_SPCS_NM_EAST`, `US_NAD83_2011_SPCS_NM_CENTRAL`, `US_NAD83_2011_SPCS_NM_WEST` + `*_FTUS`; EPSG:6530/6528/6532 and 6531/6529/6533), Ohio North/South (`US_NAD83_2011_SPCS_OH_NORTH`, `US_NAD83_2011_SPCS_OH_SOUTH` + `*_FTUS`; EPSG:6548/6550 and 6549/6551), Idaho East/Central/West (`US_NAD83_2011_SPCS_ID_EAST`, `US_NAD83_2011_SPCS_ID_CENTRAL`, `US_NAD83_2011_SPCS_ID_WEST` + `*_FTUS`; EPSG:6450/6448/6452 and 6451/6449/6453), Iowa North/South (`US_NAD83_2011_SPCS_IA_NORTH`, `US_NAD83_2011_SPCS_IA_SOUTH` + `*_FTUS`; EPSG:6462/6464 and 6463/6465), Arkansas North/South (`US_NAD83_2011_SPCS_AR_NORTH`, `US_NAD83_2011_SPCS_AR_SOUTH` + `*_FTUS`; EPSG:6410/6412 and 6411/6413), Oklahoma North/South (`US_NAD83_2011_SPCS_OK_NORTH`, `US_NAD83_2011_SPCS_OK_SOUTH` + `*_FTUS`; EPSG:6552/6554 and 6553/6555), Alaska zones 1-10 (`US_NAD83_2011_SPCS_AK_ZONE_1` through `US_NAD83_2011_SPCS_AK_ZONE_10`; EPSG:6394-6403), Arizona East/Central/West (`US_NAD83_2011_SPCS_AZ_EAST`, `US_NAD83_2011_SPCS_AZ_CENTRAL`, `US_NAD83_2011_SPCS_AZ_WEST` + `*_FTUS`; EPSG:6406/6404/6408 and 6407/6405/6409), Michigan North/Central/South (`US_NAD83_2011_SPCS_MI_NORTH`, `US_NAD83_2011_SPCS_MI_CENTRAL`, `US_NAD83_2011_SPCS_MI_SOUTH` + `*_FTUS`; EPSG:6495/6493/6498 and 6496/6494/6499), Montana (`US_NAD83_2011_SPCS_MT` + `US_NAD83_2011_SPCS_MT_FTUS`; EPSG:6514/6515), North Dakota North/South (`US_NAD83_2011_SPCS_ND_NORTH`, `US_NAD83_2011_SPCS_ND_SOUTH` + `*_FTUS`; EPSG:6544/6546 and 6545/6547), New York Long Island (`US_NAD83_2011_SPCS_NY_LONG_ISLAND` + `US_NAD83_2011_SPCS_NY_LONG_ISLAND_FTUS`; EPSG:6538/6539), Oregon North/South (`US_NAD83_2011_SPCS_OR_NORTH`, `US_NAD83_2011_SPCS_OR_SOUTH` + `*_FTUS`; EPSG:6558/6560 and 6559/6561), Puerto Rico and Virgin Islands (`US_NAD83_2011_SPCS_PR_VI`; EPSG:6566), Rhode Island (`US_NAD83_2011_SPCS_RI` + `US_NAD83_2011_SPCS_RI_FTUS`; EPSG:6567/6568), South Carolina (`US_NAD83_2011_SPCS_SC` + `US_NAD83_2011_SPCS_SC_FTUS`; EPSG:6569/6570), South Dakota North/South (`US_NAD83_2011_SPCS_SD_NORTH`, `US_NAD83_2011_SPCS_SD_SOUTH` + `*_FTUS`; EPSG:6571/6573 and 6572/6574), Vermont (`US_NAD83_2011_SPCS_VT` + `US_NAD83_2011_SPCS_VT_FTUS`; EPSG:6589/6590), Virginia North/South (`US_NAD83_2011_SPCS_VA_NORTH`, `US_NAD83_2011_SPCS_VA_SOUTH` + `*_FTUS`; EPSG:6592/6594 and 6593/6595), Washington North/South (`US_NAD83_2011_SPCS_WA_NORTH`, `US_NAD83_2011_SPCS_WA_SOUTH` + `*_FTUS`; EPSG:6596/6598 and 6597/6599), West Virginia North/South (`US_NAD83_2011_SPCS_WV_NORTH`, `US_NAD83_2011_SPCS_WV_SOUTH` + `*_FTUS`; EPSG:6600/6602 and 6601/6603), Wisconsin North/Central/South (`US_NAD83_2011_SPCS_WI_NORTH`, `US_NAD83_2011_SPCS_WI_CENTRAL`, `US_NAD83_2011_SPCS_WI_SOUTH` + `*_FTUS`; EPSG:6606/6604/6608 and 6607/6605/6609), Wyoming East/East Central/West Central/West (`US_NAD83_2011_SPCS_WY_EAST`, `US_NAD83_2011_SPCS_WY_EAST_CENTRAL`, `US_NAD83_2011_SPCS_WY_WEST_CENTRAL`, `US_NAD83_2011_SPCS_WY_WEST` + `*_FTUS`; EPSG:6611/6613/6617/6615 and 6612/6614/6618/6616), Utah North/Central/South (`US_NAD83_2011_SPCS_UT_NORTH`, `US_NAD83_2011_SPCS_UT_CENTRAL`, `US_NAD83_2011_SPCS_UT_SOUTH` + `*_FTUS`; EPSG:6620/6619/6621 and 6626/6625/6627), and Colorado North/Central/South (`US_NAD83_2011_SPCS_CO_NORTH`, `US_NAD83_2011_SPCS_CO_CENTRAL`, `US_NAD83_2011_SPCS_CO_SOUTH` + `*_FTUS`; EPSG:6429/6427/6431 and 6430/6428/6432)
- when `CRS Catalog Group` is `us-spcs`, the CRS picker now filters rows by project units (`Units = m` shows meter rows only, `Units = ft` shows ftUS rows only) and keeps selection deterministic by switching to the same-zone companion row when available
- combined CRS catalog coverage is now 280 rows total: 57 Canada-first rows (16 UTM, 17 MTM, 24 provincial) plus 223 USA State Plane rows (`us-spcs`)
- a synthetic Canadian CRS validation harness that now pins Canadian UTM rows to explicit current EPSG realization codes, includes Alberta 3TM realization-backed provincial rows, audits the current Canada-first CRS support surface through catalog metadata checks and external `proj4` round-trip comparisons, and runs deterministic projected end-to-end synthetic adjustment smoke tests plus representative noisy Monte Carlo checks across UTM, MTM, and province-specific Canadian CRSs
- the synthetic harness now explicitly includes Priority 1 post-Phase-18 CRS stress checks (Quebec MTQ Lambert plus Nova Scotia MTM 2010 zones 4/5) for edge-of-area jobs, noisy Monte Carlo bounds, perfect-mode near-zero drift assertions, and grouped markdown/machine-summary ordering
- CRS-ID normalization accepting canonical IDs and EPSG aliases
- projection-family-aware factor computation with numerical fallback diagnostics
- reduction-context-driven measured/grid behavior
- pre-solve gates for incompatible local/grid/geodetic mixes and unconfirmed GNSS frames
- datum hard-fail and soft-warn diagnostics where appropriate
- synthetic 3D CRS harness jobs now use paired `DV` slope+zenith records for grid-mode shots so shared HI/HT metadata stays attached to both observation components instead of relying on standalone `V` rows that do not carry HI/HT through the current parser contract

### Geoid and grid behavior
Current geoid behavior includes:
- optional geoid model controls and height-datum conversion controls
- external GTX/BYN loading through parser/CLI and browser workflows
- project save/open round-trips for browser-loaded geoid/grid sources, including portable project export/import and named local project reopen
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
- GNSS-only app runs in the live strict industry-parity profile still take the compact GNSS listing path even when the project/default instrument library is populated, instead of falling back to the broader classic listing branch that hid the GPS vector sections behind zero-count conventional headings
- the industry listing header now prefers the solved result's parse-state vertical deflection over any stale external diagnostics snapshot, so live GNSS output panes show the actual run's `N/E` deflection values instead of falling back to `0.000 / 0.000` when diagnostics lag behind
- GNSS adjustment statistical summaries/listings now count covariance-vector observations by scalar equations (`GPS Deltas`) for observation/unknown totals, matching the industry `45`-equation contract for the parity fixture even though the solve still stores `15` GNSS vector records internally
- the GNSS solve/listing parity gap is now much smaller: the local-frame `.GPS FACTOR` fix collapses the remaining station-height drift to roughly `0.00005 m` worst-case against the stored reference and moves the listing summary from the earlier `42.709 / 1.258` down to `40.853 / 1.230` versus the stored industry `40.545 / 1.225`; the remaining delta appears concentrated in the last GNSS summary/precision statistics rather than in solved station geometry
- mixed conventional/leveling jobs now keep access to the selected project default instrument for default-weighted `L` records even after later inline `.INST` changes, so differential-level `mm/km` weighting still applies when the active TS instrument has no level model
- differential-level observations no longer add `vertCentr_m` into the solve weighting sigma, which brings the mixed combined-case `Level Data`, `Zeniths`, `GPS Deltas`, and total statistical-summary rows back into near-reference agreement while preserving the leveling-only exact listing lock
- industry-style directive selections for `.ELLIPSE`, `.REL /CON`, and `.PTOL /CON` are now functional instead of compatibility no-ops: station ellipse sections honor the selected station list while retaining fixed zero-control rows, relative bearing-distance and relative-ellipse sections expand the requested exhaustive pairwise station connections even when those pairs were not directly observed, and enabled positional-tolerance project settings now drive a dedicated pass/fail listing section for `.PTOL`-selected pairs
- the industry-style `Relative Error Ellipses` error-propagation block now also prints `RLA(2D)` and `PPM`, computed from adjusted horizontal line length divided by the printed 95% semi-major axis so operators can read relative line accuracy directly as `1:____` alongside the ellipse axes
- project options now expose positional-tolerance checking controls (enable, constant mm, PPM, confidence percent) in the `Special` tab, and those settings flow through shared run-session/direct solve paths into the listing/report output

## Import and interoperability behavior
Current import behavior includes:
- generic importer registry and normalized imported-data model
- first-party importers for OPUS/OPUS-RS, JobXML, industry-style survey-report HTML, FieldGenius raw, Carlson/TDS RW5-style raw, and DBX text/XML exports
- staged import-review modal before editor mutation
- setup-aware grouping and output-style presets
- opt-in JobXML `Industry Style` review output that locks the prompt into a fixed raw-fieldbook mode, defaults staged review to exclude `MTA` rows, preserves raw horizontal-circle values, corrected slope distances, raw zenith values, JobXML point codes, and exact HI/HT provenance, and emits round-grouped `DB/DN/DM/DE` blocks for direct-reading direction-set imports while leaving the generic WebNet and TS-direction-set presets unchanged
- angle-mode and 2D conversion controls during import review
- richer compare and reconcile workflows across multiple external sources
- conflict detection against the current editor and deterministic conflict-resolution choices
- staged-review apply actions for replacing editor text, importing the resolved text as a new project `.dat` file, and importing associated `.wnproj*` / `.snproj` settings into the current workspace without replacing the project file manifest
- associated `.wnproj*` / `.snproj` selection during staged import review now stages a prepared settings payload instead of applying immediately; the staged settings survive review-draft restore, show pending status in the modal, and apply only after the reviewed text import succeeds
- persistence of import-review and reconciliation state through local draft recovery

For detailed import behavior, see `docs/IMPORT_WORKFLOW.md`.

## Workspace, performance, and delivery behavior

### Persistence and saved work
Current workspace behavior includes:
- a dedicated `Survey CAD` workspace page that can be opened before any solve; it currently acts as the durable entry seam for the live native-model preview, persisted CAD workspace snapshot workflow, selection/undo command-history workflow, snap-toggle workflow, typed command-input workflow (`POINT`, `COGO PT`, `LINE`, `PLINE`, `TRAVERSE`, split-button `ARC` modes, `INVERSE`, `MOVE`, `COPY`, `PASTE`, `INTX`, selection-driven `PARCEL`), overlay command-bar workflow inside the viewport itself, direct viewport interaction (`click select`, directional drag-box selection, wheel zoom, middle-mouse pan, middle-double-click zoom extents, click-to-draw line creation, live command previews, Enter/Escape command flow, keyboard-first active command entry, keyboard copy/paste with insertion-point paste, selection excluded from undo history, stable no-surprise camera framing after edits, widened point/line/ellipse hit targets, true arc-path rendering, `Ctrl` reverse-direction arc modifiers), survey-style `TRAVERSE` segment annotation layout, geometry-derived arc labeling, and selected-parcel closure reporting
- named local browser projects backed by OPFS when available, with IndexedDB used for the recent-project catalog and as the file-content fallback store
- local project reopen flows work across both IndexedDB-backed and OPFS-backed named projects, and reopening refreshes recent-project ordering by last-opened time
- manifest-first `webnet-project` v5 storage with stable source-file IDs, one main editor file, managed non-main source members, and project-scoped autosave for sources/settings/UI state
- coordinate-system parse settings now reopen from both portable and named local projects with explicit grid-mode fields taking precedence over legacy `observationMode` when both are present
- reopening a project with a saved provincial or other non-visible CRS now retargets the CRS catalog filter to that CRS's catalog group instead of silently replacing the loaded CRS with the first entry from a stale filter group
- portable v5 workspace round-trips keep file contents tied to stable source-file IDs so non-main focused tabs restore the correct editor content and companion files on load/import
- workspace and portable/named-project UI state now also persist planning-map controls and polygons, including basemap mode, input/obstacle layer toggles, scenario-family toggles, user blocked polygons, and cached OSM obstacle footprints
- stale autosave completions do not overwrite newer project-file checked/open/focused edits; newer live workspace state stays authoritative until its own save completes
- project-files popup shows explicit `main`/`open`/`active`/unchecked markers and limits drag-reorder starts to the grip handle so checkbox toggles stay more stable under quick edits
- named-project autosave waits one minute after the latest dirty edit before persisting, instead of re-saving on sub-second edit churn
- plain `.dat` imports in a named project append as new source files, strip the `.dat` suffix from the imported file label, and support multi-select append in one action
- portable `.wnproj` export/import as flattened snapshots plus zipped manifest-plus-sources bundle export/import for backup/share workflows
- browser-local recovery for untitled workspaces only, keeping named-project autosave separate from local draft recovery
- saved-run snapshots with restore, compare, rename, note, and delete flows
- preservation of last successful results during reruns

### Performance and scalability
Current delivered performance architecture includes:
- worker-backed solve execution in the browser
- worker solve status now reports elapsed time, active run-session stage, solve-count progress, and per-solve iteration progress in the toolbar so long traverse/parity jobs no longer look frozen
- shared run-session orchestration for browser and CLI solve flows
- shared run-session workflows may perform multiple full re-solves after the main adjustment for suspect-impact, preanalysis-impact, robust-comparison, or auto-adjust diagnostics; long traverse cases can therefore spend minutes in `Solving` even when a single engine solve is only tens of seconds
- lazy-loaded heavy result views and modal bodies
- the first successful solve now keeps the report tab hot immediately, while `Processing Summary`, `Industry Standard Output`, and `Map` hydrate progressively on idle or first open instead of all mounting in one eager burst
- heavy-tab prewarm is now staged and cancellable: only one deferred tab preload runs at a time, and pointer/keyboard/wheel interaction cancels the remaining queue so first post-solve clicks stay responsive
- QA-derived review/map models are no longer built synchronously in the urgent result handoff path; the app commits the core result first, then computes the QA-derived model in deferred transition-backed state
- local report state with filter and windowing behavior
- processing-summary text generation is now cached by result identity plus a narrow diagnostics key so unrelated rerenders do not rebuild the full summary text block
- map view now skips fallback observation-link rebuilding when a QA-derived result is already available, reducing duplicate first-open selector work
- dense-map review guards, including a persisted `standard` vs `dense-review` declutter preset and quick toggles for labels/minor geometry/non-selected focus
- 2D map rendering now uses a hybrid pipeline: canvas-backed non-selected dense geometry plus SVG overlays for selection, labels, and tools, so large networks reduce SVG remount pressure during navigation
- the OSM planning basemap now renders in the same 2D canvas background layer instead of the SVG overlay, which keeps tile stitching aligned while leaving station/line/polygon/tool interactivity on the existing SVG layer
- dense 2D interaction automatically enters a temporary simplify mode while panning/zooming (reduced labels + suppressed non-selected ellipses), then restores full detail after interaction settles
- after wheel/pan stop, 2D map rendering performs an automatic crisp settle redraw (full device-pixel-ratio pass) so users do not need an extra pan/zoom nudge to clear blur
- map-review navigation state (pan/zoom/camera/tool toggles) now persists through report/map tab switches for the active solve result
- dev builds now capture app-side post-solve UI timing snapshots in memory/global debug state, including worker-success handoff, urgent result commit, deferred QA-model build, tab-ready milestones, first tab-click latency, hydration states, and optional browser long-task entries
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
- a dedicated synthetic Canadian CRS harness gate that remains separate from the industry-reference parity gate (`harness:crs:synthetic` vs `parity:industry-reference`)
- a committed four-case industry-example fixture set sourced from local `manual/` inputs/outputs and mirrored into `tests/fixtures/`
- normalized exact-text parity helpers that ignore only volatile header values (software version, run date, project folder, and data-file path lines)
- fixture-locked listing-format and error-propagation coverage
- exact levelling-only industry-listing parity from `Project Option Settings` through the file end for the active leveling reference case
- active traverse startup defaults and parser regression locks for `.INST`-scoped instrument selection across direction-set/traverse blocks
- slot-preserving mixed sigma parsing for traverse direction-set `DM` rows, so tokens such as `& & 30` apply default direction and distance weighting while keeping only the zenith sigma explicit
- compact STAR*NET shorthand tokens are accepted in the same slot-preserving parser path, so packed markers such as `!!*` and `&&*` expand across control and sigma slots without changing the older spaced-token behavior
- traverse direction-set reductions and paired `DM` distance/zenith rows now share one global observation-ID stream and preserve the active set ID, which keeps set-scoped diagnostics and review selection deterministic on the traverse parity case
- derived grid lat/lon and projection factors for projected traverse stations are recomputed from the live adjusted coordinates unless the station came from explicit geodetic input, preventing stale factor reuse on the traverse parity case
- the active traverse parity startup now uses the CSRS New Brunswick double-stereographic CRS under the industry `NewBrunswick83` label, with the retained classic listing calibration derived from an isolated display-only legacy NB formula instead of a second catalog CRS
- the active traverse parity startup now runs with curvature/refraction enabled (`verticalReduction='curvref'`, `k=0.07`) using the same coefficient convention as the industry reference output, which brings the traverse zenith summary into parity range
- the active Camp Design preanalysis startup now loads the committed `Traverse_Only` planning input and treats blank `DB`/`DM` direction-set slots as planned observations synthesized from the approximate station geometry, including local planned directions plus paired slope-distance and zenith rows in slope/zenith mode
- preanalysis project options now expose `Preanalysis Accuracy Threshold` and `Preanalysis Max Added Sets` only while `Run Mode = Preanalysis`; the threshold field now defaults to `0.001 m` (1 mm), and the threshold planner now combines repeated setup-set templates already present in the plan with obstacle-aware synthetic brace-point, promoted-setup, synthetic-setup, and cross-tie scenarios while still avoiding blocked or implausible placements
- preanalysis recommendations now rank additive scenarios lexicographically instead of by opaque family weight: first by improvement to the current worst station, then by reduction of the largest control-path bottleneck and total path weakness for that station, then by improvements to the remaining weak stations and network-wide tie-break metrics; additive families still compete in the same bounded pool, but only true impact can move them ahead of repeated existing-set trials
- the preanalysis threshold planner now remains additive-only even though the recommendation table can include one-click transform rows; when additive paths are exhausted it reports that only non-additive transform scenarios remain outside threshold planning instead of trying to auto-apply them greedily
- classic Camp-style preanalysis listings now follow the stored reference structure more closely: they restore the empty `Summary of Inconsistent Descriptions` wrapper, suppress adjustment-only sections such as `Adjustment Statistical Summary`, `Adjusted Coordinates`, `Control Component Status`, `Geodetic Position Summary`, convergence/grid-factor output, and `Weak Geometry Cues`, drop zero-valued vertical deflection header rows, rename the precision blocks back to `Station/Relative Error Ellipses`, and split entered stations into `Fixed`, `Partially Fixed`, `Free`, and `Unused` using the project coordinate order
- classic parity listings now center the top `Run Date` and `Summary of Files Used and Option Settings` headings instead of using the broader WebNet banner, and classic instrument blocks now emit only the active default plus project-library instruments that are actually referenced by observations in the solved dataset
- the active Camp startup case now carries a named virtual project/run-file context (`CAMP_DESIGN` / `Traverse_Only.dat`) into browser runs so classic preanalysis listings can emit the expected file metadata, and classic preanalysis output now restores the page breaks used by the stored Camp reference between the settings, inconsistent-description, and unadjusted-input sections
- control-record sigma/fixity parsing now preserves component slot alignment for mixed weighted/fixed control rows, so Camp-style entries such as `0.005 0.005 !` remain weighted in horizontal and fixed in height instead of collapsing to all-fixed control, while legacy 2D `C ... 0 !` / `C ... 0 ! !` dummy-height control rows still resolve as fully fixed planar control
- pre-solve traverse bootstrapping that can resect unknown direction-set setups from known targets and forward-seed connected target coordinates before adjustment
- traverse bootstrap seeding now preserves fixed or weighted control components on partially constrained stations, so imported `E`-only fixed-height control can still seed XY without overwriting the constrained height
- raw-mode imported direction sets keep strict unresolved mixed-face rejection for reduced handling, but they now fall back to legacy face-split raw emission instead of hard-failing when the active parity path explicitly requests raw direction rows
- weighted raw `DM` zenith rows now normalize face-2 readings to the face-1 equivalent before solve, while float zenith rows remain excluded from the main equation set so the committed Coldstream imported-file parity case preserves the reference counts and SEUW contract
- imported parity output now reprojects single-occupy float-zenith leaf stations from the solved occupy/orientation geometry plus the stored float zenith and HI/HT components before result packaging, which removes the remaining Coldstream `108` / `109` coordinate and bearing outliers without changing observation counts or the core solve residuals
- final covariance recovery now adds covariance-only synthetic float-zenith rows for skipped weak-leaf `DM` shots before precision propagation, which keeps the Coldstream `108` / `109` station and connected-pair uncertainty blocks close to the industry reference while leaving solve counts, residuals, and SEUW on the original main-equation path
- the committed Coldstream two-file + `.snproj` run-session regression now matches the reference imported parity case with `40` stations, `1048` total scalar observations, `411` directions, `409` distances, `1` az/bearing, `227` zeniths, SEUW near `0.5334`, and the expected weak `108` / `109` confidence magnitudes
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
