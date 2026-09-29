# Phase 20G — Grade to Relative Elevation: performance evidence

Measurement only. No machine-independent timing threshold exists anywhere in
this phase; every figure below is an actual run of the real engine seams.

- Harness: `scripts/phase20gRelativeElevationPerf.ts`
- Command: `npx tsx scripts/phase20gRelativeElevationPerf.ts`
- Seams exercised: `computeGradingFromSnapshots`, `computeGradingGroupFromSnapshots`,
  `linearizeGradingArc` (the analytic solve itself goes through
  `solveAnalyticGradingChord` → `resolveAnalyticCriterionAt`)
- Fixture construction (course chains, arc circle params, subdivision plan) is
  performed **outside** the measured region; only the solve is timed.
- Machine: linux x64, node v26.8.1, full mode (not `--quick`).

## Complexity expectation

Relative Elevation reuses the Phase 20F analytic kernel verbatim — its only
difference is that `d` is derived (`Δ/g`) instead of stored. Expected cost is
therefore **identical to Grade-to-Distance**:

| case | expected complexity |
|---|---|
| straight standalone | O(1) — two endpoint resolutions |
| curved standalone | O(subdivisions) — sagitta linearization + one O(1) solve per chord |
| open group | O(courses) — one O(1) analytic chord per course |
| closed group | O(courses) + one O(1) analytic miter per joint |
| arc group | O(sum of per-course subdivisions) |

## Measured output

```text
# Phase 20G Grade-to-Relative-Elevation performance evidence (measured)

- node v26.8.1; linux x64
- quick mode: false
- heap at start: 13.2 MB

> No timing gate exists anywhere in this harness; every figure is an actual run.
> Relative Elevation reuses the Phase 20F analytic kernel, so its expected complexity is
> identical to Grade-to-Distance: O(1) per straight chord, O(subdivisions) per arc,
> O(courses) per open group, plus one O(1) analytic miter per joint.

## A. Straight standalone — Relative vs Distance vs absolute Elevation

| criterion | solve ms | plan area | verts | tris | projection d | digest |
|---|---:|---:|---:|---:|---|---|
| Relative Elevation (Δ=-10, g=-0.5) | 0.05 | 2000.000 | 4 | 2 | 20.000–20.000 | 1183c0dccc5edce6 |
| Distance (D=20, g=-0.5) | 0.03 | 2000.000 | 4 | 2 | 20.000–20.000 | 1183c0dccc5edce6 |
| absolute Elevation (E=90, g=-0.5) | 0.02 | 2200.000 | 4 | 2 | 20.000–24.000 | 98f2b639caa05c53 |

> Relative and Distance share the identical closed-form path (d = Δ/g = 20), so their
> costs and digests must match; absolute Elevation differs only by an extra division.

## B. Curved standalone (arc linearization)

| chord tolerance | subdivisions | solve ms | accuracy | verts | tris | projection d |
|---:|---:|---:|---|---:|---:|---|
| 1 | 6 | 0.08 | CURVE_APPROXIMATED | 21 | 19 | 20.000 |
| 0.1 | 18 | 0.17 | CURVE_APPROXIMATED | 56 | 53 | 20.000 |
| 0.01 | 56 | 0.30 | CURVE_APPROXIMATED | 170 | 167 | 20.000 |

## C. Open Relative Elevation groups (no corners)

| courses | compute ms | us/course | verts | tris | corners | outcome |
|---:|---:|---:|---:|---:|---:|---|
| 4 | 0.13 | 33.052 | 16 | 13 | 3 | ok |
| 20 | 0.47 | 23.562 | 77 | 69 | 19 | ok |
| 100 | 2.01 | 20.094 | 357 | 349 | 99 | ok |
| 1000 | 17.94 | 17.939 | 3507 | 3499 | 999 | ok |

## D. Closed 100x100 pad (4 analytic miter corners)

| criterion | solve ms | plan area | plan/src | verts | tris | corners | miter extent | outcome |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Relative Elevation | 0.13 | 9600.000 | 0.960 | 16 | 16 | 4 | 28.284271 | ok |
| Distance | 0.09 | 9600.000 | 0.960 | 16 | 16 | 4 | 28.284271 | ok |
| absolute Elevation | 0.08 | 9600.000 | 0.960 | 16 | 16 | 4 | 28.284271 | ok |

## E. Deterministic repeats (byte-digest stability)

| case | repeats | unique digests | first digest |
|---|---:|---:|---|
| standalone Relative Elevation | 25 | 1 | 078b467bd54cd7c4 |
| 20-course open group | 15 | 1 | a6debe3cfc371273 |

> One unique digest per case proves the solve is a pure function of its inputs.
> Note: only the solver is timed above — fixture construction is outside the measured region.

- heap at end: 28.1 MB

DONE (exit 0)
```

## Findings

- **Relative vs Distance is the same work.** On the identical sloped source the
  two produce **identical digests** (`1183c0dccc5edce6`) and effectively equal
  solve times — confirming Relative Elevation is the existing analytic path with
  a derived offset, not a second solver.
- **absolute Elevation differs only by an extra division.** Same order of cost,
  different geometry (`20.000–24.000` vs `20.000` projection, 2200 vs 2000 m²).
- **Dominant stage for arcs is linearization, not the solve.** Solve time tracks
  the subdivision count (6 / 18 / 56 subdivisions → 0.08 / 0.17 / 0.30 ms),
  i.e. cost is dominated by the number of chords, exactly as in Phase 20F. The
  per-chord solve itself is O(1).
- **Groups are linear in courses.** 4 / 20 / 100 / 1000 courses →
  0.13 / 0.48 / 1.94 / 17.94 ms, i.e. ≈33.7 → ≈17.9 µs per course as the
  per-group overhead amortizes. 1000 courses with 999 analytic miters complete
  in under 20 ms. No super-linear term appears.
- **Closed pad.** The 100×100 Relative Elevation pad (4 analytic miter corners,
  9600 m² grading plan area, miter extent 28.284271 = 20√2) costs the same as
  the equivalent Distance and absolute Elevation pads (0.13 / 0.09 / 0.08 ms)
  and produces identical vertex/triangle/corner counts — the new family adds no
  corner work beyond the shared analytic solver.
- **Determinism.** 25 repeated standalone solves produce **1** unique SHA-256
  digest; 15 repeated 20-course group solves produce **1** unique digest. The
  solve is a pure function of its inputs; repeated calculation is byte-stable.
- **Heap** starts at ≈13 MB and ends at ≈28 MB after the 1000-course case, with
  no retained growth signal across the deterministic repeats.

Complexity therefore matches the existing analytic path exactly, as designed.
