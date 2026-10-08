# CAD Curves F1 — Existing Command Audit (engine half)

Engine-side audit of the pre-existing curve commands touched by F1. Numeric
law lives in `src/engine/cad/cadCogoCurveMath.ts`; the geometry kernels are
unchanged unless a real defect was found. UI/session/ribbon findings are out
of scope for this half.

## SUBDIVIDE_CURVE — chord mode (real defect, fixed)

`cadArcSubdivisionPoints` advanced the cursor by the chord interval `C` but
then called `cadArcPointByChordDistance(arc, cursor)`, which interprets
`cursor` as a chord **from the start point**. The k-th point therefore landed
at `start + 2·asin(k·C / 2R)` instead of `start + k·d` with
`d = 2·asin(C / 2R)`, so consecutive chords were not equal.

Disposition (**fixed**):

- Chord points now step by the equal-chord angle
  `d = 2·asin(C / 2R)` and stop strictly before the arc end.
- A chord at or beyond the diameter (`C >= 2R`) is refused (returns `[]`).
- Equal-count and arc-length modes are retained; all three modes share the
  same hard point cap `CAD_CURVE_SUBDIVIDE_MAX_POINTS = 10000` and refuse to
  emit an unbounded family.
- `SUBDIVIDE_CURVE_CREATE` is a new atomic transaction: every interior point
  lands in ONE history entry with one COGO computation (the old UI folded a
  `POINT` command per point, producing N undo entries).

Oracle: `cadEqualChordStepDeg` / `cadEqualChordDistance`
(`src/engine/cad/cadCurvesMultiple.ts`) and
`tests/cadCogo/cadCurvesF1.engine-audit.test.ts`.

## OFFSET_CURVE — CW/CCW side law (audited, correct)

`cadOffsetArc` resolves the offset sign from the signed sweep:
CCW (`sweep >= 0`) → left shrinks radius, right grows it; CW (`sweep < 0`) →
left grows radius, right shrinks it. That is the CAD left/right convention
(left of travel points toward the center for a CCW arc). No change was needed.
Pinned by `tests/cadCogo/cadCurvesF1.engine-audit.test.ts`
(`OFFSET side law`).

## POINT_ON_CURVE — bounds (minor defect, fixed)

`cadArcPointByArcDistance` already clamped `[0, arcLength]`. The chord variant
`cadArcPointByChordDistance` returned `null` for a chord of exactly `0`, even
though the UI parser accepts `CHORD,0` as the arc start. Disposition
(**fixed**): chord `0` returns the arc start point; negative chords and
chords beyond the arc's own chord remain rejected. End-of-arc / negative /
over-range bounds are pinned by the `POINT_ON_CURVE bounds` tests.

## CURVE_SOLVER — pair math (audited, no real errors)

All ten pairs in `cadSolveCurveMetrics` were round-tripped from a known
`R = 100 m`, `Δ = 60°` fixture (radius-delta, radius-arc, radius-chord,
radius-tangent, delta-arc, delta-chord, delta-tangent, arc-chord,
arc-tangent, chord-tangent). Every pair recovers `R` and `Δ` to floating
tolerance; no engine change was required. Pinned by
`tests/cadCogo/cadCurvesF1.engine-audit.test.ts` (`CURVE_SOLVER pairs`).

## MULTIPLE_CURVES — floating-sign residual (guard added)

The floating curve must turn the same way as the chain. A non-floating set
that overshoots the total turn previously produced an opposite-sign residual
that could still pass the per-curve delta magnitude gate. `buildCadCurveChain`
now rejects an opposite-sign (or zero) floating residual with
`CURVES_CANNOT_FIT`; `MULTIPLE_CURVES_CREATE` therefore returns `null` with
zero mutation for an impossible fit. Pinned by the `chain sign law` test and
the `impossible fit rejects with zero mutation` transaction test.

## Through-point candidate selection (never by array order)

`solveCadCurveThroughTwoTangentRays` returns typed candidates. The
`CURVE_THROUGH_POINT_CREATE` transaction commits only a unique kernel result;
if the kernel reports `MULTIPLE_SOLUTIONS` it requires an explicit
`candidateSide` and that side must be unique. A bare multi-solution outcome
is refused rather than resolved from `candidates[0]`.

## Registry categories (category field only)

`PI_CURVE`, `CHORD_BEARING_CURVE`, `REVERSE_CURVE`, `COMPOUND_CURVE`, and
`OFFSET_CURVE` move from the `Measure` group to `Draw` in
`src/cad-app/shell/cadCommandRegistry.ts`. Only the `category` field changed;
labels, hints, keys, and behavior are untouched.
