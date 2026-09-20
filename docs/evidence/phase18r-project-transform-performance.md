# Phase 18R project-transform performance evidence

Date: 2026-09-20. Probe: `scripts/gen18rPerf.ts` (one-shot, since removed;
reproduce with the same entity/TIN generators against
`applyCadProjectCoordinateTransform`). Machine: dev workstation, Node via
`npx tsx`. Timings are wall-clock medians of a single pass — order-of-magnitude
evidence only, no hard gate.

## Ordinary entities (lines, similarity s=1.00005)

| entities | preflight (affected counts) | transform (total) | per-entity | bounds rebuild |
|---|---|---|---|---|
| 1,000 | 0.1 ms | 3.3 ms | 3.29 µs | 0.2 ms |
| 10,000 | 0.4 ms | 9.6 ms | 0.96 µs | 3.0 ms |
| 50,000 | 0.6 ms | 20.6 ms | 0.41 µs | 2.1 ms |

Per-entity cost *falls* with n (fixed per-call overhead dominates), so the
pipeline is O(n): one geometry pass per entity, one bounds pass, one history
commit. No pairwise work anywhere (coincidence validation is map-lookup only).

## Imported TIN vertices (explicit topology, XY moved / Z kept / faces untouched)

| vertices | transform (total) | per-vertex |
|---|---|---|
| 1,000 | 0.5 ms | 0.51 µs |
| 10,000 | 0.9 ms | 0.09 µs |
| 50,000 | 1.1 ms | 0.02 µs |
| 100,000 | 1.9 ms | 0.02 µs |

Flat per-vertex cost: the vertex loop is a single linear pass over the
compact array. 100k vertices transform in ~2 ms engine-side.

## Phase breakdown (where the time goes)

- Preflight (`projectTransformAffectedCounts`): single linear scan, <1 ms at 50k.
- Transform: per-entity `transformCadEntityGeometry` (no trig per entity —
  the classifier runs once) + station-equation propagation (O(equations)) +
  sample-line scaling (O(lines)) + ownership detach (O(entities)) + TIN
  vertex loop (O(vertices)). Metadata rewrite is a shallow per-entity spread.
- Invalidation: O(1) per surface (`cachedRevision = null`; meshes are
  session-only and never copied).
- Bounds: one linear `buildCadBounds` pass.
- History commit: one undo entry holding before/after snapshots (memory, not
  time, is the cost — unchanged from every other command).

## Worker / precompute note

No worker or precompute needed: even 50k entities + 100k TIN vertices finish
in ~25 ms on the main thread, far below any freeze threshold. If drawings
grow 10× beyond this envelope, the natural split is chunked async commit
(phase slices yielding to the event loop), not a worker — the transform is
pure and synchronous, so chunking is trivial. No action taken.
