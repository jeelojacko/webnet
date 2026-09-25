# Phase 18T — surface point/elevation edit performance

Scope: the Phase 18T point-edit kernels (`cadSurfaceEditPointAdd.ts`,
`cadSurfaceEditPointModify.ts`) replayed through the Phase 18S chokepoint in
`buildCadSurface`, measured end-to-end and by phase. **Evidence only — there
is no CI millisecond gate.** The agent-tier 10k pin lives in
`tests/cad_surface_point_edits_perf_18t.test.ts`; the 50k/100k campaign is
the manual-only `tests/evidence/phase18t_point_edit_perf.test.ts`
(`npm run test:evidence`).

## Methodology

- Synthetic `side × side` planar grids generated in-process (see
  `tests/cadSurfacePointEdits18tPerf.ts`). "10k" = side 100 (10,000 verts /
  19,602 tris), "50k" = side 224 (50,176 / 99,458), "100k" = side 317
  (100,489 / 199,712).
- Five stacks: `set1000` (1000 set-elevation), `move100` (100 moves),
  `delete100` (100 interior deletes), `add100` (100 interior adds), and
  `mixed1000` (400 set-elevation + 200 move + 200 delete + 200 add).
  Edits are spaced so local ops never share a triangle.
- `replay` = `replaySurfaceEdits(edits, baselineMesh)` — replay + compact +
  adjacency/topology. `grid/stats` = `buildSurfaceGrid` +
  `computeSurfaceFaceStats` on the replayed mesh. `total` =
  `buildCadSurface(project, surfaceWithEdits)` (source + Delaunay + synthetic
  tail + replay + bounds/stats/grid).
- `performance.now()`, one warm run per size; numbers are
  same-order-of-magnitude across runs. Machine class: Linux, Node 26.

## 10k vertices — baseline build 215.6 ms

| stack | edits | replay | grid/stats | total |
| --- | ---: | ---: | ---: | ---: |
| set1000 | 1000 | 53.3 ms | 7.8 ms | 188.1 ms |
| move100 | 100 | 748.1 ms | 6.4 ms | 945.0 ms |
| delete100 | 100 | 47.7 ms | 7.4 ms | 202.4 ms |
| add100 | 100 | 123.1 ms | 5.4 ms | 288.4 ms |
| mixed1000 | 1000 | 1611.8 ms | 5.4 ms | 1956.2 ms |

## 50k vertices — baseline build 720.2 ms

| stack | edits | replay | grid/stats | total |
| --- | ---: | ---: | ---: | ---: |
| set1000 | 1000 | 384.9 ms | 26.0 ms | 1137.4 ms |
| move100 | 100 | 3992.2 ms | 20.8 ms | 4889.2 ms |
| delete100 | 100 | 318.0 ms | 22.0 ms | 1073.7 ms |
| add100 | 100 | 797.3 ms | 20.5 ms | 1754.9 ms |
| mixed1000 | 1000 | 8561.7 ms | 20.6 ms | 9349.8 ms |

## 100k vertices — baseline build 1907.4 ms

| stack | edits | replay | grid/stats | total |
| --- | ---: | ---: | ---: | ---: |
| set1000 | 1000 | 543.4 ms | 35.8 ms | 2062.5 ms |
| move100 | 100 | 8038.4 ms | 35.4 ms | 9722.2 ms |
| delete100 | 100 | 789.9 ms | 38.1 ms | 2428.1 ms |
| add100 | 100 | 1871.6 ms | 38.6 ms | 3539.7 ms |
| mixed1000 | 1000 | 17704.6 ms | 35.5 ms | 19571.5 ms |

## WNCAD semantic-history delta (1000 set-elevation edits)

| size | plain bytes | edited bytes | delta | % |
| --- | ---: | ---: | ---: | ---: |
| 10k | 3,336,264 | 3,542,121 | +205,857 | +6.17% |
| 50k | 16,896,255 | 17,103,484 | +207,229 | +1.23% |
| 100k | 33,921,050 | 34,128,392 | +207,342 | +0.61% |

The persisted edit stack is ~207 bytes/edit (kind + id + vertex ref + value),
independent of mesh size — semantic records only, no baked mesh.

## Analysis (measured, not idealized)

`set-elevation` / `delete-point` / `add-point` scale linearly with mesh size
and are roughly flat in edit count in the local-affected sense (100k:
set1000 replay 543 ms ≈ the Phase 18S 100k/1000-edge-edit reference of
≈ 693 ms; add100 1872 ms is dominated by the ear-clip cavity walk; the
grid/stats rebuild is 35 ms at 100k, negligible).

`move-point` dominates and is the one superlinear leg: 100 moves cost
748 ms → 4.0 s → 8.0 s for 10k → 50k → 100k, and mixed-1000 (200 moves)
costs 1.6 s → 8.6 s → 17.7 s. Cause (verified in
`cadSurfaceEditPointModify.ts#applyMovePoint`): after the valid-kernel check,
the crossing guard scans **every active triangle** for each moved-vertex
neighbor (`for (const [, tri] of state.tris)`) — O(mesh) per move, i.e.
O(moves × triangles) overall. Correct and deterministic, but not local.

`ponytail:` ceiling — a spatial index (or reusing the existing edge map) for
the crossing guard would make move-point local; do not change the kernel
without a reviewer. This doc records the measured envelope; the tests assert
correctness only, never milliseconds.
