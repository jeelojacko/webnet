# Phase 21B — Civil icon audit (ribbon control inventory)

Branch `feat/cad-shell-closeout-civil-icons`, base `origin/main` 0407a4d.

Scope: enumerate **every visible ribbon control** on the five shell tabs,
record its current icon status, the best Civil 3D candidate from
`local-assets/civil3d-icons/c3d-icons.json`, a confidence grade, and the
adoption decision. This is the evidence that the Phase 21B adoption set is
truthful and bounded.

Reference libraries (both gitignored, local-only):

- `local-assets/generated-cad-icons/icons.json` — AutoCAD core set used by
  Phase 21A (sizes 8/12/16/24/32/36/48/64/72/96/128, dark + light).
- `local-assets/civil3d-icons/c3d-icons.json` — Civil 3D set: 18,575 records,
  791 families; PNGs at `png/<theme>/<dir>/` with directory 16/24/32/48/64/96/128
  under `dark/` and `light/`.

## Method

1. Human-checked every visible control in `src/cad-app/shell/CadRibbon*Tab.tsx`,
   `Cad*RibbonGroup.tsx`, `CadLayersGroup.tsx`, `CadParcelNetworkRibbonGroup.tsx`,
   and the eight tool families in `cadRibbonToolFamilies.ts`.
2. Current icon status read from `CadRibbonShared.tsx` `COMMAND_ICONS` (registry
   commands), the per-group icon maps, and the manifest
   `src/cad-app/assets/icons/cadRibbonIcons.ts`.
3. Candidate family chosen by **semantic** matching against the Civil 3D
   command family, then verified in `c3d-icons.json` for `theme == "dark"` and
   the true `pixel_size` — the directory, not the `_16`/`_32` filename suffix,
   is the real size (e.g. `png/dark/32/SURFACE_CREATE_16.png` is 32 px).
4. Every adopted source was confirmed with `magick identify` at 16×16 and
   32×32 before stripping (see `phase21b-icon-provenance.md`).

Confidence legend:

| Grade | Meaning |
|---|---|
| EXACT | Family name maps 1:1 to the WebNet command semantics. |
| STRONG | Same object/action; naming differs but no competing meaning. |
| WEAK | Plausible artwork, semantically adjacent or generic; evidence-only. |
| REJECT | No truthful artwork in either library, or the nearest glyph means something else. |

Decision legend: **keep** (existing truthful icon), **adopt** (new Phase 21B
icon), **text** (no truthful asset — short text face per manifest policy).

## Summary

| Tab | Command faces | Iconed before | Iconed after | Newly adopted placements |
|---|---|---|---|---|
| Home | 75 | 26 | 40 | 14 (10 new ids + reused `table` ×3, `draw-point` ×1) |
| Annotate | 21 | 16 | 16 | 0 |
| Survey | 21 | 8 | 9 | 1 (`survey-point-group`; plus `draw-point` reuse) |
| Surface | 54 | 0 | 15 | 15 (13 distinct ids, two reused once each) |
| Output | 6 | 3 | 4 | 1 (`landxml-import`) |
| **Sub-total** | **177** | **53** | **84** | **32 placements** |
| Tool-family flyout rows | 62 | 15 | 15 | 0 |

The Home tab also renders 2 caret toggles (Parcel Network splits), which carry
no icon by design. The 25 new manifest ids cover 28 of the 32 new placements
(`surface-add-point`, `surface-volume-report`, and `parcel-segments-edit` each
appear on two controls); the remaining 4 placements reuse the existing `table`
(×3) and `draw-point` ids.

> Visual note: the authoring model for this wave has no image support, so
> pixel-level confirmation of the adopted artwork is recorded as an
> **outstanding manual follow-up**. Every adopted family is a Civil 3D ribbon
> command whose name is the command's identity (e.g. `SURFACE_BOUNDARY`), and
> formats were verified programmatically (16×16/32×32 RGBA, non-blank, no
> duplicate artwork, no metadata). Treat the confidence grades as
> name-provenance grades until a human eyeball pass confirms the glyphs.

---

## Tab: Home

### Draw (13 primaries, 62 flyout rows)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| COGO Point | COGO_POINT | draw-point | POINT (ACAD) | EXACT | keep |
| Line split (primary) | LINE | draw-line | LINE (ACAD) | EXACT | keep |
| Polyline | PLINE | draw-polyline | PLINE (ACAD) | EXACT | keep |
| Traverse | TRAVERSE | text | TRAVERSE_ADJUSTMENT / TRAVERSE_EDITOR | WEAK | text |
| Arc split (primary) | ARC_3PT | draw-arc-3point | ARC3PT (ACAD) | EXACT | keep |
| Circle split (planned) | — | text | none (`CIRCLE` absent in both) | REJECT | text |
| Best Fit split (planned) | — | text | BEST_FIT_FIXED_LINE/CURVE/PARABOLA | WEAK | text |
| Curves split | CURVE_SOLVER (calculator) | text | CURVE_CALCULATOR | STRONG | text (deferred) |
| Ellipse split (planned) | — | text | none (`ELLIPSE` absent) | REJECT | text |
| Shapes split (planned) | — | text | none (`RECTANG`/`POLYGON` absent) | REJECT | text |
| Hatch split | — | hatch-pattern / hatch-gradient / hatch-retain-boundary | BHATCH/GRADIENT (ACAD) | STRONG | keep |
| Block | BLOCK | block | BLOCK (ACAD) | EXACT | keep |
| Insert | INSERT | block-insert-dwg | BLOCK_INSERT_DWG_AS_BLK (ACAD) | EXACT | keep |

Flyout rows reuse the primary icons where curated (arc 10/11, line 1/18,
curves 1/16, hatch 3/3); all other rows are planned/unmapped and keep the label
face inside the flyout.

### Modify (14)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Move | MOVE | modify-move | MOVE | EXACT | keep |
| Copy | COPY | modify-copy | COPY | EXACT | keep |
| Rotate | ROTATE | modify-rotate | ROTATE | EXACT | keep |
| Scale | SCALE | modify-scale | SCALE | EXACT | keep |
| Mirror | MIRROR | modify-mirror | MIRROR | EXACT | keep |
| Trim | TRIM | modify-trim | TRIM | EXACT | keep |
| Extend | EXTEND | modify-extend | EXTEND | EXACT | keep |
| Fillet | FILLET | modify-fillet | FILLET | EXACT | keep |
| Explode | EXPLODE | modify-explode | EXPLODE | EXACT | keep |
| Paste | PASTE | text | SURFACE_PASTE | REJECT (surface-only) | text |
| Align 2D | ALIGN2D | align-3d | 3DALIGN (ACAD) | STRONG | keep |
| Helmert 2D | HELMERT2D | text | none (no HELMERT family) | REJECT | text |
| Grid/Ground | GRIDGROUND | text | none (no GRID scale family) | REJECT | text |
| Project Transform | PROJECTTRANSFORM | text | none | REJECT | text |

### Edit (7)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Undo | SHELL_UNDO | edit-undo | UNDO | EXACT | keep |
| Redo | SHELL_REDO | edit-redo | REDO | EXACT | keep |
| Select All | SHELL_SELECT_ALL | text | none | REJECT | text |
| Clear Selection | SHELL_CLEAR_SELECTION | text | none | REJECT | text |
| Erase | SHELL_ERASE | modify-erase | ERASE | EXACT | keep |
| Layers | LAYER | layers | LAYERS | EXACT | keep |
| Blocks | BLOCKS | block | BLOCK | EXACT | keep |

### Blocks (4)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Insert | INSERT | block-insert-dwg | BLOCK_INSERT_DWG_AS_BLK | EXACT | keep |
| Block | BLOCK | block | BLOCK | EXACT | keep |
| Blocks | BLOCKS | block | BLOCK | EXACT | keep |
| Explode | EXPLODE | modify-explode | EXPLODE | EXACT | keep |

### Layers (2)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Current-layer dropdown | — | swatch (CSS) | n/a | n/a | keep |
| Layer manager | LAYER (click) | text | LAYERS (ACAD) | EXACT | keep as text/ACAD set (Civil index has no LAYER*) |

### Parcel (7)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Split by Bearing | PARCEL_SPLIT_BEARING | text | PARCEL_SEGMENTS_EDIT | WEAK | text |
| Split by Area | PARCEL_SPLIT_AREA | text | PARCEL_SEGMENTS_EDIT | WEAK | text |
| Set Parcel Course Arc | PARCELCOURSEARC | parcel-segments-edit | PARCEL_SEGMENTS_EDIT | STRONG | **adopt** |
| Straighten Parcel Course | PARCELCOURSELINE | parcel-segments-edit | PARCEL_SEGMENTS_EDIT | STRONG | **adopt** |
| Parcel Table | PARCELTABLE | table | TABLE_ADD | STRONG | adopt (reused ACAD `table`) |
| Parcel Report | PARCELREPORT | table | VOLUME_REPORT_GENERATE-like report glyph absent | WEAK | adopt (reused ACAD `table`) |
| Parcel Description | PARCELDESC | table | TABLE_ADD | STRONG | adopt (reused ACAD `table`) |

### Network (6)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Designate Parcels | PARCELDESIGNATE | parcel-props-edit | PARCEL_PROPS_EDIT | STRONG | **adopt** |
| Number Parcels | PARCELNUMBER | parcel-renumber-tags | TAGS_RENUMBER | STRONG | **adopt** |
| Link Shared Boundary | PARCELLINK | text | none (`SHARED*` absent) | REJECT | text |
| Validate Parcel Network | PARCELCHECK | text | none (no topology-QA glyph) | REJECT | text |
| Unlink Shared Boundary (caret) | PARCELUNLINK | text | none | REJECT | text |
| Parcel Schedule (caret) | PARCELSCHEDULE | text | none (TABLE_ADD generic) | WEAK | text |

### Feature Line (10)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Create Feature Line | FEATURELINECREATE | feature-line-create | FEATURE_LINE_CREATE | EXACT | **adopt** |
| Set Elevations | FLSETZ | feature-line-elevation | GRADING_FLINE_ELEVS_EDIT | STRONG | **adopt** |
| Set Grade | FLGRADE | text | GRADING_FLINE_MOD_GRAD | WEAK | text |
| Raise/Lower | FLRAISELOWER | feature-line-raise-lower | GRADING_FLINE_RAISE_LOWER | EXACT | **adopt** |
| Interpolate | FLINTERPOLATE | text | GRADING_FLINE_ELEVS_EDIT (generic) | WEAK | text |
| Set Vertices from Surface | FLSURFACEELEV | feature-line-elev-from-surface | GRADING_FLINE_ELEVS_FROM_SURF | EXACT | **adopt** |
| Feature Line Inquiry | FLINQUIRY | text | FEATURE_LINE_INQUIRY absent | REJECT | text |
| Insert Vertex | FLINSERTVERTEX | feature-line-insert-vertex | GRADING_FLINE_PI_INSERT | STRONG | **adopt** |
| Delete Vertex | FLDELETEVERTEX | text | GRADING_FLINE_PI_DELETE | STRONG | text (deferred) |
| Add Feature Line Breakline | SURFACE_ADDFEATURELINEBREAKLINE | text | FEATURE_LINE_CROSSING | WEAK | text |

### Grading (6)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Grade to Surface | GRADETOSURFACE | grading-create | GRADING_CREATE | STRONG | **adopt** |
| Grading Manager | GRADING | text | GRADING | STRONG | text (deferred) |
| Calculate Grading | GRADINGCALC | text | GRADING_VOLUME_TOOL | WEAK | text |
| Grading Inquiry | GRADINGINQUIRY | text | GRADING_PROPERTIES | WEAK | text |
| Extract Daylight | GRADINGEXTRACTDAYLIGHT | text | tool-palette daylight previews | WEAK | text |
| Bake Grading Surface | GRADINGBAKE | text | none (WebNet-specific) | REJECT | text |

### Grading Groups (6)

| Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Grade Group | GRADEGROUP | grading-group-create | GRADING_GROUP_CREATE | STRONG | **adopt** |
| Calculate Grading Group | GRADINGGROUPCALC | text | GRADING_VOLUME_TOOL | WEAK | text |
| Grading Group Inquiry | GRADINGGROUPINQUIRY | text | GRADING_GROUP_PROPERTIES | WEAK | text |
| Extract Group Daylight | GRADINGGROUPEXTRACTDAYLIGHT | text | tool-palette daylight previews | WEAK | text |
| Bake Grading Group Surface | GRADINGGROUPBAKE | text | none | REJECT | text |
| Grading Group Manager | GRADINGGROUP | text | GRADING_GROUP_PROPERTIES | WEAK | text |

---

## Tab: Annotate (21)

| Group | Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|---|
| Text | Multiline Text | MTEXT | text-multiline | MTEXT | EXACT | keep |
| Leaders | Quick Leader | LEADER | leader-quick | QLEADER | STRONG | keep |
| Dimensions | Dimension | DIM | text | DIM* variants | WEAK | text |
| Dimensions | Linear | DIMLINEAR | dim-linear | DIMLIN | EXACT | keep |
| Dimensions | Aligned | DIMALIGNED | dim-aligned | DIMALI | EXACT | keep |
| Dimensions | Angular | DIMANGULAR | dim-angular | DIMANG | EXACT | keep |
| Dimensions | Radius | DIMRADIUS | dim-radius | DIMRAD | EXACT | keep |
| Dimensions | Diameter | DIMDIAMETER | dim-diameter | DIMDIA | EXACT | keep |
| Survey Labels | Bearing/Distance | BDLABEL | text | none (no bearing label glyph) | REJECT | text |
| Survey Labels | Curve Label | CURVELABEL | text | none (no chord/label glyph) | REJECT | text |
| Tables | Line Table | LINETABLE | table | TABLE_ADD | STRONG | keep (ACAD `table`) |
| Tables | Curve Table | CURVETABLE | table | TABLE_ADD | STRONG | keep (ACAD `table`) |
| Tables | Parcel Table | PARCELTABLE | table | TABLE_ADD | STRONG | keep (ACAD `table`) |
| Tables | Point Table | POINTTABLE | table | TABLE_ADD | STRONG | keep (ACAD `table`) |
| Tables | Parcel Report | PARCELREPORT | table | none specific | WEAK | keep (ACAD `table`) |
| Tables | Parcel Description | PARCELDESC | table | none specific | WEAK | keep (ACAD `table`) |
| Tables | Table Style | TABLESTYLE | table-style | TABLESTYLE | EXACT | keep |
| Styles | Text Style | TEXTSTYLE | text-style | TXTSTYLE | EXACT | keep |
| Styles | Dimension Style | DIMSTYLE | dim-style | DIMSTY | EXACT | keep |
| Styles | Leader Style | LEADERSTYLE | text | none (no MLEADERSTYLE art) | REJECT | text |
| Styles | Survey Label Styles | SURVEYLABELSTYLE | text | LABEL_STYLE | STRONG | text (deferred) |

---

## Tab: Survey (21)

| Group | Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|---|
| Survey | Points | openSurveyManager('points') | draw-point | POINT | STRONG | adopt (reused ACAD `draw-point`) |
| Survey | Point Groups | openSurveyManager('point-groups') | survey-point-group | POINT_GROUP | STRONG | **adopt** |
| Survey | Point Styles | openSurveyManager('point-styles') | text | none (`POINT_STYLE` absent) | REJECT | text |
| Survey | Point Label Styles | openSurveyManager('point-label-styles') | text | LABEL_STYLE (generic) | WEAK | text |
| Survey | Field to Finish | openSurveyManager('f2f') | text | none (`F2F`/`LINEWORK` absent) | REJECT | text |
| Survey | Survey Symbols | openBlockManager('symbols') | block | BLOCKS | STRONG | keep |
| Transform | Helmert 2D | HELMERT2D | text | none | REJECT | text |
| Transform | Grid/Ground | GRIDGROUND | text | none | REJECT | text |
| F2F | Field to Finish (catalog) | f2f/catalog | text | none | REJECT | text |
| F2F | Feature Codes | f2f/codes | text | none | REJECT | text |
| F2F | Import/Review | f2f/review | text | `SURVEY_IMPORT` is raw data import, not F2F | WEAK | text |
| F2F | Regenerate | f2f/regen | text | none | REJECT | text |
| F2F | Catalog Import | f2f/import | text | `STYLE_IMPORT`/`SURVEY_IMPORT` wrong target | WEAK | text |
| F2F | Catalog Export | f2f/export | text | none | REJECT | text |
| Tables | Line Table | LINETABLE | table | TABLE_ADD | STRONG | keep |
| Tables | Curve Table | CURVETABLE | table | TABLE_ADD | STRONG | keep |
| Tables | Parcel Table | PARCELTABLE | table | TABLE_ADD | STRONG | keep |
| Tables | Point Table | POINTTABLE | table | TABLE_ADD | STRONG | keep |
| Tables | Parcel Report | PARCELREPORT | table | none specific | WEAK | keep |
| Tables | Parcel Description | PARCELDESC | table | none specific | WEAK | keep |
| Tables | Table Style | TABLESTYLE | table-style | TABLESTYLE | EXACT | keep |

---

## Tab: Surface (54)

All 54 Surface-tab controls were text-only before this wave. Adopted icons are
marked **adopt**; the rest stay text.

| Group | Control | Key | Candidate | Conf | Decision |
|---|---|---|---|---|---|
| Create | Create Surface | create | SURFACE_CREATE | EXACT | **adopt** |
| Definition | Add Point Group | point-group | none (`SURFACE_POINT_GROUP` absent) | WEAK | text |
| Definition | Add Points | points | SURFACE_POINT_ADD | EXACT | **adopt** |
| Definition | Breaklines | breaklines | SURFACE_BREAKLINE | EXACT | **adopt** |
| Definition | Boundaries | boundaries | SURFACE_BOUNDARY | EXACT | **adopt** |
| Definition Tools | Bake Copy | bake-copy | SURFACE_TIN (snapshot) | WEAK | text |
| Definition Tools | Bake In Place | bake-in-place | SURFACE_TIN | WEAK | text |
| Definition Tools | Compose | compose | SURFACE_PASTE (overlay) | WEAK | text |
| Definition Tools | Paste | paste | SURFACE_PASTE | EXACT | **adopt** |
| Definition Tools | Create Design Copy | design-copy | none (Design role is WebNet) | REJECT | text |
| Definition Tools | Build Design Patch | build-patch | GRADING_INFILL | WEAK | text |
| Definition Tools | Apply Patch | apply-patch | none | REJECT | text |
| Definition Tools | Earthwork Volume | earthwork-volume | VOLUME_REPORT_GENERATE | STRONG | **adopt** |
| Build | Rebuild | rebuild | none (`SURFACE_REBUILD` absent; CORRIDOR_REBUILD only) | REJECT | text |
| Build | Rebuild All | rebuild-all | none | REJECT | text |
| Select Points | Window | select-window | SURFACE_PICK_IN_DRAWING | WEAK | text |
| Select Points | Polygon | select-polygon | SURFACE_PICK_IN_DRAWING | WEAK | text |
| Select Points | All | select-all | none | REJECT | text |
| Select Points | Invert | select-invert | none | REJECT | text |
| Select Points | Clear | select-clear | none | REJECT | text |
| Edit | Swap Edge | swap | SURFACE_EDGE_SWAP | EXACT | **adopt** |
| Edit | Add TIN Line | add-line | SURFACE_LINE_ADD | EXACT | **adopt** |
| Edit | Delete TIN Line | delete-line | SURFACE_LINE_DELETE | EXACT | text (deferred) |
| Edit | Add Point | add-point | SURFACE_POINT_ADD | EXACT | **adopt** |
| Edit | Delete Point | delete-point | SURFACE_POINT_DELETE | EXACT | text (deferred) |
| Edit | Move Point | move-point | SURFACE_POINT_MOVE | EXACT | text (deferred) |
| Edit | Set Elevation | set-elevation | SURFACE_PROPERTIES_EDIT | WEAK | text |
| Edit | Raise/Lower | raise-lower | SURFACE_RAISE_LOWER | EXACT | text (deferred) |
| Edit | Set Selected Z | bulk-set-z | SURFACE_RAISE_LOWER | WEAK | text |
| Edit | Raise/Lower Selected | bulk-raise-lower | SURFACE_RAISE_LOWER | WEAK | text |
| Edit | Move Selected | bulk-move | SURFACE_POINT_MOVE | WEAK | text |
| Edit | Edit History | history | none | REJECT | text |
| Inquiry | Surface Elevation | elevation | SURFACE_DEFINITION | WEAK | text |
| Style | Surface Styles | styles | SURFACE_STYLE | EXACT | **adopt** |
| Display | Contours | contours-toggle | SURFACE_CONTOURS | EXACT | **adopt** |
| Analysis | Elevation | new-elevation | `SURFACE_ANALYSIS_ELEVATION` absent | REJECT | text |
| Analysis | Slope | new-slope | `SURFACE_ANALYSIS_SLOPE` absent | REJECT | text |
| Analysis | Manager | manager | SURFACE_DEFINITION | WEAK | text |
| Analysis | Inquiry | inquiry | none | REJECT | text |
| Volume | Create Volume | create-volume | SURFACE_TIN_VOLUME | EXACT | **adopt** |
| Volume | Depth | depth | `SURFACE_ANALYSIS_DEPTH` absent | REJECT | text |
| Volume | Calculate | calculate-volume | SURFACE_TIN_VOLUME | WEAK | text |
| Volume | Difference Inquiry | difference-inquiry | none | REJECT | text |
| Volume | Volume Report | volume-report | VOLUME_REPORT_GENERATE | STRONG | **adopt** |
| Analysis Legend | Create Legend | create-legend | none | REJECT | text |
| Profile | Create Surface Profile | profile-create | PROFILE_CREATE_FROM_SURFACE | EXACT | text (deferred) |
| Profile | Profile Manager | profile-manager | PROFILE_STYLE | WEAK | text |
| Profile | Create Profile View | profile-view | PROFILE_VIEW_CREATE | EXACT | **adopt** |
| Profile | Profile Elevation | profile-elevation | TRANSCMD_PROFILE_STATION_ELEVATION | WEAK | text |
| Sections | Sample Lines | sample-lines | SAMPLE_LINE | STRONG | text (deferred) |
| Sections | Add Sample Line | sample-line-add | SAMPLE_LINE | WEAK | text |
| Sections | By Interval | sample-line-interval | SECTION_SAMPLE_LINES_CREATE | WEAK | text |
| Sections | Rebuild Sections | section-rebuild | SECTIONS_EDIT | WEAK | text |
| Sections | Create Section Views | section-views | SECTION_VIEW_CREATE | EXACT | **adopt** |

---

## Tab: Output (6)

| Group | Control | Key | Icon | Candidate | Conf | Decision |
|---|---|---|---|---|---|---|
| File | New Drawing | SHELL_NEW | file-new | NEW | EXACT | keep |
| File | Open Drawing | SHELL_OPEN | file-open | OPEN | EXACT | keep |
| File | Save Drawing | SHELL_SAVE | file-save | SAVE | EXACT | keep |
| File | Export Center | SHELL_EXPORT_CENTER | text | EXPORTC3DDRAWING | WEAK | text |
| File | Sheets & Layers | SHELL_SHEETS_LAYERS | text | SHEETS_CREATE | WEAK | text |
| File | Import LandXML | SHELL_IMPORT_LANDXML | landxml-import | LAND_XML_IMPORT | EXACT | **adopt** |

---

## Adopted set (25 ids)

| WebNet id | Civil family | Controls wired | Conf |
|---|---|---|---|
| surface-create | SURFACE_CREATE | Surface › Create Surface | EXACT |
| surface-boundary | SURFACE_BOUNDARY | Surface › Boundaries | EXACT |
| surface-breakline | SURFACE_BREAKLINE | Surface › Breaklines | EXACT |
| surface-contours | SURFACE_CONTOURS | Surface › Contours | EXACT |
| surface-paste | SURFACE_PASTE | Surface › Paste | EXACT |
| surface-volume | SURFACE_TIN_VOLUME | Surface › Create Volume | EXACT |
| surface-volume-report | VOLUME_REPORT_GENERATE | Surface › Volume Report, Earthwork Volume | STRONG |
| surface-swap-edge | SURFACE_EDGE_SWAP | Surface › Swap Edge | EXACT |
| surface-line-add | SURFACE_LINE_ADD | Surface › Add TIN Line | EXACT |
| surface-add-point | SURFACE_POINT_ADD | Surface › Add Point, Add Points | EXACT |
| surface-style | SURFACE_STYLE | Surface › Surface Styles | EXACT |
| feature-line-create | FEATURE_LINE_CREATE | Feature Line › Create Feature Line | EXACT |
| feature-line-elevation | GRADING_FLINE_ELEVS_EDIT | Feature Line › Set Elevations | STRONG |
| feature-line-elev-from-surface | GRADING_FLINE_ELEVS_FROM_SURF | Feature Line › Set Vertices from Surface | EXACT |
| feature-line-raise-lower | GRADING_FLINE_RAISE_LOWER | Feature Line › Raise/Lower | EXACT |
| feature-line-insert-vertex | GRADING_FLINE_PI_INSERT | Feature Line › Insert Vertex | STRONG |
| grading-create | GRADING_CREATE | Grading › Grade to Surface | STRONG |
| grading-group-create | GRADING_GROUP_CREATE | Grading Groups › Grade Group | STRONG |
| parcel-props-edit | PARCEL_PROPS_EDIT | Network › Designate Parcels | STRONG |
| parcel-segments-edit | PARCEL_SEGMENTS_EDIT | Parcel › Set Parcel Course Arc, Straighten Parcel Course | STRONG |
| parcel-renumber-tags | TAGS_RENUMBER | Network › Number Parcels | STRONG |
| survey-point-group | POINT_GROUP | Survey › Point Groups | STRONG |
| profile-view | PROFILE_VIEW_CREATE | Surface › Create Profile View | EXACT |
| section-view | SECTION_VIEW_CREATE | Surface › Create Section Views | EXACT |
| landxml-import | LAND_XML_IMPORT | Output › Import LandXML | EXACT |

`surface-add-point` and `surface-volume-report` are each placed on two
controls, and `parcel-segments-edit` covers two Parcel buttons, so the 25 new
ids back 28 new placements; four further placements reuse existing ids
(`table` ×3, `draw-point` ×1).

## Rejected candidates (with reasons)

- **Circle / Ellipse / Rectangle / Polygon / plain Hatch** — no artwork in
  either library (`CIRCLE`, `ELLIPSE`, `RECTANG`, `POLYGON` families absent;
  only misleading neighbours like `TCIRCLE`, `REVCLOUD_*`). Text faces stay.
- **Shared boundary (Link/Unlink)** — no `SHARED*` family; no truthful glyph.
- **Chord / bearing label glyphs (BDLABEL, CURVELABEL)** — no chord artwork in
  the Civil index; `LINE_CREATE_BY_...` glyphs create lines, not labels.
- **Daylight extract (GRADINGEXTRACTDAYLIGHT, GRADINGGROUPEXTRACTDAYLIGHT)** —
  daylight art lives only in tool-palette object previews, not 16/32 px button
  art. WEAK → rejected.
- **Layer / Xref** — zero `LAYER*`/`XREF*` families in the Civil index; those
  stay on the AutoCAD set.
- **F2F / Field-to-finish / Linework** — zero `F2F`, `FIELD_TO_FINISH`,
  `LINEWORK` families. Text faces stay.
- **Helmert / Grid-Ground transform** — no `HELMERT`/`TRANSFORM` family; the
  `TRANSCMD_*` glyphs are command-line internals, not ribbon-grade.
- **Paste (Modify tab)** — `SURFACE_PASTE` is surface-specific; reusing it for
  the general paste command would lie. Text stays.
- **Bake / Design Copy / Design Patch / Apply Patch / Rebuild / Legend** —
  WebNet-specific semantics with no Civil counterpart.
- **Analysis Elevation/Slope/Depth bands** — no dedicated Civil band-analysis
  glyph family in the index.
- **Simple point selection (Window/Polygon/All/Invert/Clear)** — no distinct
  Civil glyphs; a point-pick glyph would be inventing meaning.

## Remaining gaps

Text-only controls still without a truthful curated asset (documented, not
faked): all Geometry primaries except Line/Arc, Traverse, Paste, Helmert/Grid/
Project transforms, Select/Clear, Point Styles, Point Label Styles, all F2F,
Layer manager (has ACAD art via `layers` in the shared map but the Home Layers
manager button intentionally keeps its bespoke chrome), the Surface definition/
edit controls not listed above, Surface analysis/legend, Sample Lines group,
Section rebuild, Export Center, Sheets & Layers.

Deferred-but-available ids (evidence-ready, not adopted to keep the wave
bounded to 25): `surface-line-delete`, `surface-point-delete`,
`surface-point-move`, `surface-raise-lower`, `feature-line-delete-vertex`,
`grading` (manager), `profile-create` (surface profile), `sample-line`,
`SURVEYLABELSTYLE ← LABEL_STYLE`, `TRAVERSE ← TRAVERSE_EDITOR`,
`CURVE_SOLVER ← CURVE_CALCULATOR`.

## Orphan manifest ids (pre-existing)

Three Phase 21A ids remain unreferenced and were intentionally left alone (no
command exists for them, so wiring would require inventing a control):

- `draw-spline` — no SPLINE command in the registry.
- `draw-3dpoly` — no 3DPOLY command in the registry.
- `dim-arc-length` — no `DIMARC` command; the Annotate Dimensions group does
  not surface an arc-length dimension.

They are trivially safe to keep (assets already committed, no runtime use) and
would be wired the day the matching command lands. Reported, not changed.

## Verification note

The `tests/cad_ribbon_icon_manifest.test.tsx` suite locks the contract this
doc describes: every manifest id ships a real 16/32 px PNG inside the curated
icon directory, every icon referenced by the registry map / tool families /
tab wiring resolves in the manifest, and no `src/` file references
`local-assets` outside comments.
