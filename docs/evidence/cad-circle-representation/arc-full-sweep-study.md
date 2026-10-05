# B1/B2/B3 full-sweep encodings — study

Three ways to encode one circle (center `(100,200)`, r=`50`) as an existing
`CadArcEntity`, run through the CURRENT kernels unchanged
(`scripts/cadCircleStudySweep.ts`, pinned by
`tests/cad_circle_study_sweep_b1b2b3.test.ts` 10/10). All values are 6 dp.

| encoding | start/end | signed sweep | start point | end point | arc midpoint |
|---|---|---|---|---|---|
| B1 | 0 / 360 | 360 | (150,200) | (150,200) | (50,200) |
| B2 | 30 / 390 | 360 | (143.30127,225) | (143.30127,225) | (56.69873,175) |
| B3 | 30 / 30 | 0 | (143.30127,225) | (143.30127,225) | (143.30127,225) |

## 1. What works identically for all three through the kernels

- Intersections are sweep-independent because they operate on the whole circle
  and filter with `cadIsAngleOnArcSweep`; for B1/B2 that predicate is all-true,
  for B3 it is the zero-sweep all-true rule — so all three return the same
  `segment=2, line=2, circle-circle secant=2/tangent=1/disjoint=0/concentric=0`,
  `tangents 2 outside / 1 on / 0 inside`.
- `arcLength = 314.159265` (2πr) for B1/B2, `0` for B3; `chordLength = 0` for
  all three.
- Transforms: translate/rotate90/mirror/uniformScale2 all apply
  (`sweepDeg` stays 360 for B1/B2, 0 for B3); non-uniform is refused with
  `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` **on the direct-entity path** (the
  block route mean-scales instead — see §4).
- Endpoints-only bounds (`endpointsOnlyBounds`) and center±radius bounds
  (`centerRadiusBounds`) agree for **all three** (`boundsAgree=true`); the
  endpoints-only path samples all four quadrants because the predicate admits
  every angle.

The equality of the two bounds paths for all three is exactly why the two
bounds paths are not, by themselves, a discriminator.

## 2. B3's bounds surprise (why B3 is not viable)

`cadIsAngleOnArcSweep` returns `true` whenever `|sweep| ≤ 1e-9`
(`cadGeometryArcPrimitives.ts:37`). B3 has sweep 0, so a **zero-length arc
(the point `(143.30127,225)`) claims the full box**
`{minX:50,minY:150,maxX:150,maxY:250}` on the endpoints-only path — identical
to B1's correct full-circle box. A degenerate point therefore reports a
full-circle extent. The study pins this (`boundsAgree=true` for B3 is the
surprise, not a success).

It compounds with cross-consumer disagreement:

- `SurveyCadPreview.geometry.ts:242-249`: B3 sweep 0 takes the normal branch →
  `largeArcFlag 0, start==end` → empty/degenerate SVG path.
- `cadExportScene.ts:149`: `Math.abs(signedSweep) < 1e-9 ? 360 : signedSweep`
  → B3 is tessellated as a **full circle** on sheets/exports.
- `cadPdfExport.ts:110`: `while (sweep <= 0) sweep += 360` → same full-circle
  treatment.
- `cadBuildArcFromCenterSweep` (`cadGeometryCurveCore.ts:105`) rejects
  `|sweep| ≤ 1e-9` and `|sweep| ≥ 360−1e-9` → neither B3 nor B1 can be built
  through that helper.

SVG says nothing, sheet/PDF say full circle, bounds say full box, the builder
says invalid: B3 is ambiguous across consumers. **B3 is rejected.**

## 3. B2's DXF ambiguity (why B2 is not the encoding)

B2 sweeps 360 but carries `start=30,end=390`. `dxfExportModel.ts:452-460`
pushes both angles verbatim and `dxfSerializer.ts:152` writes groups 50/51
verbatim, so the file contains `endDeg=390`. The study records this as
passes-through-unwritten-normalized; the **emitted bytes** are now executed
(`runDxfArcB1`: B1 emits ARC `50=0`/`51=360` with no `CIRCLE` entity), but the
**host import** normalization remains UNEXECUTED. An un-normalized DXF ARC
angle is not a guaranteed interchange form and is not verified by this study.
**B2 is rejected as the exact encoding.**

## 4. B1 (0/360): cleanest **direct** encoding, not unambiguous everywhere

For a **direct** B1 entity:

- sweep is exactly 360 and start==end, so the circle geometry is unambiguous
  in the persisted `{cx,cy,r,0,360}` form;
- on-sweep is all-true (correct for a full ring);
- both bounds paths give the correct full box;
- SVG takes the `|sweep|≈360` branch — **executed**: `arcPath` B1/B2 yield two
  180° `A` segments, B3 a degenerate single arc, so the "SVG collapse" is
  already handled and is not a defect;
- DXF emits 0/360, the conventional full-circle ARC form — **executed bytes**:
  ARC `50=0`/`51=360`, no `CIRCLE`;
- the parcel/feature-line guards (`SWEEP_NEAR_FULL_CIRCLE`) do not affect the
  model arc entity, only a future conversion into a course ring.

The **unresolved parts** are not just snap/handle semantics:

1. **Block expansion (measured).** `expandBlockReference` on the 0/360 child
   returns 0/0 (`cadNormalizeAngleDeg(360)=0`); a 30° insert returns 30/30.
   So a B1 arc is not unambiguous once placed in a block — the sweep is lost
   and the child then behaves like B3.
2. **Non-uniform block scale (measured).** `scaleX=2, scaleY=1` silently
   mean-scales radius 50→75; the entity-route affine refusal
   (`CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED`) does not cover the block route
   (`refusalCoversBlockRoute=false`).
3. **Snap/handle semantics.** A B1 arc exposes two coincident `endpoint`
   candidates (1 observable after dedupe) plus an observable `arc-midpoint`
   and two coincident `arc-start`/`arc-end` grips (3 grips emitted, 2 leaked,
   no grip dedupe). Suppressing circle-meaningless kinds for every full-sweep
   arc means touching the snap subsystem (entity candidates, block snaps,
   spatial index, grips, annotation anchoring, display labels) and confirming
   endpoint-based commands (trim/extend/fillet/reverse/offset) on a
   `start==end` arc — the suppression changes and command confirmations
   were not executed (snap/grip emission itself was executed; see §3).

## 5. Verdict on encodings

- **B3 — rejected**: zero-sweep all-true predicate, full box for a point,
  cross-consumer disagreement (SVG empty vs sheet/PDF full circle).
- **B2 — rejected**: un-normalized 390 in DXF.
- **B1 — direct geometry viable, not unambiguous everywhere**: block
  expansion loses the sweep (0/360→0/0) and non-uniform block scale
  mean-scales silently, so it needs both a full-sweep snap/handle contract and
  a block-route contract; DXF correctness of the emitted 0/360 still rests on
  an unexecuted host normalization. See `decision.md`.
