# Phase C3 — Browser QA

Run: `npx playwright test cad-draw-polyline-c3 --config=playwright.prod.config.ts`
Production build, headless Chromium, blank disposable drawings. Result:
**10 passed (10)**. Zero console/page errors and zero unhandled rejections in
every flow (`assertClean`).

Evidence: PNGs + `geometry.json` in this directory.

| Flow | What it proves | Result |
| --- | --- | --- |
| A | Open N=3 polyline shows 3 vertex + 2 insert grips; dragging an insert grip projects onto the original course (inserted vertex `y≈0`, interior); undo/redo restores 3↔4 vertices | pass |
| B | Arc insert splits one arc into two same-circle sub-arcs (radius and center match the parent) | pass |
| C | Tapered width `2→8` splits to `2→5` and `5→8` at the midpoint | pass |
| D | `PLINEDELETEVERTEX V2` removes an interior open vertex; undo/redo restores | pass |
| E | Closed-ring delete keeps `closed: true`, 3 distinct vertices, no duplicate closure vertex | pass |
| F | Mixed line+arc vertex delete refuses with zero mutation (vertices + geometry byte-unchanged) | pass |
| G | Same-circle arc+arc merge: split a semicircle by insert, delete the inserted vertex, one arc survives with the parent radius | pass |
| H | Properties renders per-vertex Delete (disabled + reason title on a 2-vertex polyline) and per-course Insert; clicking Insert refreshes to 3 vertices immediately | pass |
| I | Repeated insert-then-delete keeps `segmentGeometry`/`segmentWidths` length equal to the course count (no stale indices); Properties Delete count matches the live vertex count | pass |
| J | Undo across insert+delete restores the exact pre-edit vertices and geometry | pass |

## Screenshots

- `A-mixed-grips.png` — selected open polyline with solid vertex grips and hollow diamond insert grips.
- `B-arc-insert.png` — after arc insert (two same-circle sub-arcs).
- `F-safe-refusal.png` — mixed line+arc refusal state (unchanged geometry).
- `H-properties-actions.png` — Properties panel with Insert Vertex enabled and Delete Vertex disabled with reason.

## Notes

- Insert grips are secondary hollow diamonds (`data-survey-cad-grip-handle="polyline-insert"`), distinct from solid `vertex` grips.
- The typed commands are session commands; they do not alter ribbon sticky state.
- Geometry assertions read the SAVED drawing (parsed `.wncad`), not the DOM, so they prove committed model data.
