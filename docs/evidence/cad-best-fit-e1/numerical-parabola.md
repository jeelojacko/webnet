# E1 numerical parabola — method, conditioning, oracles

Modules: `src/engine/cad/cadParabolaGeometry.ts` (pure canonical geometry) and
`src/engine/cad/cadBestFitParabola.ts` (rotated geometric fit). No entity
dependency.

## Canonical geometry

`P(t) = V + b * (2 f t) + a * (f t^2)` with unit basis
`a = (cos A, sin A)` (opening axis), `b = (sin A, -cos A)` (vertex tangent).

- Param point, speed `2 f sqrt(1 + t^2)`.
- Closed-form arc length `f * [t sqrt(1+t^2) + asinh(t)]` difference.
- Analytic bounds: evaluate ends plus interior `dx/dt = 0` / `dy/dt = 0` roots
  (`t = -b_x/a_x`, `t = -b_y/a_y`).
- Closest parameter: local coords `u = (Q-V)·a`, `v = (Q-V)·b`; nearest point
  solves the depressed cubic `t^3 + ((2f-u)/f) t - v/f = 0`. A deterministic
  trigonometric/Cardano solver with Newton refinement returns all real roots;
  the global minimiser is chosen by true squared distance. The finite variant
  clamps to `[tStart, tEnd]` by evaluating the ends plus interior roots.
- Half-arc midpoint parameter: monotonic bisection on the arc-length primitive.
- Finite-parabola / segment intersection: quadratic in the canonical frame,
  segment-clamped and `t`-range-clamped, deterministic order.

## Fit method

Rotated geometric least squares (NOT a world-axis `y = a x^2 + b x + c` fit).

1. Snapshot law + normalise to centroid/span.
2. Seed: for 36 axis trials (`0..175 deg`, step 5), fit a quadratic
   `u = alpha v^2 + beta v + gamma`; normalise `alpha > 0` by flipping the axis
   when needed; score every seed with the true closest-point cost and keep the
   best.
3. Refine canonical `(vx, vy, theta, f)` with damped Gauss-Newton using a
   central-difference residual Jacobian so the implicit `dt/dp` term is
   captured. Caps: `100` iterations, `FD_STEP = 1e-6`, gradient tolerance
   `1e-10 * (1 + cost)`, relative step tolerance `1e-10 * (1 + |params|)`,
   LM blow-up `1e12` fails closed.
4. Finite extent: `tStart = min`, `tEnd = max` closest infinite parameter;
   collapse guard `1e-9`.
5. Unscale: vertex/ focal scale by span; angles unchanged.

## Fail-closed

- `< 5` distinct points.
- Line-like / infinite focal (`focal > span * 1e6`, or algebraic `alpha` at the
  floor after axis normalisation).
- Non-finite / non-convergent refinement, collapsed `t` range.

## Residual / report law

Signed normal residual per finite sample, positive toward the opening/focus
side; closest points use the finite `t`; `rms`, `maxAbs`, `tValues` reported per
finite sample (input order). `P(t)` uses the canonical world parameters.

## Test oracles (`tests/cad_best_fit_parabola.test.ts`, 14 tests, all pass)

- Exact recovery for axes `0/37/89/143 deg`, asymmetric `t` ranges, multiple
  focals, and large translations; a 90-degree rotated fixture that a world-axis
  regression would miss.
- Uniform-scale invariance; reflection recovery.
- Small-noise fit plus a **dense 40001-sample brute-force closest-point oracle**
  cross-check on every residual.
- `< 5` distinct / line-like / collinear rejection; non-finite samples dropped
  but the finite remainder still fits.
- Performance: 500-sample fit completes far under the 2 s interactive bound.
