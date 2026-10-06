# Circle v1 Architecture (baseline main 6c7380a9)

First-class `CadCircleEntity {type:'circle', centerX, centerY, radius}` —
no sweep fields, no arc encoding, no fullCircle flag. Union arms:
`CadEntity`, `CadBlockChild`. Grip kinds `circle-center`/`circle-radius`.

## Layers touched (all additive)

- Types: `cadTypes.ts` (entity + block child + grip kinds; `MlightcadSpikeEntity` gains `AcDbCircle`).
- Builders: `cadGeometryShapeBuilders.ts` — `buildCircleCenterRadius[Scalar]`,
  `buildCircleCenterDiameter[Scalar]` on the existing `CAD_XY_DEGENERATE_FLOOR`
  (now exported for reuse; no new epsilon).
- Commands: `CIRCLE`/`CIRCLECD` in `cadTransactionsShapeCommands.ts`,
  registered in `CAD_COMMAND_REGISTRY`; current layer, ByLayer, select-new,
  one undo entry; prefixes CIR/CIRD.
- Sessions: 2-stage center→second-point in starters/consume/submit/text/help/
  preview/construction/session-pick-gating; scalar typed input reuses generic
  point parsers; degenerate input keeps session alive with bounded text.
- Ribbon: `circle-center-radius`→CIRCLE, `circle-center-diameter`→CIRCLECD,
  text face, default stays Center/Radius; 2P/3P/TTR/TTT remain planned.
- Render: `CadDisplayCirclePrimitive` → native SVG `<circle>` + hit pad;
  preview + transform-preview + selection-box paths extended.
- Spatial: center±r bounds, snap-geometry membership, per-entity candidates
  (center/quadrant/nearest/tangent/perpendicular), intersection dispatch
  (segment×circle, circle×circle, arc×circle via sweep filter), block-child
  candidates (center/quadrant/nearest, never endpoint).
- Transforms: similarity arm (radius × |scale|); GENERAL_AFFINE refuses
  `CAD_TRANSFORM_CIRCLE_AFFINE_UNSUPPORTED`. Grip edit: center move,
  radius resize on the floor.
- Blocks: child support (points/bounds/preview/selection/snaps/persist/
  sources), uniform transforms; non-uniform block scale throws
  `CAD_BLOCK_CIRCLE_NON_UNIFORM_SCALE` (never mean-scales).
- Persistence: clone arm; no version bump; no migration; old files unchanged.
- DXF: `model.circles` + native CIRCLE groups 10/20/30/40 (+ block children);
  optional fields so existing model literals keep compiling. No ARC fallback,
  no import work.
- MlightCAD: `AcDbCircle` arm (center + radius).
- Properties: Center E/N, Radius, Diameter, Circumference, Area; no arc-only
  fields. Names: 'Circle' labels. Clipboard: offset copy with layer remap.
- Refusals (existing whitelists, unchanged): trim (line/polyline/arc only),
  extend (line/polyline), fillet (line pairs), reverse/compound/offset (arc
  sessions), parcel/feature conversion (default null/skip), LandXML default
  skip, curve tables (no circle rows).
