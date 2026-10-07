# CAD Draw Phase L1 — Line icon sources and provenance (Worker C)

32 curated PNGs back the 16 Line construction variants. The variants are now
**live** (activated by the L1 integration): each carries a real `commandKey`,
exactly matching `CAD_LINE_L1_COMMAND_KEYS` in order, and the family shows all
**17 live rows** (row 1 `line-create` / `LINE` plus these 16).

This file records the exact local source path for each committed PNG and the
verification performed. Sources are gitignored local-only reference art; only
the stripped copies are committed.

Row 1 (`line-create` / `LINE`) keeps the existing AutoCAD `draw-line`
artwork. No generic Civil `LINE` family exists in `c3d-icons.json`
(verified: every `LINE_*` family is a `LINE_CREATE_*` / `LINE_TANGENT_*` /
`LINE_PERPENDICULAR_*` construction row), so row 1 is intentionally
untouched.

## 1. Policy gate (unchanged from Phase 21A/21B)

`local-assets/AGENTS.md` permits adding/committing assets once they are
stripped of all identifying text/properties. The pipeline is per-icon, never
bulk:

1. Copy exactly one source frame per size.
2. `magick SRC -strip PNG32:DEST` (drops tEXt/zTXt/iTXt/eXIf and normalizes
   to 8-bit RGBA).
3. Semantic WebNet rename (`draw-line-point-range-16.png`), never an
   Autodesk family name.
4. Register in `CadRibbonIconId` + `CAD_RIBBON_ICONS` (presentation only;
   dispatch stays in `cadCommandRegistry`).

No `local-assets/` bytes are staged or tracked. `local-assets/` is
gitignored. No `src/` file references `local-assets/` outside comments.

## 2. Per-row source table

All source paths are relative to the repo root. `dark` is the theme matching
the dark CAD shell; no light-theme frame is used. Semantics is EXACT for all
16 rows: each Civil family maps 1:1 to the named WebNet Line variant (row 1
excluded per the note above). `commandKey` is the live WebNet command for every
row (see `cadRibbonToolFamilies.ts`); the variants are no longer `planned` and
carry no `planned: true` flag. Variant ids and row 1 are unchanged.

| # | Variant id | Command key | Civil family | 16px source (used) | 32px source (used) | 16px destination | 32px destination | Sizes | Semantics |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `line-by-point-range` | `LINE_POINT_RANGE` | `LINE_CREATE_BY_POINT_NUMBER_RANGE` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_NUMBER_RANGE_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_NUMBER_RANGE_16.png` | `src/cad-app/assets/icons/draw-line-point-range-16.png` | `src/cad-app/assets/icons/draw-line-point-range-32.png` | 16x16 (297 B) / 32x32 (483 B) | EXACT |
| 2 | `line-by-point-object` | `LINE_POINT_OBJECT` | `LINE_CREATE_BY_POINT_OBJECT` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_OBJECT_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_OBJECT_16.png` | `src/cad-app/assets/icons/draw-line-point-object-16.png` | `src/cad-app/assets/icons/draw-line-point-object-32.png` | 16x16 (285 B) / 32x32 (453 B) | EXACT |
| 3 | `line-by-point-name` | `LINE_POINT_NAME` | `LINE_CREATE_BY_POINT_NAME` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_NAME_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_NAME_16.png` | `src/cad-app/assets/icons/draw-line-point-name-16.png` | `src/cad-app/assets/icons/draw-line-point-name-32.png` | 16x16 (308 B) / 32x32 (612 B) | EXACT |
| 4 | `line-by-northing-easting` | `LINE_NE` | `LINE_CREATE_BY_NORTHING_EASTING` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_NORTHING_EASTING_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_NORTHING_EASTING_16.png` | `src/cad-app/assets/icons/draw-line-northing-easting-16.png` | `src/cad-app/assets/icons/draw-line-northing-easting-32.png` | 16x16 (235 B) / 32x32 (314 B) | EXACT |
| 5 | `line-by-grid-ne` | `LINE_GRID_NE` | `LINE_CREATE_BY_GRID_NORTHING_GRID_EASTING` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_GRID_NORTHING_GRID_EASTING_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_GRID_NORTHING_GRID_EASTING_16.png` | `src/cad-app/assets/icons/draw-line-grid-ne-16.png` | `src/cad-app/assets/icons/draw-line-grid-ne-32.png` | 16x16 (500 B) / 32x32 (1052 B) | EXACT |
| 6 | `line-by-lat-long` | `LINE_LATLONG` | `LINE_CREATE_BY_LATITUDE_LONGITUDE` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_LATITUDE_LONGITUDE_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_LATITUDE_LONGITUDE_16.png` | `src/cad-app/assets/icons/draw-line-lat-long-16.png` | `src/cad-app/assets/icons/draw-line-lat-long-32.png` | 16x16 (507 B) / 32x32 (1030 B) | EXACT |
| 7 | `line-by-bearing` | `LINE_BEARING` | `LINE_CREATE_BY_BEARING` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_BEARING_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_BEARING_16.png` | `src/cad-app/assets/icons/draw-line-bearing-16.png` | `src/cad-app/assets/icons/draw-line-bearing-32.png` | 16x16 (325 B) / 32x32 (525 B) | EXACT |
| 8 | `line-by-azimuth` | `LINE_AZIMUTH` | `LINE_CREATE_BY_AZIMUTH` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_AZIMUTH_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_AZIMUTH_16.png` | `src/cad-app/assets/icons/draw-line-azimuth-16.png` | `src/cad-app/assets/icons/draw-line-azimuth-32.png` | 16x16 (371 B) / 32x32 (643 B) | EXACT |
| 9 | `line-by-angle` | `LINE_ANGLE` | `LINE_CREATE_BY_ANGLE` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_ANGLE_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_ANGLE_16.png` | `src/cad-app/assets/icons/draw-line-angle-16.png` | `src/cad-app/assets/icons/draw-line-angle-32.png` | 16x16 (328 B) / 32x32 (523 B) | EXACT |
| 10 | `line-by-deflection` | `LINE_DEFLECTION` | `LINE_CREATE_BY_DEFLECTION` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_DEFLECTION_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_DEFLECTION_16.png` | `src/cad-app/assets/icons/draw-line-deflection-16.png` | `src/cad-app/assets/icons/draw-line-deflection-32.png` | 16x16 (276 B) / 32x32 (433 B) | EXACT |
| 11 | `line-by-station-offset` | `LINE_STATION_OFFSET` | `LINE_CREATE_BY_STATION_OFFSET` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_STATION_OFFSET_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_STATION_OFFSET_16.png` | `src/cad-app/assets/icons/draw-line-station-offset-16.png` | `src/cad-app/assets/icons/draw-line-station-offset-32.png` | 16x16 (224 B) / 32x32 (318 B) | EXACT |
| 12 | `line-by-side-shot` | `LINE_SIDE_SHOT` | `LINE_CREATE_BY_SIDE_SHOT` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_SIDE_SHOT_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_SIDE_SHOT_16.png` | `src/cad-app/assets/icons/draw-line-side-shot-16.png` | `src/cad-app/assets/icons/draw-line-side-shot-32.png` | 16x16 (325 B) / 32x32 (458 B) | EXACT |
| 13 | `line-by-extension` | `LINE_EXTENSION` | `LINE_CREATE_BY_EXTENSION` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_EXTENSION_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_EXTENSION_16.png` | `src/cad-app/assets/icons/draw-line-extension-16.png` | `src/cad-app/assets/icons/draw-line-extension-32.png` | 16x16 (222 B) / 32x32 (316 B) | EXACT |
| 14 | `line-from-end-of-object` | `LINE_FROM_END` | `LINE_CREATE_FROM_END_OF_OBJECT` | `local-assets/civil3d-icons/png/dark/16/LINE_CREATE_FROM_END_OF_OBJECT_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_CREATE_FROM_END_OF_OBJECT_16.png` | `src/cad-app/assets/icons/draw-line-from-end-16.png` | `src/cad-app/assets/icons/draw-line-from-end-32.png` | 16x16 (226 B) / 32x32 (298 B) | EXACT |
| 15 | `line-tangent-from-point` | `LINE_TANGENT_POINT` | `LINE_TANGENT_CREATE_FROM_POINT` | `local-assets/civil3d-icons/png/dark/16/LINE_TANGENT_CREATE_FROM_POINT_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_TANGENT_CREATE_FROM_POINT_16.png` | `src/cad-app/assets/icons/draw-line-tangent-point-16.png` | `src/cad-app/assets/icons/draw-line-tangent-point-32.png` | 16x16 (288 B) / 32x32 (499 B) | EXACT |
| 16 | `line-perpendicular-from-point` | `LINE_PERP_POINT` | `LINE_PERPENDICULAR_FROM_POINT` | `local-assets/civil3d-icons/png/dark/16/LINE_PERPENDICULAR_FROM_POINT_16.png` | `local-assets/civil3d-icons/png/dark/32/LINE_PERPENDICULAR_FROM_POINT_16.png` | `src/cad-app/assets/icons/draw-line-perp-point-16.png` | `src/cad-app/assets/icons/draw-line-perp-point-32.png` | 16x16 (162 B) / 32x32 (192 B) | EXACT |

Row-1 note: `line-create` keeps `draw-line` (`src/cad-app/assets/icons/draw-line-16.png`
/ `draw-line-32.png`, AutoCAD art). No Civil family named `LINE` exists in
`c3d-icons.json` — every `LINE_*` family is a construction variant listed
above — so there is no truthful Civil replacement for row 1.

## 3. Pipeline commands (all 32, per-icon)

```bash
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_NUMBER_RANGE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-range-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_NUMBER_RANGE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-range-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_OBJECT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-object-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_OBJECT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-object-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_POINT_NAME_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-name-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_POINT_NAME_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-point-name-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_NORTHING_EASTING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-northing-easting-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_NORTHING_EASTING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-northing-easting-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_GRID_NORTHING_GRID_EASTING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-grid-ne-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_GRID_NORTHING_GRID_EASTING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-grid-ne-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_LATITUDE_LONGITUDE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-lat-long-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_LATITUDE_LONGITUDE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-lat-long-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_BEARING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-bearing-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_BEARING_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-bearing-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_AZIMUTH_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-azimuth-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_AZIMUTH_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-azimuth-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_ANGLE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-angle-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_ANGLE_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-angle-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_DEFLECTION_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-deflection-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_DEFLECTION_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-deflection-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_STATION_OFFSET_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-station-offset-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_STATION_OFFSET_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-station-offset-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_SIDE_SHOT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-side-shot-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_SIDE_SHOT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-side-shot-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_BY_EXTENSION_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-extension-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_BY_EXTENSION_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-extension-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_CREATE_FROM_END_OF_OBJECT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-from-end-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_CREATE_FROM_END_OF_OBJECT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-from-end-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_TANGENT_CREATE_FROM_POINT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-tangent-point-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_TANGENT_CREATE_FROM_POINT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-tangent-point-32.png
magick local-assets/civil3d-icons/png/dark/16/LINE_PERPENDICULAR_FROM_POINT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-perp-point-16.png
magick local-assets/civil3d-icons/png/dark/32/LINE_PERPENDICULAR_FROM_POINT_16.png -strip PNG32:src/cad-app/assets/icons/draw-line-perp-point-32.png
```

## 4. Theme / size-trap notes

- Dark ribbon art only. Every source is `png/dark/…`; no `png/light/…`
  frame is used. The manifest (`cadRibbonIcons.ts`) carries no theme-pair
  law — each id maps `{src16, src32}` to the dark pair.
- Size trap: the directory — not the `_16`/`_32` filename suffix — is the
  real pixel size (Phase 21B convention, see
  `docs/evidence/phase21b-icon-provenance.md`). The 32px destination for
  each row comes from `png/dark/32/<FAMILY>_16.png` (the shared nominal
  artwork at 32px raster), NOT from `<FAMILY>_32.png`. The true-32 native
  alternate (`png/dark/32/<FAMILY>_32.png`) exists for all 16 families but
  was deliberately not used, keeping the 16/32 pair on consistent artwork.
- Verified: `-16.png` destinations are 16x16, `-32.png` destinations are
  32x32 (`magick identify`); `-strip` leaves no `tEXt`/`zTXt`/`iTXt`/`eXIf`
  chunks.

## 5. Manifest wiring

- `src/cad-app/assets/icons/cadRibbonIcons.ts`: `CadRibbonIconId` union +
  `CAD_RIBBON_ICONS` gain the 16 ids (`draw-line-point-range`,
  `draw-line-point-object`, `draw-line-point-name`,
  `draw-line-northing-easting`, `draw-line-grid-ne`, `draw-line-lat-long`,
  `draw-line-bearing`, `draw-line-azimuth`, `draw-line-angle`,
  `draw-line-deflection`, `draw-line-station-offset`, `draw-line-side-shot`,
  `draw-line-extension`, `draw-line-from-end`, `draw-line-tangent-point`,
  `draw-line-perp-point`), each `{src16, src32}`.
- `src/cad-app/shell/cadRibbonToolFamilies.ts`: the 16 Line family variants
  gain `icon:` fields pointing at the ids above and their live `commandKey`s
  (the L1 activation). Variant ids, labels, hints, and the row-1 `draw-line`
  face are unchanged; the rows are no longer `planned`.
- Loaders render via `cadRibbonIconSrc` / `CadRibbonFlyout` (src16 rows) /
  `CadRibbonSplitButton` (currentVariant.icon primary face) — presentation
  only, no dispatch changes.

## 6. Verification performed (this worktree)

Per file, for all 32:

- `magick identify` → 16x16 for `-16`, 32x32 for `-32`, 8-bit RGBA.
- No `tEXt`/`zTXt`/`iTXt`/`eXIf` chunks in `identify -verbose`.
- `git status` shows 32 new files under `src/cad-app/assets/icons/` and no
  modification under `local-assets/`.

Suite-level:

- `tests/cad_ribbon_icon_manifest.test.tsx` green, including the new Line
  variant pin (`pins every Line construction variant to its curated icon`)
  and the comment-stripped `src/` scan that fails if any source file
  references `local-assets`.
