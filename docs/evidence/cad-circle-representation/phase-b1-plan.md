# B1 plan — first-class Circle implementation (Center/Radius + Center/Diameter)

Status: **AUTHORIZED** by `decision.md` = `GO_FIRST_CLASS_CAD_CIRCLE_ENTITY`
(study phase changes no `src/`; Circle stays disabled until this plan
lands). Persisted law: `{type:'circle', centerX, centerY, radius}`, finite
center, radius above the CAD geometric floor, no sweep fields, no
arc conversion. Deferred: 2-Point/3-Point, TTR/TTT, TRIM/EXTEND/FILLET/
REVERSE/OFFSET on circles (explicit refusals), parcel/feature conversion,
curve tables, DXF import (global gap).

## 1. Representation / type / persistence

- `cadTypes.ts`: `CadCircleEntity` + `CadEntity` + `CadBlockChild` arms.
- `cadPersistence.ts`: clone/sanitize arms; no version bump (additive v2),
  no migration.
- `cadMlightcadAdapter.ts`: extend spike union + `AcDbCircle` arm.
- `landxmlCadProject.ts`: default-skip stands (no change).
- Tests: round-trip old files unchanged + circle save/reopen exact.

## 2. Bounded consumer arms / refusals

- Per `circle-entity-study.md` §6 table (32 sites): SUPPORT arms
  (bounds, names, clipboard, block sources/persist/preview/selection,
  feature default-null untouched); GENERIC untouched (annotation-only
  switches, LandXML default); REFUSAL codes for trim/extend/fillet/
  reverse/offset/parcel/feature/tables.
- Block contract: nesting allowed; non-uniform block scale fails closed.
- `translateEntity` + `cadTransformGeometry.ts`: similarity arm; affine
  refusal inherited.

## 3. Render / spatial / snaps / grips / properties / dimensions

- `cadRenderer.ts`: circle primitive; `cadSpatialBounds.ts` center±r;
  `cadSpatialEntityCandidates.ts`: center/quadrant/nearest/tangent/perp/
  intersection (never endpoint/midpoint); `cadSpatialIndex.ts` arm.
- Grips: `circle-center` + `circle-radius` at (cx+r, cy).
- Properties: centerX/Y, radius, diameter, circumference, area.
- `DIMRADIUS`/`DIMDIAMETER` via center + rim-point anchor.

## 4. Native DXF CIRCLE

- `dxfExportModel.ts`: `model.circles`; serializer CIRCLE groups
  10/20/30/40 reusing the paper writer; focused serializer/export tests.
  No polygon approximation, no ARC fallback, no import work.

## 5. Center/Radius + Center/Diameter transactions / sessions / ribbon

- `cadGeometryShapeBuilders.ts`: `buildCircleCenterRadius/Diameter` pure
  helpers. Center/Radius: center fixed, radius scalar. Center/Diameter:
  center fixed exactly as supplied, diameter scalar (or picked distance
  from the center), radius = diameter/2 — the second point is a
  diameter-magnitude point, NOT the opposite endpoint (that is the
  distinct deferred 2-Point mode). Degeneracies: `r<=0`/zero-diameter,
  coincident, non-finite → null, reusing the existing CAD geometric floor.
- `cadTransactionsShapeCommands.ts`: `CIRCLE`/`CIRCLECD` on current layer,
  ByLayer, one undo entry; registry + starters + 4-file session seams
  (mirror the Shapes V1 wiring); ribbon rows un-planned with truthful
  hints, text face.

## 6. Tests / browser QA

- Unit: builders, transactions, per-switch arms, DXF bytes, revision,
  clipboard, transform classes, snap suppression (no endpoint/midpoint).
- Browser: Center/Radius + Center/Diameter flows, grips, save/reopen,
  refusal paths, 0 page/console errors + PNGs.

## 7. Adversarial review

- Re-run the B0 attack list against the implementation (fake endpoints,
  360 normalization, block sweep/scale, DXF equivalence, non-uniform
  transforms, snap leakage, migration understatement, switch undercount).
- Keep Circle disabled until review passes.
