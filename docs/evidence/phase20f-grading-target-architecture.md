# Phase 20F — grading target architecture (Grade-to-Distance / Grade-to-Elevation)

Branch: `feat/cad-grading-distance-elevation`.
Status: implemented in the working tree (uncommitted), validated by the
20F analytic/persistence/oracle/group suites and the perf harness.

This document describes the target-free criterion model: the criterion
union, its closed-form equations, non-surface semantics, group rules,
analytic corners, design patches, transform/persistence behavior, exports,
and explicit deferrals. Existing fixed/cut-fill behavior and bytes are
unchanged.

## 1. Criterion model

`GradingCriterion` (`src/engine/cad/grading/gradingTypes.ts`) gained two
additive variants; the legacy surface variants are byte-identical:

```ts
type GradingCriterion =
  | { kind: 'fixed'; gradeRatio: number }                                     // surface
  | { kind: 'cut-fill'; cutGradeRatio: number; fillGradeRatio: number }       // surface
  | { kind: 'distance'; gradeRatio: number; distance: number }               // analytic
  | { kind: 'elevation'; gradeRatio: number; targetElevation: number };      // analytic
```

Termination helpers are the single classification authority:

- `gradingTerminationKind(criterion)` → `'surface' | 'distance' | 'elevation'`.
- `gradingCriterionRequiresSurface(criterion)` → true for fixed/cut-fill.
- `isTargetFreeCriterion(criterion)` → true for distance/elevation.
- `gradingBoundaryLabel` → `'Daylight'` (surface) / `'Grading Limit'` (analytic);
  `gradingBoundaryShortLabel` → `'Daylight'` / `'Limit'`.

Validation (`validateGradingCriterion`, `sanitizeCadGradings`,
`sanitizeCadGradingGroups`) fail-closed rejects: non-finite grade, distance
`<= 0` or non-finite, elevation grade machine-zero (`abs(g) < Number.MIN_VALUE`,
never a survey tolerance), non-finite target elevation. A `distance`/
`elevation` definition never mints a `targetSurfaceId`; a dormant retained id
is ignored by resolve/revision/status.

## 2. Equations

A source course is resolved A→B (`ResolvedGradingSource`); `N` is the grading
normal for the chosen side, `T` the unit tangent, `gs` the along-course grade
`(endZ − startZ)/length`. With chord station `u ∈ [0, length]`:

- Source: `P(u) = start + T·u`, `Zsrc(u) = startZ + gs·u`.
- Termination: `Q(u) = P(u) + d(u)·N`, `Z(u) = Zsrc(u) + g·d(u)`.

| criterion | `d(u)` | limit |
|---|---|---|
| `distance(gradeRatio g, distance D)` | constant `D` | `Z = Zsrc + g·D` |
| `elevation(gradeRatio g, targetElevation E)` | `(E − Zsrc(u)) / g` | `Z = E` |

Both are constant or linear in `u` on a straight chord, so solving the two
endpoints is exact for the whole segment (no sampling). `solveAnalyticGradingChord`
implements exactly this and is the only analytic kernel.

Fail-closed gates:

- `distance` beyond `maxSearchDistance` → `MAX_DISTANCE_REACHED`
  (`GRADING_DISTANCE_BEYOND_SEARCH`) — never clamped.
- `elevation` with a non-positive `d` at either endpoint (target below source
  with a positive grade, or the reverse) → `NO_SOLUTION`
  (`GRADING_ELEVATION_WRONG_DIRECTION`).
- `elevation` beyond `maxSearchDistance` → `MAX_DISTANCE_REACHED`
  (`GRADING_ELEVATION_BEYOND_SEARCH`).
- source/normal/search degenerate → `NO_SOLUTION`.

## 3. Non-surface semantics

`computeGradingFromSnapshots` / `solveArcGrading` detect a target-free
criterion and never build a target query (no TIN, no candidate index, no
intersection walk, no daylight/target agreement gate). The assembled result
(`assembleAnalyticGradingResult`) keeps the shared `CadGradingResult` shape:

- `accuracy: 'EXACT'` on straight sources, `'CURVE_APPROXIMATED'` on arcs.
- one `FIXED` region spanning the solved chord; diagnostics from the solve
  (empty on a valid strip, `ALREADY_TIED` only when the strip mesh is
  zero-width).
- `candidateTriangleCount = 0`, `intersectionSegmentCount = 0`,
  `multipleSolutionCount = 0`.
- `gradingPlanArea` / `grading3dArea` / projection-distance stats are real
  (computed from the strip mesh); source/target relation lengths
  `cutSourceLength` / `fillSourceLength` / `tiedSourceLength` read `0/0/0`
  because a target-free solve has no honest way to partition source length
  against a surface — the values are never faked from the strip.
- `validateGradingSourceBoundary` is the only agreement gate on the analytic
  path (source boundary must equal the Feature Line at the same stations);
  `validateGradingResultAgainstTarget` still applies its source-boundary half
  before the daylight/target half for surface criteria.

## 4. Exact vs approximated

- Straight source → one chord, `EXACT`, two limit points.
- Arc source → `linearizeGradingArc` samples the *exact* arc at
  `featureLineArcSubdivisions(radius, sweep, curveChordTolerance)` (sagitta
  bound `r·(1 − cos(sweep/2n))`), each chord solved analytically, stitched at
  seam-equal endpoints; `CURVE_APPROXIMATED`. The source discretization lies on
  the true arc; the limit is the chord-wise parallel offset, which converges
  monotonically to the concentric offset `R ± D` as tolerance shrinks.
- `solveGradingChord` is a thin dispatcher: target-free → analytic kernel;
  fixed/cut-fill → the unchanged exact straight-chord surface solver
  (`GRADING_BAD_TARGET_MESH` when target/query are absent).

## 5. Group rules

- **One termination family per group.** `validateGroupTerminationCriteria`
  (engine) checks the group default plus every effective member criterion and
  returns a named authoring error on any mix; authoring
  (`createGroupDefinition` / `editGroupCriteria` / `setCourseCriteriaOverrides`)
  applies the same gate. Surface families may still mix fixed and cut-fill.
- **No target needed for analytic families.** `resolveGroupInputs` /
  `resolveGroupInputsWithReason` compute `requiresSurface` from the default and
  overrides; analytic groups resolve with `target`/`targetRevision` absent and
  never report `BROKEN_REFERENCE` for a dormant id.
- **Revision contract.** `buildGroupRevision` hashes byte-identically with and
  without a dormant `targetSurfaceId` for analytic criteria, and still hashes
  the target for surface families.
- **Sparse overrides.** Per-course analytic overrides stay sparse records;
  `criteriaEqual` compares exact numeric inputs (distance, targetElevation)
  with no tolerance, so reset removes the record only on an exact match.
- **Member solves.** Members linearize (straight = 1 chord, arc = sagitta
  samples) and each chord solve is analytic; corners resolve through the
  analytic corner solver below. Source/target cut/fill lengths are not
  accumulated for target-free members.

## 6. Analytic corners

`solveAnalyticCorner` (`gradingGroupAnalyticCorners.ts`) intersects the two
terminal limit lines of the joint vertex `V`:

- `distance` → line through `V + D·N`, direction `T`, Z slope `gs`.
- `elevation` → constant-Z line at `E`, XY direction `T − (gs/g)·N`
  (the source plane's intersection with `Z = E`).

Outcomes:

- `coincident` — the two lines are the same XY line and agree in Z: the joint
  needs no patch.
- `miter` — verified intersection: must lie on BOTH grading-side half-planes,
  agree in Z within the shared `zeroDelta` floor, and stay within
  `miterExtent(ray, N_in, N_out, maxSearchDistance)`.

Fail-closed details (group code `CORNER_NO_SOLUTION`):
`GRADING_ANALYTIC_CORNER_LINE`, `..._PARALLEL`, `..._Z` (adjacent offsets with
a nonzero along-course grade), `..._SIDE`, `..._DEGENERATE`, `..._MAX`.
No averaging, no bridging walls, no elevation interpolation, no boolean repair.
GAP corners fan the wedge from `V` across the limit tie on the two exact
planes; OVERLAP corners trim both strips and locators to the miter line so the
overlap is tiled once; every failure fails the whole group closed with the
joint index in `cornerIndex`.

## 7. Design patch

`resolveDesignPatch` accepts an analytic group result without a target. The
patch provenance carries `targetKind: 'distance' | 'elevation'` plus
`criterionDistance` / `targetElevation` and omits `targetSurfaceId`; the pad Z
follows the same constant-Z limit the group produced (e.g. flat Z=10 pad for
a level distance group).

## 8. Project transform

`scaleCadGrading` / `scaleCadGradingGroup` (`cadProjectTransformGrading.ts`)
scale only horizontal lengths by the orientation-preserving similarity factor:
`maxSearchDistance`, `curveChordTolerance`, and `criterion.distance`.
`gradeRatio`, `cutGradeRatio`/`fillGradeRatio`, `targetElevation`, `side`, and
every Z are invariant. Sparse overrides map one-for-one (no materialized
defaults); a dormant `targetSurfaceId` is never minted, cleared, or rebound.
The selection-scoped GRIDGROUND pass-through contract is unchanged.

## 9. Persistence

- Definitions persist; derived results never do. A distance/elevation
  definition is written with NO `targetSurfaceId` key and no placeholder id;
  `cloneCadGrading` preserves key order and omits the absent key.
- Legacy byte-preservation: legacy surface definitions keep their
  `targetSurfaceId` key and bytes exactly (no injected `targetKind`).
- Sanitizers drop malformed analytic definitions and still require a target
  for fixed/cut-fill. Kind switches add/clear the target in ONE undo entry.
- Bake provenance (`webnet-grading-bake`, `-group-bake`, `-design-patch`) is
  read-tolerant: a missing `targetKind` normalizes to `surface` and the legacy
  revision string is byte-frozen; analytic legs hash as
  `distance:<D>` / `elevation:<E>`.

## 10. Exports and commands

- Boundary polyline wording is `Grading Limit` / `Limit` for analytic
  definitions; `Daylight` remains for surface criteria.
- New registry commands: `GRADETODISTANCE` (alias `GTD`) and
  `GRADETOELEVATION` (alias `GTE`) open the manager create form with the
  method preselected; no target surface is ever requested.

## 11. Deferrals

- Mixed-family groups (surface + analytic in one group) stay fail-closed.
- Analytic corner interpolation across differing adjacent offsets with a
  nonzero along-course grade fails closed rather than inventing a seam.
- Curved closed analytic pads keep the same arc-sampling and fail-closed
  corner rules as the surface group path; no new arc-corner boolean repair.
- No new persisted `targetKind` field on the definition itself (only bake
  provenance carries it).
