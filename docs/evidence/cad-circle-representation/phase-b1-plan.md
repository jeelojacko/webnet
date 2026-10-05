# B1 plan — Circle construction slice (Center/Radius + Center/Diameter)

Status: **BLOCKED on the representation policy** (`decision.md` =
`POLICY_REQUIRED_CIRCLE_REPRESENTATION`). B1 cannot start until one persisted
identity (A or B1) and its snap/consumer contract are decided. `Circle` stays
disabled.

## 1. Settled B1 scope

- Modes: **Center/Radius** (pick center, pick radius point) and
  **Center/Diameter** (pick two diameter endpoints). Both are
  single-solution closed forms reusing `cadPointOnCircle` / `cadDistance`.
- Deferred past B1: 2-Point (folds to Center/Diameter), 3-Point (one
  collinear guard), TTR/TTT (multi-solution Apollonius infrastructure absent).
- Out of scope: ellipse, hatch, best-fit, global infra, schema migration
  beyond what the chosen identity requires.

## 2. Files for the construction slice (policy-independent)

Mirrors the landed RECTANGLE/POLYGON Shapes V1 wiring.

- `src/engine/cad/cadGeometryShapeBuilders.ts` — add
  `buildCircleCenterRadius(...)` / `buildCircleCenterDiameter(...)` pure
  helpers returning `{center, radius}` (degeneracy: `r<=0`,
  `COINCIDENT_ENDPOINTS`, non-finite).
- `src/engine/cad/cadTransactionsShapeCommands.ts` — add
  `CIRCLE` (Center/Radius) and `CIRCLECD` (Center/Diameter) command
  definitions; **the entity write arm is representation-specific (below)**.
- `src/hooks/surveyCad/useSurveyCadCommandTypes.ts` — add `'CIRCLE'` to the
  command-key union + session state (`phase: center | radius | diameter`).
- `src/hooks/surveyCad/useSurveyCadCommandStarters.ts` — child starters.
- `src/hooks/surveyCad/useSurveyCadCommandSession.ts` — phase machine.
- `src/hooks/surveyCad/useSurveyCadCommandConstruction.ts` — commit path.
- `src/hooks/surveyCad/useSurveyCadCommandPreview.ts` — live preview.
- `src/hooks/surveyCad/useSurveyCadCommandText.ts` — prompts.
- `src/hooks/surveyCad/useSurveyCadCommandHelpText.ts` — help.
- `src/hooks/surveyCad/useSurveyCadCommandLifecycle.ts` — empty-input
  defaults/guards.
- `src/cad-app/shell/cadCommandRegistry.ts` — `session('CIRCLE', …)` +
  `session('CIRCLECD', …)`.
- `src/cad-app/shell/cadRibbonToolFamilies.ts` — `shapes-circle` variant
  (currently `Circle` is a planned/unimplemented face).
- `tests/cad_draw_circle_b1.test.ts` (new) + touched shell/registry suites.

## 3. Representation-specific delta — path A (first-class circle)

If policy selects `GO_FIRST_CLASS_CAD_CIRCLE_ENTITY`:

- `src/engine/cad/cadTypes.ts` — `CadCircleEntity` + `CadEntity` union arm.
- All **26 `switch (entity.type)` sites** (21 files; list in `forensics.md`
  §3): arm or explicit refusal each.
- `src/engine/cad/cadPersistence.ts`, `cadMlightcadAdapter.ts`,
  `landxmlCadProject.ts` — persist/parse arm + schema/version handling.
- `src/engine/cad/dxf/dxfExportModel.ts` — `model.circles` array; new
  `CIRCLE` emitter (groups 10/20/40) in `dxf/dxfSerializer.ts`; re-import.
- Snap/bounds/render arms: `cadSpatialEntityCandidates.ts`,
  `cadSpatialBounds.ts`, `cadSpatialIndex.ts`, `cadRenderer.ts`,
  `cadProperties.ts`, `cadEntityNames.ts`,
  `SurveyCadPreview.geometry.ts`.
- Consumer arms/refusals: trim, fillet, reverse, offset, parcel, tables,
  transforms, clipboard, blocks (engine-scope greps: fillet 11 / trim 72 /
  reverse 29 / offset 93 files — **untested inventories, not defect lists**).
- `tests/cad_circle_entity_*.test.ts` (persistence round-trip, per-switch,
  DXF round-trip) + parity/regression.

## 4. Representation-specific delta — path B1 (full-sweep arc, B1 0/360)

If policy selects `GO_FULL_SWEEP_CAD_ARC_ENTITY`:

- Entity write: `CadArcEntity` with `startAngleDeg=0`, `endAngleDeg=360`
  (no new kind). Command/builders produce that form.
- Full-sweep snap/handle contract: suppress `endpoint`, `midpoint`
  (`arc-midpoint`) and start/end grips when `|sweep| ≈ 360` in
  `cadSpatialEntityCandidates.ts`, `cadSpatialBlockSnaps.ts`,
  `cadSpatialIndex.ts`, `cadTransactionsEntityTransforms.ts`,
  `cadAnnotationAnchorFromCommandPoint.ts`, `cadEntityNames.ts`.
- Block contract (executed gap): `expandBlockReference` currently collapses
  the 0/360 child to 0/0 (`cadNormalizeAngleDeg(360)=0`) and mean-scales a
  non-uniform block scale (`scaleX=2,scaleY=1` → radius 75) instead of
  refusing. The chosen identity must preserve the sweep or fail closed and
  must fail-closed-or-convert on non-uniform block scale (an ellipse is not
  persistable).
- DXF: keep 0/360 verbatim (`dxfExportModel.ts:452-460`,
  `dxfSerializer.ts:152`); record the host-normalization assumption or add an
  explicit normalization.
- Endpoint-based commands (trim/extend/fillet/reverse/offset) + parcel/
  feature-line conversion: define behavior for `start==end` (correct result
  or fail-closed refusal).
- `tests/cad_circle_full_sweep_b1.test.ts` (snap suppression, DXF 0/360,
  command behavior on `start==end`) + parity/regression.

## 5. Single shared authority for both paths

Both paths need one shared predicate `cadArcIsFullCircle(entity)` /
`cadCircleOf(entity)` so no consumer re-derives `|sweep|≈360` independently.
This helper is the mechanism the policy decision must name; it is the
difference between a bounded audit (B1) and a new identity (A).

## 6. Order of work once policy is set

1. Land the chosen representation (A: kind + 26 arms + DXF + schema;
   B1: full-sweep helper + snap/handle/command contract).
2. Land the common construction slice (§2).
3. Focused tests + `npm run lint`, `npm run typecheck`, `npm run test:agent`,
   build; parity/browser as required for the chosen path.
4. Keep `Circle` disabled until step 1–3 pass; no `src/` change before the
   policy decision.
