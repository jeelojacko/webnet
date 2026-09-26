# Phase 18Y — exact surface-composition performance evidence

- **Branch:** `feat/cad-surface-exact-composition`
- **Harness:** `tests/evidence/phase18y_compose_perf.test.ts` (evidence tier, registered in `scripts/testTiers.ts`)
- **Engine:** `src/engine/cad/surfaceCompose.ts` (`composeSurfaceMeshes`) + `surfaces/compose/{coverage,pslg}.ts`
- **Policy:** `overlay-coverage-wins`; no CI timing thresholds — this document records measured numbers only.

Reproduce:

```
PHASE18Y_PERF_SIZES=1000,10000 PHASE18Y_PERF_OUT=/tmp/p18y.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18y_compose_perf.test.ts
```

Optional `PHASE18Y_PERF_CASES=full-overlay` restricts the case set. Each size runs three JIT
warm-ups before timing. Stage columns are measured with the exported sub-stages
(`createMeshView`, `buildTinTopology` + `extractBoundaryEdges`, `buildComposePslg`); the
`tri+classify` column is `total − index − boundary − pslg` and is therefore an approximate
attribution (the engine rebuilds the internal stages inside `composeSurfaceMeshes`).

## Case geometry

| Case | Base | Overlay |
|---|---|---|
| `disjoint` | grid `[0, S]²`, `z = 100 + 0.1x + 0.2y` | same grid translated `+4` cells in x, flat `z = 110` |
| `full-overlay` | same base | identical grid over the base |
| `partial-seam` | same base | right half of the base grid |
| `intersecting-seam` | same base | L-shaped grid (top-right quadrant removed) — two perpendicular seams |
| `void` | same base | full grid with one interior cell removed |
| `different-topology` | same base | full grid with the opposite diagonal on every cell |

All successful cases share the base plane, so every true seam agrees exactly and exercises the
Z gate's pass path. `totalVerts` is the sum of both source grids' vertex counts.

## Measured — 1 000 and 10 000 total-vertex pairs

| totalVerts | case | resultArea | outVerts | outTris | index ms | boundary ms | pslg ms | tri+classify ms | total ms | heap delta MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | disjoint | 968.0 | 1058 | 1936 | 1.2 | 1.1 | 37.0 | 408.6 | 448.0 | 23.3 |
| 1000 | full-overlay | 484.0 | 529 | 968 | 2.2 | 1.1 | 4.6 | 71.3 | 79.2 | -3.4 |
| 1000 | partial-seam | 484.0 | 529 | 968 | 0.6 | 0.1 | 7.7 | 74.6 | 83.2 | -3.4 |
| 1000 | intersecting-seam | 484.0 | 529 | 968 | 0.9 | 0.5 | 8.3 | 73.8 | 83.4 | -2.8 |
| 1000 | void | 484.0 | 529 | 968 | 1.0 | 0.6 | 4.3 | 71.0 | 77.0 | -5.1 |
| 1000 | different-topology | 484.0 | 529 | 968 | 2.6 | 0.6 | 4.6 | 76.7 | 84.5 | -1.5 |
| 10000 | disjoint | 10082.0 | 10368 | 20164 | 8.9 | 8.1 | 2502.0 | 36616.7 | 39135.7 | 16.8 |
| 10000 | full-overlay | 5041.0 | 5184 | 10082 | 6.8 | 6.5 | 45.6 | 7416.2 | 7475.1 | -69.4 |
| 10000 | partial-seam | 5041.0 | 5184 | 10082 | 6.2 | 2.1 | 492.9 | 7850.5 | 8351.8 | -65.1 |
| 10000 | intersecting-seam | 5041.0 | 5184 | 10082 | 7.9 | 5.3 | 485.1 | 7787.7 | 8286.0 | 35.8 |
| 10000 | void | 5041.0 | 5184 | 10082 | 6.7 | 5.7 | 46.3 | 7483.2 | 7541.8 | -28.5 |
| 10000 | different-topology | 5041.0 | 5184 | 10082 | 9.2 | 6.4 | 46.7 | 7433.9 | 7496.2 | 52.3 |

Output counts are deterministic and identical across the same-plane cases
(overlap = full overlay area → the composed surface equals the base domain
with the overlay's canonical triangulation).

## Growth factor (1 000 → 10 000, a 10× input increase)

| case | total ms × | interpretation |
| --- | --- | --- |
| disjoint | 87× | superlinear |
| full-overlay | 94× | ≈ quadratic |
| partial-seam | 100× | ≈ quadratic |
| intersecting-seam | 99× | ≈ quadratic |
| void | 98× | ≈ quadratic |
| different-topology | 89× | superlinear |

A 10× input increase costs ~90–100× time, i.e. the current engine is effectively **O(n²)** in
the total vertex count. The dominant stage is the constrained retriangulation +
ownership classification (`tri+classify`), not index build or boundary extraction.

## 50 000 and 100 000 pairs — NOT MEASURED

The 10 000-pair rows already take 7.5–39 s per case. Quadratic extrapolation from the measured
points puts 50 000 pairs at roughly 3–16 min per case and 100 000 pairs at roughly 12–65 min
per case, which is outside a practical evidence run. The harness accepts those sizes
(`PHASE18Y_PERF_SIZES=50000,100000`) but they were **not** executed for this slice; the doc
records the measured ceiling rather than fabricated numbers.

Two distinct costs are visible:

1. **Constrained retriangulation** dominates every case (~0.7–0.8 ms per output triangle at
   10 000). This is the shared `buildConstrainedTin` pipeline (delaunator base + Sloan
   constraint recovery + Lawson legalize), so composition inherits the existing 18F/18H TIN
   build cost. It is the primary optimization target for large compositions.
2. **`disjoint` is pathological** (~5× the same-size full overlay at 1 000; ~5× at 10 000):
   the constrained triangulation covers the convex hull spanning both islands, triangulates the
   empty corridor between them, then drops every cell owned by neither surface. The
   `drop`-then-canonicalize path pays the full hull cost. Bounding/partitioning the PSLG by
   connected component (or triangulating each island separately) would remove it.

## Worker memory notes

- The worker receives structured-clone flat arrays per source (`points: number[]`,
  `triangles: number[]`) and returns flat `vertices`/`faces`; no object graph crosses the
  boundary. At 10 000 total vertices the two input meshes plus the result are on the order of
  a few MB, and heap deltas in the table are dominated by GC noise (negative values are
  post-collection measurements, not allocation).
- The composition service keeps at most one pending request per ownership key
  (`base|overlay|policy`) and supersedes the previous one, so concurrent compositions cannot
  accumulate workers.

## Integration notes (UI)

- The dialog runs a synchronous deterministic engine dry-run for the pre-commit summary and the
  seam-mismatch block, but only when `baseTriangles + overlayTriangles <= 25 000`
  (`COMPOSE_DRY_RUN_TRIANGLE_LIMIT`). Above that ceiling the dry-run is skipped and the
  worker-backed `SurfaceComposeService` computes the commit off-thread; the dialog then shows
  the post-commit summary derived from the result surface stats plus the
  `overlap = base + overlay − result` area identity. The main thread therefore never runs a
  large composition.
