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

## 3. Contamination surface (what A must touch)

Adding `circle` to `CadEntity` makes every exhaustive entity switch either
handle it or explicitly refuse it. Verified surface (**untested inventory**):
**26 `switch (entity.type)` sites** (21 files), **33 files with `case 'arc'`**
(27 under `src/engine/cad`). Downstream, engine-scope greps name: fillet
**11**, trim **72**, reverse **29**, offset **93** files. Named consumer
families the mission lists: trim, fillet, reverse, offset, parcel, tables, DXF,
spatial, properties. Each would need either a correct circle arm or a
fail-closed refusal; **none was implemented or tested by this study, so these
counts are an inventory, not a list of defects**.

Schema/persistence is a second surface: `cadPersistence.ts`,
`cadMlightcadAdapter.ts`, `landxmlCadProject.ts` and `dxf/dxfExportModel.ts`
all switch on `entity.type` and would need a circle arm, plus a persistence
round-trip and revision/undo/clipboard treatment. No `model.circles` exists
today (`dxfExportModel.ts:99`), so a model-space DXF `CIRCLE` emitter and its
re-import would be new.

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

## 5. What A does **not** have evidence for

- no production entity kind, union arm, or persistence schema;
- no per-site contract for the 26 switches (arm vs refusal) or the
  trim/fillet/reverse/offset/parcel/table paths;
- no model-space DXF `CIRCLE` emitter or import round-trip;
- no block-expansion arm (a `circle` child in a block) or block-scale
  contract; the B1 block route was measured to collapse `0/360`→`0/0` and to
  mean-scale non-uniform scales, and A shares that block path;
- no equivalence/canonicalization rule against a legacy 0/360 arc;
- no revision/undo/clipboard/parity behavior.

The [{cx,cy,r} adapter match](#1-adapter-control-study-side-cxcyr) proves the
geometry is trivial; it does not prove the identity/consumer/schema delta is
complete. That delta is large, enumerable in principle, but unspecified by
this study — the basis for the policy verdict in `decision.md`.
