# Live UI Validation (main 5478ccf4, read-only, 2026-10-05)

Build: dist from main @5478ccf4 (index-BUf7w9dv.js, CadApp-B7CeE1CS.js;
package unversioned 0.0.0). Throwaway static server + headless Chromium
(playwright-core), viewport 1440×900, route /cad → Home tab, blank
in-memory drawing ("Drawing 2026-10-05*"). Every activation Esc-cancelled;
entity SVG node count unchanged (2, viewport chrome); 0 console + 0 page
errors across 3 runs.

## Per-tool live state (Home > Draw)

| # | Tool | Control | State | Tooltip | Activated |
|---|---|---|---|---|---|
| 1 | Point | plain COGO_POINT | enabled | "COGO Point — Place a point by coordinates." | Y |
| 2 | Line | split "line", face LINE [L] | enabled | "Line: Create Line [L] — Draw a line segment." | Y (flyout 1 runnable + 16 grey Planned) |
| 3 | Traverse | plain TRAVERSE | enabled | "Traverse — Draft an open/closed traverse." | Y |
| 4 | Polyline | plain PLINE [PL] | enabled | "Polyline [PL] — Draw a connected polyline." | Y |
| 5 | Arc | split "arc", face ARC_3PT | enabled | "Arc: 3-Point [ARC_3PT] — Arc through three points." | Y (flyout 11/11 runnable) |
| 6 | Circle | split, face disabled | disabled | "Circle: Center, Radius — Not implemented yet" | N (no-op, idle) |
| 7 | Best Fit | split, face disabled | disabled | "Best Fit: Create Best Fit Line — Not implemented yet" | N (no-op) |
| 8 | Curves | split, face disabled | disabled | "Curves: Create Curves between Two Lines — Not implemented yet" | N face (flyout 10 runnable calculators + 6 grey) |
| 9 | Ellipse | split, face disabled | disabled | "Ellipse: Center — Not implemented yet" | N (no-op) |
| 10 | Shapes | split, face disabled | disabled | "Shapes: Rectangle — Not implemented yet" | N (flyout Rectangle/Polygon, grey) |
| 11 | Hatch | split, face disabled | disabled | "Hatch: Hatch — Not implemented yet" | N (flyout Hatch/Gradient/Boundary, grey) |

Grey semantics: every grey row renders `aria-disabled="true"` + "Planned:…"
(disabled, never hidden). No permanent fixtures modified; no branches or
commits from the live run.
