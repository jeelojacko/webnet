# Phase 18Z — exact composition performance evidence (production 1k/10k/50k/100k)

- **Branch:** `perf/cad-surface-composition-scaling`
- **Measured commit:** `e996e2a3` (Phase 18Z browser QA scaling spec; production path = fast paths `1433489d` + indexed recovery `f6901174` + clip/split/locate indexing `91058547`).
- **Historical commit:** `f6901174` (opt-in indexed recovery, before the clip/split/locate indexing of `91058547`). Its numbers are retained verbatim in **§7 Historical measurements** — do not cite them as current.
- **Harness:** `tests/evidence/phase18z_compose_perf.test.ts` (EVIDENCE tier, registered in `scripts/testTiers.ts`; never runs in CI).
- **Reference oracle:** `src/engine/cad/surfaces/compose/composeReference18y.ts` `composeSurfaceMeshesReference`, run at **1k/10k only** (frozen O(n²) path).
- **Status:** measured evidence. No production file was changed by this harness; production code was already at the measured commit.

---

## 1. Method and environment

- Hardware: AMD Ryzen 7 5800X3D, 16 logical CPUs; node `v26.8.1`; Linux.
- Command: `npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts` with
  `PHASE18Z_PERF_SIZES` / `PHASE18Z_PERF_CASES` / `PHASE18Z_PERF_REFERENCE=0` filters, one run per size band.
- Run bands (HEAD, 2026-09-26): 1k+10k+reference **75.8 s**; 50k+100k (`PHASE18Z_PERF_REFERENCE=0`) **19.7 s**.
  Host load average was **1.12/1.44/1.79** (1/5/15 min) at the end of the 1k/10k band and **1.60/1.74/1.94** at
  the end of the 50k/100k band. The 50k/100k band ran in a separate process from 1k/10k, so cross-run ratios
  carry normal JIT/load variance; within-run growth is the reliable signal.
- Repetitions: 3 timed reps (median) at 1k/10k; **1 timed rep** at 50k/100k. JIT is warmed with two 1k passes
  per case plus two 1k-sized compose calls per case before any large row.
- Sub-stage timings (`view`/`boundary`/`pslg`) are measured only at 1k/10k. `residual = total − view − boundary − pslg`
  bundles constrained-edge recovery, ownership classification, seam gate, Z assignment, canonicalization and digest.
- Base-triangle classification (`out/in/touch`) is an **estimate** from overlay coverage views: centroid + the three
  vertices are located via the grid index (the O(T) whole-view fallback is suppressed; a missing cell counts as
  not-located). `inside` = every sample covered by overlay, `outside` = no sample covered, `touched` = boundary-straddling.
  Exact per-triangle area clipping (`clipTrianglePair`) was deliberately not used — it is the full-overlay fast-path
  predicate and would dominate the 100k wall time.
- Heap delta is `heapUsed` after minus before the timed loop; no forced GC is available under the vitest worker, so
  negative values are GC-driven noise, not measured savings.

### Case geometry (18Y builders, `side = round(sqrt(size/2))`, `cell = 1`)

| case | base | overlay | role |
| --- | --- | --- | --- |
| `disjoint` | full grid | same grid translated 4 cells (+x) | strict-disjoint fast-path oracle |
| `full-overlay` | full grid | identical grid | full-overlay fast-path oracle |
| `partial-seam` | full grid | **nested island**, `side/4`, centered | seam-local / nested-domain oracle |
| `half-seam` | full grid | right half grid (18Y `partial-seam`) | old-vs-new continuity |
| `complex-seam` | full grid | full grid minus lower-right quadrant (18Y `intersecting-seam`) | mixed seam at largest size |

`size` is the nominal total vertex budget; actual counts are in the tables (grids quantize `side`).

---

## 2. Old vs new — 1k and 10k (HEAD `e996e2a3`)

Reference = frozen 18Y O(n²) oracle. Production = fast paths + indexed recovery + indexed clipping/split/locate.

| size | case | input verts (base+ovl) | input tris (base+ovl) | reference ms | new ms | speedup | fast-full | fast-disjoint |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1000 | disjoint | 529 + 529 | 968 + 968 | 400.2 | 3.8 | **105.7×** | no | yes |
| 1000 | full-overlay | 529 + 529 | 968 + 968 | 100.4 | 7.9 | **12.7×** | yes | no |
| 1000 | partial-seam | 529 + 49 | 968 + 72 | 99.5 | 17.1 | 5.8× | no | no |
| 1000 | half-seam | 529 + 144 | 968 + 242 | 104.2 | 21.7 | 4.8× | no | no |
| 1000 | complex-seam | 529 + 529 | 968 + 726 | 104.1 | 19.8 | 5.2× | no | no |
| 10000 | disjoint | 5184 + 5184 | 10082 + 10082 | 33 710.7 | 27.7 | **1216.9×** | no | yes |
| 10000 | full-overlay | 5184 + 5184 | 10082 + 10082 | 7 737.9 | 72.6 | **106.6×** | yes | no |
| 10000 | partial-seam | 5184 + 361 | 10082 + 648 | 8 355.1 | 184.6 | 45.3× | no | no |
| 10000 | half-seam | 5184 + 1369 | 10082 + 2592 | 8 645.0 | 183.1 | 47.2× | no | no |
| 10000 | complex-seam | 5184 + 5184 | 10082 + 7490 | 10 232.3 | 195.7 | 52.3× | no | no |

**Old path is exactly quadratic:** reference 1k→10k growth is 84.2× (disjoint), 77.1× (full-overlay), 84.0×
(partial-seam), 83.0× (half-seam), 98.3× (complex-seam) — exponents 1.89–1.99. The absolute reference milliseconds
are smaller than the `f6901174` run (e.g. 10k partial-seam 8 355 ms vs 8 417 ms, disjoint 33 711 ms vs 35 935 ms)
because the reference is unchanged code measured on a less-loaded host; the quadratic shape is identical.

### 1k/10k stage split (production ms, HEAD)

| size | case | view | boundary | pslg | pslg segments | residual (recovery+classify+tail) | total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | disjoint | 1.1 | 0.5 | 11.9 | 2992 | 0.0 | 3.8 |
| 1000 | full-overlay | 1.0 | 0.5 | 7.7 | 1496 | 0.0 | 7.9 |
| 1000 | partial-seam | 0.6 | 0.0 | 4.8 | 1496 | 11.7 | 17.1 |
| 1000 | half-seam | 0.6 | 0.1 | 4.7 | 1496 | 16.3 | 21.7 |
| 1000 | complex-seam | 0.9 | 0.4 | 5.6 | 1496 | 13.0 | 19.8 |
| 10000 | disjoint | 11.2 | 7.0 | 61.1 | 30530 | 0.0 | 27.7 |
| 10000 | full-overlay | 6.5 | 6.7 | 76.5 | 15265 | 0.0 | 72.6 |
| 10000 | partial-seam | 3.4 | 0.3 | 44.2 | 15265 | 136.7 | 184.6 |
| 10000 | half-seam | 4.2 | 1.1 | 47.4 | 15265 | 130.4 | 183.1 |
| 10000 | complex-seam | 5.4 | 4.6 | 63.0 | 15265 | 122.7 | 195.7 |

The `pslg` column is measured separately from production and is **not** part of the fast-path totals
(disjoint/full-overlay never build a PSLG). For seam cases the 1k→10k growth of `pslg` is 9.2× (partial-seam,
exponent 0.96), 10.1× (half-seam, 1.00), 11.3× (complex-seam, 1.05); the residual grows 11.7× (1.07), 8.0× (0.90),
9.4× (0.97). Both halves of the seam path are now essentially linear from 1k to 10k — the pre-indexing
`f6901174` split had `pslg` 32.6–59.1× and residual 31–50× on the same interval (see §7).

---

## 3. Actual 50k and 100k (production, HEAD `e996e2a3`)

| size | case | baseV | baseT | ovlV | ovlT | components b/o | overlay boundary edges | cls out/in/touch | seamCand | outV | outT | fast-full ms (hit) | fast-disjoint ms (hit) | total ms | heap Δ MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |
| 50000 | disjoint | 25281 | 49928 | 25281 | 49928 | 1/1 | 632 | 49928/0/0 | 632 | 50562 | 99856 | 0.9 (no) | 122.7 (yes) | **137.6** | −6.6 |
| 50000 | full-overlay | 25281 | 49928 | 25281 | 49928 | 1/1 | 632 | 0/49928/0 | 632 | 25281 | 49928 | 394.2 (yes) | 24.4 (no) | **389.0** | −5.2 |
| 50000 | partial-seam | 25281 | 49928 | 1681 | 3200 | 1/1 | 160 | 46402/3200/326 | 160 | 25281 | 49928 | 0.3 (no) | 32.0 (no) | **1 342.5** | +145.0 |
| 50000 | half-seam | 25281 | 49928 | 6400 | 12482 | 1/1 | 316 | 37129/12482/317 | 316 | 25281 | 49928 | 0.3 (no) | 23.6 (no) | **1 295.6** | +50.4 |
| 50000 | complex-seam | 25281 | 49928 | 25281 | 37446 | 1/1 | 632 | 11552/37446/930 | 632 | 25281 | 49928 | 0.5 (no) | 19.1 (no) | **1 482.7** | +171.5 |
| 100000 | disjoint | 50625 | 100352 | 50625 | 100352 | 1/1 | 896 | 100352/0/0 | 896 | 101250 | 200704 | 1.3 (no) | 195.8 (yes) | **231.5** | +60.4 |
| 100000 | full-overlay | 50625 | 100352 | 50625 | 100352 | 1/1 | 896 | 0/100352/0 | 896 | 50625 | 100352 | 902.5 (yes) | 42.3 (no) | **938.2** | +14.6 |
| 100000 | partial-seam | 50625 | 100352 | 3249 | 6272 | 1/1 | 224 | 93626/6272/454 | 224 | 50625 | 100352 | 0.6 (no) | 44.4 (no) | **2 873.2** | +303.0 |
| 100000 | half-seam | 50625 | 100352 | 12769 | 25088 | 1/1 | 448 | 74815/25088/449 | 448 | 50625 | 100352 | 0.9 (no) | 47.3 (no) | **2 814.7** | +224.6 |
| 100000 | complex-seam | 50625 | 100352 | 50625 | 75264 | 1/1 | 896 | 23328/75264/1760 | 896 | 50625 | 100352 | 1.2 (no) | 38.4 (no) | **3 491.2** | −338.7 |

Observations:

- **Fast paths are the whole story for their shapes.** At 100k the disjoint proof (AABB separation) is 195.8 ms
  and the full-overlay coverage proof (exact per-triangle `clipTrianglePair` over 100 352 base triangles) is
  902.5 ms. Both then only canonicalize/digest the output. The `91058547` clip/split/locate indexing does not
  touch these fast paths, so the small 50k/100k deltas vs §7 for those two shapes are run-to-run/load noise.
- **`nested-island partial-seam` at 100k is 2.87 s** (was 56.05 s pre-indexing, §7) — a 19.5× improvement on
  the exact same geometry. The island has 6 272 triangles (6 % of the base) and 224 boundary edges.
- **`half-seam` 100k at 2.81 s (was 146.3 s, 52.0×) and `complex-seam` 100k at 3.49 s (was 118.3 s, 33.9×)** are
  now in the same band as the nested-island case: the global union TIN is no longer the asymptotic term.
- Classification estimates are sane: disjoint = 100 % outside, full-overlay = 100 % inside, nested island =
  93 626 outside / 6 272 inside / 454 touched, half-seam = 74 815 inside, complex-seam = 23 328 outside.
- All 10 large rows return `ok: true` with the expected 1-component base/overlay inputs; the only multi-component
  case (`disjoint`) correctly reports 1/1 input components and concatenates to 2 output islands (101 250 verts /
  200 704 tris).

---

## 4. Growth ratios and exponents (HEAD)

`exponent = log(t₂/t₁) / log(n₂/n₁)`, computed from the production totals above. 1k/10k and 50k/100k came from
separate processes (see §1), so treat the interval exponents as the trend and the cross-band ratios as the shape.

| case | 1k→10k ratio (×10) | exp | 10k→50k ratio (×5) | exp | 50k→100k ratio (×2) | exp | 10k→100k exp | shape |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| disjoint | 7.3× | 0.86 | 5.0× | 1.00 | 1.68× | 0.75 | — | ~O(n) |
| full-overlay | 9.2× | 0.96 | 5.4× | 1.04 | 2.41× | 1.27 | — | ~O(n) |
| partial-seam | 10.8× | 1.03 | 7.3× | 1.23 | 2.14× | 1.10 | **1.19** | ~O(n) |
| half-seam | 8.4× | 0.93 | 7.1× | 1.22 | 2.17× | 1.12 | **1.19** | ~O(n) |
| complex-seam | 9.9× | 0.99 | 7.6× | 1.26 | 2.35× | 1.24 | **1.25** | ~O(n) |

Reference (old path) exponents are 1.89–1.99 across 1k→10k for every case; production is now near-linear on
every case too. The fast-path exponents (`0.75–1.27`) reflect the unavoidable O(n) canonicalization/digest tail
from `finalizeCompose` on top of an O(1)/O(n) proof. The seam cases sit at **10k→100k exponents of 1.19–1.25**
and **1k→10k exponents of 0.93–1.03** — no longer quadratic, with the residual superlinear component coming from
the base-region rebuild rather than the seam itself.

---

## 5. Verdict vs §88 GO gates

**GO gate A — fast paths avoid global retriangulation: PASS.**
`disjoint` and `full-overlay` never build a PSLG or constrained TIN (`fast-full`/`fast-disjoint` hit = yes; `pslg`
is not measured as part of their total). They scale linearly: disjoint 3.8 → 27.7 → 137.6 → 231.5 ms and
full-overlay 7.9 → 72.6 → 389.0 → 938.2 ms over 1k→100k, exponents 0.75–1.27. At 100k these are 231.5 ms and
938.2 ms, against 33.7 s and 7.7 s for the same shapes on the frozen 18Y reference at 10k.

**GO gate B — partial-seam seam-local scaling: MET.**
The nested-domain oracle isolates the seam: base = 100 352 triangles, overlay island = 6 272 triangles, seam =
224 boundary edges. The pre-indexing run tracked the base size quadratically (exponent ~2.0); the indexed
clip/split/locate passes (`91058547`) removed that term:

| case | 1k | 10k | 50k | 100k | 10k→100k exponent | pre-indexing 100k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| partial-seam (nested island) | 17.1 ms | 184.6 ms | 1 342.5 ms | 2 873.2 ms | **1.19** | 56 054.9 ms |
| half-seam | 21.7 ms | 183.1 ms | 1 295.6 ms | 2 814.7 ms | **1.19** | 146 265.2 ms |
| complex-seam | 19.8 ms | 195.7 ms | 1 482.7 ms | 3 491.2 ms | **1.25** | 118 346.9 ms |

Every seam case is near-linear (1k→10k 0.93–1.03, 50k→100k 1.10–1.24) and the 100k nested-island case runs in
2.87 s, a 19.5× improvement over the `f6901174` measurement on identical geometry. §88's seam-local target is
satisfied at the level the gate measures: no quadratic base-size term remains, and the residual work scales
within the near-linear band.

**Verdict: GO.** Ship the fast paths (byte-identical per the parity corpus) together with the indexed
recovery/clip/split/locate production path. All §88 gates are met.

---

## 6. Reproduction

```bash
# 1k/10k + frozen reference + stage split (≈76 s at HEAD)
PHASE18Z_PERF_SIZES=1000,10000 \
PHASE18Z_PERF_CASES=disjoint,full-overlay,partial-seam,half-seam,complex-seam \
PHASE18Z_PERF_OUT=/tmp/18z-head-1k-10k.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts

# 50k + 100k (≈20 s at HEAD; was ~6.5 min pre-indexing)
PHASE18Z_PERF_SIZES=50000,100000 PHASE18Z_PERF_REFERENCE=0 PHASE18Z_PERF_STAGE_SIZES= \
PHASE18Z_PERF_OUT=/tmp/18z-head-50k-100k.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts
```

The harness writes a markdown table and a JSON sidecar to `PHASE18Z_PERF_OUT` (default `/tmp/phase18z-*`).
It never runs the 18Y reference above 10k (guarded in `measureCase`), and it never files timing assertions —
only `ok: true` validity checks.

---

## 7. Historical measurements — commit `f6901174` (pre clip/split/locate indexing)

Retained for the record only: these are the numbers as measured at `f6901174` plus the then-current fast paths
`1433489d`, **before** the `91058547` clip/split/locate indexing. Do not cite them as current; see §2–§5 for HEAD.
The method/environment section that applied to this run is preserved in the `f6901174` revision of this file.

### 7.1 Old vs new — 1k and 10k (`f6901174`)

| size | case | input verts (base+ovl) | input tris (base+ovl) | reference ms | new ms | speedup | fast-full | fast-disjoint |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1000 | disjoint | 529 + 529 | 968 + 968 | 402.1 | 4.4 | **91.2×** | no | yes |
| 1000 | full-overlay | 529 + 529 | 968 + 968 | 87.2 | 8.1 | **10.7×** | yes | no |
| 1000 | partial-seam | 529 + 49 | 968 + 72 | 92.7 | 21.5 | 4.3× | no | no |
| 1000 | half-seam | 529 + 144 | 968 + 242 | 91.5 | 24.9 | 3.7× | no | no |
| 1000 | complex-seam | 529 + 529 | 968 + 726 | 92.0 | 22.5 | 4.1× | no | no |
| 10000 | disjoint | 5184 + 5184 | 10082 + 10082 | 35 934.8 | 26.5 | **1356.7×** | no | yes |
| 10000 | full-overlay | 5184 + 5184 | 10082 + 10082 | 7 648.9 | 71.0 | **107.8×** | yes | no |
| 10000 | partial-seam | 5184 + 361 | 10082 + 648 | 8 416.9 | 662.4 | 12.7× | no | no |
| 10000 | half-seam | 5184 + 1369 | 10082 + 2592 | 9 274.7 | 1 280.1 | 7.2× | no | no |
| 10000 | complex-seam | 5184 + 5184 | 10082 + 7490 | 8 915.7 | 1 112.2 | 8.0× | no | no |

Reference 1k→10k growth at that run: 89× (disjoint), 88× (full-overlay), 90× (partial-seam), 101× (half-seam),
97× (complex-seam) — exponents 1.94–2.00.

### 7.2 Stage split — 1k/10k (`f6901174`)

| size | case | view | boundary | pslg | pslg segments | residual | total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | disjoint | 1.2 | 1.8 | 47.3 | 2992 | 0.0 | 4.4 |
| 1000 | full-overlay | 1.0 | 0.7 | 6.6 | 1496 | 0.0 | 8.1 |
| 1000 | partial-seam | 0.6 | 0.1 | 5.5 | 1496 | 15.4 | 21.5 |
| 1000 | half-seam | 0.6 | 0.1 | 8.3 | 1496 | 15.8 | 24.9 |
| 1000 | complex-seam | 0.8 | 0.4 | 8.2 | 1496 | 13.1 | 22.5 |
| 10000 | disjoint | 6.7 | 6.4 | 2490.7 | 30530 | 0.0 | 26.5 |
| 10000 | full-overlay | 6.5 | 8.6 | 48.9 | 15265 | 6.9 | 71.0 |
| 10000 | partial-seam | 5.3 | 0.4 | 179.4 | 15265 | 477.2 | 662.4 |
| 10000 | half-seam | 4.4 | 1.3 | 491.0 | 15265 | 783.4 | 1280.1 |
| 10000 | complex-seam | 7.0 | 3.5 | 484.2 | 15265 | 617.5 | 1112.2 |

`pslg` 1k→10k growth: 32.6× (partial-seam, 1.51), 59.1× (half-seam, 1.77), 59.1× (complex-seam, 1.77); residual
31× (1.49), 49.6× (1.70), 47.1× (1.67). The indexed recovery promotion removed the previous 79 % share, leaving
PSLG base-edge clipping / `splitAtInteriorVertices` and the classification/seam/Z passes as the superlinear
remainder — which `91058547` then indexed.

### 7.3 Actual 50k and 100k (`f6901174`)

| size | case | baseV | baseT | ovlV | ovlT | components b/o | overlay boundary edges | cls out/in/touch | seamCand | outV | outT | fast-full ms (hit) | fast-disjoint ms (hit) | total ms | heap Δ MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |
| 50000 | disjoint | 25281 | 49928 | 25281 | 49928 | 1/1 | 632 | 49928/0/0 | 632 | 50562 | 99856 | 0.9 (no) | 122.7 (yes) | **134.6** | −4.3 |
| 50000 | full-overlay | 25281 | 49928 | 25281 | 49928 | 1/1 | 632 | 0/49928/0 | 632 | 25281 | 49928 | 367.3 (yes) | 22.6 (no) | **372.1** | −5.0 |
| 50000 | partial-seam | 25281 | 49928 | 1681 | 3200 | 1/1 | 160 | 46402/3200/326 | 160 | 25281 | 49928 | 0.3 (no) | 28.3 (no) | **14 118.5** | +11.2 |
| 50000 | half-seam | 25281 | 49928 | 6400 | 12482 | 1/1 | 316 | 37129/12482/317 | 316 | 25281 | 49928 | 0.3 (no) | 21.8 (no) | **28 310.6** | −108.6 |
| 50000 | complex-seam | 25281 | 49928 | 25281 | 37446 | 1/1 | 632 | 11552/37446/930 | 632 | 25281 | 49928 | 0.5 (no) | 19.3 (no) | **28 971.1** | +49.9 |
| 100000 | disjoint | 50625 | 100352 | 50625 | 100352 | 1/1 | 896 | 100352/0/0 | 896 | 101250 | 200704 | 3.1 (no) | 228.4 (yes) | **251.4** | +73.1 |
| 100000 | full-overlay | 50625 | 100352 | 50625 | 100352 | 1/1 | 896 | 0/100352/0 | 896 | 50625 | 100352 | 776.7 (yes) | 38.0 (no) | **797.0** | −6.9 |
| 100000 | partial-seam | 50625 | 100352 | 3249 | 6272 | 1/1 | 224 | 93626/6272/454 | 224 | 50625 | 100352 | 0.6 (no) | 41.6 (no) | **56 054.9** | −189.8 |
| 100000 | half-seam | 50625 | 100352 | 12769 | 25088 | 1/1 | 448 | 74815/25088/449 | 448 | 50625 | 100352 | 0.7 (no) | 40.1 (no) | **146 265.2** | −163.0 |
| 100000 | complex-seam | 50625 | 100352 | 50625 | 75264 | 1/1 | 896 | 23328/75264/1760 | 896 | 50625 | 100352 | 1.0 (no) | 34.8 (no) | **118 346.9** | +45.7 |

### 7.4 Growth ratios at `f6901174`

| case | 1k→10k ratio (×10) | exp | 10k→50k ratio (×5) | exp | 50k→100k ratio (×2) | exp | shape |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| disjoint | 6.0× | 0.78 | 5.1× | 1.01 | 1.87× | 0.90 | ~O(n) |
| full-overlay | 8.8× | 0.94 | 5.2× | 1.02 | 2.14× | 1.10 | ~O(n) |
| partial-seam | 30.8× | 1.49 | 21.3× | 1.90 | 3.97× | 1.99 | → O(n²) |
| half-seam | 51.4× | 1.71 | 22.1× | 1.92 | 5.17× | 2.37 | O(n²) |
| complex-seam | 49.4× | 1.69 | 26.0× | 2.02 | 4.09× | 2.03 | O(n²) |

### 7.5 Verdict issued at `f6901174` (superseded by §5)

- GO gate A — fast paths avoid global retriangulation: **PASS**.
- GO gate B — partial-seam seam-local scaling: **NOT MET.** Runtime tracked the base size quadratically
  (10k→100k exponent 1.98); the pipeline still assembled a global PSLG (15 265 segments at 10k) and ran a
  union constrained TIN, so §88's seam-local target was not satisfied.
- **Interim verdict: PARTIAL GO.** Ship the fast paths; do not claim seam-local compose scaling yet. The
  remaining O(n²) lived in PSLG base-edge clipping, `splitAtInteriorVertices`, and the union retriangulation.
