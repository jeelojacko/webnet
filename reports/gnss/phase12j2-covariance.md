# Phase 12J.2 Batch F — S32 Covariance Decomposition + H/V Reconstruction + Staged Table + Attribution (§§27–28, 31–34)

EVIDENCE ONLY. No `src/` production changes, no math/tolerance changes, no vendor commits,
no downloads, no RTKLIB runs. Branch `feat/gnss-raw-tbc-parity-closure`.
Sources: `phase12j2-ladder.md` (Batch B legs A/B/C), `phase12j2-antenna.md` (PCO/PCV BLOCKED),
`phase12j2-classification.md` (frame/tropo-iono), `phase12j2-separation.md` (Batch D §§20–23:
B32 aposteriori matrix, sDX/sDY/sDZ, H≈0.007/V≈0.024), `phase12j1-covariance-audit.md`
(§§18–23: RTKLIB `sol.qr[6]` semantics, R matrix, full-matrix comparison, no-scalar verdict).

S32 oracle: P041→SIXTWO, TBC B32 dX/dY/dZ (+5822.646, −5654.885, −4846.085) m,
length 9453.3312 m, mark-to-mark. RTKLIB legs H-reduced per Batch B.

## §32 — S32 RTKLIB-vs-TBC decomposition (all six terms + derived shape)

### Input matrices (exactly as evidenced — nothing invented)

RTKLIB leg-C final covariance (from `.pos` sdx/sdy/sdz/sdxy/sdyz/sdzx via `SQRT`/`sqvar`
inversion; audit §19; B and C identical at 0.1 mm print; A differs only in sdzx slot):
sdx/sdy/sdz = 0.0006/0.0011/0.0009 m, sdxy/sdyz/sdzx = 0.0005/−0.0006/−0.0005 m.
Canonical symmetric ECEF 3×3 (m²):

- R: Cxx 3.60e-7, Cyy 1.21e-6, Czz 1.00e-6, Cxy +2.50e-7, Cyz −4.90e-7, Cxz −2.50e-7.

TBC B32 aposteriori matrix (separation §21, from B32 detail page; reconciled element-wise
against PV32 GVX SDX/SDY/SDZ + PXY/PXZ/PYZ — report = GVX rounded to mm display):

- T: XX 0.0000247718, YY 0.0003463746, ZZ 0.0002267204,
  XY +0.0000655581, XZ −0.0000531839, YZ −0.0002570615 (m²).
- Display sigmas sDX/sDY/sDZ = 0.005/0.019/0.015 m = √diag(T) rounded
  (exact: 4.977/18.611/15.057 mm). No further TBC cross-terms exist beyond these six;
  nothing was reconstructed or infilled — **no EXPLICITLY ABSENT terms**: all six
  unique elements are evidenced for both matrices.

### σXYZ, correlations (python/numpy, pasted)

- R σ (mm): 0.60 / 1.10 / 1.00. Correlations: ρxy +0.379, ρxz −0.417, ρyz −0.445.
- T σ (mm): 4.977 / 18.611 / 15.057. Correlations: ρxy +0.708, ρxz −0.710, ρyz −0.917.
- Per-axis σ ratios T/R: 8.30× / 16.92× / 15.06×. Element ratios T/R span 69–525×
  (diagonals 69/286/227×; cross terms 213–525×) — non-uniform (audit §21).

### Eigenvalues / vectors, condition, trace, determinant (pasted `numpy.linalg.eigh`)

- R eigenvalues (m², ascending): 2.638e-7, 6.076e-7, 1.699e-6.
  Principal σ (mm): 0.514, 0.779, 1.303. Trace 2.57e-6 m². Det 2.723e-19.
  Condition λmax/λmin = **6.44**.
  Principal (max) eigenvector (x,y,z): (0.254, 0.747, −0.615).
- T eigenvalues (m², ascending): 1.148e-5, 2.268e-5, 5.637e-4.
  Principal σ (mm): 3.388, 4.763, 23.742. Trace 5.979e-4 m². Det 1.468e-13.
  Condition = **49.10**.
  Principal eigenvector: (−0.155, −0.774, +0.615) — sign-flipped vs R;
  |dot| = **0.9947**: dominant error directions nearly COINCIDE (both ≈ Y–Z plane,
  Z-opposed). Difference is scale + anisotropy, not orientation.
- **Headline shape comparison:** trace ratio T/R = **232.6×**;
  determinant ratio = **5.39e5×**;
  eigenvalue ratios (sorted asc) = **43.5× / 37.3× / 331.9×** (largest axis dominates);
  condition 6.44 vs 49.10 (T far more anisotropic, driven by |ρyz|=0.92).

### Shared local-frame transform (explicit endpoint)

Frame: ENU rotation J at **P041 base endpoint** (stated choice),
P041 XYZ = (−1283634.1259, −4726427.8882, 4074798.0251) m
(pinned `-r` values; base treated exact per audit §18.1 item 4).
J rows E/N/U from geocentric lat/lon at P041:

```text
J = [[+0.96504273, −0.26209260, 0],
     [+0.16762815, +0.61721822, +0.76872783],
     [−0.20147788, −0.74185520, +0.63957605]]
C_enu = J·C_xyz·Jᵀ  (rotation invariance: eigen/trace/det identical in ENU)
```

Sensitivity: same transform at SIXTWO (base+TBC vector) and at midpoint changes
ENU sigmas by <0.01 mm (E/N/U @SIXTWO: T 3.692/4.746/23.700; @mid: 3.697/4.747/23.699).
Endpoint choice is immaterial at the 9.4 km scale — P041 reported throughout.

Transformed sigmas @P041 (mm):

- R ENU: E 0.540 / N 0.764 / U 1.301. H_rss=√(E²+N²) 0.936, U 1.301.
  ENU correlations: −0.209 / −0.103 / −0.039 (near-diagonal vs XYZ).
- T ENU: E 3.701 / N 4.749 / U **23.698**. H_rss = **6.021**, U = **23.698**.
  ENU correlations: −0.200 / +0.334 / −0.148 (correlations collapse in ENU;
  the strong XYZ correlations were frame-induced, not intrinsic).

Horizontal-vs-vertical verdict: BOTH matrices are vertical-dominated in ENU
(R: U/H_rss 1.39×; T: U/H_rss 3.94×). TBC's displayed precisions therefore
**do correspond structurally to the GVX covariance's local-frame split**
(U≈V, rss(E,N)≈H — see §33 for the exact numerical verdict), but at TBC's
aposteriori scale: T ENU sigmas exceed R by 6.85×/6.21×/18.21× (E/N/U).

## §33 — H≈0.007 / V≈0.024 reconstruction from TBC 3×3 ECEF covariance

Method: rotate T into ENU @P041 (§32 J), test conventions against displayed
H = 0.007 m / V = 0.024 m (B32 page + §20 classification PASS vs 44.453/59.453 mm).

- V: σU = 23.698 mm → displayed 0.024 m ✓ (0.3 mm gap = display rounding).
  2×σU = 47.4 mm ✗. **V REPRODUCED as 1σ Up, no scaling.**
- H hypotheses (mm): rss(E,N)=√(σE²+σN²) = **6.021**; rms-H = 4.257; 2×rss = 12.042;
  2×rms = 8.515; mean(E,N) = 4.225; horizontal-semiaxis-max (2×2 EN eigen) = 4.876;
  full-3D rss = 24.451; major principal σ = 23.742.
- **H verdict: UNRESOLVED with closest hypothesis.** Closest is 1σ DRMS rss(E,N)
  = 6.021 mm — 0.98 mm (16%, factor 1.163×) short of 7 mm. Every other convention
  is farther (next-closest 2×rms-H = 8.515, +1.5 mm overshoot; all 1σ horizontal
  eigen/mean variants sit 2–3 mm short). No integer σ-multiple, RMS/mean/major-axis,
  or 3D combination lands on 7.00 mm from the evidenced 3×3 alone.
- Reading: V is a direct GVX-covariance read; H is NEAR-DRMS but not exactly it —
  consistent with TBC applying an undocumented horizontal combination (e.g. rounding-up
  of 6.02→7 display, minor centering contribution, or proprietary H formula) that the
  artifacts do not evidence. No scaling factor reconciles both axes at once
  (k=1.013 fits V, k=1.163 fits H). Do not force it.

## §34 — RTKLIB covariance semantics reconfirmed (post-corrected-options)

Verdict: **no semantic change from mask/precise options.** Legs B (10°) and C (10°+precise)
leave the shipped covariance identical at 0.1 mm print
(0.0006/0.0011/0.0009, 0.0005/−0.0006/−0.0005); leg A differs only in the sdzx print slot
(−0.0005→−0.0007 display, audit §19 vs ladder §7 table). Semantics per pinned source audit
(§18, commit `62d4677`, `src/rtkpos.c:1795-1798,2173-2181`, `src/rtklib.h:926-929`,
`src/postpos.c:1157`, `src/rtkpos.c:483-505,1948-1969`, `src/solution.c:131-134,1211-1220`):

post-fix conditional formal ECEF covariance Pa = P − Qab·Qb⁻¹·Qab′, single forward pass
(`combres`/`smoother` never run), zero position process noise (static), base exact from `-r`,
a-priori measurement variances only (`varerr`), NO posterior/residual rescaling (`valpos`
always returns 1), units m² in `sol.qr[6]` order xx/yy/zz/xy/yz/zx, printed as std-devs
via `SQRT`/`sqvar`. Mask (`-m`) and precise-ephemeris (`-k prec.conf`, `ephopt=1` proven by
trace) change the data/positions admitted — not what the covariance means. The 18.3 mm
remainder (§28) therefore cannot be a covariance-semantics artifact.

## §31 — NO empirical covariance scaling

No production change made. Verification: `git diff origin/main --stat -- src/` is **empty**
(exit 0, no output) on this branch — no `src/` file differs from `origin/main`, tracked or
otherwise (untracked phase-9L helper files present in the working tree are pre-existing and
untouched by this batch; pre-existing lint/typecheck failures there are out of scope per brief).
The §22 no-single-scalar result stands (α=273.9 least-squares over 6 elements with 30.8%
relative residual; per-element scales 69–525×; conditions 6.4 vs 49.1): no blanket factor
is introduced, and any future downstream use of R-formals requires variance-component
estimation or external calibration, never an empirical multiplier.

## §27 — Definitive S32 staged table (central deliverable; H-reduced mark-to-mark)

TBC reference row: dX +5822.646 / dY −5654.885 / dZ −4846.085 m, length 9453.3312 m.
RTKLIB rows are H-reduced (L1 ellipsoidal-Up reduction applied exactly once outside RTKLIB;
raw pre-reduction vectors in note). 3D-vs-TBC and length-Δ vs the TBC row.

| Stage | dX (m) | dY (m) | dZ (m) | 3D vs TBC | Length Δ vs TBC | Covariance summary |
| --- | --- | --- | --- | --- | --- | --- |
| 12J.1-legacy 15° broadcast (A) | +5822.6389 | −5654.8636 | −4846.0864 | **22.6 mm** | −16.5 mm | sdx/sdy/sdz 0.6/1.1/1.0 mm; sdxy/sdyz/sdzx 0.5/−0.7/−0.5 mm |
| 10° broadcast (B) | +5822.6394 | −5654.8661 | −4846.0839 | **20.0 mm** | −16.0 mm | 0.6/1.1/0.9 mm; 0.5/−0.6/−0.5 mm |
| 10° + true precise IGS `igs13793.sp3` (C) | +5822.6398 | −5654.8678 | −4846.0847 | **18.3 mm** | −14.3 mm | identical to B at 0.1 mm print |
| +PCO (relative TRM60158.00-vs-TRM29659.00) | — | — | — | **BLOCKED** | — | BLOCKED (rover record absent, §11; half-calibrated leg refused) |
| +PCV (full receiver PCV) | — | — | — | **BLOCKED** | — | BLOCKED (same; must run as estimator rerun, never vector arithmetic) |
| frame-aligned | no transform applied | — | — | — | — | translation cancels exactly (§25 demo d1−d0 = 0); synthetic near-identity Helmert bound **11.209 mm** (components +6.792/+8.642/−2.200) vs measured broadcast↔SP3 effect **0.1 mm** — classified **unjustified-to-apply** (tuning a frame to chase the residual is forbidden; §26) |
| closest-TBC-equivalent | = 10°+precise row | — | — | **18.3 mm** | −14.3 mm | = leg C (elevation-corrected, true-precise, dual-frequency FIXED 90/93) |

Notes (exact): raw pre-reduction vectors — A +5822.2405/−5656.3389/−4844.8090;
B +5822.2410/−5656.3414/−4844.8065; C +5822.2414/−5656.3431/−4844.8073.
Deltas: B−A 3.6 mm 3D (+0.5/−2.5/+2.5 mm; gap −2.6); C−B 1.9 mm 3D (+0.4/−1.7/−0.8 mm;
gap −1.7). All legs FIX 90/93, float = first 3 epochs; final ratios 28.6/19.4/20.2.
TBC mask is 10° so leg B/C convention matches; SP3 leg product label IGb00
(`igl13793.sp3`) vs TBC project frame NAD83(2011)@2010 — labels retained, not reconciled.

## §28 — Attribution of the 18.3 mm remainder (do not force zero)

### KNOWN (measured, evidenced — sums to 4.3 mm of the 22.6 mm walk-down)

- Elevation mask 15°→10° (G03/G07/G21 admitted in 10–15° band, 39/93 epochs change ns):
  **2.6 mm** of gap closure (22.6→20.0). Functional-model change (more data), closed.
- True precise orbits (`pos1-sateph=precise` + `igs13793.sp3`, `ephopt=1` proven, falsification
  control with 0-solution/2693 `no prec ephem` lines): **1.7 mm** (20.0→18.3). Closed.
- Frame inter-comparison measured effect broadcast↔SP3: **0.1 mm** — negligible, retained
  as labels only. The 11.209 mm synthetic Helmert bound is a sensitivity ceiling, not a correction.

### LIKELY (open model differences that physically fit a 9.4 km DD baseline; unquantified, owners named)

- **Receiver antenna PCO/PCV (BLOCKED, largest single likely):** TBC NGS Absolute vs RTKLIB
  `dant=0` (no antenna model in matched config). Relative PCO/PCV between TRM29659.00 SCIT
  and uncalibrated TRM60158.00 NONE enters per-satellite per-epoch via `antmodel()` —
  cm-level capable, direction-dependent, not a post-solve shift. Blocked on the missing rover
  record (absent from igs14.atx AND igs20.atx); TBC's "Automatic" record identity for the rover
  is itself an open question (possibly NGS ANTCAL individual calibration). Owner: antenna batch
  when a rover record exists; protocol frozen (PCO-only then PCO+PCV at 10° broadcast).
- **Troposphere/ionosphere handling:** RTKLIB frozen (`ionoopt=broadcast`, `tropopt=Saastamoinen`,
  defaults); TBC evidence **absent** (no model named in settings/B32/frozen config). A bounded
  sensitivity rung (ladder owns runs) may size this share — never tune to the residual.
- **Stochastic weighting + AR strategy:** RTKLIB a-priori `varerr`/`eratio 300` + LAMBDA ratio 3.0
  vs TBC proprietary weighting/acceptance; §32 proves the covariances differ in SHAPE (not just
  scale), so the estimators demonstrably weight differently. Contributes to vector placement
  beyond what formal-covariance comparison alone shows.
- **Satellite PCV / phase wind-up:** absent on BOTH evidenced paths (RTKLIB S32 DD models neither;
  TBC no evidence) — largely canceling in short-baseline DD, mm-level at most. Kept LIKELY-small,
  not a driver hypothesis.

### UNEXPLAINED (residual after the above; explicitly not forced to zero)

- After KNOWN (4.3 mm closed) the gap stands at **18.3 mm** with length component −14.3 mm
  (a scale-like along-track shortfall, not pure noise).
- The BLOCKED antenna leg + unmeasured atmosphere/weighting/AR differences are jointly sufficient
  in principle to cover it, but **no evidenced partition sums to 18.3 mm today** — this report
  does not apportion numbers to unrun legs.
- Candidates that stay in UNEXPLAINED (no evidence to promote them): code-bias handling,
  clocks/products beyond tested SP3, elevation-dependent weighting details, TBC proprietary
  baseline-engine choices, base-frame realization beyond the bounded rotation/scale ceiling.
- Closure rule: the remainder closes only via executed evidence (unblocked antenna rerun,
  bounded atmosphere sensitivity, staged weighting experiments) — never by frame tuning,
  covariance rescaling (§31 refusal stands), or display-convention arithmetic (§33 H gap stays open).

Computations: `numpy.linalg.eigh` one-liners in §§32–33; inputs pasted verbatim above;
J built from P041 geocentric lat/lon per §32. No repo code executed for math beyond the
frozen evidenced matrices.
