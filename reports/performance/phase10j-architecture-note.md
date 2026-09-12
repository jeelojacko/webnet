# Phase 10J architecture note — 3D native performance decomposition

Measurement-only. No production routing/math/tolerance/protocol changes.

## Operation map (A/B/C/D)

- **A — iteration solve (TypeScript, dense).** Equation assembly,
  accumulation, factorization, correction per iteration.
  Timed by: `solveTimingProfile` `equationAssemblyMs` /
  `matrixFactorizationMs` (+ `DetailedSolveProfiler` iteration records
  where instrumented).
- **B — native Qxx query (WASM/C++, sparse).** Final selected covariance
  `Qxx = N⁻¹` queries only. Timed by: native `SparsePhaseTimings`
  (`assemblyMs / equilibrationMs / analyzeMs / factorizeMs / solveMs`)
  per `querySelected` call, plus the JS wrapper wall (buffer copies +
  glue). Wrapper overhead = wrapper wall − native phase sum, reported
  as-is (never forced non-negative).
- **C — C1/C2/C3 verification (TypeScript-side).** Sampled-column oracle
  agreement (C1), inverse residuals on captured native values (C2),
  physical validation (C3). Timing: **wall-clock wrapper only**
  (`totalWall − native wrapper sum`, shared with D). There is no
  isolated C1/C2/C3 timing API, so no sub-buckets are reported —
  `unavailable`, never synthesized.
- **D — statistics + reuse + reporting (TypeScript).** Dense-Qxx reuse
  (`reused-final-dense-qxx`), precision propagation, report diagnostics.
  Timed by: `solveTimingProfile` precision/statistics buckets.
  `otherMs` is carried as unattributed; bucket sums are never claimed
  to reconcile to the wall total.

## Exact call graph (production route cohort)

```text
runWithNativeFullQxxAutoRoute
├─ deriveNativeFullQxxEligibility        (3D / adjustment-only / param-cap gate)
├─ loadBundle → experimental sparse bundle (one shared WASM module)
├─ runAdjustmentSession(request, onProgress, runtime)
│  ├─ iteration solve …………………… A
│  └─ NativeFullQxxCaptureSolver.querySelected
│     └─ WasmSparseSelectedCovariance.querySelected
│        └─ _webnet_sparse_selected_covariance … B (SparsePhaseTimings)
├─ verifyNativeFullQxxSystems
│  ├─ evaluateSentinelC1 ………………… C1 (agreement, value-only)
│  ├─ evaluateSentinelC2 ………………… C2 (residual, value-only)
│  └─ physical validation ……………… C3 (value-only)
└─ statistics reuse + report …………… D
   on any failure: clean TypeScript rerun (fail-closed)
```

C1/C2/C3 observe captured native **values** only; their cost lives
inside the wrapper attribution. The 256 diagnostic cohort never enters
this graph (route-ineligible by param cap): it compares
`LSAEngine.solve()` TS vs native-injected directly, with C1/C2/C3
marked unavailable (route-only).

## Controlled variant verdicts

| Variant | Verdict |
|---|---|
| Covariance-only isolated timing | Unavailable — no safe standalone production API; reachable only via full solve. |
| C1/C2/C3 isolated timing | Unavailable — no safe public capture API; wrapper-only. |
| Legacy all-pairs / damping variants | Unavailable by design — would break production-equivalence. |
| 256 production route | Ineligible (384-param cap) — diagnostic engine cohort instead. |

Committed values: `reports/performance/phase10j-3d-decomposition.{json,md}`
(machine-observational walls, deterministic methodology). Machine detail:
`artifacts/evidence/phase10j/` (gitignored).
