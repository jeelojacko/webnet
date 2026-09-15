# Survey drafting + deliverables (Phase 13B + 13C polish)

Plan-production layer over the Survey CAD model: paper-space sheets with
scaled viewports, derived labels and tables, and SVG/PDF/DXF deliverables.
The adjustment, GNSS, COGO, and parcel-legal engines are untouched; drafting
only reads model geometry and never writes back to it.

## Model space vs sheet space

- **Model space** is the `CadProject` entity store in survey units (metres):
  survey points, lines, arcs, parcels, and anchored text labels. Stored
  coordinates are never mutated by drafting operations.
- **Sheet space** is the `DraftDocument` (`.wncad` `draft` section): sheets,
  viewports, title blocks, and paper-space notes. All drafting edits target
  this document only, through the pure helpers in `cadSheets.ts`.
- **Paper units are millimetres.** Model→paper mapping subtracts the
  viewport centre in model units *before* scaling
  (`paperMm = paperOrigin + (modelM − centreM) × 1000 / scaleDenominator`),
  so large-grid coordinates (E ≈ 2.4M, N ≈ 7.4M) lose nothing to float
  cancellation in the sheet scene. DXF keeps full large-grid model
  coordinates (serialised to 3 decimals, i.e. mm).

## Labels: derivation, provenance, overrides

Labels are derived from live geometry via `cadLabelEngine.ts`:

- point (`N <northing>, E <easting>`), bearing, distance,
  bearing-distance (inverse summary), curve (`R`, `Δ`, arc, chord from
  radius+delta), area (parcel closure, m² or sq ft), free text.
- Every label carries **provenance**: `ADJUSTED` (imported adjustment
  result), `COGO` (computed geometry), `IMPORTED`, or `USER_TEXT`, plus a
  value state: `AUTO_VALUE`, `USER_OVERRIDE`, or `BROKEN_REFERENCE`.
- An operator override replaces only the display text; the auto value is
  retained so the override can be cleared. A dangling source reference
  renders `BROKEN_REFERENCE` and raises an export warning instead of
  failing the export (only a missing sheet is fatal).

## Viewports: scale and rotation

- Scale is an explicit denominator (`1:N`); `modelToPaperMm` /
  `paperMmToModel` convert at the paper boundary only. Fit-to-page only
  *suggests* a denominator — the recorded explicit value is authoritative
  and is what the title block and scale bar use.
- Rotation is viewport-only (paper presentation). The sheet preview applies
  it as a paper-space transform; stored geometry is untouched.

## Grid-north semantics

The north arrow is **grid north only** — never true/geodetic north. Viewport
rotation θ turns model content clockwise by θ as seen on the sheet (up/north
at θ=0), so the arrow points θ-clockwise-from-up (`+rotation`, normalised to
0–360°) and always agrees with the rotated geometry. Scale bars are likewise
linked to the viewport denominator and are rotation-invariant (pure paper
geometry). The sheet preview renders the same north-up frame as SVG/PDF;
the viewport clip stays an axis-aligned paper rect under rotation.

## Title-block tokens

Bounded token set: `{PROJECT_NAME}`, `{SHEET_NAME}`, `{SHEET_NUMBER}`,
`{SCALE}`, `{CRS}`, `{DATE}`. Unknown tokens are kept literal and reported
as `UNKNOWN_TOKEN` warnings. Multi-sheet order is the explicit sheet array
order, which also sets PDF page order and sheet numbering.

## Export scope (SVG / PDF / DXF)

- One canonical paper-space scene (`buildExportSheetScene`) feeds the
  screen preview, the SVG serializer, and the PDF adapter, so the three
  agree by construction. Curve fixtures pin this numerically across all
  three deliverables in `tests/cad_draft_integration.test.ts`.
- **SVG** is the canonical paper deliverable (mm, viewport clips as
  `clipPath`). **PDF** is a hand-rolled vector adapter: page size equals
  the sheet definition, Standard-14 Helvetica only (no embedding) with
  `/Encoding /WinAnsiEncoding` declared on the font dictionary.
  WinAnsi-encodable text is emitted as literal bytes (delimiter/octal
  escapes); non-WinAnsi glyphs (Δ, primes, and others) use deterministic
  substitutions via `sanitizePdfText`, each reported as an explicit
  `GLYPH_SUBSTITUTION` warning — never UTF-16BE hex; multi-page order
  is the explicit input order.
- **DXF is dual-contract** (`dxf/` adapter boundary): `buildDxfModelSpaceText`
  keeps the R12 model-space-only survey export byte-identical (points,
  lines, closed boundaries, arcs, model texts in survey coordinates; paper
  objects deliberately excluded so the grid is never corrupted), while
  `buildDxfLayoutText` adds an R2000 (`$ACADVER AC1015`) multi-layout
  export — one named LAYOUT per sheet (paper size in mm), VIEWPORT id 1+
  per layout carrying center/scale (view height) /twist, title block as
  BLOCK+INSERT, and paper annotations in mm; unrepresentable sheet
  objects return explicit warnings instead of fake geometry.
- **DXF R12 limits:** `$ACADVER AC1009` ASCII with fixed group codes, no
  handles/reactors/dictionaries; closed boundaries use LWPOLYLINE (one
  widely-accepted post-R12 concession); serialisation precision is
  3 decimals.

## File format and legacy migration

`.wncad` is JSON (`kind: webnet-cad-drawing`); current `schemaVersion` is
**2**. Opening a v1 file migrates it (geometry preserved bit-for-bit,
fresh blank draft when absent); save-as writes v2, and reopening is
identical. Drafting operations never touch observations, weights, GNSS
state, adjustment settings, or CRS — pinned by an isolation test that
snapshots those domains across the full drafting battery.

## Label deconfliction + leaders (Phase 13C §§12-21)

Labels carry placement state `AUTO`/`MANUAL` (legacy `AUTO_GENERATED`/`MANUAL_OVERRIDE` read back to the same states) plus optional per-viewport paper-mm overrides (`dxMm`/`dyMm`/`rotationDeg`/`visible`) and a presentation-only leader (`enabled`, `elbowMm`, `lineweightMm`) — all persisted on the draft document (schema stays v1, additive only) and never touching source geometry. `cadLabelAutoPlacement.ts` offers optional paper-mm auto-placement over a deterministic 8-candidate set (NE/NW/SE/SW/above/below/along-left/along-right) scored by overlap + leader length + distance + clipping with label-id tie-breaks; it touches AUTO labels only unless `reset: true`, enables leaders beyond a paper-mm threshold (default 3 mm), and any manual edit flips the label to MANUAL. Geometry edits refresh label text while keeping manual placement; a missing source resolves to `BROKEN_REFERENCE`. SVG, PDF, and layout DXF share one per-viewport resolver (`buildPaperLabelItems`), so placed text + leaders render identically in all three. A positive `elbowMm` renders a two-segment elbow (horizontal jog from the source point, clamped to |dx|, then straight to the text); otherwise the leader is a single straight segment.

## Table continuation + title-block templates (Phase 13C §§22-30)

- A logical table owns its rows; fragments reference deterministic row
  ranges only (no copies). AUTO slices sequentially, MANUAL keeps the
  first fragment; headers repeat and later fragments carry a `Continued`
  marker. Source edits recompute all ranges; coverage (every row exactly
  once, in order) is validated, never silently resized.
- Title blocks are visual templates: paper-mm line/rect/static-text/
  token-text elements with alignment, font size, and lineweight. Bounded
  11-token set including viewport `{SCALE}`; unknown tokens stay literal
  with `UNKNOWN_TOKEN` warnings. Create/duplicate/rename/edit/
  delete-if-unused/assign; one renderer (`buildTitleBlockItems`) feeds
  preview, SVG, PDF, and layout DXF. History- and persist-round-tripped
  with stable ids.

## LandXML interchange (Phase 13C §§31-48)

- **Import** (`landxmlImport.ts`, preview-only staged review): bounded
  LandXML 1.2 subset — CgPoints (N-E order), lines + circular curves,
  geometric parcel rings, line+curve alignments. Spirals and other
  out-of-subset geometry warn + count, never silently drop.
- **Units** are explicit only: `meter`, `foot` (international foot,
  0.3048 m exactly), `USSurveyFoot` (1200/3937 m); unknown units fail
  closed. **CRS** is retained as opaque metadata, never auto-transformed
  (`UNKNOWN` when absent).
- Duplicates reject-or-rename; all failures are bounded throws, never
  partial trees. XML parses via `parseXmlDocument` (16 MiB / 200k-node /
  64-deep bounds, no DTD/DOCTYPE/ENTITY — no XXE). The adjustment
  LandXML exporter is frozen byte-identical (golden-pinned).
- **Export** (`landxmlCad.ts`): CAD/COGO geometry in metres → LandXML
  1.2, reusing the adjustment serializer helpers (N-E order, 6 decimals)
  so both writers stay byte-consistent.
- **Geometry vs legal:** parcels and alignments cross the boundary as
  geometric data only — no area, ownership, priority, monument, or
  certification inference is encoded or imported. Imports never create
  observations and never enter the least-squares adjustment.

## Polish integration (Phase 13C §§49-52,55-59)

- One sheet pins identical text across scene, SVG, and PDF (auto + manual
  placements, leaders, continued-table titles, tokenised title block,
  viewport scale, grid-north arrow, scale bar); layout DXF maps the same
  sheet to the documented R2000 subset. Large-grid (E=2400000/N=7400000)
  round-trips exactly through labels, layout DXF, and LandXML.
- Save/reopen is semantically identical (schema stays v2; pre-13C v2
  files open with safe drafting defaults). Auto-place, reset, leader,
  table-continuation, and title-block edits are undoable; a LandXML
  import stages as a single draft transaction. Pinned by
  `tests/cad_draft_polish_integration.test.ts` (11 tests).

## Sample

`public/examples/survey_plan_sample.wncad`: adjusted + COGO points, one
parcel, one curve, anchored course/point/curve/area labels, one ISO A3
sheet with a 1:500 viewport, a tokenised title block, and a plan note.
North arrow, scale bar, and the coordinate table are derived at export
time and pinned by the sample test.

## Legal disclaimer

Draft plans are **not legal or certified survey documents**. They carry no
ownership, priority, monument, or legal-certification implications. The
sheet preview and every title block repeat: *Draft plan — not a legal or
certified survey document.*
