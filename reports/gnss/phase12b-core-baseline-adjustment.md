# Phase 12B Report — Core Static GNSS Baseline Adjustment

- Branch: `feat/static-gnss-baseline-core`
- Baseline: `origin/main 9441897b` (Phase 12A / PR #34 merge)
- Production user-facing parser changed: NO
- New internal observation type: YES (`gnssBaseline`, standalone — not in
  the parsed `Observation` union, so no existing exhaustive handling changes)
- Adjustment core changed: YES (additive: one assembly branch, widened
  row-component literals, three native-route tripwires)
- New ECEF GNSS-only internal adjustment mode: YES
  (`runGnssBaselineAdjustment`, test/programmatic construction only)
- Existing project adjustment semantics changed: NO
- Native routing changed: NO (fail-closed tripwires added, ordinary-job
  behavior untouched)
- Numerical tolerances changed: NO. UI changed: NO. WASM changed: NO.

## 12A contradiction check

None. Implementation confirms the contract: `[−I +I]` rows, `P = C⁻¹`
blocks, translation-only defect (3), covariance-not-correlation storage,
observed-minus-computed sign. One refinement (not a contradiction):
preflight resolves an unset session frame from the unanimous baseline
declaration instead of forcing every synthetic test to restate it;
conflicting declarations still fail closed.

## New files (all GNSS-only, TS-dense, no parser)

- `src/engine/gnssBaselineTypes.ts` — canonical observation, frame
  metadata, residual shape, `isGnssBaselineObservation` guard.
- `src/engine/gnssBaselineCovariance.ts` — Cholesky-strict PD validation,
  adjugate inversion with `C·P≈I` (1e-9) verification, block quadratic form.
- `src/engine/gnssBaselineEquationRows.ts` — 3 rows/baseline, constant
  Jacobian, full 3×3 structured weight block.
- `src/engine/gnssBaselinePreflight.ts` — graph components, datum rule
  (≥1 fully fixed 3D station/component), self/missing/duplicate checks,
  exact frame-identity matching, covariance validation.
- `src/engine/gnssBaselineAdjust.ts` — orchestrator: copy-in stations,
  preflight, `buildSolveParameterIndex` reuse (project auto-holds
  deliberately bypassed), dense assembly reuse, `solveAdjustmentIteration`
  reuse with `robustMode:'none'` + `sparseCorrectionSolver:undefined`,
  generic iteration, final residual/Qxx/variance-factor recovery.
  Result tags `adjustmentFrame:'ecef'` + `routeProvenance:'typescript-dense'`;
  stored `x/y/h` mean X/Y/Z (documented at the type and module).

## Production edits (additive only)

- `src/typesObservations.ts` — `'gnssBaseline'` literal in
  `ObservationBase.type` (enables future dispatch; no member added).
- `src/engine/adjustmentEquationAssembly.ts` — one `gnssBaseline` branch.
- `src/engine/adjustmentSolveTypes.ts` + `adjustStatisticsStandardizedResiduals.ts`
  — row-component literals widened with `'X'|'Y'|'Z'` (GPS statistics paths
  keep their E/N/U logic; baselines never enter them in 12B).
- Three workers (`adjustmentSparseAutoRoute`,
  `adjustmentNativeFullQxxAutoRoute`, `preanalysisSparseAutoRoute`) —
  `isGnssBaselineObservation` tripwire rejections (TS-dense only pending
  real-WASM certification).

## C++/WASM compatibility audit (§58)

No C++ changes. New 3×3 blocks map to existing packed upper-triangle ABI
entries (proven by the sparse-representation equation test); route policy
deliberately excludes them. Future certification needs: real-WASM parity
campaign (coords/residuals/Qxx), near-singular damping behavior,
statistics-reuse equivalence, cohort verdict update.

## Downstream safety audit (§43)

`x/y/h`-assuming consumers (map/plotting, CRS display, report labels, grid
math, geoid conversion, exports) are project-frame by design. ECEF sessions
cannot reach them: no parser produces baselines, no UI constructs them, and
results carry the explicit `adjustmentFrame:'ecef'` tag. 12C/12F must map
X/Y/Z through an output transform before any project-frame consumer.

## Performance diagnostic (§57, record-only)

Chain networks, closing geometry: 10 stations/27 params 6 ms,
50/147 14 ms, 100/297 54 ms (1 iteration each). No construction pathology.

## Validation

- lint 0 errors; `tsc --noEmit` clean; build clean.
- New tests 40/40 (covariance 6, equation 4, adjustment 7, numerics 4,
  preflight+routing 16, performance 3).
- Phase 12A math 6/6; tier manifest 11/11.
- `test:agent`: 2969 passed / 1 skipped; 3 failures in
  `study-desktop/tests/study_ai_unit_*` proven pre-existing via stash
  (calibration corpus package mismatch, fails on clean tree).
- Industry parity 25/25; native-route focused suites 50/50
  (7c sparse auto-route, 11a production cap, 8a7 preanalysis production,
  7d hardening).
