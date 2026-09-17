# WebNet CAD Modernization Roadmap

## Goal

Turn Survey CAD from an adjustment-workspace mode into a professional, document-centric surveying CAD application with its own route, controller, persistence, drawing lifecycle, UI shell, and exchange adapters.

The target interaction model should feel familiar to users of Civil 3D, Carlson Survey, TBC, and conventional desktop CAD without copying any one product verbatim.

## Core architectural direction

WebNet should expose three application surfaces:

- `/` — WebNet Adjustment
- `/cad` — WebNet CAD
- `/study` — WebNet Study

CAD should not be an `activeTab` inside the adjustment application. The CAD application should own its own document state and only communicate with Adjustment through explicit bridges such as **Send/Import Adjusted Points** and stored adjustment-source links.

A CAD drawing is a first-class document. Each drawing owns its own:

- filename / save target / dirty state
- drawing units and coordinate system
- layer table
- linetype and lineweight definitions
- blocks / symbols
- point / label / annotation styles
- CAD entities
- surfaces / parcels / COGO state
- layouts / sheets / viewports
- undo / redo history
- view state
- external/source links

Opening or switching an Adjustment project must not silently replace or mutate an open CAD drawing.

## UI target

The CAD shell should become document-centric rather than adjustment-centric. A mature target layout is:

- application/menu bar
- compact ribbon / command tabs
- drawing file tabs
- central model/paper-space viewport
- dockable Toolspace on the left
- dockable Properties / Layers / other palettes on the right
- model/layout tabs
- persistent command line / history
- CAD status bar with snaps, ortho, polar, etc.

### Initial Toolspace model

Suggested collections:

- Points
- Point Groups
- Figures
- Surfaces
- Parcels
- Alignments
- COGO
- Field to Finish
- Layers
- Blocks / Symbols
- External References
- Layouts
- Adjustment Sources

Suggested Toolspace tabs:

- Prospector
- Survey
- Settings

## OpenCADStudio posture

OpenCADStudio is a useful behavioral and architectural reference for:

- file tabs
- docking / palettes
- Properties
- layer management
- blocks
- external references
- model / paper space
- viewports
- snapping / tracking
- DWG / DXF workflows

Do not copy its GPL-3.0 application/UI code into WebNet without an explicit licensing decision.

Its lower-level `cadcodec` and `cadkernel` projects are separately MPL-2.0 and may be evaluated later as technical dependencies for DWG/DXF/geometry work.

WebNet's native CAD/survey document remains the source of truth. External CAD libraries are adapters, not authoritative project models.

## Staged roadmap

### Stage 1 — CAD application extraction

Create `/cad` as a separate application surface with its own `CadApp` / controller. Remove `SurveyCadWorkspace` from the Adjustment workspace-tab lifecycle. Establish independent CAD document state, persistence, file lifecycle, and an explicit Adjustment-to-CAD bridge.

This stage should preserve the existing CAD engine and user-facing CAD behavior as much as possible; it is an architectural extraction, not yet the large UI rewrite.

### Stage 2 — Professional CAD shell

Implement the application frame:

- drawing file tabs
- menu / compact ribbon
- docking framework
- Toolspace
- Properties palette
- Layer Manager palette
- command line and history
- model/layout tabs
- status bar
- persisted workspace layout

### Stage 3 — Drawing standards foundation

Introduce mature CAD styling/configuration:

- layer properties: on/freeze/lock/plot/color/linetype/lineweight/transparency/description/viewport freeze
- ByLayer / ByBlock / explicit entity properties
- real linetype definitions
- blocks / survey symbols
- text styles
- dimension styles
- point styles
- point label styles
- parcel/surface/contour/label style systems

### Stage 4 — Survey application UX

Build survey-first management around the new shell:

- Prospector / Survey / Settings Toolspace
- point groups
- COGO management
- F2F management
- drawing settings / CRS / units
- adjustment-source manager
- source refresh / dependency status

### Stage 5 — Surface system

Build a proper survey TIN workflow:

- surface definition/history
- point groups
- breaklines
- boundaries
- contours
- TIN edits
- surface styles
- statistics / analysis
- spot elevations / slopes
- volume surfaces

### Stage 6 — CAD interoperability

Strengthen exchange and native-file workflows:

- robust DXF read/write
- DWG technical/licensing evaluation and adapter
- external references
- block interoperability
- LandXML improvements
- evaluate DGN separately rather than assuming support

### Stage 7 — Layout and production polish

Complete professional drafting/deliverable workflows:

- plot/layout management
- title blocks
- sheet manager
- publishing
- workspace customization
- shortcuts
- printing/PDF
- large-drawing responsiveness

## Guardrails

- Do not throw away the existing CAD engine simply to redesign the shell.
- Preserve existing command, geometry, snapping, COGO, parcel, F2F, layout, export, and dependency-integrity work unless evidence requires a replacement.
- Keep Adjustment and CAD data ownership separate.
- Keep the Adjustment-to-CAD bridge explicit.
- Do not make DWG/DXF parser models the WebNet document model.
- Do not chase pixel-level Civil 3D cloning; copy proven CAD interaction patterns.
- Do not add more solver/performance work as part of this roadmap.

## Immediate next step

Stage 1 should begin with the current post-Phase-17E `main` and deliver a separate `/cad` application boundary before the major UI shell overhaul.
