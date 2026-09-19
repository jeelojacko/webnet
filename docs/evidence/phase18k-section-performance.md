# Phase 18K sample-line / cross-section performance

Measurement only. Deterministic synthetic grid TINs (mulberry32, fixed
seeds `0x18c1`/`0x18c2`/`0x18c3` — no unfixed randomness): planar
`z = 100 + 0.5i + 0.3j + jitter`, two (or three) surfaces share the XY
footprint with a Z offset so cut/fill overlays exist. Triangulation is an
exact regular grid (2 tris/cell); the candidate index is built with
`buildSurfaceGrid` (the exact fn the surface builder uses). A straight
alignment spans the grid exactly (`x = minX..maxX`, `startStation = 0`);
sample lines are `count` evenly spaced perpendicular lines, each with
`leftWidth = rightWidth = 0.9 * maxY / 2` so every line is fully covered
(`coveredMin > 0` verified per case). Skew alternates 0°/15°.

Method: `npx tsx scripts/phase18kSectionPerf.ts` (3 measured runs per
scale, median wall-time, Node 22 Linux x64 this machine; whole probe
~22 s, per-scale time budget 120 s). Whole-file run:
`npx tsx scripts/phase18kSectionPerf.ts [--quick]`.

Cost split (mirrors the production path exactly):

| column | what it measures |
| --- | --- |
| `prepMs` | request assembly incl. the `toSectionMesh` flat-array conversion `SurfaceSectionService.requestInternal` runs |
| `cloneMs` | `structuredClone(request)` — structured-clone proxy for the postMessage transfer to the worker |
| `workerMs` | one batched `sections` op through `createSurfaceWorkerHandler` with the DEFAULT engine extractor (real tangent + skewed frame + `extractTinAlongSegment` walk), incl. worker-side `parseSectionMesh` |
| `resultMs` | `structuredClone(results)` — result-transfer proxy back to the main thread |
| `ingestMs` | `applySectionExtractionSuccess` + `cache.get` per line×source pair |

The process fails only when a fixture/extract throws, a pair count is wrong,
or worker results are non-deterministic between runs. No timing is gated.
No `src/` behavior changes.

## 1. Group extraction matrix (TIN × sample lines, 2 sources each)

| case | tris | prepMs | cloneMs | workerMs | resultMs | ingestMs | pairs | samples | coveredMin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1k/10 | 1,012 | 0.1 | 1.1 | 4.0 | 0.7 | 0.06 | 20 | 800 | 179.8 |
| 1k/100 | 1,012 | 0.0 | 0.9 | 20.8 | 5.9 | 0.17 | 200 | 7,882 | 107.8 |
| 1k/500 | 1,012 | 0.1 | 1.2 | 66.7 | 28.6 | 0.86 | 1,000 | 39,356 | 100.8 |
| 10k/10 | 10,082 | 0.4 | 5.0 | 8.2 | 1.6 | 0.02 | 20 | 2,526 | 568.9 |
| 10k/100 | 10,082 | 0.4 | 5.1 | 61.3 | 16.4 | 0.19 | 200 | 24,882 | 346.7 |
| 10k/500 | 10,082 | 0.3 | 5.5 | 304.4 | 88.3 | 1.08 | 1,000 | 124,198 | 325.0 |
| 50k/10 | 50,244 | 2.8 | 13.4 | 30.3 | 3.5 | 0.02 | 20 | 5,576 | 1,269.5 |
| **50k/100** | 50,244 | 2.8 | 13.4 | **252.6** | 36.0 | 0.21 | 200 | 54,876 | 771.8 |
| 50k/500 | 50,244 | 3.6 | 13.6 | 1,244.4 | 212.9 | 1.10 | 1,000 | 273,622 | 723.3 |
| 100k/10 | 100,352 | 5.4 | 23.1 | 58.9 | 5.0 | 0.02 | 20 | 7,874 | 1,794.8 |
| **100k/100** | 100,352 | 7.3 | 25.2 | **482.0** | 51.5 | 0.24 | 200 | 77,520 | 1,093.7 |
| 100k/500 | 100,352 | 8.5 | 23.4 | 2,402.2 | 291.2 | 1.11 | 1,000 | 386,946 | 1,025.3 |

Mandatory realistic pairs (50k×100 and 100k×100) complete the worker batch
in **~253 ms** and **~482 ms** respectively (200 line×source pairs each).
The two heaviest main-thread costs in that path are the transfer in
(`cloneMs` 13–25 ms) and the result transfer back (`resultMs` 36–52 ms) —
both one-shot per group batch, not per line.

Scaling reads:

- **Mesh term (clone/transfer) is O(mesh), paid once:** `cloneMs` grows with
  the mesh (1 ms @1k → 25 ms @100k) and is essentially flat in line count
  (13.4 vs 13.6 ms at 50k for 10 vs 500 lines). This is the batching gate.
- **Extraction term is O(lines × sources × walk events):** `workerMs` grows
  ~linearly in lines at fixed mesh (1k: 4.0 → 20.8 → 66.7 ms for 10 → 100 →
  500 lines) and with mesh size at fixed lines (100 lines: 20.8 → 61.3 →
  252.6 → 482.0 ms from 1k → 100k). ~1.2–2.5 ms per line×source pair at the
  realistic scales.
- **Request prep is negligible** (`toSectionMesh`: ≤8.5 ms even for two
  100k meshes) and does not depend on line count.
- **Cache ingest is flat microseconds-to-~1 ms** (`Map` set+get per pair);
  no scaling concern.
- 100k×500 is a soak/evidence stress case (2.4 s of worker CPU for 1,000
  pairs); it stays off the producer thread and outside the agent tier.

## 2. Batching proof — mesh not recopied per line

Same physical work (50,244-tri TIN, 100 sample lines, 2 sources) driven two
ways: one batched request (mesh once + all lines) vs 100 per-line requests
(each re-carrying the same mesh once).

| path | cloneMs | workerMs | requests | mesh copies |
| --- | --- | --- | --- | --- |
| batched | **13.7** | 258.4 | 1 | 2 |
| per-line (×100) | **1,374.3** | 491.1 | 100 | 200 |

- Transfer cost ratio per-line / batched = **100.6×** — exactly proportional
  to the line count. The batched request's structured clone is O(mesh); a
  per-line loop is O(mesh × N).
- Worker ratio = **1.9×** (491 vs 258 ms): the handler materialises each
  source mesh once (`parseSectionMesh`) and reuses the same mesh object for
  every line, so the per-line loop pays `O(mesh)` parsing N times on top of
  the same line walks.
- Result count matches `lines × sources` in both paths (200), and the
  handler posts exactly one `sections-success` per batch.

## 3. Multi-surface (100 lines × 2 vs × 3 sources, 50,244 tris)

| surfaces | cloneMs | workerMs | ms per pair | results | mesh copies |
| --- | --- | --- | --- | --- | --- |
| 2 | 13.3 | 252.3 | 1.26 | 200 | 2 |
| 3 | 20.3 | 376.4 | 1.25 | 300 | 3 |

Adding a third surface adds one mesh copy to the single request
(13.3 → 20.3 ms clone) and one more extraction per line (`ms/pair` stays
~1.25). No per-line or per-surface request multiplication at any source
count.

## 4. Section-view prep (aggregated grid + paths + bounded labels)

10,082-tri TIN, 100 lines × 2 sources CURRENT in the cache, one section
view per line (both surfaces, cut/fill on, 10 m offset grid / 1 m elevation
grid), `maxLabels` default 200.

| views | ms | ms/view | layers | trace paths | offset ticks | elevation labels | labels truncated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 2.16 | 0.216 | 10 | 20 | 554 | 222 | false |
| 50 | 9.36 | 0.187 | 50 | 100 | 3,074 | 1,238 | false |
| 100 | 17.52 | 0.175 | 100 | 200 | 6,133 | 2,459 | false |

View prep is ~0.18 ms/view and linear: grid, one aggregated path per source,
and bounded labels are emitted in a single pass with no per-view rescan of
the TIN. 100 views cost ~18 ms — one frame.

## 5. Plan display (500 sample lines aggregate + label bounding)

| maxLabels | ms | lines | labels shown | labels truncated | bounds |
| --- | --- | --- | --- | --- | --- |
| 200 (default) | 1.13 | 500 | 200 | true | true |
| 500 | 0.86 | 500 | 500 | true | true |
| 0 (geometry only) | 0.61 | 500 | 0 | true | true |

All 500 line geometries aggregate in ~1 ms and the label budget is honoured
exactly (200 / 500 / 0). Geometry is never truncated by the label cap; only
label text is bounded, which is the documented plan-display contract.

## 6. Worker responsiveness / UI-responsiveness design

**Expectation:** section extraction runs entirely inside the surface worker
(`sections` op → real engine tangent/frame/walk). The producer thread's
per-batch cost is request prep + one structured clone in
(`prepMs + cloneMs`) and one result clone out (`resultMs`). For the realistic
GO pairs that is ~16 ms in and ~36 ms out at 50k×100, and ~33 ms in and
~52 ms out at 100k×100 — bounded, one-shot, and independent of line count on
the input side. The heavy CPU (252–482 ms, up to 2.4 s for the 100k×500
stress case) stays off the main thread.

**UI-responsiveness design (already in the architecture; no new harness):**
the derived layer adapters (`buildSampleLineDisplayLayers`,
`buildSectionViewDisplayLayers`) are pure, aggregated (one path per source
per view), and label-bounded (§4–5: ~0.18 ms/view, ~1 ms for 500 plan
lines). Section results are applied through
`applySectionExtractionSuccess` only when CURRENT (stale/late never apply),
so a stale worker batch cannot churn the UI. Batching means ONE worker
response per group edit, not one per line, so the main thread is not woken
N times. No additional responsiveness measurement harness is required
beyond this evidence and the existing browser flows A–F.

## Verdict

- Batched cross-section extraction meets the GO-level batching gate: mesh
  transfer is O(mesh) once (100.6× cheaper than the per-line anti-pattern at
  100 lines) and per-pair cost is ~1.25 ms on a 50k TIN.
- Realistic 50k×100 and 100k×100 batches finish in the worker in ~0.25 s /
  ~0.48 s with ~0.05 s of one-shot main-thread transfer each; the 100k×500
  stress case (2.4 s worker) remains an evidence-tier campaign, never an
  agent-tier gate.
- Section-view and plan-display preparation is linear and bounded
  (~0.18 ms/view, ~1 ms for 500 plan lines) with honest label truncation and
  never-truncated geometry.
- No production behavior, tolerances, or math were changed for this probe.
