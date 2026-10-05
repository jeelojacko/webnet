# CAD circle representation — B0 forensics (production authority inventory)

- Branch: `research/cad-circle-representation-decision`.
- Baseline: `50a5c720` (PR #170 Shapes v1 merge). Study/EVIDENCE ONLY — zero `src/` changes.
- Every count below was re-measured on this tree (see `validation.md` for the
  exact commands). `switch (entity.type)` = **26 sites**; files containing
  `case 'arc'` = **33** (candidate-consumer **inventories, untested — not
  failures**); study corpus sha256
  `1a2bb62759de10555a687bdb10632188dfd62f93bf1f6f964d34df814a393bce`. The
  executed pins are `scripts/cadCircleStudyExecution.ts` +
  `tests/cad_circle_study_execution.test.ts`.

## 1. No first-class circle kind exists

`CadEntity` (`src/engine/cad/cadTypes.ts:--`) unions 17 kinds; there is no
`circle`. Curved entities present: `CadArcEntity` (`type:'arc'`,
`centerX/centerY/radius/startAngleDeg/endAngleDeg`) and `CadErrorEllipseEntity`.
`grep -rn "model\.circles" src/` is empty.

## 2. The established reuse precedent: rectangle → polygon

Phase A implements RECTANGLE as a `CadPolygonEntity` with 4 vertices
(`src/engine/cad/cadTransactionsShapeCommands.ts:36`), **not** a new
`rectangle` kind. The project's demonstrated pattern for a new primitive is to
reuse an existing kind when the geometry is a special case. A circle-as-arc
(B1) follows that precedent; a new `circle` kind (A) does not, but a
rectangle's vertices are all meaningful whereas a full-sweep arc's
start/end are degenerate (see §5/§9).

## 3. `switch (entity.type)` surface (verified 26)

`switch (entity.type)` sites (21 files): `cadAnnotationAnchorFromCommandPoint`,
`cadAnnotationPersistence`, `cadBlockSources` (×2), `cadEntityNames` (×2),
`cadFeatureLineCreate`, `cadMlightcadAdapter`, `cadPersistence`,
`cadProjectState`, `cadProperties`, `cadRenderer`, `cadSpatialBounds`,
`cadTransactionsAnnotationCopyCommands`,
`cadTransactionsClipboardCommands`, `cadTransactionsEntityTransforms` (×3),
`cadTransformGeometry`, `dxf/dxfAnnotationExport`, `dxf/dxfExportModel`,
`landxmlCadProject`, `hooks/surveyCad/surveyCadAnnotationSnapshot` (×2).
Adding `child.type` switches gives **32 entity-kind dispatch sites** (26
`switch (entity.type)` + 6 `switch (child.type)`); `case 'arc'` appears in
**33 files** (27 under `src/engine/cad`).
Corpus-study downward greps (engine scope): fillet **11**, trim **72**,
reverse **29**, offset **93** files. These are **candidate-consumer
inventories**; each is classified SUPPORT/GENERIC/REFUSAL/N-A in
`circle-entity-study.md` §6 — not evidence of breakage.
Model-space CAD import is globally absent (the dxf/ directory holds export
modules only), so no import arm exists for any entity kind.
narrower per-file estimates (11/63/24/61) differ by pattern, not by
conclusion.

## 4. DXF: arcs ride verbatim, circles absent

- Model type `dxfExportModel.ts:99` has `arcs`, no `circles`.
- Entity path pushes `{center,radius,startDeg,endDeg}` verbatim
  (`dxfExportModel.ts:452-460`), including un-normalized 390.
- Serializer emits groups 50/51 verbatim (`dxf/dxfSerializer.ts:152`).
- The only `CIRCLE` emission is **paper-space layout items**
  (`dxf/dxfLayoutExport.ts:220`), not model entities. The corpus claim
  "model.circles ABSENT" is correct; the paper-space emitter is a separate
  path and does not round-trip model circles.

## 5. Full-sweep / zero-sweep behavior is inconsistent across consumers

`cadSignedSweepDeg` wraps into `[-360,360]` (`cadGeometry.ts:175-179`).
`cadIsAngleOnArcSweep` returns **true for any angle when |sweep| ≤ 1e-9**
(`cadGeometryArcPrimitives.ts:37`) — the zero-sweep all-true rule. Consequences:

| Consumer | 360 sweep (B1) | 0 sweep (B3) |
|---|---|---|
| on-sweep predicate | all angles true (correct) | all angles true (degenerate) |
| bounds (endpoints-only, `cadProjectState.ts:113`) | full box via sampled quadrants | full box for a **point** |
| bounds (center±r, `cadSpatialIndex.ts:160`) | full box | full box |
| SVG (`SurveyCadPreview.geometry.ts:242-249`) | two 180° arcs → full ring | empty/degenerate path |
| sheet/PDF tessellation (`cadExportScene.ts:149`, `cadPdfExport.ts:110`) | steps from 360 | **forced to 360** |
| `cadBuildArcFromCenterSweep` (`cadGeometryCurveCore.ts:105`) | **rejected** (≥360−1e-9) | **rejected** (≤1e-9) |
| parcel course (`cadParcelArcGeometry.ts:70,326-330`) | blocked `SWEEP_NEAR_FULL_CIRCLE` | line |
| feature-line course (`cadFeatureLines.ts:163`) | blocked | line |

B3 is therefore ambiguous: SVG/sheet disagree on whether zero means nothing or
a full circle. B2 worsens DXF (emits 390 un-normalized).

## 6. Transforms

`transformCadEntityGeometry` (`cadTransformGeometry.ts:185-186`) applies
translate/rotate/reflection/uniform-scale to arcs and refuses
`GENERAL_AFFINE` with `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED`. A circle is
similarity-closed, so both A and B share this direct-entity rule; a general
affine would turn it into an ellipse (unrepresentable in either candidate).

**Block route (executed).** `expandBlockReference` does not use the entity
transform: it applies mean scale and arc-angle arithmetic. On the B1 child it
normalizes `0/360`→`0/0` (`cadNormalizeAngleDeg(360)=0`; a 30° insert →
`30/30`), and with `scaleX=2,scaleY=1` it returns radius `75`
(`applied=true`, `refused=false`) while the entity route refuses
`CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` (`refusalCoversBlockRoute=false`). So a
B1 arc is not identity-preserving or similarity-closed through blocks.

## 7. Snap / handle surface

Snap kinds (`cadTypes.ts:976`): `point-node, endpoint, midpoint, center,
arc-midpoint, quadrant, intersection, apparent-intersection, extension,
perpendicular, parallel, direction, tangent, nearest`. `quadrant` EXISTS and is
reused by arcs. `buildArcEntitySnapCandidates`
(`cadSpatialEntityCandidates.ts:308-341`) emits for any arc: **two `endpoint`
candidates** (start/end), one `center`, one `arc-midpoint`, four `quadrant`
(predicate-gated), one `nearest`. For a B1 full-sweep arc start==end, so the
two endpoint candidates are **coincident duplicates** and `arc-midpoint` sits
at start+180° — an arbitrary rim point. Executed counts (`runSnapGripB1`):
entity emitted `endpoint:2` (1 observable after real dedupe) + `arc-midpoint:1`
(observable) + `center:1` + `quadrant:4` + `nearest:1`; block refs emitted
`endpoint:3` (2 observable); grips emitted 3 with **2 coincident
`arc-start`/`arc-end` leaked** (no grip dedupe). Grips emit `arc-start` and
`arc-end` (`cadTransactionsEntityTransforms.ts:365-374`). Block arc refs repeat
endpoint/arc-midpoint (`cadSpatialBlockSnaps.ts:107+`); the spatial index adds
arc-midpoint (`cadSpatialIndex.ts:340,663`). This is the load-bearing gap: the
mission invariant "endpoint/midpoint must never leak for circles" is violated
by every full-sweep arc today, even after snap dedupe.

## 8. Construction modes (study)

Center/Radius and Center/Diameter are single-solution closed forms
(`scripts/cadCircleStudyModes.ts`); 2-Point folds to diameter; 3-Point adds one
collinear guard; TTR/TTT are multi-solution Apollonius/Tangent problems with
no persisted tangent-line/offset-curve infrastructure → DEFER. Recommended B1
slice: **Center/Radius + Center/Diameter**.

## 9. Summary

- Only curved kind is `arc`; no `circle`; no `model.circles`.
- Reuse precedent favours B1, but B1 leaks circle-meaningless snap/handle
  kinds at a cross-cutting surface and DXF host normalization is unverified.
- Block expansion is a further executed gap: `0/360`→`0/0` (identity/sweep
  lost, G1–G3) and non-uniform scale mean-scaled `50`→`75` without refusal
  (G6); the entity-route affine refusal does not cover blocks.
- A first-class kind is semantically clean; its per-site contract (arms,
  refusals, DXF emitter, additive schema, block policy) is now specified in
  `circle-entity-study.md` §5–§6 and `dxf-transform-persistence.md` §4–§5 —
  see `decision.md` (GO).
- B3 is provably ambiguous; B2 emits un-normalized DXF.
