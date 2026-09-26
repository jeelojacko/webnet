# Phase 18Z — exact composition performance evidence (production 1k/10k/50k/100k)

- **Branch:** `perf/cad-surface-composition-scaling`
- **Measured commit:** `f6901174` (Phase 18Z: opt-in indexed recovery on compose path) plus the committed fast paths `1433489d`.
- **Harness:** `tests/evidence/phase18z_compose_perf.test.ts` (EVIDENCE tier, registered in `scripts/testTiers.ts`; never runs in CI).
- **Reference oracle:** `src/engine/cad/surfaces/compose/composeReference18y.ts` `composeSurfaceMeshesReference`, run at **1k/10k only** (frozen O(n²) path).
- **Status:** measured evidence. No production file was changed by this harness; production code was already at the measured commit.

---

## 1. Method and environment

- Hardware: AMD Ryzen 7 5800X3D, 16 logical CPUs; node `v26.8.1`; Linux.
- Command: `npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts` with
  `PHASE18Z_PERF_SIZES` / `PHASE18Z_PERF_CASES` / `PHASE18Z_PERF_REFERENCE=0` filters, one run per size band.
- Run bands: 1k+10k+reference (93 s), 50k (74 s), 100k (325 s). Host load average stayed at **1.2–2.2** during
  the 50k/100k bands; an earlier 1k/10k band captured at load ~23 was discarded and re-run — the tables below are
  the clean-load runs only.
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

## 2. Old vs new — 1k and 10k

Reference = frozen 18Y O(n²) oracle. Production = fast paths + indexed recovery.

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

**Old path is exactly quadratic:** reference 1k→10k growth is 89× (disjoint), 88× (full-overlay), 90×
(partial-seam), 101× (half-seam), 97× (complex-seam) — exponents 1.94–2.00.

### 1k/10k stage split (production ms)

| size | case | view | boundary | pslg | pslg segments | residual (recovery+classify+tail) | total |
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

The `pslg` column is measured separately from production and is **not** part of the fast-path totals
(disjoint/full-overlay never build a PSLG). For seam cases the 1k→10k growth of `pslg` is 32.6×
(partial-seam, exponent 1.51), 59.1× (half-seam, 1.77), 59.1× (complex-seam, 1.77); the residual grows
31× (1.49), 49.6× (1.70), 47.1× (1.67). The indexed recovery promotion removed the previous 79 % share,
leaving PSLG base-edge clipping / `splitAtInteriorVertices` and the classification/seam/Z passes as the
superlinear remainder.

---

## 3. Actual 50k and 100k (production)

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

Observations:

- **Fast paths are the whole story for their shapes.** At 100k the disjoint proof (AABB separation) is 228 ms
  and the full-overlay coverage proof (exact per-triangle `clipTrianglePair` over 100 352 base triangles) is
  777 ms. Both then only canonicalize/digest the output.
- **`nested-island partial-seam` at 100k is 56.1 s** — well under the 10-minute abort budget. The island has
  6 272 triangles (6 % of the base), yet runtime is governed by the 100 352-triangle base, not by the island.
- **`half-seam` 100k at 146 s and `complex-seam` 100k at 118 s** are the seam cases that still build the global
  union TIN; `half-seam` is the worst because the seam length (448 boundary edges) is largest.
- Classification estimates are sane: disjoint = 100 % outside, full-overlay = 100 % inside, nested island =
  93 626 outside / 6 272 inside / 454 touched, half-seam = 74 815 inside, complex-seam = 23 328 outside.
- All 10 large rows return `ok: true` with the expected 1-component base/overlay inputs; the only multi-component
  case (`disjoint`) correctly reports 1/1 input components and concatenates to 2 output islands (101 250 verts /
  200 704 tris).

---

## 4. Growth ratios and exponents

`exponent = log(t₂/t₁) / log(n₂/n₁)`, computed from the production totals above.

| case | 1k→10k ratio (×10) | exp | 10k→50k ratio (×5) | exp | 50k→100k ratio (×2) | exp | shape |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| disjoint | 6.0× | 0.78 | 5.1× | 1.01 | 1.87× | 0.90 | ~O(n) |
| full-overlay | 8.8× | 0.94 | 5.2× | 1.02 | 2.14× | 1.10 | ~O(n) |
| partial-seam | 30.8× | 1.49 | 21.3× | 1.90 | 3.97× | 1.99 | → O(n²) |
| half-seam | 51.4× | 1.71 | 22.1× | 1.92 | 5.17× | 2.37 | O(n²) |
| complex-seam | 49.4× | 1.69 | 26.0× | 2.02 | 4.09× | 2.03 | O(n²) |

Reference (old path) exponents are 1.94–2.00 across 1k→10k for every case, so the comparison at 1k/10k is
old-quadratic vs new: fast paths O(n), seam cases superlinear-but-better.

The fast-path exponents (`~1.0`) reflect the unavoidable O(n) canonicalization/digest tail from `finalizeCompose`
on top of an O(1)/O(n) proof. The seam exponents converge to **2.0** at the largest interval: the global union
retriangulation still dominates.

---

## 5. Verdict vs §88 GO gates

**GO gate A — fast paths avoid global retriangulation: PASS.**
`disjoint` and `full-overlay` never build a PSLG or constrained TIN (`fast-full`/`fast-disjoint` hit = yes; `pslg`
is not measured as part of their total). They scale linearly: disjoint 4.4 → 26.5 → 134.6 → 251.4 ms and
full-overlay 8.1 → 71.0 → 372.1 → 797.0 ms over 1k→100k, exponents 0.78–1.10. At 100k these are 251 ms and 797 ms,
against 36 s and 7.6 s for the same shapes on the frozen 18Y reference at 10k.

**GO gate B — partial-seam seam-local scaling: NOT MET.**
The nested-domain oracle isolates the seam: base = 100 352 triangles, overlay island = 6 272 triangles, seam =
224 boundary edges. Runtime nevertheless tracks the **base** size quadratically:

| case | 1k | 10k | 50k | 100k | 10k→100k exponent |
| --- | ---: | ---: | ---: | ---: | ---: |
| partial-seam (nested island) | 21.5 ms | 662.4 ms | 14 118.5 ms | 56 054.9 ms | **1.98** |

A seam-local algorithm would keep the unmodified overlay interior and only rebuild the base-only region plus a
band around the 224-edge island perimeter; growth would track the perimeter, not `baseTriangleCount`. The current
pipeline still assembles a global PSLG (15 265 segments at 10k) and runs a union constrained TIN, so §88's
seam-local target is not satisfied. This is expected: §3 P4 ("seam-local processing") is the planned follow-up,
explicitly deferred until the P1–P3 work landed.

**Interim verdict: PARTIAL GO.** Ship the fast paths (they fully resolve the disjoint/full-overlay pathology and
are byte-identical per the parity corpus). Do **not** claim seam-local compose scaling yet; the remaining O(n²)
lives in PSLG base-edge clipping, `splitAtInteriorVertices`, and the union retriangulation, and is the next target.

---

## 6. Reproduction

```bash
# 1k/10k + frozen reference (≈90 s)
PHASE18Z_PERF_SIZES=1000,10000 \
PHASE18Z_PERF_CASES=disjoint,full-overlay,partial-seam,half-seam,complex-seam \
PHASE18Z_PERF_OUT=/tmp/18z-1k-10k.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts

# 50k (≈75 s)
PHASE18Z_PERF_SIZES=50000 PHASE18Z_PERF_REFERENCE=0 PHASE18Z_PERF_STAGE_SIZES= \
PHASE18Z_PERF_OUT=/tmp/18z-50k.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts

# 100k (≈5.5 min)
PHASE18Z_PERF_SIZES=100000 PHASE18Z_PERF_REFERENCE=0 PHASE18Z_PERF_STAGE_SIZES= \
PHASE18Z_PERF_OUT=/tmp/18z-100k.md \
  npx vitest run --config vitest.evidence.config.ts tests/evidence/phase18z_compose_perf.test.ts
```

The harness writes a markdown table and a JSON sidecar to `PHASE18Z_PERF_OUT` (default `/tmp/phase18z-*`).
It never runs the 18Y reference above 10k (guarded in `measureCase`), and it never files timing assertions —
only `ok: true` validity checks.
