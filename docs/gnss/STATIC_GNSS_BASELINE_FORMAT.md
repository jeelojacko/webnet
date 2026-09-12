# Static GNSS Baseline File Format (Phase 12C)

Status: experimental core import stage. No UI, no statistics report, no
native routing. Canonical core remains ECEF (12A contract); the syntax
below is a boundary representation only.

Parser: `parseGnssBaselineText` in `src/engine/gnssBaselineNetworkImport.ts`.
Generic delimited import: `importGnssBaselineDelimited` /
`importGnssControlCsv` in `src/engine/gnssBaselineCsvImport.ts`.

## 1. Native text syntax

Keyword `BL` (never `G`/`G0`-`G4`, whose meanings are untouched).
One `FRAME` and one `UNITS` per file. Every `BL` is followed by exactly
one `COV` or `SIGCORR` block. Comments start with `#` (full-line only);
blank lines, extra spaces, and CRLF are accepted. Decimal numbers only
(no locale commas, no `NaN`/`Infinity`/hex/`12abc` permissiveness).

```text
FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80
UNITS M
GX A 3771793.0 140253.0 5124304.0 FIXED
GX B 3773027.567 140018.875 5124649.875
BL A B 1234.567 -234.125 345.875 ID BL001 SESSION 2026-101 SOLUTION FIXED
COV 0.000004 0.000001 0.0000002 0.000009 -0.0000003 0.000016
```

### FRAME

`FRAME ECEF <frame-id> [EPOCH <epoch>] [ELLIPSOID <ellipsoid>]`

`FRAME ENU <frame-id> [EPOCH <epoch>] [ELLIPSOID <ellipsoid>]
ORIGIN_LAT <deg> ORIGIN_LON <deg>`

The frame id, epoch, and ellipsoid are compared by exact string equality
between the declaration and every baseline/station; mismatch is a hard
error. No transformation is ever performed. `ENU` requires the shared
origin and applies one constant rotation `R` to every baseline (see §4).
`EPOCH` is metadata validation only: inputs must already share an epoch.

### UNITS

`UNITS M | MM | CM` — vector units. Covariance is always in (vector
unit)^2. Normalized once at the boundary: `b_m = s * b`,
`C_m2 = s^2 * C`. One declaration covers vector and covariance; split
unit declarations are not supported.

### Stations

`GX <id> <X> <Y> <Z> [FIXED | FREE]` (default `FREE`).

GX coordinates are absolute ECEF positions in file units — unit-scaled
only, never rotated. In `ENU` files GX stays ECEF; only baseline vectors
and covariances are ENU. `FIXED` means fully fixed X/Y/Z control (one per
connected component minimum). No orthometric-height interpretation, no
geoid. Station ids `__proto__`/`prototype`/`constructor` are rejected.

### Baselines

`BL <from> <to> <dx> <dy> <dz> [ID <code>] [SESSION <s>] [SOLUTION <q>]
[SOURCE <t>]` (`SOL` accepted as an alias of `SOLUTION`).

Repeated A→B solutions stay independent observations (never averaged);
only explicit `ID` values must be unique. Metadata is opaque reporting
context and never enters the mathematics. `FROM == TO` is always
rejected; a zero vector between distinct stations warns but is accepted.

### Stochastic blocks

`COV <xx> <xy> <xz> <yy> <yz> <zz>` — full covariance, explicit order.

`SIGCORR <sx> <sy> <sz> <rhoXY> <rhoXZ> <rhoYZ>` — converted as
`Cxx = sx^2`, `Cxy = rhoXY*sx*sy`, etc. Sigmas must be finite and > 0,
rhos finite within [-1, 1]; no clamping. No `VAR` synonym (two clear
forms only, matching the existing covariance convention).

Both forms feed the single Phase 12B SPD validator (Cholesky-strict, no
repair). The block binds to the immediately preceding `BL`: orphan `COV`,
duplicate blocks, and EOF-with-missing-covariance are hard errors.

## 2. ENU rotation

One shared origin (file-level `ORIGIN_LAT`/`ORIGIN_LON`). Convention
(12A §6): component order East, North, Up,

```text
R = [ -sinL            cosL          0
      -sinP*cosL  -sinP*sinL   cosP
       cosP*cosL   cosP*sinL   sinP ]
b_ecef = R^T * b_enu,   C_ecef = R^T * C_enu * R
```

Vector and covariance always transform together. Per-baseline FROM
rotations are rejected by construction (one `R` for the whole file).
Orthonormality is verified (`R*R^T ≈ I`); latitude is range-checked.

## 3. Reversal

`B->A` with vector `-b` and identical covariance `C` solves equivalently
(`(-I)C(-I)^T = C`).

## 4. Generic delimited import

Header-driven CSV/TSV (`;`/tab sniffed when no delimiter is given;
minimal RFC4180 quotes). Recognized headers (case-insensitive, bounded
alias table in `gnssBaselineCsvImport.ts`):

- `from` (+ From Point, FromPoint, From Station, From ID), `to` (+ same
  family), `dx` (+ Delta X, dX), `dy`, `dz` (+ dE/dN/dU accepted)
- covariance: `cxx cxy cxz cyy cyz czz` (+ `cov xx`, `varX` family)
- sigma/correlation: `sx sy sz rho_xy rho_xz rho_yz` (+ sigma/std/corr
  families), `id`, `session`, `solution`, `source`
- optional per-row `frame`, `epoch`, `ellipsoid` columns: when present,
  every row must carry them and all values must equal the declared
  import options (mixed-frame files rejected)

Frame identity, units, epoch, ellipsoid, and ENU origin come from typed
`GnssCsvImportOptions` — never guessed from filenames. Control CSV
(`importGnssControlCsv`): `id,X,Y,Z,fixed`, normalized to canonical
metres on import. Unknown extra columns are ignored; missing/ambiguous
required columns fail with mapping diagnostics.

## 5. TBC status

No proprietary Trimble parser ships: no real TBC baseline export sample
exists in-repo (the committed `.jxl` sample holds total-station records
only). The generic delimited importer is designed to map TBC text/CSV
exports once a sample provides column semantics, stochastic form, and
frame metadata (12E work). Do not claim TBC support.

## 6. Diagnostics

Stable `GNSS_*` codes with line/row numbers where possible; structural
checks run before any solve (`validateGnssBaselineNetwork`):

errors: `GNSS_MISSING_FRAME`, `GNSS_MISSING_UNITS`,
`GNSS_UNSUPPORTED_UNITS`, `GNSS_BAD_FRAME`, `GNSS_DUPLICATE_FRAME`,
`GNSS_DUPLICATE_UNITS`, `GNSS_MALFORMED_STATION`,
`GNSS_DUPLICATE_STATION`, `GNSS_MALFORMED_BASELINE`,
`GNSS_MALFORMED_NUMERIC`, `GNSS_MALFORMED_COVARIANCE`,
`GNSS_BAD_COVARIANCE`, `GNSS_BAD_SIGCORR`, `GNSS_ORPHAN_COVARIANCE`,
`GNSS_DUPLICATE_COVARIANCE`, `GNSS_MISSING_COVARIANCE`,
`GNSS_UNKNOWN_STATION`, `GNSS_SELF_BASELINE`, `GNSS_DUPLICATE_ID`,
`GNSS_UNKNOWN_RECORD`, `GNSS_MIXED_MODE`, `GNSS_FRAME_MISMATCH`,
`GNSS_EPOCH_MISMATCH`, `GNSS_ELLIPSOID_MISMATCH`,
`GNSS_UNCONTROLLED_COMPONENT`, `GNSS_DATUM_FAILURE`,
`GNSS_NO_BASELINES`, `GNSS_CSV_MISSING_HEADERS`,
`GNSS_CSV_PARTIAL_STOCHASTIC`, `GNSS_AMBIGUOUS_CSV_MAPPING`,
`GNSS_MALFORMED_CSV`, `GNSS_MALFORMED_RECORD`,
`GNSS_CANONICALIZE_FAILED`, `GNSS_LINE_TOO_LONG`,
`GNSS_ENU_ORIGIN_MISSING`

warnings: `GNSS_REPEATED_BASELINE`, `GNSS_ZERO_LENGTH`,
`GNSS_NO_SESSION_METADATA`

Mixed legacy records (`G`, `D`, `A`, …) in a GNSS file are rejected
(`GNSS_MIXED_MODE`): parsed GNSS networks stay GNSS-only, and
`gnssBaseline` stays out of the legacy parsed `Observation` union (a
dedicated `parseGnssBaselineText` entry point, not a legacy-parser
extension).

## 7. Pipeline

`text -> parse -> canonicalize (units once + ENU rotation) ->
validate/data-check -> runGnssBaselineAdjustment` (TS dense only).
Each stage is independently testable; no giant import-and-solve entry
point. Per-baseline provenance (original vector/units/form/frame,
rotation applied, canonical vector/covariance) is retained for trace.

## 8. Unsupported (12D+ scope)

SINEX, RINEX processing, CRS/datum/velocity transforms, geoid,
mixed terrestrial+GNSS solves, free networks, stochastic control,
robust GNSS, block statistics/blunder handling, UI.
