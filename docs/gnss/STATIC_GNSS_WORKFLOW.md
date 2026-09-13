# Static GNSS Baseline Workflow (Phase 12G)

Product UI over the production static-GNSS backend: processed ECEF baseline
vectors with full 3×3 correlated covariance, adjusted in the
`Static GNSS Baseline Network — ECEF dX/dY/dZ` workspace (toolbar button
`Static GNSS workspace`; `*.gvx` files picked from normal import route there
automatically).

## Supported

- **Processed baselines only**: GVX 1.0 (`GNSS_VECTOR` / `POINT` /
  `REFERENCE_SYSTEM`), delimited CSV (stations/control CSV plus baselines
  CSV), or the built-in synthetic sample (1 fixed + 5 free stations, closed
  ring + diagonal + one repeated vector, clearly synthetic `SYN_*` /
  `SYNTH-WGS84(G2139)` tags).
- **ECEF dX/dY/dZ adjustment** through the production worker route
  (`gnss-run` message on the normal adjustment worker; native R2B /
  TypeScript auto-route, no engine picker, R1 never surfaced).
- **Correlated 3×3 covariance** per baseline (SIGCORR or full COV).
- **Datum control**: FREE / FIXED-XYZ toggle per station (full-XYZ only;
  partial constraints are not representable). Every connected component
  needs one fully fixed 3D station; missing control is a blocking
  diagnostic, never inferred.
- **Setup uncertainty**: optional tripod-centering (EN, metres) and antenna
  height (Up, metres) sigmas, defaults `0.000` m (no augmentation,
  bit-identical solve). Nonzero setup rotates per-endpoint local ENU to
  ECEF, augments (never replaces) raw covariance, needs a declared
  ellipsoid, and stays on the TypeScript dense path per backend tripwire.
- **QC**: fail-closed preflight gates (ECEF frame, SPD covariance,
  resolved endpoints, connectivity, datum, setup, ellipsoid), loop
  closures, whole-block statistics (standardized components, redundancy
  trace, block T — diagnostic only, no p-value claims), and one-block
  removal what-if (diagnostic only, nothing is deleted; skipped over 25
  baselines).
- **Reports**: text + JSON export (structured report plus adjusted ECEF
  stations, route, and reasons). Raw vs setup vs effective covariance is
  shown per baseline in expandable detail.
- **Multi-file projects (PRODUCTION / DEFAULT ON)**: named-project runs compose compatible sources automatically (native-BL `FRAME ECEF` / `BL` text, GVX 1.0, delimited CSV against the parsed station union). Composition is post-parse only — exact frame/epoch/ellipsoid match, 1e-9 m no-averaging station merge, FIXED-wins control, every baseline retained, STRONG cross-source duplicates block — with project control overrides applied after composition and one composed solve through the unchanged dispatch. Kill switch `setGnssMultifileEnabled(false)` restores single-session behavior (OFF throws fail-closed).

## NOT supported

- RINEX / PPP / raw receiver data (processed vectors only).
- Mixed terrestrial + first-class ECEF `gnssBaseline` sessions (GNSS networks are GNSS-only; legacy `G`/`GPS` observations stay on the terrestrial path).
- Free-network (datumless) adjustment — programmatic-only explicit opt-in
  (`datumMode: 'allow-free'` on the adjust input / multifile run options,
  default `'constrained'`; no UI): TS-dense temporary-gauge +
  inner-constraint S-transform per free component (see
  `STATIC_GNSS_BASELINE_MATH.md` §11); native R2B is never admitted for
  free networks. Without the opt-in the backend still refuses free
  components — fix X/Y/Z of at least one station per component.
- Datum transformations / epoch propagation (exact frame/epoch/ellipsoid
  match required; mismatches block).
- Per-source setup sigmas (one run-level setup-uncertainty model per
  composed project run).
- CRS transforms / projected coordinates / lat-lon display (ECEF is
  authoritative).
- Legacy `GPS` wording or terrestrial surfaces (untouched; GNSS labels
  always read `Static GNSS Baseline Network — ECEF dX/dY/dZ`).

## Notes

- Absent frame/epoch/ellipsoid metadata renders as `unknown`, never
  invented.
- The sample ring closes deliberately: degree-1 spur stations carry zero
  redundancy and trip the backend Qvv PSD gate, so every free station has
  degree ≥ 2.
- Tables paginate (50/page) with sort + filter for large networks.
