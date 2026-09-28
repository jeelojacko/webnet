# Phase 20D Wave-3B — design-surface workflow performance evidence (measured)

Script: `scripts/phase20dDesignPerf.ts` (no helper file, no `src/` change). Branch
`feat/cad-design-surface-workflow`, baseline HEAD `873142c6` (Phase 20D Wave-2 UI shell).

```
npx tsx scripts/phase20dDesignPerf.ts            # full: 4/20/100/1000 courses; 10k/50k/100k apply; 20 patches
npx tsx scripts/phase20dDesignPerf.ts --quick    # smoke: 4/20 courses; 10k apply; 5 patches
```

Results on this machine: **full 198.1 s, exit 0**; **`--quick` 9.6 s, exit 0**. No
`src/` file was modified. Repetitions: 3 timed reps (median) at ≤10k, 2 at 50k, 1 at
100k; every timed stage is warmed once (JIT + first-call allocation excluded). No
arbitrary timing gate exists anywhere in the harness.

- Hardware: AMD Ryzen 7 5800X3D, 16 logical CPUs; 31 GB RAM.
- OS / runtime: `linux 7.2.7-1-cachyos`, node `v26.8.1`.
- Load average: `0.81 / 1.28 / 1.83` at harness start, `2.19 / 1.66 / 1.86` at end.
- Stage self-time is V8 sampling-profiler attribution at a 50 µs interval (each stage
  profiled on a single monolithic pipeline run), **advisory** — not a timing gate.

Honesty notes (apply to every section):

- §102 patches are **synthetic aligned explicit-TIN islands** (flat z = 0), not the
  output of the 20C grading pipeline. Running the full group-calc + `DESIGNPATCH`
  build at 100k would itself be the dominant cost (and 20C closed-pad groups fail
  closed well below that scale), so apply is measured on the Design Surface size the
  mission names, using the composition core the command calls.
- §101 records every real-pipeline failure verbatim; it never substitutes the
  synthetic numbers for a real outcome.
- Every number below is from an actual run — nothing is extrapolated.

---

## 1. §101 PATCH BUILD

Two views. **(a)** the real pipeline (`GROUP_CREATE` → `computeGradingGroupFromSnapshots`
→ `resolveDesignPatch`, the build `DESIGNPATCH` commits) on the canonical 20D square
fixture (100×100 m pad @ z = 10, flat EG @ z = 0 on a step-20 grid over −60..160,
−50% fixed criterion, `maxSearchDistance` 50, split into 4·k courses). **(b)** the pure
build stages on a synthetic matching two-boundary annulus (same source ring, inner
boundary = ring @ padZ, outer = ring offset outward 20 m @ z = 0) so the stage scaling
curve reaches 1000 courses even where the real group shell does not agree.

### 1a. Real pipeline (median wall ms)

| courses | group ms | shell v/t | ring v | ring-edge gaps | outcome | merged v/t | total ms |
|---:|---:|---|---:|---:|---|---|---:|
| 4 | 8.79 | 16/16 | 4 | 0/4 | EXACT | 16/18 | 0.35 |
| 20 | 8.53 | 48/48 | 20 | 0/20 | EXACT | 48/66 | 0.75 |
| 100 | 23.99 | 228/208 | 100 | 10/100 | DESIGN_PATCH_RING_MESH_MISMATCH | 0/0 | 1.24 |
| 1000 | 307.4 | 2952/2008 | 1000 | 472/1000 | DESIGN_PATCH_RING_MESH_MISMATCH | 0/0 | 38.03 |

`ring-edge gaps` counts source-boundary ring edges absent from the group grading
mesh's edge set. **Honest finding:** the closed flat subdivided pad calc completes at
all four sizes, but `DESIGNPATCH` builds only at 4 and 20 courses. At 100 courses 10 of
100 source edges are missing from the shell (at 1000, 472 of 1000), so
`verifyRingAgainstMesh` — and therefore `resolveDesignPatch` — fail closed with
`DESIGN_PATCH_RING_MESH_MISMATCH`. This is the 20C group-shell/source-ring agreement
limit, **not** an 18Z composition issue (§104). It was already the honest outcome of the
20C gates; no tolerance was loosened to make it pass.

### 1b. Pure stages on a synthetic matching annulus (median wall ms)

| courses | ring v | shell v/t | pad tris | merged v/t | sourceRing | ringValidate | interiorTri | merge | total |
|---:|---:|---|---:|---|---:|---:|---:|---:|---:|
| 4 | 4 | 8/8 | 2 | 8/10 | 0.01 | 0.02 | 0.00 | 0.06 | 0.09 |
| 20 | 20 | 40/40 | 18 | 40/58 | 0.03 | 0.12 | 0.03 | 0.26 | 0.32 |
| 100 | 100 | 200/200 | 98 | 200/298 | 0.15 | 0.35 | 0.30 | 1.04 | 1.61 |
| 1000 | 1000 | 2000/2000 | 998 | 2000/2998 | 4.56 | 13.91 | 12.75 | 11.17 | 17.32 |

Patch build is cheap and effectively quadratic-ish only in the ring self-intersection
scan (`validateSourceRing`) plus the ear-clip interior; at 1000 courses the whole
build is ~17 ms. Nothing here is a bottleneck.

### 1c. V8 sampling self-time (ms), canonicalization/validation split out of merge

| courses | sourceRing | interiorTri | merge | canonicalization | validation | engineGlue | other |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 0.05 | 0.00 | 0.10 | 0.00 | 0.00 | 0.00 | 0.25 |
| 20 | 0.15 | 0.05 | 0.15 | 0.00 | 0.00 | 0.00 | 0.30 |
| 100 | 0.55 | 0.15 | 0.60 | 0.00 | 0.05 | 0.00 | 0.40 |
| 1000 | 5.70 | 3.55 | 7.95 | 0.35 | 0.15 | 0.00 | 26.85 |

Stock `canonicalizeBakedTin` and `validateExplicitTinPayload` are a small fraction of
the 1000-course build (<1 ms each); the merge cost is dominated by the manifold /
boundary-cycle edge maps, not canonicalization or validation.

---

## 2. §102 APPLY — `DESIGNAPPLY` against a Design Surface

Synthetic Design Surface (explicit TIN, `purpose='design'`, flat z = 0) at ~10k/50k/100k
triangles; aligned nested explicit-TIN islands (`purpose='design-patch'`). Columns:
`compose` = direct `composeSurfaceMeshes` (the exact core `DESIGNAPPLY` calls),
`preflight` = pure `preflightDesignApply` end-to-end, `commit` =
`runCadCommand(DESIGNAPPLY)` (commit path). D/E are **cumulative 2-step** sequences
(second apply composes against the first apply's result).

| target tris | case | patch tris | compose | preflight | commit | disposition | out verts/tris | seam m |
|---:|---|---:|---:|---:|---:|---|---|---:|
| 10,000 | A | 162 | 218.9 | 216.4 | 271.3 | EXACT | 5184/10082 | 360 |
| 10,000 | B | 1152 | 194.0 | 216.6 | 226.6 | EXACT | 5184/10082 | 960 |
| 10,000 | C | 5000 | 204.9 | 228.4 | 226.4 | EXACT | 5184/10082 | 2000 |
| 10,000 | D (2 disjoint) | 162 | 388.1 | — | 433.6 | EXACT | 5184/10082 | 720 |
| 10,000 | E (overlap) | 648 | 377.2 | — | 439.9 | EXACT | 5184/10082 | 1440 |
| 50,000 | A | 800 | 1274 | 1292 | 1289 | EXACT | 25281/49928 | 800 |
| 50,000 | B | 5618 | 1202 | 1296 | 1302 | EXACT | 25281/49928 | 2120 |
| 50,000 | C | 24642 | 1231 | 1401 | 1381 | EXACT | 25281/49928 | 4440 |
| 50,000 | D (2 disjoint) | 800 | 2410 | — | 2607 | EXACT | 25281/49928 | 1600 |
| 50,000 | E (overlap) | 3200 | 2381 | — | 2676 | EXACT | 25281/49928 | 3200 |
| 100,000 | A | 1568 | 2702 | 2990 | 2907 | EXACT | 50625/100352 | 1120 |
| 100,000 | B | 11250 | 2599 | 2831 | 2957 | EXACT | 50625/100352 | 3000 |
| 100,000 | C | 49298 | 2804 | 3086 | 3244 | EXACT | 50625/100352 | 6280 |
| 100,000 | D (2 disjoint) | 1568 | 5372 | — | 5924 | EXACT | 50625/100352 | 2240 |
| 100,000 | E (overlap) | 6272 | 5170 | — | 5830 | EXACT | 50625/100352 | 4480 |

Observations (all measured):

- The composition core is **target-size dominated**: at 100k, a 30× larger overlay
  (case C, 49 298 tris) costs only **+3.8%** over the smallest overlay (case A,
  1 568 tris). `preflight`/`commit` add only ~5–10% over the core (they pay one extra
  `buildCadSurface` of the target/patch plus the transaction).
- Scaling is ~linear: 10k → 50k (5× triangles) ≈ 6.3× ms; 50k → 100k (2×) ≈ 2.2× ms.
- Sequential D/E are ~2× a single step (two `composeSurfaceMeshes` calls), as expected;
  disjoint and overlapping behave the same.
- These single-step 100k numbers (2.6–2.8 s) sit on the **same curve as the documented
  18Z `partial-seam` 100k total of 2 873 ms** — no regression, no new phase.

---

## 3. §103 MULTI-PATCH — cumulative sequential `DESIGNAPPLY`

One ~100k Design Surface (base 50 625 verts / 100 352 tris), 20 distinct fine patches
(100×100 m @ 5 m cells, `purpose='design-patch'`), applied one at a time through the
real `runCadCommand(DESIGNAPPLY)` commit path. `apply ms` is the whole commit
(compose + transaction).

| patch # | apply ms | result verts | result tris | Δverts | Δtris |
|---:|---:|---:|---:|---:|---:|
| 1 | 3109 | 50710 | 100522 | +85 | +170 |
| 2 | 3112 | 50795 | 100692 | +85 | +170 |
| 3 | 3135 | 50880 | 100862 | +85 | +170 |
| 4 | 3117 | 50965 | 101032 | +85 | +170 |
| 5 | 3137 | 51050 | 101202 | +85 | +170 |
| 6 | 3175 | 51135 | 101372 | +85 | +170 |
| 7 | 3159 | 51220 | 101542 | +85 | +170 |
| 8 | 3143 | 51305 | 101712 | +85 | +170 |
| 9 | 3163 | 51390 | 101882 | +85 | +170 |
| 10 | 3079 | 51475 | 102052 | +85 | +170 |
| 11 | 3134 | 51560 | 102222 | +85 | +170 |
| 12 | 3155 | 51645 | 102392 | +85 | +170 |
| 13 | 3145 | 51730 | 102562 | +85 | +170 |
| 14 | 3187 | 51815 | 102732 | +85 | +170 |
| 15 | 3120 | 51900 | 102902 | +85 | +170 |
| 16 | 3181 | 51985 | 103072 | +85 | +170 |
| 17 | 3160 | 52070 | 103242 | +85 | +170 |
| 18 | 3161 | 52155 | 103412 | +85 | +170 |
| 19 | 3268 | 52240 | 103582 | +85 | +170 |
| 20 | 3302 | 52325 | 103752 | +85 | +170 |

- Apply time is **flat** (3.08–3.30 s, median ≈ 3.15 s) across 1 → 20 patches: the
  later composes are no slower than the first, despite the growing result mesh.
- Growth is **linear and bounded**: exactly +85 verts / +170 tris per fine patch;
  after 20 patches the surface is +1 700 verts (+3.4%) and +3 400 tris (+3.4%).
- No pathological growth, and no decimation is applied anywhere.

---

## 4. §104 verdict — reopen 18Z?

**NO.** No measured result justifies reopening the 18Z composition engine, and no
tolerance change is proposed.

- §102 apply costs match the documented 18Z profile (100k single-step 2.6–2.8 s vs 18Z
  `partial-seam` 2 873 ms) and scale ~linearly with target size; overlay size is
  near-irrelevant. There is no new composition bottleneck.
- §103 20 sequential patches on a 100k surface are flat in time and linear (+3.4 %) in
  output size — no superlinear growth to chase.
- §101 patch build is ≤ ~17 ms for pure stages at 1000 courses; canonicalization and
  validation are sub-millisecond. The one fail-closed at scale
  (`DESIGN_PATCH_RING_MESH_MISMATCH` at 100/1000 courses) is a **20C group-shell /
  source-ring agreement gate**, unrelated to 18Z; it is recorded here for follow-up,
  not as justification to reopen 18Z.
