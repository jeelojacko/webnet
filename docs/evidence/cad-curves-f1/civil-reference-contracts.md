# CAD Curves F1 — Civil Reference Contracts

The six contracts below are the official behavior the F1 kernels must satisfy.
They mirror the phase dispatch and the industry-standard curve commands the
integration worker will wire. Units are meters and degrees at this boundary
(meters/radians internally).

## 1. Between (trim)

Pick two lines. Resolve their infinite supporting lines to a PI. The turn
angle `Δ` is the absolute direction change between the incoming and outgoing
travel directions. A specified radius (or a metric from which it is derived at
this fixed `Δ`) yields `T = R·tan(Δ/2)`, `PC = PI + u1·T`, `PT = PI + u2·T`.
The arc is tangent to both rays at `PC`/`PT`. Both source entities are trimmed
to `PC`/`PT`.

## 2. On (no trim)

Identical arc geometry to contract 1 with the same input. The source entities
are left untrimmed. The integration layer records `trim: false`; the pure kernel
is shared, so geometry cannot drift between the two commands.

## 3. Through point (trim)

Pick two lines and a point. Enumerate circles tangent to both supporting lines
whose finite sweep passes through the picked point. Candidate centers lie on the
angle bisectors of the two lines; the center parameter is the root of a
quadratic. A candidate is valid only when:

- `PC` lies on the selected first ray (positive projection from PI),
- `PT` lies on the selected second ray,
- the picked point lies on the finite minor sweep (not the reflex arc),
- radius is above the CAD floor and `Δ` is inside `(floor, cap)`.

Exactly one candidate → use it. Multiple → return every candidate with its
left/right side so the operator chooses (never an array-order pick). Zero →
typed no-solution. Both source entities are trimmed on commit.

Note: with both tangency points required on the selected rays and the point on
the finite minor sweep, a fixed ray pair admits at most one through-point
circle (the two bisector roots are the minor- and major-sweep circles). The
kernel still returns a candidate array plus a defensive `MULTIPLE_SOLUTIONS`
status so a future generalization can surface the L/R choice without an API
change.

## 4. Multiple 2..10

Between two rays, build `N` (2..10) tangent curves. Exactly one index floats.
For each non-floating curve `i`:

```
Δ_i = turnSide · L_i / R_i
```

For the floating curve `f`:

```
Δ_f = Δ_total − Σ_{i≠f} Δ_i
L_f = |R_f · Δ_f|
```

Every `|Δ_i|` must be inside `(floor, cap)`. The chain is walked from `PC`
sequentially with G1 joins; the final tangent equals the second ray. Placement
solves `PC` on ray 1 and `PT` on ray 2 by chain displacement (translating the
chain along ray 1 until its end lands on ray 2). If no positive-ray placement
exists → `CURVES_CANNOT_FIT`. Returns `N` arc definitions plus a per-curve table.

## 5. From End

`source` is a line or an arc.

- **Line**: `pick` selects the nearest endpoint; `outgoing` is the outward
  direction from that endpoint (away from the line body).
- **Arc**: an end-side pick continues forward from the arc end; a start-side
  pick continues from the arc start with reversed orientation.

**Point mode** builds the circle through `start` and `end` tangent to
`outgoing`; collinear input (infinite R) is rejected.

**Radius mode** takes a signed radius `R` (positive = right/clockwise,
negative = left) plus one extent metric `T / C / D / L / E / M`. The shared
metric solver derives `Δ` from `|R|` and the extent. The persisted arc always
carries a positive radius; the sign is only a side selector.

## 6. Reverse-or-Compound

Continue G1 from a source arc's endpoint (or start with reversed orientation).

- **Compound**: the new curve turns the **same** direction as the oriented
  source.
- **Reverse**: the new curve turns the **opposite** direction.

Endpoint is exact and the join is G1. The new curve's extent is supplied via
`T / C / D / L / E / M` through the shared metric solver. The kernel delegates
to the existing `cadBuildCompoundCurve` / `cadBuildReverseCurve` /
`cadBuildContinuedArc` law so combined and separate calls agree bit-for-bit.
