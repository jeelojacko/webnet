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

## Survey outputs to support later
- survey plan
- control sketch
- topo plan
- parcel plan
- surface/volume exhibit
- adjustment/preanalysis exhibit
