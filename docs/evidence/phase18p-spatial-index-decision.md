# Phase 18P — Spatial Index + Lifecycle + Dirty-Cache Decision (Worker C)

## Baseline (before, probe `cadAnnotationPerf.test.ts`, mixed annotation drawing)

| entities | snap-query ms | decade ratio |
| --- | --- | --- |
| 125 | 0.415 | — |
| 1,250 | 2.069 | 4.99× |
| 12,500 | 55.34 | 26.75× |

Second-decade quadratic came from per-query work inside `querySnapCandidates`:
`project.entities.filter` + `entityIntersectsBounds` scan, `flatMap entitySegments`,
fresh `arcRefFromEntity` per arc, full block-reference expansion, then O(nearby²)
exact-intersection pairs over the whole drawing (intersection candidates far from
the cursor were computed and discarded by the end-of-query distance filter).

## What prepared-bounds achieved (after, same probe, same machine)

| entities | snap-query ms | decade ratio |
| --- | --- | --- |
| 125 | 0.064 (6.5× faster) | — |
| 1,250 | 0.195 (10.6× faster) | 3.0× |
| 12,500 | 2.072 (26.7× faster) | ~10.6× (linear) |

Change (`src/engine/cad/cadSpatialIndex.ts` only): `buildCadSpatialIndex` now
prepares once per index — visible snap-relevant entities + AABBs, all segment refs
+ bounds, all arc refs (cached, trig done once) + full-circle bounds, block
instance bounds + definition handle, `segmentById` / `arcBySourceId` maps.
Per query performs only AABB tests over prepared data; arc refs and segment refs
are never rebuilt per query.

## Broad-phase decision: cursor-box cull BUILT, uniform grid DEFERRED

Built: plain-hover queries (construction inactive, no locked snap) filter prepared
data through a cursor box (cursor ± tolerance × max kind multiplier) stacked on
the existing viewport cull. Safety argument: every kind reachable on the hover
path is distance-filtered at query end, so an AABB missing the cursor box cannot
yield a surviving candidate — including exact intersections, whose point lies on
both parents. Construction snaps (extension/perpendicular/parallel/tangent/
apparent-intersection/locked) are infinite-line projections that can reach far
from their parents, so the construction path keeps the full prepared sets (same
results as before, minus the per-query rebuild allocs). 18N bounds-first block
expansion is preserved: block children expand lazily per query only for
in-viewport/near-cursor instances, memoized per index (immutable project ⇒ cache
cannot go stale).

Deferred: uniform-grid / bucket index. Reason: remaining query cost is one linear
AABB pass (~10.6×/decade, absolute 2.07 ms at 12,500 entities — well inside a
pointer-move budget). A grid would add a second structure to keep correct for
marginal gain. Revisit if snap-query exceeds ~8 ms at 12.5k entities or if
drawings with 50k+ snap entities become common.

## Lifecycle policy (audited, one comment added in code)

- `useSurveyCadSnapping` memos the index on `[project]`; workspace sets
  `cadProject = history.present.project` (new identity on edit/undo/redo/
  drawing-switch) ⇒ new index with fresh prepared bounds, no stale reads.
- Pan/zoom never rebuilds: viewport travels as the `visibleBounds` query
  argument per pointer move and only re-filters prepared bounds.
- No incremental invalidation: immutable wholesale rebuild on project identity
  change is the whole policy (rebuild cost is one linear preparation pass).

## Dirty-cache + dependency-map decisions: both DEFER with numbers

Associative-update probe (1,000 lines + 1,000 bearing labels): affected-label
re-derivation 0.001 ms vs full scene rebuild 2.294 ms (~2,300× ratio, but the
absolute full cost is ~2.3 ms — imperceptible on edit). Mixed 12.5k-entity
drawing: display-scene rebuild 26 ms (project-change only, not pointer-move),
export-scene 52 ms (export path only). No per-keystroke or per-pointer-move
payer justifies an entity-keyed derivation cache, and any cache risks stale
display — prefer recompute. Likewise the source→annotation dependency map is
only needed for cache invalidation; with no cache, it is deferred. Revisit if
full-scene rebuild exceeds ~50 ms on project-change for typical drawings.

## Validation

- `tests/cadSpatialIndex` 01–06: 23/23 pass (snap, intersection, extension,
  perpendicular, parallel, tangent, block-snap coverage).
- `tests/cad_blocks_engine` + `tests/cad_annotation_workspace_seam`: 35/35 pass.
- Probe structural asserts pass (2/2).
- `eslint` on touched file clean; `npm run typecheck` clean.

## Files changed

- `src/engine/cad/cadSpatialIndex.ts` (only source file; lifecycle policy in
  code comment, no hook changes needed — existing `useMemo [project]` already
  implements the policy).
- `docs/evidence/phase18p-spatial-index-decision.md` (this file).
