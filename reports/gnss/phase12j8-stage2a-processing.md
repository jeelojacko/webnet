# Phase 12J.8 Stage 2a — baseline processing matrix (EVIDENCE ONLY)

Branch `feat/gnss-raw-covariance-confirmation`. No `src/` changes, no model
fitting, no TEST evaluation. Full analysis (S/SD/ENU/CL fits) comes later;
this stage delivers the driver, the run matrix, `solutions.json`, FIX rates.

## Driver

`scripts/gnss/gnss12j8Process.sh` — clone of `gnss12j7Process.sh`, retargeted
to `CORP=belgian-12j8`, `OUT=work12j8`, 15-day DOY map (124→2026/05/04 …
138→2026/05/18), NAVMAP = all 15 staged `BRDC00IGS_R_*_MN.rnx` (RINEX-4),
SP3 `COD0OPSFIN`. Frozen policy unchanged (GPS-only L1/L2 static FIXED, 10°
mask, MARKER_TO_MARKER_ECEF, `-p 3 -f 2 -m 10 -sys G -e -t + -k conf`,
`pos1-sateph=precise`, `ant2-postype=rinexhead`, `-r` after `-k`, two-arg
`-ts/-te`, content-checked skip, sorted timing, fail-closed xargs, `PAR` env).
New stations: EIJS `4023086.533 400394.875 4916655.319` LEIAR25.R4 LEIT 0.0
(sitelog §2/§4.4 current + RINEX header `726690/0.0000` cross-check); TIT2
`3993787.100 450204.200 4936131.800` LEIAR25.R4 LEIT delU **0.0450** =
marker→ARP (sitelog §4.3 current, header DELTA H 0.0450, 12J.7 DEL convention).
`ONLY` additionally accepts comma-separated OR of fixed strings (probe
subsets); single-pattern behavior unchanged.

`scripts/gnss/gnss12j8Parse.py` — clone of the `gnss12j7Analyze.py` parse
section only: `.pos` → `work12j8/solutions.json` + FIX-rate summary
(by baseline/length/duration/day/time + attempted/FIXED/FLOAT/NODATA).

## Matrix (685 jobs)

- Core STAR prec (TGRN/VOER/WERB–WARE): 9/day/baseline (4×1h + 2×30m + 2×2h
  + 1×24h). WERB legs skipped DOY133–136 (objective outage).
- Triangle prec 1h 4/day (TGRN–VOER, VOER–WERB, TGRN–WERB). WERB legs skipped
  DOY133–136.
- New legs prec (EIJS–WARE @WARE base, TIT2–VOER @VOER base): 4×1h + 1×24h,
  all 15 days.
- Broadcast bounded: STAR × {h00,h12} × {DOY126 FIT, DOY132 VAL, DOY137 TEST}
  = 18 runs (WERB present all three picked days).

## Results (`solutions.json`, local only — never committed)

runs=685 attempted=660 fixed=**643** float=17 nodata=25.
1h FIXED = **417** (≥100 ✓). Prec FIXED per baseline: TGRN–WARE 135,
VOER–WARE 133, WERB–WARE 83, EIJS–WARE 75 (len ~31871 m), TIT2–VOER 71
(len ~59412 m), TGRN–VOER 60 (all ≥30 ✓). 24h: 71/71 FIXED. Broadcast:
15 FIXED / 1 FLOAT / 2 NODATA.

Shortfalls (objective, documented): WERB DOY133–136 absent upstream
(pre-registered exclusion, −36 STAR −32 triangle jobs never scheduled);
WERB DOY137 file ~1/3 normal size + DOY138 ~60% → 24 of 25 NODATA are
WERB-involved DOY137–138 windows (plus WERB–WARE-130-h18). Non-WERB matrix
is effectively complete.

## Timing (`out/times.tsv`, 685 rows, sorted dedup)

- Primary PAR=2 wall **4:12.6**, peak RSS **104 MB**.
- Probe (fixed 12-run subset: triangle legs DOY126 prec 1h): PAR=1 wall
  **6.45 s** / 24.9 MB; PAR=4 wall **1.64 s** / 24.9 MB (~3.9× speedup).

RTKLIB pin 62d4677 (`/tmp/rtklib-evidence/.../rnx2rtkp`), ANTEX subset
`belgian-12j8-subset.atx` sha `c0eb7a8b`. Corpus/out/solutions committed:
none (scripts + docs only).
