# Phase 18I TIN-to-TIN volume performance

Measurement only. Deterministic synthetic grid TINs (mulberry32, fixed
seeds `0x18b1`/`0x18b2` — no unfixed randomness). Base and comparison share
the same XY footprint (full overlap, worst case for pair count);
comparison Z = base Z + 0.75 offset with different jitter seeds, so both
cut and fill regions exist. Triangulation is an exact regular grid
(2 tris/cell); XY grids coincide, so each base triangle bbox-overlaps
itself plus neighbours (~17 candidate pairs/tri).

Method: `npx tsx scripts/phase18iVolumePerf.ts` (3 measured runs per
scale, median wall-time, Node 22 Linux x64 this machine). Columns:
`indexMs` = `findOverlappingPairs` (candidate-index build+query) alone;
`qtyMs` = `computeVolumeQuantities` quantity-only end to end
(`includeDisplay: false`); `dispMs` = same with `includeDisplay: true`;
`workerMs` = quantity compute + `toCadVolumeResult` (the exact fns the
volume worker op runs); `ingestMs` = volume result-cache `set`+`get`.
Quantity parity between qty/display modes asserted bitwise every run
(contract: identical quantities).

## Results

| scale | indexMs | qtyMs | dispMs | disp overhead | workerMs | ingestMs | pairs | polys | regions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1k/1k | 1.9 | 22.3 | 13.2 | −9.1 (noise*) | 10.0 | 0.033 | 17,152 | 1,012 | 1,459 |
| 10k/10k | 18.8 | 105.1 | 90.0 | −15.1 (noise*) | 88.5 | 0.011 | 178,084 | 10,082 | 14,860 |
| 50k/50k | 150.3 | 497.9 | 479.9 | −18.0 (noise*) | 453.6 | 0.015 | 896,800 | 50,244 | 73,817 |
| 1k-vs-10k | 5.9 | 13.0 | 12.5 | −0.5 (noise) | 12.9 | 0.008 | 17,680 | 1,012 | 1,476 |
| 10k-vs-1k | 5.8 | 12.6 | 12.7 | +0.1 | 12.3 | 0.007 | 17,680 | 1,012 | 1,488 |
| 100k/100k | 332.0 | 974.5 | 979.3 | +4.8 | 940.3 | 0.011 | 1,795,600 | 100,352 | 147,465 |

Base/cmp tri counts: 1,012 / 10,082 / 50,244 / 100,352 per mesh.
Heap after each scale (cumulative process): 35.8 → 98.2 → 301.6 →
311.0 → 324.4 → 392.7 MiB. No scale exceeded the 60 s budget; the
100k-ish pair attempt succeeded (~1 s per compute, 1.8 M candidate
pairs).

\* Negative display overhead is JIT-warmth noise, not a real speedup:
each run measures qty mode first, so display mode benefits from warm
caches. Honest reading: display-region construction adds no measurable
cost at any scale (≤5 ms even at 100k/100k, ~0.5%). Quantity/display
quantities were bitwise identical at every scale.

## Quantity-vs-display mode comparison

- Quantities bitwise identical (`JSON.stringify` equality asserted per
  run) at all 6 scales — display mode returns identical quantities plus
  regions, per contract.
- Display overhead ≈ 0 within noise through 50k; +4.8 ms (+0.5%) at
  100k/100k with 147k regions. Region construction (world-frame ring
  copy) is negligible next to clip+integrate.
- Cache ingest is flat microseconds (map set+get); no scaling concern.

## Asymmetry notes

- 1k-vs-10k and 10k-vs-1k cost the same (~13 ms) in both directions:
  cost follows the finer mesh's cell size via the grid index, and pair
  counts are identical (17,680) since the footprint coincides. Direction
  of base vs comparison does not matter for performance.
- Pair count scales ~linearly with triangle count at full overlap
  (~17–18 pairs/tri); polygon count equals the overlapped triangle
  count, as expected for coincident grids.

## Memory notes

- Heap grew monotonically across scales in one process (35.8 → 392.7
  MiB); per-scale retained meshes are the driver's fixtures, not engine
  state — the engine holds no cross-call retained memory beyond the
  returned result.
- 100k/100k (200k tris total, 1.8 M pairs) peaked at 392.7 MiB heap;
  no memory pressure or GC failure observed.

## Verdict

Volume compute is ~linear through 100k tris (~10 µs/tri all-in).
Interactive volumes (≤10k) complete in ~0.1 s; 50k in ~0.5 s; 100k in
~1 s — all suitable for worker-path execution without chunking. No
engine math, tolerances, or production behavior were changed for this
probe.
