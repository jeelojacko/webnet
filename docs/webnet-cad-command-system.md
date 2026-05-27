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
- first committed commands: `SELECT_ALL`, `CLEAR_SELECTION`, `ERASE`, `POINT`, `COGO_POINT`, `LINE`, `PLINE`, `ARC_3PT`, `TANGENT_CURVE`, `MOVE`, `COPY`, `INTERSECT_POINT`
- first traverse-entry command: `TRAVERSE`
- first interactive query command: `INVERSE`
- undo/redo replay over snapshot-backed transaction entries
- typed coordinate input plus `@azimuth,distance` and survey bearing-distance input after a first point
- tangent-curve radius entry after snapped or typed PI/back/ahead points
- inverse status now reports distance, azimuth, and survey bearing together
- dedicated workspace viewport controls now follow direct CAD-style interaction: wheel zoom, middle-mouse pan, middle-double-click zoom extents, click selection, and left-to-right window vs right-to-left crossing drag-box selection
- command commit/cancel now leans on direct picks plus keyboard flow: viewport clicks capture points, `Enter` submits typed input or finishes `PLINE` on an empty prompt, and `Escape` cancels the active command or clears selection
- in-progress commands now paint live preview geometry in the viewport for line/polyline/curve and translate-style edit flows before commit
- command help, snap state, and the active command text input now live inside the CAD viewport as bottom-corner / bottom-center overlays instead of a separate status panel
- active commands now capture direct keyboard typing without requiring the operator to click the command input first, and basic CAD shortcuts now include keyboard copy/paste plus undo/redo
- selection-only changes now stay out of the undo/redo transaction stack, so `Undo` replays actual entity edits instead of selection state
- viewport pick math now accounts for letterboxed SVG fitting, so snapped or free picks stay under the cursor across the full visible window instead of drifting away from screen center
- the CAD camera basis now stays stable through entity creation/edit commits; operators only reframe intentionally through explicit zoom-extents behavior
- keyboard `Undo` / `Redo` now stays active even when the last focused control was a toolbar button, so direct viewport draw commits can still be reversed immediately with `Ctrl/Cmd+Z`
- keyboard paste now uses a real insertion-point workflow: `Ctrl/Cmd+V` starts a `PASTE` command from the copied geometry's base point, shows live preview geometry, and waits for a click or typed insertion point before commit
- idle generic helper copy is now removed from the lower-left viewport so the command bar placeholder carries the generic input reminder instead
- object snaps are now operator-toggleable from a viewport `Snaps` drop-up menu instead of a fixed status sentence, and selection hit targets for native points/lines/ellipses are intentionally wider than the visible geometry

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
