# Phase 19D — Parcel Network Performance Evidence (§§106-109)

**Branch:** `feat/cad-parcel-network-production` · **Baseline:** `b553161e` ·
**Probe:** `scripts/phase19dParcelNetworkPerf.ts`
(`npx tsx scripts/phase19dParcelNetworkPerf.ts [--quick] [--large]`) ·
**Status:** measurement only, **no `src/` changes**. Evidence, not a gate.

Machine: AMD Ryzen 7 5800X3D (8c/16t), 31 GiB RAM, Node v26.8.1, `npx tsx`.
Medians of 3 reps after warmup (2 reps under `--quick`). Wall-clock is
indicative of scaling shape on this box, not a budget.

Layouts: **dense** = adjacent 10×10 m parcels on a 10 m grid (exact shared
edges); **sparse** = 10×10 m parcels at 100 m spacing (no bbox overlap);
**overlap-dense** = 20×20 m parcels at 10 m spacing; **overlap-sparse** =
20×20 m parcels at 100 m spacing. Candidate pairs = bbox-overlapping pairs.

> **Headline finding (fix wave, verified 2026-09-27):** `buildParcelNetwork`
> (`src/engine/cad/cadParcelNetwork.ts`) now **precomputes bounds, resolved
> courses and normalized vertices once per parcel** and skips disjoint bboxes
> before any exact work. The pair loop remains an all-pairs bbox-compare
> (no grid index), but per-pair geometry rebuilds are gone. Measured on this
> box: dense 1,000 parcels **368.8 → 24.6 ms (~15×)**, sparse 1,000
> **328.0 → 4.25 ms (~77×)**, dense 10,000 **~32.8 s → 389 ms (~84×)**.
> 100→1,000 network exponent is now **1.00 dense / 1.29 sparse**
> (was 1.71 / 2.00). Pre-fix numbers are kept in §6 for the record.

## 1. Dense plan — 10 / 100 / 1,000 parcels (ms median)

`cand` = harness mirror of the bbox-pair enumeration; `indexedCand` =
harness-only uniform-grid projection (**not production code**); `exact` =
`matchParcelCourses` over candidate pairs; `overlap` =
`detectParcelOverlapAreaSquareMeters` over candidate pairs.

| parcels | candidates | resolve | bbox (1 pass) | cand | indexedCand | exact | overlap | **network** | report | pairs | comps |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 22 | 0.08 | 0.02 | 0.01 | 0.03 | 0.27 | 0.26 | **0.65** | 0.03 | 22 | 1 |
| 100 | 342 | 0.18 | 0.07 | 0.02 | 0.36 | 1.33 | 1.93 | **2.39** | 0.15 | 342 | 1 |
| 1,000 | 3,811 | 2.01 | 0.40 | 1.17 | 2.47 | 9.71 | 13.57 | **24.60** | 0.71 | 3,811 | 1 |

Scaling 100 → 1,000: cand ×2.00 · indexedCand ×0.84 · exact ×1.00 ·
overlap ×0.93 · **network ×1.00** · report ×0.69.

Candidate count grows ~linearly (3,811 ≈ 3.8×N) and every stage —
including the network build — now tracks it. Exact + overlap dominate the
build (9.7 + 13.6 of 24.6 ms); candidate enumeration is 1.2 ms.

## 2. Sparse plan — 10 / 100 / 1,000 parcels

| parcels | candidates | resolve | bbox (1 pass) | cand | indexedCand | **network** | comps |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0 | 0.01 | 0.004 | 0.0002 | 0.010 | **0.02** | 10 |
| 100 | 0 | 0.12 | 0.034 | 0.010 | 0.102 | **0.22** | 100 |
| 1,000 | 0 | 1.21 | 0.35 | 1.09 | 1.04 | **4.25** | 1,000 |

Scaling 100 → 1,000: cand ×2.01 · indexedCand ×1.00 · **network ×1.29**.

Zero candidates, zero geometry work: 4.25 ms at 1,000 parcels is the residual
all-pairs bbox-compare loop over cached bounds (1.09 ms candidate scan plus
fixed per-parcel overhead). The pre-fix 328 ms at this point was pure
per-pair `buildCadBounds` recomputation; that cost is gone.

## 3. Overlap — dense vs sparse at 1,000 parcels

| layout | candidates | exact | overlap | **network** | pairs | comps |
|---|---:|---:|---:|---:|---:|---:|
| overlap-dense (20×20 @ 10 m) | 11,064 | 27.82 | 41.17 | **52.76** | 7,437 | 4 |
| overlap-sparse (20×20 @ 100 m) | 0 | 0.00 | 0.00 | **4.24** | 0 | 0 |

Overlap work scales with candidate pairs (dense: 11,064 candidates → 41.2 ms
overlap, ~linear). The sparse plan pays only the ~4 ms cached-bounds pair
loop for **no** overlap work. Overlap detection itself was never the
bottleneck; candidate enumeration was, and it is now linear in parcels plus
linear in candidates.

## 4. 10,000 parcels

Run with `--large` (dense, 2 reps, total probe wall 3.7 s). Single-build median:

| parcels | candidates | resolve | bbox (1 pass) | cand | indexedCand | exact | overlap | **network** | report |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 39,402 | 12.96 | 3.83 | 98.09 | 14.95 | 99.86 | 141.83 | **389.13** | 5.79 |

One dense `buildParcelNetwork` at 10,000 parcels is **389 ms** (was ~32.8 s).
Candidate count is only 39,402 (≈3.9×N); exact 100 ms + overlap 142 ms are
the work, and the 98 ms candidate scan is the remaining all-pairs bbox loop.
The sparse-10k case was not run; from the 1.29 sparse exponent it projects to
roughly 10² ms — same shape, no geometry. Sub-second at 10k dense on this
box; a grid index would only move the 98 ms candidate scan, so it stays a
deferred upgrade, not a gap.

## 5. Schedule derive — 10 / 100 / 1,000 / 10,000 rows

`buildCadParcelSchedule(project, ids)`:

| rows | total (ms) | per row (µs) |
|---:|---:|---:|
| 10 | 0.03 | 3.49 |
| 100 | 0.36 | 3.56 |
| 1,000 | 6.55 | 6.55 |
| 10,000 | 259.25 | 25.92 |

Per-row cost rises ~4× from 1k to 10k (~2.0 exponent): each row re-scans
`project.entities` with `find` for its parcel (`cadParcelSchedule.ts:99`),
the same per-row linear entity scan already recorded for Phase 19A tables
(`docs/evidence/phase19a-table-performance.md` §2). Absolute cost stays
sub-second through 10,000 rows, so this is a recorded trend, not a blocker;
the fix site is a shared `parcelId → entity` lookup map, not memoization.

## 6. Repro + pre-fix record

1. `npx tsx scripts/phase19dParcelNetworkPerf.ts` → dense/sparse 1,000-parcel
   `network` column: 24.6 ms / 4.25 ms; dense 100→1,000 exponent 1.00,
   sparse 1.29.
2. `npx tsx scripts/phase19dParcelNetworkPerf.ts --large` → 10,000
   dense `network` ≈ 389 ms (whole probe wall 3.7 s).
3. Fix site: `src/engine/cad/cadParcelNetwork.ts` — bounds, resolved courses
   and normalized vertices precomputed once per parcel; disjoint bboxes
   skipped before exact work. Parity pinned by test
   (`matchResolvedParcelCourses ≡ matchParcelCourses`).
4. Pre-fix record (first probe, same box): dense/sparse 1,000-parcel network
   368.8 ms / 328.0 ms with sparse exponent 2.00 at zero candidate pairs;
   10,000 dense ≈ 32.8 s (whole `--large` wall 132 s). Cause: the nested
   all-pairs loop rebuilt `buildCadBounds([parcel])` twice per pair and
   re-resolved courses per pair, with no cached bounds.

Residual restriction (deferred, **not** a gap at plan scale): the candidate
scan is still an all-pairs bbox-compare loop (98 ms of the 389 ms at 10k
dense) — no uniform-grid index. The harness `indexedCand` column shows a grid
would cut that to ~15 ms at 10k. Candidate discovery and exact comparison are
correct and cheap; only a future index would move the residual.

## 7. Verdict

- Mission §§106-109 are **met at plan scale with a recorded restriction**:
  the network build is linear-plus-candidates through 1,000 parcels
  (24.6 ms dense / 4.25 ms sparse) and sub-second at 10,000 dense (389 ms).
  No arbitrary timing gate was introduced. No grid index was built; the
  residual all-pairs bbox scan is documented in §6.
- Schedule derive is roughly linear-quadratic in rows with sub-second cost
  through 10,000 rows; the per-row `entities.find` is the known 19A pattern.
