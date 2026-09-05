# C++/WebAssembly numerical engine migration

Status: **Phase 4 — experimental sparse-weight calculation path.** The TypeScript engine remains the authoritative production implementation; dense and sparse WASM are test-only and injected explicitly.

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

Phase 2 adds only an explicit test-injected sparse correction solver at `solveAdjustmentIteration`; production and all covariance/statistics routing remain TypeScript.

## Matrix representation and dimensions

The engine uses hand-written TypeScript matrices (`Matrix = number[][]`) and sparse row entries (`SparseMatrixRows = SparseMatrixEntry[][]`).

| Structure | Representation | Dimension / role |
| --- | --- | --- |
| `A` | Optional dense `number[][]`; sparse rows are always available to the iteration path | observation-equation rows × unknown parameters |
| sparse design rows | sparse index/value entries, sorted by parameter index | observation-equation-sized rows, unknown-sized columns |
| `P` | dense `number[][]` by default; structured symmetric typed arrays experimentally | observation-equation × observation-equation; supports diagonal and correlated blocks |
| `L` | dense column matrix | one misclosure per observation equation |
| `N` | dense `number[][]` on TS/reference path; sparse Eigen storage in experimental Phase 2 path | unknown-parameter × unknown-parameter normal matrix |
| `U` | dense column matrix on TS path; Eigen vector in experimental sparse path | unknown-parameter × one RHS |
| correction | dense column matrix | one value per unknown parameter |
| `Qxx` | dense `number[][]` | unknown-parameter × unknown-parameter covariance/inverse normal matrix |

Although equation assembly uses sparse row structure, the production normal accumulation (`matrixSparse.ts`) still materializes dense `N` and `U`. Experimental Phase 2 packs those rows and only nonzero upper-triangle `P` entries, then assembles sparse `N`/`U` in C++ without a dense N. `P` remains dense in TypeScript, and `Qxx` remains a complete dense inverse when covariance is requested. Station identifiers and observation identifiers remain strings at the application boundary; parameter indexes are internal deterministic mappings.

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

## C++/WASM solver implementations

`cpp/` contains a portable C++20 dense correction solver matching the TypeScript scaled normal-equation path: diagonal equilibration, symmetric Cholesky, `1e-12` pivot rejection, geometric diagonal damping, substitutions, and unscaling. It uses contiguous row-major `double` buffers and returns correction values plus damping metadata. Covariance, LDLT recovery, statistics, and equation assembly remain TypeScript.

The C ABI is `webnet_dense_solve(normal, rhs, correction, n, damping, attempts, error, capacity)` with deterministic status codes and NUL-terminated errors. Emscripten-specific code is confined to `cpp/bindings/`; the TypeScript wrapper transfers one complete square system with exactly one RHS column, solves synchronously after lazy async module initialization, checks allocation failure, and frees all allocations. `normalEquationSolver` is an explicit test-only `LSAEngine` injection; undefined preserves TypeScript production behavior. Its `solveCorrection` contract intentionally excludes covariance and is not a general replacement for the old multi-purpose solver interface. WASM boundary errors use stable status classes rather than promising byte-identical TS diagnostic strings. Threads, `SharedArrayBuffer`, cross-origin isolation, and SIMD remain disabled/not enabled.

Phase 1's dense solver remains dependency-free and is the correction reference. Phase 2 pins Eigen 5.0.1 for the experimental sparse solver; SuiteSparse/CHOLMOD and iterative solvers remain deferred.

Prerequisites and commands are documented in `cpp/README.md`; normal `npm install` does not install a C++ toolchain.

## Phase 2 sparse correction path

The experimental boundary packs sorted sparse design rows as CSR-like `rowOffsets`, `columns`, and `values`; upper-triangle nonzero weights as `rows`, `columns`, and `values`; and one contiguous `Float64Array` of misclosures. C++ forms `N=AᵀPA` and `U=AᵀPL` directly from these entries, accounting for both symmetric terms of every off-diagonal weight. Eigen 5.0.1 `SimplicialLLT` with `AMDOrdering<int>` then solves the scaled sparse normal equations. The same TypeScript diagonal scaling thresholds and damping schedule are retained conceptually; Eigen factorization success/failure can differ from the TS pivoted dense implementation, and failures are surfaced rather than silently falling back. `analyzePattern` reuse was not introduced: each solve owns a fresh factorization, avoiding stale symbolic structure when active observations or unknowns change.

The Phase 2 wrapper returns only correction plus development metadata: design NNZ, P NNZ, N NNZ, factor NNZ, damping, attempts, solver, and ordering. Phase 4 experimental assembly finalizes diagonal plus canonical upper-triangle weights directly into typed arrays, so successful sparse correction/statistics/covariance injection avoids the prior m² P scan and allocation. The dense TypeScript default and explicit dense fallback remain available for parity and unsupported cases. The sparse injected path also skips the first-iteration condition estimation recorded on the TypeScript path, since it returns no Qxx. The current Emscripten artifact is approximately 194 KiB uncompressed WASM plus 35 KiB JS glue (exact bytes vary with toolchain/build metadata); `npm run wasm:browser:smoke` loads the emitted module through Vite/Chromium. It is not loaded by the production application bundle because sparse execution is test-injected only. It rejects malformed/non-finite packed inputs, owns all temporary WASM allocations, and does not transfer station or observation strings. Robust Huber iterations repack the current weighted P for every inner solve. Final covariance/statistics still use the existing dense TypeScript path, so that remains the large-network ceiling.

## Data boundary evolution

- **Phase 0 / prototype:** simple coarse-grained smoke calls and a typed loader seam.
- **Initial parity:** dense normal-equation input/output is acceptable to minimize migration risk.
- **Optimized boundary:** packed typed-array buffers, explicit dimensions/index maps, batched assembly/solve operations, and no per-element calls. Parser/import/UI logic remains TypeScript until measured migration value is demonstrated.

## Roadmap

### Phase 0 — infrastructure and baseline

This batch scaffolded native C++/WASM builds, benchmarks, and the isolated backend seam. It did not switch production away from TypeScript.

### Phase 1 — correction-only dense parity

This batch ports only correction solving. Native CTest covers SPD, scaling, damping, asymmetry, invalid inputs, and ABI behavior. `npm run wasm:solver:smoke` exercises the real wrapper and `npm run wasm:solver:parity` compares TypeScript/WASM corrections at n=1, 2, 5, 10, 25, 50, and 100. Observed generated SPD maximum difference is `3.39e-14` (below the `1e-12` gate); damping metadata also matches. No covariance or production backend migration is included.

`npm run bench:normal` uses the same deterministic diagonally dominant systems for TypeScript and transfer-inclusive WASM, and the native benchmark uses the same portable solver. `npm run bench:sparse` compares TS dense accumulation/solve, Phase 1 WASM dense, Phase 2 WASM sparse, and native sparse across network-like bounded-degree systems; `npm run bench:adjust:sparse` compares actual LSAEngine runs. On the recorded Node 26.8.1 / Linux x64 run: n=25 TS/WASM 0.056/0.025 ms, n=100 0.330/0.255 ms, n=200 1.598/1.548 ms, n=400 11.616/9.780 ms, and n=800 73.920/69.862 ms median. Native per-solve results were 0.016 ms (n=50), 0.133 ms (n=100), and 0.933 ms (n=200). These are observations, not CI thresholds; WASM values include heap transfer and dense O(n³) limits remain.

### Phase 1 — dense solver parity spike (complete)

Correction-only normal-equation scaling, factorization, and solve now run through the native/WASM proof seam. Full engine production routing and covariance remain TypeScript.

### Phase 2 — sparse normal-equation backend (complete)

The experimental path packs sparse A rows and nonzero upper-triangle P, assembles sparse N/U in C++, and solves with Eigen 5.0.1 SimplicialLLT + AMD. Native and WASM CTest, ABI smoke, sparse packing tests, correlated assembly tests, robust Huber parity, full adjustment parity, and industry-reference parity pass. Maximum full-adjustment coordinate difference was `2.41e-12`; no production backend switch occurred.

Recorded sparse-kernel medians on Node 26.8.1/Linux x64 were WASM sparse: n=100 `0.105 ms`, 250 `0.216 ms`, 500 `0.236 ms`, 1,000 `0.423 ms`, 2,500 `0.918 ms`, 5,000 `1.839 ms`; TS dense and Phase 1 WASM dense were measured through n=250 and skipped honestly above that range. Native sparse timings were 0.068/0.117/0.229/0.466 ms for n=100/250/500/1,000. The synthetic network had 2n equation rows and bounded row degree. Dense P remains allocated in TS and final dense Qxx/covariance remains the dominant unported ceiling.

### Phase 3 — covariance/statistics strategy (complete)

The Qxx consumer audit found two separate final systems. Covariance recovery (S2) consumes station blocks, connected/requested relative blocks, and the legacy all-pairs `relativePrecision` table (`C(S,2)` rows). Standardized-residual statistics (S3) rebuilds its own equation system, reapplies Huber factors, and consumes row products `a_i Qxx a_j^T`, including GPS component cross-products. S2 may also contain synthetic float-zenith covariance rows, so the systems must not share a factor blindly.

Portable C++ now exposes selected inverse entries and batched row quadratic/cross products over the existing pinned-Eigen sparse factor. Both APIs preserve diagonal scaling, factor once, solve grouped RHS columns/rows, return damping and fill metadata, never materialize dense N/Qxx, and reject malformed or non-finite packed inputs. Experimental standardized-residual routing falls back to dense TypeScript statistics whenever sparse damping is nonzero, because the dense path recovers undamped covariance. `wasmSparseCovariance.ts` and `wasmSparseRowProducts.ts` provide allocation-safe, contiguous-buffer wrappers. `covarianceQueryPlan.ts` is a pure deterministic planner for station blocks and connected/requested pairs. These are experimental infrastructure only; dense TypeScript covariance/statistics and production defaults are unchanged.

The legacy all-pairs relative-precision contract remains intentionally unchanged and is explicitly O(S²) in output rows. Dense P construction/scanning, final dense Qxx/statistics, and damped-covariance/LDLT parity remain limitations. The next integration gate is selected-entry and row-product parity on S2/S3 fixtures before routing any experimental statistics consumer.

### Phase 4 — sparse weight representation / dense-P elimination (complete)

Keep observation equations and weighting mathematics in TypeScript, but target a structured symmetric typed-array weight representation from assembly. Experimental correction, standardized-residual, and selected-covariance paths now omit dense `P`; dense TypeScript defaults and explicit fallback remain unchanged.

P inventory: scalar observation, distance, angle, bearing/direction, leveling, zenith, GPS, and constraint writers now target `WeightMatrixWriter`. GPS blocks are small correlated blocks; coordinate constraints write XY correlations; TS setup/set correlation writes complete group diagonals and upper pairs; Huber mutates diagonals and TS-correlation pairs using the existing square-root factor rule. `vᵀPv` uses the structured diagonal-plus-twice-upper-pair formula. The only remaining dense-P reference operation is the default/fallback path; the former `packUpperTriangleWeights` m² scan is not used by successful experimental sparse assembly.

`StructuredSymmetricWeights` stores a `Float64Array` diagonal plus canonical sorted `Int32Array` row/column and `Float64Array` off-diagonal values. Builders enforce finite/bounds/symmetry/zero/deterministic-order invariants. Direct packed transfer is O(P_NNZ). At m=32,000, the benchmark's structured groups used 142,613 entries (2,228 KiB packed) versus 7,812.50 MiB theoretical dense payload; the largest safe benchmark used no dense m×m allocation. Full benchmark output is produced by `npm run bench:weights`; values are measurements, not CI thresholds.

Dense-vs-structured reconstruction tests cover scalar, GPS 2D/3D, correlated constraints, TS correlation, robust updates, weighted quadratics, and direct packed identity. Successful injected correction/statistics/covariance paths use `omitDenseP: true`; sparse failures, unsupported robust cases, and nonzero covariance damping explicitly reassemble/fall back to dense TypeScript. Production remains TypeScript-only. Large-network dense Qxx/all-pairs relativePrecision and dense P reference fallback remain limitations.

### Phase 5 — end-to-end experimental sparse numerical pipeline

Measure and harden the complete sparse-weight path, including large networks, robust updates, covariance/statistics products, and memory behavior.

Bounded test-only infrastructure (2026-09-05): `src/engine/wasm/experimentalSparseNumericalBundle.ts` loads one shared `WebNetWasmModule` and exposes all three sparse solvers plus a `buildExperimentalSparseEngineOptions` injection helper; `src/engine/experimentalSparseDiagnostics.ts` adds optional route counters/reasons (sparse correction, row products, selected covariance, and dense fallbacks) wired through the existing experimental paths, forwarded into nested solves, and inert unless injected. Production remains TypeScript-only.

Selected-network covariance mode (2026-09-05, test-only): `experimentalSelectedCovarianceMode` with an injected selected-covariance solver queries only `covarianceQueryPlan` station+connected/requested entries into a `SelectedCovarianceStore` (`src/engine/selectedCovarianceStore.ts`, fail-closed reads) instead of reconstructing dense Qxx; precision propagation uses the store accessor and skips only legacy all-pairs `relativePrecision`, leaving station/connected/requested rows on the dense contract. Without the flag, recovery keeps the all-entry dense behavior.

Worker-compatible bundle proof (2026-09-05, test-only): `npm run wasm:sparse:bundle:worker-proof` runs `scripts/wasmSparseBundleWorkerProof.ts` under `node --import tsx`; each of ~25 fresh workers initializes the bundle once, runs one generated case through all three solvers, and returns route diagnostics with heap/RSS observations plus a repeat-seed determinism check.

### Phase 6 — optimization and compatibility hardening (in progress)

The measure-first tooling is in place: `bench:sparse-runtime` reports wall and broad solve-stage medians, while `parity:sparse-shadow -- --input <file.dat>` compares an authoritative TypeScript solve with the injected selected-network sparse route and writes local JSON/Markdown summaries. A native timing instrument now separates sparse assembly, equilibration, symbolic analysis/AMD ordering, numeric factorization, and triangular solve without changing the stable ABI or numerical results. Initial native measurements show symbolic analysis dominates factorization on small synthetic systems; no symbolic/numeric reuse or persistent WASM workspace is adopted yet. The current WASM rebuild is environment-blocked when `emcmake` is unavailable.

Move observation/Jacobian construction only when measured benefits justify the parity risk; do not assume a C++ model migration is required.

### Phase 7 — production backend decision / optimization

Move iterative numerical adjustment into C++ while retaining TypeScript for orchestration, parsing/import/export, reporting, and browser workflows.

### Phase 6 — optimization

Only after parity: typed-array transfer optimization, native CLI reuse, WASM SIMD, and threading where useful.
