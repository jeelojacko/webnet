# CAD Best Fit E1 — Numerics architecture (Worker A)

This note pins the **Worker A contract only**: pure numerical fits and the
parabola geometry helper. It deliberately does NOT create entities, touch the
`CadEntity` union, the ribbon, commands, COGO, session, or renderer. Those are
Workers B/C.

## 1. File ownership split

| Worker | Files | Responsibility |
|---|---|---|
| A | `src/engine/cad/cadBestFitCommon.ts`, `cadBestFitLine.ts`, `cadBestFitArc.ts`, `cadParabolaGeometry.ts`, `cadBestFitParabola.ts` | Pure numerics + geometry helpers. No entity union, no registry, no UI. |
| B | `src/engine/cad/cadTypes.ts` (`CadParabolaEntity`), renderer/bounds/DXF/snaps/consumers | Adds the entity kind and the open 2-vertex `CadPolylineEntity` line output. |
| C | ribbon family, command keys, COGO tool keys, transaction wiring | User-facing commands, provenance, undo entry. |

Worker A applies no `CadEntity` union change. Outputs are framework-free
result objects; B/C project them into entities.

## 2. Source-point snapshot law

- Every fit reads a caller-supplied `readonly { x: number; y: number }[]` and
  never mutates it.
- Non-finite samples are dropped up front (`cadBestFitFinitePoints`).
- Duplicate / machine-near-duplicate samples are collapsed with a tolerance
  `max(span * 1e-12, 1e-12)` **before** fitting. The retained set is
  lexicographically sorted, so fits are deterministic and independent of input
  order.
- Minimums (fail closed, return `null`): line 2 distinct, arc 3 distinct,
  parabola 5 distinct.
- Internal units stay metres and radians; degrees appear only in exported
  angle fields.

## 3. Output entity law (owned by Worker B, constrained here)

- Best-fit **line** does NOT create a `CadLineEntity`: that type requires
  `fromStationId`/`toStationId`, which must never be faked. B emits an open
  two-vertex `CadPolylineEntity` instead (vertices pure XY; no
  `segmentGeometry`/`segmentWidths`).
- Best-fit **arc** maps to `CadArcEntity` (`centerX`, `centerY`, `radius`,
  `startAngleDeg`, `endAngleDeg`). The fit refuses a full circle, matching the
  existing arc-builder refusal precedent.
- Best-fit **parabola** maps to the additive `CadParabolaEntity` (WNCAD v2
  optional kind; kinds are not enumerated by the version table, so no bump).
  Canonical schema:

  ```
  vertexX, vertexY      world vertex
  axisAngleDeg          opening-axis direction, CCW from +X
  focalLength           f > 0 (metres)
  tStart, tEnd          finite curve extent, tStart < tEnd
  ```

  Point/tangent parametrisation (unit basis `a = (cos, sin)`,
  `b = (sin, -cos)`):

  ```
  P(t) = V + b * (2 * f * t) + a * (f * t * t)
  ```

  Both endpoints are finite and the range is non-zero; collapsed ranges fail
  closed.

## 4. Best-fit line law

Orthogonal total-least-squares (PCA) in 2D. Samples are translated to the
centroid and scaled by the characteristic span before the covariance is
formed, so results are translation/scale invariant. Principal eigenvector is
the tangent; its sign is deterministic: prefer `+X`, and if `|tangentX|` is
machine-near zero prefer `+Y`. The normal is the left perpendicular
`(-tangentY, tangentX)`. Signed residual is
`dot(sample - centroid, normal)`; the closest point is the orthogonal
projection; endpoints are the samples' min/max scalar projections.

Fail closed: fewer than 2 distinct points, zero/near-zero span, or an isotropic
(indeterminate-direction) covariance. Large RMS is **not** a rejection — a
noisy line is still a line.

## 5. Best-fit arc law

Geometric least squares: minimise `sum (dist_i - r)^2` over centre `(cx, cy)`
and radius `r`. Fitting happens in a translated/scaled frame; the algebraic
Kasa seed is deterministically refined by a damped Gauss-Newton (LM) loop with
capped iterations and tolerances. Three exact non-collinear points reproduce
the circumcircle.

Fail closed: fewer than 3 distinct points, near-collinear / ill-conditioned
algebraic system, non-finite or non-convergent refinement, or radius at/below
the CAD geometry floor (`CAD_XY_DEGENERATE_FLOOR`).

Finite-span law: project samples to angle, sort, take the largest circular gap;
the complement is the minimum covering arc. `startAngleDeg` is the sample angle
after the gap and `endAngleDeg = startAngleDeg + sweep` (CCW). A full circle
(largest uncovered gap at or below 1 degree) is refused.

## 6. Best-fit parabola geometric law

Rotated geometric / orthogonal-distance fit — **not** a world-axis
`y = a x^2 + b x + c` regression. Samples are normalised, a rotation-aware
coarse seed is chosen by multi-angle quadratic regression scored by true
closest-point cost, then canonical vertex/axis/focal are refined against true
closest-point distances from `cadParabolaGeometry`. The finite extent is the
min/max closest parameter of the samples.

Fail closed: fewer than 5 distinct points, line-like / infinite focal,
non-finite or non-convergent refinement, collapsed `t` range, or pathological
conditioning.

`cadParabolaGeometry.ts` is pure (no entity import) and provides:
param point, speed, closed-form arc length, analytic bounds, infinite/finite
closest parameter (bounded deterministic cubic solve in canonical local
coordinates), half-arc midpoint parameter, and finite-parabola/segment
intersection.

## 7. Determinism

All accumulation runs over the sorted distinct set; all solvers are bounded
and tolerance-capped; no randomness and no wall-clock dependence. Exports are
ordered arrays derived from sorted/input order.

## 8. Residual / report law

- Line: signed perpendicular residual per finite sample (input order).
- Arc: signed radial residual `dist_i - r` (positive outside), reported per
  finite sample; closest points are clamped to the finite sweep.
- Parabola: signed normal residual per finite sample, positive toward the
  opening/focus side; closest points use the finite `t` range.
- `rms = sqrt(mean(residual^2))`, `maxAbs = max(|residual|)`.

## 9. Validation oracles

Focused Vitest suites (agent tier):
`tests/cad_best_fit_line.test.ts`, `tests/cad_best_fit_arc.test.ts`,
`tests/cad_best_fit_parabola.test.ts`. Oracles per §4–§7, with a dense brute
sampling oracle cross-checking parabola closest points and a 500-sample
interactive perf bound.
