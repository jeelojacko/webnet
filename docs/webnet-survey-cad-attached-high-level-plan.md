# WebNet Survey CAD Attached High-Level Plan

Source: preserved copy of the user-supplied planning note from `C:\Users\JPearson\Downloads\webnet_survey_cad_codex_plan.md`.

---

# WebNET Survey CAD Project Plan for Codex

---

## 0. Codex Task Summary

Create a new Git branch and add a detailed written project plan for turning the existing WebNET browser-based least-squares adjustment app into a lean, survey-specific CAD system.

This is not a request to immediately implement the full CAD system. The first Codex task is to create a durable planning branch containing:

1. A high-level technical architecture.
2. A phased implementation roadmap.
3. A detailed TODO list grouped into batches.
4. A spike plan for evaluating `mlightcad/cad-viewer`.
5. Licensing notes, especially around MIT vs GPL dependencies.
6. Clear boundaries between what should be reused/adapted from external CAD projects and what should be built natively inside WebNET.

The project should remain browser-first and TypeScript-first because WebNET is already a mature browser-based TypeScript app with existing survey entities, adjustments, coordinate systems, points, lines, polygons, labels, OpenStreetMap basemap support, polygon obstacles, network pre-analysis/planning tools, error ellipses, 3D least-squares adjustment, total station/GNSS/vector/levelling support, and instrument uncertainty modeling.

---

## 1. First Git Operations

Codex should start by creating a new branch.

Suggested branch name:

```bash
git checkout -b feature/webnet-survey-cad-plan
```

Alternative branch names are acceptable, but use a descriptive feature branch, not `main`.

Then create planning documents under a docs folder:

```txt
docs/
  webnet-survey-cad-master-plan.md
  webnet-survey-cad-todo.md
  webnet-cad-mlightcad-evaluation.md
  webnet-cad-licensing-notes.md
```

If the repo already has a planning or design docs folder, use that existing convention instead.

Commit message suggestion:

```bash
git add docs/
git commit -m "Add WebNET survey CAD architecture and phased implementation plan"
```

Do not implement major CAD functionality in this first planning branch unless the repository already has an established docs-plus-spike convention and the spike is intentionally small.

---

## 2. Project Vision

Build a lean, survey-focused CAD module/workspace for WebNET.

The goal is not to clone all of Civil 3D. The goal is to create a browser-first professional land surveying CAD environment that focuses on:

- Points
- Lines
- Arcs
- Curves
- Polylines
- Parcels
- Labels and annotations
- COGO
- Field-to-finish
- Coordinate systems
- Grid/ground handling
- Layout/model space
- Plotting
- Surfaces
- Volumes
- Point cloud viewing and extraction workflows
- Direct integration with WebNET least-squares adjustment and survey uncertainty outputs

Civil 3D contains many civil engineering, road, pipe, corridor, grading, and project-management features that are not needed for a lean survey CAD tool. WebNET Survey CAD should intentionally stay narrower, faster, and more survey-specific.

---

## 3. Core Architectural Principle

Do not let any renderer, imported CAD library, DXF parser, or DWG viewer become the source of truth.

The WebNET survey model must remain the authoritative project model.

Correct architecture:

```txt
WebNET Survey/CAD Project Model
        ↓
Command System / Undo-Redo / Transactions
        ↓
Geometry + COGO + Parcel Kernel
        ↓
Display Adapter Layer
        ↓
Renderer(s): mlightcad renderer, custom WebGL/PixiJS, SVG, PDF, etc.
```

Avoid this architecture:

```txt
External CAD viewer entities become the entire WebNET project database
```

The native WebNET model must preserve survey-specific metadata that generic CAD formats do not understand:

- Adjusted coordinates
- Observed coordinates
- Point covariance / uncertainty
- Error ellipses
- Observation vectors
- Network adjustment metadata
- Instrument uncertainty models
- Feature codes
- Field-to-finish rules
- Coordinate system definitions
- Grid/ground settings
- Localization parameters
- Parcel closure data
- Legal/record information
- Surface/breakline metadata
- Layout sheet definitions
- Annotation style intent

DXF/DWG/LandXML/GeoJSON/etc. are exchange formats, not the native project model.

---

## 4. Recommended High-Level Tech Stack

### 4.1 Main Application

Keep the current WebNET frontend stack unless there is a strong reason to change it.

Recommended default:

```txt
TypeScript
Existing WebNET frontend framework
Vite or current build system
Modular package structure
Web Workers for heavy calculations
WASM modules for performance-critical geometry/CRS/point-cloud tasks
```

Do not rewrite the existing mature WebNET app simply to adopt a CAD viewer framework.

### 4.2 2D CAD Rendering

Evaluate three possible approaches:

1. Use/adapt `mlightcad/cad-viewer` lower-level rendering/data packages.
2. Build a custom WebGL/PixiJS renderer.
3. Use SVG/Canvas only for limited export/preview/debugging.

Preferred first action:

- Do a spike using `mlightcad/cad-viewer`.
- Try to render WebNET-native points, lines, polygons, labels, and error ellipses through an adapter.
- Determine whether the renderer can be used without making its data model authoritative.

### 4.3 3D, Point Clouds, and Surfaces

Recommended stack:

```txt
Three.js for 3D viewport
Potree/COPC-style streaming for point-cloud visualization
Web Workers for point-cloud filtering/thinning
WASM/Rust/C++ modules for heavy triangulation and surface processing
```

Do not make point-cloud processing the first CAD milestone. Start with 2D CAD architecture, snapping, COGO, parcels, and layout/plotting. Point clouds and surfaces depend on a clean project model and command system.

### 4.4 Coordinate Systems

Recommended stack:

```txt
Proj4js for common browser-side CRS transformations
PROJ compiled to WASM or server/native helper for higher-trust transformations
GeographicLib or equivalent for geodesic and geodetic calculations
Explicit grid/ground scale handling
Explicit units model
```

Coordinate transformations must be inspectable, testable, and auditable. Survey users need confidence that grid/ground, datum, projection, and localization choices are explicit.

### 4.5 Storage

Recommended native project persistence:

```txt
SQLite / SQLite WASM / OPFS where appropriate
or existing WebNET project storage extended with a normalized CAD schema
```

Do not make DXF the native project format.

Recommended exchange formats:

```txt
CSV / TXT point files
DXF
LandXML
GeoJSON
GeoPackage
FlatGeobuf
LAS / LAZ / COPC for point clouds
PDF for plotting
SVG/HTML for lightweight viewing/export
```

DWG support should be considered optional and isolated because of licensing and complexity.

---

## 5. External Repo to Evaluate: mlightcad/cad-viewer

Repository:

```txt
https://github.com/mlightcad/cad-viewer
```

The repo appears to be a promising browser CAD viewer/editor foundation. It is TypeScript-based, browser-oriented, MIT-licensed at the main `cad-viewer` repo level, and focuses on web-based DXF/DWG viewing/editing. It includes or references pieces such as viewers, renderer packages, examples, SVG/Three rendering, layer/entity handling, layouts, commands, and export ideas.

However, this project should be treated as a CAD substrate or reference, not as the complete WebNET Survey CAD foundation.

### 5.1 Things to Investigate from mlightcad/cad-viewer

Codex should create `docs/webnet-cad-mlightcad-evaluation.md` and inspect:

- Repository structure.
- Package structure.
- Which packages are Vue-specific.
- Which packages are framework-agnostic.
- Whether `cad-simple-viewer` or lower-level renderer packages can be used independently.
- The data model used for CAD entities.
- DXF parsing pipeline.
- DWG parsing pipeline.
- Layer model.
- Layout/paper-space model.
- Entity selection architecture.
- Command architecture.
- Text rendering.
- Linetype rendering.
- Block/insert support.
- Hatches.
- Snapping support, if any.
- Editing commands, if any.
- Rendering performance strategies.
- Build tooling and dependencies.
- Whether the renderer can accept WebNET-native geometry through an adapter.
- Whether the package can be embedded without adopting Vue.
- Whether DWG support pulls in GPL-licensed dependencies.

### 5.2 What WebNET Might Reuse or Adapt

Potentially reuse/adapt:

- CAD viewport design patterns.
- WebGL/Three renderer design.
- Layer visibility handling.
- DXF import/export concepts.
- DWG import path, only if licensing implications are acceptable.
- Model/layout rendering ideas.
- Selection/highlighting patterns.
- Text/mtext rendering ideas.
- Linetype rendering.
- Block/insert rendering.
- HTML/SVG export patterns.
- Measurement and command-line UI concepts.
- Performance strategies for large drawings.

### 5.3 What WebNET Should Build Natively

Build these from the ground up in WebNET, even if external libraries are used internally:

- WebNET native project model.
- Survey point database.
- COGO engine.
- Parcel engine.
- Feature-code / field-to-finish engine.
- Survey-specific annotation model.
- Coordinate system and grid/ground logic.
- Adjustment result integration.
- Error ellipse and covariance visualization.
- Observation vector visualization.
- Survey control workflows.
- Surface/TIN data model.
- Breakline model.
- Volume calculations.
- Point-cloud-to-surface workflow.
- Layout plotting rules specific to survey deliverables.
- Legal/parcel closure reports.
- Least-squares-aware drafting workflows.

### 5.4 Evaluation Spike

Create a spike plan, not necessarily implementation, for:

```txt
Spike A: Load a simple DXF using mlightcad/cad-viewer.
Spike B: Render WebNET-native entities through a display adapter.
Spike C: Select entities and map selection back to WebNET entity IDs.
Spike D: Toggle layers and styles from WebNET state.
Spike E: Render model-space and layout-space equivalents.
Spike F: Export a WebNET drawing subset to DXF and reload it.
Spike G: Determine which dependencies are MIT and which are GPL or otherwise restrictive.
```

Success criteria:

- WebNET remains source of truth.
- Renderer can be swapped later if needed.
- Custom survey entities can be displayed.
- Selection can map back to native WebNET IDs.
- No major UI framework rewrite required.
- License implications are documented.

Failure criteria:

- Renderer requires making external CAD entities authoritative.
- Library strongly couples WebNET to Vue or unwanted state management.
- Custom entities cannot be handled cleanly.
- Performance is poor on realistic survey drawings.
- Licensing obligations conflict with the intended project license/distribution model.

---

## 6. Licensing Notes

Create `docs/webnet-cad-licensing-notes.md`.

Important distinction:

- `mlightcad/cad-viewer` appears to be MIT-licensed at the main repo level.
- DWG support may involve LibreDWG-related packages.
- LibreDWG is GPL-licensed.
- `mlightcad/libredwg-web` is GPL-3.0 licensed.
- GPL dependencies/code may impose obligations if distributed as part of WebNET.

Because this project is personal/open-source, GPL may be acceptable. Still, document it clearly.

### 6.1 Required README Note If GPL Code or GPL Dependency Is Used

If WebNET directly uses, bundles, modifies, copies, or distributes GPL code or a GPL dependency such as LibreDWG/libredwg-web, add a clear notice in the README.

Suggested README section:

```md
## Licensing Notes

This project may include or optionally integrate with third-party CAD/DWG tooling.

- WebNET's original code is licensed as stated in this repository.
- Some optional DWG-related functionality may rely on GPL-licensed LibreDWG-derived code or packages.
- If GPL-licensed DWG functionality is included in a distributed build, the relevant GPL license terms apply to that component and potentially to the combined distribution.
- See `docs/webnet-cad-licensing-notes.md` for dependency-level licensing details.
```

If GPL code becomes part of the main distributed app, do not merely add a README note. Also ensure:

- The correct license file is included.
- Copyright notices are preserved.
- Source availability requirements are satisfied.
- Modified GPL code is documented as modified.
- Package manifests accurately reflect licenses where appropriate.
- Any MIT-only claims are corrected.

This is not legal advice. It is an engineering reminder to avoid accidentally mixing MIT and GPL components without documenting the result.

### 6.2 Safer DWG Strategy

Treat DWG as an optional boundary/plugin:

```txt
Core WebNET Survey CAD: MIT or project-preferred license
DXF/LandXML/CSV/GeoJSON/PDF: core supported formats
DWG import/export: optional plugin/helper/converter with explicit GPL notice
```

This gives the project flexibility even if GPL is acceptable for personal/open-source use.

---

## 7. Proposed Package / Module Structure

Codex should propose an architecture similar to:

```txt
packages/
  webnet-core/
    project model, IDs, transactions, units, settings

  webnet-adjustment/
    existing least-squares adjustment engine

  webnet-geom/
    geometry primitives, intersections, arcs, curves, COGO math

  webnet-cad-model/
    CAD/survey entities, layers, styles, blocks, layouts

  webnet-cad-commands/
    command system, snapping, grips, selection, undo/redo

  webnet-cad-renderer/
    renderer interface and adapters

  webnet-cad-renderer-mlightcad/
    optional adapter/spike around mlightcad renderer

  webnet-map/
    basemap integration, georeferenced overlays

  webnet-crs/
    coordinate system definitions, transformations, grid/ground

  webnet-field-to-finish/
    code libraries, figures, symbol mapping, auto-linework

  webnet-parcels/
    parcel entities, closure, legal/area reports

  webnet-surfaces/
    TIN, breaklines, contours, volumes

  webnet-pointcloud/
    LAS/LAZ/COPC ingestion/viewing/filtering

  webnet-io/
    CSV, DXF, LandXML, GeoJSON, GeoPackage, FlatGeobuf, PDF, SVG/HTML

  webnet-print/
    model/layout space, sheets, viewports, title blocks, PDF plotting

  webnet-ui/
    app-specific UI components/workspaces
```

Adapt this structure to the current repo conventions. Do not blindly create excessive packages if the current repo is not a monorepo. The important concept is modular separation.

---

## 8. Native Data Model Concepts

Codex should define a planned internal model with stable IDs and serializable entities.

### 8.1 Base Entity

Suggested conceptual shape:

```ts
type EntityId = string;
type LayerId = string;
type StyleId = string;

interface BaseEntity {
  id: EntityId;
  type: string;
  layerId: LayerId;
  styleId?: StyleId;
  locked?: boolean;
  visible?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
```

### 8.2 Survey/CAD Entities

Planned entities:

```txt
SurveyPoint
ControlPoint
AdjustedPoint
Line
Arc
Curve
Polyline
Polygon
Parcel
ParcelLine
Easement
RightOfWay
FeatureFigure
Text
MText
Leader
Dimension
Symbol
BlockReference
ObservationVector
ErrorEllipse
TinSurface
Breakline
Contour
PointCloudLayer
Layout
Sheet
Viewport
TitleBlock
```

### 8.3 Point Entity Requirements

A survey point should be richer than a CAD point:

```txt
point number/name
northing/easting/elevation
raw/original coordinates
adjusted coordinates
coordinate system reference
description
feature code
source file/import batch
survey method/source
classification
layer/style/symbol
uncertainty/covariance where available
adjustment participation flag
locked/control flag
```

### 8.4 Parcel Requirements

Parcel entities should support:

```txt
closed boundary
record dimensions
measured dimensions
adjusted dimensions
area
perimeter
misclosure
bearing/distance labels
curve labels
monument references
legal description helpers later
closure report
export to DXF/LandXML/PDF
```

---

## 9. Command System

Build a CAD-like command framework early.

Commands should be state machines, not one-off UI handlers.

Example:

```txt
LineCommand
  idle
  waitingForStartPoint
  waitingForEndPoint
  preview
  commit
  cancel
```

Core requirements:

- Keyboard command aliases.
- Mouse/touch input.
- Coordinate input.
- Bearing/distance input.
- Dynamic preview.
- Snapping.
- Ortho/polar tracking later.
- Undo/redo transaction boundaries.
- Cancel/escape behavior.
- Command history.
- Repeat last command.
- Property editing.
- Selection set integration.

Initial command list:

```txt
POINT
LINE
PLINE
ARC
CIRCLE, optional
OFFSET
TRIM, later
EXTEND, later
MOVE
COPY
ROTATE
SCALE
ERASE
BREAK, later
JOIN
MEASURE
INVERSE
TRAVERSE
COGO_LINE_BY_BEARING_DISTANCE
COGO_INTERSECTION
PARCEL_CREATE
PARCEL_CLOSE
LABEL_LINE
LABEL_POINT
IMPORT_POINTS
IMPORT_DXF
EXPORT_DXF
```

---

## 10. Snapping and Precision

Snapping is mission-critical.

Initial snap modes:

```txt
Point node
Endpoint
Midpoint
Intersection
Nearest
Perpendicular
Tangent
Center
Quadrant
Insertion point
Parcel corner
COGO computed point
Station/offset later
```

Requirements:

- Snap priority rules.
- Snap tolerance in screen pixels.
- Spatial index for candidate lookup.
- Visual snap glyphs.
- Keyboard override.
- Snap preview.
- Ability to turn snap modes on/off.
- Snaps must resolve to exact geometric coordinates, not approximate screen coordinates.

Precision requirements:

- Keep model coordinates in double precision.
- Avoid repeated destructive transformations.
- Use robust geometry predicates where possible.
- Distinguish display rounding from stored precision.
- All COGO output must respect project units and angular format.

---

## 11. COGO Tools

Build COGO as a native WebNET module.

Core COGO commands:

```txt
Inverse between two points
Bearing-distance point creation
Azimuth-distance point creation
Line-line intersection
Line-arc intersection
Arc-arc intersection
Offset line
Parallel line
Perpendicular from point
Three-point curve
Tangent curve
Curve from radius/delta/length/chord/tangent
Traverse entry
Rotate/translate/scale by control points
Best-fit 2D transformation
Grid-ground conversion
Station/offset calculations
Area and perimeter calculations
```

COGO outputs should be usable both interactively and through scripts/imports.

---

## 12. Field-to-Finish

Field-to-finish should become a major WebNET differentiator.

Create a feature-code library format, likely JSON or YAML.

Example concept:

```yaml
codes:
  EP:
    description: Edge of Pavement
    pointStyle: ep-point
    lineStyle: pavement-edge
    layer: TOPO-PAVEMENT
    figure: true
    breakline: true
    label: false

  FH:
    description: Fire Hydrant
    pointStyle: fire-hydrant-symbol
    layer: TOPO-UTIL
    symbol: fire-hydrant
    label: true
```

Feature library should support:

- Point style.
- Symbol.
- Layer.
- Line style.
- Auto-linework.
- Begin/continue/end figure commands.
- Curve commands.
- Breakline inclusion.
- Surface inclusion.
- Description translation.
- Label rules.
- Attributes.
- Offsets.
- Code aliases.
- Import profiles per data collector/export format.

Field-to-finish import pipeline:

```txt
Raw collector export
  ↓
Parse points/observations/codes
  ↓
Normalize feature codes
  ↓
Apply feature library
  ↓
Create points, figures, symbols, labels, breaklines
  ↓
Optional surface creation
  ↓
Generate import report
```

---

## 13. Model Space / Layout Space / Plotting

Implement early enough that annotation and lineweight decisions are not bolted on later.

Concepts:

```txt
Model space: real-world coordinates
Layout/paper space: sheet coordinates
Viewport: model-space view placed on paper
Annotation: model-scaled or paper-scaled
Plot style: lineweights, colors, screening, text styles
```

Minimum plotting features:

- Sheet templates.
- Title blocks.
- North arrow.
- Scale bar.
- Legend.
- Viewport scale.
- Viewport rotation.
- Layer overrides per viewport later.
- PDF export.
- Plot preview.
- Coordinate grid/ticks.
- Paper size/orientation.
- Lineweight control.
- Text style control.

Survey-specific sheet outputs:

- Survey plan.
- Control sketch.
- Topographic plan.
- Parcel plan.
- Surface/volume exhibit.
- Adjustment report exhibit.
- Network pre-analysis exhibit.

---

## 14. Surfaces, TINs, Contours, and Volumes

Do not implement this first, but design for it.

Surface model:

```txt
TinSurface
  source points
  breaklines
  boundaries
  voids
  triangles
  contours
  metadata
```

Capabilities:

- Create TIN from selected points.
- Include/exclude by point group/classification.
- Add breaklines from feature figures.
- Add boundaries.
- Remove triangles by max edge length.
- Edit/delete triangles.
- Generate contours.
- Create volume surface between two TINs.
- Cut/fill report.
- Cut/fill map later.
- Export LandXML.
- Import LandXML.

Surface calculation must be deterministic and testable.

---

## 15. Point Clouds

Point-cloud support should be phased after the CAD core and basic surfaces.

Primary use case:

- Use already-classified LAS/LAZ/COPC point clouds.
- Display point cloud.
- Filter by classification.
- Thin/sample points.
- Extract ground points.
- Create TIN/surface.
- Modify/exclude problem areas.
- Calculate volumes.

Avoid trying to build a full point-cloud classification suite. User already classifies externally.

Workflow:

```txt
Import LAS/LAZ/COPC
  ↓
Index/cache if needed
  ↓
Display with LOD
  ↓
Filter by class
  ↓
Select extraction area
  ↓
Thin/sample
  ↓
Generate points/breaklines/surface
  ↓
Edit TIN
  ↓
Compute contours/volumes
```

Browser constraints:

- Use streaming/tiling/LOD.
- Use Web Workers.
- Avoid loading huge clouds fully into main-thread memory.
- Consider optional desktop helper via Tauri or local processing for large datasets.

---

## 16. File IO Priorities

Recommended order:

1. CSV/TXT point import/export.
2. WebNET native project save/load.
3. DXF export.
4. DXF import.
5. LandXML surface/parcels import/export.
6. GeoJSON import/export.
7. PDF plotting.
8. SVG/HTML viewer export.
9. LAS/LAZ/COPC point-cloud import/viewing.
10. DWG import as optional plugin/helper.
11. DWG export only if genuinely necessary.

DWG should not block the main WebNET Survey CAD project.

---

## 17. Testing Strategy

Codex should include testing requirements in the plan.

Test types:

```txt
Unit tests for geometry
Unit tests for COGO
Unit tests for CRS/grid-ground calculations
Unit tests for parcel closure
Golden tests for DXF import/export
Golden tests for field-to-finish code libraries
Snapshot tests for project serialization
Performance tests for large drawings
Regression tests for surface/volume calculations
Manual CAD interaction test checklist
```

Critical geometry tests:

- Line-line intersection.
- Parallel lines.
- Near-parallel lines.
- Line-arc intersection.
- Arc-arc intersection.
- Tangency.
- Parcel closure.
- Area calculations.
- Offset curves.
- Bearing/distance formatting.
- Unit conversions.
- Grid/ground conversions.

---

## 18. Documentation Requirements

Codex should create or plan the following docs:

```txt
docs/webnet-survey-cad-master-plan.md
docs/webnet-survey-cad-todo.md
docs/webnet-cad-mlightcad-evaluation.md
docs/webnet-cad-licensing-notes.md
docs/webnet-cad-data-model.md
docs/webnet-cad-command-system.md
docs/webnet-cad-file-io.md
docs/webnet-cad-field-to-finish.md
docs/webnet-cad-surfaces-pointclouds.md
docs/webnet-cad-layout-plotting.md
```

At minimum, the first four should be created in the planning branch.

Important instruction:

Add this whole plan into a written roadmap and a persistent TODO list so important steps are not forgotten. The TODO list should use checkboxes and phased batches.

---

## 19. Phased Implementation Roadmap

### Phase 0: Planning and Repo Audit

Deliverables:

- Create planning branch.
- Add master plan doc.
- Add detailed TODO doc.
- Add mlightcad evaluation doc.
- Add licensing notes doc.
- Inspect current WebNET architecture.
- Identify existing point/line/polygon/label/error ellipse modules.
- Identify where new CAD workspace should live.
- Identify current persistence format.
- Identify current CRS handling.
- Identify existing basemap integration.

Acceptance criteria:

- No major implementation yet.
- Plan is clear enough for later agentic coding.
- Risks and licensing issues are documented.
- Next implementation spike is obvious.

### Phase 1: CAD Kernel and Data Model

Deliverables:

- Define base CAD/survey entity model.
- Define layer/style model.
- Define transaction model.
- Define undo/redo architecture.
- Define entity ID strategy.
- Define serialization shape.
- Add tests for geometry primitives.
- Add early COGO module.

Acceptance criteria:

- Native WebNET model exists independently of renderer.
- Basic entities can be serialized and deserialized.
- Unit tests exist for core geometry.

### Phase 2: Rendering Adapter and mlightcad Spike

Deliverables:

- Build renderer interface.
- Prototype mlightcad adapter.
- Render WebNET points/lines/polygons/labels/error ellipses.
- Map selections back to WebNET IDs.
- Test layer visibility.
- Document what worked and what failed.
- Decide whether to continue with mlightcad renderer, fork/adapt parts, or build custom renderer.

Acceptance criteria:

- Renderer does not own project data.
- Spike produces a clear go/no-go decision.
- No licensing ambiguity remains for the evaluated path.

### Phase 3: Command System, Selection, and Snapping

Deliverables:

- Command state machine framework.
- Selection set.
- Basic grips.
- Snap manager.
- Spatial index.
- Initial commands: point, line, polyline, move, copy, erase, inverse.
- Undo/redo working.

Acceptance criteria:

- CAD editing feels coherent.
- Commands are testable.
- Snaps are accurate and visually clear.
- Undo/redo handles multi-entity edits.

### Phase 4: COGO and Parcel Foundation

Deliverables:

- Bearing/distance tools.
- Traverse entry.
- Intersections.
- Offsets.
- Curves.
- Parcel entity.
- Parcel closure report.
- Line/curve labels.

Acceptance criteria:

- User can create a basic survey parcel from COGO.
- Closure, area, perimeter, bearings, and distances are reportable.
- Labels are tied to entities and update when geometry changes.

### Phase 5: Point Import and Field-to-Finish

Deliverables:

- Point file import.
- Feature code parser.
- Feature library format.
- Auto point styles.
- Auto symbols.
- Auto figures/linework.
- Auto labels.
- Import report.

Acceptance criteria:

- User can import a collector-style point file and get styled points/linework/labels.
- Feature library is editable and versioned.
- Import is repeatable and auditable.

### Phase 6: Layout Space and Plotting

Deliverables:

- Layout model.
- Sheet templates.
- Viewports.
- Scale control.
- Title blocks.
- North arrow/scale bar.
- PDF export.
- Plot preview.
- Basic lineweights.

Acceptance criteria:

- User can produce a simple final survey deliverable PDF.
- Model space and paper space are clearly separated.
- Viewport scale/rotation works.

### Phase 7: DXF/LandXML/Geo Formats

Deliverables:

- DXF export.
- DXF import.
- LandXML surface/parcel support.
- GeoJSON export.
- Optional GeoPackage/FlatGeobuf support.
- Golden file tests.

Acceptance criteria:

- Interop with Civil 3D and common survey/GIS workflows is usable.
- Native WebNET metadata is not lost when using native project files.
- Exchange formats are treated as exchange formats.

### Phase 8: Surfaces, Contours, and Volumes

Deliverables:

- TIN creation from points.
- Breakline support.
- Boundary support.
- Contours.
- Basic TIN editing.
- Volume between surfaces.
- Cut/fill report.
- LandXML surface export.

Acceptance criteria:

- User can create a usable survey surface.
- User can calculate a cut/fill quantity.
- Results are deterministic and test-covered.

### Phase 9: Point Cloud Viewer and Extraction

Deliverables:

- Point-cloud layer model.
- LAS/LAZ/COPC import/viewing plan.
- LOD/streaming approach.
- Classification filter.
- Area extraction.
- Thinning.
- Surface creation from classified ground points.

Acceptance criteria:

- Already-classified point cloud can be viewed and used to create surfaces.
- Large files do not freeze the main UI.
- Workflow is practical for survey volumes/topo work.

### Phase 10: Desktop/Native Helper Option

Deliverables:

- Evaluate Tauri wrapper.
- Evaluate local helper for heavy CRS/point-cloud/DWG tasks.
- Define plugin boundary.
- Keep web app functional without desktop-only features where possible.

Acceptance criteria:

- Browser-first architecture remains intact.
- Desktop helper is additive, not a rewrite.

---

## 20. Detailed TODO List Format

Create `docs/webnet-survey-cad-todo.md` with phased checkboxes.

Use this structure:

```md
# WebNET Survey CAD TODO

## Phase 0: Planning
- [ ] Create branch
- [ ] Add master plan
- [ ] Add mlightcad evaluation
- [ ] Add licensing notes
- [ ] Audit existing WebNET geometry modules
- [ ] Audit existing CRS handling
- [ ] Audit existing persistence

## Phase 1: Core Model
- [ ] Define BaseEntity
- [ ] Define SurveyPoint
- [ ] Define Line/Arc/Polyline
- [ ] Define Layer/Style
- [ ] Define transaction model
- [ ] Add serialization tests
...
```

Each phase should include:

- Tasks.
- Acceptance criteria.
- Risks.
- Notes.
- Links to relevant docs.
- Decision records where needed.

---

## 21. Decision Records

Codex should propose using lightweight ADRs if the repo does not already have them.

Example:

```txt
docs/decisions/
  0001-webnet-cad-source-of-truth.md
  0002-renderer-strategy.md
  0003-dwg-license-boundary.md
  0004-native-project-format.md
  0005-point-cloud-processing-strategy.md
```

Each ADR should include:

```md
# ADR Title

## Status
Proposed / Accepted / Rejected / Superseded

## Context

## Decision

## Consequences

## Alternatives Considered
```

---

## 22. Risk Register

Codex should include a risk register in the master plan.

Initial risks:

| Risk | Severity | Mitigation |
|---|---:|---|
| External CAD viewer data model becomes too central | High | Keep WebNET model authoritative |
| GPL dependency accidentally changes project licensing expectations | High | Isolate DWG plugin and document licenses |
| Snapping/commands become UI spaghetti | High | Command state machines and transactions |
| DXF/DWG interop consumes all development time | High | Prioritize native model + DXF first, DWG optional |
| Point clouds freeze browser | High | Stream/LOD/workers/optional desktop helper |
| Surfaces produce unreliable results | High | Deterministic algorithms + tests |
| Layout plotting is bolted on too late | Medium | Include layout model early |
| COGO precision bugs hurt trust | High | Unit tests, golden tests, audit trails |
| App becomes as bloated as Civil 3D | Medium | Survey-first scope control |

---

## 23. Immediate Codex Output Expected

At the end of the first Codex pass, the branch should contain planning files only, unless a tiny repo-inspection script is useful.

Expected files:

```txt
docs/webnet-survey-cad-master-plan.md
docs/webnet-survey-cad-todo.md
docs/webnet-cad-mlightcad-evaluation.md
docs/webnet-cad-licensing-notes.md
```

Each file should be detailed enough that future Codex sessions can pick a phase and implement it without rediscovering the entire context.

The TODO file must contain detailed phased checkboxes so the project does not lose important tasks over time.

The mlightcad evaluation doc must explicitly answer:

- Can it be embedded without rewriting WebNET UI?
- Which packages are useful?
- Which packages are Vue-specific?
- Can WebNET keep its own model?
- Can selection map back to WebNET IDs?
- How is model/layout space handled?
- How are DXF and DWG parsed?
- What are the licensing implications?
- Should WebNET reuse it, fork it, adapt parts, or only use it as reference?

The licensing notes doc must explicitly answer:

- What is MIT?
- What is GPL?
- What happens if GPL DWG functionality is used?
- What README/license changes are required?
- Should DWG be optional?

---

## 24. Practical First Implementation After Planning

After the planning branch is reviewed and merged, the next branch should likely be:

```bash
git checkout -b spike/mlightcad-renderer-adapter
```

Goal of that spike:

- Load existing WebNET project geometry.
- Render it through an adapter.
- Keep native WebNET IDs.
- Select/highlight entities.
- Toggle layers.
- Test a DXF import/export loop.
- Write a short decision record.

Do not begin surfaces, point clouds, layouts, and field-to-finish until the command/model/rendering foundation is stable.

---

## 25. Final Guidance to Codex

Be conservative with the architecture and aggressive with documentation.

The biggest success factor is not quickly drawing a line in the browser. The biggest success factor is creating a clean, survey-native model that can support many years of CAD, COGO, parcel, surface, field-to-finish, and adjustment workflows without becoming tangled in a renderer or third-party CAD viewer's assumptions.

Prioritize:

1. Native WebNET source-of-truth model.
2. Clean command/transaction system.
3. Accurate geometry and COGO.
4. Renderer as replaceable adapter.
5. Survey-specific workflows.
6. Detailed phased TODOs.
7. Licensing clarity.

Do not build a generic CAD clone. Build a lean professional land surveying CAD environment integrated with WebNET's least-squares and survey-planning strengths.

---

## 26. Source Links for Codex to Review

Review these during planning:

- `mlightcad/cad-viewer`: https://github.com/mlightcad/cad-viewer
- `mlightcad/cad-simple-viewer-example`: https://github.com/mlightcad/cad-simple-viewer-example
- `mlightcad/cad-viewer-example`: https://github.com/mlightcad/cad-viewer-example
- `mlightcad/libredwg-web`: https://github.com/mlightcad/libredwg-web
- LibreDWG GNU page: https://www.gnu.org/software/libredwg/
- LibreDWG GitHub mirror: https://github.com/LibreDWG/libredwg
- TypeScript: https://www.typescriptlang.org/
- Three.js: https://threejs.org/
- MapLibre: https://maplibre.org/
- OpenLayers: https://openlayers.org/
- PROJ: https://proj.org/
- GeographicLib: https://geographiclib.sourceforge.io/
- SQLite WASM/OPFS docs: https://sqlite.org/wasm/doc/trunk/persistence.md
- COPC: https://copc.io/
- Potree: https://github.com/potree/potree
- PDAL: https://pdal.io/
