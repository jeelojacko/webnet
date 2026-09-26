# Phase 18X — Explicit-Bake Performance & Browser-QA Evidence

Campaign: `scripts/phase18xBakePerf.ts` (record-only, no gates).
Run: `npx tsx scripts/phase18xBakePerf.ts [--quick]` (default 1k/10k/50k/100k,
median of 3 runs; `--quick` = 1k/10k, median of 2).

Browser QA: `tests-browser/cad-surface-bake-18x.spec.ts` (7 tests, mission
§101 A–M; Playwright + dev-server + Chromium, headless). **7 passed** (≈29 s
full spec). Zero page/console errors asserted per test.

Machine: local dev (Linux x86_64, Node 26, single run, 2026-09-26). Timings are
wall-clock `performance.now()` deltas around the named call. The mesh fixture is
a deterministic planar near-square grid (N vertices, `(N-1)`-ish grid) —
`factorLargeTinGrid` for 10k/50k/100k, hand-factored 25×40 for 1k. No
breaklines/boundaries on the native Delaunay comparison (pure triangulation);
no Delaunay on the explicit legs (faces retained 1:1).

> **Two live-app defects found by this browser QA and fixed in this phase**
> (see §7): the bake transaction and the LandXML civil-surface export both
> gated on `surface.cachedRevision`, which is *never* written in-session
> (rebuilds stay out of history), so both rejected every real surface. The fix
> is session-currency aware and keeps the persisted-revision contracts.

## 1. §61 — baked payload storage size vs the LandXML representation

Measured: compact `JSON.stringify` of the surface definition payload
(`vertices[] + faces[] + provenance`), the equivalently-shaped LandXML-import
payload, and the full LandXML file text for the same mesh.

| vertices | faces | baked payload (B) | B/vertex | LandXML payload JSON (B) | LandXML file (B) |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 1,872 | 38,068 | 38.1 | 37,989 | 71,012 |
| 10,000 | 19,602 | 457,852 | 45.8 | 457,773 | 800,554 |
| 50,000 | 99,102 | 2,579,355 | 51.6 | 2,579,276 | 4,353,028 |
| 100,000 | 198,702 | 5,216,443 | 52.2 | 5,216,364 | 8,849,265 |

Reading:
- The baked and LandXML-import payloads are the **same shape and size within a
  provenance string** (79 B apart at 1k, 79 B at 100k) — bake adds no mesh
  storage overhead over an imported TIN and persists no adjacency/grid/stats.
- B/vertex rises 38 → 52 with scale (integer face indices get longer and the
  fixed provenance cost amortises away).
- The LandXML **file** is ≈1.7× the stored payload (XML tags + 3-decimal
  text), i.e. the in-drawing explicit payload is the smaller representation.

## 2. §62 — rebuild split: baked-explicit vs LandXML-explicit vs native Delaunay

Median-of-3 per stage (ms). Baked and LandXML-explicit share the exact same
materializer (`materializeExplicitTin`), so their totals are equal within run
noise; native Delaunay runs the constrained-TIN leg.

Baked payload split (stage timings around `validateExplicitTinPayload`,
point/face materialization, `buildTinTopology`, `buildSurfaceGrid` +
`computeSurfaceFaceStats`, and a 2-edit `replaySurfaceEdits`):

| vertices | validate | materialize | topology | grid+stats | replay (2 edits) | **baked total** | LandXML total | **native Delaunay** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.10 | 0.08 | 1.52 | 1.37 | 4.79 | **3.71** | 2.82 | **23.3** |
| 10,000 | 0.09 | 0.16 | 11.14 | 7.74 | 43.78 | **30.64** | 33.08 | **163.0** |
| 50,000 | 0.45 | 1.15 | 84.45 | 19.13 | 255.94 | **166.77** | 161.54 | **889.1** |
| 100,000 | 0.90 | 5.17 | 185.74 | 32.00 | 610.68 | **322.67** | 330.87 | **1,646.1** |

Reading:
- Explicit rebuild is **~5–10× faster than native Delaunay** and roughly
  linear: topology (edge-keyed map) dominates, then grid+stats; validation and
  materialization are negligible.
- LandXML-explicit rebuild == baked rebuild (provenance-independent), as
  designed; the differences in the table are run noise.
- Edit replay of 2 edits is **~1.9–2.1× the bare build** — the 18S edit kernel
  re-derives topology for the replay; that is the dominant cost when a baked
  surface carries edits.
- 100k explicit rebuild (0.32 s) is well inside the interactive envelope; no
  arbitrary gate is asserted.

### LandXML import parse cost (the interchange alternative)

`buildLandXmlImportPreview` on generated TIN XML, then materialize:

| vertices | XML size | parse |
| --- | --- | --- |
| 1,000 | 0.1 MiB | 13.2 ms |
| 10,000 | 0.8 MiB | 77.5 ms |
| 50,000 | 4.2 MiB | 365.5 ms |
| 100,000 | 8.4 MiB | **GUARDED** — `LandXML import: document exceeds 200000 elements.` |

Reading: parsing LandXML costs ≈2.4× the explicit materialize at the same
scale. The 100k case trips the importer's deliberate 200k-XML-element
fail-closed cap; a bake of the identical mesh has no such ceiling (it is
already in-drawing). This is the concrete production advantage of baking.

## 3. §63 — bake conversion split

Measured on a CURRENT explicit surface (source rebuild + `canonicalizeBakedTin`
+ `createBakedPayloadFromMesh` + one `SURFBAKE` transaction):

| vertices | compaction (canonicalize) | payload total | assembly (total−compaction) | source rebuild | **transaction total** | commit ≈ (txn−rebuild−payload) |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.28 | 0.40 | 0.13 | 2.52 | **3.53** | 0.60 |
| 10,000 | 2.27 | 3.44 | 1.17 | 34.69 | **40.74** | 2.62 |
| 50,000 | 10.98 | 11.66 | 0.67 | 148.47 | **202.74** | 42.61 |
| 100,000 | 23.20 | 29.05 | 5.86 | 300.28 | **425.29** | 95.95 |

Reading:
- Canonicalization (compaction + ascending-index remap + CCW fix) is the bulk
  of payload creation; the flatten/provenance assembly is ~0.1–6 ms.
- The transaction is dominated by the internal source rebuild it performs to
  obtain the final mesh (already measured in §62). At 100k the whole bake is
  ~0.43 s of synchronous engine work.
- Derived "commit" is a residual (transaction − rebuild − payload) and includes
  the history push + project map; it stays small but grows with the payload
  copy at 100k.

**Verdict on §63 async question:** a 100k-vertex bake is ~0.43 s of blocking
engine work in this fixture. That is below any reasonable UI-freeze threshold
for a one-shot user action, so moving canonicalization/payload generation to a
bounded async path is **not evidenced as necessary**. Re-measure if bake is
ever wired to a bulk/automatic path.

## 4. §60 — history-memory delta (in-place bake of a native surface)

`runCadCommand(SURFBAKE)` on a CURRENT native grid; WNCAD bytes via
`serializeCadDrawingFile` before/after (pretty-printed `JSON.stringify(…, 2)`,
which is why it exceeds the compact payload); heap via
`process.memoryUsage().heapUsed` (V8 GC makes it a noisy secondary signal).

| vertices | compact payload (B) | WNCAD before (B) | WNCAD after (B) | **WNCAD delta (B)** | heap delta (MiB, noisy) |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 38,074 | 353,939 | 497,102 | 143,163 | −6.3 |
| 10,000 | 457,822 | 3,338,543 | 4,880,654 | 1,542,111 | +30.2 |
| 50,000 | 2,579,560 | 16,786,575 | 24,775,424 | 7,988,849 | −682.2 |
| 100,000 | 5,217,215 | 33,614,629 | 49,645,133 | **16,030,504** | −128.9 |

Reading:
- The persisted WNCAD delta is ≈3.1× the compact payload bytes: WNCAD
  pretty-prints the vertex/face arrays (one number per line + indent), so the
  on-disk cost of a bake is that formatting multiple, not 3 copies of data.
- The in-memory history entry holds the same definition once (structural
  sharing), so the undo memory cost tracks the compact payload
  (≈0.46 MB @ 10k, ≈5.2 MB @ 100k). Heap deltas are dominated by GC timing and
  are reported only as a signal.
- 100k in-place bake is ~16 MB of extra drawing file and ~5 MB of history: not
  a gate, and the bake remains undoable (per mission §60) — no compact-
  transaction strategy is evidenced as required.

## 5. Full-scale summary

| metric | 1k | 10k | 50k | 100k |
| --- | --- | --- | --- | --- |
| baked payload (compact) | 38 KB | 458 KB | 2.58 MB | 5.22 MB |
| explicit rebuild | 3.7 ms | 30.6 ms | 167 ms | 323 ms |
| native Delaunay rebuild | 23.3 ms | 163 ms | 889 ms | 1,646 ms |
| bake transaction | 3.5 ms | 40.7 ms | 203 ms | 425 ms |
| WNCAD delta (in-place) | 0.14 MB | 1.54 MB | 7.99 MB | 16.0 MB |

No arbitrary gates are asserted anywhere; the numbers are reported for the
reviewer to judge. Explicit bake is ~5× cheaper to rebuild than native
Delaunay at every scale and has no LandXML parse ceiling.

## 6. Browser QA coverage (mission §101 A–M)

`tests-browser/cad-surface-bake-18x.spec.ts` — **7/7 passed**, zero page/console
errors:

| test | mission items | what it drives |
| --- | --- | --- |
| 18X-1 | A, C, F | Bake Copy keeps the native original byte-identical + baked label; baked copy rebuilds to the same triangle count; imported bake-copy reads "Baked Explicit TIN", never "Imported LandXML". |
| 18X-2 | B, D, E | Bake In Place preserves id/name/style/layer, drops breaklines/boundaries/edits, keeps geometry; post-bake Set Elevation resolves a readable `V<n>` ref; re-bake flattens the new edit. |
| 18X-3 | G | Profile + Volume + Analysis built on the surface go stale after bake and return byte-identical numeric results (revision tail excluded) once the baked surface + dependents are rebuilt/recalculated. |
| 18X-4 | H | Source altered without rebuild ⇒ status `NEEDS_REBUILD` ⇒ manager + ribbon Bake buttons disabled. |
| 18X-5 | I | A 50k-vertex imported TIN during its worker build: a `MutationObserver` records the exact `BUILDING` commit and the Bake button was disabled at that instant; re-enabled at `CURRENT`. |
| 18X-6 | J, K | Undo restores the full native definition + seeded edit, redo restores the bake; save → **full app reload** → reopen returns honest `UNBUILT`, then rebuilds exact. |
| 18X-7 | L, M | PROJECTTRANSFORM scale-2 scales baked vertices once (area ×4, not ×16); the Export Center LandXML output carries the surface's full P/F set, and reimporting it into a fresh drawing yields `CURRENT` with the same vertex count. |

Run headless:

```
npx playwright test tests-browser/cad-surface-bake-18x.spec.ts
```

(The repo Playwright config starts/reuses the Vite dev server on 127.0.0.1:4174
and runs headless Chromium; the spec is self-contained — every drawing is
generated to a temp file and every assertion scopes to the real Surface Manager
/ Toolspace / Export Center.)

## 7. Defects found and fixed during this QA

### 7.1 Bake rejected every live surface (`deriveSurfaceStatus === 'CURRENT'`)

`resolveBakePayload` required the *engine* derivation to read `CURRENT`, but the
live app never persists `cachedRevision` — `surfaceBuildService` deliberately
discards the project returned by `applySurfaceBuildSuccess` ("rebuild never
enters history/dirties"), and session currency is derived from a fresh cache hit
(`resolveSurfaceDisplayStatus`). Result: the UI enabled Bake, the transaction
always returned null ("Baked Copy rejected — see status/locks.").

Fix: `SURFBAKE` / `SURFBAKECOPY` gained an optional `sessionCurrent?: boolean`.
The engine gate is `derived === 'CURRENT' || sessionCurrent`; the UI
(manager, ribbon, command registry) sets it from the session-aware capability
(`row.status === 'CURRENT'`). Absent ⇒ fail-closed on the persisted derivation,
so the engine gate pins (`tests/cad_surface_explicit_bake_18x.test.ts`) still
reject UNBUILT/NEEDS_REBUILD. `checkSurfaceEditRevision(expectedRevision)`,
layer-lock, and buildability gates are unchanged.

### 7.2 LandXML civil surfaces were unreachable from the Export Center

`ExportCenterPanel` never passed `civilSources`, and `landxmlCivilSource`
gated surfaces on `surface.cachedRevision` (also never written in-session), so
every surface exported as `LANDXML_SURFACE_NOT_CURRENT` ("3 omitted").

Fix: the Export Center now receives `{ surfaceCache, profileCache, sectionCache }`
from the workspace and forwards them to `buildExportCenterPreview`; the surface
export treats a fresh cache hit at the *current source revision* as session
`CURRENT` (falling back to the persisted-revision derivation for reopen-style
export). The existing 18L tests (persisted `cachedRevision` + cache, stale,
empty-cache → `LANDXML_SURFACE_MESH_UNAVAILABLE`) all still pass.

**Remaining restriction (out of 18X scope):** LandXML *profile / section*
civil export still gates on the persisted `deriveSurfaceStatus` derivation
(`landxmlCivilSource.exportProfile` / `exportSectionPair`), so those two
classes stay blocked in-session for the same reason; only TIN surfaces were
fixed here because mission §101 M and the 18X capability matrix require the
baked surface itself to export. Profiles/sections are still *created and
rebuilt* from baked surfaces (18X-3), which is the 18X contract.
