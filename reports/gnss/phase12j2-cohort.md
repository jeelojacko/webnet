# Phase 12J.2 Batch E §§35–37 — Finalized-Policy Five-Leg Cohort (EVIDENCE ONLY)

Branch `feat/gnss-raw-tbc-parity-closure`. EVIDENCE ONLY: no `src/`
production changes, no math/tolerance changes, no vendor commits, no
downloads. Runner: `scripts/gnss/gnss12j2Cohort.ts` (197 lines);
solutions into `os.tmpdir()`. Corpus local-only
`~/Downloads/webnet-gnss-12e/raw-baselines/`; binary pinned by Batch A
(`/tmp/rtklib-evidence/.../rnx2rtkp`, ver.EX 2.5.1, `62d4677`).

Finalized policy (Batch B leg C, identical on every leg, no per-leg
tuning): `-p 3 -f 2 -m 10 -sys G -v 3.0 -ti 30 -k prec.conf`
(`pos1-sateph=precise`) + `igs13793.sp3`
(sha256 `064343f9…d7d7`), `-e -t -r <P041 XYZ>`, base `p0411650.06o/.06n`
(body-identical to the `_2` variant per 12J.1, one session), rover
`01241650/51/52/53/54.06o/.06n`, exact TBC windows from
`scripts/gnss/gnss12j1Cohort.ts` L32–48. Vectors MARKER-TO-MARKER
(H_rov = 2.0 m, H_base = 0.0083 m, WGS84 ellipsoidal Up).

Classification (no `phase12j2-classification.md` staged — fallback
formulas at leg length L): H FLAG 0.020+1ppm / FAIL 0.050+1ppm;
V FLAG 0.050+1ppm / FAIL 0.100+1ppm. H/V split of the discrepancy about
local Up at the marked rover position.

## §35 — Per-leg results (all GPS-only, FIXED)

| Leg | TBC len (m) | Window | FIX/total | Ratio (final) | ns (final) | dX/dY/dZ vs TBC (mm) | 3D (mm) | H/V (mm) | H-flag/V-flag (mm) | Verdict | Length Δ (mm) | RTKLIB σx/σy/σz (mm) | Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S38 | 8416.9418 | 14:57:30–15:31:00 | 64/68 | 4.4 | 11 | +0.0 / +20.4 / −14.1 | 24.8 | 5.6 / 24.1 | 28.4 / 58.4 | PASS | −4.7 | 0.6/1.2/0.9 | 85 ms |
| S40 | 8416.9409 | 15:49:30–16:21:00 | 59/64 | 9.2 | 10 | +0.6 / +17.6 / −9.2 | 19.8 | 5.6 / 19.0 | 28.4 / 58.4 | PASS | −5.4 | 0.6/1.1/0.9 | 78 ms |
| S39 | 8798.0850 | 16:38:00–17:11:00 | 64/67 | 31.2 | 10 | −5.1 / +17.3 / −3.8 | 18.5 | 11.7 / 14.3 | 28.8 / 58.8 | PASS | −11.6 | 0.7/1.2/1.0 | 79 ms |
| S32 | 9453.3312 | 17:24:30–18:10:30 | 90/93 | 20.2 | 9 | −6.2 / +17.2 / +0.3 | 18.3 | 14.4 / 11.3 | 29.5 / 59.5 | PASS | −14.3 | 0.6/1.1/0.9 | 104 ms |
| S31 | 8798.0874 | 18:26:00–19:01:00 | 67/71 | 3.4 | 9 | −0.9 / +21.3 / −8.3 | 22.9 | 9.2 / 21.0 | 28.8 / 58.8 | PASS | −9.0 | 0.8/1.5/1.0 | 76 ms |

Cross-check: S32 body sha `9af1b9da16a669aa` == Batch B leg C sha —
the finalized policy reproduces exactly. S32 raw vector
+5822.2414/−5656.3431/−4844.8073 m identical to leg C.

## §§36–37 — Cohort summary

3D values (mm): 24.8, 19.8, 18.5, 18.3, 22.9 → **median 19.8, max 24.8
(S38), RMS 21.0**. Mean axis discrepancies (bias): **dX −2.3, dY +18.8,
dZ −7.0 mm**. Mean length delta (bias): **−9.0 mm** (all five legs
short: −4.7 … −14.3).

**Verdict: SYSTEMATIC, not scatter.** All five dY agree in sign and
tight band (+17.2 … +21.3 mm, spread 4.1 mm against a +18.8 mm mean);
dX stays within ±6.2 mm; dZ is negative on 4/5 legs. The bias vector
(~19 mm, dominantly +Y with a short-length tendency) persists across
two stations (HANNA/5/SIXTWO), three windows pairs, and both broadcast
(12J.1 median 22.6 mm) and true-precise (now 19.8 mm) processing —
finalized policy shaves ~3 mm off the median but does not rotate or
remove the bias. Remainder lives where Batch C put it: relative
PCO/PCV (rover TRM60158.00 NONE uncalibrated → PCV BLOCKED), tropo/iono
weighting, base-frame differences — not processor error. Covariance
finding stands: RTKLIB formal σ (≤1.5 mm) stays far tighter than TBC
aposteriori σ on every leg; TBC covariances remain the conservative
weighting choice.
