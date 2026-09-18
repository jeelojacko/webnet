# Phase 18G — surface browser performance measurements

Methods: `npx tsx scripts/phase18gSurfacePerf.ts` (Node 22, this machine;
request / worker-build / transfer / ingest / display-prep splits through
the production modules, 1 warm-up + 5 measured runs, median) and
`npx tsx scripts/phase18gSurfaceBrowserPerf.ts` (headless Chromium against
`npm run dev -- --host 127.0.0.1 --port 4174`; ack → CURRENT through the
real manager Rebuild plus in-page splits of the shipped modules).
Fixture: deterministic 18F-style grids behind two overlapping point groups
(union path exercised). Browser numbers are the verdict; Node is
supplemental. Sibling slice owns `tin/` + worker/display internals; all
18G-B/C browser QA for the covered scales is green.

## 1. Production-path timings (browser, ack → CURRENT)

| points | ack→CURRENT | first-frame¹ | in-page worker² | tris |
| --- | --- | --- | --- | --- |
| 1,000 | 375 ms | 6.0 ms | 22.4 ms | 1,983 |
| 10,000 | 1,507 ms | 20.5 ms | 152.4 ms | 19,962 |
| 20,000 | 3,869 ms | — | — | — |
| 30,000 | 5,751 ms | — | — | — |

¹ Completion → 2× rAF (residual paint; React has rendered by CURRENT).
² Same builder the worker runs, timed in-page for scale (not the live hop).

The ack→CURRENT gap over the in-page worker time (≈1.3 s at 10k) is the
worker-thread hop + structured-clone transfer + cache ingest + React
re-render (screen-space path projection over the full edge string + symbol
nodes) + status publish — not the triangulation.

## 2. Engine splits (Node supplemental)

| points | request | worker | transfer³ | ingest | edges⁴ | total | tris |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.0 | 1.7 | 0.2 | 0.2 | 0.2 | 2.4 | 187 |
| 1,000 | 0.2 | 14.6 | 2.4 | 2.9 | 2.6 | 22.6 | 1,980 |
| 10,000 | 1.1 | 130.6 | 18.2 | 22.9 | 21.8 | 194.6 | 19,978 |
| 50,000 | 5.6 | 766.7 | 94.2 | 113.4 | 188.0 | 1,167.9 | 99,967 |

³ `structuredClone` of the worker payload (points/tris/stats/grid/
adjacency/edgeKinds). ⁴ Triangles + boundary path-D generation.

Growth is ~linear through 50k on the main-thread equivalents; the worker
hop itself adds no superlinear term (browser worker ≈ Node worker:
834 ms vs 767 ms at 50k, measured directly).

## 3. Stress verdicts (build capability vs display limit, stated separately)

- **100k: engine build OK after the 18G stack fix** (Node worker-build
  1,684.5 ms, 199,973 triangles; small-stack 984 KiB probe ok). It had
  thrown `RangeError: Maximum call stack size exceeded` from argument
  spreads (`tinBase.ts:33-34,39`, `cadSurfaces.ts isCollinearWorld`)
  — fixed with loop-identical min/max (zero numeric change; all 94
  surface tests green).
- **50k: production worker build OK after the fix**: real Chromium
  production path ack→CURRENT **10,757 ms** (in-page splits: request
  4.9 ms / worker-build 879.1 ms / transfer 130.6 ms / ingest
  112.7 ms / display-prep 180.4 ms / first-frame 6.3 ms; 99,965
  triangles; xfer 9,149 KiB; heap 415 MiB; **zero page errors**).
  The earlier `Maximum call stack size exceeded` FAILED was the same
  spread bug manifesting on the smaller worker-thread stack (clone +
  postMessage of the 9 MB payload had already been proven fine).
  Small-stack (984 KiB) Node probes pass at both 50k and 100k via the
  exact worker function.
- **Display limit is separate and lower**: opening a 50k-point drawing
  takes ~20 s (50k SVG point-symbol nodes), independent of the worker
  result. The triangle path itself is one SVG node at any scale.

## 4. Mesh memory by representation (Node JSON-byte accounting)

| points | vertices | triangles | adjacency | edge flags | grid index | transfer total | display tri path D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | 878.5 KiB | 325.2 KiB | 357.6 KiB | 156.1 KiB | 340.5 KiB | 1,717.8 KiB | 2,129 KiB |
| 50,000 | 4,463.2 KiB | 1,887.3 KiB | 1,919.9 KiB | 781.0 KiB | 1,006.7 KiB | 9,051.8 KiB | 10,822 KiB |

Duplicate representations (flagged, all session-only):

1. Vertices exist 4× transiently: worker mesh + in-transit clone +
   cache deep copy + display path string (coordinates as text — the
   single largest representation at scale).
2. Boundary edges are emitted in BOTH path strings (triangles path +
   boundary path overlap).
3. `grid` + `adjacency` + `edgeKinds` cross the worker boundary but the
   display path does not consume them (query/18H seam only).

## 5. Display-edge generation split + recommendation

At 50k, main-thread edge work totals ≈300 ms (transfer 94 + ingest 113 +
edge-gen 188 in Node; the adapter rebuilds the unique-edge map from
triangles, then walks it twice for the two path strings). The worker
already materializes adjacency, so unique-edge extraction there is ~free;
a compact edge list (unique edges + boundary flag) would remove the
main-thread map build and the cross-string duplication at a transfer cost
of ≈ +2 MB (≈ +20 ms at the measured 10 ms/MiB). **Recommendation
(quantified, for the worker/display slice — not implemented here): have
the worker return compact edge lists; keep the TIN itself untouched.**
No LOD, no data change.

## 6. Transferable-Buffer evaluation

Measured (same payload as typed arrays, MessageChannel handoff):

| points | plain-array clone | transferable handoff |
| --- | --- | --- |
| 1,000 | 0.4 ms | 0.0 ms |
| 10,000 | 2.7 ms | 0.1 ms |
| 50,000 | 90 ms (clone) / 48 ms (post) | — (protocol is plain arrays) |

Recorded behavior: `postMessage` structured-clones (worker and main each
hold a full mesh transiently); nothing is transferred today.
**Verdict: do not adopt.** Transferables would save ≈50–90 ms at 50k on
the worker→main hop only — under 10% of ack→CURRENT, while requiring a
typed-array worker protocol (contract break, sibling-owned) and leaving
ingest deep-copies and render untouched. No SharedArrayBuffer: it would
require cross-origin isolation headers the app does not set — out of
scope, no action.

## 7. Rendering policy (communicated, conservative — no code change)

Audit of 50k+ edge rendering: NO viewport-bounds filtering, NO
off-screen suppression — one SVG path carries every unique edge
(`toScreenD` regex-projects the full string per render); only vertex
NODES are capped (`SURFACE_DISPLAY_VERTEX_CAP = 2000`). Picking verified
coarse (18G-C: ≤2 paths per surface, click → surface object, zero
per-triangle nodes) — no change needed there.

Policy (thresholds from §§1–3; TIN data never altered; no LOD):

- ≤10k points: fully fluid production path (≈1.5 s rebuild at 10k).
- 10–30k: workable (≈6 s rebuild at 30k); prefer one surface per
  area of interest over a single huge surface.
- 30–50k: worker build proven (≈11 s ack→CURRENT at 50k, UI
  responsive throughout); the interaction cost is the display wall
  below, not the worker.
- 50k+: display wall (path-string + symbol render); use layer OFF to
  hide derived layers, `maxEdgeLength` build options, and smaller
  surfaces. Viewport-bounds edge filtering in the display adapter is the
  sanctioned next step if 50k+ interaction is required (never TIN LOD).

No display-code change in this slice: the policy is documented here and
exercised by the 18G-C responsiveness spec (operability, never exact ms).
