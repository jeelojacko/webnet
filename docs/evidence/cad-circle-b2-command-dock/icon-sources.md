# Phase B2 — Circle icon sources and provenance

Twelve new curated PNGs back the six live Circle ribbon variants. This file
records the exact local source path for each committed PNG and the verification
performed. Sources are gitignored local-only reference art; only the stripped
copies are committed.

## 1. Policy gate (unchanged from Phase 21A/21B)

`local-assets/AGENTS.md` permits adding/committing assets once they are
stripped of all identifying text/properties. The pipeline is per-icon, never
bulk:

1. Copy exactly one source frame per size.
2. `magick SRC -strip PNG32:DEST` (drops tEXt/zTXt/iTXt/eXIf and normalizes to
   8-bit RGBA).
3. Semantic WebNet rename (`draw-circle-center-radius-16.png`), never an
   Autodesk family name.
4. Register in `CadRibbonIconId` + `CAD_RIBBON_ICONS` (presentation only;
   dispatch stays in `cadCommandRegistry`).

No `local-assets/` bytes are staged or tracked. `local-assets/` is gitignored
(`.gitignore:78`).

## 2. Per-PNG source table

All source paths are relative to the repo root. `dark` is the theme matching
the dark CAD shell; no light-theme frame is used. The raw origin column is the
local AutoCAD button TIFF that the `generated-cad-icons` PNG was rasterized
from by the repo's existing local script.

| Repo destination | Local source (used) | Raw TIFF origin |
|---|---|---|
| `src/cad-app/assets/icons/draw-circle-center-radius-16.png` | `local-assets/generated-cad-icons/dark/16/CIRRAD.png` | `local-assets/acad-icons/acadbtn/16_CIRRAD.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-center-radius-32.png` | `local-assets/generated-cad-icons/dark/32/CIRRAD.png` | `local-assets/acad-icons/acadbtn/32_CIRRAD.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-center-diameter-16.png` | `local-assets/generated-cad-icons/dark/16/CIRDIA.png` | `local-assets/acad-icons/acadbtn/16_CIRDIA.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-center-diameter-32.png` | `local-assets/generated-cad-icons/dark/32/CIRDIA.png` | `local-assets/acad-icons/acadbtn/32_CIRDIA.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-2point-16.png` | `local-assets/generated-cad-icons/dark/16/CIR2PT.png` | `local-assets/acad-icons/acadbtn/16_CIR2PT.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-2point-32.png` | `local-assets/generated-cad-icons/dark/32/CIR2PT.png` | `local-assets/acad-icons/acadbtn/32_CIR2PT.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-3point-16.png` | `local-assets/generated-cad-icons/dark/16/CIR3PT.png` | `local-assets/acad-icons/acadbtn/16_CIR3PT.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-3point-32.png` | `local-assets/generated-cad-icons/dark/32/CIR3PT.png` | `local-assets/acad-icons/acadbtn/32_CIR3PT.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-tan-tan-radius-16.png` | `local-assets/generated-cad-icons/dark/16/CIRTTR.png` | `local-assets/acad-icons/acadbtn/16_CIRTTR.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-tan-tan-radius-32.png` | `local-assets/generated-cad-icons/dark/32/CIRTTR.png` | `local-assets/acad-icons/acadbtn/32_CIRTTR.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-tan-tan-tan-16.png` | `local-assets/generated-cad-icons/dark/16/CIRTTT.png` | `local-assets/acad-icons/acadbtn/16_CIRTTT.tiff` (frame 1) |
| `src/cad-app/assets/icons/draw-circle-tan-tan-tan-32.png` | `local-assets/generated-cad-icons/dark/32/CIRTTT.png` | `local-assets/acad-icons/acadbtn/32_CIRTTT.tiff` (frame 1) |

Manifest entries live in `src/cad-app/assets/icons/cadRibbonIcons.ts`
(`draw-circle-center-radius`, `-center-diameter`, `-2point`, `-3point`,
`-tan-tan-radius`, `-tan-tan-tan`). Variant wiring lives in
`src/cad-app/shell/cadRibbonToolFamilies.ts` under the `circle` family.

## 3. Verification performed (this worktree)

Per file, for all 12:

- `magick identify` → `srgba 4.0 PNG`, `16x16` for `-16`, `32x32` for `-32`
  (native sizes, no upscaling).
- `magick compare -metric AE DEST SRC` → `0 (0)`: pixel-identical to the cited
  local source.
- No `tEXt`/`zTXt`/`iTXt`/`eXIf` chunks and no `Autodesk`/`Civil`/`C3D`
  strings in `magick identify -verbose` (the one `#C3D5E1…` hit is an RGBA hex
  value, not metadata).
- `git check-ignore local-assets` → matches `/.gitignore:78`.

Suite-level:

- `tests/cad_ribbon_icon_manifest.test.tsx` 6/6 green, including the Circle
  variant pin (`pins every Circle construction variant to its curated icon`)
  and the comment-stripped `src/` scan that fails if any source file
  references `local-assets`.

## 4. no-web / no-new-generated-art confirmation

- **No web source.** None of the 12 committed PNGs was fetched from the
  network; every byte originates from the local, gitignored
  `local-assets/` reference tree listed above.
- **No new/generated artwork.** No artwork was drawn, synthesized, or
  AI-generated for this phase. Each committed PNG is a stripped transcode of a
  pre-existing local reference frame. The `generated-cad-icons` directory name
  refers to the repo's existing local rasterization of the AutoCAD button
  TIFFs (`scripts/build-cad-icon-pngs.sh`); it is not this phase's generation
  and it is not tracked.

## 5. Reproduce (example: center/radius)

```bash
magick local-assets/generated-cad-icons/dark/16/CIRRAD.png \
  -strip PNG32:src/cad-app/assets/icons/draw-circle-center-radius-16.png
magick local-assets/generated-cad-icons/dark/32/CIRRAD.png \
  -strip PNG32:src/cad-app/assets/icons/draw-circle-center-radius-32.png
```

Repeat with `CIRDIA`, `CIR2PT`, `CIR3PT`, `CIRTTR`, `CIRTTT` and the matching
semantic destination names.
