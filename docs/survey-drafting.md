# Survey drafting + deliverables (Phase 13B)

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
  the sheet definition, Standard-14 Helvetica only (no embedding),
  non-ASCII text (°, ², Δ) as UTF-16BE hex strings; multi-page order is
  the explicit input order.
- **DXF is model space only** (`dxf/` adapter boundary): points, lines,
  closed boundaries, arcs, and model texts in survey coordinates.
  Paper-space objects (viewports, title blocks, north arrows, scale bars,
  sheet notes) are deliberately excluded — flattening them into fake model
  coordinates would corrupt the survey grid.
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
