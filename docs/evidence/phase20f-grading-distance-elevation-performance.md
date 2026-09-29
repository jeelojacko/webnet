# Phase 20F — target-free grading performance evidence (measured)

Script: `scripts/phase20fGradingPerf.ts` (no `src/` modification).
Branch: `feat/cad-grading-distance-elevation`.

```
npx tsx scripts/phase20fGradingPerf.ts            # full: 4/20/100/1000 courses
npx tsx scripts/phase20fGradingPerf.ts --quick    # smoke: 4/20/100 courses, 2000-tri control
```

Full run on this machine: **wall ≈ 3.8 s, exit 0** (heap 13 MB → 24 MB).
Repetitions: median of 5 timed reps at small sizes, 3 at 1000 (the repetition
loop warms the stage). **No timing gate exists anywhere in the harness**; every
figure is an actual run.

Environment (measured run):
- Hardware: AMD Ryzen 7 5800X3D, 16 logical CPUs, 31 GB RAM.
- OS / runtime: `linux 7.2.7-1-cachyos` (x86_64), node `v26.8.1`.

Honesty notes:
- All fixtures are deterministic synthetic geometry; nothing is extrapolated.
- `uts/course` is compute ms × 1000 / courses, recorded verbatim (warm JIT at
  the small sizes makes the 4-course figure the noisiest).
- Group distance modes use a level source (`gradeRatio 0`) so adjacent varying
  offsets resolve an honest miter; a nonzero along-course grade with differing
  adjacent offsets fails closed by design (`GRADING_ANALYTIC_CORNER_Z`).
- Section 3 is the no-regression control: the legacy fixed-criterion surface
  path on the same staircase members and a coarse flat TIN.

---

## 1. Standalone analytic solves

Straight cases measured through `solveAnalyticGradingChord` (chord µs) and
`computeGradingFromSnapshots` (strip mesh); arc cases are one curved course
`R = 100`, 90° sweep, tolerance coarse/med/fine.

| case | chord µs | compute ms | verts | tris | subdivisions | accuracy |
|---|---:|---:|---:|---:|---:|---|
| distance level | 11.8 | 0.04 | 4 | 2 | 1 | EXACT |
| distance sloped | 2.8 | 0.02 | 4 | 2 | 1 | EXACT |
| elevation | 3.1 | 0.02 | 4 | 2 | 1 | EXACT |
| large coords | 2.8 | 0.01 | 4 | 2 | 1 | EXACT |
| arc tol = 1 | 3.0 | 0.08 | 21 | 19 | 6 | CURVE_APPROXIMATED |
| arc tol = 0.1 | 3.0 | 0.18 | 56 | 53 | 18 | CURVE_APPROXIMATED |
| arc tol = 0.01 | 2.7 | 0.37 | 170 | 167 | 56 | CURVE_APPROXIMATED |

The analytic chord solve is O(1) (two endpoints, no target query) and
coordinate-magnitude independent; arc cost is linear in the linearizer's
subdivisions.

## 2. Analytic groups — courses × mode

Open 40 m-step staircase, `maxSearchDistance = 50`; `resolve µs` is the sparse
override map (`resolveGroupMemberCriteria`), `compute ms` the full group solve.
Modes: `same-width` (`D = 20`), `varying` (`D` cycles 15/20/25), `elevation`
(`E = 0, g = −0.5`), `overrides` (default `D = 20`, every 4th course `D = 30`).

| courses | mode | resolve µs | compute ms | µs/course | verts | tris | corners | outcome |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 4 | same-width | 7.6 | 0.26 | 64.1 | 16 | 13 | 3 | ok |
| 4 | varying | 3.7 | 0.12 | 31.1 | 15 | 13 | 3 | ok |
| 4 | elevation | 1.6 | 0.11 | 26.7 | 16 | 13 | 3 | ok |
| 4 | overrides | 1.8 | 0.12 | 29.0 | 16 | 13 | 3 | ok |
| 20 | same-width | 6.9 | 0.44 | 22.0 | 77 | 69 | 19 | ok |
| 20 | varying | 7.9 | 0.38 | 19.2 | 73 | 69 | 19 | ok |
| 20 | elevation | 6.1 | 0.32 | 16.1 | 80 | 69 | 19 | ok |
| 20 | overrides | 5.3 | 0.29 | 14.3 | 78 | 69 | 19 | ok |
| 100 | same-width | 17.3 | 1.45 | 14.5 | 357 | 349 | 99 | ok |
| 100 | varying | 25.0 | 1.21 | 12.1 | 354 | 349 | 99 | ok |
| 100 | elevation | 17.6 | 1.01 | 10.1 | 400 | 349 | 99 | ok |
| 100 | overrides | 25.8 | 0.97 | 9.7 | 360 | 349 | 99 | ok |
| 1000 | same-width | 197.5 | 14.62 | 14.6 | 3507 | 3499 | 999 | ok |
| 1000 | varying | 293.4 | 14.60 | 14.6 | 3504 | 3499 | 999 | ok |
| 1000 | elevation | 201.8 | 9.26 | 9.3 | 3949 | 3499 | 999 | ok |
| 1000 | overrides | 230.4 | 8.69 | 8.7 | 3510 | 3499 | 999 | ok |

Compute scales ~linearly in courses (≈ 14.6 ms per 1000 courses; 4-course
warm-up figures are JIT noise). Vert/tri/corner counts match the strip mesh
plus one corner patch per interior joint.

## 3. Surface group control (no-regression)

Same staircase members, legacy fixed criterion (`g = −0.5`,
`maxSearchDistance = 15`) against a 4000-triangle flat grid TIN. This is a
control for the unchanged surface path, not a Phase 20F feature.

| courses | compute ms | µs/course | verts | tris | corners | outcome |
|---:|---:|---:|---:|---:|---:|---|
| 4 | 17.59 | 4397 | 21 | 18 | 3 | ok |
| 20 | 57.43 | 2871 | 104 | 93 | 19 | ok |
| 100 | 579.1 | 5791 | 518 | 467 | 99 | ok |

Surface cost is dominated by the TIN tie/corner walk (~5.8 ms/course at 100
courses); analytic groups on the same geometry are ~1.4 ms/course at 1000
courses (two orders of magnitude cheaper per course beyond the small-size
crossover), confirming the target-free path removes the target-index and tie
work rather than adding overhead.
