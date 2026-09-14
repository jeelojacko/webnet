# Phase 12J.1 — Marker↔ARP Contract (EVIDENCE ONLY)

Batch A §6 (HARD gate, started). Question: what point does the RTKLIB `.pos`
vector connect, and what correction maps it to TBC mark-to-mark?

## 1. RINEX header facts (read from corpus, never committed)

Rover `01241653.06o` (RINEX 3.04, GPS-only): marker `SIXTWO`, antenna
`TRM60158.00 NONE` (no serial), APPROX POSITION XYZ
`−1277811.8474 −4732085.2528 4069953.8670`, ANTENNA DELTA H/E/N
`2.0000/0/0` m.

Base `p0411650_2.06o` (RINEX 2.10, 30 s): marker `P041`, antenna
`TRM29659.00 SCIT` s/n 0220321767, APPROX POSITION XYZ
`−1283634.1259 −4726427.8882 4074798.0251`, ANTENNA DELTA H/E/N
`0.0083/0/0` m.

## 2. RTKLIB source trace (pinned tree 62d4677, all in /tmp only)

- `src/rinex.c` `readrnxh()` ~L395–400: `ANTENNA: DELTA H/E/N` is parsed
  into `sta->del[]` — but `sta->del` is NEVER passed to the DD estimator.
  It is only re-emitted when *writing* RINEX (`saverinex()` ~L2323 reads
  `opt->antdel`, not `sta->del`).
- `src/rtkpos.c` `rtkpos()` L2361–2363: because `-r` sets
  `refpos=POSOPT_POS_XYZ (1) ≤ POSOPT_RINEX (4)`,
  `rtk->rb = opt->rb` = the `-r` coordinate verbatim. The base end of the
  vector is exactly the number on the command line (P041 header approx).
- `src/rtkpos.c` `resd()` L1068: `antmodel(opt->pcvr+base,
  opt->antdel[base], …)` — the correction uses **prcopt** fields: `antdel`
  is all-zero (no `-k` config ever sets it) and `pcvr` is empty (no ANTEX),
  so `dant = 0` for every satellite (`src/rtkcmn.c` `antmodel()` L3919).
  NO height reduction, NO PCO, NO PCV is applied in the S32 run.
- `src/rtkpos.c` `constbl()` L1129–1132: baseline `b = x − rb`; the filter
  states `x[0..2]` converge to the rover point that best fits the
  double-differenced phase about the fixed base point.
- `src/solution.c` `outsol()` L1851+: writes `sol->rr` (rover absolute
  ECEF) — the `.pos` line is the rover phase-measurement point, not a marker.

## 3. Verdict: what the RTKLIB vector connects

Base fixed point (`−r` value, i.e. PARI header-approx level) → rover
estimated carrier-phase measurement point ≈ rover mean phase center
(ARP + absorbed L1/L2 PCO, uncorrected). In short: **phase-center to
command-line-point**, NOT mark-to-mark, NOT ARP-to-ARP in the strict
calibrated sense (no PCO was removed, so "ARP-level" is approximate).

## 4. What TBC reports

Per the B32 solution report: Fixed, Dual Frequency, 30 s, Precise
ephemeris, **NGS Absolute antenna**, Δ = (+5822.646, −5654.885, −4846.085) m
= **mark-to-mark** with absolute PCO+PCV applied at both ends.

## 5. The correction and the 2.0 m question

Production rule (first-order, REQUIRED): reduce each end from its
measurement point to the marker along local ellipsoidal Up —
`Δ_mark = Δ_raw − (H_rov·Up_rov − H_base·Up_base)` with H_rov = 2.0 m,
H_base = 0.0083 m. Measured on the Batch A rerun (WGS84 Up):

- raw d vs TBC: (−0.4055, −1.4539, +1.2760), 3D **1.9765 m**
- reduced d vs TBC: (−0.007, +0.021, −0.001), 3D **≈ 23 mm**
  (audit §19 reported 26 mm under a spherical-Up convention — same conclusion)
- length: raw 9453.2972 → reduced 9453.3147 vs TBC 9453.3312 (Δ ≈ −17 mm)

Is the 2.0 m subtraction the correct production rule or an approximation?
**Both: correct as the ARP→marker step, approximation as the full
mark-to-mark map.** The spherical-vs-ellipsoidal Up choice is sub-mm at
2 m (negligible). The real gap: it leaves the *relative* antenna PCO/PCV
(TRM60158.00 vs TRM29659.00 absolute calibrations, which TBC applies and
RTKLIB here does not) uncorrected — that, plus tropo/iono weighting and
base-frame differences, is where the ≈ 23 mm remainder lives. The 2.0 m
step must NOT be called the whole story, and the remainder must NOT be
called processor error, before the NGS-Absolute PCV leg (blocked: no
ANTEX staged). Base-coordinate offsets cancel out of the DD vector, so the
1.46 m P041 header-vs-datasheet offset is absolute-frame only.
