# Phase 12J.2 — TBC Static GNSS Processing Parity Closure (§§43–44, §46–47, §0)

EVIDENCE ONLY. No `src/` production changes, no math/tolerance changes, no vendor
commits, no downloads. Branch `feat/gnss-raw-tbc-parity-closure`, baseline
`origin/main 7f0e5f90` (PR #54 merge).

S32 oracle: P041→SIXTWO, 2006-06-14 17:24:30–18:10:30 GPS, TBC B32 dX/dY/dZ
(+5822.646, −5654.885, −4846.085) m, length 9453.3312 m, mark-to-mark.
Finalized policy: `-p 3 -f 2 -m 10 -sys G -ti 30 -k prec.conf`
(`pos1-sateph=precise`) + `igs13793.sp3` (sha256 `064343f9…d7d134f1`), no antenna cal.

## §46.1 — TBC config inventory (frozen, `phase12j2-tbc-config.md`)

Solution Fixed; all frequencies; interval Automatic; trajectory Fixed-and-float;
antenna model Automatic; ephemeris Automatic; mask **10.0°**; GPS+GLONASS enabled;
S32 report: Fixed / dual-frequency / Precise / NGS Absolute / 30 s.
Setup errors 0.000/0.000 (stochastic-only, §24). Antennas: base TRM29659.00 SCIT,
rover TRM60158.00 NONE.

**H-FLAG correction (§20):** frozen config row "H FLAG 0.020 m + 1 ppm" conflated
Computation › Point Tolerances (Survey 0.020 m, `sett1.png`) with Baseline
Processing › Quality. Authoritative per `sett2.png` AND B32 footer (agree):
**H FLAG 0.035 + 1.0 ppm** (H FAIL 0.050 + 1.0 ppm; V FLAG 0.050 + 1.0 ppm /
FAIL 0.100 + 1.0 ppm). At L = 9453.3312 m: H FLAG **44.453 mm**, H FAIL 59.453,
V FLAG 59.453, V FAIL 109.453 mm. TBC S32 H 0.007 m / V 0.024 m → **PASS/PASS**
(0/50 flagged/failed corpus-wide).

## §46.2 — S32 ladder + 10°/15° + broadcast/precise (`phase12j2-ladder.md`)

| Stage (H-reduced, mark-to-mark) | dX / dY / dZ (m) | 3D vs TBC | Length Δ |
|---|---|---|---|
| A: 12J.1 legacy 15° broadcast | +5822.6389 / −5654.8636 / −4846.0864 | 22.6 mm | −16.5 mm |
| B: 10° broadcast | +5822.6394 / −5654.8661 / −4846.0839 | 20.0 mm | −16.0 mm |
| C: 10° + true precise (`igs13793.sp3`) | +5822.6398 / −5654.8678 / −4846.0847 | **18.3 mm** | **−14.3 mm** |

Leg A reproduces 12J.1 exactly (vector/FIX 90/93/ratio 28.6/σ — PASS). Leg B:
10–15° band admits G03/G07/G21 (39/93 epochs change ns), gap −2.6 mm. Leg C:
precise PROVEN consumed (`ephopt=1` ×186, falsification control 0-solution
without SP3), gap −1.7 mm — opposite of 12J.1's zero SP3-by-dispatch effect.
SP3 identity (`phase12j2-sp3-identity.md`): `igs13793.sp3` = IGS combined GPS
final (29 SVs, window covered); `igl13793.sp3` = GLONASS-only, unusable for
GPS-only S32. Closest-TBC-equivalent = leg C: **18.3 mm / −14.3 mm**.

## §46.3 — Antenna: source + mapping + BLOCKED (`phase12j2-antenna.md`)

igs14.atx (RTKLIB tree, sha256 `d59a4197…`) / igs20.atx (IGS, `8715268e…`).
Base TRM29659.00 SCIT: EXACT MATCH both files. Rover TRM60158.00 NONE: **absent
from both** → PCO leg + full-PCV leg **BLOCKED** (half-calibrated leg refused).
No naming translation needed (RINEX ≡ ANTEX convention, proven by base match).
Marker→ARP→PCO→PCV→marker audit: H/E/N single-use PASS (L1 reduction exactly
once, outside RTKLIB; `dant=0` throughout); PCV must rerun the estimator, never
vector arithmetic; staging rule frozen (anttype via `-k`, never copy H into
antdel). H sign oracle recomputed independently: (−398.4, −1475.3, +1277.4) mm,
0.1 mm agreement, PASS. Satellite PCV / wind-up: modeled on neither path,
largely canceling in 9.4 km DD — open difference, not blocker. Open: which
record TBC "Automatic" resolved for the rover (possibly NGS ANTCAL individual).

## §46.4 — Marker/ARP/APC trace, frame, quality

Marker-to-marker clean (§§12–14 PASS, above). Frame (`phase12j2-classification.md`
§§25–26): Molodensky-XYZ-0 / GRS80 / GEOID03 / LCC all OUTPUT-ONLY (zero
translation cancels exactly, demonstrated); labels retained — RTKLIB broadcast
WGS84(G1150)-class, SP3 leg IGb00, TBC project NAD83(2011)@2010; measured
broadcast↔SP3 effect **0.1 mm**; synthetic near-identity Helmert bound 11.209 mm
is a ceiling, applying it is forbidden tuning. Trajectory "Fixed and float" =
output-only (§18); GIS carrier/code = separate workflow, no mapping (§19).
Quality thresholds classification-only (§20). Default SE **excluded** for
processed vectors: S32 formula (H 14.453 / V 28.907 mm) irreconcilable with the
full estimated matrix; 0/50 corpus vectors default-generated; B0 parity leaves
no room (§22). Fallback role UNRESOLVED — TBC-side causal experiment spec'd
(§23), no WebNet code may reference Default SE until it runs.

## §46.5 — Covariance: semantics + decomposition + H/V (`phase12j2-covariance.md`)

RTKLIB leg-C formal: σ 0.6/1.1/0.9 mm; TBC B32 aposteriori: SDX/SDY/SDZ
4.977/18.611/15.057 mm. Per-axis σ ratios 8.3×/16.9×/15.1×; element ratios
69–525× non-uniform; trace 232.6×; eigenvalue ratios 43.5×/37.3×/331.9×;
condition 6.44 vs 49.10. Principal eigenvectors |dot| = 0.9947 — same
orientation, different scale + anisotropy. ENU @P041: R E/N/U 0.540/0.764/1.301,
T 3.701/4.749/**23.698** (endpoint choice <0.01 mm). Both vertical-dominated.
**V reproduced as 1σ Up** (23.698 → 0.024 m display). **H UNRESOLVED**: closest
1σ DRMS rss(E,N) = 6.021 mm, 0.98 mm (16%) short of 7 mm; no σ-multiple or
eigen/mean/3D convention lands on 7.00 — undocumented TBC horizontal
combination, do not force. Semantics reconfirmed: post-fix conditional formal,
single forward pass, no posterior rescaling; mask/precise change data, not
meaning. **No empirical scaling** (§31): `git diff origin/main --stat -- src/`
empty; §22 no-single-scalar stands (α=273.9, 30.8% residual). Future downstream
use of formals needs VCE or external calibration, never a multiplier.

## §46.6 — Cohort (`phase12j2-cohort.md`, finalized policy all legs)

3D (mm): S38 24.8, S40 19.8, S39 18.5, S32 18.3, S31 22.9 → **median 19.8, max
24.8, RMS 21.0**, all PASS (own H/V flags). **SYSTEMATIC, not scatter**: dY
+17.2…+21.3 mm on all five (mean +18.8); dX ±6.2; dZ negative 4/5; **all five
lengths short** (mean −9.0 mm, −4.7…−14.3). Bias persists across stations,
windows, broadcast and precise — policy shaves ~3 mm off 12J.1's 22.6 median
without rotating the bias. Remainder attribution (§28): KNOWN 4.3 mm closed
(mask 2.6 + precise 1.7, frame 0.1 negligible); LIKELY receiver PCO/PCV
(largest, BLOCKED), tropo/iono (TBC evidence absent — bounded sensitivity only,
never tune), weighting + AR strategy (shape differs, proven); UNEXPLAINED
18.3 mm not apportioned — closes only via executed evidence.

## §46.7 — CLI/WASM (`phase12j2-wasm.md`)

Finalized S32 CLI↔WASM **bit-identical** (body sha `9af1b9da…` equal, vector/
cov/ratio/epochs equal). SP3-WASM consumption proven (`ephopt=1` ×186,
fail-closed without SP3). ANTEX-WASM NOT-REQUIRED (WITHOUT-antenna parity is
the supported path). End-to-end PASS: RINEX→WASM→L1→adapter→adjust→report,
marked vector 18.3 mm vs TBC, provenance survives, no engine changes.

## §43 — Stochastic policy decision

Candidates (mission §43 definitions): **A** use RTKLIB formal covariance as-is,
labelled formal/internal, operator review before adjustment · **B** independently
justified stochastic model from documented measurement noise, not empirical TBC
matching · **C** do not yet permit raw-processed vectors to enter production
adjustment automatically; require review/export only · **D** other, with evidence.
Verified: no scaling added (§31, src diff empty); no TBC default-SE formula adopted
as vector covariance (§§21–23). **Decision: C.**
A as an automatic weight source is excluded (12J.1 F1: formals fail the Qvv PSD
gate — numerically toxic as auto weights, and 43–332× under-dispersed vs TBC).
B cannot be claimed yet (no-single-scalar result; tuning any factor to chase TBC is
prohibited, and no independent noise model was derived this phase). So raw vectors
stay out of automatic production adjustment; review/export-only path (12J.1
restrictions preserved, B0 parity basis untouched: raw GVX covariances unmodified).

## §44 — Readiness decision: MORE-EVIDENCE-REQUIRED

Gates: 10° closed ✓ · true precise understood ✓ · antenna semantics resolved
✗ (**BLOCKED**: rover TRM60158.00 NONE has no IGS/NGS record; TBC's
"Automatic" resolution unknown) · marker-to-marker clean ✓ · covariance
defensible ✗ (formal/internal 43–332× vs TBC; H combination unresolved; policy C
(review/export-only) is containment, not calibration) · CLI/WASM retained ✓ · cohort
systematic bias ✗ (**dY +17…+21 mm on 5/5, all lengths short −9.0 mm mean**).
S32 PASS/PASS and chain SUPPORTED describe the pipeline, not the product:
ingesting raw vectors as TBC-equivalents today would bake a stable ~2 cm
directional bias into networks. WITH-REVIEW is insufficient — review cannot
correct an uncalibrated systematic. NO-GO overshoots — the processing chain is
proven and restricted use (conservative weights, human review, single/4-net)
remains valid. Hence **MORE-EVIDENCE-REQUIRED for production ingestion**;
worker-MVP chain stays SUPPORTED under the 12J.1 restrictions.

## 12J.3 recommendation (concrete next steps)

1. Rover-cal hunt: NGS ANTCAL individual calibration for TRM60158.00 (or
   TBC record-identity probe); then frozen leg-D protocol (PCO-only → PCO+PCV
   at 10° broadcast, report deltas, never tune). 2. Bounded tropo/iono
   sensitivity rung (ladder owns runs; size the share, never select to the
   residual). 3. Stochastic parity: VCE/external calibration path for formal
   weights; TBC H-formula probe (display-rounding vs centering vs proprietary
   combination). 4. §23 Default-SE causal experiment (TBC-side copy project).
   5. Frame: retain labels; no transform without calibrated Helmert evidence.

## §47 — Acceptance A–T

| ID | Item | Verdict |
|---|---|---|
| A | TBC config frozen w/ H-FLAG correction (§1/§20) | PASS |
| B | SP3 identity resolved, `igs13793.sp3` pinned (§8) | PASS |
| C | Leg A reproduces 12J.1 exactly (§§2–5) | PASS |
| D | 10° closure quantified, band admission evidenced (§6) | PASS |
| E | True precise proven consumed, broadcast-vs-precise closed (§7) | PASS |
| F | ANTEX source/hash recorded, mapping verdict per antenna (§§9–11) | PASS |
| G | PCO/PCV BLOCKED with proof, no fake numbers (§§12–13) | PASS (blocked-accepted) |
| H | Marker/H/E/N single-use + sign oracle (§§12/14) | PASS |
| I | Interval/frequency/solution/trajectory/GIS classified (§§15–19) | PASS |
| J | Quality thresholds classification-only, S32 PASS/PASS (§20) | PASS |
| K | Report→GVX→adjustment trace unbroken (§21) | PASS |
| L | Default SE excluded for processed vectors (§22) | PASS |
| M | Default-SE fallback unresolved + experiment spec (§23) | OPEN (spec'd) |
| N | Zero-setup separation (§24) | PASS |
| O | Coordinate-system output-only + frame labels retained (§§25–26) | PASS |
| P | Staged table definitive, attribution honest (§§27–28, 31–34) | PASS |
| Q | Cohort finalized-policy, systematic bias recorded (§§35–37) | PASS |
| R | CLI↔WASM bit-identical incl. SP3; end-to-end PASS (§§38–42) | PASS |
| S | Stochastic policy C + readiness MORE-EVIDENCE-REQUIRED (§§43–44) | PASS |
| T | Closure report + §48 PR contract (§48 below) | PASS |

## §48 — PR contract

Evidence-only: `git diff origin/main --stat -- src/` MUST be empty. Commit
ONLY `reports/gnss/phase12j2-*.md`, `scripts/gnss/gnss12j2Ladder.ts`,
`scripts/gnss/gnss12j2Cohort.ts`, `TODO.md` (explicit pathspec, never `-A`;
phase9l noise stays untracked). No push / no PR from this session (parent owns).
Validation recorded in session closeout (lint / typecheck / focused /
build / test:agent + production-diff check).
