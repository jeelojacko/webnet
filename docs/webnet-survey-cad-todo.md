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
- [x] Add app-shell Survey CAD workspace tab for future implementation entry.

Acceptance criteria:
- docs live in repo and are linked together
- app shell exposes stable Survey CAD entry point
- no solver/parity behavior changes

Risks:
- shell seam could imply more implementation than exists
- docs could drift from repo structure if they copy monorepo assumptions

Notes:
- current branch intentionally stops at planning and shell groundwork

## Phase 1: Native CAD model and transactions
- [ ] Create `src/engine/cad/` root module set.
- [ ] Define `EntityId`, `LayerId`, `StyleId`, `CommandId`, `TransactionId`.
- [ ] Define `BaseEntity`.
- [ ] Define survey-rich point entities.
- [ ] Define line/arc/polyline/polygon entities.
- [ ] Define text/leader/dimension entities.
- [ ] Define observation-vector and error-ellipse CAD overlays.
- [ ] Define layer/style/linetype/symbol model.
- [ ] Define CAD project-state domain to persist inside current WebNet project storage.
- [ ] Define deterministic serialization order and schema versioning.
- [ ] Define transaction log and undo/redo contracts.
- [ ] Add focused serialization tests.
- [ ] Add focused geometry primitive tests.

Acceptance criteria:
- native entities serialize and deserialize deterministically
- undo/redo can replay multi-entity edits
- no renderer dependency required for core model tests

Risks:
- mixing survey metadata and purely visual metadata too early
- over-designing block/layout concepts before first use cases

## Phase 2: Renderer interface and mlightcad spike
- [ ] Define renderer-neutral display adapter interface.
- [ ] Inventory current WebNet map render primitives worth reusing.
- [ ] Build tiny adapter for WebNet-native point/line/polygon/text/ellipse display payloads.
- [ ] Prototype `mlightcad` integration against adapter, not project state.
- [ ] Load simple DXF in spike environment.
- [ ] Render WebNet-native entities through adapter.
- [ ] Verify selection maps back to WebNet entity IDs.
- [ ] Verify layer visibility can be driven from WebNet state.
- [ ] Document model-space/layout-space fit.
- [ ] Write renderer strategy ADR update with go/no-go decision.

Acceptance criteria:
- no Vue rewrite required
- native WebNet IDs remain authoritative
- renderer can be swapped later

Risks:
- mlightcad package split may still hide framework assumptions
- text/linetype/block support may be coupled to external entity model

## Phase 3: Selection, snapping, and commands
- [ ] Build selection-set model.
- [ ] Build command registry and command history.
- [ ] Build command state-machine base types.
- [ ] Build snap manager.
- [ ] Build spatial index for snap/select candidates.
- [ ] Add point node, endpoint, midpoint, intersection, nearest snaps.
- [ ] Add visual snap glyphs and status feedback.
- [ ] Add `POINT`, `LINE`, `PLINE`, `MOVE`, `COPY`, `ERASE`, `INVERSE`.
- [ ] Add coordinate input and bearing/distance input path.
- [ ] Add undo/redo coverage for multi-entity edits.

Acceptance criteria:
- commands are testable without DOM-heavy harnesses
- snaps resolve exact model coordinates
- undo/redo boundaries are deterministic

## Phase 4: COGO and parcel foundation
- [ ] Add inverse calculations.
- [ ] Add bearing-distance point creation.
- [ ] Add azimuth-distance point creation.
- [ ] Add line-line intersection.
- [ ] Add line-arc and arc-arc intersections.
- [ ] Add offsets, parallels, perpendiculars.
- [ ] Add curve creation helpers.
- [ ] Add traverse-entry workflow.
- [ ] Add parcel entity model.
- [ ] Add parcel closure report.
- [ ] Add line/curve labels tied to geometry.

Acceptance criteria:
- user can build and label a simple parcel from COGO
- closure, area, perimeter, bearings, and distances update with edits

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
- [ ] ADR 0001 source of truth accepted or revised after renderer spike.
- [ ] ADR 0002 renderer strategy updated after mlightcad spike.
- [ ] ADR 0003 DWG/GPL boundary updated before any DWG shipping path.

## Validation notes
- Add focused tests before broad checks for each phase.
- Run parity gate only for phases that touch solver/listing/report behavior.
- Keep `README.md`, `docs/ARCHITECTURE.md`, and `docs/CURRENT_BEHAVIOR.md` aligned when visible workflows change.
