# WebNet Survey CAD Master Plan

## Purpose
This document adapts the attached high-level Survey CAD concept to WebNet's current architecture.

WebNet already has strong survey-first assets:
- browser-first TypeScript app shell
- mature parser and least-squares engine
- survey point/line/polygon/label rendering
- CRS, grid/ground, geoid, and projection workflows
- saved projects, portable project bundles, and local recovery
- OSM-backed 2D/3D map workflows
- preanalysis planning overlays, obstacles, synthetic geometry, and QA selection models

Survey CAD should extend those strengths. It should not replace them with a generic CAD viewer data model.

## Scope posture
Target outcome:
- lean survey CAD workspace integrated into WebNet
- native survey/CAD project model with stable IDs
- COGO, parcel, annotation, plotting, and survey deliverable workflows
- adapter-based rendering and exchange formats

Explicit non-goals for early phases:
- broad civil design parity with Civil 3D
- roads, corridors, pipe networks, grading suites
- full DWG-centric architecture
- point-cloud classification science workflow

## Current repo fit
WebNet is not a monorepo today. New CAD work should start inside the existing `src/` and `docs/` structure instead of forcing a package rewrite.

Recommended initial module routing:
- `src/engine/cad/`
  CAD-native entities, transactions, geometry kernel, COGO, parcel math, import/export shapers
- `src/components/surveyCad/`
  CAD workspace panels, command UI, property panels, plotting UI, field-to-finish editors
- `src/hooks/surveyCad/`
  command state, selection state, undo/redo, snapping, workspace persistence
- `tests/cad_*` or focused `tests/*cad*.test.tsx`
  characterization, unit, serialization, and interaction coverage

If the surface grows large, extract internal seams later. Do not start by converting the whole repo into `packages/`.

## Architectural principles

### 1. Native WebNet source of truth
Authoritative stack:

```txt
WebNet survey/CAD project model
  -> transaction / command system
  -> geometry + COGO + parcel kernels
  -> display adapters
  -> renderer(s), exports, plotting
```

Forbidden stack:

```txt
external viewer data model
  -> imported into app shell
  -> treated as project truth
```

Reason:
- WebNet owns adjusted coordinates, covariance, ellipses, observation vectors, feature codes, grid/ground state, legal metadata, and survey audit trails.
- Generic CAD entities do not preserve enough of that metadata.

### 2. Reuse current WebNet foundations first
Prefer extension over reinvention for:
- project/session persistence
- CRS and grid/ground state
- point/line/polygon selection patterns
- OSM/basemap and georeferenced overlay behavior
- QA selection and linked workspace tab navigation
- browser performance/hydration patterns

### 3. Command-first editing
CAD editing must be command/state-machine based rather than scattered button handlers.

Examples:
- `POINT`
- `LINE`
- `PLINE`
- `INVERSE`
- `COGO_LINE_BY_BEARING_DISTANCE`
- `PARCEL_CREATE`

### 4. Exchange formats are boundaries
Native project persistence remains WebNet project storage.

Exchange/import/export formats:
- CSV/TXT point files
- DXF
- LandXML
- GeoJSON
- PDF
- SVG/HTML
- optional DWG plugin/helper later

## Proposed repo-native architecture

### Phase 1 target module seams

```txt
src/engine/cad/
  cadTypes.ts
  cadProjectState.ts
  cadTransactions.ts
  cadUndoRedo.ts
  cadLayers.ts
  cadStyles.ts
  cadSelection.ts
  cadSpatialIndex.ts
  cadGeometry/
  cogo/
  parcels/
  io/

src/components/surveyCad/
  SurveyCadWorkspace.tsx
  SurveyCadCanvas.tsx
  SurveyCadSidebar.tsx
  SurveyCadPropertiesPanel.tsx
  SurveyCadCommandLine.tsx
  SurveyCadStatusBar.tsx

src/hooks/surveyCad/
  useSurveyCadWorkspace.ts
  useSurveyCadCommands.ts
  useSurveyCadSnapping.ts
  useSurveyCadSelection.ts
```

### Project state boundary
CAD state should plug into current project persistence as a new domain, not a separate app.

Recommended persisted domains:
- CAD entities
- layers/styles/symbol libraries
- command preferences and snap settings
- layouts/sheets
- field-to-finish libraries
- parcel metadata
- surfaces metadata
- CAD import/export metadata

## Native data model direction
Detailed shapes live in [webnet-cad-data-model.md](webnet-cad-data-model.md).

Key requirements:
- stable string IDs
- deterministic serialization order
- metadata-rich survey points
- distinction between raw coordinates, working coordinates, and adjusted coordinates
- optional covariance/error ellipse attachments
- layer/style references separate from geometry

## Renderer strategy
Detailed notes live in [webnet-cad-mlightcad-evaluation.md](webnet-cad-mlightcad-evaluation.md).

Decision posture:
- evaluate `mlightcad/cad-viewer` as a renderer substrate, not as project truth
- prefer `cad-simple-viewer` or lower-level renderer seams if they remain framework-agnostic
- keep a custom fallback path possible

Immediate renderer success criteria:
- render WebNet-native geometry through adapter
- selection maps back to WebNet entity IDs
- WebNet layer/style state drives visibility
- no Vue rewrite required

## Existing WebNet capabilities already covering part of the plan
Do not recreate these:
- point, line, polygon, label rendering
- map panning/zooming selection ergonomics
- georeferenced model display
- raw input point loading before solve
- saved project and portable bundle persistence
- survey CRS, grid/ground, geoid, localization, units
- map-linked QA review selection

These should be adapted into CAD-facing abstractions instead:
- shared geometric overlays
- selection contracts
- project storage schema versioning
- export/download flows

## Phased roadmap

### Phase 0: Planning and shell seam
Done in this branch:
- persistent planning docs
- Survey CAD launcher beside `Project Options`
- Survey CAD workspace tab
- ADR seeds

### Phase 1: Core model and transactions
Deliver:
- base CAD/survey entity model
- layer/style model
- transaction journal
- undo/redo model
- serialization contracts
- geometry primitive tests

### Phase 2: Renderer adapter spike
Deliver:
- renderer interface
- mlightcad adapter spike
- WebNet-native point/line/polygon/label/ellipse render
- selection ID round-trip
- decision record

### Phase 3: Selection, snapping, commands
Deliver:
- selection sets
- snap manager
- spatial index
- command framework
- basic edit commands

### Phase 4: COGO and parcel foundation
Deliver:
- inverse
- bearing-distance line/point creation
- intersections
- offsets/curves
- parcel closure and labels

### Phase 5: Field-to-finish and point import
Deliver:
- point import
- feature code library
- figure generation
- symbol/label rules

### Phase 6: Layout and plotting
Deliver:
- model/layout separation
- sheets, title blocks, viewports
- PDF plotting

### Phase 7: DXF/LandXML/Geo interop
Deliver:
- DXF export then import
- LandXML parcel/surface exchange
- GeoJSON export/import where relevant

### Phase 8: Surfaces and volumes
Deliver:
- TIN, breaklines, contours, cut/fill

### Phase 9: Point clouds
Deliver:
- viewing/filtering/extraction
- surface generation from classified ground data

### Phase 10: Optional desktop helper
Deliver:
- Tauri/helper boundary for heavy optional workflows

## Risk register
| Risk | Severity | Mitigation |
|---|---:|---|
| External CAD viewer model becomes central | High | Native WebNet model first, adapter boundary, ADR 0001 |
| DWG path introduces GPL obligations unexpectedly | High | Keep DWG optional, document boundary, ADR 0003 |
| Commands become UI spaghetti | High | Command state machines and transaction boundaries |
| CAD work duplicates existing map/CRS/persistence logic | Medium | Audit and route through current modules first |
| Point-cloud processing freezes browser | High | Workers, LOD, optional helper later |
| Plotting arrives too late and forces annotation rewrite | Medium | Model/layout concepts designed early |
| COGO precision regressions reduce trust | High | Unit/golden tests and explicit audit trail |
| Scope balloons into general civil suite | Medium | Survey-first phase gates and TODO discipline |

## Validation posture
For planning-only batches with light app-shell changes:
- focused UI/jsdom tests first
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

For future CAD math/IO phases:
- add focused geometry/serialization tests first
- run parity gate only when solver/listing/report behavior is touched
- avoid parity-sensitive changes unless explicitly required

## Reference docs in this branch
- [webnet-survey-cad-todo.md](webnet-survey-cad-todo.md)
- [webnet-cad-mlightcad-evaluation.md](webnet-cad-mlightcad-evaluation.md)
- [webnet-cad-licensing-notes.md](webnet-cad-licensing-notes.md)
- [webnet-cad-data-model.md](webnet-cad-data-model.md)
- [webnet-cad-command-system.md](webnet-cad-command-system.md)
- [webnet-cad-file-io.md](webnet-cad-file-io.md)
- [webnet-cad-field-to-finish.md](webnet-cad-field-to-finish.md)
- [webnet-cad-layout-plotting.md](webnet-cad-layout-plotting.md)
- [webnet-cad-surfaces-pointclouds.md](webnet-cad-surfaces-pointclouds.md)
- [webnet-survey-cad-attached-high-level-plan.md](webnet-survey-cad-attached-high-level-plan.md)
