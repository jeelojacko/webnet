# WebNet Survey CAD TODO

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
- [x] Add `PLINE`, `MOVE`, `COPY`.
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
- [ ] Add line/curve labels tied to geometry.
- [ ] Replace temporary parcel/traverse text with survey-style azimuth-distance and stacked area/perimeter annotations.
  Current slice: traverse azimuth-distance labels are now upright-only and parcel labels are stacked/centered; curve labeling and fuller parcel closure reporting remain open.

Acceptance criteria:
- user can build and label a simple parcel from COGO
- closure, area, perimeter, bearings, and distances update with edits

Current phase note:
- the native CAD workspace now runs direct `TRAVERSE` command entry, can promote a selected traverse/polyline into a first `PARCEL` entity with area/perimeter/closure metrics plus centroid label text, and now shows a selected-parcel closure report overlay with area/perimeter/closure/course rows; geometry-tied line/curve labeling is still open before Phase 4 is complete

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
