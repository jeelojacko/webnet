# Phase 18Q — Transform architecture audit (MOVE / COPY / annotation / preview)

Read-only audit of the geometry-mutation surface that a professional
transform toolset (ROTATE, SCALE, MIRROR, 2-point ALIGN, least-squares
HELMERT, grid/ground scaling) would have to consume. The note adds no code;
it records the current contracts that any transform implementation must
preserve. Companion: `phase18q-affine-deferral.md` (why general AFFINE2D is
deferred).

## 1. Current MOVE geometry

### 1.1 `translateEntity` — the only existing rigid translate

`translateEntity` (`src/engine/cad/cadTransactionsEntityTransforms.ts:20-110`)
is an **exhaustive `switch (entity.type)` with no `default`**. The
exhaustiveness is the contract: adding an entity type is a compile error
until a translate rule exists. Per type:

| Entity | Fields translated |
| --- | --- |
| `survey-point` | `x`, `y` |
| `line` | `fromX/fromY`, `toX/toY` |
| `polyline` / `polygon` / `parcel` | **every** `vertices[]` entry |
| `arc` | `center` only (radius + angles unchanged) |
| `alignment` | each element `start`/`end` (line) or `center` (arc) |
| `text` | `x`, `y` |
| `error-ellipse` | `centerX`, `centerY` |
| `mtext` / `block-reference` | `x`, `y` |
| `leader` | `vertices[]` only — `arrowAnchor` stays bound to its source |
| `dimension` | `dimLinePoint` + `textPoint` — `anchors` untouched |
| `bearing-label` / `curve-label` | **no-op** (no geometry of its own; positioned by offset relative to its source) |

Two consequences that later transforms must respect:

- Translate is a **similarity (rigid) preserve**: arc radii, sweep, and
  stationing are never recomputed because they cannot change.
- Annotation entities carry a *dual* position: a manual point (translated)
  and a bound anchor (left bound). Rotation and scale cannot copy that
  split blindly.

### 1.2 `moveCommand` — the command wrapper

`moveCommand` (`src/engine/cad/cadTransactionsClipboardCommands.ts:230-281`):

1. **Zero-delta guard** — `|dx| <= 1e-9 && |dy| <= 1e-9` returns `null`
   (no transaction).
2. **Expanded selection** — `getExpandedSelectedEntities(snapshot)`
   (§5) so anchored text and error-ellipses move with their owner.
3. **Central editability gate** — if **any** expanded entity fails
   `checkCadEntityEditable` the **whole command returns `null`**. Reject is
   atomic and includes layer locks (`LAYER_LOCKED`); one locked member
   aborts the entire MOVE rather than skipping it.
4. **Bulk replace** — `replaceCadProjectEntities`.
5. **Per-entity dependency sync** — `syncEditedEntityDependencies(..., {
   syncLinePoints: false })`. Moved **lines do not drag linked survey
   points**; polyline/polygon/parcel vertex points **and** arc support
   points **do** follow. This asymmetry is deliberate (a moved line is a
   geometry edit; vertex-bound points are derived).

A transform command (ROTATE/SCALE/MIRROR/ALIGN/HELMERT) must reuse the same
three-part discipline: zero/no-op guard, expanded selection, atomic
editability gate, then a **single replace + per-entity dependency sync** so
recompute stays deterministic and bounded.

## 2. COPY clone / remap

### 2.1 Clone body

`buildCopiedEntities` (`cadTransactionsClipboardCommands.ts:32-228`):

- New ids from `createStableRuntimeId`; `createdBy: 'COPY'`.
- Layer assignment: **current layer for every clone except `labels` layer
  members**, which keep their layer.
- All geometric fields are copied verbatim and offset by the command delta.

### 2.2 Dependent-point clone

`cadTransactionsCopiedDependents.ts:21-153` re-creates the derived points a
cloned parent needs, minting **new station ids `CAD<n>`**. A clone therefore
never aliases the source's station namespace.

### 2.3 Annotation-aware copy

`cadTransactionsAnnotationCopyCommands.ts` wraps COPY so annotation clones
**keep `anchor`s and `sourceEntityId` pointing at the ORIGINAL source** —
they are **never rebound** at copy time. This is the current behavior and
the trap for later work: a mirrored or scaled copy (e.g. a MIRROR-COPY
remap in §4) *would* have to rebind those references to the cloned source,
and today nothing does. Any MIRROR/SCALE command that clones annotation
must add that remap explicitly.

## 3. Block model

`CadBlockReferenceEntity` (`src/engine/cad/cadTypes.ts:398-406`):

```
{ type:'block-reference', blockDefinitionId, x, y, rotationDeg, scaleX, scaleY }
```

- **`scaleX`/`scaleY` must be finite and > 0** — enforced by
  `normalizeBlockScales` (`src/engine/cad/cadBlocks.ts:64-75`,
  `CAD_BLOCK_INVALID_SCALE`). There is **no negative scale**, therefore no
  way to represent a reflection.
- Expansion `transformBlockPointToWorld`
  (`cadBlocks.ts:137-151`) applies the normative order: **translate by
  `-basePoint` → scale → rotate → translate to insert**. Child arcs use the
  **mean scale `(sx + sy) / 2`**, an explicit approximation flagged in the
  code — correct only for uniform scale.
- **No mirror state exists** on the entity, the definition, or the
  expansion path. A MIRROR transform on a block reference is therefore
  blocked at the model level, not merely unimplemented in a command: it
  would require either negative scale (forbidden) or a new reflection flag
  plus a reflected child-expansion branch.

## 4. Annotation model

### 4.1 Anchors

`annotation/cadAnnotationAnchors.ts` defines the anchor union
`fixed | survey-point | line-endpoint | arc-point | block-insertion`.
`resolveCadAnnotationAnchor` is **pure**, returns a **`BROKEN_REFERENCE`
fallback** when the target is missing, and **never rebinds** itself.

### 4.2 Dimensions

Single derivation path: `resolveDimensionAnchors`
(`cadRenderer.ts:757-852`) → `deriveCadDimensionGeometry`
(`annotation/cadDimensionGeometry.ts:366-409`). `textPoint` is **verbatim
manual** when present (the user's override wins over derived placement).
Rotate/scale must transform `dimLinePoint`/`textPoint` and leave `anchors`
to re-derive — never write back into `anchors`.

### 4.3 Survey labels

`annotation/cadSurveyLabels.ts:106-164` computes bearing-label placement by
**adding the entity offset to the style offset** (`placement + styleOffset`,
not replacing). Curve labels (`:190-205`) go through
`annotation/cadAnnotationPlacement.ts:90-117`. Both are **offset-relative**:
there is no glyph geometry to rotate/scale — only a placement offset that
must be transformed.

## 5. Selection and dependency expansion

- `getExpandedSelectedEntities`
  (`cadTransactionsSelection.ts:21-26`) adds **anchored text +
  error-ellipses** that belong to a selected owner, and **drops locked**
  entities from the expansion.
- `syncEditedEntityDependencies`
  (`cadTransactionsLinkedEntities.ts:14-59`) dispatches on entity type;
  this is the single place derived geometry is reconciled after an edit.

## 6. Derived geometry (recompute, never transform independently)

- **Parcel metrics** — `cadBuildParcelClosureSummary`
  (`cadCogoParcelGeometrySummaries.ts:60-105`) recomputes area/perimeter/
  closure by **shoelace from the current vertices**. The rule is
  **recompute-from-geometry**: transforms move vertices, then metrics are
  re-derived; they are never carried through a transform.
- **Arc helpers** — `cadGeometryArcPrimitives.ts` owns arc math
  (midpoint, angle-from-center, point-on-circle,
  project-onto-circle). Any rotate/scale of an arc must go through these,
  not re-derive inline.
- **Alignment** — `CadAlignmentEntity` (`cadTypes.ts:304-318`) holds
  `elements[]` (line/arc) + `startStation` + optional `stationEquations`.
  Stationing is a **dependency of the alignment**, not geometry.
- **Profile / sample-line / surface references** are **refs-only
  dependencies**: a missing target yields `BROKEN_REFERENCE` and **never
  cascades on delete**. Transforms must not invent geometry for a broken
  reference.

## 7. Preview architecture

- Preview primitives are the display union in
  `src/engine/cad/cadDisplayTypes.ts`.
- `useSurveyCadWorkspacePreviews.ts` `translate-selection` branch
  (`:127-206`) emits **offset DUPLICATES** (`preview:translate:<n>`, cyan,
  `opacity: 0.6`). The original entity **stays at full opacity** — there is
  **no dimming** for MOVE. This is the root cause of the recurring
  "entities are being duplicated" reports: the ghost *is* the preview, but
  with the source still fully drawn it reads as duplication.
- Only trim/extend/fillet **dim** their source, via
  `commandEntityOpacityOverrides` (`:265-280`). A transform preview should
  follow the MOVE convention (ghost duplicate) or explicitly add dimming —
  pick one and document it; do not leave both.
- **Pick-routing hazard** — `SurveyCadPreviewCanvas.tsx:142-148`:
  when `surfacePickActive` is set, clicks route to **`BLOCK_INSERT`** with
  `Repeat` defaulting to `true`. A MOVE click in that state can insert a
  block reference. **Every transform command must disarm the pick loop(s)
  it does not own before consuming a point**, or clicks leak into
  unrelated commands.

## 8. WNCAD persistence and export seams

- `CadDrawingDocument` (`cadTypes.ts:663-676`) is the persisted drawing
  payload. Its signature is **key-order-sensitive**
  (`buildStableCadProjectSignature`, `cadProjectState.ts:157-171`). New
  transform-authored fields must be inserted in a stable position or the
  signature churns and every fixture invalidates.
- Exporters are dispatched from `exportCenter.ts:416-482`:
  - SVG — `cadSvgSerializer`
  - PDF — `cadPdfExport`
  - DXF **R12** — `dxfSerializer`
  - DXF **R2000** — `dxfLayoutExport` / `dxfBlockExport` (native
    `BLOCK`/`INSERT`)
  - LandXML — **final-geometry only** (no intermediate transform state)

  A transform must therefore resolve to final geometry before export;
  nothing in the export path replays a transform pipeline.

## 9. Transform capability matrix

**Families** (all similarity/rigid — none is a shear/general affine map):

- **ROTATE** — rigid rotation about a base point (scale = 1, orientation
  preserving).
- **SCALE** — uniform scale about a base point (s ≠ 1, no rotation).
- **MIRROR** — reflection across an axis (scale = 1, orientation
  reversing).
- **ALIGN2D-RIGID** — 2-point alignment, translate + rotate, scale = 1.
- **ALIGN2D-SCALE** — 2-point alignment + uniform scale.
- **HELMERT-RIGID** — 4-parameter translate + rotate, scale = 1.
- **HELMERT-SIMILARITY** — 4-parameter translate + rotate + uniform scale.
- **GRID/GROUND** — uniform scale only (grid length factor).

Cells are exactly one of **SUPPORTED**, **SUPPORTED_WITH_SEMANTIC_RULE**,
or **BLOCKED**. No "partial".

| Entity kind | ROTATE | SCALE | MIRROR | ALIGN2D-RIGID | ALIGN2D-SCALE | HELMERT-RIGID | HELMERT-SIMILARITY | GRID/GROUND |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| survey-point | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| line | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| polyline | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| arc | SWR¹ | SWR¹ | SWR¹ | SWR¹ | SWR¹ | SWR¹ | SWR¹ | SWR¹ |
| alignment | SWR² | **BLOCKED**³ | SWR² | SWR² | **BLOCKED**³ | SWR² | **BLOCKED**³ | **BLOCKED**³ |
| polygon | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED |
| parcel | SWR⁴ | SWR⁴ | SWR⁴ | SWR⁴ | SWR⁴ | SWR⁴ | SWR⁴ | SWR⁴ |
| text (legacy) | SWR⁵ | SWR⁵ | SWR⁵ | SWR⁵ | SWR⁵ | SWR⁵ | SWR⁵ | SWR⁵ |
| error-ellipse | SWR⁶ | SWR⁶ | SWR⁶ | SWR⁶ | SWR⁶ | SWR⁶ | SWR⁶ | SWR⁶ |
| block-reference | SWR⁷ | SWR⁷ | **BLOCKED**⁸ | SWR⁷ | SWR⁷ | SWR⁷ | SWR⁷ | SWR⁷ |
| mtext | SWR⁹ | SWR⁹ | SWR⁹ | SWR⁹ | SWR⁹ | SWR⁹ | SWR⁹ | SWR⁹ |
| leader | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ | SWR¹⁰ |
| dimension | SWR¹¹ | SWR¹¹ | SWR¹¹ | SWR¹¹ | SWR¹¹ | SWR¹¹ | SWR¹¹ | SWR¹¹ |
| bearing-label | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² |
| curve-label | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² | SWR¹² |

SWR = SUPPORTED_WITH_SEMANTIC_RULE.

### Rule notes

1. **arc** — permitted only for similarity/rigid families. Radius scales by
   `s`; `startAngleDeg`/`endAngleDeg` rotate; start/end order is preserved
   and reversed under MIRROR (sweep direction flips). All math via
   `cadGeometryArcPrimitives.ts`. **General affine (non-uniform scale,
   shear) is always BLOCKED — `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED`**; no
   column above is a general affine map (see `phase18q-affine-deferral.md`).
2. **alignment (scale = 1)** — rigid rotation/reflection preserves element
   radii and length-based stationing, so it is allowed, but stationing and
   arc-element sweeps must be recomputed through the alignment model, not
   transformed field-by-field.
3. **alignment (scale ≠ 1)** — **BLOCKED — `CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY`**.
   A uniform scale changes every element radius and every station value;
   the alignment's station equations and arc radii are a scale-dependent
   dependency with no safe partial application. This blocks SCALE,
   ALIGN2D-SCALE, HELMERT-SIMILARITY, and GRID/GROUND.
4. **parcel** — vertices transform, then metrics are **recomputed**
   (`cadBuildParcelClosureSummary`); never carry area/perimeter/closure
   through the transform.
5. **text (legacy)** — **position-only**: only `x`/`y` transform; height
   and rotation are untouched (legacy baked text has no live height/rot
   transform).
6. **error-ellipse** — `centerX/centerY` transform; `semiMajor`/
   `semiMinor`/`thetaDeg` are re-derived per family (uniform scale scales
   both axes, rotation rotates `thetaDeg`, mirror flips the axis
   orientation).
7. **block-reference** — representable as long as `scaleX`/`scaleY` stay
   **finite and > 0**: rotation composes with `rotationDeg`, uniform scale
   multiplies both scales. `rotationDeg`/insertion recomputed explicitly.
8. **block-reference / MIRROR** — **BLOCKED**: there is **no mirror state**
   and negative scale is forbidden (`normalizeBlockScales`). A reflection
   needs a model change (reflection flag + reflected child expansion)
   before it can be claimed.
9. **mtext** — position transforms and `rotationDeg` composes for rigid
   families; text height follows the documented scale rule (not the legacy
   text no-op).
10. **leader** — `vertices[]` transform; `arrowAnchor` stays bound and is
    re-resolved (never transformed as a raw point). Under scale the
    arrowhead is style-sized, so the arrow stays a fixed glyph.
11. **dimension** — `dimLinePoint` and `textPoint` transform; `anchors`
    are left untouched and re-derived by
    `resolveDimensionAnchors → deriveCadDimensionGeometry`. A manual
    `textPoint` is transformed verbatim (the override wins).
12. **bearing-label / curve-label** — **placement-offset only**: transform
    the label's placement offset (entity offset ADDED to style offset);
    text content, height, and style are unchanged.

### Not selectable entities

Surfaces, profiles, sections, and volumes are **not selectable CAD
entities**. They participate in a transform only as **dependency-revision
inputs** (their source references move; the derived cache is invalidated
and rebuilt). They must never appear as transform targets or as matrix
rows.
