# Circle v1 Interaction (baseline main 6c7380a9)

## CIRCLE (Center, Radius)

1. Start from ribbon face/flyout, `CIRCLE` command, or dock input.
2. Pick or type the center (absolute `x,y` / `LABEL=x,y`).
3. Define the radius: pick a second point (R = distance from center),
   or type a positive scalar.
4. Commit creates one `circle` entity, selected, one undo entry.
5. Degenerate second input (zero/non-finite radius) keeps the session
   alive with a bounded message; Esc cancels with zero mutation.

## CIRCLECD (Center, Diameter)

Same flow, except the second input is a DIAMETER: picked distance from
the FIXED center, or positive scalar D, with committed radius = D/2.
The center never moves. The second point is a diameter-magnitude point,
NOT the opposite endpoint of a diameter (that is the deferred 2-Point
mode, which stays planned/disabled).

## Prompts and hints

- Dock/prompt text always says Radius vs Diameter truthfully.
- Preview renders the exact closed circle (same builders as commit).
- Lone aliases do not hijack existing commands (no new aliases added).
- Deferred rows (2-Point, 3-Point, Tan-Tan-Radius, Tan-Tan-Tan) show
  "Not implemented yet" and dispatch nothing.

## Post-creation

Circle participates in selection, center/radius grips, move/copy/rotate/
scale/mirror, properties, clipboard, save/reopen, undo/redo, DXF export.
Editing a grip preserves Circle identity; radius edits obey the floor.
