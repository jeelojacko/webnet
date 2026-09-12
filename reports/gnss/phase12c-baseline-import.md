# Phase 12C Report — Static GNSS Baseline Text Import

- Branch: `feat/static-gnss-baseline-import`
- Baseline: `38d0f5e78` (Phase 12B on `feat/static-gnss-baseline-core`,
  over `origin/main 9441897b` = Phase 12A / PR #34 merge)
- Production user-facing parser changed: NO
- New GNSS text parser: YES (standalone, never enters legacy `.dat` flow)
- Generic CSV importer: YES (`generic` profile only)
- TBC proprietary parser: NO (no real sample in-repo)
- Adjustment mathematics changed: NO
- Existing parser semantics changed: NO
- GNSS canonical model changed: NO
- Native routing changed: NO (tripwire coverage extended to imports)
- WASM changed: NO. CRS transformations added: NO. Geoid behavior
  changed: NO. Numerical tolerances changed: NO.

## 12A/12B contradiction check

None. Imports target the Phase 12B canonical `gnssBaseline`
observation unchanged: `b_obs = X_TO - X_FROM`, full 3x3 covariance in
m^2, strict SPD validation reused (single validator, no duplication),
frame/epoch/ellipsoid exact-match preflight reused. One policy choice
(new, documented): GX station coordinates are absolute ECEF positions —
unit-scaled, never rotated — including in ENU files (absolute positions
would need a translation origin, not just orientation lat/lon).

## Syntax decision

`BL` keyword (12A proposal adopted verbatim), file-level `FRAME` +
`UNITS`, `GX` stations, `COV` / `SIGCORR` blocks bound to the preceding
`BL`. Rationale: `G`/`G0`-`G4` meanings frozen; covariance stays visibly
attached to its baseline; deterministic line-number diagnostics; easy to
generate from scripts. `SOL` accepted as a `SOLUTION` alias (mission text
uses it). No `VAR` synonym: two stochastic forms only.

## Parser architecture

`src/engine/gnssBaselineRotation.ts` (~150 lines): 12A §6 matrix,
orthonormality gate, ENU->ECEF vector+covariance (plus ECEF->ENU
reference direction for tests).

`src/engine/gnssBaselineNetworkImport.ts` (~600 lines): strict numerics,
native parser -> `GnssBaselineNetworkInput` (stations, canonical ECEF
baselines, frame metadata, per-baseline provenance) -> canonicalize
(units once, shared rotation) -> `validateGnssBaselineNetwork`
(structural + preflight datum checks, pre-solve). `parseGnssBaselineText`
never throws on malformed input; serializer provided for tests/exports
(unit inversion only; ENU text output not supported — import is one-way
for rotated frames).

`src/engine/gnssBaselineCsvImport.ts` (~380 lines): header-driven
delimited import with an explicit bounded alias table, delimiter sniffing
(`,`/`;`/tab) + minimal RFC4180 quotes, strict numerics, options-carried
frame metadata, separate control-CSV importer.

## Units

`s` for vectors, `s^2` for covariances, applied once. m/mm/cm proven:
identical canonical observations (vector < 1e-9, covariance < 1e-15)
and identical adjustments.

## Covariance conversions

SIGCORR: `Cxx = sx^2`, `Cxy = rhoXY*sx*sy`, etc., with fail-closed
sigma/rho validation (no clamping). Hand-computed golden agreement;
COV-vs-SIGCORR adjustment parity.

## ENU/ECEF rotation

Shared origin, exact 12A matrix. Golden: independent reference agrees
< 1e-15; hand-verified orientation at lat=0/lon=0 (X->U, Y->E, Z->N)
and at lat=45/lon=0; symmetry/SPD/trace/determinant preserved;
ENU-imported vs ECEF-imported networks adjust identically
(coords < 1e-9, variance factor < 1e-12).

## Data-check diagnostics

Stable `GNSS_*` codes (40 error + 3 warning codes documented in the
format doc), line/row numbers, pre-solve datum/frame/covariance refusal.

## Generic CSV mapping

Aliases for from/to/dx/dy/dz (+dE/dN/dU), full covariance set,
sigma/correlation set, session/solution/source/id, optional per-row
frame/epoch/ellipsoid columns (must equal declared options; mixed-frame
rejected). Ambiguous/partial/missing mappings fail closed.

## TBC-text status

Sample available: NO (committed `.jxl` holds total-station records
only). Dedicated profile: NO. Claim: "generic delimited importer
designed to map TBC text/CSV exports". Needed for 12E: exported vectors,
stochastic data, header meanings, frame metadata, adjusted report.

## End-to-end fixture evidence

12B fixtures 1, 2, 4, 5, 6, 7, 8 pass through the file boundary;
solvable ones match the independent Gauss-Jordan golden (coords < 1e-9,
variance factor < 1e-9..1e-12). Native/CSV/SIGCORR triple parity proven.

## Performance (record-only, dev machine)

100 baselines 7.6 ms, 1,000 → 7.3 ms, 10,000 → 57.5 ms. No pathology.

## Limitations

No UI, no mixed networks, no robust mode, TS-dense only, ENU text
output unsupported, VAR form unsupported, epoch metadata-only, exact
frame-string equality, full-line `#` comments only.

## Validation

- `tests/gnssBaseline/`: 13 files, 92 tests green (40 pre-existing 12B).
- lint 0 errors (2 pre-existing warnings); typecheck clean; build clean.
- `test:agent`: 3021 passed / 1 skipped; same 3 pre-existing Study
  calibration failures re-proven via stash (fail on clean tree).
- Industry parity 25/25; native-route focused suites 35/35
  (7c sparse auto-route, 11a production cap, 7d hardening).
