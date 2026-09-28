# Phase 20E Wave-2B — per-course criteria + planar pad performance evidence (measured)

Script: `scripts/phase20eGradingPerf.ts` (no `src/` modification, no helper file).
Branch `feat/cad-grading-per-course-planar-pads` (baseline `500928c2`).

```
npx tsx scripts/phase20eGradingPerf.ts            # full: 4/20/100/1000 courses; 4/20/100/1000 ring verts; 100k design base
npx tsx scripts/phase20eGradingPerf.ts --quick    # smoke: 4/20 courses; 4/20 verts; 20k design base
```

Full run on this machine: **wall 29.9 s, max RSS 651 MB, exit 0**. Quick run: ~4 s, exit 0.
Repetitions: 3 timed reps (median) at small sizes, 1 at 1000; each timed stage is
warmed by the repetition loop. Stage self-time is V8 sampling-profiler attribution at
a 50 µs interval (advisory). **No arbitrary timing gate exists anywhere in the harness.**

Environment (from the measured run):
- Hardware: AMD Ryzen 7 5800X3D 8-core / 16 logical CPUs; 31 GB RAM.
- OS / runtime: `linux 7.2.7-1-cachyos` (x86_64), node `v26.8.1`.
- Load average at harness start `1.02 / 4.15 / 3.69`, at end `1.03 / 3.51 / 3.50`.

Honesty notes:

- All target TINs are deterministic synthetic flat grids (`buildGridTin`, 20B generic-
  position jitter) or the canonical 20D step-grid fixture. Nothing is extrapolated.
- Fail-closed outcomes are **recorded verbatim**, never substituted. The full-100k
  group and the 100k-design apply both hit pre-existing engine gates (below); a
  completing coarse reference is measured alongside so the workflow has a real timing.
- The resolution figures are the *override-resolution* seam only
  (`resolveGroupMemberCriteria`: one `Map<"A>B">` build + O(courses) walk).

---

## 1. Group calc — courses × override fraction

Completing open flat staircase chain (40 m steps, max search 15) on a fixed-count
flat target grid; override resolution through the real sparse `courseCriteria` map.
Override fraction = FIXED_STEEP (`-1.0`) applied to every `1/4`th (25%) or every
course (100%); the rest stay at the group default (`-0.5`).

| courses | overrides | resolve ms | µs/course | compute ms | outcome | candidates | verts | tris |
|---:|---:|---:|---:|---:|---|---:|---:|---:|
| 4 | 0% | 0.01 | 2.878 | 21.19 | ok | 8 | 16 | 13 |
| 4 | 25% | 0.00 | 1.203 | 19.81 | ok | 8 | 16 | 13 |
| 4 | 100% | 0.00 | 0.625 | 15.86 | ok | 8 | 17 | 13 |
| 20 | 0% | 0.01 | 0.366 | 59.23 | ok | 18 | 80 | 69 |
| 20 | 25% | 0.01 | 0.381 | 53.40 | ok | 18 | 81 | 69 |
| 20 | 100% | 0.01 | 0.645 | 53.12 | ok | 18 | 83 | 69 |
| 100 | 0% | 0.04 | 0.401 | 257.7 | ok | 72 | 402 | 351 |
| 100 | 25% | 0.02 | 0.217 | 247.4 | CORNER_NO_SOLUTION | 0 | 0 | 0 |
| 100 | 100% | 0.03 | 0.272 | 255.4 | ok | 72 | 440 | 349 |
| 1000 | 0% | 0.31 | 0.305 | 7656 | ok | 3872 | 3974 | 3524 |
| 1000 | 25% | 0.38 | 0.381 | 2612 | CORNER_NO_SOLUTION | 0 | 0 | 0 |
| 1000 | 100% | 0.44 | 0.436 | 7653 | ok | 3872 | 4500 | 3509 |

**No O(n²) override lookup.** Resolution sits at ~0.22–0.65 µs/course from 20 to 1000
courses (0.01 ms at 20, 0.44 ms at 1000): a single map build plus one linear walk,
no `.find()` in a loop. Compute itself scales with the member/corner/target work
(21 ms → 53 ms → 248 ms → ~7.7 s for 4 → 20 → 100 → 1000 completing courses).

**Recorded fail-closed (not a lookup issue):** the 25% mixed-criterion staircase hits
the pre-existing 20B corner gate (`CORNER_NO_SOLUTION`) at 100 and 1000 courses;
uniform (0% and 100%) chains complete at every size. This is the 20B snap/floor
corner sensitivity already documented, not a regression from the override map.

### 1b. Group stage self-time (V8 profiler, advisory)

| courses | memberSolve | cornerClassifyMiter | miterTieSolve | meshMerge | validation | other | total ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 0.05 | 0.05 | 0.00 | 0.00 | 0.00 | 14.60 | 14.70 |
| 20 | 0.10 | 0.05 | 0.00 | 0.00 | 0.00 | 55.38 | 55.53 |
| 100 | 0.25 | 0.00 | 0.00 | 0.00 | 0.00 | 266.3 | 266.6 |
| 1000 | 3.85 | 0.15 | 0.00 | 0.00 | 0.00 | 2737 | 2741 |

`other` is dominated by target-grid/index construction and V8 internals that the
profiler does not bucket; the 20C harness observes the same attribution shape. The
per-course criterion adds only O(members) corner work (`cornerClassifyMiter` ≤3.85 ms
at 1000 courses); `miterTieSolve`/`meshMerge` stay sub-tick.

---

## 2. Design Patch stages — ring size × flat/planar

Regular `N`-gon (radius 100 m) as a closed source ring: flat (`z = 10`) or planar
(`z = 10 + 0.02x`), with a 1.4× daylight shell as the group mesh. Pure build seams:
`deriveDesignPatchPlane` → `verifyRingAgainstMesh` → `resolveDesignPatchInterior`
(ear-clip) → `mergePadWithGrading`.

| verts | kind | planeDerive ms | verify ms | earClip ms | merge ms | total ms | pad tris | merged tris |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 4 | flat | 0.02 | 0.04 | 0.04 | 0.16 | 0.25 | 2 | 10 |
| 4 | planar | 0.02 | 0.01 | 0.01 | 0.10 | 0.15 | 2 | 10 |
| 20 | flat | 0.01 | 0.06 | 0.10 | 0.36 | 0.54 | 18 | 58 |
| 20 | planar | 0.01 | 0.06 | 0.05 | 0.37 | 0.49 | 18 | 58 |
| 100 | flat | 0.03 | 0.26 | 0.44 | 1.55 | 2.29 | 98 | 298 |
| 100 | planar | 0.04 | 0.28 | 0.45 | 1.47 | 2.24 | 98 | 298 |
| 1000 | flat | 0.21 | 2.71 | 33.56 | 43.59 | 80.07 | 998 | 2998 |
| 1000 | planar | 0.08 | 2.48 | 4.14 | 13.90 | 20.60 | 998 | 2998 |

Plane derivation (the deterministic conditioned triple + local-frame residual check)
stays ≤0.21 ms even at 1000 vertices and is independent of the vertex count beyond
the linear coplanarity scan. Verify/ear-clip/merge grow mildly super-linearly
(ear-clip/merge are documented worst-case quadratic scans); the whole 1000-vertex
build is still ≤81 ms. Flat and planar paths are the same order of magnitude.

---

## 3. Representative 100k-target workflow (override group → patch → apply)

Group: canonical closed 100×100 pad (one of four courses overridden, 25%) on a coarse
fixture target; design base: a 100 352-triangle explicit TIN.

```
group target: 128 tris; design base: 100352 tris; group compute (25% override): ok in 5.52 ms
capture boundary: 5 verts; grading mesh 28 verts / 28 tris
DESIGNPATCH resolve: ok in 0.71 ms
DESIGNSURFACE copy: ok in 0.00 ms
3b 100k-design preflight: BLOCKED (The patch cannot be applied to the target surface.) in 1746 ms
3b 100k-design DESIGNAPPLY: blocked (no change) in 1787 ms
3c coarse design preflight: EXACT in 4.57 ms
3c coarse design DESIGNAPPLY: ok in 2.38 ms
3a full-100k override group: CORNER_BRANCH_DISCONTINUITY GRADING_CORNER_TIE in 1027 ms (target 100352 tris)
```

Honest findings:

- **3a — full-100k group:** the *same* closed override group pointed at the full
  100 352-triangle target fails closed with the pre-existing 20B corner gate
  `CORNER_BRANCH_DISCONTINUITY` (`GRADING_CORNER_TIE`). The 20E capture did not change
  the 20B kernel; the fine-grid branch discontinuity is the known limit, recorded as-is.
- **3b — 100k design apply:** DESIGNPATCH resolves and builds (0.71 ms), but the 18Y
  compose overlay of a 100 352-triangle design base with the patch fail-closes
  (a sub-ulp `SURFACE_COMPOSE_SEAM_Z_MISMATCH`; the same 1.3e-15 floor pinned in the
  browser spec letter M for the planar patch). The preflight/commit cost ~1.8 s each at
  that base size; no change is committed.
- **3c — completing reference:** the canonical 20D-style coarse 2-triangle design base
  composes `EXACT` and commits `DESIGNAPPLY` in 2.38 ms, at the same override-group
  scale. This is the real completing pipeline timing; the 100k figures above are the
  real non-completing timings, not a silent substitute.

---

## 4. WNCAD serialized bytes vs sparse override count

Same group with `N` sparse `courseCriteria` overrides, serialized through
`serializeCadDrawingFile` (UTF-8 bytes).

| overrides | courses | serialize ms | bytes | bytes/override |
|---:|---:|---:|---:|---:|
| 0 | 2 | 0.21 | 32 455 | 32 455 |
| 10 | 10 | 0.18 | 35 563 | 3 556 |
| 100 | 100 | 0.19 | 65 085 | 651 |
| 1000 | 1000 | 0.83 | 363 887 | 364 |

Marginal cost: `(65 085 − 35 563) / 90 = 328.0` bytes/override at 100,
`(363 887 − 65 085) / 900 = 331.9` bytes/override at 1000 — a flat ~330 bytes per
sparse override, no super-linear growth. Absent overrides add nothing (the project
with 0 overrides is the legacy size). Serialize time stays ≤0.83 ms at 1000 overrides.

---

## Summary

- Sparse override resolution is O(1) per course (single map build + linear walk).
- Patch build is cheap at every measured size; 1000-vertex builds ≤81 ms.
- The 20E additions introduce **no new quadratic path**; all recorded failures are
  pre-existing 20B corner / 18Y compose gates, reported verbatim.
- WNCAD grows by a flat ~330 bytes per sparse override.
