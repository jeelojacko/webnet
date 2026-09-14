# Phase 12J.1 — Covariance Audit §§18–23 (EVIDENCE ONLY)

Batch D. Local-corpus / /tmp-only evidence. No `src/` / `tests/` /
`TODO.md` / existing-file touches; no vendor data committed. Pinned
source: `/tmp/rtklib-evidence` (rtklibexplorer/RTKLIB commit `62d4677`,
v2.5.1), read-only. S32 input: `/tmp/s32_run1.pos` (Batch A rerun of the
documented S32 broadcast command). Line citations below are against the
pinned tree.

S32 command (from `reports/gnss/phase12j1-rtklib-pin.md`): `rnx2rtkp -p 3
-f 2 -m 15 -sys G -v 3.0 -ti 30 -ts 2006/06/14 17:24:30 -te 2006/06/14
18:10:30 -e -t -o s32_runN.pos -r -1283634.1259 -4726427.8882
4074798.0251 01241653.06o p0411650_2.06o 01241653.06n p0411650_2.06n`.

## §18 — How `sol.qr[6]` is produced for S32 FIXED static output (HARD gate)

### §18.1 Chain: `rnx2rtkp → postpos → rtkpos → solution` output

1. **Entry/options** (`app/consapp/rnx2rtkp/rnx2rtkp.c`): `main` starts
   from `prcopt_default`/`solopt_default`, then `-p 3` sets
   `prcopt.mode=PMODE_STATIC` (`rnx2rtkp.c`, `-p` branch); `-f 2` sets
   `nf=2`; `-m 15` sets elevation mask; `-sys G` sets GPS-only navsys;
   `-v 3.0` sets `thresar[0]=3.0`; `-b`/`-c` (`rnx2rtkp.c:159-160`) are
   NOT passed so `soltype` keeps its default `SOLTYPE_FORWARD`
   (`src/rtkcmn.c:204-205`, `prcopt_default`); `-e` sets
   `solopt.posf=SOLF_XYZ` (`rnx2rtkp.c:165`); `-t` selects calendar time;
   `-r x y z` sets `refpos=rovpos=POSOPT_POS_XYZ` and copies the three
   numbers into `prcopt.rb`/`ru` (`rnx2rtkp.c:171-175`); `postpos(...)`
   is invoked at `rnx2rtkp.c:208`.
2. **Session/direction** (`src/postpos.c`): defaults give
   `solstatic=0` (`src/rtkcmn.c:227-230`, `solopt_default`). Because
   mode is STATIC (not SINGLE) and `soltype==SOLTYPE_FORWARD`, only the
   forward branch executes — `procpos(...,SOLMODE_SINGLE_DIR)` forward
   (`postpos.c:1157`); the backward pass and `combres()` (`postpos.c:553-669`,
   incl. the `smoother()` fwd/bwd combination) NEVER execute for S32.
3. **Per-epoch static output** (`postpos.c:478-521`, `procpos`): with
   `solstatic=0` every accepted epoch is written via `outsol()` as the
   filter walks forward; the `.pos` file's 93 data lines are the
   forward-filter epoch sequence, not an average. The pin-record
   "formal σ 0.6/1.1/1.0 mm" is the LAST line (18:10:30, Q=1, ns=7,
   ratio 28.6).
4. **Base treatment** (`postpos.c:852-893`, `antpos`): receiver 2
   (base) uses `postype=refpos=POSOPT_POS_XYZ`, which matches NONE of
   the SINGLE/FILE/RINEX branches, so `rr` stays exactly `prcopt.rb`
   (the `-r` numbers). The base is an exactly-known fixed point: no
   base states are estimated, and DD processing cancels clocks against
   it. No antenna-delta/PCV correction is applied on this path
   (default `anttype "*"` with no ANTEX staged; RINEX `del` branches
   only run under `POSOPT_RINEX`).
5. **Filter** (`src/rtkpos.c`, `relpos`): each epoch runs time update
   `udstate` — `udpos` (`rtkpos.c:483-505`) returns immediately for
   `PMODE_STATIC`, i.e. ZERO position process noise (static states
   propagate unchanged) — then `zdres`/`ddres` measurement update with
   a-priori DD variances from `varerr` (`rtkpos.c:400-446`,
   elevation/SNR/baseline terms) via the standard Kalman update
   `filter()` (`src/rtkcmn.c:1479`), yielding float state `x` and
   covariance `P`.
6. **Fixing** (`rtkpos.c`, `resamb`, ~1740-1808): LAMBDA search +
   ratio gate `thresar[0]=3.0` (defaults `src/rtkcmn.c:218`). On pass,
   the fixed covariance is the CONDITIONAL covariance
   `Pa = P − Qab·Qb⁻¹·Qab'` (`rtkpos.c:1795-1798`, comment "covariance
   of fixed solution (Qa=Qa-Qab*Qb^-1*Qab')").
7. **FIX save** (`rtkpos.c:2173-2181`, `if (stat==SOLQ_FIX)`):
   `sol.rr[i]=xa[i]`, `sol.qr[i]=Pa[i+i·na]` (i=0..2),
   `sol.qr[3]=Pa[1]` (= row1/col0 = xy),
   `sol.qr[4]=Pa[1+2·na]` (= row1/col2 = yz),
   `sol.qr[5]=Pa[2]` (= row2/col0 = zx). Column-major reads confirm
   the cross-term ordering. The FLOAT branch (`rtkpos.c:2194-2199`)
   reads the same six slots from `P` instead — same layout.
8. **No posterior/residual scaling**: `valpos` (`rtkpos.c:1948-1969`)
   only logs large residuals and ALWAYS returns 1; no chi-square,
   variance-factor, or fixed-residual re-estimation touches `P`/`Pa`
   anywhere on this path. The shipped FIXED covariance is purely the
   a-priori-model conditional covariance, optimistic by construction.
9. **Printing** (`src/solution.c`): `outsol` dispatches on
   `posf==SOLF_XYZ` to `outecef` (`postpos.c:130` for the header leg;
   `solution.c:1211-1220`): diagonals print as `SQRT(qr[0..2])`,
   cross terms via sign-preserving `sqvar` (`solution.c:131-134`,
   `-sqrt(-c)` for negative). The `.pos` sd columns are therefore
   STD-DEVS in metres (ECEF order sdx/sdy/sdz/sdxy/sdyz/sdzx), NOT
   variances. Declaration `float qr[6]`, "position
   variance/covariance (m^2) {c_xx,c_yy,c_zz,c_xy,c_yz,c_zx}"
   (`src/rtklib.h:926-929`).

### §18.2 Answer (one paragraph)

For the S32 FIXED static run, `sol.qr[6]` is the AFTER-fixing
conditional filter covariance `Pa = P − Qab·Qb⁻¹·Qab'`
(`src/rtkpos.c:1795-1798`), stored ECEF as variances/covariances in
m² in the order xx, yy, zz, xy, yz, zx (`src/rtklib.h:926-929`;
`src/rtkpos.c:2173-2181`), produced by a single FORWARD filter pass
(`src/postpos.c:1157`; `combres`/`smoother` at `src/postpos.c:553-669`
never run), with zero position process noise (`src/rtkpos.c:504-505`),
base treated as an exactly-known point from `-r`
(`src/postpos.c:852-893`), a-priori measurement variances only
(`src/rtkpos.c:400-446`), NO posterior or residual-variance rescaling
(`src/rtkpos.c:1948-1969`, always returns 1), printed in the `.pos`
`sdx…sdzx` columns as std-devs via `SQRT`/`sqvar`
(`src/solution.c:131-134,1211-1220`).

## §19 — Extraction + round-trip (script)

`scripts/gnss/gnss12j1CovarianceExtract.ts`: parses the last Q=1 line
of the `.pos`, squares diagonals and sign-preserving-squares cross
terms (inverting `SQRT`/`sqvar`), yielding canonical symmetric ECEF
3x3 (m²): **Cxx 3.60e-7, Cxy 2.50e-7, Cxz −2.50e-7, Cyy 1.21e-6,
Cyz −4.90e-7, Czz 1.00e-6**. Off-diagonal sign/order verified against
`rtkpos.c:2178-2180` + `solution.c:131-134` (negative `.pos` cross
terms ↔ negative covariances; zx slot = Cxz). Round-trip
`.pos → raw-solution-contract → GnssBaselineObservation (frame ecef,
sessionId S32, solutionId B32) → invertGnssBaselineCovariance`
succeeds; weight matrix fully finite. Production imports are
read-only; no engine changes. Caveat: `.pos` prints 4 decimals, so
extracted elements carry display quantization (σ exact to 0.05 mm).

## §20 — SPD gate (production policy)

Policy (`src/engine/gnssBaselineCovariance.ts:38-77`): finite, positive
diagonals, Cholesky pivots > 0 — no jitter, no clipping, fail-closed.
**Both matrices PASS**: RTKLIB pivots p2=1.036e-6, p3>0
(det 2.72e-19); TBC pivots p2=1.729e-4, p3>0 (det 1.47e-13); inversion
re-verifies det>0 and C·W≈I. Classify rule: PASS → consumable by
weighting; FAIL → FAILED + diagnostics, never repaired. SPD-pass is a
shape gate only — it says nothing about external accuracy (§21 shows
8–17× scale gap with both matrices SPD).

## §21 — Full-matrix comparison RTKLIB (R) vs TBC (T)

Sigmas (mm): R 0.60/1.10/1.00 vs T 4.98/18.61/15.06 → ratios
**8.30× / 16.92× / 15.06×**. Element ratios T/R span 69–525×
(diagonals 69/286/227×; cross terms 213–525×) — already non-uniform.

| Metric | RTKLIB | TBC |
| --- | --- | --- |
| Correlations (xy, xz, yz) | +0.38, −0.42, −0.45 | +0.71, −0.71, −0.92 |
| Eigenvalues (m²) | 2.64e-7, 6.08e-7, 1.70e-6 | 1.15e-5, 2.27e-5, 5.64e-4 |
| Principal σ (mm) | 0.51, 0.78, 1.30 | 3.39, 4.76, 23.74 |
| Trace (m²) | 2.57e-6 | 5.98e-4 (233×) |
| Determinant | 2.72e-19 | 1.47e-13 (5.39e5×) |
| Condition | 6.44 | 49.1 |

Principal (max) eigenvectors: R (0.254, 0.747, −0.615) vs
T (0.155, 0.774, −0.615), |dot| = 0.995 — the dominant error
directions nearly COINCIDE (both ≈ Y–Z plane, Z-opposed); the
difference is scale + anisotropy, not orientation. Goal is
understanding, not equality: R is internal filter precision
(optimistic by construction, §18.8); T is aposteriori session
covariance carrying unmodelled error.

## §22 — Single-scalar scaling experiment

Least-squares variance factor over the 6 unique elements:
α = ΣT·R/ΣR² = **273.9** with **30.8% relative residual**
(||T−αR||/||T||). Per-element implied scales range 69–525×, and
correlations/condition differ irreducibly (R cond 6.4 vs T cond 49;
|ρ_yz| 0.45 vs 0.92). Verdict: NO single scalar maps RTKLIB↔TBC —
shape differs, not just scale. No production scaling is introduced;
any future use of R-formals downstream requires variance-component
estimation or external calibration, never a blanket factor.

## §23 — Acceptance quality contract

Pure function `classifyBaselineQuality` (in the §19 script):
required inputs `{solverStatus, ratio, epochsFixed, epochsTotal,
satellites, covarianceOk, warnings}` → verdict + reasons +
warnings. Rules: solver FAILED or SPD-fail → FAILED; FLOAT →
ACCEPTED_FLOAT at best; FIXED needs ratio ≥ 3.0, ≥4 sats, fix
fraction ≥ 0.50 else LOW_QUALITY; status-integer-only acceptance is
forbidden (covariance + ratio + epochs + sats always required).
Self-checks in-script (5/5 pass): S32 (FIXED, 90/93, ratio 28.6,
7 sats, SPD ok) → ACCEPTED_FIXED; low-ratio → LOW_QUALITY; float →
ACCEPTED_FLOAT; bad covariance → FAILED; solver FAILED → FAILED.
