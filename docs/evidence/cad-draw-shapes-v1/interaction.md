# CAD Draw Shapes V1 — Interaction Contract

Exact prompts/help strings below are read from
`useSurveyCadCommandText.ts` and `useSurveyCadCommandHelpText.ts`. Behaviors
are covered by `cad_shapes_command_sessions_v1.test.tsx` and the browser spec.

## RECTANGLE — 2-pick flow

1. **Start** (`startRectangleCommand`, session `firstCorner = null`).
   - Prompt: `RECTANGLE active. Click or enter the first corner.`
   - Help: `RECTANGLE first corner: click in the model space or type \`x,y\` / \`LABEL=x,y\`.`
   - `sessionExpectsPointPick = true`.
2. **First pick** (viewport click, or typed `x,y` / `LABEL=x,y`).
   - Stages `firstCorner`; **no** history entry (the session test asserts
     `updates === 0` and the same project object reference).
   - Prompt: `RECTANGLE active. First corner <label> captured. Click or enter the opposite corner.`
   - Help adds `@azimuth,distance` / `N45-00-00E,100` from the first corner.
3. **Second pick** (click or typed absolute/relative/bearing point).
   - Builder runs; on success one `runCadCommand('RECTANGLE', …)` commits a
     4-vertex CCW polygon and the session is cleared.
   - Degenerate opposite corner (zero width or height): session stays open,
     `resultText = RECTANGLE corners degenerate. Pick a distinct opposite corner.`,
     zero mutation.
   - Invalid typed corner: `resultText = RECTANGLE corner invalid. Use \`x,y\`,
     \`LABEL=x,y\`, \`@azimuth,distance\`, or survey bearing-distance like
     \`N45-00-00E,100\`.` (first-pick variant omits the relative forms).

## POLYGON — 4-stage flow

Stage progression is `sides → mode → center → radius`.

1. **sides** (`startPolygonCommand`, phase `'sides'`).
   - Prompt: `POLYGON active. Enter the number of sides (3-1024).`
   - Help: `POLYGON sides: enter an integer 3-1024.`
   - No point pick (`sessionExpectsPointPick = false`).
   - Accepts integer `3..1024`; advances to `mode`.
   - Reject (`2`, `1025`, `4.5`, `0`, `-3`, `abc`, empty):
     `POLYGON sides invalid. Enter an integer 3-1024.`, stays in `sides`.
2. **mode**.
   - Prompt: `POLYGON active. <N> sides. Inscribed or Circumscribed? [I/C] <I>.`
   - Help: `POLYGON mode: enter \`I\` for Inscribed or \`C\` for Circumscribed (empty = Inscribed).`
   - Empty input is a legitimate default here: `useSurveyCadCommandLifecycle.ts`
     submits it, and the empty string parses to `inscribed` (Enter on an
     empty field defaults to Inscribed).
   - Accepts `''` / `I` / `INSCRIBED` → `inscribed`; `C` / `CIRCUMSCRIBED`
     → `circumscribed`. Advances to `center`.
   - Reject: `POLYGON mode invalid. Enter \`I\` for Inscribed or \`C\` for
     Circumscribed (empty = Inscribed).`
   - Dock alias: at the `mode` stage `I` routes to the POLYGON session; idle
     `I` still resolves to INSERT.
3. **center**.
   - Prompt: `POLYGON active. <N> sides <Mode>. Click or enter the center point.`
   - Help: `POLYGON center: click in the model space or type \`x,y\` / \`LABEL=x,y\`.`
   - Point pick enabled. Stages `center`, advances to `radius`, zero mutation.
4. **radius**.
   - Prompt: `POLYGON active. <N> sides <Mode>. Center <label> captured. Click or enter the radius point.`
   - Help: `POLYGON radius point: click in the model space or type \`x,y\`,
     \`LABEL=x,y\`, \`@azimuth,distance\`, or bearing-distance from the center.`
   - Point pick enabled. The radius point is a polygon **vertex** when
     inscribed, and the **apothem foot** (first edge midpoint) when
     circumscribed.
   - On success one `runCadCommand('POLYGON', …)` commits and clears.
   - Zero-radius pick: session stays at `radius` with
     `resultText = POLYGON radius degenerate. Pick a radius point away from the center.`
   - Invalid typed radius: `POLYGON radius point invalid. Use \`x,y\`, … from the center.`

## Pick gating

`sessionExpectsPointPick` gates viewport point consumption:

| Session | Stage | Point pick |
|---------|-------|-----------|
| `RECTANGLE` | any | yes |
| `POLYGON` | `sides` / `mode` | no |
| `POLYGON` | `center` / `radius` | yes |
| `LINE` | any | yes (unchanged) |

Snap/construction context (`useSurveyCadCommandConstruction.ts`) seeds from
`firstCorner` for `RECTANGLE` and from `center` only at polygon `radius`.

## Typed-input reuse

Rectangle corners and polygon center/radius route through the shared
`parseInputPoint` used by `LINE`/neighbors, so `x,y`, `LABEL=x,y`,
`@azimuth,distance`, and survey bearing-distance all resolve to the same
`CommandPoint`. `sides` and `mode` are shape-local parsers in
`useSurveyCadShapeSubmit.ts`.

## Preview == commit

`useSurveyCadCommandPreview.ts` calls the same builders the commit path uses
and returns `{ kind: 'polyline', points: [...vertices, vertices[0]] }`.
`cad_shapes_command_sessions_v1.test.tsx` asserts the preview ring deep-equals
`[...builderVertices, builderVertices[0]]` for both rectangle and polygon, and
that polygon preview is `null` before sides+mode are known.

## Escape

`Escape` focuses the command input and clears the active session via the
generic escape path. No history updater runs, so undo stack and project are
unchanged (`cad_shapes_command_sessions_v1.test.tsx`: undo stack length 0,
entities 0). Browser test G exercises Esc after invalid/partial input at
multiple stages and asserts the entity count stays 0.
