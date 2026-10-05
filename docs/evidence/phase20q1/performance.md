# Phase 20Q.1 — Performance: singular sloped ≤ flat

Measurement only, zero `src/` changes. Script
`scripts/phase20q1TransitionPerf.ts` times the real production entry points on
an admitted singular transition: `admitGradingTransition` (policy), one
`computeGradingGroupFromSnapshots` call (member solves + tiler + merged mesh
+ `gtop2`), then `validateTransitionResultMeshAgainst` +
`checkGroupTransitionAgreement` (worker). Fixtures are built once outside
every timed region; medians over batched inner runs, determinism asserted
every run. Raw output: `perf-output.txt` (same dir).

| id | slope | policyMs | solveMs | workerMs | totalMs | verts | tris |
|----|-------|----------|---------|----------|---------|-------|------|
| flat | 0 | 0.001 | 0.188 | 0.010 | 0.199 | 10 | 8 |
| tiny | 1e-9 | 0.001 | 0.137 | 0.007 | 0.145 | 10 | 8 |
| p1 | 0.01 | 0.000 | 0.108 | 0.004 | 0.112 | 10 | 8 |
| p5 | 0.05 | 0.000 | 0.102 | 0.004 | 0.106 | 10 | 8 |
| p15 | 0.15 | 0.000 | 0.101 | 0.004 | 0.105 | 10 | 8 |
| p50 | 0.5 | 0.000 | 0.097 | 0.004 | 0.101 | 10 | 8 |
| CREST | +2/30 | 0.000 | 0.098 | 0.003 | 0.102 | 10 | 8 |
| SAG | -2/30 | 0.000 | 0.097 | 0.003 | 0.100 | 10 | 8 |

Ratios vs the flat control: solve **0.516–0.728**, total **0.504–0.727** for
every sloped row — i.e. sloped is **≤ flat**. The flat control's marginally
higher measured cost is timer noise at this sub-0.2 ms scale; all sloped rows
are within 0.1 ms of it. Policy and worker overhead stay at
0.000–0.001 / 0.003–0.010 ms regardless of slope; vertex/triangle counts are
constant (10/8) across the sweep.

## O(vertices), not O(iterations)

The tiler resolves each cut with a constant-time `transitionSourceZAt` call
and solves two straight outer sub-chords; the interior is a fixed 3-checkpoint
strip. Cost is therefore **O(member vertices)** — unchanged by slope
magnitude or the number of iterations; there is no iterative/smoothing loop to
converge. Adding slope does not add mesh vertices, so the merged mesh and
certificate work are identical to the flat case.

## Verification

An independent rerun of the script reproduced the same shape: every sloped
ratio < 1 (`tiny/flat` solve 0.756, `p50/flat` 0.549, `SAG/flat` 0.557) with
identical 10/8 vertex/triangle counts and identical repeated-solve digests.
Only absolute milliseconds vary run to run; the ordering contract holds.

## What this is not

- **A threshold/gate**: measurement only, no pass/fail budget enforced.
- **A smoothed/multi-iteration law**: S1 is a fixed piecewise solve, so there
  is no convergence cost to scale with slope.
