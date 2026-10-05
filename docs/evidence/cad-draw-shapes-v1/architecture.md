# CAD Draw Shapes V1 — Architecture

Branch `feat/cad-draw-shapes-v1`, baseline `main e3f75550` (PR #169 merge).
All work below is uncommitted in the worktree. **DO NOT MERGE** pending
external review. 14 stashes preserved.

## Claim

Two production draw commands, `RECTANGLE` and `POLYGON`, commit the existing
`CadPolygonEntity` geometry through the standard command registry → session →
undo/history path. No new entity type, no schema/migration, no appearance
override. `Circle` / `Best Fit` / `Ellipse` / `Hatch` rows stay honestly
planned.

## Builders module

`src/engine/cad/cadGeometryShapeBuilders.ts` (67 lines, pure, no React/store
import):

- `MAX_SHAPE_POLYGON_SIDES = 1024`, `MIN_SHAPE_POLYGON_SIDES = 3`,
  `RegularPolygonMode = 'inscribed' | 'circumscribed'`.
- `buildRectangleVertices(first, opposite)`: canonical axis-aligned CCW
  4-ring via min/max normalization, so the drag quadrant does not change the
  result; `null` on non-finite input or a span `<= CAD_XY_DEGENERATE_FLOOR`
  (1e-12).
- `buildRegularPolygonVertices(center, through, sides, mode)`: `inscribed` →
  `through` is a vertex at radius `|CP|`, start angle `theta`; `circumscribed`
  → `through` is the apothem foot (first edge midpoint), radius
  `|CP| / cos(pi/sides)`, start angle `theta - pi/sides`. Rejects non-integer
  or out-of-range `sides`, degenerate radius, non-finite points.
- The `1e-12` floor is reused from the neighboring geometry authority
  (`cadGeometry.ts`); the comment records that alternatives such as
  surfaces/volume `zero.ts` are a different (delta-Z earthwork) domain.

## Command / registry shape

- `cadTransactions.types.ts`: `CadCommandKey` gains
  `'RECTANGLE' | 'POLYGON'`; `CadCommand` union gains both shape commands.
- `cadTransactionsShapeCommands.ts` (109 lines): `ShapeRectangleCommand
  { firstCorner, oppositeCorner }`, `ShapePolygonCommand { center, through,
  sides, mode }`. `rectangleCommand` / `polygonCommand` execute by building
  vertices, `appendCadProjectEntities`, `createCadSelectionState([id])`.
  Invalid shapes return `null` (history untouched). Entity metadata is
  `{ createdBy, entityName (RECT*/POLY*), manual: true }`; layer from
  `resolveCurrentCadLayerId`; deliberately **no** `styleId`.
- Polygon rings store no duplicate closure vertex — the ring is implicitly
  closed.
- `cadTransactions.ts`: `shapeCommandDefinitions` merged into
  `CAD_COMMAND_REGISTRY` under `RECTANGLE` / `POLYGON`.

## Session / preview shape

- `useSurveyCadCommandTypes.ts` `CommandSession` union:
  - `RECTANGLE { inputValue, firstCorner, resultText? }`
  - `POLYGON { inputValue, phase: 'sides'|'mode'|'center'|'radius', sides,
    mode, center, resultText? }`
- `useSurveyCadCommandStarters.ts`: `startRectangleCommand` (firstCorner
  null), `startPolygonCommand` (phase `'sides'`).
- `useSurveyCadShapeSubmit.ts` (102 lines): typed-input state machine. Sides
  parsed by `/^\d+$/` then range check; mode `'' | I | INSCRIBED` →
  `inscribed`, `C | CIRCUMSCRIBED` → `circumscribed`. Invalid input sets
  `resultText` and keeps the same phase. Rectangle corners and polygon
  center/radius reuse `parseInputPoint` — the same parser used by `LINE` and
  neighbors, so `x,y`, `LABEL=x,y`, `@azimuth,distance`, and bearing-distance
  forms all work.
- `useSurveyCadConsumePoint.ts` `handleShapePointPick`: stages
  `firstCorner` / `center` with **zero** history mutation; second pick runs
  `runCadCommand` and clears the session. A degenerate pick keeps the session
  with a readable `resultText`.
- `useSurveyCadCommandPreview.ts`: preview calls the **same** builders and
  returns `points: [...vertices, vertices[0]]`, so the drawn preview ring
  equals the committed vertices plus closure. `null` until a first corner /
  center is present, or sides+mode are known.
- `useSurveyCadCommandSession.ts` `sessionExpectsPointPick`: `RECTANGLE`
  always; `POLYGON` only in `center` / `radius`.
- Prompt/help wording in `useSurveyCadCommandText.ts` and
  `useSurveyCadCommandHelpText.ts`.

## Ribbon wiring

- `cadCommandRegistry.ts`: two Draw-family session rows — `RECTANGLE`
  "Rectangle", `POLYGON` "Polygon".
- `cadRibbonToolFamilies.ts` `shapes` family: `defaultVariantId`
  `'shapes-rectangle'`; both variants now carry `commandKey` and the
  `planned` flag is removed. `Circle` / `Best Fit` / `Ellipse` / `Hatch`
  untouched.
- `SurveyCadWorkspace.tsx`: starter map adds `RECTANGLE` → `startRectangle`,
  `POLYGON` → `startPolygon`.

## Closing-segment property fix

`cadProperties.ts` `segmentRows` previously did `slice(0, -1)` for both
polylines and polygons, so a polygon's implicit last→first closing edge had
no `Segment N` property row. The fix makes polygon emit all `N` ring edges
with index wrap `(index + 1) % vertices.length`; polyline stays `N-1`. The
comment records the implicit-ring contract. Covered by
`cad_polygon_closing_segment_v1.test.ts` (polygon closing row + perimeter
sum, polyline unchanged).

## Files changed / added (all uncommitted)

| File | Change |
|------|--------|
| `src/engine/cad/cadGeometryShapeBuilders.ts` | NEW — pure rectangle/regular-polygon builders + guards |
| `src/engine/cad/cadTransactionsShapeCommands.ts` | NEW — `RECTANGLE`/`POLYGON` engine commands |
| `src/hooks/surveyCad/useSurveyCadShapeSubmit.ts` | NEW — typed shape-input state machine |
| `src/engine/cad/cadTransactions.types.ts` | `CadCommandKey` + `CadCommand` shape variants |
| `src/engine/cad/cadTransactions.ts` | registry entries |
| `src/engine/cad/cadProperties.ts` | polygon closing-edge segment rows |
| `src/hooks/surveyCad/useSurveyCadCommandTypes.ts` | `CommandSession` shape variants |
| `src/hooks/surveyCad/useSurveyCadCommandStarters.ts` (+`.types.ts`) | shape starters |
| `src/hooks/surveyCad/useSurveyCadConsumePoint.ts` | point-pick staging/commit |
| `src/hooks/surveyCad/useSurveyCadCommandPreview.ts` | preview parity |
| `src/hooks/surveyCad/useSurveyCadCommandSession.ts` | pick gating |
| `src/hooks/surveyCad/useSurveyCadCommandText.ts` | prompts |
| `src/hooks/surveyCad/useSurveyCadCommandHelpText.ts` | help text |
| `src/hooks/surveyCad/useSurveyCadCommandLifecycle.ts` | empty-input mode default |
| `src/hooks/surveyCad/useSurveyCadCommandConstruction.ts` | snap/construction base point |
| `src/hooks/surveyCad/useSurveyCadTypedSubmit.ts` | dispatch to shape submit |
| `src/hooks/surveyCad/useSurveyCadWorkspace.ts` (+`.types.ts`) | expose starters |
| `src/hooks/surveyCad/useSurveyCadCommands.types.ts` | result interface |
| `src/cad-app/shell/cadCommandRegistry.ts` | Draw rows |
| `src/cad-app/shell/cadRibbonToolFamilies.ts` | shapes family unplanned |
| `src/components/SurveyCadWorkspace.tsx` | starter map |

Tests: `cad_geometry_shapes_v1.test.ts`,
`cad_shapes_transactions_v1.test.ts`,
`cad_shapes_command_sessions_v1.test.tsx`,
`cad_polygon_closing_segment_v1.test.ts`, plus
`cad_ribbon_tool_families.test.ts` (2 assertions updated). Browser:
`tests-browser/cad-draw-shapes-v1.spec.ts`.
