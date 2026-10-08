# CAD Curves F1 — Architecture Audit Note

Recorded by the F1 numerical/geometry worker from Scout A/B findings (branch
`feat/cad-curves-f1`, base `a408cf72`). This batch is **pure geometry only**:
no transactions, sessions, or ribbon edits. The F1 surface adds one shared
two-tangent ray resolver, one shared curve-metric solver, and six pure command
kernels so the integration worker can wire them without re-deriving math.

## Scout A — command/consumer matrix (16 rows)

| Tool | Consumer today | Geometry seam | F1 gap |
| --- | --- | --- | --- |
| TANGENT_CURVE (PI + back/ahead + R) | `cadTransactionsCurveCommands` | `cadBuildTangentCurve` | needs ray resolver + typed failures |
| PI_CURVE (PI + back + R + delta) | `useSurveyCadCurveSubmit` | `cadBuildArcFromPiRadiusDelta` | shares metric law |
| CHORD_BEARING_CURVE | `useSurveyCadCurveSubmit` | `cadBuildArcFromChordBearingRadius` | shares metric law |
| CURVE_SOLVER (any 2 of R/T/C/L/E/M) | `cadSolveCurveMetrics` | metric pairs | missing external/mid-ordinate/degree |
| SUBDIVIDE_CURVE equal / arc / chord | `cadArcSubdivisionPoints` | arc walk | chord mode math bug (below) |
| OFFSET_CURVE | `cadOffsetArc` | radius offset | unchanged |
| RADIAL_BEARING | `cadRadialBearingAtArcAngle` | radial | unchanged |
| POINT_ON_CURVE | `cadArcPointByArcDistance` | arc param | unchanged |
| REVERSE_CURVE | `cadBuildReverseCurve` | end-tangent continuation | needs extent/metric variants |
| COMPOUND_CURVE | `cadBuildCompoundCurve` | end-tangent continuation | needs extent/metric variants |
| FILLET (line/line) | `cadTransactionsFillet*` | ad-hoc ray/bisector math | shared resolver should converge |
| ARC_3PT | `cadBuildArcFromThreePoints` | 3-point circumcircle | unchanged |
| ARC_CREATE | `cadTransactionsCurveCommands` | center/sweep | unchanged |
| BATCH_COGO tangent curve rows | `cadBatchCogo` | N parallel arcs | chain pattern reference |
| TRIM first/second | `buildTrimmedEntityPieces` | sweep trim | reference only |
| ALIGN OFF / STA PT / STA INT | `cadAlignment*` | arc chain | reference only |

## Scout B — helper inventory and reuse

Existing reusable authorities:

- `cadInfiniteLineIntersection`, `cadProjectPointOntoInfiniteLine`,
  `cadDistance`, `cadAzimuthDeg`, `cadNormalizeAngleDeg`, `cadSignedSweepDeg`
  (`cadGeometry.ts`).
- `cadCreateCurveMetrics`, `cadBuildCurveMetricsFrom*`, `cadBuildArcFromCenterSweep`,
  `cadCounterClockwiseDeltaDeg` (`cadGeometryCurveCore.ts`).
- `cadArcEndPoint`, `cadArcEndTangentAzimuthDeg`, `cadIsAngleOnArcSweep`,
  `cadArcMidpoint` (`cadGeometryArcPrimitives.ts`).
- `cadBuildCurveMetricsSummary`, `cadSolveCurveMetrics`
  (`cadCogoCurveMetrics.ts`).
- `CAD_XY_DEGENERATE_FLOOR`, `isValidCircleGeometry`
  (`cadGeometryShapeBuilders.ts`) — the single CAD XY floor authority.

Trim / history / chain reuse confirmed by Scout A:

- **Trim**: `buildTrimmedEntityPieces` (`cadTransactionsTrim.ts:260`) is the
  canonical trim primitive. F1 kernels return `PC`/`PT`; the integration
  worker decides Between (trim) vs On (no trim) using those points.
- **History**: the FILLET one-entry-per-commit pattern is the model for
  curve commits (one undo entry, selected-new).
- **Chain**: `BATCH_COGO` builds N arcs in one commit; the F1 multiple-curve
  chain solver mirrors that shape (N arc definitions + one table).

## Scout B — defects and inconsistencies (recorded, not fixed here)

- **SUBDIVIDE chord bug**: `cadArcSubdivisionPoints` (`cadCogoCurveMath.ts`)
  advances the cursor by the chord interval `C` but then calls
  `cadArcPointByChordDistance(arc, cursor)`, which interprets `cursor` as a
  chord length **from the start point**. The k-th point is therefore at
  angle `start + 2·asin(k·C / 2R)`, not `start + k·d` with
  `d = 2·asin(C / 2R)`. Consecutive chords are not equal. F1 ships the
  equal-chord oracle test the integration worker will pin the fix against.
- **TANGENT hint lie**: the typed/help text describes a tangent workflow that
  the current starter does not enforce.
- **Dead-click starters**: some curve starters latch but never consume a pick.
- **LINE_CIRCLE ad-hoc**: selected-line line-circle math is bespoke rather
  than routed through a real circle primitive.
- **No curve icons**: the curve command family has no icon assets, so F1
  stays text-face (integration worker owns any UI).
- **Category inconsistency**: curve tools are not grouped in a single ribbon
  category.

## Six official Civil contracts (phase dispatch)

1. **Between (trim)** — circle tangent to two selected rays, both trimmed to PC/PT.
2. **On (no trim)** — same arc geometry, entities left untrimmed.
3. **Through point (trim)** — circle tangent to both rays passing through a picked point.
4. **Multiple 2..10** — one floating curve, remaining curves unchanged from their sources.
5. **From End** — point-or-radius continuation with the sign law (positive = right/CW, negative = left).
6. **Reverse-or-Compound** — G1 continuation with same (compound) vs opposite (reverse) turn sign.

Contracts 1 and 2 are the same geometry: `buildCadCurveBetweenTangentRays`
returns the identical arc for both; only the integration trim step differs.
