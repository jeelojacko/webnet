# CAD Curves F1 — Curve Metric Law

One authoritative seam, `src/engine/cad/cadCurveMetricsSolver.ts`, wraps the
existing metric primitives (`cadCreateCurveMetrics`, `cadBuildCurveMetricsFrom*`,
`cadSolveCurveMetrics`, `buildCadCurveMetricsSummary`). No new geometry law is
introduced; the solver only adds the inverse directions Civil curve tools need.

## Symbols

- `R` radius (meters), `Δ` central angle (degrees).
- `T = R·tan(Δ/2)` tangent, `C = 2R·sin(Δ/2)` chord,
  `L = R·Δ_rad` arc length, `E = R·(sec(Δ/2) − 1)` external,
  `M = R·(1 − cos(Δ/2))` mid-ordinate.

## Known Δ → R

| mode | R |
| --- | --- |
| `radius` | `R` (identity; Between/On pass a known radius) |
| `tangent` | `T / tan(Δ/2)` |
| `chord` | `C / (2·sin(Δ/2))` |
| `arc` | `L / Δ_rad` |
| `external` | `E / (sec(Δ/2) − 1)` |
| `midOrdinate` | `M / (1 − cos(Δ/2))` |
| `degreeArc` | `100·180 / (π·D)` (100-model-unit arc subtends `D`) |
| `degreeChord` | `50 / sin(D/2)` (100-model-unit chord subtends `D`) |

## Known R → Δ

| mode | Δ |
| --- | --- |
| `radius` | not invertible (input R is already known) |
| `tangent` | `2·atan(T/R)` |
| `chord` | `2·asin(C / 2R)` |
| `arc` | `L/R` |
| `external` | `2·acos(R / (R+E))` |
| `midOrdinate` | `2·acos(1 − M/R)` |
| `degreeArc` | `(100/R)·(180/π)` |
| `degreeChord` | `2·asin(50/R)` |

## Validity law (no coercion)

- `R` finite and strictly above `CAD_XY_DEGENERATE_FLOOR` (the single CAD XY
  floor authority from `cadGeometryShapeBuilders.ts`).
- `Δ` finite, strictly above `CAD_CURVE_DELTA_FLOOR_DEG = 1e-9`, strictly below
  `CAD_CURVE_DELTA_CAP_DEG = 180 − 1e-9`.
- Every mode value finite and positive; chord inputs must respect `C < 2R`;
  mid-ordinate must respect `0 < M < R`.
- A signed radius is only ever a side selector at the kernel boundary.
  Persisted arcs always carry a positive radius.

## Round-trip requirement

For every mode and a representative set of `Δ`, deriving `R` from `Δ` and then
re-deriving `Δ` from `R` must return the original `Δ` (and vice versa) to
floating-point tolerance. The focused test suite pins this for all seven modes.

## Degree-of-curve base

`CAD_CURVE_DEGREE_BASE_LENGTH = 100` (model units = meters internally). This is
the only place the 100-unit base is defined; degree-arc and degree-chord modes
consume it so the two definitions cannot drift.
