# Phase 8A preanalysis contract audit (TEST/EVIDENCE ONLY)

Status: audit of established production facts. No production code was changed for
Phase 8A. All line references are against branch `feat/sparse-preanalysis` at the
time of writing; exact line numbers may drift with unrelated edits.

## 1. Planning iteration: exactly one, correction computed then discarded

File: `src/engine/adjustSolveWorkflow.ts` (export `runAdjustmentSolveWorkflow`).

- The iteration loop is `for (let iter = 0; iter < ctx.maxIterations; iter++)`
  with `ctx.iterations += 1` at the top of each pass.
- Lines 379-390 (`if (ctx.preanalysisMode) { ... break; }`): on the first pass
  the workflow sets `ctx.converged = true`, logs
  `Iter 1: Max Corr = 0.0000`,
  `Iter 1: preanalysis geometry held at approximate coordinates; covariance
  assembled from the current planning geometry.`, and
  `Converged: preanalysis uses the approximate-geometry covariance build
  without iterative coordinate updates.`, emits solve progress, then `break`s.
- The `break` precedes the `applyAdjustmentCorrections(...)` call (line ~393+),
  so the solved correction vector is computed (and, under a sparse runtime,
  flows through the sparse correction solver exactly once per solve) but is
  never applied to stations or direction orientations.
- Observable contract: every preanalysis solve reports `iterations === 1` and
  `converged === true`, regardless of `maxIterations`.

## 2. Coordinates and orientations unchanged

- Because the correction is never applied (Section 1), station coordinates and
  direction orientations remain at their approximate (planning) values.
- Belt-and-braces: `recoverFinalNormalCovariance` in
  `src/engine/adjustCovarianceRecovery.ts` snapshots every station
  (lines 358-360, `stationSnapshot`) before the covariance rebuild and
  restores it in the `finally` block (lines 392-394), then clears the geometry
  cache. Even the covariance recovery pass cannot move coordinates.

## 3. Covariance and precision recovered at planning geometry

- After the loop, `src/engine/adjustSolveWorkflow.ts` lines 429-440 call
  `ctx.recoverFinalNormalCovariance(...)` and store either dense `Qxx` or the
  experimental selected-covariance store
  (`ctx.experimentalSelectedCovarianceStore`).
- `src/engine/adjustStatistics.ts` (`calculateAdjustmentStatistics`): when
  `hasQxx` (or a selected store) is present,
  `propagateAdjustmentPrecision(...)` runs (line ~108-110) and fills
  `stationCovariances`, `relativeCovariances`, `relativePrecision`
  (see `src/engine/adjustStatisticsPrecision.ts` lines 107-134 for station
  blocks with error ellipses, lines 187-233 for relative precision / relative
  covariance rows), plus per-station `errorEllipse`/`sE`/`sN`/`sH`.
- Preanalysis-only extras in `src/engine/adjustStatisticsPrecision.ts`
  lines 314-335: `weakGeometryDiagnostics` are built from the planning-geometry
  covariance blocks, with log lines
  `Preanalysis covariance blocks: stations=..., connectedPairs=...` and
  `Preanalysis weak geometry cues: ...`.

## 4. SEUW pinned to 1; residual-QC diagnostics disabled (raw residuals kept)

File: `src/engine/adjustStatistics.ts` (`calculateAdjustmentStatistics`).

- Line 36: `ctx.seuw = ctx.preanalysisMode ? 1 : ...` — the a-priori variance
  factor is forced to exactly 1.
- Lines 38-47: `chiSquare`, `statisticalSummary`,
  `directionSetDiagnostics`, `directionTargetDiagnostics`,
  `directionRepeatabilityDiagnostics`, `setupDiagnostics`, `residualDiagnostics`,
  `traverseDiagnostics`, and `autoSideshotDiagnostics` are reset to `undefined`;
  `typeSummary` is rebuilt below from active observations and remains available.
- Line 50 (`if (!ctx.preanalysisMode && ctx.dof > 0)`): chi-square summary is
  skipped in preanalysis.
- Line 56 (`if (!ctx.preanalysisMode)`): statistical summary skipped.
- Lines 60-77 (`if (!ctx.preanalysisMode)`): large-standardized-residual flag
  warning and local-test failure warning skipped.
- Lines 79-88 (`if (!ctx.preanalysisMode)`): residual diagnostics
  (`|t|>2`, `|t|>3`, `localFail`, `lowRedund`) skipped.
- Lines 90-93: preanalysis logs
  `Preanalysis statistics: using a-priori variance factor 1.0 and skipping
  residual-based diagnostics.`

Precision of the claim — raw vs standardized residuals:

- `accumulateAdjustmentResiduals` (`src/engine/adjustStatisticsResiduals.ts`,
  e.g. lines 93-125 for distances, and the per-type branches that follow)
  ALWAYS assigns the raw `obs.calc`, `obs.residual`, and the simple
  `obs.stdRes = |v|/sigma` — including in preanalysis mode. At planning
  geometry with geometry-populated planned observations these are ~0, so
  preanalysis results carry `stdRes = 0` on planned observations. This is a
  raw misclosure ratio, not a QC statistic.
- What is actually disabled is the STANDARDIZED-residual QC layer (see next
  section): `redundancy`, `localTest`/`localTestComponents`, `mdb`/`mdbComponents`,
  and `stdResComponents` are never assigned in preanalysis mode.

File: `src/engine/adjustStatisticsStandardizedResiduals.ts`
(`computeStandardizedResidualStatistics`).

- Line 96: Huber reweight capture is a no-op under `ctx.preanalysisMode`.
- Line 130 (`if (!ctx.preanalysisMode)`): the entire row-products / dense
  standardized-residual path is skipped, so per-observation `redundancy`,
  `localTest`/`localTestComponents`, `mdb`/`mdbComponents`, and
  `stdResComponents` are never assigned in preanalysis mode.
  Consequence for the sparse evidence: a preanalysis session performs zero
  sparse row-product queries by construction (expected `rowProductsCalls = 0`,
  `rowProductsFallbacks = 0`).

## 5. Session may perform template + impact scenario solves

File: `src/engine/runSessionSolver.ts` (`createSessionSolveRunner`).

- Lines 101-102: template resolution only runs when
  `effectiveParse.runMode === 'preanalysis'`; otherwise it returns `[]`.
- Lines 157-214 (`solveCore`): for preanalysis runs the template source solve
  runs first, then the main solve runs against
  `buildSyntheticPreanalysisInput(...)` with normalized synthetic addition ids.
- Lines 237-271 (`solveWithImpacts`): a preanalysis main solve additionally
  builds `preanalysisImpactDiagnostics` via `buildPreanalysisPlanningDiagnostics`
  (file `src/engine/preanalysisPlanningCore.ts`), whose per-candidate
  `solveScenario` callback (lines 257-266, stage id `preanalysis-impact`)
  re-solves once per evaluated template plus the threshold plan. Each of those
  solves is itself a one-iteration preanalysis solve (Sections 1-4 apply to
  every scenario).
- Lines 271, 276-277: preanalysis results set `suspectImpactDiagnostics` to
  `undefined` and `robustComparison` to
  `{ enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 }`.
- Evidence consequence: one worker `run` message for a preanalysis session
  performs N solves (`profile.solveInvocationCount`: 1 template + 1 main +
  impact scenarios) plus exactly one uncounted template-source `solveEngine`
  call (`resolvePreanalysisTemplates`, `runSessionSolver.ts` lines ~99-139:
  runs once per session, result cached, receives the same runtime). The sparse
  correction solver must therefore be called exactly once per solve (N+1
  calls, N+1 captured systems), and the selected covariance backend once per
  solve (N+1 calls), with zero fallbacks.

## 6. Production `adjustmentSparseAutoRoute` keeps rejecting preanalysis

File: `src/workers/adjustmentSparseAutoRoute.ts`
(`deriveSparseAutoRouteEligibility`).

- Lines 153-155: any `parse.runMode !== 'adjustment'` is ineligible, with
  reason `unsupported runMode '...'`.
- Lines 156-158: `parse.preanalysisMode` is independently ineligible, with
  reason `preanalysis mode not cleared for sparse auto-route`.
- Phase 8A runs preanalysis through the actual production worker
  (`src/workers/adjustmentWorker.ts`) with an explicitly injected worker-local
  runtime (`setAdjustmentWorkerRuntimeProvider` in
  `src/workers/adjustmentWorkerRuntime.ts`), never through
  `runWithSparseAutoRoute`. The auto-route module is referenced by the
  evidence test only to assert it still returns `eligible: false` for
  preanalysis requests.

## 7. Run-mode compatibility guardrails (unchanged production behavior)

File: `src/engine/adjustmentRunModeCompatibility.ts`
(`resolveRunModeCompatibilityOptions`, lines 35-77): requesting
`runMode: 'preanalysis'` forces `preanalysisMode: true` and disables
auto-adjust (`PREANALYSIS_DISALLOWS_AUTOADJUST`), robust reweighting
(`PREANALYSIS_DISALLOWS_ROBUST`), auto-sideshot detection
(`PREANALYSIS_SKIPS_AUTOSIDESHOT`), cluster detection
(`PREANALYSIS_SKIPS_CLUSTER`), and ignores approved cluster merges
(`PREANALYSIS_DISALLOWS_CLUSTER_MERGES`). The evidence corpus therefore
treats robust / TS-correlation / GPS-covariance-3D / 3D cases as
experimental or ineligible rather than production-supported.

## 8. What the evidence corpus compares (full contract)

For each admitted case, worker result (real WASM, legacy-all-pairs selected
covariance) vs direct TypeScript reference:

- `success`, `converged === true`, `iterations === 1`, `dof` equal,
  `seuw === 1`.
- `condition.estimate` agreement within 1e-9 absolute (threshold/flag are
  recorded but not gated).
- Coordinates exactly unchanged: worker stations `===` parsed approximate
  coordinates (exact float equality) and `===` the TS reference; station
  `errorEllipse` mirror presence matches the reference (ellipse values
  themselves are not compared).
- `stationCovariances`: row order identical; `sigmaE`/`sigmaN`/`sigmaH`
  within 1e-6 relative (shadow-proof grade: the worker uses WASM selected
  inversion, the reference the dense TypeScript inverse — solver-precision
  agreement, while coordinates stay bit-exact); ellipse presence matches
  (ellipse values themselves are not compared).
- `relativeCovariances`: row order identical; `connected` flags and
  `connectionTypes` exactly equal; all numeric covariance/sigma fields
  (`cEE`, `cEN`, `cEH`, `cNN`, `cNH`, `cHH`, `sigmaE`, `sigmaN`, `sigmaH`,
  `sigmaDist`, `sigmaAz`) within 1e-6 relative; ellipse presence matches.
- `relativePrecision`: row order identical; `sigmaN`/`sigmaE`/`sigmaDist`/
  `sigmaAz` within 1e-6 relative; ellipse presence matches.
- Planning fields: `preanalysisMode === true` and `preanalysisImpactDiagnostics`
  presence are gated; `preanalysisSyntheticAdditionIds` and
  `preanalysisImpactDiagnostics` row contents, plus `weakGeometryDiagnostics`,
  are recorded in the report but not value-compared.
- Intentionally absent: `chiSquare`, `statisticalSummary`,
  `residualDiagnostics` undefined; no per-observation standardized QC
  (`redundancy`, `localTest`, `mdb`, `stdResComponents`); raw
  `residual`/`stdRes` (=|v|/sigma at planning geometry, 0 for planned
  observations) present and exactly equal to the reference.
- Sparse proof: bundle initialized from the real WASM asset, correction calls
  equal to session solve count plus the single uncounted template-source
  solve (one per preanalysis solve overall), selected-covariance calls equal
  to the same total, row-product calls zero (expected — Section 4),
  all fallback counters zero.
