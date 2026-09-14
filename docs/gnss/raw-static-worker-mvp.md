# Raw Static Baseline Processing MVP (Worker)

Phase 12J.4 production MVP: RINEX files → dedicated browser Worker → pinned
RTKLIB/WASM → review/export. Entry: **Process Raw Baseline** (sibling of the
processed-baseline workspace). Wording rule: this is **raw static baseline
processing**, never a "raw adjustment" — nothing here solves a network.

Two mission sentences for operators:

1. Processing converts simultaneous RINEX observation files into an ECEF
   baseline vector that still needs review before use.
2. Formal precision is not calibrated accuracy: the delivered covariance is
   the processor's internal formal estimate and may be optimistic as
   survey-network weighting.

## Supported

- GPS static baselines, L1/L2 dual frequency, one base + one rover.
- RINEX 2.10/2.11 observation files; evidence-grade RINEX 3.04 pair
  (synthetic fixtures only).
- Broadcast NAV ephemeris (vintage-checked against the common span ±4 h).
- Explicit SP3 precise mode (user-supplied file; SP3-as-input alone stays
  broadcast — only the `-k precise` config path is precise).
- FIXED solutions: full review + authoritative JSON export.
- FLOAT solutions: diagnostic view + diagnostic JSON only.
- Antenna heights from RINEX headers reduced along WGS84 ellipsoidal Up
  (marker-to-marker contract).

## Not supported (mission §57)

- Kinematic, PPP, RTK, single-frequency, non-GPS processing.
- Multi-baseline sessions, network solving, datum transforms.
- Automatic ingest into any project or network (review/export only).
- GLONASS/Galileo/BeiDou observables (GPS-only `-sys G` pin).
- Clock/orbit products beyond broadcast NAV + explicit SP3.
- Troposphere/ionosphere tuning claims beyond the pinned defaults.
- Any accuracy claim beyond the formal covariance (see FLOAT policy).

## ANTEX deferral

No safe RTKLIB-side ANTEX consumption path has been proven in this chain
(config semantics + calibration-table provenance untested end to end), so
antenna calibration is status-only: named models report
CALIBRATION_UNAVAILABLE with a generic warning, never silent correction.

## No native BL export

The BL text syntax has no field for covariance provenance, so emitting BL
would silently promote a FORMAL_UNCALIBRATED formal estimate to survey
weighting. Authoritative export is JSON only
(`webnet-raw-static-baseline/1`), which round-trips every
provenance/status/covariance field (see
tests/gnssRaw/gnssRawExportRoundtrip.test.ts).

## Frame policy

Results are MARKER_TO_MARKER_ECEF with a source frame label (broadcast:
WGS84(G1150)-class; precise: SP3 product label or PRODUCT_FRAME_UNKNOWN).
Never inherited from any project CRS.

## FLOAT policy

FLOAT = ambiguities not fixed. Shown as a diagnostic view, clearly marked
NOT EXPORTABLE as a survey baseline; only a diagnostic JSON copy is
allowed. FAILED = no solution, no export of any kind.

## Memory bound

32 MiB per staged file (fail-closed, never truncates); ≤4 NAV files per
job; fresh WASM instance per job with fixed MEMFS names; worker
terminable at any point with job-token stale-response ignore.

## Cache deferred

No result caching in this MVP: every run reprocesses from file bytes +
options hash. A content-addressed cache is deferred until provenance
replay demand justifies it.

## Raw sessions (12J.9 review track)

Multi-baseline sessions (2–20 files, STAR/MST/manual N−1 trees, bounded
PAR=2 pool, review/export only, no ingest) are specified with their
covariance policy, external-covariance audit, and evidence verdicts in
[raw-session-review.md](raw-session-review.md); evidence in
`reports/gnss/phase12j9-session-evidence.md`.
