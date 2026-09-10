# Phase 10B — Genuine-3D Native Correction Evidence

## Repository state

- Branch: `feat/3d-adjustment-substage-native-evidence`
- Baseline SHA: `23375236` (Phase 10A audit; PR #15 merged)
- Production behavior changed: NO
- Mathematical contract changed: NO
- Public protocol changed: NO
- Public result contract changed: NO (no new `AdjustmentResult` fields; the
  detailed profiler and iteration probe live outside the result behind
  test-only `EngineOptions`)
- Production sparse routing/eligibility changed: NO (3D stays ineligible)

## Contract

Phase 10B adds two opt-in, test-only seams with negligible disabled overhead
(one branch per stage, no timing calls unless enabled):

- `src/engine/adjustDetailedSolveProfile.ts` — internal detailed stage
  profiler: per-iteration assembly / normal-accumulation / factorization /
  state-update splits, final-covariance assembly / accumulate / invert split,
  statistics time, and call counts.
- `EngineOptions.iterationSystemProbe` — per-iteration capture of the exact
  packed design / weights / misclosures plus the dense TypeScript correction,
  enabling Level 1 identical-system native comparison.

Agent-tier contract: `tests/phase10b_detailed_timing_contract.test.ts`
(profiler-on vs profiler-off solves are bit-identical modulo volatile timing
logs; collected counts are sane; probe systems are well-formed; 3D production
eligibility still rejects with `dimension '3d'`).

Evidence campaign: `tests/evidence/phase10b_native_correction_evidence.test.ts`
(`phase10b` suite), real-WASM injected sparse correction seam only.

## Timing (Node process, 1 warm-up + 3 measured runs, medians)

`TS wall` is the uninstrumented production path (headline timing).
`TS profiled` includes profiler/probe capture overhead (packing + high-res
timers per iteration); the JSON carries both as `tsWallMedianMs` and
`tsProfiledWallMedianMs`. Overhead is noise at small sizes and ~17% at 128
params (295.14 → 346.21 ms), dominated by per-iteration packed-design
repacking for the probe.

| Fixture | params | rows | iters | TS wall (ms) | TS profiled (ms) | assembly | accumulate | factor/solve | state upd | stats |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| industry_demo (weak, inadmissible) | 9 | 17 | 10 | 5.69 | 3.97 | 0.72 | 0.04 | 0.77 | 0.03 | 0.63 |
| gps-3d-cov-08 | 24 | 75 | 4 | 4.03 | 4.23 | 0.60 | 0.07 | 0.13 | 0.02 | 1.09 |
| gps-3d-16 | 48 | 147 | 4 | 6.07 | 6.31 | 0.77 | 0.18 | 0.28 | 0.01 | 1.69 |
| gps-3d-32 | 96 | 291 | 4 | 13.68 | 16.68 | 1.65 | 0.57 | 1.14 | 0.04 | 4.76 |
| gps-3d-64 | 192 | 579 | 4 | 53.85 | 65.68 | 5.15 | 2.17 | 6.14 | 0.07 | 18.66 |
| gps-3d-128 | 384 | 1155 | 4 | 295.14 | 346.21 | 18.05 | 7.85 | 35.16 | 0.25 | 109.66 |

Values are run-local medians from the latest campaign run and carry normal
machine noise; the JSON artifact is the authoritative record.

Stage sums do not equal wall: wall additionally includes parse/setup,
precision propagation, result packaging, and uninstrumented gaps. State update
is negligible at every size (≤0.25 ms).

## Scaling

Params double per generated case (24→48→96→192→384); uninstrumented TS wall
goes 4.03→6.07→13.68→53.85→295.14 ms. Factor/solve grows
0.13→0.28→1.14→6.14→35.16 ms (dense O(n³) dominant at 128); accumulate grows
0.07→0.18→0.57→2.17→7.85 ms; assembly grows 0.60→0.77→1.65→5.15→18.05 ms.
Statistics (dense, TS) remain material at every size (109.66 ms at 128) and
exceed factor/solve below 64 params.

## Native parity

Level 1 (identical packed systems, real WASM solver, zero damping):

| Fixture | systems | max correction abs diff |
|---|---:|---:|
| gps-3d-cov-08 | 4 | 9.99e-16 |
| gps-3d-16 | 4 | 6.66e-16 |
| gps-3d-32 | 4 | 8.33e-16 |
| gps-3d-64 | 4 | 1.61e-15 |
| gps-3d-128 | 4 | 4.00e-15 |

Level 2 (full correction loop, injected native correction, dense
covariance/statistics preserved): all five admissible cases PASS the shared
shadow comparator at 1e-6 m with zero sparse fallbacks (max coord diff 1.1e-16
at 08, peaking at 7.1e-14 at 32 — nonmonotonic across sizes, height diff
exactly 0, iterations/converged/success match). First-iteration `result.condition`
estimates agree exactly between routes (1.7–1.8e14, warn-only; convergence
unaffected).

industry_demo is explicitly inadmissible, not a parity failure: it does not
converge (10 iterations, condition 4e48, TS damped path vs native undamped,
14 m Level 1 diffs). The harness records `admissible: false` with the reason
instead of inventing parity data — matching the Phase 10A classification of
this fixture as a weak-case observation, not a scaling anchor.

In-process sparse-loop walls: 3.20 / 6.24 / 10.87 / 47.92 / 230.99 ms
(0.97–1.28x over uninstrumented TS; the 16-case dip below 1x is machine noise
at small sizes). This is an optimistic upper bound only: module startup is amortized
(bundle loaded once), and worker serialization, verification, restart/fallback
accounting, and production eligibility are all unmeasured.

## Amdahl

Factor/solve fraction of uninstrumented TS wall: 0.033 (08) / 0.046 (16) /
0.083 (32) / 0.114 (64) / 0.119 (128). Even infinitely fast factorization caps
total speedup at 1.03x–1.13x at these sizes, because assembly + covariance + statistics
dominate. Native offload of factorization alone cannot move the needle until
the dense-tail stages (below) are addressed.

## Covariance

Final dense recovery medians (assembly / accumulate / invert ms):
08: 0.14/0.02/0.08; 16: 0.18/0.05/0.26; 32: 0.41/0.17/1.46;
64: 1.16/0.58/11.76; 128: 3.39/2.06/95.06. Inversion dominates at 128 (95.06
of 295.14 ms wall, 32%). Statistics add another 109.66 ms at 128. Together,
covariance + statistics are the largest dense tail — larger than the correction
loop at every size including 128.

## Duplicate work

Per converged solve the profiler confirms iterations + 1 full equation
assemblies (4 loop + 1 covariance = 5) plus the statistics pass over the same
systems. Assembly is repeated per nonlinear iteration by design (relinearization),
but the final covariance reassembly duplicates the last loop assembly at
identical geometry — the same duplicate-work shape Phase 10A flagged, now with
call counts instead of inference.

## Recommendation

1. Do not route 3D correction to native yet: Level 1/Level 2 prove the kernel
   is parity-safe on well-conditioned genuine 3D, but Amdahl shows ≤1.13x
   total upside up to 384 params while transfer/verification/fallback costs and
   3D safety evidence (C1/C2/C3, height-block covariance, worker restart) are
   still unmeasured.
2. Next evidence should target the dense tail, not the loop: selected-covariance
   architecture for the covariance + statistics stages (~210 ms combined at 128
   params) dominates any factorization win.
3. Keep the weak-case inadmissibility rule: any future 3D campaign must gate
   native parity on converged, undamped references, or damped-path divergence
   will masquerade as native error.

## Validation

- `npm run test:evidence -- phase10b`: PASS (Level 1 + Level 2 on 5 admissible
  cases, 1 correctly inadmissible weak case; ~5 s)
- Agent contract `tests/phase10b_detailed_timing_contract.test.ts`: 4/4 PASS
- Machine artifacts: `artifacts/evidence/phase10b/phase10b-native-correction.{json,md}`
  (gitignored; JSON carries per-system diffs, stage medians, Amdahl inputs)
