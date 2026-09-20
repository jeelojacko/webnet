# Phase 18S — TIN edit-stack performance evidence

Scope: the Phase 18S engine applicator (`src/engine/cad/cadSurfaceEdits.ts`,
`cadSurfaceEditMesh.ts`, `cadSurfaceEditAddLine.ts`) as wired into
`buildCadSurface` (`src/engine/cad/cadSurfaces.ts`). This is evidence only —
there is **no CI millisecond gate** and this doc does not add a test tier.

## Methodology

- Synthetic triangulated grids are generated **in-process** (no fixture files).
  A `side × side` vertex grid is split into two triangles per cell. "vert"
  counts below are mesh vertices; triangles ≈ 2 × (side − 1)².
- Edits are valid, non-interfering local ops: swap-edge on interior FREE
  edges spaced ≥ 3 cells apart (swaps are independent when they do not share
  a triangle), and add-line as the alternate cell diagonal `b–d` (the crossed
  cavity is exactly the two cell triangles). 1000-edit runs use the first
  1000 spaced positions.
- Timing is `performance.now()` around the full
  `applyCadSurfaceEdits(baseline, edits)` call (compile + replay + the final
  compact/sort + `buildTinTopology`). One warm-up is not used; the harness was
  run once per size (numbers are same-order-of-magnitude across runs).
- The measuring harness was a temporary vitest file, deleted after capture.
  Machine: Node v26.8.1, 16 vCPU, 31 GB RAM (Linux).

## 1. Baseline native build (input point-grid → `buildCadSurface` total)

`buildCadSurface` includes source collection, Delaunay + constrained recovery,
synthetic tail, `buildTinTopology`, bounds, face stats, and grid build.

| input points | total build |
| ---: | ---: |
| 1,024 | 38.0 ms |
| 10,000 | 190.6 ms |

## 2. Edit replay (swap/delete local ops, `applyCadSurfaceEdits`)

| mesh verts | 10 edits | 100 edits | 1000 edits |
| ---: | ---: | ---: | ---: |
| 1,024 | 20.1 ms | 91.6 ms | — (495 edits: 430.9 ms) |
| 10,000 | 166.2 ms | 1,222.1 ms | 12,030.5 ms |
| 50,176 | 1,095.6 ms | 8,747.9 ms | 86,419.3 ms |
| 99,856 | 2,545.1 ms | 20,401.0 ms | 194,758.7 ms |

## 3. Add-line crossed-region (`b–d` alternate diagonal, 2-triangle cavity)

| mesh verts | 1 add-line | 10 add-lines |
| ---: | ---: | ---: |
| 1,024 | 16.1 ms | 29.4 ms |
| 10,000 | 79.4 ms | 166.5 ms |
| 50,176 | 406.9 ms | 1,121.7 ms |

## Analysis (measured, not idealized)

Replay time grows **linearly in both the edit count and the mesh size**:
holding the mesh at 10k verts, 10 → 100 → 1000 edits costs 166 → 1222 → 12031 ms
(≈ linear in edits); holding the stack at 10 edits, 1k → 10k → 50k → 100k
verts costs 20 → 166 → 1096 → 2545 ms (≈ linear in vertices). That is
`O(edits × triangles)` behaviour, **not** local-affected-topology scaling.

Root cause, verified in the code: every elementary op ends with
`refreshEditEdges(state)`, which rebuilds the canonical edge map from **all**
active triangles and `sortedEditTriIds` sorts every triangle id — once per
edit. The cavity walk / ear clip itself is local and cheap (1 add-line of a
2-triangle cavity on a 50k mesh is 407 ms, almost entirely the full-map
refresh, not the clip). The final compact + `buildTinTopology` also runs once
over the final mesh, which is unavoidable and proportional to triangles.

`ponytail:` ceiling — the applicator is correct and deterministic but its
per-edit full-mesh edge-map rebuild makes large stacks quadratic. Upgrade path
when large stacks matter: update only the touched triangles' edges in
`refreshEditEdges` (local delta) instead of rebuilding/sorting the whole map;
that would make replay O(edits × local-cavity) plus one final O(T) compact.
Do not change the engine mid-slice without the reviewer; this doc records the
current measured envelope.

Add-line crossed-region cost is reported **separately** and is dominated by
the same refresh; the cavity walk/ear-clip portion is a small fraction.

## Practical envelope

- Interactive editor use (tens of edits on ≤10k-vertex surfaces) stays well
  under a frame budget.
- 1000-edit stacks on ≥50k-vertex meshes are seconds-to-minutes; treat as a
  batch/offline concern until the incremental edge-map upgrade above lands.
