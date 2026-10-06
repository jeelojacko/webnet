# Phase B2 — Circle tangent solvers (Tan-Tan-Radius / Tan-Tan-Tan)

Module: `src/engine/cad/cadGeometryCircleTangentSolvers.ts` (new, pure). It
contains no React, no project mutation, and no new epsilon authority: the only
numeric floor is `CAD_XY_DEGENERATE_FLOOR` from
`cadGeometryShapeBuilders.ts`.

## 1. Inputs

A tangent source is one picked primitive plus the exact pick point:

- `line` — `{entityId, segmentId, start, end}`; tangency is computed on the
  supporting **infinite** line (the FILLET/TANGENT_CURVE extension law).
- `circle` — the first-class `CadCircleEntity` center/radius.
- `arc` — the full underlying circle plus `startAngleDeg`/`endAngleDeg`; the
  tangency point must lie on the arc sweep.
- `polyline` — resolved (at pick time) to the **picked segment only**, using
  the segment id recorded by the spatial snap; its supporting infinite line is
  used. Without a segment id the closest segment is chosen.

`resolveCadTangentSource(project, entityId, pickPoint, segmentId?)` maps the
picked entity to a source and returns `null` (fail closed) for unknown or
unsupported entities. `isSameCadTangentPrimitive(a, b)` is the duplicate test
(same kind + same `entityId`; for lines also the same `segmentId`).

## 2. Tolerance and local frame

`tangentTolerance(scale) = CAD_XY_DEGENERATE_FLOOR * max(1, scale)`, where
`scale` is the maximum absolute coordinate/radius across the picked sources and
pick points within the local frame. `sourceGeometryScale` computes it. This is
the only scale-relative guard; no hard-coded epsilon is introduced.

Both solvers translate their inputs into a local frame anchored at the picked
geometry's bounding-box centre and translate the result back, so the tolerance,
dedupe, and `AMBIGUOUS` tie test use the local scale and are independent of the
absolute world coordinates (a large world translation cannot widen the
tolerance or merge branches).

## 3. TTR — `solveCadCircleTangentTangentRadius(first, second, radius)`

Rejects non-finite/`<= CAD_XY_DEGENERATE_FLOOR` radius and non-solvable pairs
(non-finite primitive, or the same primitive twice). Candidate centers:

- line/line: offset each line by `±radius` (`cadOffsetLineSegment`) and take all
  four infinite-line intersections.
- line/circle or line/arc: offset the line by `±radius`; for each distinct
  positive offset radius `{|r_src + radius|, |r_src − radius|}` intersect the
  offset infinite line with the concentric circle
  (`cadIntersectInfiniteLineCircle`).
- circle/circle (and arc/arc, circle/arc): intersect all combinations of the
  positive offset radii (`cadIntersectCircleCircle`).

Each center is validated by `buildCandidate`: for every source the residual
between the actual center-to-primitive distance and the required signed offset
(`radius` for lines; `radius ± r_src` for circles) must be `<= tolerance`, the
arc-sweep membership must hold, and the candidate radius must be a valid
circle. A candidate stores one tangency point per source, in source order, and
a score = sum of pick-point-to-tangency distances. Equal tangency branches
(external `s = +1` / internal `s = −1`) are considered and the smaller residual
wins.

## 4. TTT — `solveCadCircleTangentTangentTangent(first, second, third)`

Apollonius solve over all eight sign triples `(s1, s2, s3)`, `si ∈ {+1, −1}`:

1. `buildApolloniusObjects` normalizes each source to a signed line equation
   `nx·x + ny·y = d` or a circle `(cx, cy, r)`; concentric circle pairs are
   allowed but their radical axis is skipped.
2. `buildLinearConstraints` emits one linear constraint per line
   (`nx·x + ny·y − s·R = d`) and one per non-concentric circle pair (the radical
   axis, eliminating `x²+y²`).
3. For each ordered pair of constraints the center and radius are expressed
   affinely in one free parameter, tried in rank order `R`, then `x`, then `y`;
   when the `(x, y)` block is rank-deficient (e.g. collinear circle centres)
   the solver parametrizes in `y` and closes the system with the remaining
   circle equation instead. Substituting into an object whose own equation was
   not consumed yields a linear (line) or quadratic (circle) equation in the
   parameter (`radiusRootsForObject` → `quadraticRoots`). The quadratic uses
   the stable `c/q` second root. The solve is closed-form — no iteration — and
   uses only `CAD_XY_DEGENERATE_FLOOR`.
4. Every resulting `(center, radius)` is validated by the same `buildCandidate`
   used by TTR, so tangency residuals, arc sweeps, and circle validity are
   enforced identically.

## 5. Selection, dedupe, ambiguity

- `dedupeCandidates` drops candidates whose center is within `tolerance` and
  whose radius differs by `<= tolerance`.
- `finalizeCandidates` sorts survivors by ascending score (sum of
  pick-to-tangency distances).
- If the second-best score is within `tolerance` of the best, the result is
  `AMBIGUOUS` with `center = null`; otherwise the best candidate is `SOLVED`.
- No candidates → `NO_SOLUTION`. `candidates` always carries the validated,
  score-ordered list for diagnostics/tests.

## 6. Failure modes (all fail closed, zero mutation)

- radius zero/negative/non-finite; same primitive twice; parallel lines for TTR;
  degenerate or underdetermined triples; three parallel lines (only an
  infinite-radius circle would fit); concentric-only triples; non-finite
  inputs.
- `AMBIGUOUS` is surfaced to the session as a readable reason and is never
  auto-committed.

## 7. Test coverage

`tests/cad_circle_tangent_b2.test.ts` (19 tests) covers: TTR nearest-of-four
line/line, line/circle external and internal branches, circle/circle external
branch, FILLET infinite-extension law, arc-sweep filtering, radius guards,
duplicate/parallel failure, symmetric-tie `AMBIGUOUS`, TTT all-line
incircle + three excircles, permutation invariance, line + two circles,
two lines + one circle, three-circle Descartes incircle + enclosing Soddy
circle, degenerate triples, three parallel lines, and
`resolveCadTangentSource` for line/circle/arc/polyline/missing. Two regressions
pin the local-frame/rank-aware fixes: a 1e12 world-coordinate translation keeps
the same branch selection, and collinear circle centres `(-10,0)/r10`,
`(0,0)/r5`, `(10,0)/r10` solve to `(0, 25/6)/r5/6`.
