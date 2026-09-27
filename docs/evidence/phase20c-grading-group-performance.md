# Phase 20C grading-GROUP performance evidence (real 1k–100k TINs)

Script: `scripts/phase20cGradingGroupPerf.ts` (helpers in
`scripts/phase20cPerfHelpers.ts`). Full run on this machine:
**405.1 s, exit 0**; `--quick` smoke = 10.8 s, exit 0. No `src/` changes.

```
npx tsx scripts/phase20cGradingGroupPerf.ts            # full: 1k/10k/50k/100k
npx tsx scripts/phase20cGradingGroupPerf.ts --quick    # 1k/10k smoke
```

Method: the authoritative group kernel `computeGradingGroupFromSnapshots`
(the same function the worker handler's `computeGroupGradingResultFromRequest`
executes) on deterministic jittered grid TINs at 1k/10k/50k/**100k
triangles actually run — no extrapolation**. Group sizes 4/20/100 courses
(1000 for the completing flat chain at 1k/10k; 50k/100k×1000 is **UNRUN**
for runtime). Total wall is the median of 3 (≤10k) / 2 (50k) / 1 (100k)
`performance.now` runs after a warm-up. Per-stage numbers are V8
sampling-profiler self-time from a separate profiled run (50 µs interval,
bucketed by module + function), so they are advisory attribution, not a
timing gate. Heap delta (`heapUsed` before/after) is GC-noise dominated and
advisory only. Fail-closed outcomes are RECORDED, never thrown.

Cases (§107; fixed target domain per case so grid alignment does not drift
with group size):

| id | geometry | target | member chain | closed | maxSearch | criterion |
|---|---|---|---|---|---|---|
| A | flat closed notched pad | z=0 | `notchedRing(N)` 4+4m courses | yes | 20 | fixed −0.5 |
| B | sloped target | z=0.001·x | staircase N | no | 15 | fixed −0.5 |
| C | many plane breaks | z=sawtooth(x,40) | staircase N | no | 15 | fixed −0.5 |
| D | concave closed shape | z=0 (deep 40 m notches) | `notchedRing(N)` | yes | 30 | fixed −0.5 |
| E | cut/fill transition | z=0.5·sin(x/150) | staircase N | no | 15 | cut/fill ±0.5 |
| F | curved-member group | z=0 | `arcChain(N)` (12 chord-subdiv/member) | no | 20 | fixed −0.5 |
| G | no-solution corner stress | z=0 | staircase N | no | 1 | fixed −0.5 |
| H | flat chain (completing ref) | z=0 | staircase N | no | 15 | fixed −0.5 |

## 100k runs (mission §108 — required, actual)

| case | N | outcome | total ms | grpCand | outCand | daylight | verts/tris |
|---|---:|---|---:|---:|---:|---:|---:|
| H (flat chain) | 4 | EXACT | **148.5** | 32 | 32 | 9 | 15/13 |
| H (flat chain) | 20 | EXACT | **586.7** | 128 | 128 | 43 | 73/71 |
| H (flat chain) | 100 | EXACT | **2881** | 1,250 | 1,250 | 209 | 359/357 |
| A (flat closed pad) | 4 | CORNER_NO_SOLUTION@c2 | 277.4 | 28,560 | — | — | — |
| A | 20 | CORNER_NO_SOLUTION@c0 | 587.9 | 29,648 | — | — | — |
| A | 100 | CORNER_NO_SOLUTION@c0 | 2667 | 29,648 | — | — | — |
| B (sloped) | 4 / 20 / 100 | MEMBER_NO_SOLUTION | 98.6 / 99.0 / 102.3 | 420 / 3,120 / 59,512 | — | — | — |
| C (plane breaks) | 4 / 20 / 100 | MEMBER_NO_SOLUTION | 74.0 / 92.8 / 78.2 | 420 / 3,120 / 59,512 | — | — | — |
| D (concave closed) | 4 / 20 / 100 | CORNER@c2 / CORNER@c3 / MEMBER | 326.7 / 760.7 / 590.9 | 32,544 / 35,712 / 35,712 | — | — | — |
| E (cut/fill) | 4 / 20 / 100 | MEMBER_NO_SOLUTION | 73.8 / 74.2 / 78.7 | 420 / 3,120 / 59,512 | — | — | — |
| F (arc, 1200 chords @N=100) | 4 / 20 / 100 | CURVE_APPROX / CORNER@c5 / CORNER@c5 | 1228 / 6006 / **29,507** | 192 / 816 / 3,684 | 192 / — / — | 93 / — / — | 192/183 / — / — |
| G (corner stress) | 4 / 20 / 100 | MEMBER_NO_SOLUTION | 73.8 / 73.6 / 78.4 | 242 / 2,592 / 57,122 | — | — | — |

## Outcome summary across scales

Totals (median ms); `—` = fail-closed with the code shown in the full run
log. 18/98 cells complete (all 14 H cells, plus F@N=4 at 1k/10k/50k/100k).

| case | N | 1k | 10k | 50k | 100k |
|---|---:|---:|---:|---:|---:|
| H | 4 | 3.5 EXACT | 20.7 EXACT | 83.7 EXACT | 148.5 EXACT |
| H | 20 | 13.8 EXACT | 75.0 EXACT | 315.9 EXACT | 586.7 EXACT |
| H | 100 | 62.7 EXACT | 371.5 EXACT | 1528 EXACT | 2881 EXACT |
| H | 1000 | 1940 EXACT | 15985 EXACT | UNRUN | UNRUN |
| F | 4 | 20.2 CURVE | 130.0 CURVE | 625.9 CURVE | 1228 CURVE |
| A | 100 | 54.6 CORNER | 337.8 CORNER | 1398 CORNER | 2667 CORNER |
| B | 100 | 2.4 MEMBER | 15.5 MEMBER | 64.8 MEMBER | 102.3 MEMBER |
| C | 100 | 1.9 MEMBER | 12.6 MEMBER | 43.9 MEMBER | 78.2 MEMBER |
| D | 100 | 55.2 CORNER | 338.4 CORNER | 1434 CORNER | 590.9 MEMBER |
| E | 100 | 1.9 MEMBER | 11.1 MEMBER | 43.7 MEMBER | 78.7 MEMBER |
| G | 100 | 1.8 MEMBER | 11.6 MEMBER | 42.2 MEMBER | 78.4 MEMBER |

## Stage attribution (completing H series, profiled self-time ms)

| tris | N | total | idx build | grid build | member solve | corner class | miter tie | locus graph | clip | merge | valid | arc | glue |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10k | 4 | 20.7 | 3.9 | 15.5 | 0.2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 |
| 10k | 20 | 75.0 | 11.4 | 55.5 | 0.6 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 1.0 |
| 10k | 100 | 371.5 | 50.0 | 259.8 | 2.6 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 11.9 |
| 10k | 1000 | 15985 | 491.9 | 2561 | 23.0 | 1.2 | 0 | 0 | 0 | 0 | 0 | 0 | **6613** |
| 100k | 4 | 148.5 | 33.9 | 73.6 | 0.4 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 |
| 100k | 20 | 586.7 | 123.0 | 279.6 | 0.9 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 2.8 |
| 100k | 100 | 2881 | 583.0 | 1254 | 4.2 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 94.6 |

Corner classification, miter-tie solve, zero-locus graph, member clipping,
mesh merge and validation are all **sub-millisecond** at every measured
size (the corner stages total < 0.2 ms even at 100k×100). The engine is
**target-index bound**, not corner bound: grid construction (once per
member chord, see below) plus the index adapter is 64% of the 100k×100
total. `glue` is `gradingGroupCompute.ts` self-time (mesh merge / daylight
joining / corner accumulation are inlined into it by V8) and dominates the
1000-course case.

## Scaling exponents (previous scale → next; 1.00 = linear)

Total wall (H, completing reference):

| N | 1k→10k | 10k→50k | 50k→100k |
|---|---:|---:|---:|
| 4 | 0.77 | 0.87 | 0.83 |
| 20 | 0.74 | 0.89 | 0.89 |
| 100 | 0.77 | 0.88 | 0.92 |

Across group size at fixed target scale 10k: N 4→20 **0.80**, 20→100
**0.99**, 100→1000 **1.63**. So the per-chord pipeline is near-linear in
member count up to 100 courses and turns super-linear at 1000. That
super-linearity is entirely the `glue` term (mesh merge / daylight join):
11.9 ms @N=100 → 6613 ms @N=1000, exponent **2.75**. `grid build` stays
linear in chords (259.8 → 2561 = 0.99), as do `idx build` (0.98) and
`member solve` (0.88). Fail-closed cases (A–G) show the same near-linear
behaviour up to 100 courses: total exponents 0.6–1.3 with no trend above
~1.0 once the profiler attribution settles.

## Output-size scaling (mission §110)

Linear growth with no uncontrolled duplication — daylight nodes,
vertices, triangles and corner segments per course are flat:

| tris | N | daylight pts | verts | tris | corner segs | dl/N | tris/N |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1k | 4 | 9 | 15 | 13 | 4 | 2.25 | 3.25 |
| 1k | 100 | 203 | 353 | 351 | 102 | 2.03 | 3.51 |
| 1k | 1000 | 2024 | 3524 | 3522 | 1023 | 2.02 | 3.52 |
| 10k | 100 | 205 | 355 | 353 | 104 | 2.05 | 3.53 |
| 10k | 1000 | 2035 | 3535 | 3533 | 1034 | 2.04 | 3.53 |
| 100k | 4 | 9 | 15 | 13 | 4 | 2.25 | 3.25 |
| 100k | 20 | 43 | 73 | 71 | 22 | 2.15 | 3.55 |
| 100k | 100 | 209 | 359 | 357 | 108 | 2.09 | 3.57 |

At 100k, N 4→100 output exponents: daylight **0.98**, verts **0.99**,
tris **1.03** — i.e. O(N) with ~2 daylight nodes and ~3.5 triangles per
course, independent of TIN resolution. Corner runs add exactly one segment
per joint (99 joints → 108 segments at N=100). Nothing duplicates with
scale.

## §106 one-request / one-index assertion (in-script, fail-closed)

The script proxies the snapshot `points` array and counts `points.length`
reads (one per full-snapshot grid construction) and asserts the exact
count. Measured per group run: **`gridBuilds = 3 + Σ member chords`**
(`2` for the single shared `buildTargetQuery` adapter + `1` group-level
`candidateTriangles` pass + `1` per member chord). Completing runs hit the
full count; fail-closed runs stop early at the failing member/corner.

| case | N | chords | measured | full = 3+chords |
|---|---:|---:|---:|---:|
| A / D | 100 | 100 | 103 | 103 |
| B / C / E / G | 100 | 100 | 4 (dies on member 1) | 103 |
| F (arc) | 100 | 1200 | 1203 | 1203 |
| H | 4 | 4 | 7 | 7 |
| H | 20 | 20 | 23 | 23 |
| H | 100 | 100 | 103 | 103 |

**Finding:** the target snapshot is transferred once per request and the
shared query adapter is built **once** per group run (all members reuse it),
but candidate discovery calls `buildSurfaceGrid` **once per member chord**
(and the group-level candidate pass rebuilds it once more). The §106
"build the index ONCE and reuse it" goal is therefore only partially met:
the O(N) grid rebuilds dominate the runtime (grid build + index adapter =
64% of 100k×100 H). This is a structural finding, not a numerics change;
no tolerance/numeric code was touched.

## Worker entry vs pure engine

`computeGroupGradingResultFromRequest` (worker handler engine entry) vs
`computeGradingGroupFromSnapshots` on H N=20 @10k: **76.80 ms vs 76.96 ms
(−0.2%)** — the worker path is the same kernel plus a constant-time
flat-request mapping. A real `Worker` round-trip was not measured in-process
(no browser worker in this harness); the kernel cost is the whole story.

## 20B F-leg / R1 / R2 inheritance (mission §109, honest limits)

- **R1 (snap-vs-floor agreement gate) is carried and now blocks whole
  geometries, not just fractional nodes.** Every non-flat target case
  (B sloped, C plane-break, E cut/fill) fails at the **member** level with
  `MEMBER_NO_SOLUTION` / `GRADING_DAYLIGHT_DISAGREE` before any corner is
  processed — at every scale and every group size. A single 20B course on
  the same style of sloped plane still solves (`B single side=left OK`),
  because the case B target offset gives the gate a larger
  `4ε·max(1,|z|)` floor; the group chain's vertical members and far stations
  do not. The group path therefore inherits 20B case D/F behaviour rather
  than case B.
- **R2 (kink crossover) is carried at corners.** Concave/closed shapes A/D
  and the many-plane-break chain C fail with
  `CORNER_BRANCH_DISCONTINUITY` / `CORNER_SEAM_DISAGREE` /
  `CORNER_TRIM` at the first bad joint (D dies at c0–c3; A at c0/c2), which
  is the corner analogue of 20B case C.
- **20B F-leg (cut/fill `~6.4 s @100k`, exponent ~1.45–1.48) was NOT
  triggered in the group path**: group case E fails closed at the member
  agreement gate before reaching the expensive cut/fill coverage probes, so
  its cost is not observable here. The restriction remains disclosed/carried
  for the single-course path; it is neither worsened nor fixed by 20C.
- **Curved-member groups:** F@N=4 completes (`CURVE_APPROXIMATED`); F@N≥20
  fails at corner 5 (`CORNER_BRANCH_DISCONTINUITY`/`CORNER_NO_SOLUTION`).
  Its 1200 chord solves at 100k are the most expensive fail-closed workload
  measured (29.5 s), all spent in per-chord grid rebuilds.
- No engine numerics or tolerances were changed to improve any of this.

## Memory-ish deltas (advisory only)

`heapUsed` deltas are GC-noise dominated and swing negative, so they are
not evidence. Representative H values: @10k N=100 +14.4 MB; @10k N=1000
+4.9 MB; @50k N=20 +203 MB (GC not collected); @100k N=100 +354 MB,
N=4 −371 MB. Raw per-run deltas are in the script's JSON summary.

## Net

The group pipeline is correct and near-linear for the completing flat-chain
case up to 100 courses, with O(N) output and sub-millisecond corner math at
100k. Its runtime is dominated by rebuilding the target grid once per member
chord (§106 partially unmet), and at 1000 courses a super-linear
merge/daylight-assembly term (exponent ≈ 2.75) takes over. Numerical
agreement gates (R1/R2) fail most non-flat and closed-concave group
geometries closed at every scale — recorded, not worked around. No
production code, worker, UI or test files were modified.
