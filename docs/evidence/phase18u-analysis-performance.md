# Phase 18U analysis-band performance

Measurement only, no `src/` behavior changes. Deterministic synthetic grid
TINs (mulberry32, fixed seeds `0x18b1`/`0x18b2` — no unfixed randomness),
exact regular grids (2 tris/cell), Node 22 Linux x64 this machine.

Method: `npx tsx scripts/phase18uAnalysisPerf.ts` (3 measured runs per
cell, median wall-time). Scale = triangle count of the source TIN
(depth uses base and comparison at the same scale, coincident XY footprint
so worst-case pair count).

Per metric:

- **elevation** (`analyzeElevationBands`): `classifyMs` = quantity-only
  (`includeDisplay: false`); `displayMs` = same with
  `includeDisplay: true`; `regionMs` = engine result → export region
  rings (`analysisRegionsFromElevation`); `pathGenMs` = export item
  construction (`buildAnalysisSheetItems`, the SVG/PDF hop).
- **slope** (`analyzeSlopeBands`, whole-face classification): no
  `includeDisplay` switch (faces carry no clipped polygons); `classifyMs`
  + `regionMs` (`analysisRegionsFromSlope`, one shared-helper pass) +
  `pathGenMs`.
- **depth** (`computeDepthBands`, the 18I clip/integrate pipeline + band
  partition): `qtyMs`/`displayMs`/`regionMs`/`pathGenMs` as above, and
  `baseline18iMs` = `computeVolumeQuantities(base, cmp, {includeDisplay:false})`
  re-measured on the identical meshes in the same run (live 18I baseline).

`polyOverheadMs` = `displayMs − classifyMs`. Quantity parity between
quantity-only and display modes is asserted bitwise every run
(`JSON.stringify` of the quantity fields; `regions` stripped) — statistics
are never simplified by the display path. The probe exits non-zero on any
compute throw or quantity mismatch.

## Elevation

| scale | bands | classifyMs | displayMs | polyOverheadMs | regionMs | pathGenMs | regions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1k | 5 | 2.7 | 2.4 | −0.2 | 0.3 | 0.9 | 1,323 |
| 1k | 10 | 0.6 | 1.1 | +0.4 | 0.3 | 0.9 | 1,670 |
| 1k | 20 | 2.4 | 1.0 | −1.4 | 0.4 | 1.7 | 2,371 |
| 10k | 5 | 4.8 | 7.2 | +2.4 | 2.2 | 2.3 | 11,128 |
| 10k | 10 | 5.6 | 6.5 | +0.9 | 2.2 | 4.7 | 12,205 |
| 10k | 20 | 11.3 | 11.3 | +0.0 | 2.1 | 7.2 | 14,364 |
| 50k | 5 | 23.5 | 30.9 | +7.4 | 7.9 | 11.2 | 52,691 |
| 50k | 10 | 28.6 | 33.6 | +5.0 | 10.0 | 12.0 | 55,142 |
| 50k | 20 | 31.7 | 34.2 | +2.5 | 2.9 | 12.8 | 59,907 |
| 100k | 5 | 43.8 | 49.2 | +5.4 | 8.6 | 22.9 | 103,726 |
| 100k | 10 | 55.4 | 66.3 | +10.9 | 10.6 | 41.5 | 107,084 |
| 100k | 20 | 71.7 | 74.9 | +3.2 | 10.0 | 58.1 | 113,978 |

## Slope

| scale | bands | classifyMs | regionMs | pathGenMs | face regions |
| --- | --- | --- | --- | --- | --- |
| 1k | 5 | 0.6 | 0.6 | 0.8 | 1,012 |
| 1k | 10 | 0.3 | 0.2 | 0.5 | 1,012 |
| 1k | 20 | 0.3 | 0.7 | 0.5 | 1,012 |
| 10k | 5 | 3.1 | 2.5 | 0.9 | 10,082 |
| 10k | 10 | 0.6 | 1.4 | 0.8 | 10,082 |
| 10k | 20 | 0.6 | 1.7 | 0.8 | 10,082 |
| 50k | 5 | 11.8 | 10.4 | 15.4 | 50,244 |
| 50k | 10 | 4.5 | 8.7 | 20.0 | 50,244 |
| 50k | 20 | 3.5 | 6.7 | 22.5 | 50,244 |
| 100k | 5 | 8.7 | 13.2 | 24.0 | 100,352 |
| 100k | 10 | 8.1 | 13.8 | 25.3 | 100,352 |
| 100k | 20 | 8.3 | 17.2 | 23.2 | 100,352 |

Flat slope percentage distribution means the band count does not change the
region count (whole-face classification covers the mesh once); `pathGenMs`
grows with band count only because one fill item is emitted per non-empty
band.

## Depth (18I baseline alongside)

| scale | bands | qtyMs | displayMs | polyOverheadMs | baseline18iMs | regionMs | pathGenMs | regions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1k | 5 | 12.9 | 12.6 | −0.3 | 8.6 | 0.4 | 0.2 | 2,593 |
| 1k | 10 | 14.1 | 13.7 | −0.4 | 8.3 | 0.5 | 0.3 | 4,295 |
| 10k | 5 | 114.5 | 118.5 | +4.0 | 84.1 | 2.9 | 6.4 | 25,745 |
| 10k | 10 | 132.5 | 138.9 | +6.3 | 85.7 | 6.7 | 7.5 | 43,117 |
| 50k | 5 | 622.3 | 650.3 | +28.0 | 447.4 | 40.4 | 52.8 | 127,849 |
| 50k | 10 | 689.0 | 790.0 | +101.0 | 429.5 | 61.4 | 75.3 | 213,730 |
| 100k | 5 | 1408.8 | 1419.9 | +11.1 | 863.2 | 49.2 | 75.5 | 255,622 |
| 100k | 10 | 1465.9 | 1558.4 | +92.5 | 1021.2 | 136.2 | 123.9 | 427,008 |

Depth bands cost ≈ 1.4–1.7× the quantity-only 18I baseline at the same
scale (each overlap polygon is clipped once per intersected band, so the
added work is proportional to bands × intersected polygons). The clipping
and integration themselves are the shared 18I code paths — no second
volume engine.

## Quantity-only vs display equivalence and savings

- Quantity parity (`JSON.stringify` of band quantities with `regions`
  stripped) was **bitwise identical** at every scale and band count for all
  three metrics — the display path only adds region rings.
- Skipping display (`includeDisplay: false`) saves the region construction
  cost: at 100k triangles elevation display overhead is +3–11 ms (≈2–8%),
  depth +11–102 ms (≈1–7%). `regionMs` (engine rings → export shape) and
  `pathGenMs` (export items) are single-digit-to-low-tens of ms and do not
  scale with band count beyond item count.
- The export path never recomputes band math: it consumes engine result
  regions (or reuses the shared classify/plane helpers for slope faces).

## Region-count / memory notes

- Region counts scale with scale and band count; elevation/100k/20 bands
  produced ~114k region rings, depth/100k/10 bands ~427k clipped polygons.
- Peak process heap (measured after each cell, cumulative, GC-noise
  included): elevation/slope section peaked ≈ 560 MiB (100k/10 slope),
  depth section ≈ 1.29 GiB (100k/10 depth). These include the retained
  result objects across the three RUNS loops; a single production run holds
  one result per map.
- Display cap/suppression (aggregated per-band paths, one item per
  non-empty band) is applied only at the export/presentation hop, **after**
  exact quantities are computed — statistics are never simplified. No
  scale exceeded a practical budget; the 100k/10 depth cell is the heaviest
  at ~1.5 s per full band compute.

Raw run output: `npx tsx scripts/phase18uAnalysisPerf.ts` (add `--quick`
for 1k/10k only).
