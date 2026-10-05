# CAD Draw Shapes V1 — Browser QA

Spec: `tests-browser/cad-draw-shapes-v1.spec.ts` (production build, headless
Chromium, blank drawings).
Run: `npx playwright test cad-draw-shapes-v1 --config=playwright.prod.config.ts`.

## Result (locally rerun on this worktree)

- **8 / 8 passed** in the rerun performed for this evidence pass, total
  20.6 s, 1 worker. Each test asserts `errors` is an empty array, where
  `errors` collects `pageerror` and `console` error events after
  `boot(page, errors)`; therefore **0 page errors and 0 console errors**.
- The spec has 9 test declarations' worth of PNG outputs but 8 `test(...)`
  cases — case `E+F` covers two flows in one test.

## Flows

| Case | Flow | Asserted outcome |
|------|------|------------------|
| A | Ribbon `shapes` face enabled, `Rectangle` default, flyout 2 variants, all enabled | `aria-label = "Shapes: Rectangle"`, tooltip not `Planned`; variants map to `RECTANGLE` / `POLYGON`; `circle`/`bestfit`/`ellipse`/`hatch` flyouts have 0 enabled variants |
| B | Rectangle click flow + preview + grips | 1 entity committed; selected rectangle exposes **4** grip handles |
| C | Typed and snap rectangle corners | `0,0` then `10,5` → 4 vertices; new drawing then `0,0` + `@45,10` → non-zero X span |
| D | Grip-drag, undo, redo, move, rotate | vertex geometry changes on drag; undo→redo restores 1 entity; MOVE and ROTATE keep 1 polygon |
| E | Inscribed 5-gon | 5 vertices; first vertex distance from center ≈ 10 (`toBeCloseTo(10, 1)`) |
| F | Circumscribed 6-gon | 6 vertices; midpoint of first edge ≈ apothem 8 (`toBeCloseTo(8, 0)`) |
| G | Esc + invalid input at every phase | sides rejects `2/1025/4.5/abc`; bad mode rejects; zero radius stays open; zero-width rectangle stays open; Esc leaves 0 entities; **0 commits** |
| H | Save + reopen exact | rectangle `0,0`→`12,6` + inscribed 5-gon center `30,30` radius `40,30` → 2 entities; save/reopen round-trip `toEqual` byte-equal vertices+ids |
| I | LINE / PLINE / ARC_3PT regression | ≥ 3 entities; neighbors unaffected |

## Screenshots (9 PNGs)

All nine exist on disk in `docs/evidence/cad-draw-shapes-v1/` and were
regenerated at 13:09 by this local rerun:

`A-ribbon.png`, `B-rectangle.png`, `C-typed.png`, `D-grip-move-rotate.png`,
`E-inscribed-5gon.png`, `F-circumscribed-6gon.png`, `G-invalid.png`,
`H-reopened.png`, `I-regression.png`.

## Captured geometry (`geometry.json`)

`cad-draw-shapes-v1.spec.ts` case H writes `geometry.json` (805 bytes) from
the saved entities before reopening. It contains **2 polygons**:

- Rectangle: `(0,0) (12,0) (12,6) (0,6)`.
- Inscribed 5-gon centered `(40,30)` through `(40,30)+(10,0)`; five vertices
  on radius ≈ 10, e.g. `(40,30)`, `(33.090…,39.510…)`, `(21.909…,35.877…)`,
  `(21.909…,24.122…)`, `(33.090…,20.489…)`.

The reopen assertion compares the reloaded entity list to the pre-save
geometry with `toEqual`, so the file is both evidence and a parity check.

## Notes

- Boot hides `showSaveFilePicker` / `showOpenFilePicker` so the spec uses the
  download + parse path (`parseCadDrawingFile`) instead of native dialogs.
- The polygon spec types lone `I` for the Inscribed choice: the dock routes
  mode-phase text to the POLYGON session ahead of the `INSERT` alias
  (guarded on the mode phase, including after an invalid mode entry).
  Idle `I` still opens INSERT.
- Source: this spec and its outputs were produced by the browser worker, then
  **independently rerun here** for the numbers above; the rerun regenerated
  every PNG and `geometry.json` listed.
