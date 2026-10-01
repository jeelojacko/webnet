# Phase 20K.2 — topology/product performance

Measurement only. No thresholds. Raw output:
`docs/evidence/phase20k2/perf-output.txt`. Harness:
`scripts/phase20k2TopologyProductPerf.ts` (run via
`npx tsx scripts/phase20k2TopologyProductPerf.ts [--quick]`).

Fixtures are built once, outside every timed region. Each stage times the
actual production entry point; `totalMs` is the median of 5 reps. Machine
observed 2026-10-01 (full run).

## 1. Boundary-cycle analysis by boundary size (`traceBoundaryCycles`)

| boundaryEdges | components | cycles | violations | ms |
|---|---|---|---|---|
| 16 | 1 | 1 | 0 | 0.005 |
| 64 | 1 | 1 | 0 | 0.014 |
| 256 | 1 | 1 | 0 | 0.058 |
| 1024 | 1 | 1 | 0 | 0.245 |
| 4096 | 1 | 1 | 0 | 1.071 |
| 16384 | 1 | 1 | 0 | 7.190 |

Linear in the boundary size (≈0.44 µs/edge at 16k), no super-linear blow-up.
The production geometric boundary scan is `O(B^2)`, but only over incidence-1
boundary edges; the `O(F^2)` non-adjacent face-overlap audit is test-only.

## 2. Certificate build / verify (`gtop1`)

| mesh | V | F | E | B | components | cycles | build/verify/product ms | digest |
|---|---|---|---|---|---|---|---|---|
| square.all-Distance | 128 | 128 | 256 | 128 | 1 | 2 | 0.962 / 0.978 / 0.950 | `47c81e90` |
| square.all-Surface | 156 | 156 | 312 | 156 | 1 | 2 | 0.568 / 0.559 / 0.582 | `8cee46d2` |
| square.mixed-analytic | 128 | 128 | 256 | 128 | 1 | 2 | 0.467 / 0.453 / 0.446 | `47c81e90` |
| tied-split.arc | 15 | 7 | 16 | 11 | 2 | 2 | — / 0.026 / 0.025 | `498d7ce3` |

Certificate build is sub-millisecond on the rounded-square shells; verify
(`gradingTopologyCertificateError`) and the product bound
(`gradingTopologyCertificateProductError`) are the same order. The tied-split
certificate records `components = 2`, `boundaryCycles = 2`, and its product
gate returns `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE` (section 3).
`E` and `B` are computed from the mesh; `components` is the edge-connected
face count and `cycles` is the traversed boundary-cycle count — they are not
the same number (the square shell is an annulus: 1 component, 2 cycles).

## 3. Tied-split validation (real Surface arc tied split)

| fixture | V | F | E | B | components | cycles | facets | ms | gate |
|---|---|---|---|---|---|---|---|---|---|
| standalone.surface.arc.tied | 15 | 7 | 16 | 11 | 2 | 2 | 270 | 7.507 | verify=ok, product=`GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE` |

The whole-call production compute (7.51 ms) dominates; certificate
revalidation on the cached result is ~0.026 ms (section 2). `facets` = the
result's `candidateTriangleCount` (target triangles considered) = 270.
Tolerance 0.5 (4 chords).

## 4. Rounded squares (closed group compute)

| fixture | V | F | E | B | components | cycles | facets | ms | digest |
|---|---|---|---|---|---|---|---|---|---|
| all-Distance | 128 | 128 | 256 | 128 | 1 | 2 | 0 | 2.975 | `47c81e90` |
| all-Surface | 156 | 156 | 312 | 156 | 1 | 2 | 2 | 5.154 | `8cee46d2` |
| mixed-analytic | 128 | 128 | 256 | 128 | 1 | 2 | 0 | 2.633 | `47c81e90` |

all-Distance and mixed-analytic produce byte-identical meshes (same digest);
all-Surface is ~1.8× the time and carries 28 more vertices/faces because the
Surface seam resamples each station (the ulp-twin representation), which is
also why its Design Patch stays restricted (section 5). Analytic groups report
`facets = 0` (no target query). Tolerance 0.1.

## 5. Curved Design Patch (`resolveDesignPatch`)

| fixture | V | F | ms | result |
|---|---|---|---|---|
| all-Distance | 128 | 128 | 1.784 | `ok` |
| all-Surface | 156 | 156 | 0.563 | `DESIGN_PATCH_NON_SIMPLE_RING:SURFACE_EDIT_NOT_APPLICABLE` |

Both are sub-2 ms. The all-Surface failure is fast because it fails at the
interior ear-clip, before any merge; the all-Distance success includes the
pad build and merge.

## 6. Coplanar CUT/FILL walk

| fixture | V | F | E | B | components | cycles | facets | ms | result |
|---|---|---|---|---|---|---|---|---|---|
| directFan.coplanar | — | — | — | — | — | — | — | 0.034 | accepted |
| curved.cutfill.cross | 181 | 177 | 356 | 181 | 2 | 2 | 520 | 32.798 | CUT + FILL |

`directFanOnTarget` is ~0.034 ms; the curved CUT/FILL tilted-cross integration
is 32.8 ms (worst case here) because the arc is linearized and the daylight
walk queries the target per chord. `facets = 520` candidate triangles; the
tied station splits the result into 2 components / 2 cycles.

## 7. Non-planar fail path

| fixture | ms | result |
|---|---|---|
| directFan.ridge | 0.007 | rejected (fail-closed) |

The ridge bridge is rejected in ~7 µs — the fan gate fails on the first
out-of-plane sample, before any geometry is built.

## 8. Summary

- **heap**: `heapUsed = 77.0 MB`, `rss = 207.1 MB` at end of run.
- **dominant stage**: the whole-call production compute (seam / merge /
  certificate are internal to it). Certificate build and verify are the bounded
  post-assembly stages at sub-millisecond cost; the boundary-cycle trace is
  linear in boundary size; the CUT/FILL target walk dominates only the curved
  CUT/FILL fixture.
- **no thresholds**: nothing here gates CI. These numbers record the 20K.2
  cost surface so a future change has a baseline to compare against.

## 9. Provenance

- `scripts/phase20k2TopologyProductPerf.ts`.
- `docs/evidence/phase20k2/perf-output.txt` (raw).
