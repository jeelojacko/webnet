# Phase 18L — LandXML 1.2 schema audit (evidence, not memory)

Sources: authoritative XSD `http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd`
(225,951 B, posted 7/29/2008), official generated element docs
(`.../documentation/LandXML-1.2Doc_<Element>.html`), official Autodesk samples
(`.../Samples/Autodesk/`). Note: `https://` for landxml.org is broken (TLS
reset); plain `http://` serves — repo `xsi:schemaLocation` already uses it.

Repo status at baseline: NO standalone LandXML fixtures (all inline strings in
`tests/landxml_export*.test.ts`, `tests/landxml_interchange.test.ts`); NO code
reads/writes Surfaces, ProfSurf, CrossSects, or StaEquation.

## Surfaces: Surface / Definition / Pnts / P / Faces / F

- `Surface` attrs: `name` (required), `desc`, `OID`, `state`; children
  `SourceData | Definition | Watersheds | Feature`.
- `Definition` attrs: **`surfType` (required: TIN/grid)**, `area2DSurf`,
  `area3DSurf`, `elevMax`, `elevMin`; children `Pnts` (required) + `Faces`
  (min 1) + `Feature*`.
- `Pnts`: sequence of `P`, minOccurs 3. `P/@id` unique per surface.
- `P`: text = **"northing easting elevation"**; `id` = `xs:positiveInteger`
  **required** (arbitrary values — official sample starts at `id="2"`).
- `F`: content = integer list (3 vertices TIN, 4 grid) referencing `P/@id`.
  Optional: `i="1"` (invisible but triangulated), `n` (adjacent face index
  per edge, **positional 1..n, 0 = no neighbor**), `b` (breakline-edge
  bitmask 1/2/4 = side1/2/3).

## Alignments: Alignment / CoordGeom / Line / Curve / Spiral / StaEquation

- `Alignment` attrs: **`name`, `length`, `staStart` all required**; children
  `Start?`, `CoordGeom`, `StaEquation*`, `Profile*`, `CrossSects?`, ...
- `Line`: children `Start`, `End`; attrs `dir`, `length`, `staStart`, ...
- `Curve`: children `Start`, `Center`, `End` (+`PI?`); attr **`rot`
  ∈ {`cw`,`ccw`} required** = travel direction **from Start to End**.
  `radius` optional (else Start→Center distance).
- `Spiral`: children Start/PI/End; attrs `length`, `radiusStart`,
  `radiusEnd`, `rot`, `spiType` all required (`INF` = infinite radius).
- `StaEquation`: **`staAhead` (required) = new station value**,
  **`staInternal` (required) = equation location** (staStart + dist, no
  equations applied), `staBack` optional, `staIncrement` ∈
  {increasing,decreasing} optional.

## Profile: ProfSurf / PntList2D

- `Profile` children `ProfSurf*` / `ProfAlign*`.
- `ProfSurf`: `name` required; children **`PntList2D` (min 1)**.
- `PntList2D` = sequential **station/elevation** pairs (min 2 points).
  Station = distance along alignment in file linear units. **Gaps =
  multiple `PntList2D` elements** (lossless gap encoding available).

## CrossSects: CrossSect / CrossSectSurf / PntList2D

- `CrossSect`: **`sta` (`xs:double`, required)** + `name`, `angleSkew`,
  cut/fill areas/volumes; unique `uCrossSectSta`.
- `CrossSectSurf`: `name` required; children **`PntList2D` (min 1)** =
  **offset/elevation from centerline**.
- **Offset sign: positive = RIGHT, negative = LEFT** (`offsetDistance`:
  "a positive value indicates an offset to the RIGHT"). Official sample
  runs `-60.00 … +59.99`. WebNet uses left-positive → export MUST negate.

## Units / CoordinateSystem / root

- `Units`: exactly one of `Metric | Imperial`; required `areaUnit`,
  `linearUnit`, `volumeUnit`, `temperatureUnit`, `pressureUnit`; `angularUnit`
  / `directionUnit` default **radians**; `foot` ≠ `USSurveyFoot` (distinct).
- Angles CCW from east=0; directions CCW from north=0.
- `CoordinateSystem`: attrs `name`, `desc`, **`epsgCode`** (string),
  `ogcWktCode`, datum/ellipsoid names; children `Start?`, `FieldNote*`,
  `Feature*`, `<any>`.
- Root `LandXML`: `date`, `time`, `version` required; `version` is
  `xs:string` ("1.2" convention, not schema-enforced).

## Decided conventions for 18L implementation

| Question | Answer |
|---|---|
| Coordinate order | Northing Easting [Elevation] everywhere (P, CgPoint, Start/End) |
| Face refs | 1-based `P/@id` values (arbitrary, non-contiguous allowed); resolve via id→index map |
| Curve rotation | `rot` cw/ccw, Start→End; WebNet arc direction derived from endpoint geometry + rot |
| Station equations | `staInternal` → rawStation, `staAhead` → aheadStation, `staBack` → backStation |
| Profile stations | Raw chainage (internal, equations at alignment level); gaps via multiple PntList2D |
| Section offsets | Negate WebNet left-positive to LandXML right-positive; `sta` in file linear units |
| GRID / Spiral / design profile | Explicit UNSUPPORTED dispositions, no approximation |
| Roadways / PipeNetworks / Volume | Counted as UNSUPPORTED (`roadwaysUnsupported` / `pipeNetworksUnsupported` / `volumesUnsupported` + warnings), never imported — no models |

## NOT_VERIFIED (inference only, must not be depended on)

- `staBack` precise semantics (no XSD annotation; "previous value" inferred).
- `staIncrement` composition with staAhead/staBack (no worked example).
- Face winding/normal orientation (schema silent).
- `P/@id` starting at 1 (only positiveInteger enforced).
- `CrossSect/@sta` units (bare double; assumed file linearUnit).
- ProfSurf/StaEquation have ZERO official-sample coverage (3 Autodesk
  samples contain none) — implementation pins via hand-crafted
  schema-derived fixtures instead.
