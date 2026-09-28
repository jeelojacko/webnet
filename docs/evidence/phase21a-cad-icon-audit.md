# Phase 21A Wave 1A — CAD icon audit (curated stripped PNG pipeline)

Strategy: curated-stripped-PNG. Source tree `local-assets/generated-cad-icons/`
is gitignored; only metadata-stripped generic PNGs are committed under
`src/cad-app/assets/icons/`. No shell/component/CSS files touched.

## Source formats

- Inventory: `local-assets/generated-cad-icons/icons.json` — 50,616 PNG records.
- Core command icons: PNG32 (8-bit/color RGBA, non-interlaced), dark + light
  themes, sizes 8/12/16/24/32/36/48/64/72/96/128.
- Verified via `magick identify` + `file`: `PNG image data, 32 x 32,
  8-bit/color RGBA`. Sizes 8/12/36/72 treated as unreliable — not used.
- Strip: `magick SRC -strip PNG32:DEST`. Post-strip check: no
  tEXt/zTXt/iTXt/eXIf chunks, no Autodesk/Civil3D/C3D strings, RGBA intact.
  Only remaining properties are magick render timestamps.

## Size policy

- Large buttons (24–32px render): committed `-32.png` sourced from dark/32/.
- Small buttons (16–20px render): committed `-16.png` sourced from dark/16/.
- Flyouts (16px): `-16.png`.
- `src24` left unset in the manifest (available locally under dark/24/ if a
  future pass needs it). Canonical filenames used (e.g. `TRIM.png`), never
  `__from16`/`__from32` variants.

## Naming convention

Lowercase-hyphen semantic names, no Autodesk IDs in committed names:
`<group>-<action>-<size>.png`, e.g. `draw-line-16.png`, `arc-3point-32.png`,
`modify-trim-16.png`. Manifest: `src/cad-app/assets/icons/cadRibbonIcons.ts`
(`CadRibbonIconId` + `CAD_RIBBON_ICONS`), Vite `new URL(..., import.meta.url)`
literals — no ad-hoc `"/icons/" + name` string logic anywhere. No `.d.ts`
needed: `vite/client` types are already in tsconfig.

## Per-icon source mapping (all under `local-assets/generated-cad-icons/dark/<16|32>/`)

| Committed id | Source canonical | 16 | 24 | 32 |
|---|---|---|---|---|
| draw-line | LINE | Y | Y | Y |
| draw-polyline | PLINE | Y | Y | Y |
| draw-arc-3point | ARC3PT | Y | Y | Y |
| draw-arc-center-start-end | ARCCSE | Y | Y | Y |
| draw-arc-center-start-angle | ARCCSA | Y | Y | Y |
| draw-arc-center-start-length | ARCCSL | Y | Y | Y |
| draw-arc-start-center-end | ARCSCE | Y | Y | Y |
| draw-arc-start-center-angle | ARCSCA | Y | Y | Y |
| draw-arc-start-center-length | ARCSCL | Y | Y | Y |
| draw-arc-start-end-angle | ARCSEA | Y | Y | Y |
| draw-arc-start-end-direction | ARCSED | Y | Y | Y |
| draw-arc-start-end-radius | ARCSER | Y | Y | Y |
| draw-point | POINT | Y | Y | Y |
| draw-spline | SPLINE | Y | Y | Y |
| draw-3dpoly | 3DPOLY | Y | Y | Y |
| modify-move | MOVE | Y | Y | Y |
| modify-copy | COPY | Y | Y | Y |
| modify-rotate | ROTATE | Y | Y | Y |
| modify-scale | SCALE | Y | Y | Y |
| modify-mirror | MIRROR | Y | Y | Y |
| modify-trim | TRIM | Y | Y | Y |
| modify-extend | EXTEND | Y | Y | Y |
| modify-fillet | FILLET | Y | Y | Y |
| modify-explode | EXPLODE | Y | Y | Y |
| modify-erase | ERASE | Y | Y | Y |
| layers | LAYERS | Y | Y | Y |
| block | BLOCK | Y | Y | Y |
| block-insert-dwg | BLOCK_INSERT_DWG_AS_BLK | Y | Y | Y |
| text-multiline | MTEXT | Y | Y | Y |
| text-style | TXTSTYLE | Y | Y | Y |
| leader-quick | QLEADER | Y | Y | Y |
| snap-tangent | TANGENT_16 (16px) / TANGENT_32 (32px) | Y | Y* | Y |
| dim-linear | DIMLIN | Y | Y | Y |
| dim-aligned | DIMALI | Y | Y | Y |
| dim-angular | DIMANG | Y | Y | Y |
| dim-radius | DIMRAD | Y | Y | Y |
| dim-diameter | DIMDIA | Y | Y | Y |
| dim-arc-length | DIMARC | Y | Y | Y |
| dim-style | DIMSTY | Y | Y | Y |
| table | TABLE | Y | Y | Y |
| table-style | TABLESTYLE | Y | Y | Y |
| hatch-pattern | BHATCH | Y | Y | Y |
| hatch-gradient | GRADIENT | Y | Y | Y |
| hatch-retain-boundary | HATCH_RETAINBOUNDARY | Y | Y | Y |
| align-3d | 3DALIGN | Y | Y | Y |
| file-new | NEW | Y | Y | Y |
| file-open | OPEN | Y | Y | Y |
| file-save | SAVE | Y | Y | Y |
| edit-undo | UNDO | Y | Y | Y |
| edit-redo | REDO | Y | Y | Y |

\* TANGENT_16 exists at 16/24/32; TANGENT_32 exists only at 32. Committed
`snap-tangent-16.png` ← dark/16/TANGENT_16.png,
`snap-tangent-32.png` ← dark/32/TANGENT_32.png.

## Availability surprises

- Forecast `ARC_SCE/ARC_SCA/ARC_SCL/ARC_SEA/ARC_SED/ARC_SER/ARC_CSE/ARC_CSL`
  (underscore) names do NOT exist. The true family is unprefixed:
  ARCSCE/ARCSCA/ARCSCL/ARCSEA/ARCSED/ARCSER/ARCCSE/ARCCSA/ARCCSL (+ ARC3PT,
  ARCCON, ARC_TEXT, DIMARC, ELLARC) — all at 16/24/32. All 10 draw-variants
  curated; ARCCON/ARC_TEXT left out (constraint/text, not draw tools).
- `CONTINUE_CURVE` (and any `CONTINU*`/`CURVE`) does not exist — gap.
- `TANGENT`/`LEADER`/`HATCH`/`LAYER`/`DIMSTYLE`/`TEXTSTYLE` canonicals do not
  exist; truthful neighbours do: TANGENT_16/TANGENT_32, QLEADER, BHATCH,
  LAYERS, DIMSTY, TXTSTYLE — curated as above. Plain MLEADER/LEADER absent.
- Extra layer set available locally, not curated: LAYERP,
  LAYER_ISO_TO_CURRENT_VP, LAYER_DELETE, LAYER_MERGE_2, LAYERSTATESAVE,
  CLASSICLAYER, RIBBON_LAYER* (all 16/24/32).

## Gap list (omitted from manifest — no wrong icon faked)

No canonical truthful icon exists for: CIRCLE, ELLIPSE, RECTANGLE, POLYGON,
PROFILE, PARCEL, FEATURE-LINE, plain SURFACE / CONTOUR / VOLUME / SECTION,
CONTINUE_CURVE. Only misleading neighbours exist (TCIRCLE, ELLARC, ELLCEN,
ELLAE, REVCLOUD_RECTANGLE, REVCLOUD_POLYGONAL, CIR2PT/CIR3PT/CIRTTT,
RECTAN, POLYGO, MEASUR_VOLUME, SECTIONPLANETOBLOCK) — deliberately NOT
aliased to plain commands. Fallback policy: short text face (e.g. "○", "▭",
two-letter label) until a truthful icon is sourced.

## Portable-paths compliance

Committed names are lowercase-hyphen + `-16`/`-32.png`; no reserved device
basenames, no forbidden chars, no case-only collisions.
`npm run check:portable-paths` clean.

## Counts

- 50 icon ids × 2 sizes = 100 PNGs (~41 KB total) + `cadRibbonIcons.ts` +
  this doc. `git status` shows no `local-assets/` bytes staged.
