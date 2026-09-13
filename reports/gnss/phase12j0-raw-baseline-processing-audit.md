# Phase 12J.0 — Raw Static-GNSS Baseline Processing Architecture Audit

Evidence-only audit (no production raw processing, no RINEX UI, no PPP/RTK/
kinematic, no gnssBaseline math/covariance/R2B/free-network changes, no
third-party source commits, no vendor data commits). Branch
`feat/gnss-raw-baseline-processing-audit`, baseline `origin/main 2ea0d015`
(PR #52 merge). Vendor intake read-only local-only, never committed.

| Suite | Location | Result |
| --- | --- | --- |
| TBC report extraction (NEW, evidence tooling) | `scripts/gnss/gnssRawBaselineAuditEvidence.ts` | parser only; 51/51 local HTMLs via /tmp runner |
| Downstream injection proof (NEW, agent, CI-safe) | `tests/gnssBaseline/gnssRawBaselineInjection.test.ts` | 2/2 synthetic, no vendor bytes |
| RTKLIB audit (web research) | §6 | rtklibexplorer v2.5.1 (`62d4677`), BSD-2-clause+extra |
| WASM probe (/tmp only, nothing committed) | §28 | `emcc -c lambda.c` exit 0; postpos path pthread-free |

Validation: new test 2/2, `eslint` clean on new files, `tsc`/`test:agent`
delta-free vs §0 baseline (only pre-existing phase9l-noise + study-desktop
failures), `parity:industry-reference` 25/25, `build` clean.
Production behavior unchanged (§40Q: no tracked `src/` diffs; batch adds
TODO.md entry + this report + 2 evidence files; pre-existing untracked
phase9l noise left uncommitted).

## §0 — Baseline

- SHA `2ea0d015d3c80c09c389620187a93b16bd6ee39e` = PR #52 merge. Confirmed.
- `npm run lint`: 0 errors (2 pre-existing warnings, unrelated files).
- `npm run typecheck`: 4 errors, all inside untracked pre-existing noise
  file `src/engine/runSessionAsync.ts` (phase9l leftovers, not this batch).
  Zero errors in tracked HEAD code or new files.
- `npm run test:agent`: 3428 pass / 11 fail — all failures in
  `study-desktop/*` calibration or untracked phase9l noise; none touch
  gnss/free-network. Focused `gnssBaselineEquation` 4/4,
  `gnssBaselineAdjustment` + `gnssFreeNetwork` 32/32.
- `parity:industry-reference` 25/25 (<1 s). `build` clean (7.98 s).
- Tools present: `emcc` yes; `rnx2rtkp`/`convbin`/georinex absent.

## §1 — Local raw-data inventory (read-only, hashed, never committed)

`~/Downloads/webnet-gnss-12e/trimble/` SHA256SUMS:
`0b545698…62b659a6 processing-gnss-baselines.zip`,
`66263ffa…cb9edfe8c adjusting-the-network.zip`.

### ProcessingGNSSBaselines/Processing GNSS Baselines (66 entries)

| File(s) | Class | Size (B) | sha256 (evidence files) |
| --- | --- | --- | --- |
| `p0411650.06o`, `_0.06o`, `_1.06o`, `_2.06o` | A (RINEX 2.10 GPS obs) | 777412 each | `ff6ad074…e66cb` (.06o) |
| `p0411650.06n`, `_0.06n`, `_1.06n`, `_2.06n` | B (RINEX 2.10 GPS nav) | 229839 each | `21f67cc6…47ab45` (.06n) |
| `igs13793*.sp3`, `igs13794*.sp3` (8 files) | C (IGS final SP3) | 229922 each | — |
| `igl13793*.sp3`, `igl13794*.sp3` (8 files) | C (IGL rapid SP3) | 98114 each | — |
| `0124165*.dat` (6), `1515*.T01` (5) + `1515*a.dat` (5), `8034*.T01` (5) + `8034*a.dat` (5), `8991*.T01` (5) + `8991*a.dat` (5) | D (Trimble proprietary) | 40 KB–1.9 MB | — |
| `Processing GNSS Baselines.pdf`, `.vce` | E / D | 948028 / 361472 | — |
| `B 412 ds.txt`, `p041.ds` | E (NGS datasheets) | 3502 / 3175 | `e6969f0d…919`, `f19d3a2b…80b8e9` |

### Adjusting-the-network tree

All proprietary/report-only: `Adjusting the Network.pdf` (E),
`Adjusting the Network.vce` (D), `53frey.jxl` + `Data/53frey.jxl` (D),
`TutorialGlobalFeatures.fxl` (D), `InternalData/6c8efa…` opaque (D),
`ThumbNail.png` (E). No RINEX, no SP3. Not usable for raw processing.

### P041 RINEX header facts (all four .06o identical)

RINEX 2.10 GPS obs; marker `P041`; receiver `TRIMBLE NETRS 1.1-2`
s/n 4408231935; antenna `TRM29659.00 SCIT` s/n 0220321767; approx XYZ
`-1283634.1259 -4726427.8882 4074798.0251`; antenna delta H/E/N
`0.0083/0/0`; obs types `L1 L2 C1 P2 P1 S1 S2`; interval 30 s; GPS time;
first obs `2006-06-14 14:00:00`, window end comment `20:00:00 GPS`
(header created by teqc from UNAVCO CORS archive; monument P041,
39.949492/-105.194266/1728.8334). Nav `.06n`: RINEX 2.10 GPS nav,
broadcast ephemeris + iono/UTC + 14 leap seconds. SP3 `igl13793.sp3`:
rapid product, `IGb00` label, GPS week 1379, 900 s spacing.

Supporting text: `B 412 ds.txt` = NGS PID KK1435 (Jefferson Co., CO);
`p041.ds` = Marshall Field CORS ARP, CORS ID P041, NAD83(CORS) epoch
2002.00, XYZ `-1283633.478 -4726429.194 4074798.085`, ell. h 1729.708.

## §2 — Raw → TBC vector traceability

Parser: `parseTbcBaselineProcessingReport` (zero-dep string scans;
handles `<font>Δ</font>` split markup and `(Meter²)` sup pollution;
tolerant nulls, never throws). /tmp runner over 57 local HTMLs:
51 session reports parsed 51/51 (`10ff13a4.1.html` duplicates B16 →
50 unique solution IDs), 2 summaries + 2 TOC + 2 stubs excluded.

| Metric | Result |
| --- | --- |
| Unique station pairs | 31 (7 P041→\* + 24 rover↔rover) |
| Solution types | Fixed 51/51, Float 0 |
| P041 sessions | 20 (S32/S36/S34→sixtwo, S44/S41/S38/S40→hanna, S46/S43→fsi, S33/S49/S35→frey, S45/S47→filter, S31/S48/S39/S42→5, S37/S50→3) |
| P041 sessions inside RINEX window 14:00–20:00 GPS | 20/20 (earliest start 2:57:30 PM, latest stop 7:01 PM) |
| Covariance available | 51/51 (aposteriori lower triangle) |
| Durations / processing interval | 21–52 min, all 30 s |

Classification per session:

- `p0411650*.06o/.06n` → Dataset B station **P041**: PROVEN (header
  marker explicitly P041; corroborated by CORS datasheet coordinates).
- `0124*/1515*/8034*/8991*` file prefixes → rover stations: STRONG
  per-report/session only (TBC occupation records associate files with
  named marks session-by-session; the same receiver prefix recurs across
  sessions, so a prefix is NOT a stable station identity). Prefix-alone
  mapping: UNKNOWN. No session identity inferred from pair alone.
- Full per-session evidence table (session/solution IDs, pairs, windows,
  vectors, covariance flag, sats where reported) is reproducible at any
  time via the committed parser + local intake; only the 3-spot GVX
  cross-check below is pinned in-report to avoid transcribing 50 rows of
  vendor data into the repo.

## §3 — Input formats

- A (standard RINEX obs): exactly one station — P041 (see §1). No rover
  open RINEX exists. **No usable RINEX pair.**
- B (standard RINEX nav): P041 nav only (same window). Sufficient for the
  P041 side; a rover nav is not strictly needed (shared sky) but rover
  obs is mandatory and absent.
- C (other open): IGS/IGL SP3 precise orbits (weeks 1379/13794 splits).
- D (Trimble proprietary): all rover receiver files (`.T01`/`.dat`) plus
  `.vce`/`.jxl`/`.fxl` projects. No official/tutorial RINEX export of the
  rover data ships with the material.
- E (report/metadata only): PDFs, 57 TBC HTMLs, datasheets, PNGs, XLSXs.
- RTKLIB `convbin` does not ingest Trimble `.T01`/`.dat` (supported
  inputs are RINEX/RTCM/Novatel/u-blox/etc.); conversion requires
  Trimble's own utility. Proprietary decoding is excluded from the MVP.

## §4 — Product boundary

Raw processing outputs the existing canonical observation, not a parallel
network model. Proposed processing result (conceptual; field names final
in 12J.1):

```ts
RawGnssBaselineSolution {
  from; to; deltaX; deltaY; deltaZ;
  covariance { xx; xy; xz; yy; yz; zz };
  session { start; end; durationSec };
  solution { status: 'FIXED'|'FLOAT'|'FAILED';
             ambiguityStatus; ratio?; satellitesUsed; constellations };
  referenceFrame; epoch; processingOptions; orbitProductProvenance;
  antennaMetadata; diagnostics;
}
// adapter: RawGnssBaselineSolution → GnssBaselineObservation
// (src/engine/gnssBaselineTypes.ts: type/id/from/to/vector/covariance/
//  rawCovariance?/frame/referenceFrame?/epoch?/ellipsoid?/sessionId?/
//  solutionId?/sourceLine?/sourceFile?)
```

Downstream adjustment formulas never learn how the vector was produced.
Proven to terminate at the contract by §23 (test-local adapter, no engine
edits).

## §5 — MVP scope

IN: static relative positioning; two receivers; one session at a time;
ECEF baseline output; code + carrier; dual-frequency where available;
GPS first; user-supplied broadcast nav; deterministic offline; full 3x3
covariance; FLOAT and FIXED statuses. OUT (deferred): PPP/PPP-AR, RTK/
NTRIP/real-time/kinematic/network-RTK, proprietary decoding, automatic
product downloads, precise-product fetching, deformation series.
Multi-GNSS: widening phase, NOT MVP — MVP is GPS L1/L2 because (a) the
only open evidence is GPS-only RINEX 2.10, (b) GLO HW-bias handling
(`glomodear`) and BDS modes are extra validation surface, (c) TBC
evidence sessions are GPS-era. Galileo/BeiDou/GLONASS enable per
constellation behind the same contract after GPS parity is shown.

## §6 — RTKLIB audit (inspected 2026-09-13; sources in §6 table)

| Item | Fact |
| --- | --- |
| Upstream | tomojitakasu/RTKLIB HEAD `71db0ffa` 2018-01-30 — STALE |
| Reference fork | **rtklibexplorer/RTKLIB `v2.5.1`** (`62d4677`, 2026-08-31, ACTIVE) |
| Modern rewrite (watch) | h-shiono/MRTKLIB (C11/CMake, RINEX 4.00 CNAV, BSD-2-Clause) |
| License | **BSD 2-clause + 2 extra clauses** (pre-2.4.2 was GPLv3 — never source old trees). Modify + ship compiled WASM allowed with notices/disclaimer reproduced (interpretation, not legal advice) |
| Route | `rnx2rtkp.c` → `postpos()` → EKF `rtkpos()`; `PMODE_STATIC=3`; states (r,v,B1,B2,B5)+ZTD/grad/iono; fwd/bwd/combined |
| RINEX | 2.10–2.12 + 3.00–3.02 obs/nav (+3.02 CLK); GPS/GLO/GAL/QZS/BDS/SBAS. **No RINEX 4.x upstream** |
| AR | `lambda.c` (LD + reduction + MLAMBDA), ratio test default 3.0 (`-v`; demo5 adds min/nom/max gates + lock-count/hold/sat-count guards); `.pos` Q-flag 1=FIX 2=FLOAT; fix-and-hold feeds back N̂ pseudo-measurement |
| Covariance | `sol.qr[6]` formal filter covariance; FIXED = post-update (tighter). Scaling beyond a-priori model: UNCONFIRMED |
| Cycle slip | LLI flags, GF jump `slipthres` 0.05 m, Doppler-vs-phase (default off), sat status counters. MW: UNCONFIRMED |
| Atmosphere | Iono Klobuchar/SBAS/IFLC/EST/IONEX; trop Saastamoinen/EST/ESTG (NMF default) |
| Antenna | ANTEX 1.4 + NGS PCV, header auto-type, ARP deltas |
| Products | SP3-c + RINEX CLK + IONEX + SSR; `sateph` brdc/precise/combos; downloader exists (unused offline) |
| WASM port known | None found (guessed `mmomtchev/rtklib-wasm` 404s) |
| Determinism statement | None found; no RNG in AR/solver path (UNCONFIRMED bit-identical) |

## §7 — Architecture comparison

| Criterion | A: RTKLIB core → WASM | B: WebNet RINEX parser + RTKLIB numerics | C: own C++ processor | D: external helper → processed vectors |
| --- | --- | --- | --- | --- |
| Correctness risk | Lowest (proven parser+solver stay together; CLI≡WASM oracle) | High (TS↔C obs/eph interface is new surface) | Highest (years of model work) | Low per-vector, but pipeline outside WebNet |
| Maintenance | Track one fork | Fork + own parser | Own everything | Helper versioning/provenance burden |
| Browser compat | MEMFS preload + no-pthread path (§28 ✅) | Same WASM + TS parse | Same WASM, more code | Trivial (already today's model) |
| Bundle | lib subset ~100s KB–low MB (measured in 12J.1) | Smaller WASM, bigger TS | Largest new code | Zero |
| Covariance/AR/multi-GNSS | Free (LAMBDA+ratio, 5 constellations) | Free in core, interface risk | Must build all | Whatever helper provides |
| Oracle quality | Bit-compare CLI vs WASM on same files | CLI still oracle for core | No oracle | TBC only |
| License | BSD, WASM shippable with notices | Same | Clean-room cost | Depends on helper |
| Determinism | Same-code determinism testable | Interface must preserve it | Design burden | Opaque |
| Extensibility | Fork features flow (demo5 gates) | Split ownership forever | Full control, full cost | None in-browser |

Speed-only choice rejected. Decision: §37.

## §8 — RINEX parser requirements (bounded contract, not "all RINEX")

MVP contract: **RINEX 2.10/2.11 GPS obs + 2.10 GPS nav**, 30 s/15 s/5 s
sampling, GPS time. Required obs-header fields: marker, receiver,
antenna type + delta H/E/N, approx XYZ, `TIME OF FIRST OBS`, interval,
`# / TYPES OF OBSERV` (L1/L2/C1/P1/P2 minimum), leap-second knowledge
via nav. Per-epoch: SV observations + LLI + SNR-mapped signal strength;
event flags honored (gap/slip markers fail toward QC, never silent).
Nav: full ephemeris sets + iono/UTC + health. RINEX 3.x (and 4.x via
MRTKLIB watch-list) are widening phases with per-version acceptance —
never assumed. RINEX-4 explicitly out of MVP (unsupported upstream).

## §9 — File size / browser feasibility

Base measured: 777412 B / 6 h / 30 s single-station L1+L2 ⇒ ~1080 B/epoch;
nav ~230 KB/day fixed. Pair+nav ≈ 2×obs + 230 KB:

| Session | 30 s | 15 s | 5 s | 1 s |
| --- | --- | --- | --- | --- |
| 15 min | 295 KB | 360 KB | 619 KB | 2.1 MB |
| 30 min | 360 KB | 489 KB | 1.0 MB | 4.1 MB |
| 1 h | 489 KB | 748 KB | 1.8 MB | 8.0 MB |
| 2 h | 748 KB | 1.3 MB | 3.3 MB | 15.8 MB |
| 8 h | 2.3 MB | 4.4 MB | 12.7 MB | 62 MB |

Parsed-observation memory (2 h, 15 s, 10 sats, dual-freq): 480×10×2 =
9600 channel-states × ~150 B ≈ **1.4 MB**; even 5× JS-object overhead
(~7 MB) is negligible in a worker heap. Keep parsed observations as
plain objects; reserve typed arrays for normal-matrix/Qxx numerics.
No streaming parser required for MVP sizes; cap + fail-closed oversize
gate still required (§33/§35). 1 s sampling of 8 h sessions (62 MB) is
the documented non-goal for in-browser MVP.

## §10 — Processing pipeline (audited, not implemented)

RINEX ingest → time normalization (GPS) → base/rover epoch sync →
ephemeris selection (broadcast, user-supplied) → SV position/clock
→ Earth-rotation correction → geometric range → elevation/azimuth →
health/elevation masks → code preprocessing → carrier preprocessing →
cycle-slip handling (§13) → iono treatment (short-baseline DD cancel;
EST states only if long-baseline widening) → trop model (Saastamoinen/
EST) → clock elimination by differencing (§11) → ambiguity states →
float baseline → integer AR + validation (§12) → vector → covariance
(§22). Each stage's options hash into provenance (§24).

## §11 — Differencing model (MVP)

Double-difference GPS L1/L2 (RTKLIB `rtkpos` static mode): satellite-differenced
then receiver-differenced observations cancel SV + receiver clocks.
State vector: baseline XYZ + DD ambiguities (B1/B2) + optional ZTD.
Reference-satellite policy: highest-elevation per constellation/epoch
(RTKLIB default; recorded, not tuned). Ambiguities: per-sat/per-band
float states, fixed candidates via LAMBDA. Weighting: elevation-dependent
+ SNR variance (demo5 refsat tightening is a later tuning input, not MVP).
Constellation clocks: N/A for GPS-only MVP (inter-system bias states
arrive with multi-GNSS widening). Downstream 3-vector adjustment is
independent of all of this by construction (§4).

## §12 — Ambiguity resolution

LAMBDA ILS + ratio validation (threshold 3.0 default; demo5 min/nom/max
gates as later tuning). Output statuses: FLOAT / FIXED / FAILED (FAILED =
no-fix or validation reject — never a silent float relabel). Record per
solution: ratio statistic, # ambiguities, # satellites, fixed epochs span.
TBC evidence is Fixed 51/51, so the first parity target is FIXED-path
agreement; FLOAT-path behavior needs sessions TBC solved float — none in
this material (gap noted for 12J.1 data acquisition).

## §13 — Cycle slips / data QC

LLI flags, geometry-free jump detection (`slipthres` 0.05 m), Doppler
cross-check (off by default — assess in 12J.1), gap handling, receiver
clock-jump handling in preprocessing, short-arc deweighting, elevation
mask, outlier rejection counters. All exposures surface as per-solution
diagnostics (slips count, rejected epochs, low-elev exclusions); nothing
is silently dropped — the QC gate (§34) consumes these counts.

## §14 — Orbit products

MVP is offline/deterministic: user-supplied obs RINEX + broadcast nav
RINEX, no fetch. Precise SP3/CLK (IGS/IGL, both present locally) are a
later extension with product-hash provenance; TBC used Precise ephemeris
(§2 reports), so broadcast-vs-precise delta is a KNOWN open comparison
for 12J.1 — broadcast-only is not yet proven acceptable, only architected.

## §15 — Antenna modeling

Raw-side corrections (ARP/marker semantics, RINEX delta H/E/N, model
name, phase-center via ANTEX where configured) shape the solution vector
itself. Phase12E.3 setup sigmas model stochastic centering/height
uncertainty AFTERWARD in the adjustment. The adapter applies each exactly
once: raw corrections live inside `antennaMetadata` + processing options;
setup sigmas remain opt-in at adjustment. P041 evidence: RINEX delta
0.0083 m H vs CORS ARP — the 8.3 mm must be consumed by the raw stage,
never re-added downstream.

## §16 — Output reference frame (HARD question — resolved as design)

Broadcast-era solution frame ≈ WGS84(G1150)/IGb00-class (2006); precise
products in IGS/IGb00. TBC project frame: NAD 1983 (Conus) (State Plane
CO North, GEOID03, global ref WGS84). The CORS datasheet gives P041 in
NAD83(CORS) epoch 2002.00. Therefore: NEVER label a raw RTKLIB ECEF
vector NAD83(2011)/NAD83(Conus) by inheritance. The raw solution carries
its own `referenceFrame` + `epoch`; frame alignment to the project frame
happens in the adapter/session stage, before the adjustment contract.

## §17 — Vector frame transformation (evidence-only design)

For `X_target = f(X_source, epoch)`: `ΔX_target = f(X_B) − f(X_A)` via
endpoint coordinates (equivalently the transformation Jacobian at the
baseline midpoint for small baselines); covariance `C_target = J C Jᵀ`.
Existing WebNet geodesy (`geodesyEcef`, `geodesyDatum`, `geodesyProjection`,
`adjustGpsVectorHelpers:128`) resolves CRS/datum ops and rotates
covariances, but the GNSS preflight currently requires matching frame
metadata and performs NO datum transform. Reusable pieces exist; the
baseline-vector path is new work scoped to the 12J.1 adapter. No
production transform added here.

## §18 — TBC frame parity

TBC reports: project NAD 1983 (Conus), global WGS84; ephemeris Precise.
A broadcast-frame raw candidate will carry a systematic frame offset vs
TBC until transformed — report RAW-PROCESSOR-FRAME RESULT and
PROJECT-FRAME-COMPATIBLE RESULT separately, never bury the offset in
processing error. TBC↔GVX cross-check (§20) is frame-consistent by
construction (both TBC products); candidate↔TBC awaits the RINEX pair.

## §19 — Oracle processing run: BLOCKED (proven, not skipped)

No usable RINEX pair exists: the sole open obs file is single-station
P041; all rover receiver files are Trimble proprietary (§3); `rnx2rtkp`
is not installed and building it cannot help without rover obs. The
TBC↔GVX cross-check (§20) is the strongest runnable comparison with this
material. 12J.1 gate: acquire a two-receiver open RINEX pair (CORS pair
re-occupation, or Trimble-converted `.T01`→RINEX via the official
utility with conversion provenance) before any parity claim.

## §20 — Vector comparison (TBC report ↔ intake GVX, ≤1 mm display)

| TBC session | GVX id | \|dDX\| | \|dDY\| | \|dDZ\| | Verdict |
| --- | --- | --- | --- | --- | --- |
| B32 P041→sixtwo (292d3b4c.7) | id 35, PV32 | 0.16 mm | 0.45 mm | 0.33 mm | ✅ |
| B16 sixtwo→hanna (292d3b4c.1) | id 9, PV16 | 0.01 mm | 0.24 mm | 0.30 mm | ✅ |
| B44 P041→hanna (292d3b4c.10) | id 50, PV44 | 0.13 mm | 0.03 mm | 0.12 mm | ✅ |

Sample solution: B32 P041→sixtwo, S32, 2006-06-14 17:24:30–18:10:30 GPS,
Fixed, Dual Frequency, 30 s, Precise ephemeris, NGS Absolute antenna,
Δ = (5822.646, −5654.885, −4846.085) m, H/V precision 0.007/0.024 m.
Deltas are HTML display-rounding to 1 mm — reports and GVX are mutually
consistent. Candidate↔TBC metrics (dΔX/dΔY/dΔZ, 3D, length, orientation;
FLOAT vs FIXED split) are defined and waiting on the RINEX pair. No
arbitrary "match TBC to 0.1 mm" gate is set — measure first (§20 rule).

## §21 — Covariance comparison

TBC B32 aposteriori covariance (m²): XX 0.0000247718, XY 0.0000655581,
XZ −0.0000531839, YY 0.0003463746, YZ −0.0002570615, ZZ 0.0002267204 —
full correlations preserved end to end (report → GVX → §23 injection).
Derived σ: X 4.98 mm, Y 18.6 mm, Z 15.1 mm; det > 0 (SPD proven in test).
Candidate↔TBC matrix comparison (σ, correlations, eigenvalues/principal
directions, trace/determinant) is defined and blocked on the same gate
as §20. Diagonalization for convenience is forbidden — the downstream
contract consumes the full 3x3.

## §22 — Covariance semantics

- TBC aposteriori covariance: post-adjustment formal covariance of the
  FIXED baseline solution as serialized in GVX; units m²; base coordinate
  treated as known within the session; atmospheric process noise folded
  into the session solution, not exposed per-component.
- RTKLIB candidate: `sol.qr[6]` formal filter covariance; FIXED value is
  the post-update (tighter) covariance, not re-estimated from fixed
  residuals; whether residual-variance scaling applies beyond the
  a-priori model is UNCONFIRMED from audited docs — 12J.1 must read it
  off the pinned source (`rtkpos.c` + manual App.E.6) before trusting a
  FIXED covariance downstream, and must state per solution whether the
  shipped C is float-formal, fixed-post-update, or scaled.
- Antenna uncertainty is NOT inside either covariance (setup sigmas stay
  downstream, §15). Units must be asserted m² at the adapter boundary.

## §23 — Downstream injection: PROVEN

`tests/gnssBaseline/gnssRawBaselineInjection.test.ts` (synthetic literals
only, CI-safe): TBC B32 vector + covariance → in-memory
`GnssBaselineObservation` (frame `ecef`, sessionId S32, solutionId B32,
sourceFile) → production `runGnssBaselineAdjustment` with P041 fixed:
converges, dof=3, residuals key by baselineId with provenance intact,
statistics length 3. No engine edits; adapter lives in the test. The
architecture terminates cleanly at the current contract.

## §24 — Provenance contract (minimum)

Observation file hashes + nav/product hashes + processor identity/version
(`rtklibexplorer vX.Y.Z` + commit) + processing-options hash + start/end
+ constellations/signals + solution status + reference frame + epoch/time
system + antenna metadata + processing warnings/diagnostic counts. Raw
observations are referenced by hash, never embedded in baseline objects.

## §25 — Multiple baselines / network workflow

Sessions solve independently (A–B, A–C, B–C each → vector + covariance);
the EXISTING multifile/static-GNSS stack composes them into the network
adjustment. No second network adjustment inside the raw processor — the
boundary is strict: raw = session solution, WebNet = network adjustment.
The 20 P041 sessions + 31 rover pairs in §2 already have exactly this
shape (one TBC solution each, network assembled downstream in Dataset B).

## §26 — Two-receiver use case: VALIDATED by design

Relative static processing needs simultaneous obs (base + rover) +
orbit/clock products + approximate positions + adequate quality — NOT a
third CORS station. The tutorial itself is P041 + rover-tip sessions;
external control is a separate datum/reference-frame workflow (§16),
never a processing prerequisite.

## §27 — CORS/CACS extension seam (design only)

Future: user rover RINEX + known CORS RINEX (same window) → baseline via
the identical session path; station/product retrieval helpers later. No
downloads implemented or required; CORS never mandatory for two-receiver
work (§26).

## §28 — WASM feasibility probe: FEASIBLE-BUT-NONTRIVIAL

- `/tmp/rtklib-evidence` clone of `v2.5.1` (`62d4677`): ok.
- `emcc -c src/lambda.c -I src` → exit 0 (`lambda.o` 7541 B): the
  numerical core compiles under Emscripten untouched.
- pthread/socket/fopen in postpos path: `postpos.c 0/0/16`, `rtkpos.c
  0/0/2`, `rinex.c 0/2/125`, `ephemeris.c 0/0/0`, `preceph.c 0/0/8`,
  `lambda.c 0/0/2`, `solution.c 0/0/8`. pthread/socket live only in
  `rtksvr.c`/`stream.c` (unused by post-processing). No threading port
  needed; file I/O goes through the standard Emscripten FS layer
  (MEMFS preload or IDBFS); `rinex.c`'s 125 fopen sites are the porting
  surface to smoke-test, not a blocker.
- rnx2rtkp-equivalent module set: `rnx2rtkp.c postpos.c rtkpos.c rinex.c
  ephemeris.c preceph.c lambda.c solution.c rtkcmn.c`. Open work for
  12J.1: full link + JS bindings + CLI-vs-WASM bitwise comparison +
  bundle measurement. No production worker-protocol change here (§29
  message flow only proposed: `gnss-raw-process {obs, nav, options} →
  progress/diagnostics → processed baseline result`).

## §§29–30 — Worker architecture / cancellation / progress

Raw processing stays off the main thread (existing worker pattern).
Cancellation checkpoints: parse, epoch preprocessing, iterative solution,
ambiguity search, final covariance. Progress phases (named, not percent):
ingest → preprocess → float → AR → covariance → done — exact percent
promised only where the kernel reports it reliably.

## §31 — Determinism: UNPROVEN, required by design

Contract: identical files + products + processor version + options ⇒
repeatable output (vector/covariance/status/diagnostic ordering). No
oracle binary exists to repeat (§19), so no variation numbers are
claimed. 12J.1 must run each parity session twice (CLI and WASM) and
record variation before any production wiring.

## §32 — Performance

No runs possible (§19). Expectation (UNCONFIRMED): desktop RTKLIB static
post-processing of 15 min–2 h sessions is seconds-scale; browser-worker
overhead + MEMFS I/O measured in 12J.1. Production target stands:
ordinary 15 min–2 h survey sessions practical in a worker; no hard limit
until measured. Evidence tiers: any stress/soak campaign belongs in
`tests/evidence/` per repo rules, never agent tier.

## §33 — Corrupt/incomplete inputs (fail-closed, all required)

Malformed RINEX, no epoch overlap, missing nav, insufficient sats,
unsupported signals, bad antenna metadata, large gaps, all-ambiguities-
unresolved, nonfinite/invalid covariance, unknown frame — every one must
produce FAILED + diagnostics, never a baseline. "Solver returned some
coordinates" is not a solution.

## §34 — Quality gate

Result states derived from solver evidence: `ACCEPTED_FIXED`,
`ACCEPTED_FLOAT`, `LOW_QUALITY`, `FAILED`. The network adjustment must
refuse to silently consume FAILED/LOW_QUALITY — the operator always sees
fixed/float/failed provenance per baseline.

## §35 — Browser security

RINEX/nav are untrusted input: parser bounds, huge-file gate (§9 cap),
malformed numerics, line-length limits, no path traversal via virtual-FS
names, no archives auto-expanded, WASM memory-failure containment, no
shell/process execution in production. (B) parser-first designs get an
extra trust boundary; (A) keeps the battle-tested C parser behind the
FS gate — a point for A in §37.

## §36 — Licensing

rtklibexplorer/RTKLIB inherits BSD 2-clause + 2 extra clauses: retain
copyright/conditions/disclaimer in source AND reproduce in binary docs;
bundled companion binaries keep original licenses. WebNet may modify +
ship compiled WASM (commercial OK) with attribution surfaced in-app/docs
+ version string in provenance (§24). No third-party code merged here;
exact license text + attribution placement are 12J.1 acceptance items.

## §37 — Architecture decision

**GO-RAW-MVP-RTKLIB-WASM** — RTKLIB processing core (pinned fork) compiled
to WASM, RINEX in / solution out, full 3x3 covariance + FLOAT/FIXED status.

Basis: only open evidence is GPS RINEX 2.10 (§1); no RINEX pair exists so
no processor can be validated yet — the decision rests on feasibility,
not parity. (A) wins on correctness risk (parser+solver proven together,
CLI≡WASM oracle possible), oracle quality, covariance/AR for free,
license, and the probe (§28: core compiles, no pthread in path). (B)
loses on the TS↔C interface risk + weaker trust boundary. (C) is
multi-year model work for zero evidence gain. (D) keeps raw processing
outside the browser and concedes determinism/provenance control.

Gates (non-negotiable for 12J.1): acquire a validated two-receiver open
RINEX pair first (§19); CLI-vs-WASM bitwise comparison before any
production wiring; FIXED-covariance semantics read off source (§22);
frame alignment in the adapter (§16); fallback to HYBRID only if the
`rinex.c` FS surface proves painful in the 12J.1 spike.

## §38 — Recommended Phase 12J.1 scope

Input: RINEX 2.10/2.11 GPS obs pair + matching broadcast nav, static
session, GPS L1/L2. Output: ECEF ΔX/ΔY/ΔZ + full covariance +
FLOAT/FIXED/FAILED + QC/provenance + existing gnssBaseline adapter
(frame-aligned, §16–17). Deferred: multi-GNSS, RINEX 3.x/4.x, precise
products, PPP/RTK/kinematic, proprietary decoding, downloads, CORS
automation, production worker wiring (spike only), any adjustment-math
change. Acceptance: RINEX-pair parity vs TBC-style reference (vector +
covariance + determinism repeat), license attribution placed, adapter
behind an explicit evidence-only gate.

## §39 — Report

This file. Local source inventory §1, mapping §2, formats §3, RTKLIB §6,
comparison §7, model §§10–13, frames §§16–18, parity §§20–21, WASM §28,
perf §32, licensing §36, MVP §38.

## §40 — Acceptance

A inventory ✅ complete (§1, hashed). B usable RINEX known ✅ (one
station only — negative result, §3). C traceability classified ✅ (§2).
D output contract defined ✅ (§4). E pipeline understood ✅ (§10). F
reference processor identified ✅ (rtklibexplorer v2.5.1, §6). G oracle
session processed ❌ BLOCKED w/ proof (§19; material permits none). H
vector comparison PARTIAL (TBC↔GVX ✅ §20; candidate↔TBC blocked §19).
I covariance PARTIAL (TBC SPD ✅ §21; candidate semantics half-open
§22). J frame/epoch understood ✅ (§§16–18). K injection proven ✅
(§23, 2/2). L WASM assessed ✅ (§28). M licensing ✅ (§36). N
determinism PARTIAL (contract set, runs blocked §31). O failure/QC ✅
(§§33–34). P MVP selected ✅ (§37). Q production unchanged ✅ (§0: no tracked `src/` diffs; only TODO.md + the 2 new evidence files modified/added by this batch, plus pre-existing untracked phase9l noise, uncommitted and unchanged).
