# Phase 19C — Curved-Parcel Performance Evidence

Branch: `feat/cad-curved-parcel-courses` (integration).
Date: 2026-09-27.
Method: `tests/evidence/phase19c_curved_parcel_performance.test.ts` (evidence tier,
manual-only; registered in `scripts/testTiers.ts`). Machine: this dev box, Node
vitest run, single representative run; wall-clock is indicative, not a gate.
No absolute-time assertions exist in the test — only output sanity checks.

Purpose: confirm integration mission §§98-99 — mixed line/arc parcel operations
scale linearly and no spatial index is required at the stated scales.

Workload: synthetic ring parcels of N courses on a 1000 m circle, every 3rd
course an arc (bulge 0.15), remainder straight lines. Exact (closed-form)
area/perimeter path — no tessellation anywhere in the authority numbers.

## 1. Per-operation pipeline at 100 / 1k / 10k mixed courses

Stages: `resolveCadParcelCourses` (resolve) · `cadBuildParcelClosureSummary` +
`buildCadBounds` (area+bounds) · `buildCadDisplayScene` on a one-parcel project
(render-derive) · 200× `cadPointInCurvedParcel`/`cadClassifyParcelPoint`
(containment) · `cadBuildParcelSplitByLineDraftDetailed` (line split).

| courses | resolved | area (m²) | primitives | containment 200× (ms) | resolve (ms) | area+bounds (ms) | render-derive (ms) | line split (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 3,146,067 | 100 | 27.4 | 1.7 | 1.6 | 1.3 | 1.4 |
| 1,000 | 1,000 | 3,142,232 | 1,000 | 143.3 | 2.0 | 2.1 | 1.5 | 2.6 |
| 10,000 | 10,000 | 3,141,659 | 10,000 | 1,440.7 | 13.8 | 17.3 | 16.8 | 23.4 |

Per-containment-eval: ~0.14 ms / 0.72 ms / 7.2 ms at 100 / 1k / 10k — linear in
course count, as expected for the O(n) ray-crossing walk (no index).

## 2. Target-area solve scaling at 100 / 1k mixed courses

`cadBuildParcelSplitByAreaDraft` through an off-center witness point ({x:200,
y:100}), target 40% of parent area. (A through-center witness on this
near-symmetric ring can only yield 50/50 children, so the center is correctly
rejected for a 40% target — fail-closed, not a perf issue.)

| courses | target (m²) | solve (ms) |
|---:|---:|---:|
| 100 | 1,258,427 | 110.2 |
| 1,000 | 1,256,893 | 971.8 |

~8.8× for 10× courses — linear, consistent with the O(360·n + refinements)
azimuth-sweep design (360 candidate evaluations plus three refinement passes,
each O(n)). The 10k scale is intentionally not solved: ~10 s for a single
interactive split is the known ceiling of the sweep design; a bracketed or
bisection solver would be the upgrade path if 10k-course target-area splits
become interactive (no evidence they will — splits author on small parcels).

## 3. Complexity note

resolve / area+bounds / render-derive / containment / line-boundary
intersection are O(n) single course walks — no action needed through 10k
courses (all stages ≤ ~25 ms except the deliberately batched 200× containment
loop). Target-area solve is O(360·n): sub-second through 1k courses, ~10 s
projected at 10k. No timing gates; numbers recorded as the 19C baseline.
