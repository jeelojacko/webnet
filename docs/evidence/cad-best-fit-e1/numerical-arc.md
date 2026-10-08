# E1 numerical arc — method, conditioning, oracles

Module: `src/engine/cad/cadBestFitArc.ts` (+ shared
`cadBestFitCommon.ts`). No entity dependency.

## Method

Geometric least squares: minimise `sum (dist_i - r)^2` over centre `(cx, cy)`
and radius `r`.

1. Same snapshot law as the line (finite filter, dedupe, sort).
2. Normalise to `(sample - centroid) / span`.
3. Kasa algebraic seed (centred 2x2 solve) gives `(cx, cy, r)`.
4. Damped Gauss-Newton (LM) refinement on the radial residual
   `d_i - r`, Jacobian row `[-dx/d, -dy/d, -1]`.
5. Unscale: `centre = centroid + span * centre_local`,
   `radius = span * r_local`.

## Conditioning and caps

- `BEST_FIT_ARC_MAX_ITERATIONS = 100`.
- Gradient convergence `hypot(jtr) <= 1e-10 * (1 + cost)`.
- Relative step convergence `hypot(step) <= 1e-10 * (1 + hypot(params))` so
  floating-resolution stalls terminate as converged rather than rejected.
- LM `lambda` grows / decays deterministically; blow-up past `1e12` fails
  closed unless the gradient is already small (`1e-6 * (1 + cost)` fallback).
- Radius floor: `CAD_XY_DEGENERATE_FLOOR` (existing CAD geometry floor).

## Finite-span law

Project distinct samples to angle relative to the fitted centre, sort, take the
largest circular gap. `sweepDeg = 360 - largestGapDeg`;
`startAngleDeg` = the sample angle after the gap; `endAngleDeg = start + sweep`
(CCW). Order-independent. Radius floor + non-finite guards fail closed.

Full-circle refusal: largest uncovered gap `<= 1 deg` (`BEST_FIT_ARC_FULL_CIRCLE_GAP_DEG`).
This matches the existing arc-builder full-circle refusal precedent. A literal
machine-epsilon threshold would need an unreachable sample density for a
discrete full circle, so a 1-degree uncovered-gap guard is used.

## Fail-closed

- `< 3` distinct points.
- Near-collinear / singular algebraic system
  (`det <= (suu + svv)^2 * 1e-12`).
- Non-finite / non-convergent refinement.
- Radius at/below the geometry floor, or full-circle span.

## Test oracles (`tests/cad_best_fit_arc.test.ts`, 9 tests, all pass)

- Exact 3-point circumcircle reproduces centre / radius / span.
- Noisy minor arc and noisy major arc recover radius and sweep.
- Large-coordinate centre (`1e6`, `-2e6`).
- Uniform-scale invariance; sample-order (permutation) span-law invariance.
- `< 3` distinct, nearly collinear (and exactly collinear), and dense 720-point
  full-circle rejection.
