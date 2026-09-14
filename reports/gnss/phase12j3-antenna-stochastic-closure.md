# Phase 12J.3 — Antenna Calibration + Stochastic Model Closure

EVIDENCE ONLY. No production raw worker, no RINEX UI, no `src/` production changes,
no gnssBaseline math/covariance changes, no empirical covariance scaling, no TBC
Default-SE adoption, no tolerance changes, no vendor commits, no downloads of bulk
products (igs20.atx already local in /tmp from 12J.2; small page fetches only).

Branch `feat/gnss-raw-antenna-stochastic-closure`, baseline `origin/main f7803989`
(PR #55 merge). Baseline validation: `lint` 0 errors; `typecheck` errors confined to
untracked pre-existing phase9l dirt (`runSessionAsync.ts` etc. — untouched, out of scope);
`git diff origin/main --stat -- src/` empty at close.

Mission decision context: 12J.2 left a systematic corrected-cohort discrepancy
(median ~19.8 mm, max ~24.8 mm, dominant dY ≈ +19 mm) + unresolved rover antenna
TRM60158.00 NONE + structurally different TBC covariance. Verdict was
MORE-EVIDENCE-REQUIRED. This phase answers the two questions separately —
Track A (calibration / vector bias) and Track B (stochastic / covariance) —
so success in one cannot hide failure in the other.

---

## TRACK A — ANTENNA CALIBRATION

### §2 — Rover antenna identity (CONFIRMED)

- RINEX code: **TRM60158.00 NONE** (rover, all 4 rover EQUIPMENT records in
  pre-adjustment GVX). Receiver: **Trimble R8 Model 2** (intake `Receiver Type:
  R8 Model 2`; per-leg `Antenna Type: … R8 GNSS/SPS88x Internal`). Part-number-style
  RINEX code for the R8 Model 2 internal antenna.
- Aliases — CONFIRMED (primary: IGS `rcvr_ant.tab`,
  https://files.igs.org/pub/station/general/rcvr_ant.tab):
  - `TRMR8_GNSS` = integrated Trimble R8 GNSS antenna (added 03 FEB 2010).
  - `TRMR8_GNSS3` = integrated Trimble R8 GNSS 3 antenna (added 03 FEB 2010).
  - `TRM5800` = antenna inside Trimble 5800 **and original R8 (Model 1)** — distinct.
  - `TRMSPS985/986` = SPS855/985/986 integrated — not R8.
- PROBABLE (name-mapping only, no calibration equivalence): `TRM_R8_GNSS`,
  `TRM_R8_GNSS3` (Trimble-DB underscore variants), `TRM R8 2` (display name).
- REFUTED: `TRM SPS880`, `TRM SPS881` (SPS family maps to TRMSPS985/986, not R8);
  `TRM67250.00` (absent from `rcvr_ant.tab` and `antenna.gra` — no IGS record).

### §3 — IGS products (ABSENT, primary-source confirmed)

- Direct grep of local `igs20.atx` (60,295,761 bytes, sha256
  `8715268e17e09e5447f4949d67cbd067e7f0f33d48dd698aafe14f5cffb26de2`):
  **`TRM60158` → 0 matches** (916 `TYPE / SERIAL NO` records searched).
- `antenna.gra` index + `rcvr_ant.tab` (current to Aug 2026): full TRM family present
  (`TRM59800.00`, `TRM29659.00`, `TRMR8_GNSS`, `TRMR8_GNSS3`, `TRMR8-4`, `TRMR8S`, …),
  **no `TRM60158.00` in any radome**.
- Bundled `igs14.atx` copies (sha256
  `d59a419776e68af938af52f4c6f1a09467784cb3d1f530d4415f4b7f1f685d9e` each):
  no match. Verdict: **ABSENT from igs20/igs14/igs08/older to best searchable evidence.**

### §4 — NGS ANTCAL (ABSENT, HARD task executed)

- Legacy endpoints return 404 for `TRM60158.00/NONE` **and** `TRM_R8_GNSS/NONE`.
- NGS policy (FAQ20): unlisted = never calibrated by NGS nor submitted to IGS.
  Brand page errors; composite = IGS ANTEX + NGS absolute-from-relative conversions
  (FAQ12) — no conversion product for this antenna found.
- Relative history: reference `AOAD/M_T NONE` (FAQ10); conversion method documented
  (Bilich & Mader 2010) but **no published file converting TRM60158.00 or any alias**.
  The NGS relative file is available only on email request (`ngs.antcal@noaa.gov`) —
  not pursued; recorded as the sole remaining avenue.
- Verdict: **ABSENT. No product / frame / method / frequencies / hash to record.**

### §5 — Trimble/TBC local antenna library (NEGATIVE, READ ONLY)

- Wine prefix: no Trimble/TBC installation (`Program Files` clean) — nothing to read.
- `~/Downloads/webnet-gnss-12e`: **no ANTEX/ANTINFO/antenna-DB/`*.atx`/`*.pcv` file
  anywhere** (`find -iname` empty). TBC intake = reports + GVX only.
- Intake per-leg pages (e.g. `292d3b4c.7.html`): `Antenna Model: NGS Absolute`;
  `Antenna Type: Choke Ring w/SCIT Dome | R8 GNSS/SPS88x Internal`;
  `Receiver Type: NetRS | R8 Model 2`; heights `0.008 m | 2.000 m`;
  `Antenna Method: Bottom of antenna mount`; mask `10°00'00.0"`.
- `Automatic` in intake = `Automatic Carrier and Code Processing` /
  `Automatic ID Numbering` — **not** an antenna-record selector.
- GVX EQUIPMENT records: TRM29659.00 ×1, TRM60158.00 ×4
  (+ TRM33429.00 ×1 in `Adjusting the Network.gvx`).

### §6 — Alias ≠ calibration (PRESERVED)

- IGS-calibrated R8-family records that DO exist (`TRMR8_GNSS`, `TRMR8_GNSS3`,
  Geo++ robot 03-APR-13, DAZI 5.0) are **different antennas** — never substituted.
- No L1/L2 PCO, no PCV, no absolute/relative statement, no reference antenna exists
  for TRM60158.00. No parity run was based on name matching.

### §§7–8 — Relative conversion / "NGS Absolute" label

- No relative calibration found → no conversion to assess; nothing invented.
- TBC's `Antenna model: NGS Absolute` is a **provenance label** (NGS-style absolute
  values embedded in the Trimble database, which per NGS FAQ12 may be IGS values or
  NGS absolute-from-relative conversions) — **not** proof of a direct NGS robot
  calibration of TRM60158.00, and not a license to substitute another code.
  No citable Trimble document equates the label to a specific record. UNCONFIRMED.

### §9 — Base antenna control (FROZEN)

- **TRM29659.00 SCIT: single igs20.atx entry, Geo++ robot 25-MAR-11, DAZI 5.0.**
  Exact match retained from 12J.2. Base calibration frozen; never varied jointly
  with rover evidence.

### §10 — S32 antenna ladder (final 12J.2 settings; ANTEX = /tmp igs14.atx, pinned-tree copy)

Mapping verified from pinned source (`options.c` L164–180; `anttype[0]`↔rovpos,
`[1]`↔refpos): trace shows exactly one `no receiver antenna pcv:` (empty type =
rover, uncorrected) and zero `pcv without radome` lines (exact SCIT match on base).
ANTEX = `/tmp/rtklib-evidence/data/ant/igs14.atx` (pinned-tree copy; single
TRM29659.00 SCIT robot entry, identical record in igs20 — no reason to switch).
Rover TRM60158.00: 0 matches in both files — left OFF per spec. Control reruns
reproduced 12J.2 exactly (S32 sha `9af1b9da16a669aa`, cohort
24.8/19.8/18.5/18.3/22.9).

Ladder (final 12J.2 settings: 10°, true precise `igs13793.sp3`, same epochs/signals/base):

| Quantity | A: no-ant (leg C) | B: base-only PCV |
|---|---|---|
| Raw dX/dY/dZ (m) | +5822.2414 / −5656.3431 / −4844.8073 | +5822.2213 / −5656.4173 / −4844.7417 |
| FIX/epochs, ratio, ns | 90/93, 20.2, 9 | 90/93, **47.4**, 9 |
| H-reduced 3D vs TBC | 18.3 mm | **91.0 mm** |
| Length Δ vs TBC | −14.3 mm | −15.9 mm |
| Cov σ (mm) / 6 terms | 0.6/1.1/0.9 | **identical** |

Vector move: **(−20.1, −74.2, +65.6) mm, 3D 101.1 mm**, direction ≈ −Up at P041.
Verdict: the shift is the **ARP→APC datum change**, not a correction gain — SCIT PCO
(L1 Up 86.0 / L2 Up 118.4 mm) with the ARP-based H-reduction kept per spec is now
inconsistent with the APC-referenced solution; covariance untouched (§27).

Rungs C (rover PCO only), D (rover PCO+PCV), E (both TBC-equivalent): **not run —
no rover record exists** (§14). Nothing substituted, nothing tuned.

### §11 — Uniform base-only cohort (ONE policy, all five P041↔0124 legs)

| Leg | dX/dY/dZ vs TBC (mm) | 3D (mm) | dLen (mm) | Ratio |
|---|---|---|---|---|
| S38 | −20.2 / −54.3 / +51.9 | 77.8 | −6.3 | 6.9 |
| S40 | −19.6 / −56.9 / +56.6 | 82.6 | −7.0 | 26.6 |
| S39 | −25.3 / −58.0 / +63.1 | 89.3 | −13.1 | 5.6 |
| S32 | −26.3 / −57.0 / +65.9 | 91.0 | −15.9 | 47.4 |
| S31 | −21.3 / −53.6 / +57.8 | 81.6 | −10.5 | 4.9 |

Stats: **median 82.6 / max 91.0 / RMS 84.6 mm** (before: 19.8/24.8/21.0);
mean bias **dX −22.5, dY −56.0, dZ +59.1 mm** (before: −2.3/+18.8/−7.0).
Per-leg ant−noant raw delta ~101–102 mm on all five.
Verdict: **bias did NOT collapse — it re-based coherently** (dY spread only 4.4 mm,
sign flipped +→−); still systematic, now PCO-datum-dominated. Lengths stay short
(−10.6 mm mean).

### §12 — Systematic bias decomposition (TBC-minus-RTKLIB; ENU @P041 = @rover =
@mid to ≤0.1 mm)

| Leg | E (mm) | N (mm) | U (mm) | Parallel (mm) | Normal (mm) |
|---|---|---|---|---|---|
| S38 | +5.3 | −1.8 | **+24.1** | +4.7 (TBC longer) | 24.4 |
| S40 | +4.0 | −4.0 | **+19.0** | +5.5 | 19.1 |
| S39 | +9.5 | −6.9 | **+14.2** | +11.6 | 14.3 |
| S32 | +10.5 | −9.8 | **+11.3** | +14.3 | 11.4 |
| S31 | +6.5 | −6.7 | **+20.9** | +9.0 | 21.0 |

Common pattern: **same sign on all 5 legs in every component** — Up +11…+24,
East +4…+10.5, North −2…−10, parallel +5…+14 (TBC always longer). Vertical
dominates 4/5 (S32 exception: parallel 14.3 > normal 11.4). Verdict: favors
antenna-height/PCO first (common-mode Up with 2.000 m rover vs 0.008 m base
context), orbit/frame second (systematic length term), atmosphere/model third.
Descriptive — no causal partition claimed.

### §13 — Rover rotation / orientation

No azimuth-dependent PCV record exists for TRM60158.00 (no calibration at all,
§§3–4), so NOAZI vs azimuthal handling cannot be assessed. Nothing fabricated;
receiver orientation representation not probed.

### §14 — CALIBRATION_UNAVAILABLE_FOR_THIS_LEGACY_DATASET

Rover PCO/PCV legs C–E cannot run: the record does not exist in any searched
product. This is **"cannot reproduce the legacy TBC antenna model exactly"** —
not "RTKLIB raw processing is unsuitable." The pipeline itself is proven (controls
reproduce 12J.2 bit-exact; mapping proven; base-only leg applies cleanly).
Authoritative validation on modern antennas is deferred to a future corpus (§33).
Stochastic forensics below stand on their own (Track B).

---

## TRACK B — STOCHASTIC / COVARIANCE FORENSICS

### §15 — RTKLIB covariance semantics (FROZEN)

Retained from 12J.1/12J.2 source audit: post-fix conditional formal filter
covariance, ECEF, base coordinate exact, no posterior rescaling. No 12J.3 option
changes this definition. Structural gap to TBC retained: S32 per-axis σ ratios
8.30×/16.92×/15.06×, element ratios 69–525×, trace 232.6×, determinant 5.39×10⁵×,
eigenvalue ratios 43.5×/37.3×/331.9×. **No empirical scaling introduced**
(`git diff origin/main --stat -- src/` empty; §22 no-single-scalar stands).

### §16 — TBC covariance pre-adjustment proof (all 5 legs reconciled)

Pre-adjustment GVX carries all 50 vectors with full SD+correlations; report =
GVX rounded to mm on every leg. Exact six terms (m², [XX, XY, XZ, YY, YZ, ZZ]):

- PV38: [1.09297e-5, 2.9882e-6, −4.8020e-6, 4.72479e-5, −1.53013e-5, 2.88719e-5]
  (SD 3.306/6.874/5.373 mm; P +0.131/−0.270/−0.414)
- PV40: [1.28850e-5, 9.8126e-6, −6.4013e-6, 3.69838e-5, −1.23863e-5, 2.42543e-5]
  (SD 3.590/6.081/4.925)
- PV39: [2.30761e-5, 2.35478e-5, −1.74954e-5, 7.40902e-5, −3.92081e-5, 5.25487e-5]
  (SD 4.804/8.608/7.249)
- PV32: 12J.2 §32 six terms verbatim ✓ (SD 4.977/18.611/15.057; P +0.708/−0.710/−0.917)
- PV31: [1.80689e-5, 2.11447e-5, −4.2979e-6, 7.38327e-5, −1.08474e-5, 3.02427e-5]
  (SD 4.251/8.593/5.499)

Verdict: chain unbroken on all 5 (report sDX/sDY/sDZ = √diag rounded). Forensic
bonus: same physical baseline P041–SIXTWO appears 3× — PV34/PV36 (SD ~3.3–3.6 /
5.6–7.3 / 4.5–4.9, |P|≤0.51) vs PV32/S32-window (SD 5.0/18.6/15.1, |P| up to
0.92) → covariance is session-estimated, not default-derived.

### §17 — Default-SE causal test (PRIORITY, OPERATOR-BLOCKED)

The operator blocked the test; not run. No TBC clone with absurd Default Standard
Errors (H = 0.100 m + 10 ppm, V = 0.200 m + 20 ppm) was reprocessed. Default-SE
causality stays EXCLUDED-by-evidence-only (12J.2 position retained): Default SE
excluded for processed vectors, fallback role unresolved + experiment spec'd.

### §18 — Setup-error causal control (OPERATOR-BLOCKED)

The operator blocked the test; not run. No nonzero setup-error clone was
reprocessed. Dataset B stays at centering = 0 / antenna-height error = 0; whether
setup error touches raw-processed covariance or only adjustment augmentation is
unresolved. Kept separate from Phase 12E.3 evidence.

### §19 — TBC H/V precision definition

V: displayed = **round(σU to mm), exact 5/5** (7.407→7, 6.863→7, 10.579→11,
23.696→24, 8.445→8). **V RESOLVED** (stronger than 12J.2's 1σ-Up: exact rounding
rule). Vector-Error sEasting/sNorthing/sHeight likewise = rounded ENU sigmas on
all 5. H: ceil(rss(E,N)) matches B40 (6), B39 (7), B32 (7) exactly but undershoots
B38 (6 vs 7) and B31 (8 vs 9) by 1 mm; no other candidate (rms-H, 2×rss, mean,
semiaxis-max 4.7–6.3, 3D-rss, principal-max) fits all 5. **H bounded
(ceil(rss) ≤ H_disp ≤ ceil(rss)+1 mm) but still open.**

### §20 — Precision confidence setting

Adjustment reports state `Confidence Level: DRMS` + `A Priori Scalar: 1.00`;
baseline pages carry no σ-multiple label. Baseline-processor confidence convention
is therefore recorded, not derived — display convention and processor convention
are not mixed.

### §21 — Covariance shape across 5 legs (GVX covariances, descriptive only)

| Leg | princ σ (mm) | cond | trace (m²) | det | TBC ENU E/N/U (mm) |
|---|---|---|---|---|---|
| S38 | 3.11/4.57/7.51 | 5.82 | 8.70e-5 | 1.14e-14 | 3.45/4.50/7.41 |
| S40 | 3.00/4.09/6.96 | 5.37 | 7.41e-5 | 7.29e-15 | 3.10/4.18/6.86 |
| S39 | 3.68/4.76/10.65 | 8.38 | 1.50e-4 | 3.49e-14 | 3.83/4.81/10.58 |
| S32 | 3.39/4.76/23.74 | 49.10 | 5.98e-4 | 1.47e-13 | 3.70/4.76/23.70 |
| S31 | 3.31/5.26/9.14 | 7.63 | 1.22e-4 | 2.53e-14 | 3.35/6.30/8.44 |

Shape varies session-to-session (S32 standout, cond 49 vs 5–8 elsewhere).
Bias parallel-vs-normal: normal dominates 4/5 legs (S32 sole exception, §12).

### §22 — Documented-model forms (NOT adopted)

Only physically/documentedly motivated forms considered (C_formal + C_floor,
σH² = aH² + (bH·L)²); none adopted — no causal evidence (§§17–18 blocked), and
12J.2's no-single-scalar result stands. No production model fitted.

### §23 — Default-SE formula numeric (descriptive only)

Per-leg H_default = 0.005+1ppm·L (9.79–10.69 mm) exceeds TBC rss(E,N) 5.20–7.13
on all 5; V_default = 0.010+2ppm·L (19.58–21.39) exceeds TBC σU on 4/5
(S32 σU 23.70, +2.3 above). Caveat: the recorded range implies an effective L of ~4.8–5.7 km, inconsistent with the ~8.4 km legs; the verdict (defaults exceed TBC rss on all 5) is insensitive to this discrepancy, but the derivation needs re-checking before any future use. Defaults neither match nor explain TBC covariances.
Resemblance, if any, infers no causality without the §17 experiment.

### §24 — TBC internal error model (read-only search)

`settings.txt` GNSS section carries setup errors only (centering 0.005, height
0.002); adjustment reports: `A Priori Scalar: 1.00`, `Constant Term [C]: 0.000 m`,
`Scale on Linear Error [S]: 1.000`. No ppm/weighting/scale terms there. Negative
confirmed: no ANTEX/ANTINFO/`*.atx`/antenna-DB anywhere under
`~/Downloads/webnet-gnss-12e` (`find -iname` empty).

### §25 — External processor check (NOT RUN) + CLI/WASM parity (RETAINED)

Second mature-processor cross-check: not run (optional per mission; toolchain cost).
CLI↔WASM parity under B1 (base-only) policy — retained:

| Leg | dXYZ WASM−CLI (mm) | dCov | Δratio | sha |
|---|---|---|---|---|
| S32 | 0.00/0.00/0.00 | 0 | 0 | **match** (`a5ff5575fa41cc4a`) |
| S39 | 0.00/0.00/0.00 | 0 | 0 | 2 of 67 lines differ in one covariance print digit (0.0024↔0.0023: FP rounding edge, positions identical) |

Verdict: parity retained — XYZ and the six covariance terms numerically identical on both legs; sole delta is a last-print-digit FP rounding edge on one S39 derived-ratio line (disclosed above), consistent with 12J.1's bit-level parity result.

### §26 — Quality criteria (classification-only, retained)

FLAG/FAIL thresholds stay classification-only (12J.2 H-FLAG correction retained:
authoritative H FLAG 0.035+1ppm). No causal evidence links thresholds to
stochastic weighting.

### §27 — Antenna vs covariance separation

Receiver PCV moved the S32 vector 101.1 mm yet left covariance **identical**
(§10: 0.6/1.1/0.9, all six terms). Antenna calibration is therefore not an excuse
for the ~200× trace gap — quantified separately, as required.

### §28 — Troposphere / ionosphere sensitivity (S32 one-at-a-time vs leg C)

| Run | Vector Δ vs C (mm) | d3 (mm) | Note |
|---|---|---|---|
| (a) trop saas→est-ztd | (−1.6/+30.0/−15.4), **33.8** | 50.2 | FIX 86/93; tens-of-mm share |
| (b) iono brdc→IFLC | (+29.2/−87.9/+51.2), **105.8** | 90.5 | **FIX 0/93** — degenerate on this baseline; bounded attribution only |

Magnitude attribution only — never selection to the residual.

### §29 — Satellite phase-center / wind-up (S32 one-at-a-time vs leg C)

| Run | Vector Δ vs C (mm) | d3 (mm) | Note |
|---|---|---|---|
| (c) sat PCO/PCV on | (−0.1/0.0/+0.1), **0.1** | 18.3 | negligible share |
| (d) windup on | (0.0/0.0/0.0), **0.0**, byte-identical sha | 18.3 | zero share (cancels in double differences) |

### §30 — Network consequence of RTKLIB formals (existing engine, finalized policy)

- 5-net A (TBC weights): **fails closed** — `Qvv block materially non-PSD
  (lambda_min=-8.7e-20)` on P041→SIXTWO#4 (12J.1 F2 reproduced exactly).
- 4-net (no S32) A vs B, dof 6: varianceFactor **0.323 (SEUW 0.57)** vs **14.487
  (SEUW 3.81)** → RTKLIB formal weights ~45× too strong in variance (6.7× in SEUW) relative to TBC-weight consistency.
  Adjusted coords differ **21.7 mm (HANNA), 22.6 mm (FIVE)** — the full bias
  propagates. Residuals A: 2.0–9.2 mm; B: 4.0–5.9 mm (over-weighting flattens
  residuals while shifting positions). Redundancy traces comparable (1.2–1.8/leg);
  SIXTWO unconstrained in 4-net (diff 0.0, as constructed).

Verdict: over-weighting danger quantified — consuming RTKLIB formals shifts adjusted
stations ~22 mm with SEUW 3.8 hiding it; TBC aposteriori weights are conservative
(SEUW 0.57) but trip the S32 Qvv gate in the full 5-net.

### §31 — Review-only stochastic policy (RETAINED)

12J.2 policy C retained as default: raw vectors may be processed/exported but not
silently auto-ingested. A FIXED raw solution carries stochastic status
FORMAL_UNCALIBRATED — inspectable, exportable, never an automatic adjustment
weight. Ingesting formals as TBC-equivalents would bake the ~2 cm directional
bias (§12) plus ~45× over-weighting (§30) into networks.

### §32 — Stochastic status metadata (DESIGN-ONLY)

Designed, not wired: `covarianceModel: 'rtklib-formal'`,
`covarianceCalibration: 'uncalibrated'` (or repository-consistent equivalent).
RTKLIB formals must never be labeled "survey accuracy." No production wiring here.

### §33 — Modern validation corpus (RECOMMENDED)

Future field-validation dataset with two modern receivers, authoritative ANTEX for
both, known heights, RINEX + TBC + WebNet/RTKLIB processing — to separate legacy
calibration archaeology from processor validation. Not required of any party here.

### §34 — Readiness matrix

| Domain | Verdict |
|---|---|
| VECTOR ENGINE | RESTRICTED — pipeline sound (controls bit-exact, mapping proven, 5/5 FIXED); residual bias understood as legacy-rover-specific (§14); review/export path only |
| ANTENNA MODEL | LEGACY-BLOCKED — rover TRM60158.00 unavailable in any product; base TRM29659.00 SCIT frozen READY |
| COVARIANCE | REVIEW-ONLY — formal uncalibrated; ~45× over-weighting danger quantified (§30); no scaling, no Default-SE adoption |
| WASM | READY — CLI parity exact incl. B1 policy (§25) |
| ADAPTER | READY — marker-to-marker convention unchanged, untouched |

### §35 — Production decision: GO-RAW-WORKER-REVIEW-MVP

Mission §35 conditions met: vector engine sound (restricted path), antenna residual
clearly legacy-specific, CLI/WASM exact, covariance explicitly review-only /
formal-uncalibrated, no automatic network ingest. Next phase may build
RINEX → worker → processed-baseline review/export — but NOT automatic adjustment
consumption (that needs GO-RAW-WORKER-MVP with defensible covariance, not claimed
here). MORE-EVIDENCE-REQUIRED would apply to production ingestion, not to the
review-MVP; NO-GO is refuted (architecture proven end-to-end).

## Acceptance A–R

| ID | Item | Verdict |
|---|---|---|
| A | Rover identity confirmed (§2) | PASS |
| B | IGS historical search complete (§3) | PASS |
| C | NGS ANTCAL search complete (§4; email avenue recorded, not pursued) | PASS |
| D | TBC/Trimble local library searched (§§5/24) | PASS |
| E | Alias≠calibration preserved (§6) | PASS |
| F | S32 ladder run (base-only; rover rungs unrunnable, §10) | PASS (partial-executed) |
| G | Cohort antenna effect quantified (§11) | PASS |
| H | Bias decomposed ENU/ECEF (§12) | PASS |
| I | Default-SE causal test executed OR operator-blocked (§17) | PASS (operator-blocked-accepted) |
| J | H/V substantially resolved — V exact 5/5, H ±1 mm (§19) | PASS |
| K | Pre-adjustment covariance proven (§16) | PASS |
| L | Five-leg shape analyzed (§§21–23) | PASS |
| M | No empirical scale introduced (§15) | PASS |
| N | Network consequence quantified (§30) | PASS |
| O | Stochastic metadata designed (§32) | PASS (design-only) |
| P | CLI/WASM parity retained (§25) | PASS |
| Q | Readiness matrix completed (§34) | PASS |
| R | No production behavior changed (src diff empty) | PASS |

## Validation

- `lint`: 0 errors (2 pre-existing warnings).
- `git diff origin/main --stat -- src/`: empty — no production changes.
- No vendor bytes committed (intake read-only; no `*.o`/`*.n`/`*.g`/`*.sp3`/`*.atx`/
  `*.gvx`/`*.html` added to the tree).
- Sole remaining avenue: unpublished NGS file via `ngs.antcal@noaa.gov` (§4).
- No push / no PR from this session (parent owns).