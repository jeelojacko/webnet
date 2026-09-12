# Phase 12A Report — Static GNSS Baseline Network Adjustment Architecture

- Branch: `feat/static-gnss-baseline-architecture`
- Baseline: `origin/main 4afd157b` (Phase 11A / PR #33 merge)
- Working HEAD at report time: `5d04003c` + uncommitted 12A docs/test
  (branch cut from `origin/main`; local `5d04003c` is the pre-merge tip —
  verify `git rev-parse HEAD` at PR time)
- Production behavior changed: NO
- Observation parser changed: NO
- Adjustment engine behavior changed: NO
- Numerical contract changed: NO
- CRS behavior changed: NO
- WASM behavior changed: NO
- UI changed: NO

Deliverables: `docs/gnss/STATIC_GNSS_BASELINE_ARCHITECTURE.md`,
`docs/gnss/STATIC_GNSS_BASELINE_MATH.md`,
`tests/architecture/phase12a_gnss_baseline_math.test.ts` (self-contained
formula proofs, no production imports).

## Current WebNet 3D coordinate semantics (audited from code)

- x: project easting-like Cartesian / projected-grid easting (metres);
  azimuth `atan2(dx,dy)` (`adjustEngineCoordinateMethods.ts:39-51`).
- y: project northing-like Cartesian / projected-grid northing (metres).
- z/h: project vertical elevation (metres); declared `heightType`
  orthometric default, ellipsoidal where tagged; geoid `h+N` promotion is
  computational during solve prep, not display-only.
- Frame assumption: ONE global project frame for terrestrial equations
  (local Cartesian or projected grid + one vertical); CRS/ellipsoid
  machinery participates only in grid reductions and GNSS vector edges.
- Terrestrial equations consume Euclidean `x/y/h` differences with
  instrument/target corrections; directions/zeniths in radians.

## Decisions

- Recommended MVP adjustment frame: **ECEF** (Option B), with a
  single-origin local-Cartesian importer variant (Option D) on the same
  linear engine path. Reason: only shared-Cartesian designs keep the exact
  linear `[−I +I]` model with consistent covariance rotation; projected
  conversion (A) is generally nonlinear; geodetic unknowns (C) explode
  scope (ellipsoid Jacobians, geoid in chain). GNSS-only first; mixed
  terrestrial deferred.
- Baseline canonical representation: order `[x y z]` ≡
  `[ΔX ΔY ΔZ]` (or `[E N U]` after the single declared rotation); frame
  ECEF canonical, `projectLocal` admitted with recorded origin; metres /
  m²; full symmetric 3×3 covariance (six upper-triangle values);
  reversal negates vector, covariance unchanged (`(−I)C(−I)ᵀ = C`).
- Observation equation: `b_calc = X_B − X_A`; misclosure
  `w = b_obs − b_calc` (WebNet observed−computed sign); Jacobian
  `[−I₃ +I₃]` (FROM −1, TO +1); linear in shared frame; 3 equations, 1
  logical observation per baseline.
- Covariance transformation: `C_local = R·C_ecef·Rᵀ`,
  `C_ecef = Rᵀ·C_local·R`; ENU order; one declared origin; vector never
  transformed without covariance; canonical storage covariance.
- Datum: minimum **one fixed 3D station** (translation defect = 3; vectors
  already constrain orientation/scale). Free-network/inner-constraints/
  Helmert/S-transform deferred. Stochastic control beyond existing
  per-component + XY-block deferred.
- Height treatment: adjust Cartesian XYZ; orthometric output is a
  post-adjustment `H = h − N` export step with explicit geoid. No hidden
  geoid in-solve; undeclared control height type rejected.
- Reference frame metadata: frame name + realization + epoch + ellipsoid
  required on baselines and control; mismatches fail closed; all inputs
  pre-reduced to one frame/epoch (no velocity machinery in MVP).
- Weight integration: current structured weights compatible on the TS
  path (arbitrary upper-triangle entries; covariance→weight at solve
  prep). Native sparse + full-Qxx exclusions are certification policy, not
  C++ inability — recertification campaign required before admission.
  Cap `768` params ≈ 256 coordinate-only stations; unchanged.
- Cross-baseline correlation: MVP independent 3×3 blocks only, fail-closed.
- Statistics: component residuals (WebNet sign) + `‖v‖` + `vᵀPv`
  descriptive; normative test is 3-DOF block `T_i = v_iᵀC_vi⁻¹v_i`
  (12D derives `Qvv`-block recovery); block redundancy `trace ∈ [0,3]`;
  whole-block blunder removal; robust excluded from MVP.
- Importer recommendation: (1) TBC processed-baseline text/XML export,
  (2) Trimble JobXML/JXL baseline elements, (3) generic CSV vector export.
  SINEX noted as future (full-network covariance). RINEX excluded (raw
  observations). No baseline samples in-repo — TBC export + TBC adjusted
  report + control/frame metadata to be obtained for 12E.
- Proposed generic format: per-file `FRAME … UNITS M` declaration +
  `BL from to dx dy dz COV xx xy xz yy yz zz [SESSION … SOL …]`
  (new `BL` keyword; `G/G0-G4` taken; final syntax is 12C scope).
- Synthetic fixtures 1–8 + NumPy golden-reference plan: §14 of architecture
  doc. Real-world parity plan: TBC/Leica Infinity/STAR*NET-equivalent +
  published teaching networks (§14, §11).
- Mixed-network strategy: GNSS-ONLY FIRST. CRS prerequisite: NO.
- Phase 12B GO / NO-GO: **GO** — exact scope: core `gnssBaseline`
  observation + 3×3 covariance weighting on the TS dense path, GNSS-only,
  fixed control (≥1 fixed 3D station), independent blocks, fixtures 1–8;
  no parser production route beyond 12C, no native routing changes, no
  CRS/geoid/datum machinery.

## Validation performed

- `npm run lint`, `npm run typecheck`, focused architecture math test.
  Full `test:agent` + build at PR time (docs-only + self-contained test;
  no production code touched).
