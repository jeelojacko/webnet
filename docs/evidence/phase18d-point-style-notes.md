# Phase 18D — Point Style Notes (radius units + scope)

## Radius unit decision

**Chosen semantics:** `CadPointStyle.markerScale` is a unitless multiplier on
the referenced `CadPointSymbol.radius`, evaluated in **drawing units** — the
same space the screen renderer already uses (`pointRadius()` in
`cadRendererStyle.ts`). A style with `markerScale: 2` on `point-free`
(radius 1.8) draws a 3.6-drawing-unit marker. Default `markerScale` is 1,
so every seeded style renders exactly like its symbol did pre-18D.

**Why not paper mm:** the SVG/PDF export path reuses the drawing-unit radius
as a paper-mm number (`cadExportScene.ts`), so marker size does not scale
with plot scale. That gap predates 18D (see map doc P4) and is recorded as
known-future work — 18D deliberately does NOT silently redefine it, because
doing so would change legacy export output without a golden update.

## Scope reminder

- `CadPointStyle` owns marker presentation only: symbol ref, scale, rotation,
  display on/off.
- Color, transparency, visibility, and layer ownership stay with the 18C
  resolver (`resolveCadEntityAppearance`). Point styles never carry color.
- `pointStyleOverrideId` is manual-override intent (`undefined` = By Default);
  no resolved output is ever stored on the entity.
- Schema stays at version 2: `pointStyles` and both entity refs are optional
  and backfilled on load, so legacy `.wncad` files open with visually
  equivalent markers (migration maps each legacy `styleId→pointSymbolId` to
  a base style referencing the SAME symbol at scale 1).
