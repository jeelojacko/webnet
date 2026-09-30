# Phase 20K — hybrid arc×arc grading groups: performance

Status: MEASUREMENT ONLY, no thresholds. Harness:
`scripts/phase20kHybridArcPairPerf.ts` (`npx tsx … [--quick]`, default 5
reps, median). Fixtures are built OUTSIDE every timed region. Stage
breakdown comes from `assembleHybridArcGroup({ measure: true })`; production
comparators are timed whole. All times are milliseconds on the study machine.

## 1. Hybrid stage table

| case | model | joints | chords | srcPts | cand | roots | solve | corner | merge | valid | total | verts | tris | ms/joint | audit |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| gap.tol-25.chord | chord | 1 | 2 | 4 | 2 | 2 | 0.254 | 0.166 | 0.027 | 0.005 | 0.560 | 9 | 6 | 0.560 | fail(open daylight discontinuous) |
| gap.tol-10.chord | chord | 1 | 2 | 4 | 2 | 2 | 0.146 | 0.095 | 0.015 | 0.003 | 0.427 | 9 | 6 | 0.427 | fail(open daylight discontinuous) |
| gap.tol-0.1.chord | chord | 1 | 16 | 32 | 2 | 2 | 0.483 | 0.070 | 0.091 | 0.017 | 0.825 | 59 | 55 | 0.825 | fail(open daylight discontinuous) |
| gap.tol-0.01.chord | chord | 1 | 46 | 92 | 2 | 2 | 1.335 | 0.088 | 0.228 | 0.044 | 2.148 | 164 | 160 | 2.148 | fail(open daylight discontinuous) |
| gap.tol-0.1.true-tangent | true-tangent | 1 | 16 | 32 | 2 | 2 | 0.315 | 0.052 | 0.061 | 0.004 | 0.558 | 59 | 55 | 0.558 | fail(open daylight discontinuous) |
| overlap.tol-0.1.chord | chord | 1 | 16 | 32 | 2 | 2 | 0.271 | 0.157 | 0.068 | 0.005 | 0.617 | 66 | 56 | 0.617 | fail(overlap + pinch) |
| open.pair.tol-0.1 | chord | 1 | 16 | 32 | 2 | 2 | 0.231 | 0.066 | 0.057 | 0.004 | 0.507 | 59 | 55 | 0.507 | fail(open daylight discontinuous) |
| closed.square.hybrid | chord | 4 | 32 | 64 | 2 | 4 | 0.450 | 0.164 | 0.901 | 0.009 | 1.693 | 122 | 114 | 0.423 | **pass** |
| closed.square.mismatch.d24 | chord | 0 | 0 | 0 | 0 | 0 | – | – | – | – | 0.418 | 0 | 0 | – | fail-closed `TRANSITION_REQUIRED` |
| radius-120.tol-0.1 | chord | 1 | 19 | 38 | 2 | 2 | 0.241 | 0.042 | 0.073 | 0.005 | 0.498 | 71 | 67 | 0.498 | fail(open daylight discontinuous) |
| radius-252.5.tol-0.1 | chord | 1 | 16 | 32 | 2 | 2 | 0.184 | 0.041 | 0.054 | 0.004 | 0.412 | 59 | 55 | 0.412 | fail(open daylight discontinuous) |
| radius-500.tol-0.1 | chord | 1 | 14 | 28 | 2 | 2 | 0.126 | 0.039 | 0.048 | 0.004 | 0.323 | 51 | 47 | 0.323 | fail(overlap + pinch) |
| closed.square.offset-D10 | chord | 0 | 0 | 0 | 0 | 0 | – | – | – | – | 0.346 | 0 | 0 | – | fail-closed `TRANSITION_REQUIRED` |
| closed.square.offset-D20 | chord | 4 | 32 | 64 | 2 | 4 | 0.312 | 0.144 | 0.969 | 0.013 | 1.711 | 122 | 114 | 0.428 | **pass** |
| closed.square.offset-D40 | chord | 0 | 0 | 0 | 0 | 0 | – | – | – | – | 0.623 | 0 | 0 | – | fail-closed `TRANSITION_REQUIRED` |
| projected.closed.square (E≈2 M, N≈7 M) | chord | 0 | 0 | 0 | 0 | 0 | – | – | – | – | 0.045 | 0 | 0 | – | `MEMBER_NO_SOLUTION` |

`chords` = member subdivisions consumed; `srcPts` = stitched member source
points; `cand` = candidate target triangles; `roots` = sum of tie roots.

## 2. Production comparators (whole-call)

| case | joints | total | verts | tris | ms/joint | result |
|---|--:|--:|--:|--:|--:|---|
| prod.straight-hybrid | 4 | 0.542 | 16 | 16 | 0.135 | 4 ties |
| prod.one-arc-hybrid | 4 | 0.971 | 46 | 44 | 0.243 | 4 ties |
| prod.analytic-arc-pair | 4 | 1.227 | 108 | 100 | 0.307 | 4 ties |
| prod.surface-arc-pair | 4 | 0.906 | 0 | 0 | 0.227 | `GRADING_CORNER_SECTOR` |

The hybrid study assembler (which does more — audit-adjacent stage capture,
arc frames, and merge) is within the same order as the production analytic
arc control on the same closed square (hybrid 1.69 ms vs analytic 1.23 ms
total). No super-linear growth against the controls.

## 3. Corpus batch and dominant stages

- **Corpus batch** — `buildCorpus()` (39 rows): median **41.34 ms** over 5
  runs (~1.06 ms/row), 0 mismatches, 12 digests.
- **Dominant stage** — member **solve** dominates every open/radius/offset
  case (0.13–1.34 ms); **merge** dominates the closed square (0.90–0.97 ms)
  because it carries 114 faces. Validation is negligible (≤0.05 ms) in all
  cases.
- **Memory** — process `heapUsed ≈ 18.7 MB`, `rss ≈ 101.3 MB` after the run.

## 4. Determinism and digests

`buildCorpus()` is byte-identical across runs; the closed square carries a
stable canonical mesh digest (`5355ec70…`) that differs from the analytic
control (`0913cdda…`) for the representation reasons recorded in the
validation doc. 12 distinct success digests were observed across the corpus.
