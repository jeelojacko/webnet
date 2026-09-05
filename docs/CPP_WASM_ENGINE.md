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

### Phase 6 — optimization and compatibility hardening (closure, 2026-09-05)

The measure-first tooling is in place: `bench:sparse-runtime` reports wall and broad solve-stage medians, while `parity:sparse-shadow -- --input <file.dat>` compares an authoritative TypeScript solve with the injected selected-network sparse route and writes local JSON/Markdown summaries. A native timing instrument now separates sparse assembly, equilibration, symbolic analysis/AMD ordering, numeric factorization, and triangular solve without changing the stable ABI or numerical results. Initial native measurements show symbolic analysis dominates factorization on small synthetic systems; no symbolic/numeric reuse or persistent WASM workspace is adopted yet. The current WASM rebuild is environment-blocked when `emcmake` is unavailable.

The covariance probe classified full-rank SPD and near-singular full-rank systems as undamped sparse success (A), while rank-deficient systems factored only after damping and produced unusable finite damped inverses (C). The existing TypeScript selected-covariance route rejects any nonzero sparse damping and falls back to dense TypeScript recovery; this was verified against the real WASM artifact. Eigen `SimplicialLDLT` is pivot-free and not equivalent to WebNet's pivoted Bunch–Kaufman LDLT, so no sparse covariance replacement is adopted. Damped covariance remains an explicit dense fallback.

Move observation/Jacobian construction only when measured benefits justify the parity risk; do not assume a C++ model migration is required.

Medium-case evidence batch (2026-09-05, bounded, no production routing or solver-math changes): the Phase 5 deterministic generator list grew from 6 to 9 full cases with `chain-2d-64`, `chain-2d-128`, and `gps-2d-64` (quick mode unchanged at `chain-2d-04` + `gps-2d-08`; existing seeds/inputs byte-identical). A shared size guard (`phase5BenchmarkSizeSkipReason`, `BENCH_MAX_UNKNOWN_COUNT`, default 256 unknowns) now skips every route — including the dense TS reference — with an explicit reason when a case exceeds the budget, protecting against unsafe dense/all-pairs O(n^2) memory work; the sparse-only `SPARSE_FULL_MAX_PARAMS` guard is unchanged. Measured full run (Ryzen 7 5800X3D, Node 26.8.1, warmups 2 / runs 5): all 9 cases converged in 4 iterations on all four routes with zero sparse fallbacks and max coordinate agreement 5.68e-14 m (tolerance 1e-6 m); TS-reference medians 25 ms (chain-64), 108 ms (chain-128), 34 ms (gps-64) versus selected-network medians 13/27/22 ms; selected plan queries stay a strict fraction of n^2 (892/65536 = 0.01 at chain-128). Explicit limitations: no gps-128 or larger case is covered; TS dense/all-pairs behavior is unmeasured beyond 128 unknowns (chain-128 emits 8,128 relativePrecision rows); stage-level runtime medians for medium cases come only from `bench:sparse-runtime` quick/small runs so far; no symbolic reuse, persistent workspace, or production routing change is adopted on this evidence.

### Phase 6 closure — production-readiness matrix and Phase 7 recommendation (2026-09-05, test-only, no production routing change)

Phase 6 is closed as a measurement/hardening batch. Production remains TypeScript-only; every sparse/selected-network route below is test-injected. Evidence mixes measurements re-run today (2026-09-05, Ryzen 7 5800X3D, Node 26.8.1, commit `d0feed7`) with previously recorded runs, marked accordingly. Unmeasured and blocked items are marked honestly — they are not gates that passed.

Re-run today:

- `bench:adjust:sparse-full --quick`: chain-2d-04 and gps-2d-08 converge in 4 iterations on all four routes with zero sparse fallbacks; max coordinate agreement `0` (chain) and `2.84e-14 m` (gps) vs TS reference; wall medians 1.6–4.8 ms across routes.
- `bench:sparse-runtime --quick`: sparse-selected wall 2.32/3.80 ms vs TS 2.80/4.11 ms; stage buckets 0–2 ms on these small cases; agreement `2.84e-14 m`.
- `bench:weights --quick`: structured weights build/finalize/pack in sub-millisecond to low-millisecond times (e.g. groups-2000: build 0.88 ms, finalize 4.94 ms, pack 0.110 ms); packed payload 139.28 KiB vs 30.52 MiB theoretical dense (224x saving); diag-only-2000 saves 1000x.
- `wasm:sparse:adjustment:parity`: `industry_standard_reference_case.dat` iterations=7, dof=134, max coordinate difference `2.41e-12 m`; both GPS fixtures agree exactly (`0`).
- `parity:sparse-shadow -- --input tests/fixtures/industry_standard_reference_case.dat`: PASS — 7 iterations both routes, diagnostics corr 7/0 rowp 1/0 selcov 1/0, coord `2.41e-12 m`, wall 45.96 ms TS vs 22.45 ms sparse-selected; relativePrecision rows 91 (TS) vs 0 (selected, by design).
- WASM artifact sizes (repo `cpp/build-wasm/`, uncompressed): `webnet_core.wasm` 204 KiB + `webnet_core.js` 36 KiB glue.

Previously recorded (not re-run today, values from the Phase 5/6 batches above):

- Medium full run (9 cases incl. chain-2d-64/128, gps-2d-64): 9/9 converged on all four routes, zero fallbacks, max diff `5.68e-14 m`; TS medians 25/108/34 ms vs selected-network 13/27/22 ms; selected plan queries 892/65536 (0.01) at chain-128.
- Sparse-kernel medians (WASM): n=100 `0.105 ms` through n=5,000 `1.839 ms`; native sparse 0.068–0.466 ms for n=100–1,000.
- Sparse-only large route (not compared to dense TS): chain-256/512/1000 completed in about 79/176/533 ms, GPS-128/256 in about 52/106 ms, and the 3D/GPS correlated case in 5.1 ms; all converged with zero fallbacks, truth error <=4.6 mm, and repeat differences 0.00e+0. Chain-1000 used 2,000 parameters/4,002 equations, 6,996 selected queries versus 4,000,000 full queries, and about 383 KiB sparse storage versus 122/30.5/30.5 MiB theoretical dense P/N/Qxx payloads.
- Worker bundle proof (~25 fresh workers, one bundle init each, repeat-seed determinism check) and post-init RSS stability: passed as recorded; not re-run today.
- Covariance damping probe: full-rank SPD and near-singular full-rank classified undamped sparse success (A); rank-deficient required damping and returned unusable damped inverses (C); selected-covariance damping rejection plus dense fallback verified against real WASM.
- Native phase-timing instrument: symbolic analysis/AMD dominates small solves; no reuse adopted.

| Capability | Readiness | Evidence / notes |
| --- | --- | --- |
| Sparse correction solve | Ready (experimental) | Full-adjustment parity `2.41e-12 m` on industry fixture; 9/9 generated cases agree within `5.68e-14 m`; zero fallbacks on covered inputs. |
| Structured weights (dense-P elimination) | Ready (experimental) | Direct packed transfer O(P_NNZ); 56–1000x payload savings measured; reconstruction/robust-update tests cover scalar, GPS, constraints, TS correlation. Dense P retained on default/fallback path. |
| Huber robust iterations | Ready (experimental) | Robust Huber parity passes; each inner solve repacks weighted P (repack under 0.1 ms at m=2000, measured). |
| GPS correlation blocks | Ready (experimental) | GPS 2D blocks covered by packing tests, gps-2d fixtures (exact/`2.84e-14 m` agreement), and gps-2d-64 medium case. 3D GPS and larger GPS blocks unmeasured. |
| TS setup/set correlation | Ready (experimental) | Writer-level coverage (group diagonals plus upper pairs, square-root-factor Huber rule) plus reconstruction tests. End-to-end correlated-TS field case beyond fixtures unmeasured. |
| Standardized residuals (row products) | Ready (experimental) | Batched row quadratic/cross-product API over the sparse factor; sparse-stats proof tests pass; nonzero-damping routes fall back to dense TS by design. |
| Selected covariance | Ready (experimental) | Selected-entry inverse without dense Qxx; plan queries a strict fraction of n squared (0.01 at chain-128); store reads fail closed. Damped sparse covariance explicitly rejected, dense fallback used. |
| 2D networks (small/medium) | Measured | Dense-reference comparison reaches chain-128/gps-64; sparse-only scaling reaches chain-1000 and gps-256 with truth/repeat checks. |
| 3D networks | Measured (modest) | `gps-3d-cov-08`: 8 unknown stations, 67 equations, correlated GPS, converged in 4 iterations with 1.19e-3 m truth error and zero fallbacks; no large 3D scaling family yet. |
| Large networks (1000+ unknowns) | Ready (experimental sparse-only) | `chain-2d-1000`: 1,000 unknown stations, 4,002 equations, 2,000 parameters, ~533 ms, 383 KiB sparse estimate, 6,996/4,000,000 selected/full queries; dense-reference parity is intentionally not claimed. |
| Worker deployment plus determinism | Provisionally ready | Fresh worker proof and shared-bundle stress both passed: one bundle initialization, 25 repetitions, bit-identical repeat output, near-zero heap drift, and stable post-init RSS trend. WASM rebuild is environment-blocked when `emcmake` is unavailable. |
| Damping fallback | Ready (experimental) | Same scaling/damping schedule as TS; Eigen success/failure may differ from pivoted dense TS and is surfaced, not silently retried; covariance path rejects damped sparse results. |
| Legacy all-pairs `relativePrecision` | Intentionally unchanged | Still O(S squared) output rows on the dense contract (chain-128 emits 8,128 rows); selected mode omits it by design. Any production sparse route must decide this contract explicitly. |
| Condition diagnostic | Gap on sparse path | TS records a norm-product condition estimate on iteration 1; injected sparse correction returns no Qxx and skips it. No sparse-path replacement exists. |
| Observation-model migration to C++ | Not started (not required) | Assembly/Jacobian/weighting math stays in TypeScript per the Phase 6 measure-first decision; move only with measured benefit. |
| SIMD / threads | Disabled | CMake/Emscripten targets build with no threads/SIMD; `SharedArrayBuffer`/cross-origin isolation not enabled. No measurements justify enabling them yet. |

Open question (not a gate failure, production unaffected): `parity:sparse-shadow -- --input public/examples/industry_demo.dat` FAILS because plain `LSAEngine.solve()` does not converge on that input under either route's default scenario options (TS 10 iterations unconverged vs sparse 5 iterations with divergent SEUW). The shadow tool is therefore valid only for directly-convergent fixtures; unconverged-input comparison semantics are undefined and unmeasured.

Phase 7 recommendation (explicit; Phase 7 is NOT started by this batch):

1. Do not switch production routing yet. The remaining blockers are the undecided legacy all-pairs contract, sparse-path condition diagnostics, and the lack of a large 3D scaling family — not solver correctness, which agrees at `1e-12 m` level on covered reference inputs.
2. If a first production candidate is wanted, scope it to small/medium 2D networks on the selected-network route with dense fallback armed, keeping TS assembly/statistics and the all-pairs contract untouched.
3. Before any routing change, add a larger 3D scaling family, a sparse-path condition-diagnostic replacement (or explicit waiver), and a re-run of the worker/determinism proof on the shipping artifact; the 2D 1000-unknown sparse-only case and memory observations now exist, but do not establish dense-reference parity.
4. Keep SIMD/threads and observation-model migration deferred until post-routing measurements show a specific bottleneck; native phase timings point at symbolic analysis first, but no reuse/workspace optimization is adopted without WASM-side boundary measurements.

### Phase 7A — production-readiness blockers (2026-09-05, closed; no routing change)

Phase 7A restored the intended toolchain and rebuilt `cpp/build-wasm` from scratch with Emscripten `6.0.9-git` (`4e422385...`), CMake `4.4.3`, Ninja `1.13.2`, pinned Eigen `5.0.1-dev`, and Node `26.8.1`. The fresh artifact is approximately 204 KiB WASM plus 36 KiB JS glue. Fresh add, dense solver, dense parity, sparse smoke/covariance/adjustment/behavior parity, browser smoke, bundle-worker proof, and worker stress all passed; industry sparse adjustment remained `2.41e-12 m` maximum coordinate difference with zero fallbacks. Worker proof showed one bundle initialization, deterministic repeat output, heap drift `+1.7 MiB`, and RSS drift `+10.3 MiB` across 25 fresh workers.

Deterministic real-WebNet 3D generated cases cover `gps-3d-16/32/64/128`; Phase 7B adds grid-mode G0/G1/G2/G3 fixtures with positive-definite nonzero EN/EU/NU covariance, mixed conventional observations, selected covariance, standardized residuals, split horizontal/height truth checks, repeat determinism, and zero-fallback assertions. Manageable full-ENU TS-vs-sparse proofs pass for the small fixture; larger 3D evidence is sparse-only where dense reference cost is unsafe.

The condition estimate audit found a user-visible, non-parity contract: the existing iteration-1 value is the raw normal-matrix row/column norm product, shown in text results and the report warning panel. Sparse correction now returns equivalent metadata from the raw native sparse normal matrix before scaling/damping; older artifacts use a fail-closed packed TypeScript fallback. Warning threshold and wording remain unchanged.

The legacy all-pairs `relativePrecision` audit found `C(S,2)` rows (300/1,225/8,128/32,640/124,750/499,500 for S=25/50/128/256/500/1000), with full text/report materialization and only observed-pair needs in GeoJSON/LandXML. Recommendation: retain the legacy contract through about 128 stations; above a conservative cap, use station plus connected/requested covariance and an explicit omission marker, never allocate dense Qxx or all-pairs rows. Arbitrary pairs are feasible through the existing query plan/store and operation-scoped sparse factor. Dense covariance fallback remains required for damped/rank-deficient sparse results, but must be size-guarded and surface a failure rather than presenting a biased damped inverse when undamped recovery is unavailable.

`evaluateSparseProductionEligibility` remains a pure, test-only, fail-closed classifier. It rejects unsupported run modes, missing WASM or worker availability, robust/TS-correlation/GPS-covariance modes, 3D, size overflow, and rank risk in deterministic reason order; it is not wired to routing. An optional non-serializable `AdjustmentRuntime` now flows session → scenario → LSAEngine and is owned by the worker-local provider. A test-only worker bridge loads the actual sparse WASM bundle, sends a real `RunRequestMessage`, proves correction/row-products/selected-covariance calls with zero fallbacks, and validates TS shadow parity plus repeat determinism. Requests, persistence, UI, and default TypeScript routing remain unchanged. Phase 7B is not started; Phase 7C remains a separate go/no-go decision.

### Phase 7B — full-ENU evidence and sparse condition parity (2026-09-05, closed; no routing change)

Bounded numerical/integration batch, all test-only, production TypeScript-only with tolerances/baselines untouched. Grid-mode G0/G1/G2/G3 reaches `gpsCovariance3d` with nonzero EN/EU/NU; LOCAL mode retains its documented diagonal proxy when geodetic transform context is unavailable. Proven: parser-to-inverse-weight-to-structured-P coverage, W·C=I, dense-vs-structured parity, full-ENU TS-vs-sparse agreement, sparse-only scaling, arbitrary-pair selected-covariance parity, and native raw-N condition metadata with first-iteration-only diagnostics. `AdjustmentRuntime` is non-serializable and threaded through sessions/scenarios into LSAEngine; the actual worker executes a test-injected real WASM bundle with zero correction/row-product/selected-covariance fallbacks. Internal precision policy names the legacy all-pairs and selected-network coverage decision without changing default output. Deferred: automatic routing, LOCAL full-ENU covariance, and any persisted/UI backend choice.

### Phase 7B.5 — legacy all-pairs precision compatibility (bounded; no routing change)

Test-only Option B: `experimentalSelectedCovarianceLegacyAllPairs` with an injected selected-covariance solver queries exact 2D/3D all-station blocks plus connected/requested pairs (no dense Qxx, no orientation unknowns) into a `SelectedCovarianceStore` carrying `legacyAllPairsCovered`; precision propagation reuses the identical dense all-pairs loop, so station/relative/all-pairs rows plus observation stats match the dense contract at `1e-9` relative. Without the flag, selected-network omission/scaling is unchanged. `PHASE7B_COVARIANCE_DEMAND_POLICY` names selected-network vs compat vs dense-all-entry demand; `comparePhase7bCompatDemand` benchmarks Option A (n^2) versus Option B on demand. Evidence in `tests/phase7b5_precision_compat.test.ts` (2D combined, arbitrary REL/PTOL, fixed-control REL, direction-set orientation unknowns, 3D full-ENU height blocks, nested propagation, fail-closed reads). Candidate-corpus simulation in `src/engine/phase7b5CandidateCorpus.ts` + `tests/phase7b5_candidate_corpus.test.ts` (11 candidates; every verdict via `evaluateSparseProductionEligibility` with recorded reasons; 4 sparse-ready cases run as the real sparse candidate inside the actual adjustment worker: triangulation/chain-16/gps-plain pass at 0/7.11e-15/2.84e-14 m with zero correction fallbacks, while weak-geometry resection pillars diverge at 1.10e+25 m and are flagged fail-closed; injected sparse failure falls back in-solve with recorded counts and a clean TS restart reproduces the reference bit-identically). Option A vs B demand in `scripts/benchmarks/benchmarkPhase7b5CompatDemand.ts` (`npm run bench:phase7b5:compat-demand`, reports under `reports/phase7b5/`): chain-2d 25/50/100/128 gives B/A ≈ 0.51/0.505/0.502/0.502 (B = 1275/5050/20100/32896 vs A = 2500/10000/40000/65536).

### Phase 7B.6 — safety gate and adversarial corpus (bounded; no routing change)

Test-only, no production routing/tolerance/baseline changes. Pure `SparseGeometryPreflight` (`src/engine/sparseGeometryPreflight.ts`) derives static facts from parsed/prepared structures (fixed controls, unknowns, DOF, connectivity/components, metric/angular-only, direction setups, single-setup resection, under-observed/isolated free stations) and rejects fail-closed in fixed reason order; `evaluateSparsePreflightEligibility` requires BOTH preflight and the existing production classifier to clear. Three-layer handshake (`src/engine/phase7b6CorrectionHandshake.ts`, fed by the recording decorator + dense rebuild in `tests/helpers/phase7b6FirstSystemCapture.ts`): captured first-system correction agreement (1e-9 absolute; measured 1.1e-15 chain-16, 2.2e-12 resection), captured-damping gate, fail-closed condition-evidence gate with the 1e12 production level as warning-only, plus final success/convergence/coordinate/iteration/height agreement (1e-6 m). Audit-measured limits, documented in-module: first systems agree even for the weak resection, and raw-N condition does not separate healthy triangulation (1.9e50) from weak resection (6.0e24), so rejection rests on preflight plus final agreement, never on condition alone. Deterministic 32-case adversarial corpus (`src/engine/phase7b6AdversarialCorpus.ts` + `tests/phase7b6_adversarial_corpus.test.ts`: 16 strong/seed/iteration pass probes, 1 weak-resection diverge probe, 11 ineligible false-admit probes, 4 reference-unconverged probes) classifies zero false admits and zero false rejects. Live in-process evidence against the real WASM bundle: weak resection is preflight-rejected (angular-only/direction-setups) and handshake-rejected (sparse candidate success=false with 1.48e+27 m divergence, zero correction fallbacks); strong chain-16 handshakes clean (first-system 1.1e-15 m, coordinates 7.11e-15 m) with zero fallbacks. Injected sparse failure falls back in-solve with recorded counts, exact legacy all-pairs precision (1e-9 relative), and a clean TS restart reproduces the reference bit-identically. Preflight unit/integration coverage in `tests/phase7b6_geometry_preflight.test.ts` (11 tests) and handshake gate coverage in `tests/phase7b6_correction_handshake.test.ts` (10 tests, incl. fail-closed 3D height).

### Phase 7B.7 — actual-worker corpus closure (bounded; no routing change)

Test-only, no production routing/tolerance/baseline changes. Automatic admission (legacy production eligibility AND static preflight AND TS-reference convergence, via `classifyPhase7b6Verdict`) over a deterministic 31-case corpus (`tests/phase7b7_worker_corpus.test.ts`: 14 pass probes incl. 2-leg/4-leg metric-doped resection, start-coordinate shifts, and a solved-reference-derived extra geometry leg; 1 weak-resection diverge probe; 11 ineligible probes; 5 reference-unconverged probes incl. the insufficient 2-leg doping dose) with zero false admits and zero false rejects. All 14 admitted cases run through the ACTUAL adjustment worker (worker-local real WASM via the existing bridge seam, legacy-all-pairs compat, zero correction fallbacks) and agree on the FULL result contract (`src/engine/phase7b7FullContract.ts`: coordinates/heights at 1e-6 m, iterations/DOF/order exact, SEUW/residuals/stdRes/redundancy/MDB/covariances/relativePrecision at 1e-9 relative, condition compared with a documented artifact rule) — chains bit-identical, doped 4-leg resection at 2.21e-8 m. Dose-response finding: 2 control-anchored legs clear preflight yet leave the reference unconverged (held automatically), while 4 legs admit and agree. Known artifact, recorded per case and never a rejection: the sparse injection path returns from iteration 1 before dense result-condition recording runs (existing production design; production never injects sparse solvers), so worker candidates carry no result-level `condition` while dense references do. Deterministic machine-readable report in `reports/phase7b7/phase7b7-worker-corpus.{json,md}`; perturbation/doping helpers in `src/engine/phase7b7WorkerCorpus.ts`. Injected sparse failure still falls back in-solve with a bit-identical clean TS restart.

### Phase 7 — production backend decision / optimization

Move iterative numerical adjustment into C++ while retaining TypeScript for orchestration, parsing/import/export, reporting, and browser workflows.

### Phase 6 — optimization

Only after parity: typed-array transfer optimization, native CLI reuse, WASM SIMD, and threading where useful.
