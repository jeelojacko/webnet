# WebNet Survey CAD TODO

- [x] Survey CAD naming fallback batch (June 2026): stop unlabeled arc/polyline/polygon hover and snap surfaces from leaking raw prefixed entity ids like `arc:*` or `polyline:*`, and keep the shared naming helper on readable type fallbacks instead.

- [x] Survey CAD COGO report panel batch (June 2026): add a selected/latest COGO result overlay in the native CAD workspace, bridge live `INVERSE` query output into the shared report model, and add exportable TXT/CSV/Markdown report previews for persisted computation history.

- [x] Survey CAD properties panel batch (June 2026): replace the selected/latest COGO popup with a selection-driven `Properties` panel, make it auto-close on empty selection, cover all current CAD entity families, and collapse mixed multi-selects back through the native single-select path.

- [x] Survey CAD properties editing + simple naming batch (June 2026): make logical `Properties` rows editable in place for entity names plus point/line/polyline geometry fields, add simple auto names like `PL#` / `TRAV#` / `CURVE#`, switch unnamed draft/traverse/polyline stations onto plain `CAD#` labels, and create labeled arc support points (`BC#`, `MP#`, `EC#`, `R#`) whenever native curve commands commit.

- [x] Survey CAD COGO foundation batch (June 2026): add shared COGO result/report/provenance types, project-level persisted COGO computation history, versioned CAD project migration, native alignment entity foundation, and command-history integration for existing COGO-producing commands.

- [x] Survey CAD stakeout rename-sync batch (June 2026): keep `STA PT` multiline stakeout labels synced when the created point is renamed from `Properties`, so the first-line station id updates without losing displayed station/offset text.

- [x] Survey CAD stakeout label selection batch (June 2026): make text labels pickable through the same widened CAD hit-target path as other entity types, then lock live `STA PT` / `STA INT` stakeout-label `Properties` selection coverage before broader alignment annotation polish continues.

- [x] Survey CAD stakeout label batch (June 2026): make `STA PT` / `STA INT` created point labels carry displayed-station text and make both the created points and picked stakeout labels surface shared alignment station/offset metadata in `Properties`, while leaving broader stakeout annotation polish for a later slice.

## COGO Expansion Checklist
- [x] COGO foundation batch: add shared `CadCogoResult`, report/warning/provenance types, persisted `cogoComputations`, migration coverage, and command-history integration.
- [x] COGO report panel batch: add selected/latest computation panel for inverse, intersections, curve results, traverse closure, parcels, and exportable TXT/CSV/Markdown output.
- [x] Core point-line batch: add multi-point inverse, bearing-only report, distance-only report, turned angle + distance, deflection angle + distance, point at distance/fraction along line, extend line, offset point, and command UI.
- [x] Intersection batch: add bearing-bearing, bearing-distance, distance-distance, line-circle, offset intersection, perpendicular intersection, and skew intersection with deterministic alternative selection.
- [x] Curve calculator batch: add full curve parameter solver, radial bearing, point on curve by arc/chord distance, curve subdivision, offset curve, PI-radius-delta, chord-bearing constructors, reverse/compound curve workflows.
- [x] Traverse editor batch: replace simple sequential `TRAVERSE` entry with table-style open/closed/point-to-point/sideshot editor, live geometry creation, closure report, editable leg rows, and row insert/reorder controls.
- [x] Traverse adjustment batch: add angular balance, compass/Bowditch, and transit rule as CAD-only draft-editor balancing tools with persisted adjustment reports, while leaving optional Crandall for a later pass.
- [x] Deed/batch COGO batch: add parser for pasted `START`, bearing-distance, and tangent-curve calls, preview rows, warnings, generated points/lines/arcs, and reproducible computation history.
- [ ] Alignment/stationing batch: add alignment entities from selected line/arc chains, station at point, station-offset point creation, point-to-station/offset projection, station equations, offset alignments, station interval points, and labels.
  Current slice: build alignment label refinements plus global CAD naming consistency on top of editable `Properties`, keep hover/snap labels on the same operator-facing naming contract as `Properties`, keep shared displayed-station formatting across labels/report rows, make `MOVE` / `COPY` carry arc/polyline/polygon/parcel/traverse-linked point sets with the parent geometry while leaving ordinary line moves as geometry-only, keep the repeatable Civil3D-style `FILLET` command beside `TRIM` but now force clicked-corner fillets onto the intended interior/minor sweep while also allowing radius `0` hard-corner cleanup across lines, polylines/traverses, and arcs, reject hook/sharp-angle arc survivors that would break tangency at the fillet join, force interior arc picks to stay on the hovered retained branch for both line and picked-polyline-segment fillets regardless of pick order, split line/polyline/arc extension into its own repeatable `EXT` source-then-boundary workflow instead of hiding it behind `Shift` inside `TRIM`, keep the viewport helper/status copy centered above the command bar so long prompts stay visible, and leave broader interval/stakeout annotation polish for the next slice.

- [x] Survey CAD trim pair-pick loop batch (June 2026): make repeatable native `TRIM` follow the same first-entity/second-entity loop as `FILLET`, keep the live survivor preview on the hovered second pick, and reset cleanly for the next trim pair after each commit or failed same-entity pick.

- [x] Survey CAD alignment command-copy batch (June 2026): replace raw `ALIGNMENT_*` status, validation, and committed-history copy on the CAD command surface with operator-facing `ALIGN`, `ALIGN OFF`, `STA`, `STA EQ`, `STA PT`, and `STA INT` wording.
- [x] Survey CAD stakeout-properties wording batch (June 2026): make `Properties` show readable stakeout-kind labels like `Station offset` and `Interval` instead of raw metadata slugs such as `station-offset`.
- [x] Survey CAD anchored-label naming batch (June 2026): give anchored point and stakeout text labels stable operator-facing `... label` names inside `Properties`, and keep those names synced when the source point is renamed.
- [x] Survey CAD parcel-from-lines batch (June 2026): let selection-driven `PARCEL` promote a closed chain of selected line entities into a native parcel with the same closure metrics, COGO provenance, and workspace/property/report behavior as the existing traverse/polyline parcel path.
- [x] Survey CAD parcel-area units batch (June 2026): add shared parcel area conversions and surface hectare/acre/square-foot readouts alongside the existing square-meter parcel metrics in the native parcel report/COGO workflow.
- [x] Survey CAD area-sequence batch (June 2026): add a report-only `AREA` command that captures a picked/typed point sequence, auto-closes the loop for parcel-style math, and reports area/perimeter/closure plus converted area units without creating parcel entities.
- [x] Survey CAD parcel-course table batch (June 2026): surface explicit parcel course bearing rows in the selected parcel overlay and persisted `PARCEL_CREATE` COGO report so parcel tables carry readable course-by-course line data beyond the summary metrics.
- [x] Survey CAD parcel-check batch (June 2026): add a report-only `PARCEL CHECK` action for selected linework that reports open ends, branches, overlaps, and closed-loop readiness before parcel creation.
- [x] Survey CAD parcel-split-line batch (June 2026): add a first `PARCEL SPLIT` workflow that uses one selected parcel plus one selected line segment to replace the parent parcel with two child parcels when the line crosses the boundary exactly twice.
- [x] Survey CAD parcel-overlap-report batch (June 2026): add a report-only parcel overlap action for multi-selected parcels that lists overlapping parcel pairs and their computed shared area before broader parcel gap/area-split tools.
- [x] Survey CAD parcel-gap-report batch (June 2026): add a report-only parcel gap action for multi-selected parcels that detects enclosed gaps between parcel loops and reports their computed area before broader bearing/area split tools.
- [x] Survey CAD parcel-split-bearing batch (June 2026): add a first `PARCEL SPLIT` bearing workflow for one selected parcel that captures a through point plus typed bearing and replaces the parent parcel when that bearing line crosses the boundary exactly twice.
- [x] Survey CAD parcel-split-area batch (June 2026): add a first `PARCEL SPLIT` area workflow for one selected parcel that captures a through point plus target area in square meters and replaces the parent parcel when a solved split line through that point can hit the requested child area.
- [x] Survey CAD parcel-layout toolbar batch (June 2026): add a dedicated parcel-layout panel with persistent sizing settings, automatic-layout settings, active-parent/frontage state, and preview controls so the remaining frontage-aware parcel tools share one native workflow surface.
- [x] Survey CAD parcel-slide-swing batch (June 2026): add first frontage-aware single-lot `Split by Slide` and `Split by Swing` workflows that solve one child parcel from a selected parent/frontage setup using minimum area plus basic frontage validation, with accept/reject preview and alternative cycling on the shared parcel command/history seam.
- [x] Survey CAD parcel-constraint solver batch (June 2026): extend parcel-layout solving with frontage-at-offset, minimum width, minimum depth, optional maximum depth, solution-preference scoring, and failed-rule highlighting/warnings while keeping all measurements normalized to internal metric units.
- [x] Survey CAD parcel-auto-layout batch (June 2026): add repeated frontage-aware parcel generation for one selected parent parcel, including preview-all vs step-through creation, automatic fill mode, deterministic parcel naming, and remainder handling options that can place leftover area in the last parcel, create a remainder parcel, or redistribute it.
  Current slice: replace the current frontage-strip fallback with a corner-aware auto solver that refuses criss-crossed lots, enforces optional max-depth, scores candidates toward realistic min area/frontage/width/depth targets, carries surviving chained frontage by geometry, trims adjoining strip runs by the frontage actually consumed inside accepted corner lots, and now only keeps corner-prepass lots that truly touch the shared frontage vertex; under-frontage strips left at selected frontage junctions are converted into combined-frontage corner lots, selected frontage edges whose carried remainder lost most of the original edge are recovered from the parent before overlap cleanup, closed all-parent-boundary frontage selections now use a continuous ring with frontage-perpendicular straight-run lot lines, 1-2 frontage widths of corner-transition lots, solved minimum-area depth capped by maximum depth, four-or-more-sided lots, corner rear lines that connect directly to adjacent straight-run rear lines at the adjacent solved depth, and a single center remainder following that same rear boundary, trailing rear max-depth leftovers stay as separate remainders instead of being folded into oversized blue preview lots, and remainder retries stay on the selected frontage chain instead of inventing lots from non-selected parent-boundary edges, so screenshot-style angled-frontage fixtures no longer get wonky far-corner line bundles, empty selected-frontage corners, collapsed one-lot bottom-angled edges, over-deep corner rear lines, missing full-boundary straight-run lots, full-boundary frontage gaps, or random top/right-edge layout lines.
- [x] Survey CAD parcel properties merge batch (July 2026): restyle the Properties popup onto the shared CAD floating-panel chrome, merge the selected parcel report summary/table into that popup for parcel selections, and suppress the duplicate standalone parcel report card behind it.
- [x] Survey CAD side-panel shell controls batch (July 2026): switch shared panel close/collapse controls onto symbol buttons, add left/right docking controls to Properties, and tile same-side CAD panels horizontally in dock-order instead of letting them overlap.
- [x] Survey CAD properties float + dock clearance batch (July 2026): add a float mode with drag support to Properties and lower the default docked panel top offset so left/right pinned side panels clear more of the CAD toolbar.
- [x] Survey CAD floating panel shell batch (June 2026): make the parcel-layout floating popup resizable in both axes with persisted size, then extract that compact drag/resize shell into a shared Survey CAD popup pattern so future floating CAD panels reuse the same behavior instead of ad hoc panel chrome.
- [x] Survey CAD parcel layout shell polish batch (June 2026): fix floating panel body scrolling so the preview section stays reachable at standard size, match floating default size to the docked shell, restrict resize to wider-or-standard and shorter-or-standard directions, compact the parcel controls further, and add hover tooltips across the panel surface.
- [ ] Survey CAD parcel-advanced split/report batch (June 2026): add dedicated sliding-area and hinged-area split tools plus curved-frontage support, parcel-layout history/report rows, parcel label toggles, and richer parcel table/report surfacing for generated lot sets.
  Current slice: expand parcel-layout history/report row summaries beyond the new saved constraint settings so solved width/depth/frontage metrics are visible in history and export.
- [ ] Transform tools batch: add rotate, scale, mirror, two-point rotate+translate, 2D Helmert, affine transform, grid-ground scaling from origin, set/add/interpolate elevation.
- [ ] Annotation/report batch: add bearing-distance labels, richer curve labels, line/curve tables, point reports, inverse reports, traverse reports, parcel reports, COGO history log, and export computation report.
- [ ] High-end backlog batch: add least-squares traverse/network handoff, spiral/clothoid tools, best-fit line/arc, dependency graph updates, legal description generator, and field/stakeout export package.

- [x] Survey CAD trim command batch (June 2026): add a Civil3D-style `TRIM` flow that uses selected linework as cutting edges, lets operators click the side of a line/polyline/arc to remove, commits deterministic split/shorten edits through command history, and locks it with focused CAD geometry/workspace coverage.

- [x] Survey CAD fillet-corner + trim-extend batch (June 2026): keep repeatable native `FILLET` on the clicked interior corner even on acute picks that previously tried to build the opposite near-full-circle sweep, allow radius `0` as a hard-corner intersection cleanup, and let `Shift`-held `TRIM` extend line/polyline/arc targets forward to the next valid cutting edge with live preview before commit.

- [x] Survey CAD extend-tool + centered helper batch (June 2026): move the command helper/status overlay into the centered lane above the command bar so long prompts stay readable, replace the unreliable `Shift`-held extend path inside `TRIM` with a dedicated repeatable `EXT` command that captures the source entity first and the boundary entity second, and lock the new extend preview/commit loop with focused CAD geometry/workspace coverage.

- [x] Survey CAD move-anchor + erase-hotkey batch (June 2026): keep mouse-picked MOVE base/target capture on the shared SVG frame so browser clicks land on the same snapped world point the operator sees, and let `Delete` / `Backspace` fire `ERASE` when entities are selected outside editable inputs.

- [x] Survey CAD grip-edit batch (June 2026): add selection grips for lines, polylines, polygons, parcels, and arcs so selected geometry exposes draggable vertex/radius handles and commits deterministic handle-move edits with focused workspace coverage.

- [x] Survey CAD direct arc-body click batch (June 2026): make the visible line/arc/point/ellipse geometry itself act as a command click target alongside the widened invisible hit targets, and add a real same-session `ARC 3PT -> LINE from arc body -> LINE to arc body` regression so arc snapping survives normal operator clicks.

- [x] Survey CAD arc-snap audit batch (June 2026): lock command-created and constructor-built arc entities with shared on-body `arc-midpoint` / `nearest` regression coverage across the native arc command family, so future arc-command changes cannot silently break snapping on committed curves.

- [x] Survey CAD arc-nearest priority batch (June 2026): let on-curve `nearest` override much farther exact snaps on small or dense arcs, so endpoint priority does not swallow the whole arc body during line drafting.

- [x] Survey CAD arc-body hit-target batch (June 2026): make arc body clicks in active commands resolve to the closest point on the curve, and harden arc hit targets so operators can start or finish linework directly on arcs instead of only at endpoints.

- [x] Survey CAD start-perpendicular + direction snap batch (June 2026): add a second `perpendicular` construction path from the captured start segment, restore practical local `parallel` pickup after the recent fail-closed scope change, and add low-priority 8-way direction snaps (`N/NE/E/SE/S/SW/W/NW`) as fallback drafting aids.

- [x] Survey CAD fail-closed parallel scope batch (June 2026): make `parallel` snap fail closed when the active draw start cannot resolve a valid local seed segment, so preview never falls back to whole-drawing parallel grabs during line drafting.

- [x] Survey CAD line-body seed batch (June 2026): treat direct first clicks on visible linework as segment-seeded starts, so `LINE` preview keeps local parallel scope even when no explicit snap kind won the first click.

- [x] Survey CAD command-start snap carryover batch (June 2026): keep the hovered snap alive when a draw command starts so an immediate first click still captures midpoint/nearest segment context instead of dropping back to raw world-point input and global parallel scope.

- [x] Survey CAD obstructed-guide snap batch (June 2026): reject `extension` and `apparent intersection` candidates whose derived guide path runs through other existing linework, and keep the remaining valid local construction cases locked with focused engine/workspace coverage.

- [x] Survey CAD snapped-start scope batch (June 2026): carry the captured snap segment through line-start/background-click input so construction snap scoping stays local even when the operator starts from midpoint/nearest-style line snaps.

- [x] Survey CAD endpoint-scoped construction batch (June 2026): scope `parallel` to segments within one hop of the captured endpoint, scope line-based `extension` / `apparent intersection` to two hops, and stop polyline-wide remote segments from leaking into those snaps.

- [x] Survey CAD parallel-filter + shift-lock batch (June 2026): add `Shift` construction-lock during drafting, highlight the source line for active parallel snaps, and limit dynamic parallel candidates to linework attached at the captured start point when available.

- [x] Survey CAD compound construction-snap batch (June 2026): let `perpendicular`, `extension`, and `parallel` stay locked while a second snap such as `intersection` or `apparent intersection` refines the final target on that same derived line.

- [x] Survey CAD snap-priority + zoom-tolerance batch (June 2026): make viewport snap range screen-scale-aware so it shrinks as operators zoom in, retune snap priority so endpoints then midpoints win cleanly, and stop `nearest` plus arc-midpoint hover snaps from being swallowed by oversized world-space tolerance.

- [x] Survey CAD snap-guide batch (June 2026): add ghost guide lines for construction-style snaps so tangent, extension, perpendicular, parallel, and apparent-intersection targets show the derived geometry that produced the snap.
- [x] Survey CAD snap-badge batch (June 2026): add a live snap-kind badge with distinct kind wording/colors so tangent, apparent-intersection, perpendicular, center, and ordinary point snaps are visibly different while drafting.
- [x] Survey CAD tangent-snap + apparent-curve batch (June 2026): add command-context tangent snaps from active base point onto visible arcs/circles, and extend `apparent intersection` beyond line-line into honest line-arc cases.
- [x] Survey CAD apparent-arc + construction-hint batch (June 2026): extend command-context `apparent intersection` beyond line-arc into honest arc-arc circle-crossing cases, and add a small live base-point hint so operators can tell when construction/tangent snaps are armed from the captured point.
- [x] Survey CAD construction-snap batch (June 2026): add command-context construction snaps (`extension`, `perpendicular`, `parallel`, and line-like `apparent intersection`) so active draw/edit commands can lock onto derived geometry without turning those derived targets into always-on passive hover clutter.
- [x] Survey CAD curve-snap expansion batch (June 2026): expand native snapping beyond point/end/mid/intersection/nearest with honest curve-aware snaps (`center`, arc endpoints, arc midpoint, quadrants, line-arc intersections, arc-arc intersections, and nearest-on-curve) while leaving construction-only snaps for a later command-context batch.
- [x] Survey CAD arc-flip hint batch (June 2026): add a small live viewport hint for arc modes that support `Ctrl` flip/reverse so operators can see the modifier while drawing, and lock it with focused workspace coverage.
- [x] Survey CAD arc-direction audit batch (June 2026): audit all native arc constructors for start/end/center fidelity, fix clockwise or reverse-sweep cases that silently swap endpoints or break continuation tangency, and lock the edge cases with focused geometry/workspace coverage.
- [x] Survey CAD center-arc validation batch (June 2026): make center-driven arc commands reject off-radius end picks instead of silently drifting the committed curve away from the operator's supplied center/end geometry, and lock the behavior with focused CAD geometry/workspace coverage.

## Phase 0: Planning and shell seam
- [x] Create planning branch for Survey CAD groundwork.
- [x] Add repo-fit master plan.
- [x] Add phased Survey CAD TODO.
- [x] Add mlightcad evaluation notes.
- [x] Add licensing notes.
- [x] Add supporting docs for data model, commands, file I/O, plotting, field-to-finish, and surfaces/point clouds.
- [x] Preserve attached high-level plan inside repo docs for future reference.
- [x] Add lightweight ADR seeds for source-of-truth, renderer, and DWG boundary decisions.
- [x] Add top-toolbar Survey CAD launcher beside `Project Options`.
- [x] Add app-shell Survey CAD workspace entry and promote it to a dedicated full-page CAD workflow.

Acceptance criteria:
- docs live in repo and are linked together
- app shell exposes stable Survey CAD workspace entry
- no solver/parity behavior changes

Risks:
- dedicated shell could imply more implementation than exists
- docs could drift from repo structure if they copy monorepo assumptions

Notes:
- dedicated workspace shell now exists; deeper traverse/parcel workflows still remain ahead

## Phase 1: Native CAD model and transactions
- [x] Create `src/engine/cad/` root module set.
- [x] Define `EntityId`, `LayerId`, and `StyleId` for spike scope.
- [x] Define `BaseEntity`.
- [x] Define survey-rich point entities for spike scope.
- [x] Define line/text/error-ellipse entities for spike scope.
- [x] Define observation-line and error-ellipse CAD overlays for spike scope.
- [x] Define layer/style/linetype/symbol model.
- [x] Expand entities to arc/polyline/polygon/parcel families.
- [x] Define CAD project-state domain to persist inside current WebNet project storage.
- [x] Define deterministic serialization-oriented project shape for spike scope.
- [x] Define transaction log and undo/redo contracts.
- [x] Add focused model/adapter tests.
- [x] Add focused geometry primitive tests.

Acceptance criteria:
- native entities serialize and deserialize deterministically
- undo/redo can replay multi-entity edits
- no renderer dependency required for core model tests

Risks:
- mixing survey metadata and purely visual metadata too early
- over-designing block/layout concepts before first use cases

## Phase 2: Renderer interface and mlightcad spike
- [x] Define renderer-neutral display adapter interface.
- [x] Inventory current WebNet map render primitives worth reusing.
- [x] Build tiny adapter for WebNet-native point/line/text/ellipse display payloads.
- [x] Prototype `mlightcad`-target export contract against adapter, not project state.
- [x] Build internal SVG proof renderer from the same adapter output.
- [x] Load simple DXF in spike environment.
- [x] Render WebNet-native entities through adapter.
- [x] Verify selection maps back to WebNet entity IDs in the internal spike renderer.
- [x] Verify selection maps through actual `mlightcad` runtime.
- [x] Verify layer visibility can be driven from actual `mlightcad` runtime state.
- [x] Document model-space/layout-space fit.
- [x] Write renderer strategy ADR update with go/no-go decision.

Acceptance criteria:
- no Vue rewrite required
- native WebNet IDs remain authoritative
- renderer can be swapped later

Risks:
- mlightcad package split may still hide framework assumptions
- current lower-level viewer path may still pull GPL LibreDWG chain into core dependency graph
- text/linetype/block support may be coupled to external entity model
- the published ESM package entry is still brittle under raw Node; runtime proof currently uses the published CJS build plus the lower-level `data-model` APIs instead of the un-installable `cad-simple-viewer` package

## Phase 3: Selection, snapping, and commands
- [x] Build selection-set model.
- [x] Build command registry and command history.
- [x] Build command state-machine base types.
- [x] Build snap manager.
- [x] Build spatial index for snap/select candidates.
- [x] Add point node, endpoint, midpoint, intersection, nearest snaps.
- [x] Add visual snap glyphs and status feedback.
- [x] Promote the CAD page to toolbar + model-space-only chrome and remove the duplicate results-area Survey CAD tab.
- [x] Replace the temporary explicit `Select`/`Pan`/`Zoom Window` buttons with direct CAD-style viewport interaction: click select, directional drag-box selection, wheel zoom, middle-mouse pan, and middle-double-click zoom extents.
- [x] Add `POINT`, `LINE`, `INVERSE`.
- [x] Add `PLINE`, `MOVE`, `COPY`, `TRIM`.
- [x] Add `ERASE`.
- [x] Add full survey bearing/distance input path.
- [x] Add coordinate input and azimuth-distance input path.
- [x] Add undo/redo coverage for multi-entity edits.

Acceptance criteria:
- commands are testable without DOM-heavy harnesses
- snaps resolve exact model coordinates
- undo/redo boundaries are deterministic

## Phase 4: COGO and parcel foundation
- [x] Add inverse calculations.
- [x] Add bearing-distance point creation.
- [x] Add azimuth-distance point creation.
- [x] Add line-line intersection.
- [x] Add line-arc and arc-arc intersections.
- [x] Add offsets, parallels, perpendiculars.
- [x] Add curve creation helpers.
- [x] Add arc and tangent-curve command workflows.
- [x] Expand arc creation surface to a split-button multi-mode tool and render arcs as true curve paths instead of sampled line strips.
- [x] Add traverse-entry workflow.
- [x] Add parcel entity model.
- [x] Add parcel closure report.
- [x] Add line/curve labels tied to geometry.
- [x] Replace temporary parcel/traverse text with survey-style azimuth-distance and stacked area/perimeter annotations.
  Current slice: traverse azimuth-distance labels are upright-only, parcel labels are stacked/centered, and native arc entities now render geometry-derived delta/radius/arc-length labels without persisting extra text entities.

Acceptance criteria:
- user can build and label a simple parcel from COGO
- closure, area, perimeter, bearings, and distances update with edits

Current phase note:
- the native CAD workspace now runs direct `TRAVERSE` command entry, can promote a selected traverse/polyline into a first `PARCEL` entity with area/perimeter/closure metrics plus centroid label text, shows a selected-parcel closure report overlay with area/perimeter/closure/course rows, now also shows an editable selection-driven `Properties` overlay for points/lines/parcels/arcs/alignments/text/ellipses while command status text and persisted `cogoComputations` keep the live/history COGO seam, and now covers geometry-tied traverse/parcel/arc labeling plus simple `PL#` / `TRAV#` / `CURVE#` naming with curve support points for the current Phase 4 scope

## Phase 5: Point import and field-to-finish
- [ ] Define feature-code library format.
- [ ] Add point import pipeline for collector-style files.
- [ ] Normalize feature codes and aliases.
- [ ] Generate figures and symbols from feature library.
- [ ] Generate breakline candidates from feature rules.
- [ ] Add audit/import report.
- [ ] Add editable feature library workflow.

Acceptance criteria:
- repeatable import creates styled points/figures/labels from same input
- import remains auditable and reversible

## Phase 6: Layout space and plotting
- [ ] Define model-space and layout-space persistence.
- [ ] Define sheets, title blocks, and viewports.
- [ ] Add viewport scale and rotation.
- [ ] Add scale bar, north arrow, legend support.
- [ ] Add basic lineweight and text-style plotting rules.
- [ ] Add PDF export.
- [ ] Add plot preview.

Acceptance criteria:
- user can produce simple survey deliverable PDF from native layout model

## Phase 7: Interop formats
- [ ] Add DXF export.
- [ ] Add DXF import.
- [ ] Add LandXML parcel/surface import/export.
- [ ] Add GeoJSON export/import where survey use cases benefit.
- [ ] Add golden file tests for import/export stability.

Acceptance criteria:
- exchange formats remain exchange boundaries, not project truth

## Phase 8: Surfaces and volumes
- [ ] Define TIN surface model.
- [ ] Add breaklines, boundaries, voids.
- [ ] Add deterministic triangulation path.
- [ ] Add contour generation.
- [ ] Add volume between surfaces.
- [ ] Add cut/fill reports.
- [ ] Add LandXML surface export.

Acceptance criteria:
- deterministic, test-covered surface and volume outputs

## Phase 9: Point clouds
- [ ] Define point-cloud layer model.
- [ ] Choose LAS/LAZ/COPC ingestion path.
- [ ] Add streaming/LOD viewing.
- [ ] Add classification filtering.
- [ ] Add extraction-area workflow.
- [ ] Add thinning/sampling path.
- [ ] Add surface generation from classified ground points.

Acceptance criteria:
- large clouds do not block UI
- already-classified survey clouds can feed surfaces/volumes

## Phase 10: Optional helper boundary
- [ ] Evaluate Tauri wrapper.
- [ ] Evaluate local helper boundary for heavy DWG/point-cloud/CRS tasks.
- [ ] Define optional plugin/helper contract.
- [ ] Keep browser-only app functional without helper.

Acceptance criteria:
- helper remains additive rather than architectural rewrite

## Decision records to maintain
- [x] ADR 0001 source of truth accepted or revised after renderer spike.
- [x] ADR 0002 renderer strategy updated after mlightcad spike.
- [ ] ADR 0003 DWG/GPL boundary updated before any DWG shipping path.

## Validation notes
- Add focused tests before broad checks for each phase.
- Run parity gate only for phases that touch solver/listing/report behavior.
- Keep `README.md`, `docs/ARCHITECTURE.md`, and `docs/CURRENT_BEHAVIOR.md` aligned when visible workflows change.

## Phase 0-3 acceptance audit

### Phase 0
- `docs live in repo and are linked together`: satisfied by the committed Survey CAD doc set plus shell-entry coverage in `tests/workspace_chrome.test.tsx` and `tests/project_options_modal_interaction.test.tsx`.
- `app shell exposes stable Survey CAD entry point`: satisfied by the toolbar/workspace tab tests above and the Survey CAD workspace smoke coverage in `tests/ui_navigation_smoothness.test.tsx`.
- `no solver/parity behavior changes`: satisfied in scope; the implemented files stayed in `src/engine/cad/*`, `src/components/SurveyCadWorkspace.tsx`, and project-storage hooks, with no parser/solver output contract changes and no parity-gated tests requiring fixture updates.

### Phase 1
- `native entities serialize and deserialize deterministically`: satisfied by `tests/project_file.spec.ts`, `tests/project_bundle.spec.ts`, and `tests/cad_persistence_and_entities.test.ts`, including persisted parcel-family data and Survey CAD project-state round-trips.
- `undo/redo can replay multi-entity edits`: satisfied by `tests/cad_command_history.test.ts`, which covers deterministic command history over create/move/copy/erase flows.
- `no renderer dependency required for core model tests`: satisfied by the engine-only suites `tests/cad_command_history.test.ts`, `tests/cad_cogo.test.ts`, `tests/cad_spatial_index.test.ts`, and `tests/cad_persistence_and_entities.test.ts`.

### Phase 2
- `no Vue rewrite required`: satisfied by architecture; the live spike remains React-first with internal SVG preview coverage in `tests/survey_cad_workspace.test.tsx`.
- `native WebNet IDs remain authoritative`: satisfied by `tests/cad_spike_model.test.ts` and `tests/cad_mlightcad_runtime.test.ts`, which prove native IDs survive both the inferred adapter and the actual published `data-model` runtime seam.
- `renderer can be swapped later`: satisfied by the shared-native-project coverage in `tests/cad_spike_model.test.ts`, `tests/cad_persistence_and_entities.test.ts`, and `tests/cad_mlightcad_runtime.test.ts`, where one project feeds the internal renderer and the external-runtime adapter independently.
- Fixture evidence: `tests/fixtures/survey_cad/simple_runtime_probe.dxf` proves DXF load through the actual runtime, and `tests/fixtures/survey_cad/triangle_network.dat` proves native-project-to-runtime ID/layer mapping.

### Phase 3
- `commands are testable without DOM-heavy harnesses`: satisfied primarily by `tests/cad_command_history.test.ts`.
- `snaps resolve exact model coordinates`: satisfied by `tests/cad_spatial_index.test.ts`.
- `undo/redo boundaries are deterministic`: satisfied by `tests/cad_command_history.test.ts` and reinforced by the interactive smoke path in `tests/survey_cad_workspace.test.tsx`.
- Current direct-interaction shell: the dedicated CAD page now keeps its toolbar/status region inside the browser viewport, removes visible snap/submit helper buttons, uses Enter/Escape keyboard flow for command commit/cancel, supports click-driven `LINE` creation in the model space, keeps keyboard undo working after toolbar-focused viewport draws, excludes selection-only changes from undo history, keeps picks aligned with the visible cursor position across the viewport, avoids surprise auto-reframe after normal entity edits, and uses insertion-point `PASTE` with live preview instead of fixed-offset duplication.
