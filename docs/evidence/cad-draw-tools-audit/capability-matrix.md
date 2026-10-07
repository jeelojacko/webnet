# Capability Matrix (baseline main 5478ccf4)

Legend: Y = yes, N = no, P = partial, — = not applicable. Confidence H/M/L.

| Tool | Ribbon | Icon | Command | Entity | Create | Snaps/Input | Render | Select/Hit | Edit/Grips | Undo | Persist | Tests | Browser | Class | Conf | Biggest missing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Point | EN plain | Y draw-point | Y COGO_POINT | Y survey-point+text | Y click+2D type | P 14 snaps, no Z | Y marker | Y pad | P props, no grips | Y | Y | Y unit | Y | USABLE_BUT_INCOMPLETE | H | Z, symbol pick |
| Line | EN split | Y draw-line | Y LINE single-seg | Y line XY | Y click+brg/dist | Y snaps+relative | Y | Y pad | Y grips/trim | Y | Y+DXF | Y unit | Y | USABLE_BUT_INCOMPLETE | H | chain, Z |
| Traverse | EN plain | N (text face) | Y TRAVERSE rich | Y pts+lines+pline | Y legs/panel | Y typed legs | Y+labels | Y | P vertex grips | Y 1-tx | Y+DXF | Y unit | Y | USABLE_BUT_INCOMPLETE | M-H | LSQ, backsight model |
| Polyline | EN plain | Y | Y PLINE accum | Y pline open | Y Enter/Esc | Y per-seg | Y | Y pad | P move-only | Y | Y+DXF | Y unit | Y | USABLE_BUT_INCOMPLETE | H | vertex insert/delete, Z |
| Arc | EN split | Y 10/11 | Y 11 modes | Y center/rad/ang | Y picks+forms | Y +tangent | Y+labels | Y pad | Y grips/trim | Y | Y+DXF | Y unit | Y | PRODUCTION_READY | H | Z, bulge xfer |
| Circle | DIS split | N | N | N (arc only) | N | — | N | N | N | — | N | manifest only | N | PLACEHOLDER_ONLY | H | entity+cmd+render+DXF |
| Best Fit | DIS split | N | N | N (line needs stations; parabola none) | N | — | — | — | — | — | N | manifest only | N | PLACEHOLDER_ONLY | M | design: inputs/outputs/residuals |
| Curves | DIS face, 10 live rows | N face | Y 10 COGO cmds | Y via arc cmds | Y tangent/PI/chord/rev/comp | Y | Y | Y | Y | Y | Y+DXF | Y unit | P | USABLE_BUT_INCOMPLETE | H | between-2-lines wiring |
| Ellipse | DIS split | N | N | P error-only | N (derived) | — | Y err-only | P no pad | P read-only | Y | Y+DXF36gon | Y unit | Y | UI_STUB_ENGINE_PARTIAL | H | generic entity+Center cmd |
| Shapes | DIS split | N | N | Y polygon | N (TIN-only creator) | — | Y | Y | Y xforms/props | Y | Y+DXF | manifest only | N | ENGINE_EXISTS_UI_MISSING | H | 2 draw sessions |
| Hatch | DIS split | Y hatch-pattern | N | N | N | — | N (markers only) | N | N | — | N | manifest only | N | PLACEHOLDER_ONLY | H | fill/pattern/assoc engine |

## Cross-tool expectations (SUPPORTED / GLOBAL_INFRA_MISSING / TOOL_MISSING)

- Esc cancel: SUPPORTED. Enter finish (PLINE/Traverse): SUPPORTED.
- Undo last vertex while active: TOOL_MISSING (no backstep anywhere).
- Right-click finish: GLOBAL_INFRA_MISSING (context menu is quick-launch only).
- Repeat/continuous mode: GLOBAL_INFRA_MISSING (no repeat binding; dock arrows = string history).
- Typed absolute + relative/bearing coordinates: SUPPORTED. Typed distance/angle: SUPPORTED (relative form).
- Object snaps (14 kinds): SUPPORTED. Ortho / free polar / grid / tracking / Z snap: GLOBAL_INFRA_MISSING.
- Rubber-band preview, prompts, inline input bar: SUPPORTED.
- Layer/style inheritance: SUPPORTED (ByLayer). Elevation/Z: GLOBAL_INFRA_MISSING (2D everywhere).
- Marquee window/crossing: SUPPORTED (screen-space primitive bounds; engine bounds fn exists but unused by marquee).

## Addendum — Phase C1 current state (2026-10-06)

Historical baseline above is unchanged. Polyline update after Phase C1
(baseline `5aa6441`): PLINE Close is now SUPPORTED (3+ distinct vertices) and
active backstep (`U`/`UNDO`/`BACKSTEP`) is now SUPPORTED (session-local).
The closed last→first edge is honored by the shared segment
iterator/spatial index, renderer, bounds, and Properties rows; grips remain
one-per-vertex. Still missing/deferred: bulge/width/arc segments, Z,
line-chaining, right-click finish, command repeat, and trim/extend/fillet
closed-edge segmenting. Evidence:
`docs/evidence/cad-polyline-c1-close-backstep/`.

## Addendum — Phase C2 current state (2026-10-07)

Historical baseline and the C1 addendum above are unchanged. Polyline update
after Phase C2 (branch `feat/cad-polyline-bulge-width-c2`): per-course signed
bulge (3-point arc legs through a pending through-point) is now SUPPORTED,
and per-course centred band width (constant or `start,end` taper, model
metres) is now SUPPORTED via additive trailing optional
`segmentGeometry`/`segmentWidths` (no version bump). Consumers resolve true
courses through one shared resolver: native arc render primitives + one
aggregated band primitive, spatial index/snaps/intersections (line vs arc,
never a chord), true-arc-extrema + width-envelope bounds, arc/line Properties
rows + true total length, DXF groups 42/40/41 on the course start vertex,
uniform-scale/reflection carry and non-uniform fail-closed on arcs/width.
Still missing/deferred: vertex insert/delete, Z, line chaining, right-click
finish, command repeat, raw direct bulge-entry UI, arc-midpoint/width grips,
full mixed-segment trim/extend/fillet, and general DXF import. Evidence:
`docs/evidence/cad-polyline-c2-bulge-width/`.
