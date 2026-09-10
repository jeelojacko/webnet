# Phase 10A — Normal 3D Adjustment Performance Audit

## Repository state

- Branch: `feat/3d-adjustment-performance-audit`
- Baseline main SHA: `7c2abc50987c964b761b289a2a0da56b127b61f8`
- HEAD: `2161052d` before report-only closure metadata update
- PR: [#15](https://github.com/jeelojacko/webnet/pull/15)
- Production behavior changed: NO
- Mathematical contract changed: NO
- Public protocol changed: NO
- Sync `runAdjustmentSession` preserved: YES

Evidence branch only. Existing unrelated Phase 9L work was stashed before branch creation.

## Current 3D architecture

Entry and routing:

- `src/engine/runSession.ts:runAdjustmentSession` resets session state, creates `createSessionSolveRunner`, runs optional auto-adjust cycles, then calls `solveWithImpacts`.
- `src/engine/runSessionSolver.ts:createSessionSolveRunner` calls `runAdjustmentSolveWorkflow` through `solveCore`; ordinary adjustment and nested scenarios use same synchronous TypeScript solve path.
- `src/engine/adjustSolveWorkflow.ts:runAdjustmentSolveWorkflow` parses/setup, builds `SolvePreparation`, creates parameter indexes, runs correction iterations, recovers final covariance, calculates statistics, and packages result.
- `src/engine/adjustmentWorker.ts` / `src/workers/adjustmentWorkerHandler.ts` provide worker protocol. Normal worker sparse dispatch is in `src/workers/adjustmentSparseAutoRoute.ts`; it is fail-closed and currently requires 2D.
- `src/engine/sparseProductionEligibility.ts:evaluateSparseProductionEligibility` rejects any dimension other than `2d`. `deriveSparseAutoRouteEligibility` additionally rejects robust weighting, TS correlation, GPS covariance, multi-solve sessions, and geometry/rank risks.

Normal 3D adjustment therefore always uses dense TypeScript in production. It does not attempt C++/WASM sparse adjustment and does not reach a hybrid 3D path.

Numerical stages:

| Stage | Source | Frequency | Main dependency |
|---|---|---|---|
| Parameter/index preparation | `src/engine/adjustSolvePreparation.ts:buildSolvePreparation`, called by `runAdjustmentSolveWorkflow` | Once per solve | stations, active observations, 2D/3D, direction sets |
| Equation construction / linearization | `src/engine/adjustmentEquationAssembly.ts:assembleAdjustmentEquations` | Every correction iteration; also final covariance/statistics assemblies | observations and current station/orientation state |
| Normal accumulation | `src/engine/matrixSparse.ts:accumulateNormalEquationsFromSparseRows`, called by `solveAdjustmentIteration` | Every correction solve | equation rows, weights, parameter count |
| Factorization / correction | `src/engine/adjustNormalEquationHelpers.ts:solveNormalEquations`; `src/engine/adjustmentIteration.ts:solveAdjustmentIteration` | Every correction iteration | dense normal matrix, parameter count |
| Coordinate/orientation update | `src/engine/adjustmentIteration.ts:applyAdjustmentCorrections` | Every normal adjustment iteration | correction vector and parameter index |
| Convergence | `src/engine/adjustSolveWorkflow.ts:runLegacyCorrectionLoop` | After each update | max correction and objective delta |
| Final covariance | `src/engine/adjustSolveWorkflow.ts:recoverCovariance`, `src/engine/adjustFinalCovariance.ts` | Once after correction loop | final linearization and parameter count |
| Residuals/statistics | `src/engine/adjustStatisticsResiduals.ts`, `adjustStatisticsStandardizedResiduals.ts` | Final result; robust mode also repeats inner solves | observations, Qxx, weights |
| Row products | `src/engine/adjustStatisticsRowProducts.ts` | Final statistics when Qxx is available | rows, Qxx, covariance queries |
| Station/relative precision | `src/engine/adjustStatisticsPrecision.ts:propagateAdjustmentPrecision` | Final result | Qxx/selected covariance and requested pairs |
| Result construction | `src/engine/adjustEngineLifecycle.ts`, `adjustmentResultBuilder.ts` | Once | all solved state and diagnostics |

Current public timing profile is `src/engine/adjustSolveTiming.ts:buildSolveTimingProfile`. It exposes setup, equation assembly, matrix factorization (including normal accumulation and covariance recovery), precision/statistics, precision propagation, packaging, and other. It does not expose independent state-update or sub-stage covariance timings.

## Native backend status

1. **Can native solve the 3D normal system?** Yes, at packed numerical-kernel level. `cpp/src/sparse_normal_solver.cpp:solve_sparse_correction` accepts generic `equation_count` and `parameter_count`; Eigen sparse matrices have no 2D coordinate assumption. `src/engine/wasm/wasmSparseNormalSolver.ts` transfers generic packed rows/weights/misclosures.
2. **2D assumptions in numerical structure?** None found in packed design/weight/factorization/correction, selected covariance, or row-product C++ kernels. They operate on integer parameter indexes and generic rows.
3. **Observation families compatible today?** Any family that can be assembled into packed design rows and supported weight representation: ordinary directions/bearings, distances, zenith/vertical rows, leveling rows, GNSS vector rows, and diagonal/structured covariance rows at kernel level.
4. **Are XYZ parameters the blocker?** No for native matrix primitives. 3D is blocked by production eligibility and end-to-end contract coverage, not Eigen matrix dimension.
5. **Orientation parameters?** Native solver supports arbitrary columns; orientation support is an equation-assembly and parity concern, not a native matrix limitation.
6. **Height/Z parameters?** Generic columns. No special C++ height path.
7. **Slope, zenith, leveling, GNSS vectors/covariance, mixed networks?** Their TypeScript rows can be packed, but no production 3D worker admission exists. Full GNSS covariance and mixed correlated-weight contracts require end-to-end verification.
8. **Explicit 2D safety checks:** `evaluateSparseProductionEligibility` rejects `dimension !== '2d'`; `deriveSparseAutoRouteEligibility` requires `parse.coordMode === '2D'`; current automatic route and preflight policy are 2D-only.
9. **Explicit 2D verifier/parity checks:** production eligibility, route preflight, and existing worker-corpus contracts classify 3D as ineligible. Existing 3D sparse tests are experimental shadow tests, not production verification.
10. **Theoretical work required:** 3D eligibility policy; packed-row admission for all 3D families; full iteration-loop worker proof; covariance/row-product/relative-covariance verification including height blocks; C1/C2/C3 and numerical safety evidence; worker serialization/restart/fallback accounting; result reconstruction and contract parity. No such work was enabled here.

Classification: native numerical limitation = **none proven**; serialization/protocol = **no 3D-specific blocker proven**; verification = **incomplete for production 3D**; production routing = **explicit 2D blocker**; evidence gap = **full mixed 3D end-to-end native proof and timing**.

## Corpus and TypeScript baseline

Evidence command:

```bash
npm run test:evidence -- phase10a
```

Environment: local Node/Vitest process; one warm-up and three measured runs per case; median. Browser timings not inferred from Node timings.

Existing genuine 3D coverage:

- `public/examples/industry_demo.dat`: genuine terrestrial 3D, slope distance, vertical observation, leveling loop; its direction-style observations parse as `angle` observations with no orientation unknowns, and the profiled row is a failed/non-converged solve kept as a weak-case observation, not a scaling anchor.
- `src/engine/phase6BenchmarkNetworks.ts:generatePhase6Large3dInput`: deterministic mixed 3D chain with bearings, slope distances, vertical observations, GNSS vectors, and GPS covariance directive. Existing ladder includes 8, 16, 32, 64, 128 unknown stations; 256 was not forced because dense covariance/result work is not routine evidence-safe.
- `tests/phase7a_3d_sparse_cases.test.ts`: existing 3D TS truth and test-injected sparse shadow parity for `gps-3d-16` and `gps-3d-32`.

Measured report: `artifacts/evidence/phase10a/normal-3d-profile.md` and `.json`.

| Fixture | stations | params | scalar rows | iterations | wall median (ms) | assembly | factor/solve | precision/statistics | dominant |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| industry_demo 3D terrestrial/weak case | 5 | 9 | 17 | 10 | 5.03 | 1.00 | 1.00 | 1.00 | weak/failed solve; not scaling anchor |
| gps-3d-cov-08 | 10 | 24 | 75 | 4 | 4.68 | 1.00 | 1.00 | 1.00 | no stable dominant stage at this size |
| gps-3d-16 | 18 | 48 | 147 | 4 | 7.11 | 1.00 | 1.00 | 2.00 | precision/statistics |
| gps-3d-32 | 34 | 96 | 291 | 4 | 19.46 | 3.00 | 5.00 | 8.00 | precision/statistics |
| gps-3d-64 | 66 | 192 | 579 | 4 | 52.31 | 6.00 | 24.00 | 18.00 | factor/solve |
| gps-3d-128 | 130 | 384 | 1155 | 4 | 325.73 | 25.00 | 168.00 | 117.00 | factor/solve |

Timing limitation: existing production timing does not separate normal accumulation from dense factorization/correction, final covariance from matrix-factorization, or state update/result packaging. Report records zero only where no independent measurement exists; it does not claim those costs are absent. This is a measurement gap, not an optimization.

Observed scaling from 16→32→64→128 unknown stations: total roughly 7.11→19.46→52.31→325.73 ms; parameter dimension doubles with station count. Factor/solve becomes dominant at 128, while precision/statistics remains material. Four iterations are typical in generated cases; the weak industry case hit max iteration count and failed convergence, so geometry/iteration behavior needs separate follow-up.

## Native comparison and parity

Existing test-injected evidence (`tests/phase7a_3d_sparse_cases.test.ts`) ran 3D `gps-3d-16` and `gps-3d-32` through the experimental WASM sparse correction/row-product/selected-covariance path. Both passed existing shadow parity, truth checks, and zero sparse fallbacks. This proves packed native primitives can process representative 3D systems.

It is **not** an apples-to-apples full adjustment benchmark: it does not measure worker serialization, module startup, verification, restart/fallback, or production eligibility; it also uses an injected experimental engine option. No Phase 10A native speedup claim is made. A fair Level 1/Level 2 native campaign requires a dedicated evidence harness that captures correction, XYZ, orientations, residuals, SEUW, Qxx/selected covariance, relative covariance, C1/C2/C3, transfer, and fallback costs without changing routing.

## Duplicate-work findings

Measured evidence currently confirms repeated equation assembly per nonlinear iteration and final reassembly for covariance/statistics. `runLegacyCorrectionLoop` assembles every iteration; `recoverCovariance` assembles final systems; standardized residual/statistics can assemble additional rows. Call counts are visible from iteration count and existing timing, but sub-call timing is not independently instrumented. No optimization adopted.

## Production blocker matrix

| Concern | Current support | 2D-specific? | 3D blocker? | Required work | Risk |
|---|---|---:|---:|---|---|
| Normal solve | Native generic packed solver | No | Routing only | 3D parity/safety proof | high |
| XYZ parameters | TS and native generic columns | Route policy | Yes | height parity gates | high |
| Orientation | TS assembly; generic native columns | Verification policy | Yes | direction/orientation corpus | high |
| Terrestrial rows | TS assembly; packed experimental rows | No kernel blocker | End-to-end | family parity | high |
| Zenith/vertical/leveling | TS assembly | Production route not cleared | Yes | vertical residual/covariance proof | high |
| GNSS vectors | Experimental 3D shadow coverage | Covariance restrictions | Yes | worker contract | high |
| GNSS covariance | TS structured path; experimental evidence | Current production exclusion | Yes | C1/C2/C3 and full covariance proof | very high |
| Covariance recovery | Native selected queries; TS authoritative | Production verifier policy | Yes | Qxx/selected parity | very high |
| Relative covariance | TS authoritative; native selected support experimental | Contract verification | Yes | height + pair parity | high |
| Row products | Experimental native primitive | Production verifier policy | Yes | all statistic fields | high |
| C1/C2/C3 | Preanalysis safety evidence exists; no normal-3D route | Current policies | Yes | adjustment-specific safety evidence | very high |
| Worker protocol | Generic request/response | No proven protocol blocker | Evidence only | transfer/restart accounting | medium |
| Fallback/restart | Existing 2D fail-closed design | Route policy | Yes | 3D atomic restart proof | high |
| Result reconstruction | TS authoritative | No proven type blocker | Verification | complete field diff | high |
| Iteration loop | TS authoritative; native correction primitive exists | Route policy | Yes | every-iteration capture proof | very high |

## Recommendation

Primary Phase 10B direction: **A/B boundary evidence first — split dense normal assembly/factorization and final covariance/statistics timings, then run a fair injected native full-iteration comparison on small/medium 3D cases.** Current data points toward factorization/correction at 128 parameters, with precision/statistics still large; routing straight to native is premature.

Ranked alternatives:

1. Improve evidence instrumentation and quantify duplicate final reassembly.
2. If native full-iteration evidence remains parity-safe and transfer/verification costs are bounded, investigate a narrowly gated 3D sparse candidate.
3. If covariance/statistics dominates realistic cases, investigate selected covariance architecture instead of solve routing.

Decision: **MORE EVIDENCE REQUIRED** for production optimization. Phase 10A made no production routing, mathematical, tolerance, protocol, or sync-session changes.

## Validation

- `npm run test:evidence -- phase10a`: PASS (1 test)
- `npm exec vitest -- run tests/phase7a_3d_sparse_cases.test.ts`: PASS (8 tests)

Required production gates passed: lint, typecheck, test:agent (2677 passed / 1 skipped), wasm:build, CTest 7/7, test:wasm (41/41), test:release (4/4), industry parity 25/25, and build. Phase evidence command passed separately.

Independent reviewer verdict: **APPROVE**. Status: **READY TO MERGE** — do not merge automatically; PR review/CI remains required.
