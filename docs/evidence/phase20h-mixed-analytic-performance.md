# Phase 20H — mixed-analytic grading groups: performance evidence

Measurement only. No machine-independent timing threshold exists anywhere in
this phase; every figure below is an actual run of the real engine seams.

- Harness: `scripts/phase20hMixedAnalyticPerf.ts`
- Command: `npx tsx scripts/phase20hMixedAnalyticPerf.ts` (use `--quick` for a
  shorter run; the figures below are from full mode)
- Seams exercised: `computeGradingGroupFromSnapshots`, `solveAnalyticCorner`,
  `linearizeGradingArc`; each analytic member goes through
  `resolveAnalyticCriterionAt` inside `analyticTerminalLine`
- Fixture construction (course chains, mixed criterion arrays, arc circle
  params, subdivision plan) is performed **outside** the measured region;
  only the solve is timed.

## Complexity expectation

Same-domain mixing does not add a second kernel: every analytic family
(Distance, Elevation, Relative Elevation) resolves to one terminal limit line
through the shared helper, and each joint is one O(1) line intersection.

| case | expected complexity |
|---|---|
| open mixed group | O(courses) — one O(1) analytic chord per course |
| closed mixed group | O(courses) + one O(1) analytic miter per joint |
| arc-adjacent mixed group | O(sum of per-course subdivisions) |
| valid vs incompatible corner | O(1) either way (failure is a cheap gate) |

## Measured output

```text
# Phase 20H mixed-analytic grading-group performance evidence (measured)

- node v26.8.1; linux x64
- quick mode: false
- heap at start: 10.9 MB
- fixtures: synthetic staircase chains (Z=100), a 100x100 flat pad (Z=10), and a radius-100 quarter arc.
- distribution: mixed open groups cycle Distance / Elevation / Relative Elevation every third course.

> No timing gate exists anywhere in this harness; every figure is an actual run.
> Mixed analytic groups share the Phase 20F kernel: O(1) per straight chord,
> O(subdivisions) per arc, O(courses) members, plus one O(1) analytic miter per joint.

## A. Open groups — homogeneous vs mixed analytic

| courses | variant | compute ms | us/course | verts | tris | corners | outcome | digest |
|---:|---|---:|---:|---:|---:|---:|---|---|
| 4 | homo Relative | 0.17 | 43.142 | 16 | 13 | 3 | ok | e6f1957ef74384a7 |
| 4 | mixed Dist/Elev/Rel | 0.13 | 33.640 | 16 | 13 | 3 | ok | e6f1957ef74384a7 |
| 20 | homo Relative | 0.54 | 27.167 | 77 | 69 | 19 | ok | 915541f83e122a9f |
| 20 | mixed Dist/Elev/Rel | 0.39 | 19.327 | 77 | 69 | 19 | ok | 915541f83e122a9f |
| 100 | homo Relative | 1.73 | 17.275 | 357 | 349 | 99 | ok | 2c6af1a477aed0d4 |
| 100 | mixed Dist/Elev/Rel | 1.06 | 10.614 | 357 | 349 | 99 | ok | 2c6af1a477aed0d4 |
| 1000 | homo Relative | 14.94 | 14.941 | 3507 | 3499 | 999 | ok | 4b135bdbd972b2cc |
| 1000 | mixed Dist/Elev/Rel | 15.42 | 15.418 | 3507 | 3499 | 999 | ok | 4b135bdbd972b2cc |

> Mixed/homogeneous median ratio: 4→0.780x, 20→0.711x, 100→0.614x, 1000→1.032x (report only, no timing gate).

> Fixture construction (course chains + criterion arrays) is outside the timed region.
> The analytic corner cost is linear in the joint count; the mixed kinds share one kernel.

## B. Closed 100x100 pad — mixed vs all-Distance control

| variant | compute ms | plan area | verts | tris | corners | miter extent | outcome | digest |
|---|---:|---:|---:|---:|---:|---|---|---|
| mixed | 0.10 | 9600.000 | 16 | 16 | 4 | 28.284271 | ok | c19236ccc5cf6797 |
| all-Distance | 0.08 | 9600.000 | 16 | 16 | 4 | 28.284271 | ok | c19236ccc5cf6797 |

> Digest equivalence: mixed c19236ccc5cf6797 vs all-Distance c19236ccc5cf6797 (MATCH).
> Dominant stage: closed pad 0.10 ms vs open members-only 0.04 ms → four miters add ~0.06 ms (one O(1) corner each).

## C. Analytic corners — valid tie vs incompatible-Z failure

| case | solve ms | outcome | tie / detail | extent |
|---|---:|---|---|---|
| valid Dist x Rel | 0.00 | ok | (40,-20,90) | 44.721360 |
| incompatible Dist x Rel (−12) | 0.00 | fail | GRADING_ANALYTIC_CORNER_Z | — |

> The incompatible-Z corner is rejected by the shared Z gate before any patch geometry.

## D. Arc-adjacent group — mixed vs homogeneous

| variant | tolerance | subdivisions | compute ms | accuracy | verts | tris | outcome | digest |
|---|---:|---:|---:|---|---:|---:|---|---|
| homo Distance | 1 | 6 | 0.08 | CURVE_APPROXIMATED | 26 | 23 | ok | c7c743c3ca9ab238 |
| mixed Elev x Rel | 1 | 6 | 0.07 | CURVE_APPROXIMATED | 26 | 23 | ok | c7c743c3ca9ab238 |
| · | · | · | ratio mixed/homo 0.887x | · | · | · | · | · |
| homo Distance | 0.1 | 18 | 0.15 | CURVE_APPROXIMATED | 61 | 57 | ok | ea627c7af3019126 |
| mixed Elev x Rel | 0.1 | 18 | 0.16 | CURVE_APPROXIMATED | 61 | 57 | ok | ea627c7af3019126 |
| · | · | · | ratio mixed/homo 1.082x | · | · | · | · | · |
| homo Distance | 0.01 | 56 | 0.36 | CURVE_APPROXIMATED | 175 | 171 | ok | a7184b31ba6f15c2 |
| mixed Elev x Rel | 0.01 | 56 | 0.30 | CURVE_APPROXIMATED | 175 | 171 | ok | a7184b31ba6f15c2 |
| · | · | · | ratio mixed/homo 0.844x | · | · | · | · | · |

> Dominant stage is arc linearization (subdivision count); the mixed kinds share one per-chord solve.

## E. Deterministic repeats (byte-digest stability)

| case | repeats | unique digests | first digest |
|---|---:|---:|---|
| 20-course mixed open group | 15 | 1 | 3bb50332296290c9 |
| closed mixed pad | 15 | 1 | 7e5ae4887d2ece3d |

> One unique digest per case proves the solve is a pure function of its inputs.

- heap at end: 56.0 MB

DONE (exit 0)
```

> Fixtures are synthetic and deterministic (staircase chains at Z=100, a
> 100x100 flat pad at Z=10, a radius-100 quarter arc); no timing gate exists.
> Mixed open groups match the homogeneous Relative Elevation digests exactly
> because all three kinds derive d = 20 with limit Z = sourceZ − 10 on a
> flat source — the mixed cost is kernel-identical to the homogeneous cost.
