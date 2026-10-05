# DXF, transform, and persistence semantics — study

## 1. DXF model and emitter

- `dxfExportModel.ts:99` defines `model.arcs`; there is **no `model.circles`**.
- The model `arc` entity is pushed verbatim (`dxfExportModel.ts:452-460`):
  `startDeg: entity.startAngleDeg, endDeg: entity.endAngleDeg`.
- The serializer writes DXF groups `50`/`51` verbatim
  (`dxf/dxfSerializer.ts:152`).
- A `CIRCLE` group-0 emitter exists only for **paper-space layout items**
  (`dxf/dxfLayoutExport.ts:220`, groups `10/20/30/40`), not model entities.

Executed B1 bytes (`runDxfArcB1`, pinned by
`tests/cad_circle_study_execution.test.ts`): `modelArcs =
[{startDeg:0,endDeg:360,radius:50}]`, serialized groups `{40:'50', 50:'0',
51:'360'}`, `hasCircleEntity=false`. The study does **not** execute an
external DXF import, so no emitted form is round-trip verified (host
normalization stays UNEXECUTED).

Consequences by encoding:

| encoding | emitted ARC | concern |
|---|---|---|
| B1 (0/360) | `50=0`, `51=360` | conventional full-circle ARC; depends on the host normalizing 0→360 (prediction, not executed here) |
| B2 (30/390) | `50=30`, `51=390` | **un-normalized** angle in the file |
| B3 (30/30) | `50=30`, `51=30` | zero-length ARC, not a circle |
| A (circle) | no model emitter exists | would need a new DXF `CIRCLE` (groups 10/20/40) emitter and re-import |

The study does not execute an external DXF import, so no emitted form is
round-trip verified.

## 2. Render / SVG

`arcPathFromPrimitive` (`SurveyCadPreview.geometry.ts:236-250`): when
`|signedSweep| ≈ 360` (`|{|sweep|}|−360| ≤ 1e-6`) it emits two 180° `A`
segments from the +x rim back to itself — the "SVG collapse" is already
implemented and correctly renders a full ring for B1/B2. Any other sweep
takes the single-arc branch; B3 (sweep 0, start==end) yields an empty
degenerate path. Sheet/PDF tessellation takes a different branch and forces
zero sweep to a full circle (`cadExportScene.ts:149`, `cadPdfExport.ts:110`),
so B3 renders as nothing in the viewport but as a full circle on sheets.

A first-class circle would render through the same two-arc branch (or a
native circle element); no new rendering behavior is required.

## 3. Transforms

`transformCadEntityGeometry` + `classifyTransform`
(`cadTransformGeometry.ts`, `cadTransform2D.ts`) classify a transform as
`RIGID_ORIENTATION_PRESERVING | RIGID_REFLECTION | SIMILARITY |
GENERAL_AFFINE` (`cadTransform2D.ts:23`). Observed on a circle-per-encoding
(study corpus):

| transform | B1 result |
|---|---|
| translate (10,−7) | center (110,193), r 50, sweep 360 |
| rotate 90° about center | center (100,200), start 90, end 450, sweep 360 |
| mirror x→−x | center (−100,200), start 180, end −180, sweep −360 |
| uniform scale ×2 | r 100, sweep 360 |
| non-uniform `{a:2,d:1}` | **refused** `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` |

All three encodings share this because the transform acts on
center/radius/angles. The affine refusal (`cadTransformGeometry.ts:185-186`)
is correct for a direct entity in both candidates: a general affine would map
a circle to an ellipse, which neither A nor B can persist. A circle is
similarity-closed, so A needs no new direct transform logic beyond an entity
arm.

**Block route (measured, `runBlockNonUniformScale`).** The entity-route
refusal does **not** cover block expansion: `expandBlockReference` with
`scaleX=2, scaleY=1` returns radius `75` (mean scale), `applied=true`,
`refused=false`, while the entity route returns
`reason=CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` and
`refusalCoversBlockRoute=false`. The exact requirement is fail-closed or
convert on the block route (an ellipse is not persistable in A or B1), so the
transform contract is **not** blanket PASS.

## 4. Persistence

No persisted circle identity exists. `cadPersistence.ts`,
`cadMlightcadAdapter.ts`, `landxmlCadProject.ts`, `cadTransformApply.ts`,
`cadBlockSources.ts`, `cadBlocks.ts`, `cadBlockPersistence.ts` and
`dxfExportModel.ts` each contain a `switch (entity.type)`/`switch (child.type)`
that would need a `circle` arm for candidate A. For candidate B1 the persisted
form is the existing `CadArcEntity` with `startAngleDeg=0`,
`endAngleDeg=360` — **no schema change** and no new persistence arm.

Block persistence/expansion is a second identity path: `expandBlockReference`
normalizes the `0/360` child to `0/0` (measured), so the persisted arc identity
is not preserved through blocks; the same helper mean-scales a non-uniform
block scale instead of refusing it.

Candidate A therefore carries a persistence/schema delta (new kind, round-trip
test, revision/undo/clipboard/block-nesting treatment) that this study did not
specify; candidate B1 carries no schema delta but also has no distinct circle
identity, so any consumer that must distinguish a circle from an arc has to
re-derive it from `|sweep| ≈ 360`.

## 5. Determinism

The study corpus is a pure function of fixed inputs: `buildCorpus` sorts keys
and rounds to 6 dp, no timestamps; `regenCorpus` writes JSON + sha256. The
committed corpus verifies to
`e7bde6fa4ea4ff7aae00ef75fcf9562d60dc3ca4ad6ee2f0076f606460b1c1d9`
(`sha256sum -c corpus.json.sha256` → OK). No production file was touched, so
production determinism/parity is unchanged by this phase.

## 6. Conclusion

- B1: no schema delta and the render path is proven, but its DXF correctness
  rests on an unexecuted host normalization, block expansion collapses
  `0/360`→`0/0`, and non-uniform block scale silently mean-scales. It has no
  persisted circle identity.
- A: a clean direct identity, but a new DXF `CIRCLE` emitter/re-import and a
  new persisted kind are required and unspecific in this study; the block
  route is unstudied and shares the non-uniform-scale gap.
- Both share the direct-entity affine refusal and similarity closure; no new
  geometry.
