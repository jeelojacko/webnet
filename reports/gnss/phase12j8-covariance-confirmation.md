# Phase 12J.8 — Raw-Covariance Confirmation, Final Report (Stage 2b, EVIDENCE ONLY)

Branch `feat/gnss-raw-covariance-confirmation`. No `src/` changes, no ingest,
no math/adjustment/R2B/tolerance changes. Corpus, `out/`, `solutions.json`
local-only, never committed. Scripts + this report committed only.

## 1. Metadata

- Corpus (local-only): `~/Downloads/webnet-gnss-medium/belgian-12j8/` —
  6 stations × DOY 124–138 (2026-05-04–18), CODE final SP3 `COD0OPSFIN`,
  per-day broadcast NAV, ANTEX subset, `MANIFEST-12j8.sha256`.
- Processing policy (frozen, one set, no per-baseline tuning): GPS-only L1/L2
  STATIC FIXED, 10° mask, MARKER_TO_MARKER_ECEF, exact ANTEX subset, precise
  SP3 primary. Markers: WARE `4031947.1301 370150.7758 4911905.3657`
  TRM59800.00 NONE delU 0.5180; TGRN/VOER LEIAR25.R3 LEIT 0.0; WERB/EIJS
  LEIAR25.R4 LEIT 0.0; TIT2 LEIAR25.R4 LEIT delU 0.0450 (marker→ARP).
- Driver: `scripts/gnss/gnss12j8Process.sh` (stage 2a, deterministic,
  fail-closed, PAR=2 primary). Analysis (new, stage 2b):
  `scripts/gnss/gnss12j8Analyze.py` (F baseline/rates/gate/broadcast),
  `scripts/gnss/gnss12j8Models.py` (fits/selection/TEST/loops/oracle),
  `scripts/gnss/gnss12j8SessionGraph.ts` (multi-window graph; 12J.7 file
  untouched). Engine-mirror semantics: T=d′(Ci+Cj)⁻¹d ~χ²(3), thresholds
  7.815/11.345/median 2.366; geocentric-lat ENU rotation; SPD gate, no jitter.
- Matrix: 685 jobs, attempted 660, FIXED **643**, FLOAT 17, NODATA 25.
  1h FIXED prec = 402 (+15 brdc = 417 total). 24h 71/71 FIXED.
- ANTEX subset `belgian-12j8-subset.atx`: 2,362,293 bytes,
  sha256 `c0eb7a8b…` (19 type-mean lines incl. new LEIAR25.R4 LEIT).
  RTKLIB pin carried from stage 2a. Stage-2c new-leg full-vs-subset
  parity: EIJS-WARE DOY124 h00 prec, `/tmp/igs20.atx` (sha256
  `8715268e…`, 60,295,761 bytes) vs subset → output `.pos`
  byte-identical (sha256 `35d89452…`, 121 solution epochs). Stage-1
  WARE-TGRN parity (96 epochs, byte-identical) carries; see §17.

## 2. Partitions (frozen) + exclusions (recorded BEFORE evaluation)

FIT DOY 124–130, VAL 131–134, TEST 135–138. No day moved for quality.
Objective exclusions: WERB DOY133–136 upstream outage (legs never scheduled);
WERB DOY137–138 partial (undersized RINEX; 24/25 NODATA are WERB-involved
DOY137–138 + WERB–WARE-130-h18). Non-WERB matrix effectively complete.

## 3. FIX rates

| Pair (len) | n | FIXED | FLOAT | NODATA |
|---|---|---|---|---|
| TGRN-WARE 18.7km | 141+ | 141 | 0 | 0 |
| VOER-WARE 33.7km | 141+ | 139 | 2 | 0 |
| WERB-WARE 45.9km | 105 | 86 | 6 | 13 |
| EIJS-WARE 31.9km | 75 | 75 | 0 | 0 |
| TIT2-VOER 59.4km | 75 | 71 | 4 | 0 |
| TGRN-VOER 16.5km | 60 | 60 | 0 | 0 |
| TGRN-WERB 45.4km | 44 | 36 | 2 | 6 |
| VOER-WERB 41.8km | 44 | 35 | 3 | 6 |

By duration: 30m 75/82, 1h 417/450, 2h 80/82, 24h 71/71.
By day: DOY133–136 show the WERB outage dip; DOY137–138 the partial.
New legs EIJS/TIT2: 100%/95% 1h FIXED — geometry addition succeeded.

## 4. F baseline (raw formal; matched within (pair,dur,eph,partition))

| Pool | n | mean | med | p95 | exc95 | exc99 |
|---|---|---|---|---|---|---|
| 30m FIT/VAL/TEST | 19/8/8 | 2246/1543/8412 | 1221/1298/1913 | — | 1.0 | 1.0 |
| 1h FIT/VAL/TEST | 107/49/42 | 1600/2190/2386 | 776/1238/1235 | 5339/9748/9949 | 1.0 | 1.0 |
| 2h FIT/VAL/TEST | 21/10/9 | 2104/3995/3756 | 875/3062/2335 | — | 1.0 | 1.0 |
| 24h FIT/VAL/TEST | 15/9/9 | 2093/533/2970 | 1433/282/1377 | — | 1.0 | 1.0 |

By length (1h matched medians): 16.5km 481, 18.7km 344, 31.9km 1143,
33.7km 1293, 41.8km 851, 45.4km 1041, 45.9km 1556, 59.4km 3285.
F rejected at 100%/100% in every cell: raw formals are not survey weighting.
Repeatability (obs/formal): e.g. VOER-WARE 1h E 15.3/0.5, N 13.8/0.6,
U 32.5/1.3mm; TIT2-VOER 1h rms3d 75.9mm. Ratios ~10–55×.
All-pairs appendix (PSEUDOREPLICATED, do not cite): 1h n=10440 med 986;
30m n=949 med 828; 2h n=1060 med 1024; 24h n=475 med 1099 — same direction.

## 5. Length gate (BEFORE ppm fits): LEVERAGE_OK

8 distinct lengths with n1hFIXED≥10 (16.5/18.7/31.9/33.7/41.8/45.4/45.9/
59.4km). Gate passes — ppm fits admissible in principle.

## 6. FIT-only fits

- **S**: s=**18.111** (FIT 1h matched med 776.1, n=107). 12J.7 prior was
  17.2 — replicated within ~5% on an independent 15-day corpus.
- **SD**: s30=22.72 (n=19), s1h=18.11 (n=107), s2h=19.23 (n=21),
  s24h=24.61 (n=15). No duration law imposed.
- Per-baseline s (FIT 1h diagnostic): 16.5km 11.29, 18.7km 11.48, 31.9km
  19.68, 33.7km 19.88, 41.8km 18.76, 45.4km 19.13, 45.9km 25.65,
  59.4km 34.52. Clear length structure; no production per-baseline params.
- Daily s (FIT 1h): 23.10/10.97/16.64/20.53/18.95/25.41/10.18
  (range 10.2–25.4, IQR ~12.1; n≈13–16/day) — day-to-day NOT stable
  (swings exceed median-sampling noise by ~3×: real day variability).
- **ENU** grid (h 0–40/v 0–80mm, 1mm, lexicographic tie-break, FIT only):
  h=17mm v=14mm (FIT med 2.37, n=107).
- Residual length trend after S (FIT per-length S-scaled meds): 0.92/0.95/
  2.79/2.85/2.54/2.64/4.74/8.60 — spread max/min 9.3×, driven by the 59.4km
  leg (8.60). Trend present → SL/CL gates B pass.
- **SL** diagnostic (L0=30km, FIT only): s0=0.988, k=0.442.
- **CL** grid (FIT only; gates A+B pass, n=107 supports 4 params;
  estimator documented — the frozen plan underspecified the CL
  estimator/grid, recorded here as plan-gap fix, plan file not backdated):
  extra variance is constant-plus-ppm in physical units throughout,
  sH_mm(L)^2=aH_mm^2+(bH_mm/km·L_km)^2 (same for V), ×1e-6 to m² only
  at covariance assembly; objective |median(T)−2.366| over FIT 1h matched
  pairs; deterministic two-pass grid (coarse aH 0–40/aV 0–80 step 5,
  bH/bV 0–2 step 0.5; refine ±5mm/±0.5 around winner, 1mm/0.1 steps;
  lexicographic tie-break). Result: aH=0mm aV=11mm bH=0.5mm/km
  bV=0.3mm/km (FIT med 2.37, n=107) — genuine nonzero ppm terms.
  (Stage-2b values aH=aV=15mm, bH=bV=0 were a 1000× ppm slope-unit
  error: grid step 0.00025 read as 0.25mm/km was really 250mm/km,
  forcing a zero-ppm winner at FIT med 2.53. Corrected here, scripts
  only; S/SD/ENU fits untouched.)

## 7. VALIDATION selection (frozen params, 1h n=49)

| Model | med | exc95 | exc99 | VAL loops med/exc95 (n=4) | H/V \|z\| | per-length VAL meds |
|---|---|---|---|---|---|---|
| F | 1237.5 | 1.0 | 1.0 | 680.2/1.0 | — | — |
| **S** | 3.77 | 0.265 | 0.184 | 2.07/0.0 | E1.03/N0.64/U0.62 | balanced |
| SD | 3.77 | 0.265 | 0.184 | 2.07/0.0 | (≡S on 1h) | ≡S on 1h |
| ENU | 2.25 | 0.225 | 0.143 | 0.92/0.0 | E0.55/N0.40/U1.09 | — |
| CL | 2.93 | 0.163 | 0.061 | 1.58/0.0 | — | 1.95–8.56 (4.4×) |

SD vs S by duration on VAL: 30m SD med 2.51/exc95 0.0 vs S 3.96/0.25
(n=8); 2h SD 8.28/0.5 vs S 9.33/0.6 (n=10); 24h SD 0.47 vs S 0.86 (n=9)
— directionally better off-1h but n≤10 cells cannot carry a claim;
1h cell identical by construction. SD does not materially beat S.
Loop column is VAL-only (DOY131–134, n=4): no TEST observation
influences selection; all-15-loop stats (§9) are post-selection
confirmation only. Ranking per plan: ENU wins median (2.25), CL wins
exc95/exc99 (0.163/0.061); **S wins (5) H/V balance** (ENU
over-conservative H, still-hot V: structural misallocation that
generalizes poorly; no CL H/V claimed), **(7) simplicity** (1 param vs
4). VAL loops (n=4) are uninformative at this depth — all candidates
exc95 0.0 (S med 2.07 closest to nominal, ENU 0.92, CL 1.58). CL: best
VAL tails, but its VAL per-length meds still span 4.4× (long legs TIT2
7.85 / TGRN-WERB 8.56 vs short TGRN-WARE 1.95) — the ppm terms shrink
but do not remove the length trend, so the exc95 edge over S (0.163 vs
0.265, Δ5 exceedances on n=49) carries no length-generalization claim
→ rejected (overfit risk retained).
**Selection: S (s=18.111 frozen).**

## 8. TEST (winner S only, run ONCE, no changes after)

1h: n=42 mean 7.27 **med 3.77** p95 30.33 exc95 0.262 exc99 0.190 —
VAL med reproduced exactly (3.77→3.77: frozen parameter generalizes).
30m med 5.83/exc95 0.375 (n=8); 2h med 7.12/0.333 (n=9);
24h med 4.20/0.222 (n=9). TEST loops (in-window subset): n=4 med 0.97,
exc95 0.0. TEST plausible: same regime as VAL, no blow-up. No TEST
observation entered selection (§7 loops are VAL-only; TEST loops computed
once for winner S only).

## 9. Loops (primary: short triangle, disjoint windows, no reuse)

(TGRN-WARE@h00) − (VOER-WARE@h06) − (TGRN-VOER@h12), one loop/day.
**15/15 closed** (all DOYs incl. WERB-outage days — WERB-free by design).
Closure |mm|: med 31.3, max 122.6, rms 43.2. Selection uses VAL-only
loops (DOY131–134, n=4): F 680.2/1.0; S 2.07/**0.0**; SD 2.07/0.0;
ENU 0.92/0.0; CL 1.58/0.0 — uninformative at n=4 (all exc95 0.0), kept
for partition hygiene. Post-selection confirmation (all 15 loops,
explicitly labelled, NOT used for selection): F 430.4/1.0; S 1.31/
**0.0**; SD 1.31/0.0; ENU 1.26/0.067; CL 2.11/0.067. Combos recorded in
`models12j8.json` (doy+3 solution ids; `loops.T` = VAL-only selection,
`loops.T_all_confirmation` = all-15).
Secondary core triangle (WERB-dependent): 8 loops (outage restricts;
characterization only). ≥10 target MET on primary set with margin.
Note: the planned WARE-VOER-EIJS triangle was not closable (EIJS-VOER leg
not in the stage-2a matrix); the WARE-TGRN-VOER short triangle (16.5km leg)
served as the WERB-free loop engine instead — documented deviation.

## 10. Same-session cross-correlation

Shared-anchor pairs strongly correlated (TGRN-WARE×VOER-WARE X0.73/Y0.93/
Z0.61 n=60; VOER-WARE×EIJS-WARE up to Z0.91); shared-rover pairs
anti-correlated (TGRN-WARE×TGRN-VOER Y−0.79/Z−0.61). Session structure
confirmed on expanded corpus; matched pools stay within-pair by construction.

## 11. Session graph (5 daily sessions, STAR/MST/FULL, WARE fixed)

Spreads all <12mm (worst |STAR-MST| 11.9mm; typical <5mm); FULL SEUW 0.2–4.0
(raw formals). Engine `selectSpanningTree` picks the STAR on session 1.
**VERDICT: SPANNING_TREE_SUFFICIENT_INITIAL.** TIT2-VOER excluded from graph
sessions (VOER-anchored, outside WARE datum; documented).

## 12. Broadcast bounded + 61mm-outlier follow-up

Same-window prec-vs-brdc (STAR h00/h12, DOY126/132/137): n=16, med T 2.68,
exc95 0.125; dlen mean +1.7mm, max|19.0|mm. No 61mm repeat.
12J.7 61mm cause identified: **WERB-WARE DOY124 h12 brdc** (dlen +61.2mm,
T~2100): 8 sats (fewest of its cohort), only 9/121 fixed epochs despite
FIXED flag, ratio 3.1 — weak broadcast-geometry session on the longest core
baseline. 12J.8 analogue (WERB-WARE-126-h00-brdc) went FLOAT (ratio 0.0);
broadcast remains a bounded-secondary class.

## 13. Formal-cov internal consistency

Formal-trace medians: 30m 1.879 > 1h 1.507 > 2h 1.245 > 24h 0.520mm —
epoch ordering holds; duration/length/geometry ordering sane. Formal
optimism is a scale problem, not a disorder problem.

## 14. Absolute oracle (EPN SSC `EUR0OPSSNX_…_SOL.SSC`, C2400)

WARE/EIJS/TIT2 latest solutions propagated velocity→2026.35 (WARE
4031946.8985/370151.3995/4911906.2009, matching 12J.7). Rover absolute
offsets ~0.8–1.0m are the sitelog-vs-SSC base datum difference (sitelog
base vs propagated SSC WARE: 1068mm), not solution error.
Datum-independent: **EIJS-WARE SSC length 31871.2578m vs solution mean
31871.2282m → dlen −29.6mm (~0.9ppm, n=60)** — absolute confirmation at
cm level. TGRN/VOER/WERB: **UNRESOLVED** (no SSC entries).

## 15. Cross-corpus (external only, never pooled)

Wettzell short-baseline prior s≈1.5–1.6 vs Belgian medium s≈18.1 (~11×):
different length/geometry regime, kept separate — scale grows with baseline
as expected. Dataset-B (commercial TBC weights): qualitative only, weights
not comparable to raw-formal scaling; never pooled.

## 16. Resources + FIX summary

Stage-2a timing (`out/times.tsv`, 695 rows incl. probe): PAR=2 wall 4:12.6,
peak RSS 104MB; probe PAR1 6.45s/24.9MB, PAR4 1.64s (~3.9×).
FIX: 643/660 attempted (97.4%); 1h prec 402; 24h 71/71.

## 17. Verdicts

- ANTEX: **REVIEW_ONLY** (deterministic subset, exact entries incl. new
  stations, hash recorded; stage-2c new-leg full-vs-subset parity:
  EIJS-WARE DOY124 h00 prec, `/tmp/igs20.atx` (sha256 `8715268e…`) vs
  subset (sha256 `c0eb7a8b…`) → `.pos` byte-identical (sha256
  `35d89452…`, 121 solution epochs) — re-proof now run and passing, but
  single-leg shared-type coverage only, so no certification is claimed;
  mission-§51 acceptance F recorded as GAP, §19).
- SESSION_GRAPH: **SPANNING_TREE_SUFFICIENT_INITIAL**.
- DIRECT_INGEST: **NO**.

## 18. Certification: REVIEW_ONLY_FINAL

VALIDATION selects S (s=18.111); TEST plausible (med 3.77→3.77 exact
generalization); 15/15 loops support (S loop exc95 0.0); H/V balanced;
EIJS-WARE absolute length −29.6mm. The 12J.7 scale (17.2) is confirmed
within ~5% on independent data — the confirmation objective is met.
Certification bar not met: VAL/TEST exc95 ~26% (5× nominal — tails still
underestimated), daily s 10.2–25.4 (day-to-day instability), TIT2 59.4km
residual 8.6× nominal (severe length trend at the long end). CL fits
genuine ppm terms (aH=0/aV=11mm, bH=0.5/bV=0.3mm/km) and improves VAL
tails (exc95 0.163) but its VAL per-length meds still span 4.4× — the
trend is real but not removable with this leverage.
No certified scope is claimed; no automatic follow-up fitting phase.
Terminal result: S≈18 is the standing working scale for GPS L1/L2 1h
medium-baseline survey weighting, evidence-only.

## 19. Acceptance (mission §51 A–W; local section checklist separate)

Mission-§51 labels A–W (A hypotheses frozen … W no math changes;
mission text external to the repo). Each row: PASS/GAP + evidence
pointer. Mission F = GAP per independent review (new-leg parity run and
passing, but single-leg shared-type coverage only).

| ID | Criterion | Result |
|---|---|---|
| A | Hypotheses frozen (models, partitions, gates pre-registered) | PASS (plan frozen before data, §2) |
| B | Partitions frozen FIT/VAL/TEST | PASS (124–130/131–134/135–138, §2) |
| C | WERB exclusions pre-registered, no day moving | PASS (§2–§3) |
| D | F baseline by duration×partition + by length, matched only | PASS (§4) |
| E | FIT-only fits S/SD/ENU/SL/CL + per-baseline + daily | PASS (§6) |
| F | ANTEX full-vs-subset parity coverage | GAP (EIJS-WARE DOY124 h00 prec byte-identical PASS, but single-leg shared-type coverage only; §17) |
| G | ENU grid spec honored | PASS (h0–40/v0–80/1mm, tie-break, §6) |
| H | VALIDATION among {S,SD,ENU,CL,REVIEW}, frozen | PASS (§7, VAL-only loops) |
| I | TEST once for winner, no changes after | PASS (S, §8) |
| J | Loops n≥10 or MORE_DATA_BLOCKED with proof | PASS (15/15, §9) |
| K | Loop combos documented, no reuse | PASS (models12j8.json, §9) |
| L | Selection rationale per ranking | PASS (S, §7) |
| M | Certification decision + scope | PASS (REVIEW_ONLY_FINAL, §18) |
| N | All-pairs appendix labelled pseudoreplicated | PASS (§4) |
| O | Same-session xcorr by configuration | PASS (§10) |
| P | Graph sensitivity ≥4 sessions + verdict | PASS (5, §11) |
| Q | Broadcast subset + 61mm follow-up | PASS (§12) |
| R | Formal-cov internal consistency | PASS (§13) |
| S | Absolute oracle; TGRN/VOER/WERB status | PASS (EIJS −29.6mm; UNRESOLVED, §14) |
| T | Cross-corpus, never pooled | PASS (§15) |
| U | Resources + FIX rates | PASS (§3, §16) |
| V | ANTEX verdict + DIRECT_INGEST:NO | PASS (§17; verdict REVIEW_ONLY, F stays GAP on coverage) |
| W | No math changes | PASS (no src/ changes; scripts + report + TODO only) |

Local section checklist (unlettered): report §§4–18 complete; length
gate LEVERAGE_OK before ppm fits (§5); scripts committed+pushed, lint 0
errors, typecheck clean, `git diff --check` clean.

## 20. §54 field dump

MODEL_SELECTED=S s=18.111 (FIT n=107); SD={30m:22.72,1h:18.11,2h:19.23,
24h:24.61}; ENU={h:17mm,v:14mm}; SL={s0:0.988,k:0.442} diagnostic;
CL={aH:0mm,aV:11mm,bH:0.5mm/km,bV:0.3mm/km} rejected-overfit-risk
(FIT med 2.37; VAL med 2.93/exc95 0.1633, per-length 1.95–8.56);
VAL_S={med:3.77,exc95:0.2653,n:49}; TEST_S={med:3.77,exc95:0.2619,n:42};
LOOPS_VAL={n:4,S_med:2.07,S_exc95:0.0};
LOOPS_ALL_CONFIRM={n:15,closure_med_mm:31.3,S_med:1.31,S_exc95:0.0};
ORACLE_EIJS_WARE_DLEN_MM=-29.6; CERTIFICATION=REVIEW_ONLY_FINAL;
ANTEX=REVIEW_ONLY (EIJS-WARE-124-h00 parity byte-identical: subset
c0eb7a8b vs full 8715268e, pos 35d89452); MISSION_F=GAP;
SESSION_GRAPH=SPANNING_TREE_SUFFICIENT_INITIAL; DIRECT_INGEST=NO.
