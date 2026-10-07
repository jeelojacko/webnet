# CAD Draw Phase L1 — browser QA

Production build (`npm run build` via `playwright.prod.config.ts`), headless
Chromium, disposable drawings. Command:

```
npx playwright test cad-draw-line-l1 --config=playwright.prod.config.ts
```

Result: **7/7 flows green, 0 page/console/unhandled errors.** Screenshots and
`geometry.json` live in this directory.

## Flows

| Flow | Coverage |
|---|---|
| **A** | Line flyout shows **17 live rows** (0 `aria-disabled`), each with a real `data-cad-command` and a distinct curated icon (17 distinct `img src`). Sticky: selecting `line-by-bearing` moves the primary face. Typed `LINE_NE` starts the session but does NOT change the sticky face. |
| **B** | `LINE_NE` asymmetric commit (`0,0` → `100,50` gives `toX=50, toY=100`), dock echo, Undo/Redo. |
| **C** | Blank drawing: `LINE_GRID_NE` + `LINE_LATLONG` fail closed (prompt mentions "grid", entity count unchanged). After a source-bridge import of stations whose XY are genuine `CA_NAD83_CSRS_UTM_20N` grid coordinates, both succeed and commit (GRID_NE in `Northing,Easting` order, matching the LATLONG projections). |
| **D** | Imported numeric survey points: `LINE_POINT_RANGE` `1-3` (2 segments), `LINE_POINT_NAME` `1,3` (1 segment), missing-id refusal with zero mutation, `LINE_POINT_OBJECT` picking survey points. |
| **E** | `LINE_BEARING`, `LINE_AZIMUTH`, `LINE_ANGLE` (selected-line reference + start pick), `LINE_DEFLECTION`, `LINE_SIDE_SHOT` (fixed-origin shot), `LINE_STATION_OFFSET` refusal without an alignment. |
| **F** | `LINE_EXTENSION` in place (count unchanged, `GRIP_EDIT`), `LINE_FROM_END` collinear, corrected `LINE_PERP_POINT` (line source → start on source → signed normal), corrected `LINE_TANGENT_POINT` (line source → start on source → signed tangent; circle source → radial on-source → tangent ⊥ radius), idle `LINE_` autocomplete. `geometry.json` pins tangent collinearity, normal ⊥ source, and radial ⊥ tangent. |
| **G** | Corrected `LINE_TANGENT_POINT` / `LINE_PERP_POINT` Escape cancels at every phase (source pick, on-source start, signed-ray phase) with zero mutation and a clean restart at source selection. |

## Row coverage

Every one of the 17 flyout rows is verified for its `commandKey` + icon in flow
A. Every `LINE_*` key is additionally exercised by at least one behavior in
flows B–G (NE, grid-NE, latlong, range, object, name, bearing, azimuth, angle,
deflection, station-offset, side-shot, extension, from-end, perpendicular,
tangent, Escape-cancel). Row 1 (`line-create` / `LINE`) is the live default face.

## Notes

- `LINE_TANGENT_POINT` / `LINE_PERP_POINT` are three-phase: select a
  line/arc/circle body, pick the start **ON** the source, then enter a signed
  distance or click the endpoint constrained to the two source-frame rays.
  The engine math (`cadLineOnSourceResolvers`) and the corrected session law are
  pinned by unit/session suites; flow F commits both end to end in the browser
  and flow G pins Escape-cancel at every phase.
- `GRID_NE`/`LATLONG` success uses the real source-bridge import path
  (`/cad?source=<id>` + **Import / Refresh**), so it also exercises the
  `CadProjectMetadata.coordinateContext` adopt-once seam. The fixture imports
  genuinely grid-consistent station geometry (projections of 45,-75 / 45.01,-75
  / 45.02,-75.02), not local `(0,0)-(100,100)` XY relabelled with a projected CRS.
- Screenshots: `A-line-flyout-17-live`, `A-sticky-after-typed`, `B-ne-committed`,
  `C-crs-refusal`, `C-crs-success`, `D-range-name-object`,
  `E-directional`, `F-edit-from-end-tangent`, `F-idle-autocomplete`.
