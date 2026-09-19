# Phase 18M — LandXML browser/production performance evidence

Measurement only — no `src/` behavior changes. Two probes:

- **Engine probe** (`scripts/phase18mLandxmlPerf.ts`, run with
  `npx tsx scripts/phase18mLandxmlPerf.ts [--quick]`): deterministic explicit-TIN
  LandXML generated at test time (`tests/landxmlLargeTinFixtures.ts`, never
  committed), split into the production stages.
- **Browser QA** (`tests-browser/cad-landxml-18m.spec.ts`): Playwright on
  Chromium, dev server, zero page/console errors.

Run: 2026-09-19, Node + tsx, Chromium headless (Playwright), `workers: 1`.

## 1. Engine stage timings (median of 3 runs)

Grid TIN, two triangles per cell, plane `z = 100 + 0.01x + 0.02y`. Stages are
exactly the production path: fs read → `buildLandXmlImportPreview`
(parse + review projection) → `commitLandXmlImport` ONE transaction with
`deferMeshBuild` → `buildCadSurface` materialization → first interaction
(`getSurfaceElevationAt`).

| vertices | faces | XML KiB | read ms | review ms | commit ms | build ms | first touch ms | heap MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 000 | 19 602 | 782 | 0.8 | 157.3 | 8.2 | 72.7 | 0.027 | 83.7 |
| 50 000 | 99 102 | 4 251 | 3.8 | 934.1 | 24.4 | 341.0 | 0.043 | 388.3 |

Notes:

- **Parse/review dominates**: ~0.16 s at 10k and ~0.93 s at 50k. The importer
  validates every face (CCW, duplicate, manifold edge) and builds the compact
  metre arrays, so cost scales linearly with the file's face count.
- **Commit is cheap** (8–24 ms) because mesh materialization is deferred: the
  transaction validates the payload and appends entities/surfaces, and the
  imported-TIN mesh is scheduled on the shared `SurfaceBuildService` queue.
- **Materialization scales with topology** (73 ms at 10k, 341 ms at 50k,
  ~3.4 µs/triangle) — off the interaction thread when the worker path is used.
- **First interaction is sub-millisecond** at both sizes: the face-indexed
  elevation grid answers immediately from the built mesh.
- `28.8 ms/1k vertices` review cost at 10k, `18.7 ms/1k` at 50k (per-vertex
  amortization improves with grid depth, not per-file overhead).
- `heap MiB` is the process heap after the scale's three un-forced-GC runs
  (retained preview + mesh + Node baseline), an upper bound rather than a
  per-import figure. It is not a persistent cost: the mesh cache is
  session-only and cleared on reopen (§67 below).

## 2. Browser QA

`npx playwright test tests-browser/cad-landxml-18m.spec.ts` → **15 passed,
1 fixme** (`18M-F`, no stable alignment-station UI hook; the equation is
engine-pinned). 18M-I (undo, no resurrection) and 18M-J (redo restores
definitions as honest UNBUILT until rebuilt) are active after the undo-seam
fix: the external-adopt history effect compared plain `JSON.stringify`
signatures, so the drawing-sync clone's normalized imported-TIN key order
read as an external update and wiped the import transaction. The effect now
compares order-insensitive signatures; undo during an in-flight build still
orphans that build by design (service ownership discards it). The active set
covers menu launch, `LANDXMLIMPORT` alias launch, selection scoping,
one-transaction commit, BUILDING → CURRENT via the worker, elevation inquiry,
profile-from-imported-pair, undo/redo, save/reopen (UNBUILT on reopen),
Export Center re-export, duplicate reimport, drawing-switch staging release,
and both 50k-vertex staging and commit/build runs with zero page/console
errors.

## 3. Parse-thread decision (§36)

**Decision: keep `buildLandXmlImportPreview` on the main thread for 18M, with
a documented size threshold; a dedicated parse worker is the next increment.**

Rationale:

- The parse is a **pure, DOM-free, one-shot user action** — the same shape as
  the existing WNCAD-open parse, which is also synchronous.
- At the typical explicit-TIN corpus size (≤10k vertices, ≤800 KiB) the review
  projection costs ~0.16 s, inside the acceptable modal-open budget.
- At 50k (4.25 MiB, ~0.93 s) the main thread freezes long enough to be felt.
  Because the review UI needs a synchronous `LandXmlImportPreview`, moving
  parse to a worker requires an async staging state + a busy indicator, not a
  one-line change.
- The commit/materialization half is already asynchronous
  (`deferMeshBuild` + `SurfaceBuildService`), so only the parse/review half
  remains on the main thread.

Trigger for the parse-worker increment: **file > ~2 MiB or > ~20k vertices**,
or any user report of a perceptible hang. The importer's only dependency is
`parseXmlDocument` (already isolated), so a `landXmlParseWorker` can host it
without engine changes.

## 4. Memory notes (§67)

- Imported TINs persist as compact arrays only: `vertices` (3 numbers/point)
  and `faces` (3 indices/triangle) plus provenance. A 50k-vertex TIN is
  ~150k vertex numbers + ~297k face indices in memory, and 4.25 MiB of source
  XML during the one-shot parse.
- The retained mesh (points/triangles/adjacency/grid) lives in the
  session-scoped `CadSurfaceCache`, keyed by surface id + content revision. It
  is **never serialized into WNCAD** and is cleared on reopen, so saved files
  carry topology only and reopen derives an honest UNBUILT status until the
  worker rebuilds.
- Late/stale worker results are discarded by revision match, so a drawing
  switch or a re-edit cannot resurrect an old mesh.
- For large imports, budget roughly `~8 KiB/vertex` of transient heap (preview
  + mesh combined, un-forced GC); the mesh is released with the session cache.

## 5. Reproduction

```bash
npx tsx scripts/phase18mLandxmlPerf.ts            # 10k + 50k
npx tsx scripts/phase18mLandxmlPerf.ts --quick    # 10k only
npx playwright test tests-browser/cad-landxml-18m.spec.ts
```

No tier classification: the probe is a manual `scripts/` program, so
`scripts/testTiers.ts` membership is untouched. The 50k staging Playwright
case is an explicit UX check, not a runtime gate.
