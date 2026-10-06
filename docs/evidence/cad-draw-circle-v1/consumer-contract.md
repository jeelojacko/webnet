# Circle v1 Consumer Contract (baseline main 6c7380a9)

Per-site contract for the first-class kind. Status: SUPPORT = arm added;
GENERIC = kind-agnostic, no change; REFUSAL = deterministic fail-closed;
N-A = unreachable for circles.

| Site | Contract |
|---|---|
| `CadEntity` / `CadBlockChild` unions | SUPPORT (kind + grips `circle-center`/`circle-radius`) |
| persistence clone/sanitize | SUPPORT (validating arm: shared `isValidCircleGeometry` — finite center/radius + floor; malformed top-level and block-child circles throw fail-closed at load/clone, matching parcel/feature-line convention) |
| project bounds | SUPPORT (center±r) |
| renderer display primitive | SUPPORT (`circle` primitive, native SVG ring + hit pad) |
| preview / transform-preview / selection-box | SUPPORT (native circle paths) |
| spatial bounds / index / entity candidates | SUPPORT (center±r; snap-geometry member) |
| intersections | SUPPORT (segment×circle, circle×circle, arc×circle via sweep filter; apparent-intersection not extended) |
| block snaps / preview / selection / persist / sources | SUPPORT (center/quadrant/nearest; no endpoint) |
| clipboard copy | SUPPORT (offset + layer remap) |
| translate / similarity transforms | SUPPORT (radius × \|scale\|) |
| grips + grip edits | SUPPORT (center move, radius resize on floor) |
| properties / names | SUPPORT (center/radius/diameter/circumference/area; 'Circle') |
| DXF model + serializer (+ blocks) | SUPPORT (native CIRCLE 10/20/30/40; optional fields) |
| MlightCAD adapter | SUPPORT (`AcDbCircle`) |
| annotation anchors | SUPPORT (center anchor for DIMRADIUS/DIMDIAMETER; start/end refused) |
| trim / extend / fillet | REFUSAL (existing line/polyline/arc whitelists; circles never match) |
| reverse / compound / offset curve sessions | REFUSAL (arc-only starters; no circle path exists) |
| parcel / feature-line conversion | REFUSAL (default null/skip arms) |
| curve tables / reports | REFUSAL (no circle rows; truthful deferral) |
| LandXML / general CAD import | N-A (globally absent; default skip stands) |
| annotation-only switches / survey tables | GENERIC (unreachable for circles) |
| block non-uniform scale | REFUSAL (`CAD_BLOCK_CIRCLE_NON_UNIFORM_SCALE`, never mean-scale) |
| general affine transform | REFUSAL (`CAD_TRANSFORM_CIRCLE_AFFINE_UNSUPPORTED`, never ellipse) |

No silent arc treatment anywhere: every site supports truthfully, needs no
change, or refuses deterministically.
