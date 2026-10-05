# First-class CAD circle entity — study

Candidate A (`GO_FIRST_CLASS_CAD_CIRCLE_ENTITY`): a persisted
`{type:'circle', centerX, centerY, radius}` entity, distinct from `arc`.
This study built a study-side adapter `{cx,cy,r}`
(`scripts/cadCircleStudyAdapter.ts`) and measured what a first-class kind
would inherit and what it would cost. The adapter is **never persisted, never
imported by `src/`** — production has no circle kind today.

## 1. Adapter control (study-side `{cx,cy,r}`)

Delegates every curved operation to existing kernels, so it is
sweep-independent by construction. Pinned values (6 dp):

| operation | result |
|---|---|
| `pointAt(0)` / `pointAt(90)` | (150,200) / (100,250) |
| `angleOf(east rim)` | 0 |
| `closestTo(outside 190,200)` | (150,200) |
| `closestTo(center 100,200)` | (150,200) (documented +x-rim choice) |
| tangents outside / inside | 2 / 0 |
| segment / infinite-line hits | 2 / 2 |
| circle-circle secant / concentric | 2 / 0 |
| circumference / area | 314.159265 / 7853.981634 |

These match the B1 outputs exactly, confirming the geometry math a circle
kind would need already exists and is correct. A circle entity adds **no new
geometry** — only identity and consumer wiring.

## 2. Why a distinct kind is semantically attractive

A circle has no start, end, midpoint, or sweep. The degenerate start==end
field of a full-sweep arc is the root of the B1 gaps:

- `buildArcEntitySnapCandidates` emits two coincident `endpoint` candidates
  and an arbitrary `arc-midpoint` (`cadSpatialEntityCandidates.ts:317-354`);
- grips emit two coincident `arc-start`/`arc-end`
  (`cadTransactionsEntityTransforms.ts:365-374`);
- block arc refs and the spatial index repeat endpoint/arc-midpoint
  (`cadSpatialBlockSnaps.ts:109-123`, `cadSpatialIndex.ts:340,663`);
- the SVG full-circle path is a special two-180°-arc branch
  (`SurveyCadPreview.geometry.ts:242-249`) that exists only because the
  primitive is an arc.

A `circle` kind removes the degenerate fields instead of patching every
consumer that reads them. Its natural snap set is `center`, `quadrant`
(already EXISTS), `nearest`, `tangent`, `perpendicular`, `intersection` — and
`endpoint`/`midpoint`/`arc-midpoint` are never emitted, satisfying the
invariant by construction.

## 3. Contamination surface → per-site contract (specified)

All 32 dispatch sites (`switch (entity.type|child.type)`: 26 + 6) classified.
Contract: SUPPORT = add circle arm; GENERIC = kind-agnostic, no change;
REFUSAL = deterministic fail-closed code; N-A = unreachable for circles.

| site | arc behavior today | circle contract | delta |
|---|---|---|---|
| `cadTypes.ts` union + `CadBlockChild` | no circle kind | SUPPORT: add `CadCircleEntity{cx,cy,r}` to both (nesting allowed) | type-only |
| `cadPersistence.ts:137` clone/sanitize | per-kind clone | SUPPORT: verbatim clone arm | ~10 lines |
| `cadProjectState.ts:95` bounds | endpoints-only arm | SUPPORT: center±r arm | 3 lines |
| `cadRenderer.ts:1323` | arc primitive | SUPPORT: emit circle primitive (or two-arc path) | small |
| `cadSpatialBounds.ts:205` | arc bounds | SUPPORT: center±r | small |
| `cadSpatialEntityCandidates.ts:449` | arc candidates | SUPPORT: center/quadrant/nearest/tangent/perp/intersection; never endpoint/midpoint | bounded |
| `cadTransactionsClipboardCommands.ts:64` | per-kind copy | SUPPORT: round-trip + layer remap (default-breaks silently today) | small |
| `cadTransactionsEntityTransforms.ts:25,239,316` | translate/grip-edit/grips | SUPPORT: center shift, center+radius grips, per-vertex n/a | small |
| `cadTransformGeometry.ts:110` | affine refused for curved | SUPPORT: similarity arm; affine refusal inherited unchanged | small |
| `cadProperties.ts:414` | arc rows | SUPPORT: centerX/Y, radius, diameter, circumference, area rows | small |
| `cadEntityNames.ts:59,74` | display labels | SUPPORT: `'Circle'` label | trivial |
| `dxfExportModel.ts:270` + `dxfSerializer.ts` | ARC emitter | SUPPORT: `model.circles` + native CIRCLE groups 10/20/30/40 | bounded |
| `dxfBlockExport.ts:133` | child emitter | SUPPORT: child CIRCLE arm | small |
| `cadMlightcadAdapter.ts:4` | AcDb* arms | SUPPORT: extend spike union + `AcDbCircle` arm (insertion-marker fallback exists as precedent) | small |
| `cadBlockSources.ts:26,71` | eligibility/anchors | SUPPORT: circle eligible + center anchor | small |
| `cadBlocks.ts:170,274` | expand/points | SUPPORT: preserve identity; non-uniform scale fails closed | small |
| `cadSpatialBlockSnaps.ts:64` | child snaps | SUPPORT: circle candidates in blocks | small |
| `cadBlockPersistence.ts:27` | child persist | SUPPORT: circle child arm | small |
| `cadBlockPreview.tsx:35`, `cadBlockSelectionGeometry.ts:29` | child geometry | SUPPORT: rim-sampled points/segments | small |
| anchor `cadAnnotationAnchorFromCommandPoint.ts:103` | arc anchors | SUPPORT: center + rim-point anchor; arc-start/end refused for circles | small |
| `cadAnnotationPersistence.ts:530`, `dxfAnnotationExport.ts:404`, annotation snapshot/copy, `dxfBlockExport` labels | annotation-only switches | GENERIC: circle never reaches them (CadAnnotationEntity kind) | none |
| `cadFeatureLineCreate.ts:136`, LandXML `convertEntities` | default null/skip | GENERIC: circle refused/skipped by existing defaults | none |
| `cadMlightcadAdapter` labels/tables precedent | insertion markers | GENERIC fallback pattern exists | none |
| trim/extend/fillet/reverse/offset command dispatch | endpoint-based | REFUSAL: deterministic codes (a TRIM that would arc-ify a circle is out of B1) | codes only |
| parcel/feature-line conversion, curve tables/reports | arc-only | REFUSAL: not convertible; explicit codes | codes only |
| LandXML/DWG import | globally absent | N-A: no general import path exists for any entity | none |

No silent arc treatment anywhere: every site either supports the circle
truthfully, needs no change, or refuses deterministically.

Schema/persistence is a second surface: `cadPersistence.ts`,
`cadMlightcadAdapter.ts`, `landxmlCadProject.ts` and `dxf/dxfExportModel.ts`
all switch on `entity.type` and would need a circle arm, plus a persistence
round-trip and revision/undo/clipboard treatment. No `model.circles` exists
today (`dxfExportModel.ts:99`), so a model-space DXF `CIRCLE` emitter is a
bounded B1 implementation delta; general DXF import is globally absent and
NOT_APPLICABLE, so no Circle-specific re-import is required.

## 4. What A inherits unchanged (proven)

- Intersections/tangency: the adapter delegates to
  `cadIntersectCircleCircle` / `cadTangentPointsFromExternalPointToCircle`
  and matches B1 — no new kernel.
- Bounds: center±radius is exact and single-valued; no endpoints-only
  ambiguity.
- Transforms: similarity-closed; general affine is already refused for
  curved entities (`cadTransformGeometry.ts:185-186`).
- Render: a circle maps to a trivial SVG `<circle>` or the existing two-arc
  path.

## 5. Specified (this correction pass)

- Persisted kind + union arms (`CadEntity`, `CadBlockChild`); no version
  bump (additive v2); no migration (no intentional 0/360 drafting circle in
  any production fixture, example, or corpus file — only test synthetics,
  which stay arcs).
- Per-site contract above (SUPPORT/GENERIC/REFUSAL/N-A); trim/extend/
  fillet/reverse/offset/parcel/feature/tables refuse deterministically.
- Native model-space DXF `CIRCLE` emitter (`model.circles`, groups
  10/20/30/40); general DXF import stays a global gap (N-A).
- Mlightcad: extend spike union + `AcDbCircle` arm.
- Block contract: nesting allowed; non-uniform block scale fails closed.
- Grips: center grip + one radius/quadrant grip at (cx+r, cy); no fake
  endpoints. Dimensions: DIMRADIUS/DIMDIAMETER via center + rim-point
  anchor; arc-start/end anchors refused for circles.

The adapter match proves the geometry is trivial; the table above proves
the identity/consumer/schema delta is bounded and explicit.
