# Static GNSS Baseline Network Adjustment — Architecture (Phase 12A)

Status: architecture + mathematical contract ONLY. No production solver,
parser, CRS engine, geoid, UI, or native-routing changes.

Maths companion: `docs/gnss/STATIC_GNSS_BASELINE_MATH.md`.
Phase report: `reports/architecture/phase12a-static-gnss-baselines.md`.

Mission baseline: `origin/main 4afd157b` (Phase 11A / PR #33 merge).
Branch: `feat/static-gnss-baseline-architecture`.

---

## 1. Current-system audit (from code)

### 1.1 3D station semantics

- Station stores numeric `x, y, h` (`src/typesObservations.ts:16-42`).
  Optional `heightType: 'orthometric' | 'ellipsoid'` plus `latDeg/lonDeg`
  metadata.
- `.2D` disables height solving; `.3D` enables it
  (`src/engine/parseDirectiveState.ts:330-345`).
- Local mode treats `x/y` as Cartesian/project coordinates: azimuth
  `atan2(dx,dy)`, horizontal distance `hypot(dx,dy)`
  (`src/engine/adjustEngineCoordinateMethods.ts:39-51`). Positive `x` is
  east-like, positive `y` north-like.
- Terrestrial 3D distance is Euclidean in `x/y/h` with instrument/target
  height corrections (`src/engine/adjustmentDistanceEquationRows.ts:42-57`).
- Zenith: `dh = to.h + ht − (from.h + hi)`, `acos(dh/dist)`, radians in,
  metres for heights/distances, curvature/refraction optional
  (`src/engine/adjustReductionZenith.ts:18-43`).
- **Frame assumption:** one global project frame — local Cartesian or
  projected grid `x/y` + one vertical `h`. Ordinary distance/direction/
  zenith equations perform no per-observation ellipsoid transform.
- CRS/ellipsoid machinery DOES participate in grid reductions and selected
  GNSS paths (scale/convergence, lat/lon inverse, ECEF/ENU conversion:
  `adjustEngineCoordinateMethods.ts:98-151,220-260`,
  `adjustStationCoordinateHelpers.ts:31-65`,
  `adjustGpsModeledVector.ts:39-100`, `adjustGpsObservedVector.ts:43-83`).
  So: terrestrial core is project-frame; GNSS/grid edges already convert.

### 1.2 What `G` means today (do NOT collide)

- Plain `G`: legacy 2D vector `G <inst?> <from> <to> <dE> <dN>
  [sigmaE sigmaN [corr]]`, east/north only, metres at parse
  (`src/engine/parseFieldGpsVectorRecords.ts:190-334`).
- `G0/G1/G2/G3`: one 3D covariance block. `G0` opens, `G1 from-to dX dY dZ`
  vector, `G2 cXX cYY cZZ` diagonal, `G3 cXY cXZ cYZ` completes and emits
  one observation flagged `ecefDelta` with `gpsCovariance3d`
  (`src/engine/parseFieldGpsVectorRecords.ts:43-188`).
- `G4`: rover offset attached to preceding `G`, not a new observation
  (`:335-378`).
- Equation rows model `dE = to.x−from.x`, `dN = to.y−from.y`,
  `dU = to.h−from.h`, from −1 / to +1
  (`src/engine/adjustmentGpsEquationRows.ts:17-74`).
- Consequence: a new baseline text code must avoid `G/G0-G4` dispatch AND
  the generic import-review code tables. Recommended internal type name:
  `gnssBaseline` regardless of final text code (§12).

### 1.3 Height semantics

- `h` = project station elevation in declared `heightType`; absent metadata
  defaults operationally to orthometric
  (`src/engine/adjustGeoidHeightHelpers.ts:35-40`).
- Geoid conversion is computational (mutates `h`/constraints during solve
  prep: `adjustGeoidHeightHelpers.ts:14-140`,
  `adjustSolveWorkflowGeoid.ts:68-85`), with `h + N` promotion where
  ellipsoidal height is required (`:152-208`).
- `PH` control heights parse as ellipsoidal, others orthometric
  (`src/engine/parseGeodeticControlRecords.ts:66-81`).
- **MVP rule (§9):**_adjust baseline unknowns as Cartesian XYZ; treat any
  `h` output conversion (ellipsoidal→orthometric) as a post-adjustment
  display/export step. No hidden geoid inside the adjustment.

### 1.4 Structured weights and the native gate

- `sparseWeightRepresentation.ts:7-18` stores diagonal + arbitrary symmetric
  upper-triangle entries — no explicit block type. Diagonal, 2×2, and 3×3
  blocks all fit as scalar entries.
- Parsed `gpsCovariance3d` is retained as covariance, inverted to weight
  during solve preparation with 3×3-first/2×2-fallback
  (`src/engine/adjustGpsWeighting.ts:43-137`,
  `adjustmentGpsEquationRows.ts:37-59`,
  `adjustmentEquationAssembly.ts:345-359`).
- Native exclusion is **certification policy, not C++ inability**:
  `sparseProductionEligibility.ts:58-60` rejects GPS-covariance weighting
  (plus robust/TSCorr/non-2D/size/rank gates); same in preanalysis
  (`preanalysisSparseAutoRoute.ts:199-204`) and the native full-Qxx route
  (`adjustmentNativeFullQxxAutoRoute.ts:167-168`). Packed ABI
  (`sparseEquationPacking.ts:44-47,105-145` → `wasmSparseNormalSolver.ts`
  → `cpp/src/sparse_normal_solver.cpp:55-151`) is block-agnostic generic
  upper-triangle math — no C++ algorithm change needed for 3×3 blocks.
- **Future certification required before admitting baseline blocks to any
  native route:** real-WASM parity campaign (coordinate/residual/Qxx
  agreement), damping/fallback behaviour on near-singular blocks,
  statistics-reuse equivalence, and updated cohort verdict. Gate stays in
  12A; 12B targets the TS dense path only.

### 1.5 Statistics / datum / connectivity seams

- Residual `v = L − A·dx`, `L = observed − computed`
  (`adjustmentIteration.ts:179-186`, `adjustmentEquationAssembly.ts:190-221`).
  Huber internals use opposite sign for magnitudes only
  (`adjustmentHuberLoop.ts:91-94`) — scalar per-equation reweighting
  (`:70-109`), unsafe to apply entry-wise to a correlated 3-block (§14).
- DOF = equation count − params (`adjustSolveWorkflow.ts:226-228`); GPS
  contributes 2–3 equations. Standardized residual/redundancy/MDB in
  `adjustStatisticsStandardizedResiduals.ts:317-360,374-429`.
- Constraints: X/Y/H independently fixable
  (`adjustmentConstraints.ts:38-85`, `adjustmentPreprocessing.ts:192-204`);
  weighted controls are per-component sigma + XY 2×2 block only
  (`:128-142`) — no general prior covariance. Datum checks are heuristic
  (`adjustDatumChecks.ts:108-172`); connectivity/isolated-station rejection
  in `sparseGeometryPreflight.ts:115-224`.

## 2. Canonical baseline observation (recommendation)

```ts
interface GnssBaselineObservation {
  readonly type: 'gnssBaseline';
  readonly from: string;                 // station ID (string)
  readonly to: string;
  readonly vector: { x: number; y: number; z: number };   // metres
  readonly covariance: {                 // m², upper triangle, six values
    xx: number; xy: number; xz: number;
    yy: number; yz: number; zz: number;
  };
  readonly frame: 'ecef' | 'projectLocal';  // frame of vector+covariance
  readonly units: 'm';                   // canonical after ingest
  readonly solutionId?: string;          // processor solution identifier
  readonly sessionId?: string;           // grouping/reporting only
  readonly epoch?: string;               // frame epoch tag (metadata)
  readonly referenceFrame?: string;      // e.g. 'ITRF2020@2020.0' (metadata)
  readonly quality?: {                   // reporting only, never math
    readonly solutionType?: 'fixed' | 'float';
    readonly durationMin?: number;
    readonly satelliteCount?: number;
  };
}
```

Core (adjustment): from/to/vector/covariance/frame. Reporting-only:
solution/session/epoch/quality/processor metadata. Keep metadata minimal —
anything not affecting math, validation, or traceability stays out.

## 3. Frame strategy evaluation

### Option A — project/local Cartesian conversion before adjustment

Easiest engine fit (`[−I +I]`, terrestrial coexistence) but mathematically
unsafe in general: ECEF→projected-grid is nonlinear and
location-dependent, covariance rotation is nontrivial, and grid
scale/elevation factors corrupt naive conversion. Valid only for small
networks with an explicitly validated linearisation — not a general MVP.

### Option B — ECEF XYZ adjustment state ✅ (recommended MVP core)

Native for processed baselines, exactly linear, covariance already XYZ.
Cost: terrestrial equations expect project coordinates, and users want
grid output. Acceptable for a GNSS-ONLY first release with an output
transformation layer afterwards.

### Option C — geodetic unknowns + ECEF observation model

Most general, but nonlinear Jacobians `∂ECEF/∂station`, dependable
ellipsoid/CRS transforms, orthometric/ellipsoidal split, possible geoid in
the derivative chain. Correct long-term mixed-network target; far too large
for MVP.

### Option D — shared local Cartesian (single-origin ENU) ✅ (recommended
importer-side variant)

One constant `R` at the declared network origin applied to EVERY baseline
plus `C_local = R·C·Rᵀ`; stations live in the same frame; model stays
`[−I +I]`. Valid while network extent keeps curvature negligible; origin
recorded with the solution. Must not be confused with per-baseline FROM
rotations (different frames — invalid).

### Recommendation

**MVP = B with D as the user-facing importer variant on the same linear
engine path; mixed terrestrial + GNSS deferred.**

- Engine solves one shared Cartesian frame (ECEF for B, single-origin
  local for D) with identical `[−I +I]` rows and 3×3 blocks.
- Importer performs the single rotation (+ covariance) once at the
  boundary; engine never rotates per observation.
- What it does NOT support initially: mixed GNSS + terrestrial solves,
  projection-embedded baselines (A-general), geodetic-unknown solves (C),
  free-network/inner-constraint datum, cross-baseline covariance,
  robust-per-component reweighting, geoid/datum transformations.

## 4. Covariance contract

- Canonical storage: 3×3 covariance in m² (six upper-triangle values), NOT
  correlation.
- Accept at ingest: (A) full covariance, (B) std-devs + correlations
  (convert `Cij = ρij·σi·σj`), (C) upper-triangle variance/covariance,
  (D) variance-factor-scaled covariance only if the factor is explicit —
  fold once, record it.
- Deterministic validation (hard errors, fail-closed): finite, symmetric
  canonical form, variances > 0, `|ρ| ≤ 1` for correlation inputs, unit +
  component order declared, Cholesky/PD check. Near-singular → error or
  explicit user override path, never silent jitter.
- Vector/covariance units must agree after one ingest normalization
  (mm/cm/m → m, m²); correlations unitless.

## 5. Weight integration (fits current engine)

- `P_i = C_i⁻¹` per 3×3 block; global `P` block-diagonal for independent
  baselines. Existing representation already carries arbitrary
  upper-triangle entries; inversion belongs at solve preparation (as today),
  storing covariance canonically.
- Current full-Qxx TS route can consume this shape; native routes are
  policy-gated (§1.4) pending a dedicated certification campaign.

## 6. Cross-baseline correlation: MVP = independent 3×3 blocks

Most processors export per-baseline covariances; full network covariance
between solutions is rare in target workflows and would require general
off-block weight support plus new statistics. MVP supports independent
blocks only; inputs implying cross-baseline covariance are rejected
fail-closed with an explicit limitation message. Full-network covariance is
a documented future seam.

## 7. Datum and control (initial scope)

- Current engine fixes X/Y/H independently and offers weighted (stochastic)
  per-component control + XY correlation — sufficient for MVP control.
- Baseline network defect is translation-only (3) in a known-oriented frame
  (math doc §11): **minimum MVP datum = one fixed 3D station.**
  Preflight must fail-closed on any connected component lacking fixed 3D
  control (rank-risk), plus graph checks: components, isolated stations,
  self-baselines A→A, missing stations, disconnected subnetworks.
- Deferred: free-network/inner constraints, S-transform/Helmert datum
  realization, general prior-covariance control. No fake fixed coordinates.

## 8. Height treatment

Adjust Cartesian XYZ; `h` inside a GNSS-only solve is the Cartesian third
component, NOT orthometric height. Orthometric output (`H = h − N`) is a
post-adjustment export/display transform with an explicit geoid model, never
an in-solve correction. Any station `h` entering as control must declare
ellipsoidal vs orthometric; undeclared is rejected or explicitly assumed per
documented policy — never silently mixed.

## 9. Reference frame / epoch metadata

Required tags on every baseline and control coordinate: frame name,
realization, epoch (processing epoch + coordinate epoch), ellipsoid.
No transformations in MVP. Fail-closed: differing frame/epoch tags between
baselines and control (e.g. ITRF2020@X vs NAD83(CSRS)@Y) refuse to solve
together; single-frame/epoch reduction is the user's pre-processing duty.
Velocity/frame propagation is a future seam, not MVP scope (option A in the
mission: require pre-reduced inputs).

## 10. Sessions, duplicates, residuals, statistics

- Multiple A→B solutions stay INDEPENDENT 3-vector observations (never
  averaged); `solutionId`/`sessionId` group them for reporting.
- Residual `v` keeps WebNet sign (observed−computed); report component
  residuals + `‖v‖` (descriptive) + `vᵀPv` (descriptive). Normative outlier
  test is the 3-DOF block statistic `T_i = v_iᵀ·C_vi⁻¹·v_i` (Phase 12D to
  derive `Qvv`-block recovery); scalar formulas must not be forced onto the
  correlated block. Component standardized residuals + block redundancy
  (`trace R_i ∈ [0,3]`) are the initial reporting set.
- Blunder handling: whole-baseline block removal (component removal would
  shred the covariance model). Robust MVP: excluded (scalar Huber unsafe on
  correlated components; block-level robust is future work).
- Loop closure `s = Σ±b_i`, `C_s = ΣC_i`, `sᵀC_s⁻¹s ~ χ²(3)` lives in
  pre/post QC, not in the equations.

## 11. Importer survey and generic format

Priority sources: (1) TBC processed-baseline text/XML exports
(from/to, ΔX/ΔY/ΔZ or ΔN/ΔE/Δh, variance/covariance or σ+ρ, solution
status, frame tags); (2) Trimble JobXML/JXL where baseline elements exist;
(3) generic CSV vector export; (4) SINEX (full network covariance — beyond
MVP blocks, note as future). RINEX is raw observations, NOT a baseline
import — excluded unless a processing stage exists. No baseline samples
exist in-repo (`tests/fixtures/` has GNSS `.dat` + JobXML station samples
only) — real TBC export + TBC adjusted report + control/frame metadata are
the files to obtain for 12E parity.

Future generic format (proposal, not implemented — `G`/`G0-G4` taken):

```text
# one declaration per file (fail-closed on mismatch)
FRAME ECEF ITRF2020 EPOCH 2020.0 UNITS M
BL A B +12.345 +... +...  COV xx xy xz yy yz zz  SESSION s1 SOL fixed
```

`BL` block keyword keeps STAR*NET-like ergonomics without colliding with
existing single-letter codes; covariance always on the same record;
frame/units declared once. Final syntax is 12C scope.

## 12. 12B integration map (no implementation in 12A)

`parseFieldGpsVectorRecords.ts` (new `BL` family) → `typesObservations.ts`
(`GnssBaselineObservation`) → active-observation collection →
`adjustmentGpsEquationRows.ts`-style row appender (`[−I +I]`, 3 rows,
3×3 `P` block via `sparseWeightRepresentation`) →
`adjustmentEquationAssembly.ts` (L/Jacobian/weights) →
`solveEngine.ts`/`adjustmentIteration.ts` (linear solve; iteration only for
mixed future) → `adjustStatistics*.ts` (component + block diagnostics) →
`runResultsTextObservationSections.ts` (new `gnssBaseline` branch) +
`runResultsTextResidualSections.ts` + `adjustDataCheckWorkflow.ts`
(preflight: §7 graph/datum/covariance checks).

Row accounting: 3 equations per baseline, 1 logical observation; DOF,
redundancy, blunder, and UI counts must distinguish both.

## 13. Performance sketch

S stations (3 coords each, no orientations in GNSS-only mode) + B
baselines: unknowns `3S`, equations `3B`, design nnz `18B`, weight nnz
`≤6B`. Highly sparse. The 768-param native cap (≈256 coordinate-only
stations) covers realistic MVP networks (e.g. 100 stations / ~250
baselines → 300 unknowns); cap unchanged in 12A, TS dense path is the 12B
target.

## 14. Fixtures 1–8 (designed; built in 12B/12C)

1. Two stations, A fixed, one baseline — analytically exact shift.
2. Triangle, one fixed, 3 baselines — redundant closure, small residuals.
3. Loop with intentional error — closure/ residual recovery.
4. Non-zero off-diagonal covariance — weighting correctness vs naive.
5. Reversed vector — identical solution (math doc §5).
6. Bad covariance (non-PD / non-finite / non-positive variance) — hard
   rejection.
7. Free network (no fixed) — rank-deficient preflight refusal.
8. Multiple A→B solutions — independent observations, improved precision,
   no averaging.
   Goldens via an independent NumPy reference generator outside production
   (adjusted coords, residual vectors, covariance, variance factor,
   redundancy where derivable). External parity targets: TBC, Leica
   Infinity, STAR*NET-equivalent vector input, published teaching networks.

## 15. Staged roadmap

- 12B: core `gnssBaseline` observation + 3×3 covariance weighting on the TS
  dense path (GNSS-only, fixed control, independent blocks) + fixtures 1–8.
- 12C: `BL` parser/import (TBC text + generic CSV first) + validation +
  synthetic fixtures.
- 12D: block diagnostics/statistics (`Qvv` blocks, `T_i`, redundancy,
  closure QC, whole-block blunder handling).
- 12E: real-world/commercial parity (TBC report comparison).
- 12F: production hardening/UI (results table: FROM/TO, observed/computed/
  residual vectors, σ/ρ, block statistic, status) + multi-file/session
  project model + native-route certification.

## 16. Decision gates (answers)

| Gate | Answer |
| ---- | ------ |
| 1. MVP adjustment frame | **ECEF Cartesian (B)**, single-origin local variant (D) on same path |
| 2. Internal vector frame | Same Cartesian frame as unknowns; ECEF canonical |
| 3. Covariance representation | 3×3 covariance, m², six-value upper triangle |
| 4. Datum/control | **One fixed 3D station minimum**; free-network deferred |
| 5. GNSS-only vs mixed first | **GNSS-only first** |
| 6. Independent 3×3 sufficient | **Yes**; cross-baseline deferred, fail-closed |
| 7. Structured weights compatible | **Yes (TS path)**; native routes need recertification |
| 8. CRS/geodetic prerequisite for 12B | **No** — importer rotation math only, no CRS engine/geoid/datum transforms |

**Phase 12B: GO** — no unresolved fundamental mathematical issue; scope
bounded per §15/§12 (TS dense path, GNSS-only, fixed control, independent
blocks, no native routing changes, no CRS/geoid/datum machinery).

## 12B implementation notes (added post-12A, contract unchanged)
- Implemented on `feat/static-gnss-baseline-core` exactly per this contract:
  standalone `gnssBaseline` type, `runGnssBaselineAdjustment` (TS dense
  only), strict Cholesky PD validation, `[−I +I]` rows, preflight datum
  rule (≥1 fully fixed 3D station/component), native-route tripwires.
- Refinement: unset session frame resolves from the unanimous baseline
  declaration; conflicts still fail closed (see 12B report).
- Station type carries no per-station frame tag, so fixed-control frame
  identity is the session declaration by construction (test builder sets
  it); per-station frame tags remain 12C scope.
- `projectLocal` single-origin variant deferred to 12C+ (ECEF only in 12B).
- Evidence: `reports/gnss/phase12b-core-baseline-adjustment.md`,
  `tests/gnssBaseline/` (40 tests incl. independent Gauss-Jordan golden).

## 12C import boundary notes (added post-12B, contract unchanged)

- Implemented on `feat/static-gnss-baseline-import`: WebNet-native `BL`
  text syntax plus a generic delimited importer, both canonicalizing into
  the unchanged Phase 12B `gnssBaseline` observation. Canonical core
  remains ECEF; import formats are boundary representations only.
- Syntax: `FRAME` (ECEF, or ENU with one shared `ORIGIN_LAT`/`ORIGIN_LON`
  rotation origin) + `UNITS M|MM|CM` + `GX` ECEF stations (FIXED/FREE)
  + `BL` records each followed by exactly one `COV` (xx xy xz yy yz zz)
  or `SIGCORR` block. Full grammar in
  `docs/gnss/STATIC_GNSS_BASELINE_FORMAT.md`.
- Single-origin ENU replaces the deferred `projectLocal` variant: one
  constant `R` per file, `b_ecef = R^T b_enu`, `C_ecef = R^T C_enu R`;
  GX stations stay ECEF (absolute positions need no rotation, only unit
  scale). Per-baseline FROM rotations remain rejected by construction.
- Units normalized once (`s`, `s^2`); one declaration covers vector and
  covariance. `gnssBaseline` stays out of the legacy parsed `Observation`
  union (dedicated entry point; mixed legacy records rejected).
- No TBC proprietary parser: no real sample in-repo; generic importer
  carries the mapping seam for 12E.
- Evidence: `reports/gnss/phase12c-baseline-import.md`.

## 12D statistics/QC/reporting notes (added post-12C, contract refined)

- Implemented on `feat/static-gnss-baseline-statistics`: per-baseline
  Qvv/Cvv blocks, redundancy traces, component diagnostics, block
  diagnostic T (no p-value), deterministic loop QC, whole-block
  removal what-if, structured + text ECEF report. Adjustment math
  unchanged; results gain an additive `statistics` field.
- Refinement of the 12A §9 simplification: effective df is
  rank(Cvv_i), and the estimated in-adjustment scale admits neither
  χ² nor F exactly — hence diagnostic-only labeling (see MATH §13).
- TS-dense only; no native/sparse/WASM, no robust, no mixed networks,
  no UI. Evidence: `reports/gnss/phase12d-baseline-statistics.md`.
