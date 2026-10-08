# CAD Best Fit E1 — residual report contract (Worker C)

How each `BEST_FIT_*` engine commit reports its fit. The engine owns the
numbers (Worker A solves, Worker C formats); the session only collects
snapshots. Reports are stored as the command's `CadCogoComputation` (one per
commit, atomic with the entity) and forwarded to the report panel on commit.

## 1. Common rows (every tool)

| Row | Value |
|---|---|
| Method | `Orthogonal least squares (PCA)` (line), `Geometric least squares` (arc), `Rotated geometric least squares` (parabola) |
| Sample count | Number of stored samples (`rows == tables == sample count` is pinned by test) |
| RMS residual | `rms` from the fit, 4 decimals, unit `m` |
| Max \|residual\| | `maxAbs` from the fit, 4 decimals, unit `m` |

## 2. Geometry rows

Line (`BEST_FIT_LINE`): `Azimuth` (deg, 4 decimals), `Bearing`
(`formatCadBearing`, e.g. `N44-56-19.74E`), `Span` (m, 3 decimals —
min/max-projection distance).

Arc (`BEST_FIT_ARC`): `Center E` / `Center N` (m, 3 decimals), `Radius`
(m, 3 decimals), `Start angle` / `End angle` / `Sweep` (deg, 4 decimals),
`Arc length` (m, 3 decimals).

Parabola (`BEST_FIT_PARABOLA`): `Vertex E` / `Vertex N` (m, 3 decimals),
`Axis azimuth` (deg clockwise from north via `cadParabolaAxisAzimuthDeg`,
4 decimals), `Focal length` (m, 3 decimals), `t range`
(`tStart .. tEnd`, 4 decimals), `Curve length` (closed-form
`cadParabolaCurveLength`, m, 3 decimals).

## 3. Residual table

One table per commit titled `Best Fit <Line|Arc|Parabola> residuals`:

| Column | Content |
|---|---|
| Sample | Station id when the sample was attributed to a survey point (snap or preseed), the typed `LABEL=` when given, the geometry-snap description otherwise, else `P<n>` (collection order) |
| Easting / Northing | Stored sample coordinates, 3 decimals |
| Residual (m) | Signed fit residual, 4 decimals. Line: perpendicular, positive along the left-perp normal. Arc: radial (`dist - r`, positive outside). Parabola: normal, positive toward the opening/focus side |
| Closest E / Closest N | Closest point on the FINITE fitted geometry, 3 decimals (arc/parabola clamp to the sweep / `t` range; never the infinite extension) |

Row order is collection order (the fit reports residuals per finite sample
in input order). Row count always equals the sample count.

## 4. Provenance (snapshot only, no live dependency)

`provenance.inputs.samples` is a fresh-object snapshot
`[{ x, y, label, sourceEntityId? }]` taken at commit; later edits to the
session or the drawing never rewrite it. `sourceEntityIds` carries the
distinct sample source entity ids (survey points, snapped geometry, or
absent for free picks); `sourcePointIds` carries the sample labels. The
created entity's `metadata.cogo` records `toolKey`, `provenanceId`,
`inputs`, and `resultSummary`, so the saved file stays traceable.
