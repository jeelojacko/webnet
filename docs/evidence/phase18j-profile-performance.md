# Phase 18J Profile Performance Evidence

Measurement only — no `src/` behavior changes. Probe:
`scripts/phase18jProfilePerf.ts` (`npx tsx scripts/phase18jProfilePerf.ts`;
`--quick` runs the 1k/10k subset). Deterministic synthetic grid TINs
(mulberry32 seed `0x18c1`): planar `z = 100 + 0.1x + 0.05y` plus ±1
jitter, two triangles per cell, engine grid index via `buildSurfaceGrid`.
Median of 3 runs; worker column is the exact profile worker op
(`createSurfaceWorkerHandler` + default engine extractor) round trip;
the run fails only on throw or worker-vs-direct mismatch.

Run: 2026-09-19, Node + tsx, heap as printed per row.

| case | extractMs | candMs | workerMs | ingestMs | viewMs | samples | events | arcSamples | segments | covered | gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1k-straight | 1.7 | 0.59 | 1.5 | 0.022 | 0.04 | 24 | 24 | 0 | 1 | 230.0 | 40.0 |
| 1k-mixed | 1.4 | 0.54 | 2.3 | 0.006 | 0.04 | 298 | 12 | 285 | 1 | 205.3 | 20.0 |
| 10k-straight | 0.8 | 1.61 | 2.0 | 0.006 | 0.02 | 143 | 143 | 0 | 1 | 710.0 | 40.0 |
| 10k-mixed | 2.3 | 1.61 | 4.0 | 0.009 | 0.02 | 775 | 71 | 703 | 1 | 633.8 | 20.0 |
| 50k-mixed | 12.7 | 4.54 | 11.2 | 0.008 | 0.03 | 1434 | 80 | 1353 | 1 | 1419.4 | 20.0 |
| 100k-mixed | 15.7 | 8.04 | 20.6 | 0.006 | 0.03 | 1860 | 112 | 1747 | 1 | 1999.6 | 20.0 |
| long-100el (10k TIN) | 24.1 | 1.66 | 24.6 | 0.008 | 0.07 | 2236 | 36 | 2233 | 2 | 909.8 | 375.6 |
| long-1000el (10k TIN) | 429.2 | 1.97 | 434.0 | 0.008 | 0.35 | 2236 | 36 | 2233 | 2 | 909.8 | 11944.2 |

Notes:

- Extraction scales with traversed triangles (topology events), not raw
  TIN size: 100k-mixed extracts in ~16 ms because the alignment crosses a
  narrow band; candidate-index query stays under 10 ms at 100k tris.
- Arc subdivision dominates mixed-alignment cost (arcSamples >> line
  samples at the 0.001 display tolerance); straight-only stays ~1 ms.
- Element count is the steep curve: 1000 mixed elements cost ~430 ms
  even on a 10k TIN (per-element walk + adaptive arc work). Long
  alignments that run off-mesh accrue gap length, not samples.
- Cache ingest (`applyProfileExtractionSuccess` + get) and view path
  generation (`buildProfileViewDisplayLayers`) are sub-millisecond to
  0.35 ms across all cases — display never gates on TIN size.
- Worker round trip tracks direct extract within ~5 ms (message +
  scheduling overhead only); quantities verified identical per run.

No tier classification: the probe is a manual `scripts/` program, not a
vitest case, so `scripts/testTiers.ts` membership is untouched.
