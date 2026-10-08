# E1 numerical line — method, conditioning, oracles

Module: `src/engine/cad/cadBestFitLine.ts` (+ shared
`cadBestFitCommon.ts`). No entity dependency.

## Method

Orthogonal total-least-squares / PCA in 2D:

1. Drop non-finite samples; collapse machine-near duplicates at
   `max(span * 1e-12, 1e-12)`; sort lexicographically (order-independent).
2. Translate to the distinct-point centroid and scale by the characteristic
   span `max(width, height)`.
3. Covariance `[[Sxx, Sxy], [Sxy, Syy]]`; closed-form symmetric eigen-decomposition.
4. Tangent = principal eigenvector. Sign rule: prefer `+X`; if `|tangentX|` is
   machine-near zero, prefer `+Y`. Normal = left perpendicular
   `(-tangentY, tangentX)`.
5. Signed residual `dot(sample - centroid, normal)` (input order); closest point
   = orthogonal projection; endpoints = samples at min/max scalar projection.

## Conditioning and caps

- Centring removes large-coordinate loss; unit-span scaling makes the
  covariance dimensionless, so results are translation/scale invariant.
- `O(n)`, single pass, no iterative loop, no wall clock.

## Fail-closed

- `< 2` distinct points.
- zero / near-zero span.
- isotropic covariance: `majorValue - minorValue <= majorValue * 1e-9`
  (direction indeterminate).
- Large RMS is *not* rejected: a noisy line stays a line.

## Test oracles (`tests/cad_best_fit_line.test.ts`, 10 tests, all pass)

- Exact horizontal / vertical / rotated recovery (tangent, normal, endpoints,
  azimuth, zero residuals).
- Translation invariance at `1e6` / `-2e6`; uniform-scale invariance.
- Noisy fit keeps signed residuals aligned with the normal.
- Duplicate / zero-span / single-point rejection; isotropic square and regular
  polygon rejection; non-finite samples dropped before fitting.
