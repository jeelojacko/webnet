# Phase 18Z §2 — deep stage profile of the 18Y composition engine

- **Branch:** `perf/cad-surface-composition-scaling`
- **Engine profiled:** `src/engine/cad/surfaceCompose.ts` `composeSurfaceMeshes` (current 18Y algorithm, unmodified)
- **Probe:** `/tmp/phase18zComposeStageProbe.ts` (temporary, not committed — see §1)
- **Status:** read-only profiling. No production file, test, or fixture was changed.
- **Raw numbers only.** Every millisecond below is as measured; no rounding to a story.

---

## 1. Method

The production `composeSurfaceMeshes` is monolithic, so per-stage wall-clock attribution requires
an instrumented replica. The probe is a step-for-step copy of the production pipeline that wraps
each stage in `performance.now()` and adds integer counters to the two recovery/legalize
internals that production does not expose. It imports the real sub-modules (`createMeshView`,
`locateInMesh`, `buildTinBase`, `filterTinDomain`, `buildTinTopology`, `canonicalizeBakedTin`,
`validateExplicitTinPayload`, `explicitTinTopologyDigest`, `makeWebnetComposeProvenance`,
`zeroDelta`) and copies only the un-exported internals (`buildComposePslg`, `recoverConstrainedEdges`,
`legalizeTin`, the `buildConstrainedTin` round loop, `splitAtInteriorVertices`).

**Fidelity guard.** For every case the replica is compared against the real engine before use:

- PSLG points/segments are byte-identical to production `buildComposePslg` (checked at 1k and 10k).
- Replica recovery returns the same `ok`/triangle count as production `recoverConstrainedEdges`
  on the identical inputs (checked at 1k and 10k).
- Output vertex/triangle counts match `composeSurfaceMeshes(...).diagnostics`; a mismatch throws.

**Case geometry** (same builders as `tests/evidence/phase18y_compose_perf.test.ts`): structured
CCW grids, `side = round(sqrt(size/2))`, `cell = 1`, base `z = 100 + 0.1x + 0.2y`. `partial-seam`
is the right half of the base grid over the full base. `size` is the total vertex count of both
source grids (1 000 → side 22, 529 + 529 vertices; 10 000 → side 71, 5 184 + 5 184).

**Run.** 1k = 3 JIT warm-ups + 3 timed reps per case; 10k = 1 warm-up + 2 timed reps
(partial-seam only, per the bounded-run requirement). Each stage cell is the **median of reps**.
`50k`/`100k` were **not** run. `steinerRequests = 0` for every case, so the Steiner-restart row is
a measured zero, not an omitted row.

Caveat: the replica runs the same algorithm with counters and extra timers; in the final run it
was within ~2 % of production end-to-end (10k partial-seam: replica 6 140.9 ms vs production
6 021.1 ms). Earlier instrumented variants that also called the production oracle in-probe were
up to ~20 % slower. Use **stage shares**, not absolute replica milliseconds, for decisions; the
production total is the speed-of-record.

---

## 2. Engine total: replica vs production

| size | case | production total ms | replica total ms |
| --- | --- | --- | --- |
| 1000 | partial-seam | 95.0 | 84.5 |
| 1000 | disjoint | 250.6 | 251.2 |
| 1000 | full-overlay | 60.3 | 58.8 |
| 1000 | intersecting-seam | 65.6 | 80.6 |
| 1000 | void | 79.8 | 60.5 |
| 1000 | different-topology | 60.6 | 61.0 |
| 10000 | partial-seam | 6021.1 | 6140.9 |

Production 1 000 → 10 000 partial-seam growth is **63.4×** for a 10× input increase; the 18Y
harness measured ~90–100× on that case historically. The spread is JIT/median noise on the 1k
row; the exponent is ~1.8–2.0 either way. Quadratic is the right shape.

---

## 3. Per-stage table — partial-seam

All values are replica milliseconds (median of reps). `share` is the fraction of the replica
total. The 14 mission stages are numbered; `5b/9b/9c/14b` are extra granularity needed because
`buildConstrainedTin` performs that work between the named stages.

| # | stage | 1k ms | 10k ms | 10k share | 10k/1k |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | create Base mesh view | 0.6 | 4.0 | 0.07 % | 6.7× |
| 2 | create Overlay mesh view | 0.1 | 1.2 | 0.02 % | 12× |
| 3 | boundary extraction | 0.1 | 1.6 | 0.03 % | 16× |
| 4 | Base-edge clipping | 10.1 | 504.4 | **8.2 %** | 50× |
| 5 | PSLG interning | 1.4 | 10.0 | 0.16 % | 7.1× |
| 5b | constraint prep (splitAtInterior + sort) | 2.9 | 247.4 | **4.0 %** | 85× |
| 6 | Delaunator / `buildTinBase` (round 0) | 0.3 | 1.9 | 0.03 % | 6.3× |
| 7 | constrained-edge recovery | 57.1 | 4861.0 | **79.2 %** | 85× |
| 8 | Steiner restarts (extra-round rebuild) | 0.0 | 0.0 | 0 % | — |
| 9 | `legalizeTin` | 0.8 | 6.0 | 0.10 % | 7.5× |
| 9b | domain filter (flood fill) | 0.6 | 6.2 | 0.10 % | 10× |
| 9c | topology rebuild + triangle sort | 0.7 | 7.1 | 0.12 % | 10× |
| 10 | ownership locate | 5.5 | 320.4 | **5.2 %** | 58× |
| 11 | seam validation | 0.4 | 2.9 | 0.05 % | 7.3× |
| 12 | Z assignment | 2.4 | 159.8 | **2.6 %** | 67× |
| 13 | canonicalization | 0.2 | 1.1 | 0.02 % | 5.5× |
| 14 | explicit validation | 0.1 | 0.0 | ~0 % | — |
| 14b | area + digest + provenance | 0.2 | 1.5 | 0.02 % | 7.5× |
| | **TOTAL** | **84.5** | **6140.9** | 100 % | 72.7× |

The three stages whose growth is essentially the input-size square are **recovery (85×)**,
**constraint prep (85×)**, **Z assignment (67×)**; **ownership (58×)** and **clipping (50×)** are
super-linear but not yet at the square. Recovery alone is 79 % of the 10k engine.

### 3.1 Cross-case at 1 000 (stage subset, replica ms)

| case | clipping | prep | recovery | ownership | Z assign | TOTAL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| partial-seam | 10.1 | 2.9 | 57.1 | 5.5 | 2.4 | 84.5 |
| disjoint | 27.8 | 10.7 | 174.2 | 20.1 | 8.9 | 251.2 |
| full-overlay | 4.1 | 3.1 | 44.3 | 1.0 | 0.1 | 58.8 |
| intersecting-seam | 8.6 | 3.0 | 59.4 | 3.8 | 0.1 | 80.6 |
| void | 4.1 | 3.1 | 46.5 | 0.9 | 0.1 | 60.5 |
| different-topology | 4.1 | 3.0 | 47.0 | 1.0 | 0.2 | 61.0 |

`disjoint` is again the worst 1k case (2.9× partial-seam): its two islands are triangulated
across the empty corridor, so recovery processes ~2 992 segments against a hull-sized mesh and
ownership scans every dropped corridor cell. That is the component-partition signal.

---

## 4. Counts and recovery sub-phases

### 4.1 Counters — partial-seam

| counter | 1k | 10k | growth |
| --- | ---: | ---: | ---: |
| `pslgPoints` | 529 | 5 184 | 9.8× |
| `pslgSegments` / `prepSegmentsAfterSplit` | 1 496 | 15 265 | 10.2× |
| `recoverySegments` | 1 496 | 15 265 | 10.2× |
| `recoveryInitialMissing` | 239 | 2 529 | 10.6× |
| `recoveryFlips` | 239 | 2 529 | 10.6× |
| `findEdgeCalls` | 3 231 | 33 059 | 10.2× |
| **`findEdgeTriScans`** | **1 682 852** | **168 081 852** | **99.9×** |
| `crossingMapBuilds` (edge-map rebuilds) | 239 | 2 529 | 10.6× |
| `meshFilterCalls` | 478 | 5 058 | 10.6× |
| `steinerRequests` | 0 | 0 | — |
| `legalizePasses` / `legalizeEdgeMapRebuilds` | 1 / 1 | 1 / 1 | — |
| `legalizeFlips` | 0 | 0 | — |
| `rounds` | 1 | 1 | — |
| `ownershipLocateCalls` | 1 694 | 17 572 | 10.4× |
| `seamLocateCalls` | 132 | 432 | 3.3× |
| `zLocateCalls` | 1 322 | 12 887 | 9.7× |

The smoking gun is **`findEdgeTriScans`: 1.68 M → 168.1 M (99.9×) for a 10× input increase.**
`findEdge` is a linear scan of the whole triangle list, called once per segment and after every
flip. Segment count and triangle count each grow ~10×, so the product grows ~100×. That single
counter reproduces the observed quadratic shape.

`legalizeTin` is a measured non-factor here: 1 pass, 0 flips at both sizes (the Delaunay base
already satisfies the empty-circle property; recovery flips are the only repair needed).
`steinerRequests` is 0, so the non-convex-quad fallback never fires on these grids.

### 4.2 Recovery sub-phase timing — partial-seam

| sub-phase | 1k ms | 10k ms | 10k share of total |
| --- | ---: | ---: | ---: |
| recovery TOTAL | 57.1 | 4861.0 | 79.2 % |
| — crossing-map rebuild + `properlyCrosses` | 44.5 | 2587.8 | **42.1 %** |
| — `findEdge` scan | 11.6 | 673.2 | 11.0 % |
| — flip application (`mesh.filter` ×2 + array rebuild) | ~1.0 | ~1600 | ~26 % |

The crossing map is rebuilt from scratch (all triangles × all triangle edges, exact predicates)
once per flip iteration, and the mesh is reallocated twice per flip via `Array.filter`. At 10k
that is 2 529 rebuilds × 10 082 triangles and 5 058 full-array filters. `findEdge` adds another
168 M triangle comparisons. Legalize, by contrast, is 6.0 ms.

---

## 5. Ranked bottlenecks (10k partial-seam)

| rank | stage | ms | share | root cause | ref |
| --- | --- | ---: | ---: | --- | --- |
| 1 | constrained-edge recovery | 4861.0 | 79.2 % | O(S·T): per-segment/per-flip full-mesh `findEdge` + full crossing-map rebuild + 2 `mesh.filter`/flip | `tinConstraintRecovery.ts:21-25,81-92,97-100,118` |
| 2 | Base-edge clipping | 504.4 | 8.2 % | per base edge: boundary candidate fan-out + `covered()` point location; edge index built over boundary only | `pslg.ts:171-249,344` |
| 3 | ownership locate | 320.4 | 5.2 % | 2 point locations per built triangle (overlay then base), each rebuilding a string hash key | `surfaceCompose.ts:151-158`; `coverage.ts:120-136` |
| 4 | constraint prep | 247.4 | 4.0 % | `splitAtInteriorVertices` is S segments × N points | `tinBuild.ts:65-101,126` |
| 5 | Z assignment | 159.8 | 2.6 % | 1–2 locations per built point + `usedBy` sweep | `surfaceCompose.ts:204-230` |
| 6 | PSLG interning | 10.0 | 0.16 % | point-key string map | `pslg.ts:266-352` |
| 7 | topology + sort | 7.1 | 0.12 % | edge-key map + O(T log T) sort | `tinBuild.ts:186-205` |
| 8 | domain filter | 6.2 | 0.10 % | flood fill | `tinDomainFilter.ts:28-51` |
| 9 | legalize | 6.0 | 0.10 % | 1 pass, 0 flips | `tinLegalize.ts` |
| 10 | base mesh view | 4.0 | 0.07 % | uniform-grid index build | `coverage.ts:39-71` |

**Construction/IO (views, boundary, PSLG, prep) = 768.6 ms (12.5 %). TIN build + legalize +
topology = 4882.2 ms (79.5 %). Ownership + seam + Z + output = 485.7 ms (7.9 %).**

Confirmed: the 18Y reconnaissance claim that `buildConstrainedTin` + ownership dominates is
correct, but the dominance is almost entirely **recovery**, not legalization. The earlier
"pslg ~3 %" figure is also confirmed for interning (0.16 %), but the PSLG *clipping* half is 8.2 %
and was previously hidden inside the combined `pslg` column.

---

## 6. Raw 10k stage JSON (replica, median rep)

```json
{
  "pslgPoints": 5184,
  "pslgSegments": 15265,
  "prepPoints": 5184,
  "prepSegmentsBeforeSplit": 15265,
  "prepSegmentsAfterSplit": 15265,
  "recoverySegments": 15265,
  "recoveryInitialMissing": 2529,
  "recoveryFlips": 2529,
  "findEdgeCalls": 33059,
  "findEdgeTriScans": 168081852,
  "findEdgeMs": 673.2,
  "crossingMapBuilds": 2529,
  "crossingMs": 2587.8,
  "meshFilterCalls": 5058,
  "steinerRequests": 0,
  "legalizePasses": 1,
  "legalizeFlips": 0,
  "legalizeEdgeMapRebuilds": 1,
  "rounds": 1,
  "ownershipLocateCalls": 17572,
  "seamLocateCalls": 432,
  "zLocateCalls": 12887,
  "outputVertexCount": 5184,
  "outputTriangleCount": 10082
}
```

---

## 7. Consequences for 18Z

1. Any fast path that does not touch `recoverConstrainedEdges` leaves ~80 % of the 10k cost
   untouched. Recovery indexing is the primary target.
2. `splitAtInteriorVertices` (4.0 %) and Base-edge clipping (8.2 %) are real, independent O(n²)
   hosts and are cheap to fix in isolation.
3. Ownership/Z locate (7.8 % combined) is the secondary target; the shared fix is to stop
   rebuilding `keyOf(x, y)` string keys and to reuse the ownership classification for Z.
4. `legalizeTin` should not be optimized first (0.10 %). Component partitioning is justified by
   `disjoint`, not by partial-seam.
