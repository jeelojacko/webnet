# Phase 18Q — Why general AFFINE2D is deferred

Decision note: **an arbitrary 2D affine transform (AFFINE2D APPLY) is
deferred — no production command is shipped, and no general-affine code path
exists.** A pure solver experiment is permitted but **not required**. This
note records the five blocking reasons and the exact conditions that would
have to change before the deferral can be lifted.

Companion: `phase18q-transform-architecture.md` (what the existing MOVE /
COPY / block / annotation contracts guarantee).

## 1. An affine map turns circles into ellipses

A general 2D affine `x' = A x + t` maps

- a **circle** to an **ellipse** (unless `A` is a similarity — uniform
  scale + rotation, possibly reflection),
- a **line** to a line (safe), and
- a **circular arc** to a **conic arc** that is generally *not* a circular
  arc.

The CAD model has exactly one arc primitive, `CadArcEntity` =
`{ center, radius, startAngleDeg, endAngleDeg }`. It **cannot** represent
the image of a circular arc under shear or non-uniform scale. The rule is
already encoded as **`CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED`** in the
capability matrix — every general-affine cell touching an arc is BLOCKED by
construction, not by missing arithmetic.

**WebNet has no generic ellipse entity.** The only ellipse in the model is
`CadErrorEllipseEntity`, which is a *statistical* error ellipse derived from
point covariance — not a drawable geometry primitive and not a valid target
for converting an affine arc image. So there is nowhere to *put* a
non-circular arc result even if the math were computed.

## 2. Alignment arc semantics break

`CadAlignmentEntity` stores `elements[]` of `line` or `arc` (center,
radius, start/end angle) plus `startStation` and optional
`stationEquations`. Under a similarity, arc radii scale uniformly and
stationing scales linearly, which is why rigid/similarity alignment rules
are expressible (`CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY` already blocks
any `scale ≠ 1`). Under a general affine map:

- a circular element becomes a non-circular curve the element union cannot
  hold;
- arc length — the basis of stationing — is no longer `r · Δθ`, so every
  station and every station equation is invalidated by a closed form the
  model does not compute;
- tangent continuity at element joins is not preserved by a shear in a way
  the element model can re-derive.

An alignment under general affine therefore has **no representable
result**.

## 3. Block references would need shear

`CadBlockReferenceEntity` carries `{ x, y, rotationDeg, scaleX, scaleY }`,
and `normalizeBlockScales` **requires both scales to be finite and > 0**.
The expansion order is translate-base → scale → rotate → translate-insert.
That parameterization spans **rotation + non-uniform positive scale**, but
**not shear**: a sheared basis cannot be written as
`R(θ) · diag(sx, sy)` for any real `θ, sx, sy`. Representing a general
affine on a block reference would require an explicit 2×2 matrix (or a
shear parameter) on the entity plus a new reflected/sheared child-expansion
branch — a model change, not a command.

## 4. Annotation policy gap

Annotation carries a *dual* position model (see the architecture note §4):
a manual point (`dimLinePoint`, `textPoint`, `text`, label `offset`) **and**
a bound anchor / `sourceEntityId` that resolves through
`resolveCadAnnotationAnchor` (pure, `BROKEN_REFERENCE` fallback, **never
rebinds**). COPY already leaves clones pointing at the original source
(`cadTransactionsAnnotationCopyCommands.ts`). Under an affine map:

- **which** of the two positions is authoritative is undefined — a manual
  override transformed by matrix vs. an anchor re-derived from transformed
  geometry can disagree;
- text height / leader arrowhead sizes are style-sized glyphs with no
  documented affine rule (they should not shear with geometry);
- bearings and curve parameters shown by labels are **not** affine
  invariants, so the displayed values would be wrong even if the placement
  were right.

There is no policy that says how annotations behave under affine, and
inventing one is a design task, not an implementation task.

## 5. Therefore: deferred

AFFINE2D APPLY is **deferred**:

- **No production command** is added (`ROTATE`, `SCALE`, `MIRROR`,
  `ALIGN2D-*`, `HELMERT-*`, `GRID/GROUND` remain the supported families —
  all similarity/rigid).
- **No general-affine code path** is added to the engine, transactions, or
  preview layer.
- A **pure solver-side experiment** (transform a coordinate set and report
  residuals) is permitted, but **not required**, and must not be wired into
  any command, persistence, or export surface.

### Conditions to lift the deferral

At minimum, in order:

1. Add a generic ellipse/conic entity (or an arc `conic` representation)
   and teach the renderer, hit-test, export, and DXF round-trip about it.
2. Extend the alignment element union to carry non-circular elements and a
   stationing recompute for them.
3. Extend `CadBlockReferenceEntity` (or its expansion) with an explicit
   2×2 basis / shear + reflection state.
4. Define a written annotation policy for manual-vs-anchor precedence,
   glyph sizing, and label-value recomputation under affine.
5. Only then add a solver-side affine prototype, still gated off from
   production export.
