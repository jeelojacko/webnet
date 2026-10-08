# CAD Curves F1 — Browser QA (UI half)

Spec: `tests-browser/cad-draw-curves-f1.spec.ts` (9 flows, A–I). Production
build, headless Chromium, blank disposable drawings:

```sh
npm run build
npx playwright test cad-draw-curves-f1 --config=playwright.prod.config.ts
```

Result: **9/9 green, zero page/console/unhandled errors** (asserted per
flow). Evidence PNGs + `geometry.json` live in this directory.

## Flow coverage

| Flow | What is proven |
| --- | --- |
| A flyout | 16 Curves rows, zero `aria-disabled`, default face `CURVE_BETWEEN_TWO_LINES`; ribbon pick moves the sticky face; typed `CURVEONTWOLINES` runs without moving it; New drawing resets to Between |
| B Between | Line clicks → `R20` shows arc preview → commit trims both lines (arc R≈20); report `Curve Between Two Lines`; one Undo restores lines byte-identical, Redo re-applies |
| C On | Identical arc geometry; both source lines byte-unchanged |
| D Through | Typed pass point commits the unique tangent circle and trims; a pass point on a source line reports no-solution and the session stays active (Escape cancels, zero mutation) |
| E Multiple | `3`, `F2`, three `L,R` entries preview the full chain; commit yields 3 G1-continuous arcs with sources unchanged; one Undo removes the whole chain |
| F From-End | Line source + nearest-end click + `P` + typed endpoint continues from (100,0) with the source unchanged; arc source + `R100` + `L50` commits a radius-mode arc |
| G Reverse/Compound | `R` and `C` continuations each start exactly at their own source end; report titles `Reverse Curve` / `Compound Curve` |
| H existing reps | Calculator solves `radius,delta` report-only (0 entities); TANGENT_CURVE 3-point law commits; SUBDIVIDE `CHORD,5` places equal consecutive marker chords (atomic); OFFSET `L5` commits; LINE_CIRCLE_INTX preseeded circle + line pick commits the native-circle intersection with a `Line-Circle Intersection` report |
| I picks | Single-arc preseed runs POINT_ON_CURVE; cleared selection prompts an arc pick; a line click is an explicit invalid source and the session stays active |

## Test-mechanics notes (for future flows)

- Entity picks click `[data-survey-cad-render-entity-id="<id>"]`; line
  bodies are safe targets (no support points). Arc bodies may be covered by
  support/marker points, so the spec prefers selection preseed for arcs and
  reserves one synthetic exact-element dispatch helper
  (`clickEntityExact`) for arc picks.
- The dock input swallows focused Escape, so deselect uses an empty-canvas
  click plus body-level Escape.
- The dock autocomplete never competes with session option letters: while a
  session is active the suggestion list is forced empty
  (`CadCommandDock.tsx`), so `U/R/C/T/L/E/M/D/P` always reach the session
  submit path.
- Arc-creating transactions append reference support points (engine law);
  the spec asserts structural counts (arcs/lines/reports), never bare entity
  totals, except where the count is exact (Between 11 = 2 lines + 1 arc +
  8 supports).
