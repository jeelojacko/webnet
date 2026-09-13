# Phase 12E.3 — production GNSS endpoint setup-uncertainty report

Manual evidence (NOT CI). Branch `feat/gnss-endpoint-setup-uncertainty`.
External intake is read-only; no vendor file is committed.

## 1. What shipped (production API)

- New module `src/engine/gnssBaselineSetupUncertainty.ts`: optional
  network-level `setupUncertainty: { horizontalCenteringSigma,
  antennaHeightSigma }` (metres, 1-sigma, generic names), default zero.
- Math: `C_local = diag(sc², sc², sh²)` per endpoint,
  `C_ecef = Rᵀ · C_local · R` with that endpoint's OWN fixed local ENU
  frame from the a-priori input ECEF coords (Bowring/WGS84 orientation
  only — no projections/datum shifts), `C_eff = C_raw + C_from + C_to`.
  Applied once before solve-weight construction; never in import; no
  SEUW feedback. `C_eff` passes the existing SPD gate (no jitter).
- Raw covariance preserved on each augmented observation
  (`rawCovariance`); effective drives the solve. Fixed (control)
  endpoints are augmented like free ones.
- Fail-closed: non-finite/negative sigmas rejected pre-solve; nonzero
  setup with missing/unrecognized ellipsoid rejected (accepted tags:
  WGS84, GRS80 — orientation provenance gate); orientation failure and
  non-finite `C_eff` rejected pre-solve. Zero setup adds no new
  requirement (input observations returned untouched, bit-identical).
- IMPORT-shared-ENU vs SETUP-per-endpoint-ENU is documented in the
  module header, MATH §14, and ARCHITECTURE §12E.3: the 12C text import
  rotates whole files through ONE shared origin; setup builds one frame
  PER ENDPOINT because setup error is local (plumb/vertical at the
  tripod). Never confused.
- Text format: programmatic-first; NO `SETUP_SIGMA` directive
  (explicit deferral — the BL parser's one-FRAME/one-UNITS file model
  does not need a new directive for an operator-side run option).
- Reporting: `GnssBaselineReport.setupModel` (independent endpoint
  local ENU + sigmas + ellipsoid) with per-baseline raw/setup exposure;
  `inputSigma` reflects the effective covariance that weighted the
  solve. Import-stage `validateGnssBaselineNetwork(network, setup?)`
  data-check mirrors the solve gates without solving.
- Routing: nonzero setup stays TS-dense — augmented observations keep
  the `gnssBaseline` discriminator so existing native/sparse exclusion
  gates refuse every route; route-exclusion test extended.

## 2. Production-vs-evidence agreement (external Dataset-A GVX, read-only)

Authoritative input: `~/Downloads/webnet-gnss-12e/tbc-intake/
AdjustingtheNetwork/Adjusting the Network.gvx` (91 vectors, P041
fixed), the same file the evidence models ran on. Production runs used
the production API (`setupUncertainty` + session `ellipsoid: 'WGS84'`
per the TBC report frame note); evidence runs used the evidence-only
`setupCovarianceEcef` helper. TBC bodies A0/AC/AH/A supply only the
displayed-factor compatibility intervals (unchanged from the 12E.2
report).

| Run | Evidence SEUW | Production SEUW | dSEUW | TBC interval | max \|C_eff\| diff (m²) | max coord diff (m) |
| --- | --- | --- | --- | --- | --- | --- |
| A0/M0 (raw) | 2.100053 | 2.100053 | 0 | [2.095,2.105) PASS | 0 | 0 |
| AC/MC (0.005/0) | 1.297104 | 1.297104 | 0 | [1.295,1.305) PASS | 2.71e-20 | 0 |
| AH/MH (0/0.002) | 1.988831 | 1.988831 | 0 | [1.985,1.995) PASS | 6.78e-21 | 0 |
| A/MCH (0.005/0.002) | 1.102511 | 1.102511 | -2.22e-16 | [1.095,1.105) PASS | 2.71e-20 | 0 |

DOF 228, 2 iterations, converged, in every run. Agreement is within
existing numerical precision (the only math difference is the
geodetic-iteration count/orientation path: production Bowring ×4 from
its own seed vs evidence ×5). No fitting was performed.

Wording (SUPPORTED-not-proven): the production implementation
reproduces the available TBC controlled-adjustment results within the
precision exposed by the TBC reports. This is NOT a proof of TBC's
proprietary algorithm — only that the independent-endpoint local-ENU
augmentation predicts TBC's response to the A0/AC/AH/A setup changes
within display precision.

## 3. Performance smoke (recorded, not gated)

`applyGnssSetupUncertainty` augmentation only (one-time, pre-solve):
50 endpoints 1.1 ms, 100 endpoints 0.9 ms, 1000 endpoints 3.8 ms,
10000 endpoints 31.5 ms (~3 µs/endpoint, linear; negligible next to
the solve).

## 4. Acceptance gates A–I

- A (zero-compat): PASS — absent/all-zero setup returns input
  observations untouched; coordinates/varianceFactor/dof
  bitwise-equal; covered by test.
- B (covariance math): PASS — equator/lon0 closed forms
  (centering-only/height-only/combined), lat45 hand golden, and
  independent outer-product cross-checks at mid/high-lat + nonzero
  lon, all green.
- C (endpoint sum): PASS — `C_eff = C_raw + C_from + C_to`;
  A→B vs B→A reversal identical; fixed-control endpoint augmented;
  trace `2sc²+sh²` per endpoint.
- D (commercial evidence): PASS — table above; production SEUW equals
  evidence SEUW to 6 dp on all four runs, TBC intervals all PASS.
- E (local-Up): PASS — non-equatorial height-only augmentation
  diverges from naive ECEF-Z as expected (Up carries xx/xz/zz at
  lat45); metre-scale a-priori perturbation moves `C_eff` < 1e-9.
- F (provenance): PASS — `rawCovariance` preserved per observation;
  report carries setup model + raw/setup/effective exposure;
  `inputSigma` reflects solve weights.
- G (validation): PASS — NaN/Inf/negative rejected pre-solve; missing
  and unknown ellipsoids fail closed; orientation/non-finite gates
  covered; import-stage diagnostics mirror without solving.
- H (routing): PASS — setup-augmented networks solve TS-dense only;
  discriminator tripwires intact; new module source-scanned clean of
  WASM/sparse/robust/geoid.
- I (legacy): PASS — `tests/gnssBaseline/` 226/226 (209 pre-existing
  + 17 new), GVX suites green, no parser/solver/wording regressions
  outside the specified additive report fields.
