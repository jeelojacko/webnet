# Phase 18V — bulk / region surface edit performance

Scope: the Phase 18V bulk kernels (`set-elevation-many`,
`raise-lower-points`, `move-points` in `src/engine/cad/cadSurfaceEditBulk.ts`)
replayed through the Phase 18S chokepoint in `buildCadSurface`, plus the
dynamic edge spatial index (`cadEditEdgeSpatialIndex.ts`, architecture §9) and
the region-selection helpers. **Evidence only — there is no CI millisecond
gate.** Correctness pins are the agent-tier
`tests/cad_surface_bulk_downstream_18v.test.ts` +
`tests/cad_surface_bulk_persist_18v.test.ts`; the 10k/50k/100k campaign is
the manual-only `tests/evidence/phase18v_bulk_perf.test.ts`
(`npm run test:evidence`, or direct `vitest --config vitest.evidence.config.ts`).

## Methodology

- Synthetic `side × side` planar grids generated in-process
  (`tests/cadSurfacePointEdits18tFixtures.ts`). "10k" = side 100 (10,000 verts
  / 19,602 tris), "50k" = side 224 (50,176 / 99,458), "100k" = side 317
  (100,489 / 199,712).
- Stacks: `single1/10/100` = 1/10/100 separate `move-point` edits;
  `bulkMove10/100/1000` = one `move-points` edit over that many interior
  points; `bulkSet100/1000/10000` = one `set-elevation-many`;
  `bulkRaise100/1000/10000` = one `raise-lower-points`. At 10k the 10000-ref
  stacks address the whole mesh.
- `replay` = `replaySurfaceEdits(edits, baselineMesh)` (resolve + kernel +
  compact + adjacency/topology). `total` = `buildCadSurface(project,
  surfaceWithEdits)` (source + Delaunay + synthetic tail + replay +
  bounds/stats/grid).
- Breakdown = the kernel's discovery loop re-timed by phase on one 100-point
  bulk move: `index build` (`ensureEditEdgeSpatialIndex`), `candidate query`
  (per-moved-edge proposed-bbox `queryCandidates`), `exact test`
  (`properlyCrosses` over the old-index candidates **plus** the §30 local
  proposed moved-edge set). `candidateReduction` = movedEdges × allEdges ÷
  candidateTests.
- Index memory = `process.memoryUsage().heapUsed` delta around the lazy index
  build (no forced GC — same-order-of-magnitude only), plus edge/cell counts.
- `performance.now()`, one warm run per size. Machine class: Linux, Node 26.

## Replay / total (ms)

### 10k — baseline build 194.4 ms

| stack | edits | replay | total |
| --- | ---: | ---: | ---: |
| single1 | 1 | 127.9 | 224.4 |
| single10 | 10 | 62.0 | 232.8 |
| single100 | 100 | 63.6 | 220.5 |
| bulkMove10 | 1 | 67.0 | 199.7 |
| bulkMove100 | 1 | 97.8 | 210.8 |
| bulkMove1000 | 1 | 713.5 | 822.3 |
| bulkSet100 | 1 | 40.5 | 173.3 |
| bulkSet1000 | 1 | 60.1 | 159.3 |
| bulkSet10000 | 1 | 44.3 | 179.3 |
| bulkRaise100 | 1 | 38.8 | 157.2 |
| bulkRaise1000 | 1 | 45.7 | 190.4 |
| bulkRaise10000 | 1 | 51.4 | 164.0 |

### 50k — baseline build 781.5 ms

| stack | edits | replay | total |
| --- | ---: | ---: | ---: |
| single1 | 1 | 385.2 | 1157.0 |
| single10 | 10 | 369.5 | 1059.8 |
| single100 | 100 | 455.5 | 1131.4 |
| bulkMove10 | 1 | 449.7 | 1040.4 |
| bulkMove100 | 1 | 493.8 | 1213.8 |
| bulkMove1000 | 1 | 1674.8 | 2381.1 |
| bulkSet100 | 1 | 297.8 | 984.5 |
| bulkSet1000 | 1 | 264.8 | 1041.3 |
| bulkSet10000 | 1 | 263.4 | 969.9 |
| bulkRaise100 | 1 | 286.6 | 987.1 |
| bulkRaise1000 | 1 | 302.1 | 1044.0 |
| bulkRaise10000 | 1 | 281.2 | 1070.1 |

### 100k — baseline build 1608.2 ms

| stack | edits | replay | total |
| --- | ---: | ---: | ---: |
| single1 | 1 | 992.9 | 2509.9 |
| single10 | 10 | 955.1 | 2467.2 |
| single100 | 100 | 816.9 | 2418.9 |
| bulkMove10 | 1 | 917.5 | 2599.1 |
| bulkMove100 | 1 | 1179.3 | 2600.6 |
| bulkMove1000 | 1 | 3303.9 | 4778.6 |
| bulkSet100 | 1 | 743.4 | 2489.3 |
| bulkSet1000 | 1 | 857.4 | 2333.6 |
| bulkSet10000 | 1 | 683.0 | 2449.5 |
| bulkRaise100 | 1 | 690.8 | 2292.1 |
| bulkRaise1000 | 1 | 821.8 | 2073.5 |
| bulkRaise10000 | 1 | 775.8 | 2219.2 |

## Index decomposition + §98 no-whole-mesh-scan proof

| size | index build | candidate query | exact test | moved edges | candidate tests | predicate tests | all edges | brute pairs | candidate reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10k | 9.4 ms | 0.9 ms | 12.4 ms | 494 | 5,039 | 241,670 | 29,601 | 14,622,894 | 2,902× |
| 50k | 58.9 ms | 1.1 ms | 11.2 ms | 501 | 5,018 | 248,706 | 149,633 | 74,966,133 | 14,939× |
| 100k | 156.5 ms | 1.2 ms | 11.4 ms | 501 | 5,018 | 248,706 | 300,200 | 150,400,200 | 29,972× |

The measured candidate test count for a fixed 100-point bulk move is flat
across 10k → 50k → 100k while the all-edges count grows 10×. That is the
architecture §98 proof: the kernel does **not** scan `moves × whole mesh`; the
per-move predicate work is bounded by the spatial-index candidate set. The
dominant measured leg is the index build (lazy, once per replay) plus the §30
local proposed moved-edge set, which is O(movedEdges²) for a single bulk move
and is why `bulkMove1000` replay grows 713 → 1,675 → 3,304 ms.

## Exact active-point location index (gate 10)

Reviewer gate 10 flagged the last whole-mesh leg after the crossing sieve: the
exact-XY coincidence scans in single `applyMovePoint` and the add-point
`findCoincident` gate were still O(points) per op. §67 authorizes a simple
point index on evidence. `cadEditPointLocationIndex.ts` now maps the exact XY
of every ACTIVE vertex (`${x},${y}` — Float64 → string exact round-trip, so no
tolerance is involved) to its index. It is built lazily once per replay, is
O(1) per lookup, and is maintained on add-point (insert), delete-point
(forget) and every move commit seam (`updateVertexEdges`, shared by the single
and bulk kernels). Answers are byte-identical to the scan: the 2,000-proposal
move-parity corpus, randomized exact-coincidence move targets, and an
add/delete/move/bulk consistency pin all stay 100% green.

Measured on the mid-size 50k fixture (side 224, 50,176 pts; baseline build
775-792 ms), best of 5:

| leg | before (full active scan) | after (location map) |
| --- | ---: | ---: |
| coincidence gate, per lookup | 35.1 µs | 0.126 µs (279×) |
| map build, once per replay | — | 10.1 ms |

The map is an honest break-even trade at this size: ~287 coincidence checks
repay the one-time build (10.1 ms ÷ 35.1 µs), so a one-move replay pays ≈10 ms
more while an N-move stack saves ≈35 µs × (N − 287). The point is the asymptote
— O(points + checks) instead of O(checks × points) — so the saving grows with
both stack depth and vertex count even though a single mid-size replay delta is
inside the noise of the compaction/topology rebuild that follows every replay
(the pre-fix `single100` record of 455.5 ms and the min-of-7 post-fix 259 ms
used different warmup and are not comparable).

## Index structure + approximate memory

| size | indexed edges | occupied cells | wide-list | heapDelta |
| --- | ---: | ---: | ---: | ---: |
| 10k | 29,601 | 7,569 | 0 | ≈11.8 MB |
| 50k | 149,633 | 37,636 | 0 | ≈35.2 MB |
| 100k | 300,200 | 75,625 | 0 | ≈88.2 MB |

The index holds one record per unique active edge (`ponytail:` object layout;
~300 B/edge in the rough heap delta). The `wide` list stays empty on these
grids, so the always-scanned fallback is not a factor here.

## Region selection timing

| size | selectable points | window | polygon (32-gon) |
| --- | ---: | ---: | ---: |
| 10k | 10,000 / 1.3 ms | 400 refs / 0.4 ms | 1,224 refs / 10.8 ms |
| 50k | 50,176 / 6.4 ms | 2,025 refs / 1.7 ms | 6,200 refs / 11.8 ms |
| 100k | 100,489 / 13.9 ms | 4,096 refs / 8.5 ms | 12,469 refs / 23.0 ms |

Selection is a linear scan (`selectableSurfacePoints`) + exact point tests;
the 32-gon cost is O(points × polygonEdges) and stays in the tens of ms at
100k. Resolution is session-only and never persisted.

## WNCAD semantic-history byte cost

Measured in `tests/cad_surface_bulk_persist_18v.test.ts` (agent tier) on a
32×32 (1,024-point) project, one `raise-lower-points` row:

| refs | serialized bytes | delta vs plain | per-ref |
| ---: | ---: | ---: | ---: |
| 0 (plain) | 368,133 | — | — |
| 10 | 369,119 | +986 | ~99 B |
| 100 | 376,205 | +8,072 | ~81 B |
| 1,000 | 447,701 | +79,568 | ~80 B |

The persisted stack is the edit object plus one compact `{key}` record per
reference — semantic only, no baked mesh, no selection geometry. (The 18T
207 B/edit figure was 2 full `{key}`s per `set-elevation` row; a bulk row is
one object with an N-element ref array.)

## Notes (measured, not idealized)

- Single `move-point` and bulk `move-points` share the same index path
  (§66) — there is no fast-single/slow-bulk split.
- Z-only bulk kinds (`set-elevation-many`, `raise-lower-points`) are flat in
  ref count at a given size (resolve + write, no geometry revalidation), e.g.
  100k: 683–857 ms replay for 100/1,000/10,000 refs.
- `bulkMove1000` is the heaviest stack measured (4.8 s total at 100k); its
  cost is dominated by the index build (once) and the local moved-vs-moved
  final-state test, not by any whole-mesh crossing scan.
- The bulk `applyMovePointsVertices` exact-coincidence guard is a single-pass
  exact-`===` key sweep (no per-selected scan), and the single-move/add-point
  gate is the exact active-point location map above (gate 10); there is no
  remaining O(checks × points) coincidence leg.
- The evidence run finished in ≈73 s wall time for all three sizes.

**No CI millisecond gate.** The tests assert correctness (outcome + unchanged
triangle count for the Z-only and rigid-move stacks) so a broken run cannot
masquerade as slow.
