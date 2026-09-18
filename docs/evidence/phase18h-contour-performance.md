# Phase 18H — contour performance measurements

Methods: `npx tsx scripts/phase18hContourPerf.ts` (Node 22, this machine;
1 warm-up + 3 measured runs, median). Deterministic 18G-style grids with
realistic relief (z = 100 + col·0.5 + row·0.3 + jitter, ~180 m span at
50k); interval 1 m / majorEvery 5 / base 0. Splits per scale: mesh-clone
(structuredClone of worker input) / extraction (extractSurfaceContours,
the exact fn the worker runs) / result-clone / cache-ingest / display
(one path-D string per kind). No src/ changes; timings advisory.

## 1. Contour derivation timings (Node engine baseline)

| points | levels | segments | paths | extract | meshClone | resultClone | ingest | display | total | tris |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 25 | 1,668 | 32 | 8.1 ms | 0.9 ms | 0.6 ms | 0.0 ms | 0.3 ms | 9.9 ms | 1,980 |
| 10,000 | 79 | 16,089 | 151 | 104.6 ms | 14.7 ms | 5.3 ms | 0.0 ms | 1.6 ms | 126.3 ms | 19,978 |
| 50,000 | 178 | 78,912 | 542 | 1,142.9 ms | 62.4 ms | 24.8 ms | 0.0 ms | 12.1 ms | 1,242.2 ms | 99,967 |
| 100,000 | 252 | 156,808 | 972 | 3,374.1 ms | 107.9 ms | 56.1 ms | 0.0 ms | 28.8 ms | 3,567.0 ms | 199,973 |

Growth is ~linear-to-quadratic through 100k (extraction dominates;
transfer + ingest + display stay <5% of total at every scale). 100k
completes in ~3.6 s — **not skipped** (well under the 5-minute budget).

## 2. Level / segment limits (chosen with evidence)

- **Level cap 2000** (`SURFACE_CONTOUR_LEVEL_LIMIT`): the largest measured
  set needs 252 levels; 2000 is ~8× headroom. Pathological 1 mm interval
  over a 180 m range (180,001 levels) blocks with
  `ContourLevelLimitError` — asserted by the harness, never a hang.
- **Segment cap 1M** (`SURFACE_CONTOUR_SEGMENT_LIMIT`): the largest
  measured set emits 156,808 segments (~0.8 segments/triangle/level-set);
  1M is ~6× headroom over the biggest displayable set. Exceeding blocks
  with a diagnostic — never silent truncation.

## 3. Label placement + visible-label cap

Real 10k set, spacing 5 (15,218 potential labels): placement 5.1 ms,
culled to **200 visible** (`SURFACE_CONTOUR_LABEL_CAP`, truncated=true).
Synthetic 100/500/1000-label inputs: cull ≤0.01 ms, visible bounded at
200 in every case. Justification: placement is linear and cheap, but DOM
text nodes are not — the cap keeps the label layer at ≤200 SVG nodes
regardless of path count while geometry stays complete in cache.

## 4. Contour memory by representation (JSON-byte accounting)

| points | minorPaths | majorPaths | set total |
| --- | --- | --- | --- |
| 1,000 | 63.9 KiB | 15.7 KiB | 79.9 KiB |
| 10,000 | 591.7 KiB | 149.1 KiB | 741.1 KiB |
| 50,000 | 2,926.8 KiB | 730.2 KiB | 3,657.3 KiB |
| 100,000 | 5,807.6 KiB | 1,452.0 KiB | 7,259.9 KiB |

Paths are flat `{x, y}` point arrays — no per-segment object graphs, no
adjacency/grid duplication (the contour set carries only stitched
polylines + stats). Per-point cost ≈ 45 bytes, linear in output size.

## 5. Cache-bounding policy (restated)

`createCadSurfaceContourCache`: keyed
`scopeId::surfaceId@surfaceRevision@contourGeometryRevision`, stores
contour sets only (never React state, never history), bounded to current
+ ≤1 stale set per surface. Ingest cost measured 0.0 ms (map insert).

## 6. Worker-handoff overhead (derived)

The worker input is the compact mesh (points + triangles); at 50k the
mesh-clone proxy costs 62 ms and the contour-set clone 25 ms — the
postMessage hop is bounded by ~100 ms at 50k, ~160 ms at 100k, against
~1.1 s / ~3.4 s of off-thread extraction. Transfer is <10% of
end-to-end at every scale: the hop is never the bottleneck.

## 7. Responsiveness note

Extraction runs off the UI thread via the contour worker (§2 of the
18H worker note); main-thread ingest is a map insert (~0 ms) and display
prep is two string builds (≤29 ms at 100k). The 50k extraction (~1.1 s)
never blocks input — the operator sees BUILDING status, then CURRENT.
No new test added (measurement script only), so no test-tier
registration applies.
