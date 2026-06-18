# WebNet CAD Command System

## Purpose
Define the command-first editing posture for Survey CAD.

## Core rules
- commands are state machines
- commands own preview/cancel/commit flow
- UI buttons invoke commands; they do not embed geometry logic directly
- undo/redo boundaries align with command commits

## Base command lifecycle

```txt
idle
  -> start
  -> collect input(s)
  -> preview
  -> commit or cancel
```

Current implemented spike slice:
- selection-set state over native entity IDs
- command registry/history seam
- first committed commands: `SELECT_ALL`, `CLEAR_SELECTION`, `ERASE`, `POINT`, `COGO_POINT`, `LINE`, `PLINE`, `ARC_3PT`, split-button arc creation modes (`Start Center End`, `Start Center Angle`, `Start Center Length`, `Start End Angle`, `Start End Direction`, `Start End Radius`, `Continue Curve`), `TANGENT_CURVE`, `MOVE`, `COPY`, `INTERSECT_POINT`
- first traverse-entry command: `TRAVERSE`
- first alignment-promotion command: `ALIGNMENT_CREATE` from a selected native line/arc chain
- first alignment-offset command: `ALIGNMENT_OFFSET_CREATE` from a selected native alignment plus typed `offset` or `NAME=offset`
- first alignment station-report command: `ALIGNMENT_STATION_REPORT` from a selected native alignment + point pair
- first alignment station-equation command: `ALIGNMENT_STATION_EQUATION` from a selected native alignment plus typed `backStation,aheadStation`
- first alignment station-offset point command: `ALIGNMENT_OFFSET_POINT` from a selected native alignment plus typed `station,offset`
- first alignment station-interval point command: `ALIGNMENT_INTERVAL_POINTS` from a selected native alignment plus typed `interval` or `start,end,interval`
- first parcel-promotion command: `PARCEL_CREATE` from a selected native polyline/traverse seam
- first interactive query command: `INVERSE`
- point-line COGO toolbar family now adds `MULTI_INVERSE`, bearing-only and distance-only reports, turned-angle point creation, and selected-line deflection / point-along / extend / offset-point tools on the same command-input/report seam
- intersection toolbar family now extends `INTX` with bearing-bearing, bearing-distance, distance-distance, selected-line line-circle/perpendicular/skew, and selected-two-line offset-intersection calculators, while keeping deterministic alternative ordering in the shared COGO report overlay
- curve toolbar family now adds `CURVE_SOLVER`, selected-arc radial-bearing / point-on-curve / subdivision / offset tools, typed `PI_CURVE` and `CHORD_BEARING_CURVE` constructors, plus selected-arc `REVERSE_CURVE` and `COMPOUND_CURVE` continuation workflows on the same command-input/report seam
- deed-entry toolbar flow now adds `DEED` / `BATCH_COGO`, which opens a native batch panel for pasted `START`, bearing-distance, and tangent-curve rows, previews parsed rows plus generated point/line/arc geometry before commit, and persists the committed batch as one shared COGO computation
- selection-driven toolbar flow now also adds `ALIGN`, which validates a selected open line/arc chain, snapshots it into a native alignment entity, and persists a shared COGO report/provenance record for later stationing work
- selection-driven toolbar flow now also adds `ALIGN OFF`, which starts a typed offset-alignment command from a selected native alignment, previews the derived line/arc chain, and commits a new native alignment plus shared COGO provenance/history when the offset can be resolved continuously
- selection-driven toolbar flow now also adds `STA`, which projects a selected survey point onto a selected native alignment, reports station/offset plus projected coordinates, and persists that stationing result through the shared COGO history seam
- selection-driven toolbar flow now also adds `STA EQ`, which starts a typed station-equation command from a selected native alignment, persists the resolved raw-station break plus displayed back/ahead station values onto the alignment, and feeds those equations back into later station-report, station-point, and station-interval commands
- selection-driven toolbar flow now also adds `STA PT`, which starts a typed station-offset point command from a selected native alignment, previews the resolved point, and persists the created point plus report rows through the shared history seam
- selection-driven toolbar flow now also adds `STA INT`, which starts a typed station-interval point command from a selected native alignment, previews the generated point set, and persists the created points plus summary rows through the shared history seam
- undo/redo replay over snapshot-backed transaction entries
- project-level COGO computation history stored separately from undo/redo, with structured report rows and provenance for command-created COGO geometry
- selected/latest COGO overlay now surfaces persisted command reports plus live `INVERSE` query reports, with TXT/CSV/Markdown export-preview formatting kept separate from the underlying CAD state
- typed coordinate input plus `@azimuth,distance` and survey bearing-distance input after a first point
- active `TRAVERSE` drafting now exposes a right-side draft editor with append/edit/insert/reorder leg rows, open/closed/point-to-point mode toggles, selected-point close targets, closure metrics, panel-native finish/cancel controls, and sideshot rows while still committing through the same command-history seam
- that same traverse draft editor now also exposes angular-balance, Bowditch, and transit adjustment controls against the active closure target, and committed adjusted traverses persist the chosen method plus closure rows into shared COGO history
- tangent-curve radius entry after snapped or typed PI/back/ahead points
- split arc tool with default `ARC` + dropdown modes similar to survey/Civil workflows
- `Ctrl` acts as reverse-direction modifier for the supported arc constructors
- inverse status now reports distance, azimuth, and survey bearing together
- COGO-producing command commits now preserve `metadata.createdBy` and add structured COGO provenance metadata to created geometry where applicable
- dedicated workspace viewport controls now follow direct CAD-style interaction: wheel zoom, middle-mouse pan, middle-double-click zoom extents, click selection, and left-to-right window vs right-to-left crossing drag-box selection
- command commit/cancel now leans on direct picks plus keyboard flow: viewport clicks capture points, `Enter` submits typed input or finishes `PLINE` on an empty prompt, and `Escape` cancels the active command or clears selection
- in-progress commands now paint live preview geometry in the viewport for line/polyline/curve and translate-style edit flows before commit
- committed and previewed arcs now render as true SVG arc paths instead of sampled line strips
- command help, snap state, and the active command text input now live inside the CAD viewport as bottom-corner / bottom-center overlays instead of a separate status panel
- active commands now capture direct keyboard typing without requiring the operator to click the command input first, and basic CAD shortcuts now include keyboard copy/paste plus undo/redo
- selection-only changes now stay out of the undo/redo transaction stack, so `Undo` replays actual entity edits instead of selection state
- viewport pick math now accounts for letterboxed SVG fitting, so snapped or free picks stay under the cursor across the full visible window instead of drifting away from screen center
- the CAD camera basis now stays stable through entity creation/edit commits; operators only reframe intentionally through explicit zoom-extents behavior
- keyboard `Undo` / `Redo` now stays active even when the last focused control was a toolbar button, so direct viewport draw commits can still be reversed immediately with `Ctrl/Cmd+Z`
- keyboard paste now uses a real insertion-point workflow: `Ctrl/Cmd+V` starts a `PASTE` command from the copied geometry's base point, shows live preview geometry, and waits for a click or typed insertion point before commit
- idle generic helper copy is now removed from the lower-left viewport so the command bar placeholder carries the generic input reminder instead
- object snaps are now operator-toggleable from a viewport `Snaps` drop-up menu instead of a fixed status sentence, and selection hit targets for native points/lines/ellipses are intentionally wider than the visible geometry
- the dedicated CAD page shell no longer wraps the viewport in framed brown-ish bars; the toolbar sits on the same dark-blue surface and the snap/command UI remains overlaid in the viewport
- selected native traverse/polyline geometry can now be promoted into a parcel entity with stored area, perimeter, and closure metrics plus centered stacked parcel area/perimeter text; traverse segment labels render upright and traverse-created point nodes do not add anchored coordinate/station text labels
- selected parcel entities now surface a geometry-derived closure report overlay with area, perimeter, closure values, and ordered azimuth-distance course rows without persisting extra report entities into the CAD model
- committed `TRAVERSE` segments now render survey-style annotation overlays with north-azimuth text above the segment and metric distance below it, aligned to the segment direction
- committed native arc entities now render geometry-derived labels at the curve itself (delta, radius, and arc length) without introducing persisted CAD text entities, while ordinary `LINE` geometry remains unlabeled

## Initial command families
- `POINT`
- `LINE`
- `PLINE`
- `ARC_3PT`
- `TANGENT_CURVE`
- `MOVE`
- `COPY`
- `ERASE`
- `INVERSE`
- `COGO_LINE_BY_BEARING_DISTANCE`
- `COGO_INTERSECTION`
- `PARCEL_CREATE`
- `LABEL_POINT`
- `LABEL_LINE`

## Required subsystems
- command registry
- command history
- prompt/status messaging
- coordinate input
- bearing/distance input
- snap integration
- preview overlay channel
- transaction manager

## Input modes
- mouse/touch picks
- typed coordinates
- typed bearing/distance
- future: ortho/polar/station-offset helpers

## Future command batches
- `OFFSET`
- `ROTATE`
- `SCALE`
- `TRAVERSE`
- `JOIN`
- `TRIM`
- `EXTEND`
- `PARCEL_CLOSE`
- `IMPORT_POINTS`
- `IMPORT_DXF`
- `EXPORT_DXF`
