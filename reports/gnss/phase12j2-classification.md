# Phase 12J.2 Batch D — Analytical Classifications (§§18–19, 24–26, 30)

EVIDENCE ONLY. No `src/` production changes, no math/tolerance changes, no vendor commits, no downloads.
TBC config frozen in `reports/gnss/phase12j2-tbc-config.md`.
New primary evidence in this batch (local corpus, read-only, never committed):
`ProcessingGNSSBaselines/.../process baseline report/292d3b4c.7.html` (S32/B32 detail page),
`sett2.png` (Baseline Processing > Quality), `sett4.png` (Default Standard Errors),
`post-BL-processing-b4adjustment.gvx` (PV32 = S32 window).

S32 oracle: P041→SIXTWO, 2006-06-14 17:24:30–18:10:30 GPS, TBC B32 dX/dY/dZ
(+5822.646, −5654.885, −4846.085) m, length 9453.3312 m, mark-to-mark.

## §18 — Trajectory "Fixed and float": OUTPUT-ONLY (float half); fixed half consumed by definition

Verdict: **OUTPUT-ONLY** for static vectors — the "and float" half never enters a Fixed solution.

Reasoning: the B32 detail page records Solution Type **Fixed** with Processing Style **Force Float: No**.
A static baseline estimator produces one fixed vector; with float forcing off there is no path by
which the float trajectory feeds the accepted solution. RTKLIB side (`phase12j1-covariance-audit.md` §18):
the S32 static run is a single forward filter pass (`postpos.c:1157`), `solstatic=0`, every accepted epoch
written out, 90/93 epochs FIXED — per-epoch trajectories are output rows, not inputs to a separate
acceptance step. "Fixed and float" therefore controls which trajectories TBC stores/displays (QC context
for the first 3–4 convergence epochs, cf. 12J.1 cohort §24), not the static fix computation.
RTKLIB mapping: no equivalent knob exists; the matched S32 config already emits the per-epoch sequence
and consumes the last FIX. The OPEN "acceptance logic between the two" cell in the frozen config is closed
as: no acceptance logic exists — Force Float No + Fixed solution type IS the acceptance.

## §19 — GIS "Automatic Carrier and Code": separate GIS workflow, NO RTKLIB mapping

Verdict: **separate GIS workflow — NO RTKLIB mapping** (no equivalent knob; do not stage).

Reasoning: on the B32 detail page "GIS processing type: Automatic Carrier and Code" appears inside the
Tracking-Summary/Processing-Style footer, while the baseline solution fields above it read Frequency used:
**Dual Frequency**, Solution Type: **Fixed**. The static baseline engine consumed dual-frequency carrier;
the GIS type governs TBC's GIS/handheld (code-phase) processing path, a different engine entry point that
never touches the S32 static DD solution. RTKLIB-mapping verdict: NONE — static DD processing
(`rtkpos.c` relative path) has no carrier-vs-code automatic selector; staging one would fabricate a knob.
The frozen-config row stays observed-value-only.

## §24 — Zero setup errors (0.000/0.000) vs physical antenna heights: SEPARATED

Verdict: **setup errors are stochastic-only; physical heights stay in the functional model. No double role.**

Statement: `sett4.png` (Default Standard Errors > GNSS, Default Setup Errors) reads Instrument centering
error 0.000 m, Error in height of antenna 0.000 m — these add **zero variance** to the stochastic model.
The physical setup heights live elsewhere and are unaffected: B32 page, Occupations — Antenna Height
(Measured) **0.008 m** (P041) / **2.000 m** (SIXTWO), Method Bottom of antenna mount; GVX carries
`ARP_HEIGHT` per point (e.g. sixtwo 2 m). Heights enter **deterministically** via the marker→ARP reduction
(`phase12j1-marker-arp-contract.md`; 12J.2 Batch C §12: RINEX DELTA H parsed but never in the DD estimator,
L1 reduction applied exactly once outside RTKLIB). Consistency with B0 evidence: dataset-B parity L3
(SEUW 1.965038 vs displayed 1.97; coordinates sub-nm vs post-GVX) was achieved with raw GVX covariances
and zero setup errors — proving no hidden height variance is needed and the deterministic height path is
already exact. A nonzero setup error would inflate covariances only; it would never move a vector.

## §25 — Coordinate system: all four items OUTPUT-ONLY w.r.t. raw ECEF baseline processing

Verdict: **Molodensky XYZ 0 / GRS80 / GEOID03 / Colorado North LCC are all OUTPUT-ONLY** (display/projection);
the raw ECEF baseline vector is unaffected by any of them.

| Item (B32 page: US State Plane 1983, Colorado North 0501, NAD 1983 (Conus), WGS84, GEOID03) | Why output-only |
|---|---|
| Molodensky XYZ 0 (zero translation parameters) | Pure translation cancels in endpoint differencing — proven numerically below |
| GRS80 (ellipsoid) | Defines geodetic/grid conversion of endpoints; never enters the DD range model |
| GEOID03 (geoid) | Orthometric elevations only (B32 Elevation vs Height rows); ECEF untouched |
| Colorado North LCC / State Plane 0501 | Projection of endpoint coordinates (Northing/Easting rows); vector rows D X/D Y/D Z independent |

Proof (not assertion) — zero translation cancels, 3-line numeric demonstration
(S32-scale endpoints, arbitrary translation T = (100, −200, 50) m):

- d0 = B − A = (5822.6462, −5654.8852, −4846.0851) m
- d1 = (B + T) − (A + T) = (5822.6462, −5654.8852, −4846.0851) m
- d1 − d0 = (0.0e+0, 0.0e+0, 0.0e+0) m — exactly zero; any constant datum shift vanishes in the vector.

Corollary: a nonzero Molodensky translation would move both endpoints identically and still cancel;
only rotation/scale (see §26) can move a baseline vector.

## §26 — Frame parity: source-frame labels retained; rotation/scale-only effect quantified

Verdict: **retain source-frame labels; raw-processor frame ≠ TBC project frame; justified transform effect is
rotation/scale-only (translation cancels per §25).**

Labels (provenance, never inherited — `phase12j1-frame-contract.md`):

- Raw RTKLIB broadcast leg: WGS84(G1150)-class, epoch 2006-06-14 (2006 broadcast era).
- Raw RTKLIB SP3 leg: IGb00 (product's own label, `igl13793.sp3`, GPS week 1379).
- TBC B32: project frame — B32 page: Datum **NAD 1983 (Conus)**, Zone Colorado North 0501, Global ref WGS84,
  Geoid GEOID03; GVX export frame **NAD83(2011)@2010** (REFERENCE_SYSTEM block). Record both; do not reconcile.

Quantification on the S32 vector d = (5822.646, −5654.885, −4846.085) m:

- Measured (12J.1 §19): broadcast vs SP3 legs identical to **0.1 mm** — actual inter-frame effect sub-mm.
- Bound (synthetic near-identity Helmert from `scripts/gnss/gnss12j1FrameTransform.ts` constants:
  RX 1.2e-6, RY −0.8e-6, RZ 0.5e-6 rad, scale 1.5e-8): |J_d·d − d| = **11.209 mm**
  (components +6.792, +8.642, −2.200 mm). µrad-level rotation moves a 9.4 km vector at the ~10 mm level;
  translation contributes exactly 0.0 (§25 demo, oracle translation-invariance error 0.0 m).
- Reading: frame handling is a second-order effect next to the 22.6 mm RTKLIB↔TBC marker-to-marker gap;
  no frame relabeling or tuning is justified.

## §30 — Tropo/iono: exact RTKLIB config recorded; TBC evidence absent; bounded-sensitivity need only

Verdict: **RTKLIB side frozen and exact; TBC side has NO tropo/iono evidence; sensitivity study may bound,
never tune.**

- RTKLIB S32 exact config (`scripts/gnss/gnss12j1OptionsDescription.ts`):
  `ionoopt = broadcast (IONOOPT_BRDC=1)`, `tropopt = Saastamoinen (TROPOPT_SAAS=1)` — both `prcopt_default`,
  no CLI override. Sits alongside `err[] = [100, 0.003, 0.003, 0, 1.0, 52.0, 0, 0]`, `eratio 300 x4`.
- TBC exact evidence: **none**. Neither the frozen-config settings manifest, nor the B32 Processing Style
  block (mask / Auto Start / Antenna Model Automatic / Ephemeris Automatic / Frequency All Frequencies /
  Processing interval Automatic / Force Float No / GIS type), nor any `sett*.png` names a tropospheric or
  ionospheric model. "Ephemeris Automatic" selects orbit source, not atmosphere handling.
- Need: a bounded sensitivity rung (ladder batch owns RTKLIB runs) varying iono/tropo options within
  physically plausible settings and reporting the S32 vector delta — to size the atmospheric share of the
  22.6 mm gap. No option may be selected to minimize the TBC residual.
