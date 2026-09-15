# WebNet CAD Layout and Plotting

## Purpose
Define model/layout plotting direction early so annotation and deliverable logic do not become retrofit work.

## Core concepts
- model space: real-world coordinates
- layout space: paper/sheet coordinates
- viewport: model-space window on sheet
- annotation: model-scaled or paper-scaled by rule

## Minimum deliverables
- sheet templates
- title blocks
- north arrow
- scale bar
- legend
- viewport scale and rotation
- PDF export
- plot preview

## Export result contract + color fidelity (Phase 13E B1+C1)

- `src/engine/cad/exportResult.ts` is the unified result shape for
  exporters: `{ output, warnings, errors, exportedEntityIds,
  omittedEntityIds, approximatedEntityIds }`. No silent drops — every
  skipped entity lands in `omittedEntityIds` with a warning, every
  approximated one (non-circle point symbols render as circles) in
  `approximatedEntityIds` with `POINT_SYMBOL_APPROXIMATED`.
- `src/engine/cad/resolveEffectiveColor.ts` is the single shared color
  resolver with frozen precedence entity/style override → style → layer →
  default (`#94a3b8`), plus the hex→0..1-RGB helper for PDF `RG`/`rg` ops.
- Scene→export carries stroke/fill/width/dash from display primitives into
  every `ExportItem`; items without a resolved color inherit their layer
  color. SVG emits `stroke`/`fill`/`stroke-width`; PDF emits matching `RG`
  (strokes) / `rg` (fills/text) ops. Legacy bare-return functions remain as
  thin wrappers; `*WithResult` variants add the unified contract.
- `BROKEN_REFERENCE` placeholders render unchanged but now surface through
  the SVG and PDF warning channels as well as the scene builder.
- Coverage: `tests/cad_export_color.test.ts` (distinct-color SVG/PDF
  fidelity, contract lists, non-mutation, byte-identical SVG).

## Export coverage matrices (Phase 13E §§22,23) + no-silent-drop policy (§21)

Status key: FULL = geometry preserved as drawn; APPROXIMATED =
representation differs, always warned; NOT_APPLICABLE = format has no
representation, warn-if-requested via the `WithResult` variant; 
UNSUPPORTED_WITH_WARNING = omitted with an explicit warning. Policy: no
silent drops — every skipped entity lands in `omittedEntityIds` with a
warning, every approximated one in `approximatedEntityIds` with a warning
(`src/engine/cad/exportResult.ts`). Contract: exported XOR omitted;
approximated is a subset flag of exported (approximated ⇒ exported +
warning).

### Entity × format matrix (§22)

| Entity | SVG / PDF | DXF R12 | DXF R2000 | LandXML |
| --- | --- | --- | --- | --- |
| survey-point | FULL | APPROXIMATED (`POINT_SYMBOL_APPROXIMATED`: POINT+TEXT, no block library) | APPROXIMATED (same) | FULL (CgPoint) |
| line | FULL | FULL | FULL | FULL |
| polyline | FULL | FULL | FULL | FULL (as segments) |
| polygon / parcel | FULL | APPROXIMATED (closed polyline, geometric only — no legal meaning) | APPROXIMATED (same) | APPROXIMATED (geometric ring only) |
| arc | FULL | FULL (ARC) | FULL (ARC) | APPROXIMATED (circular curve) |
| text / label | FULL (PDF: `GLYPH_SUBSTITUTION` for non-WinAnsi) | FULL (TEXT) | FULL (TEXT) | NOT_APPLICABLE (warn-if-requested) |
| alignment | FULL | APPROXIMATED (expands to line/arc primitives, per-element warnings) | APPROXIMATED (same) | FULL (line+curve alignment) |
| error-ellipse | FULL | APPROXIMATED (faceted 36-gon polyline, warned) | APPROXIMATED (same) | NOT_APPLICABLE (warn-if-requested) |
| broken-reference label | FULL + `BROKEN_REFERENCE` warning | FULL + warning | FULL + warning | NOT_APPLICABLE (warn-if-requested) |
| non-finite / invalid geometry | UNSUPPORTED_WITH_WARNING (`SKIPPED_ENTITY`, omitted) | same | same | same |
| paper-only sheet objects in model export | n/a | UNSUPPORTED_WITH_WARNING (model-space-only; paper excluded) | FULL (own LAYOUT) | n/a |

### F2F-generated objects × format matrix (§23)

F2F generates exactly three CAD kinds (`cadGeneration.ts`): `survey-point`
entities, `line`/`polyline` linework entities, and anchored auto text
labels. They export per the rows above — no F2F-specific serializer
exists. Consequences: generated points always carry
`POINT_SYMBOL_APPROXIMATED` in DXF; generated labels are FULL in
SVG/PDF/DXF and NOT_APPLICABLE in LandXML; GENERATED vs
MANUAL_OVERRIDE/DETACHED state never appears in any export (model-only
provenance); unmapped-source points export as ordinary points (their
`F2F-UNMAPPED` layer travels as a plain layer name).

## Export Center UI + scopes (§57)

`src/engine/cad/exportCenter.ts` + `ExportCenterPanel.tsx`: seven formats
with fixed scopes — SVG (current sheet), PDF (current sheet or all
sheets), DXF R12 (model space, survey coordinates), DXF R2000 (paper
layouts, all sheets), LandXML (model/CAD geometry), `.wncad` (full
drawing), Feature Catalog JSON (active catalog). Filenames derive from
the sanitized project stem (`sanitizeExportStem`). The panel shows a
pre-download preview (format label, scope label, filename) plus the
per-entity warnings for the selection before download — every format
computes its warnings and exported/omitted/approximated dispositions
before download (LandXML goes through the production CAD→LandXML
adapter, DXF R12 merges model + serializer warnings, DXF R2000 surfaces
model dispositions alongside paper warnings). The Feature Catalog JSON
tab exports the workspace-owned active catalog — the same object the
Field-to-Finish panel edits. Sheet picker shows for SVG and current-sheet
PDF; PDF scope toggle shows for PDF only.

## Color policy + precedence (§§24-27, §57)

Single shared resolver `resolveEffectiveColor` (override → style →
layer → default `#94a3b8`), frozen to match the screen renderer — scene
building, SVG, and PDF all resolve through it. DXF maps the resolved
hex through `dxf/dxfColorMap.ts`: R12 stores nearest-ACI group 62 only
(an approximation, never exact RGB; omitted groups mean BYLAYER); R2000
adds group 420 true color alongside the compatibility ACI. The ACI
table is the standard Autodesk palette: exact 1-9, decades 10-249 (24
pure hues × shade factors 1.0/0.8/0.6/0.5/0.3 with white-mix tints —
e.g. ACI 10 is 255,0,0 and ACI 12 is 204,0,0), gray ramp 250-255;
ties resolve to the lowest index. Non-hex color input resolves to
mid-gray (documented).

## DXF approximation rules (§§28,29,31,32, §57)

- Linetypes: bounded catalog — `continuous` + `dash-short` (DASHSHORT)
  only. The R12/R2000 LTYPE table carries exactly the referenced types;
  unknown ids fall back to Continuous with a call-site warning, never a
  silent solidify.
- Lineweights: R12 has no group 370 — a lineweight warning is emitted
  instead of encoding. R2000 rounds millimetres to the nearest group-370
  fixed-set member (non-finite → 25).
- Point symbols: POINT+TEXT always, `POINT_SYMBOL_APPROXIMATED` always
  warned (no block library).
- Polygons/parcels: closed polyline, APPROXIMATED + warned (geometric
  only, no legal parcel meaning). Alignments: expanded line/arc
  primitives, APPROXIMATED + warned; partially skipped elements warn
  entity-attributed while the wrapper stays exported + approximated.
- Degenerate polylines/polygons/parcels/texts/arcs (too few or
  non-finite vertices, non-finite coordinates/angles) are omitted with
  a warning — serializers never coerce non-finite numbers to 0.
- Ellipses: 36-gon closed polyline in DXF (warned); NOT_APPLICABLE in
  LandXML.

## FLD (§48)

FLD_DEFERRED — no Carlson FLD parser exists; see `docs/FIELD_TO_FINISH.md`
for the rationale. FXL remains SUPPORTED_SUBSET with no widening on this
branch; coded curves remain deferred (manual COGO curves only, no
arc/curve inference from field codes).

## Survey outputs to support later
- survey plan
- control sketch
- topo plan
- parcel plan
- surface/volume exhibit
- adjustment/preanalysis exhibit
