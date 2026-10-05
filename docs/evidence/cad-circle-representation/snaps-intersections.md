# Snaps and intersections for circles — study

Scope: snap-kind semantics and intersection/tangency kernels for a circle,
under each candidate representation. Study-side only; kernels called
unchanged.

## 1. Snap-kind inventory

`CadSnapKind` (`cadTypes.ts:976`):

```
point-node, endpoint, midpoint, center, arc-midpoint, quadrant,
intersection, apparent-intersection, extension, perpendicular, parallel,
direction, tangent, nearest
```

`quadrant` **EXISTS** and is currently populated by arcs via the on-sweep
predicate (`cadSpatialEntityCandidates.ts:346-354`). The mission invariants:
`quadrant` is meaningful for circles; `endpoint`/`midpoint`/`arc-midpoint`
must never leak for a circle.

## 2. Arc snap emission — the leak (executed)

`buildArcEntitySnapCandidates` (`cadSpatialEntityCandidates.ts:308-341`)
emits, for every arc:

- `endpoint` at `arc.startPoint` **and** `arc.endPoint` — for a B1 full-sweep
  arc these are the **same point** ⇒ two coincident endpoint candidates;
- `center`;
- `arc-midpoint` at `cadArcMidpoint` = start + sweep/2; for B1 that is
  start+180°, an arbitrary rim point with no circle meaning;
- `quadrant` candidates gated by `cadIsAngleOnArcSweep` (all four pass for
  B1/B2; all four pass for B3 via the zero-sweep all-true rule);
- `nearest`.

Executed counts (`runSnapGripB1`,
`tests/cad_circle_study_execution.test.ts`), emitted vs **observable** after
real `dedupeCandidates`:

| level | emitted | observable after dedupe |
|---|---|---|
| entity | `endpoint:2`, `center:1`, `arc-midpoint:1`, `quadrant:4`, `nearest:1` | `endpoint:1`, `center:1`, `arc-midpoint:1`, `quadrant:4`, `nearest:1` |
| block ref | `endpoint:3` | `endpoint:2` |
| grips | 3 (`arc-start`,`arc-end`,`arc-radius`) | **2 coincident `arc-start`/`arc-end` leaked — no grip dedupe** |

Snap dedupe collapses the two coincident endpoints 2→1, but the
`arc-midpoint` stays observable and the grips are not deduped at all. Block
arc refs repeat `endpoint` and `arc-midpoint`
(`cadSpatialBlockSnaps.ts:107+`); the spatial index adds `arc-midpoint`
(`cadSpatialIndex.ts:340,663`); grips add `arc-start`/`arc-end`
(`cadTransactionsEntityTransforms.ts:365-374`). Annotation anchoring derives
kinds from the snapped point (`cadAnnotationAnchorFromCommandPoint.ts`) and
display labels come from `cadEntityNames.ts:141-152`; the dimension/annotation
anchor path (arc-center/arc-endpoint association) is a static code claim with
**no command-level test — UNEXECUTED**.

For a B1 circle every one of those endpoint/midpoint emissions is either a
duplicate or meaningless. Suppressing them means touching the whole snap
subsystem, not one site.

## 3. Circle snap set (candidate A)

A first-class circle emits only: `center`, `quadrant` (0/90/180/270),
`nearest`, `tangent` (2 from an external point, 1 on the rim, 0 inside),
`perpendicular`, `intersection`, `apparent-intersection`. It never emits
`endpoint`, `midpoint`, or `arc-midpoint`, so the invariant holds by
construction. This is the one area where A is unambiguously cleaner than B1.

## 4. Intersection / tangency kernels (sweep-independent)

All results below are pinned in
`tests/cad_circle_study_robust_snap.test.ts` (10/10) and mirrored by the
adapter. Kernels: `cadIntersectCircleCircle`,
`cadIntersectSegmentCircle`, `cadIntersectInfiniteLineCircle`,
`cadTangentPointsFromExternalPointToCircle`, plus `cadClosestPointOnArc`.

| case (center (100,200), r 50) | result |
|---|---|
| horizontal segment/line through center | 2 hits |
| circle-circle secant (other at 160,200 r50) | 2 |
| circle-circle tangent (other at 200,200 r50) | 1 |
| circle-circle disjoint (other at 500,200 r50) | 0 |
| circle-circle concentric (same center r40) | 0 |
| tangents from (190,200) / (150,200) / (105,200) | 2 / 1 / 0 |
| `cadClosestPointOnArc` from outside / from center | (150,200) / (150,200) |

Because the kernels filter candidates with `cadIsAngleOnArcSweep`, B1/B2
(all-true) return the full-circle answer, and B3 (zero-sweep all-true) also
returns the full-circle answer — even though B3's own `arcLength` is 0. That
inconsistency (a zero-length arc that intersects like a full circle) is
another face of B3's ambiguity.

## 5. Robustness

Pinned: origin-centered exact quadrants; radius error at world offsets
`1e6/1e8/1e12` within float tolerance; radius `1e-6` and `1e9` stay finite;
`NaN/Infinity` inputs stay non-finite (never a silent valid point);
`cadClosestPointOnArc` from the center falls back to the nearest rim point
(document for B1: the rim point at the sweep start, `(150,200)`).

## 6. Conclusion

- Intersection and tangency behavior is representation-independent once the
  circle is the full ring: no new kernels are needed for A or B1.
- Snap semantics are the discriminator (executed): B1 emits two coincident
  `endpoint` candidates (one survives snap dedupe) plus an observable
  `arc-midpoint`, and grips leak two coincident `arc-start`/`arc-end`
  (no dedupe); A defines a clean circle snap set.
- B3 additionally intersects like a full circle while measuring zero length —
  further evidence B3 must be rejected.
