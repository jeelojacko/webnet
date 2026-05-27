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
- first committed commands: `SELECT_ALL`, `CLEAR_SELECTION`, `ERASE`, `POINT`, `COGO_POINT`, `LINE`, `PLINE`, `MOVE`, `COPY`, `INTERSECT_POINT`
- first interactive query command: `INVERSE`
- undo/redo replay over snapshot-backed transaction entries
- typed coordinate input plus `@azimuth,distance` and survey bearing-distance input after a first point
- inverse status now reports distance, azimuth, and survey bearing together

## Initial command families
- `POINT`
- `LINE`
- `PLINE`
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
