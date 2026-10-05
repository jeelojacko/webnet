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
| A (circle) | new native emitter `model.circles` → DXF `CIRCLE` groups 10/20/30/40 (specified; reuses paper-writer group layout) | general model-space CAD import is globally absent (dxf/ is export-only), so no private re-import path is required for authorization — NOT_APPLICABLE, not a blocker |

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

**Block route (measured for arcs, motivates the A contract).**
`expandBlockReference` on a 0/360 arc child returns 0/0; with
`scaleX=2, scaleY=1` it mean-scales radius 50→75 (`applied=true`,
`refused=false`) while the entity route refuses affine
(`refusalCoversBlockRoute=false`).

**Block contract (settled for A).** First-class circle removes sweep
identity loss, but block transforms need policy: a circle MAY nest as a
block child (`CadBlockChild` arm); uniform scale / rotation / mirror /
translation are supported; a block reference containing a circle with
non-uniform `scaleX != scaleY` fails closed for that block/child (exact
classifier authority) rather than mean-scaling; circles are NEVER silently
converted to ellipses in B1. The `expandBlockReference` 0/360→0/0 collapse
and mean-scale behavior measured for arcs do not apply to a circle kind
(no sweep to normalize, no radius averaging — refusal instead).

## 4. Persistence (resolved)

1. Additive inside version 2: a new discriminated `type:'circle'` kind
   rides the existing version-2 project/drawing envelope; old v1/v2 files
   contain no circle and read unchanged (sanitize fail-closed on bad refs
   is untouched).
2. Validators enumerate kinds and get explicit arms: `cadPersistence.ts`
   clone/sanitize, `cadMlightcadAdapter.ts` (extend spike union +
   `AcDbCircle` arm; insertion-marker fallback exists as precedent),
   `landxmlCadProject.ts` (default-skip stands), `dxfExportModel.ts`
   (`model.circles`).
3. No WNCAD/drawing-file outer version bump: the format is additive and
   the current writer is already version 2.
4. Older binaries opening circle-bearing files: current compatibility
   policy promises forward migration only (`migrateV1ToV2`) plus fail-closed
   sanitize — no backward-reader compatibility is promised, so no
   migration requirement is invented here.
5. No legacy canonicalization: a repo-wide search finds no intentional
   0/360 drafting circle in any production fixture, example, or corpus
   file (only test synthetics: renderer-label, block transform/persist
   fixtures — which stay arcs). No automatic reinterpretation.

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
`5cbb97b06606e8f5c1a91c5a4b7551afaf10b8f8a132034a13e6c35eed22806f`
(`sha256sum -c corpus.json.sha256` → OK). No production file was touched, so
production determinism/parity is unchanged by this phase.

## 6. Conclusion

- B1: no schema delta and the render path is proven, but its DXF correctness
  rests on an unexecuted host normalization, block expansion collapses
  `0/360`→`0/0`, and non-uniform block scale silently mean-scales. It has no
  persisted circle identity.
- A: a clean direct identity with a specified native DXF `CIRCLE` emitter
  (`model.circles`, groups 10/20/30/40); general DXF import is globally
  absent and NOT_APPLICABLE (no private Circle import); block contract
  settled (nest allowed, non-uniform fails closed). It has no persisted
  circle identity yet — that is the B1 implementation, not a study gap.
- Both share the direct-entity affine refusal and similarity closure; no new
  geometry.
