# Phase 19C Round 2C — Curved-Parcel Outputs (tables / report / description / tags / exports)

Branch: `feat/cad-curved-parcel-courses` (baseline Round 1 `cc2daa57`).
Scope: outputs only (tables, report, legal description, tag anchors, DXF,
LandXML, SVG/PDF sheet). Reads the SAME shared resolver as every other 19C
consumer — no curve math is duplicated here.

## Parcel Course Table

- All-straight parcels keep the exact 19A headings/rows:
  `Course | From | To | Bearing | Distance (m)`.
- A parcel with ≥1 curved course grows:
  `Course | From | To | Bearing | Distance (m) | Type | Radius (m) | Delta | Arc (m) | Chord (m) | Chord Bearing | Direction`.
- Arc rows leave `Bearing`/`Distance` blank and carry chord truth only under
  `Chord`/`Chord Bearing` — chord values never appear under a line heading.
- Line rows keep line Bearing/Distance and blank arc cells; `Type` reads
  LINE/ARC.
- Arc tag anchors use the canonical resolver's TRUE arc midpoint; a manual
  `tagOffset` is applied relative to that anchor. Course-ID authority is
  unchanged: a straight → arc conversion keeps the same courseId and the
  bound row stays valid (read-time derive, no table transaction); a retired
  courseId yields `BROKEN_REFERENCE`, never a silent rebind.

## Parcel Report

`cadBuildParcelReportSummary` takes `courseGeometry` into the closure and
course paths: Area/Perimeter/Closure are the exact curved values, and arc
course entries carry `kind/direction/radiusMeters/deltaDeg/arcLengthMeters/
chordBearing/chordLengthMeters` alongside the chord-based `bearing/distance`.

## Legal description

The curved block is lifted. Arc calls read radius/delta/arc length/chord
bearing/chord distance/direction from the shared resolver; reverse traversal
swaps endpoints, flips left↔right, keeps radius/|delta|/length, and reverses
the chord bearing (+180°). Tangency wording is omitted by default; opt-in
`includeTangency` reports the proven `TANGENT`/`NON_TANGENT` status from
`checkParcelCourseTangency`. Wording stays DRAFT / jurisdiction-neutral.

## Export dispositions

| Format | Straight parcel | Curved parcel | Disposition |
|---|---|---|---|
| DXF R12 | closed LWPOLYLINE | native LINE + ARC | APPROXIMATED (parcel-semantic warning retained; geometry exact) |
| DXF R2000 layout | same model primitives | native LINE + ARC | APPROXIMATED (same warning) |
| LandXML 1.2 `<Parcel>` | ring `<Line>` chain | schema-supported `CoordGeom` `<Curve rot= radius=>` | EXACT geometry + retained semantic warning (never a silent chord) |
| SVG / PDF | exact outline | exact arc primitives through the canonical sheet scene | FULL |
| WNCAD | exact | exact `courseGeometry` round-trip | FULL |

LandXML choice: the 1.2 schema's `Parcel/CoordGeom/Curve` is audited to
support the exact circular representation, so the writer emits it instead of
a chord; the existing "geometric only, no legal parcel meaning" warning and
`approximatedEntityIds` entry are retained for parcel semantics.

## Oracles

New: `tests/cad_parcel_curved_outputs_19c.test.ts` (mixed table, convert-course
identity, retired-course BROKEN_REFERENCE, reverse, tangency wording,
description determinism) and `tests/cad_parcel_curved_exports_19c.test.ts`
(DXF ARC pins, LandXML Curve disposition, SVG arc-path / 1:250·1:500·1:1000
viewport pins, straight-vs-curved export matrix, WNCAD save/reopen equality
for line/minor/major/opposite-hand).
