# C++/WebAssembly numerical engine migration

Status: **Phase 0 — infrastructure and baseline only.** The TypeScript engine remains the authoritative production implementation. No adjustment solver has been ported.

## Current TypeScript architecture

The browser's primary path is `useAdjustmentRunner.ts`, which posts a `RunSessionRequest` to `src/workers/adjustmentWorker.ts`. The worker lazily imports `runAdjustmentSession` and reports progress/cancellation through `adjustmentWorkerProtocol.ts`. When workers are unavailable, the same hook uses the direct runner. CLI and other direct callers enter through `solveEngine()` in `src/engine/solveEngine.ts`.

The calculation path is:

1. `solveEngine()` calls `runAdjustmentScenario()` in `scenarioRunService.ts`.
2. The scenario service obtains cached parsed/prepared state and constructs `LSAEngine` (`adjust.ts`), then calls `LSAEngine.solve()`.
3. `runAdjustmentSession()` (`runSession.ts`) is the app orchestration layer. `runSessionSolver.ts` invokes the leaf scenario solve, optionally repeating it for auto-adjust, robust comparison, suspect-impact, or preanalysis scenarios.
4. `runAdjustmentSolveWorkflow()` (`adjustSolveWorkflow.ts`) parses or uses cached input, prepares active observations, applies overrides/constraints, and controls the iteration loop.
5. `assembleAdjustmentEquations()` (`adjustmentEquationAssembly.ts`) builds observation equations, misclosures `L`, weights `P`, row metadata, and sparse design rows. It may also retain a dense `A` for callers that request it.
6. `solveAdjustmentIteration()` (`adjustmentIteration.ts`) accumulates normal equations, solves for corrections, applies station and direction-set corrections with `applyAdjustmentCorrections()`, and computes residual progress. Huber robust mode repeats the weighted normal-equation solve up to five inner iterations.
7. Normal-equation work is delegated by `LSAEngine` to `adjustNormalEquationHelpers.ts`: scale `N`, scale `U`, use damped Cholesky, solve, and reject non-finite corrections. Final covariance recovery reassembles equations through `adjustCovarianceRecovery.ts` and `invertNormalMatrixForStats()`.
8. `adjustStatistics.ts`, `adjustStatisticsContext.ts`, and `precisionPropagation.ts` compute SEUW, tests, station/relative precision, ellipses, standardized residuals, redundancy, and diagnostics from the correction/residuals and `Qxx`.
9. `adjustResultWorkflow.ts` and related result builders construct the deterministic `AdjustmentResult`, which is consumed by reports, listings, exports, maps, and comparison workflows.

The worker target for the eventual backend is therefore:

```text
Browser UI
  -> adjustment Web Worker
     -> TypeScript orchestration/parser
        -> numerical backend
           -> TypeScript reference backend (current production path)
           -> C++/WASM backend (future)
```

Phase 0 does not change this routing.

## Matrix representation and dimensions

The engine uses hand-written TypeScript matrices (`Matrix = number[][]`) and sparse row entries (`SparseMatrixRows = SparseMatrixEntry[][]`).

| Structure | Representation | Dimension / role |
| --- | --- | --- |
| `A` | Optional dense `number[][]`; sparse rows are always available to the iteration path | observation-equation rows × unknown parameters |
| sparse design rows | sparse index/value entries, sorted by parameter index | observation-equation-sized rows, unknown-sized columns |
| `P` | dense `number[][]` | observation-equation × observation-equation; supports diagonal and correlated/full blocks |
| `L` | dense column matrix | one misclosure per observation equation |
| `N` | dense `number[][]` | unknown-parameter × unknown-parameter normal matrix |
| `U` | dense column matrix | unknown-parameter × one RHS |
| correction | dense column matrix | one value per unknown parameter |
| `Qxx` | dense `number[][]` | unknown-parameter × unknown-parameter covariance/inverse normal matrix |

Although equation assembly and normal accumulation use sparse row structure, normal accumulation (`matrixSparse.ts`) currently materializes dense `N` and `U`. `P` is also dense, and `Qxx` is a complete dense inverse when covariance is requested. Station identifiers and observation identifiers remain strings at the application boundary; parameter indexes are internal deterministic mappings.

## Numerical algorithms currently used

- Normal-matrix scaling in `adjustNormalMatrixHelpers.ts` uses diagonal factors `1 / sqrt(abs(Nii))` for finite, non-negligible diagonal values; `U` and the solution/inverse are scaled consistently.
- Main correction solves use lower-triangular Cholesky (`matrixCholesky.ts`) after scaling. It first attempts the undamped factorization, then increases diagonal damping by powers of ten (up to the existing attempt limit) when needed.
- `solveNormalEquations()` uses forward/back substitution and explicitly throws on non-finite correction values.
- Final covariance/statistics inversion uses the same scaled, damped Cholesky path. If damping was needed, `recoverUndampedInverse()` tries pivoted symmetric LDLT (`matrixLdlt.ts`, including 1×1/2×2 pivot blocks) on the undamped scaled normal matrix to avoid damping bias; it falls back to the damped inverse with a warning if recovery fails.
- The first iteration records a cheap row/column norm-product condition estimate (`LSAEngine.estimateCondition()`), not an SVD-based condition number.
- Huber robust weighting is applied in `adjustmentIteration.ts` and `adjustRobustWeights.ts`; factors are updated until the tolerance is met or five inner iterations are reached.
- In 3D covariance recovery, slope-distance observations can cause synthetic float-zenith rows to be added by `augmentCovarianceObservations()` (`adjustNormalEquationHelpers.ts`).

## Bottlenecks: measured versus suspected

Phase 0's benchmark suite records end-to-end `LSAEngine.solve()` wall time, resident memory before/after, solve metadata, and environment details. It currently reuses committed parity cases: `cli_smoke.dat`, `industry_standard_reference_case.dat`, and `industry_parity_phase2.dat`. Results are development observations, not CI thresholds.

Likely scaling costs supported by code inspection are:

- dense `numParams × numParams` `N` allocation and dense factorization;
- dense `Qxx` recovery, which performs a complete inverse even when downstream output may need only selected covariance elements;
- dense observation-sized `P`, especially for correlated observations;
- equation/Jacobian assembly and repeated iteration work;
- repeated solves from Huber, auto-adjust, robust comparison, suspect-impact, and preanalysis workflows;
- JavaScript nested-array/object allocation and numeric loop overhead.

The benchmark suite establishes measured end-to-end timings and RSS for the committed cases. It does not yet claim a phase-level bottleneck ranking: existing solve timing profiles (`solveTimingProfile`) provide broad phase buckets, but Phase 0 avoids invasive instrumentation changes. Larger deterministic network generators should be added only if existing committed datasets do not provide useful scaling coverage.

## TypeScript backend seam

`src/engine/numericalBackend.ts` defines the minimal future `NumericalBackend` (`typescript | wasm`) and `NormalEquationSolver` contract. `resolveNumericalBackend()` defaults to `typescript`; production adjustment does not consult it yet. `src/engine/wasmSmoke.ts` provides an isolated lazy optional loader contract for a generated module and safely returns `null` when unavailable. This avoids abstracting observation models or parser orchestration prematurely.

The eventual optimized boundary should use coarse-grained calls and contiguous `Float64Array`, `Uint32Array`, and `Int32Array` buffers rather than per-element JS↔WASM calls. Station IDs stay strings at the app layer; any native indexes must use an explicit deterministic ID↔index table and never depend on JavaScript property iteration order. The final binary protocol is intentionally deferred.

## C++/WASM Phase 0 scaffold

`cpp/` contains a portable C++20 library with a trivial `webnet::add()` and version query, a framework-free native CTest smoke test, and thin Embind bindings. The portable core has no browser, Node, React, DOM, or Emscripten dependency. Emscripten-specific code is confined to `cpp/bindings/`. Threads, `SharedArrayBuffer`, cross-origin isolation, and SIMD are deliberately disabled/not enabled.

Eigen is the first candidate for Phase 1 linear algebra, but is intentionally not acquired in Phase 0: the scaffold has no numerical algorithm to use it, so adding an unused large header dependency would add network, pinning, and licensing surface without proving anything. Phase 1 must pin a specific Eigen release/hash, record its MPL2 license, and compare its dense solver against the TypeScript reference before committing to it. SuiteSparse/CHOLMOD is deferred until Eigen or a lighter approach is shown inadequate, especially under Emscripten.

Prerequisites and commands are documented in `cpp/README.md`; normal `npm install` does not install a C++ toolchain.

## Data boundary evolution

- **Phase 0 / prototype:** simple coarse-grained smoke calls and a typed loader seam.
- **Initial parity:** dense normal-equation input/output is acceptable to minimize migration risk.
- **Optimized boundary:** packed typed-array buffers, explicit dimensions/index maps, batched assembly/solve operations, and no per-element calls. Parser/import/UI logic remains TypeScript until measured migration value is demonstrated.

## Roadmap

### Phase 0 — infrastructure and baseline

This batch: document current behavior, add reproducible TypeScript benchmark commands and artifacts, scaffold native C++ and optional Emscripten builds, add the backend/loader seam, and prove trivial calls where local toolchains are installed. No solver port and no production backend switch.

### Phase 1 — dense solver parity spike

Port only normal-equation scaling, factorization, and solve to C++/WASM using dense input/output. Compare focused TypeScript parity tests, all computational parity fixtures, and industry-reference parity. This is a proof seam, not the final architecture.

### Phase 2 — sparse normal-equation backend

Investigate Eigen sparse types/solvers first. Replace dense normal storage/solution only after measuring memory/runtime and preserving deterministic parity.

### Phase 3 — covariance/statistics strategy

Audit exactly which `Qxx` elements are consumed for station covariance, ellipses, standardized residuals, redundancy, relative precision, and diagnostics. Avoid materializing a full inverse when selected solves suffice.

### Phase 4 — equation assembly and observation models

Move Jacobian/equation construction and weighting incrementally where benchmarks justify it, with observation-type parity tests.

### Phase 5 — complete C++ calculation core

Move iterative numerical adjustment into C++ while retaining TypeScript for orchestration, parsing/import/export, reporting, and browser workflows.

### Phase 6 — optimization

Only after parity: typed-array transfer optimization, native CLI reuse, WASM SIMD, and threading where useful.
