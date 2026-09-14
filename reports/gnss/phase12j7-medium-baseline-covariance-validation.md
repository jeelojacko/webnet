# Phase 12J.7 — Medium-Baseline GNSS Covariance Validation (Stage 2, evidence only)

Date: 2026-09-14. Branch: `feat/gnss-raw-medium-baseline-covariance-validation`.
Stage 1 (commit `bb027a74`): corpus + ANTEX subset scripts. This stage: processing +
analysis + report. **No `src/` production changes. No direct ingest. No TBC fitting.
No constellation widening. No math/R2B/free-network/tolerance changes.**

## 1. Metadata

- Corpus (local-only): `~/Downloads/webnet-gnss-medium/belgian/` — 20 RINEX (4 stations ×
  DOY 124–128), 4 sitelogs, 5× CODE final SP3, per-day broadcast NAV, ANTEX subset,
  `MANIFEST.sha256`. FIT DOY 124–126, VAL 127–128 (frozen).
- Processing policy (frozen, one set, no per-baseline tuning): GPS-only L1/L2 STATIC FIXED,
  10° mask, MARKER_TO_MARKER_ECEF (ARP→marker via sitelog up-offsets; WARE ΔH=0.5180,
  all others 0.0), exact ANTEX subset (rcv+sat), precise SP3 primary + bounded broadcast
  comparison on representative windows.
- CLI: `/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp`, flags
  `-p 3 -f 2 -m 10 -sys G -e -t + -k conf` (`pos1-sateph=precise` for precise runs),
  `file-rcvantfile/file-satantfile`=subset, `ant2-postype=rinexhead`,
  per-station anttype/delE/delN/delU from sitelogs, `-r` base marker ECEF **after** `-k`
  (stage-1 gotcha; verified `-r` wins), two-arg `-ts/-te`.
- Driver: `scripts/gnss/gnss12j7Process.sh` (deterministic, `set -euo pipefail`,
  fail-closed xargs workers, content-checked skip — header-only .pos reruns,
  per-worker timing files merged sorted, `PAR=` workers). Inventory:
  `scripts/gnss/gnss12j7CorpusInventory.mjs` (75-file manifest: RINEX .gz +
  decompressed rnx inputs + broadcast NAV + sitelogs + SP3 + ANTEX subset,
  fail-closed). No reprocessing in the fix round — solutions already complete.
  Analysis: `scripts/gnss/gnss12j7Analyze.py` (parse/repeatability/T/length-fit/broadcast),
  `scripts/gnss/gnss12j7Models.py` (loops/dependence/candidates/bias/QC/perf),
  `scripts/gnss/gnss12j7SessionGraph.ts` (engine session/tree helpers, read-only).
  Solutions: `work12j7/solutions.json`, stats: `work12j7/analysis.json` + `models.json`
  (local-only, not committed).
- Engine semantics mirrored in analysis: T=d′(Ci+Cj)⁻¹d ~χ²(3), thresholds
  7.815/11.345/median 2.366; engine `ecefToEnuRotation` (geocentric latitude); floors
  added in ENU then rotated back; SPD gate finite/symmetric/leading-minors, no jitter.

## 2. Baseline lengths

| Baseline | Role | Sitelog chord (m) | Solution mean 1h (m) | dlen |
|---|---|---|---|---|
| WARE–TGRN | STAR 10–20km | 18712.207 | 18711.840 | −367mm |
| WARE–VOER | STAR 25–40km | 33687.763 | 33687.436 | −327mm |
| WARE–WERB | STAR 40–60km | 45907.975 | 45907.881 | −94mm |
| TGRN–VOER | leg | 16466.554 | 16466.558 | +4mm |
| VOER–WERB | leg | 41811.667 | 41811.188 | −479mm |
| TGRN–WERB | leg | 45441.982 | 45441.661 | −321mm |

Sitelog chords computed from sitelog XYZ (brief §9 geodesics 18.712/33.687/45.905 km are
rounded ellipsoidal values, not chords — not used as truth). All dlen within the
sitelog-truth formal error (~0.5m, brief §3/§8).

## 3. Hashes

- ANTEX subset `belgian-subset.atx`: 2,362,293 bytes, sha256 `c0eb7a8b…` (stage 1).
- RINEX crx.gz: `MANIFEST.sha256` (e.g. DOY124 SP3
  `a336187c…`; per-file lines in corpus).
- DOY127 BRDC (replacement, see §5): `BRDC00IGS_R_20261270000_01D_MN.rnx`
  sha256 `d44d809f…` (11,791,349 bytes), via `https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/127/`.

## 4. Licences

Per-dataset CC-BY-4.0 + DOI `https://doi.org/10.24414/ROB-GNSS-{ID}` (brief §6);
legacy ROB website-policy ambiguity flagged, not resolved. EPN assets default CC BY 4.0.

## 5. Antenna proof (type-mean)

Subset carries type-mean for `TRM59800.00 NONE`, `LEIAR25.R3 LEIT`, `LEIAR25.R4 LEIT`
(used: WARE TRM59800.00 NONE ΔH 0.5180; TGRN/VOER LEIAR25.R3 LEIT; WERB LEIAR25.R4 LEIT,
all Δ 0.0). No serial-specific entries — same model as the EPN C2400 cumulative oracle.
RTKLIB applies conf `antdel` as the single marker→ARP offset (RINEX header deltas
ignored when anttype is explicit — verified in source); no double count.

## 6. Completeness

Matrix (disjoint, no sliding windows): STAR 3×5d×(4×1h + 2×brdc-1h + 2×30m + 1×2h + 1×24h);
legs 3×5d×4×1h — **210/210 attempted, 210 with solution epochs, 0 NODATA (final)**.
- DOY127 blocker encountered and cleared: stage-1 `ade31270.26n.Z` parses as RINEX but
  yields zero solutions in this RTKLIB build (relative and single-point mode alike;
  health/URA/TOE all nominal — root cause undetermined, checksums kept). Replaced with
  the IGS merged daily BRDC from BKG (same product class); 6/6 DOY127 broadcast windows
  then solved. Frozen policy kept (no per-baseline tuning).

## 7. FIX rates

| Class | Attempted | FIXED (Q1) | FLOAT | Failed |
|---|---|---|---|---|
| Precise 1h (STAR) | 60 | 60 (100%) | 0 | 0 |
| Precise 1h (legs) | 60 | 57 (95%) | 3 | 0 |
| Broadcast 1h (STAR h00/h12) | 30 | 30 (100%) | 0 | 0 |
| Precise 30m (STAR) | 30 | 29 (97%) | 1 | 0 |
| Precise 2h (STAR) | 15 | 15 (100%) | 0 | 0 |
| Precise 24h (STAR) | 15 | 15 (100%) | 0 | 0 |
| **Total** | **210** | **206 (98.1%)** | **4** | **0** |

FLOAT runs (diagnostic, excluded from primary pools): TGRN-WERB-126-h00-prec (ratio 1.9),
VOER-WARE-126-m00-prec (1.1), VOER-WERB-124-h18-prec (1.1), VOER-WERB-126-h00-prec (2.4).

## 8. Absolute-length evidence (LENGTH-ONLY)

Oracle is one-sided (brief §3): only WARE has an EPN cumulative coordinate
(IGS20/ITRF2020 @2020.0: 4031947.98556, 370150.29105, 4911906.13636; →2026.35:
4031946.8985, 370151.3995, 4911906.2009). **No absolute-vector claim** is made;
sitelog formal error ~0.5m noted. Length evidence: §2 table — all six baselines agree
with sitelog chords to ≤0.48m. Length error by duration for STAR (mean |dlen| vs sitelog chord): 30m 0.25m /
1h 0.26m / 2h 0.26m / 24h 0.26m — duration-invariant at the truth-caveat level
(truth, not solutions, is the limit).

## 9. Repeatability (precise FIXED)

Per baseline/duration, ENU obs σ / formal σ (mm), 3D RMS (mm):

| Pair/dur | n | E | N | U | rms3d |
|---|---|---|---|---|---|
| TGRN-WARE 30m | 10 | 8.3/0.6 | 5.0/1.0 | 13.0/1.5 | 16.2 |
| TGRN-WARE 1h | 20 | 5.7/0.5 | 7.2/0.6 | 14.6/1.2 | 17.2 |
| TGRN-WARE 2h | 5 | 2.9/0.4 | 4.0/0.5 | 9.8/1.0 | 11.0 |
| TGRN-WARE 24h | 5 | 2.5/0.2 | 2.0/0.2 | 5.7/0.4 | 6.6 |
| VOER-WARE 30m | 9 | 16.8/0.6 | 19.6/1.0 | 21.5/1.6 | 33.6 |
| VOER-WARE 1h | 20 | 12.7/0.5 | 18.6/0.6 | 44.3/1.4 | 49.7 |
| VOER-WARE 2h | 5 | 6.6/0.4 | 8.6/0.5 | 14.9/1.0 | 18.4 |
| VOER-WARE 24h | 5 | 5.5/0.3 | 1.9/0.2 | 12.0/0.4 | 13.3 |
| WERB-WARE 30m | 10 | 14.2/0.6 | 52.3/1.2 | 99.6/1.8 | 113.4 |
| WERB-WARE 1h | 20 | 14.5/0.6 | 15.2/0.7 | 49.0/1.4 | 53.3 |
| WERB-WARE 2h | 5 | 12.0/0.4 | 11.4/0.4 | 20.0/1.0 | 25.9 |
| WERB-WARE 24h | 5 | 5.0/0.3 | 5.7/0.2 | 13.7/0.4 | 15.6 |
| TGRN-VOER 1h | 20 | 7.2/0.5 | 5.7/0.6 | 17.3/1.2 | 19.6 |
| VOER-WERB 1h | 18 | 11.2/0.5 | 21.1/0.7 | 40.6/1.4 | 47.1 |
| TGRN-WERB 1h | 19 | 12.5/0.5 | 17.9/0.7 | 42.6/1.4 | 47.9 |

Formal-vs-empirical: observed/formal ratios ≈ 10–35× (horizontal) and 12–55× (vertical).
Formals are sub-mm horizontal at 1h; empirics are cm-level with clear length growth.

## 10. Normalized T (raw formal F)

PRIMARY pools are MATCHED PAIRS (independence-aware): greedy chronological pairing
within each (pair, dur, split) cell — each solution in at most one contrast.
Effective n is stated everywhere; all-pairs contrasts are pseudoreplicated
(each solution reused many times) and kept ONLY as a diagnostic appendix below.

| Pool (matched) | n | mean | med | p95 | p99 | >95% | >99% |
|---|---|---|---|---|---|---|---|
| 30m all | 14 | 2917 | 1023 | 14517 | 14517 | 100% | 100% |
| 1h all | 58 | 1121 | 655 | 4318 | 5350 | 100% | 100% |
| 2h all | 6 | 1087 | 291 | 3195 | 3195 | 100% | 100% |
| 24h all | 6 | 1513 | 1001 | 4493 | 4493 | 100% | 100% |
| 1h by length: 18.7k | 10 | 409 | 364 | 729 | 729 | 100% | 100% |
| 1h by length: 33.7k | 10 | 1052 | 932 | 2115 | 2115 | 100% | 100% |
| 1h by length: 45.9k | 10 | 1848 | 1319 | 4318 | 4318 | 100% | 100% |
| 1h STAR FIT | 18 | 1042 | 701 | 4318 | 4318 | 100% | 100% |
| 1h STAR VAL | 12 | 1194 | 914 | 4301 | 4301 | 100% | 100% |

Raw formals rejected at ~100% on matched-pair contrasts (within-baseline
no-reuse; cross-baseline sessions share anchor obs — correlated per §11,
characterization only): the processor's internal
precision is not survey weighting (consistent with 12J.6 short-baseline pattern,
larger scale here). Underpowered per-cell n (6–18) cannot resolve duration-specific
scales — no per-duration claim is made.

Diagnostic appendix (PSEUDOREPLICATED all-pairs, do not cite as evidence):
30m n=126 med 979; 1h n=1084 med 869; 2h n=30 med 646; 24h n=30 med 1308;
1h FIT n=198 med 802; 1h VAL n=84 med 786. Same qualitative direction, inflated n.

Broadcast-vs-precise same-window T (n=30, each window used once): med 4.9,
exc95 33% — ephemeris class matters far less than the formal optimism;
broadcast dlen vs precise: mean +3.0mm, max |61.2|mm.

## 11. Same-session dependence

1h precise error cross-correlation for shared-endpoint pairs (20 shared windows):
TGRN-WARE×VOER-WARE (share WARE): X 0.69 / Y 0.89 / Z 0.61;
TGRN-WARE×WERB-WARE: 0.21/0.63/0.45; VOER-WARE×WERB-WARE: 0.55/0.56/0.73.
Legs sharing a rover show weak/negative correlation (e.g. TGRN-WARE×TGRN-VOER:
−0.51/−0.70/−0.75). Dependence is real and session-structured; all cross-baseline
same-window pairs are OUT of the matched T pools by construction (pools are
within-pair, disjoint windows only; cross-baseline sessions sharing anchor
obs remain correlated per above).

## 12. Independent loops (characterization only)

Triangle TGRN-VOER + VOER-WERB − TGRN-WERB, STRICTLY independent: one loop/day on
fixed disjoint windows (h00, h06, h12) — no solution-row reuse across loops,
non-overlapping windows within each loop. **5/5 loops closed** (FIT 3 / VAL 2).
Closure |mm|: med 65.0, max 85.8. Loop T raw: med 1614, exc95/99 100% (n=5).
Under frozen S=17.2: FIT med 6.72 (n=3, 1 exc95), VAL med 2.61 (n=2, 0 exc);
under frozen ENU: FIT med 7.74 (n=3), VAL med 2.81 (n=2). VAL loop n=2 cannot
validate anything — reported for the record only.

COMBINATORIAL BLOCKER for ≥10 (acceptance D: BLOCKER-PROVEN, not met): each day
offers 4 disjoint 1h windows; one loop consumes 3 distinct windows (legs must not
share a session), leaving 1 unused window that cannot form a second disjoint
triple → max 1 independent loop/day. 5 days → max 5. ≥10 needs ≥10 days (or ≥6
disjoint windows/day) — neither available in this corpus. Loop evidence is
characterization-only.

## 13. Length dependence

Raw observed/formal FIRST (STAR 1h, §9): H obs 6.5→15.9→14.8mm vs formal 0.6mm;
V obs 14.6→44.3→49.0mm vs formal 1.2–1.4mm. Non-monotonic H (33.7km > 45.9km),
so any ppm fit is weak by inspection. Fit (3 points, 1 dof — WEAK, reported for the
record): H constant-floor 12.39mm; const+ppm a=1.92mm, b=0.319mm/km.
V constant-floor 35.94mm; const+ppm a=−6.37mm (unphysical intercept), b=1.291mm/km.
Conclusion: length growth is real (esp. vertical) but 3 length groups cannot identify
a ppm law — feeds the CL rejection below.

## 14. Candidates (fit FIT-matched only; frozen; VAL-matched held out)

- F (raw formal): rejected by §10 (≈100% exceedance on matched-pair contrasts).
- S (single scalar): **s = 17.208 → 17.2** from FIT-matched median T=700.6 (n=18).
  FIT-matched scaled: med 2.37, exc95 11.1% (2/18), exc99 5.6% (1/18).
  VAL-matched: med 3.09, exc95 8.3% (1/12), exc99 8.3% (1/12).
  Descriptively plausible (median near χ²(3) 2.37) but n=12 VAL is underpowered —
  exceedance rates have ±20pp-scale binomial noise; NOT a certification.
- ENU floor (grid search, deterministic): **h = 10.0mm, v = 32.0mm** (FIT-matched
  med 2.37). VAL-matched: med 2.67, exc95 16.7%, exc99 8.3% — heavier tails than
  S on held-out data.
- CL (aH,bH,aV,bV): **REJECTED as underidentified** — 4 parameters on 3 length groups
  (§13); fitting it would be numerology. More distinct lengths required first.
- Selected: **none certified**. S = 17.2 retained as an evidence-only prior
  (characterization only); ENU recorded for the record. Loop holdout under frozen
  S: VAL med 2.61 on n=2 — record only (see §12).

## 15. Held-out summary (VAL 127–128, matched, no refitting)

STAR-1h S=17.2 (n=12): med 3.09 / p95 14.52 / exc95 8.3% (1/12) / exc99 8.3% (1/12).
Loops S (n=2): med 2.61, no exceedances — record only. ENU tails heavier.
FIT/VAL raw medians agree in direction (701 vs 914) — no regime shift across the
split beyond small-sample noise. With n=30 total matched contrasts, exceedance
rates are underpowered: this is characterization, not validation.

## 16. Session graph

One window (DOY124 h00, 6 baselines, WARE fixed): engine `composeSession` unions all
members into **1 dependency group** (shared RINEX inputs) with a shared-observation
warning; `selectSpanningTree` deterministically selects the **STAR** (WARE hub).
Weighted LS: STAR vs MST(operator: shortest-total-length tree TGRN-VOER/TGRN-WARE/
VOER-WERB) vs full-graph on DOY124 h00: |STAR−FULL| ≤ 6.7mm, |MST−FULL| ≤ 7.0mm,
|STAR−MST| ≤ 11.9mm per station; FULL dof=9, SEUW=3.5 (formal-cov optimism artifact,
same direction as §10). Independent-data check (fix round): reran the same
deterministic comparison on the h00 window of DOY125/127/128 (DOY126 h00 not
checkable — VOER-WERB leg is FLOAT there, a documented §7 exclusion). Engine tree
pick varies by day (data-dependent, deterministic); verdict
SPANNING_TREE_SUFFICIENT_INITIAL on all 4 checkable windows; worst-day
|STAR−FULL| 22.0mm (DOY125 WERB). Tree-choice sensitivity is mm-to-cm.
**Verdict: SPANNING_TREE_SUFFICIENT_INITIAL** (for 4-station short sessions;
revisit if cross-covariance terms are ever modelled).

## 17. Systematic bias gate

Mean length bias vs sitelog chord ≈ −0.26m (range +0.004…−0.48m), all within the
~0.5m sitelog-truth formal error → **not significant; separated from covariance**
(repeatability T is reference-free and unaffected). Likely truth-side (stale/epoch-free
sitelog approximate coords in an IGS20/CODE-final world) rather than orbit/antenna/
processor — orbit class bounded by §10 broadcast delta (mm-level). **Covariance was not
inflated to hide bias** (S fit uses reference-free pairwise T only).

## 18. Ratio/QC

FIXED ratios: min 3.0 (the AR validation threshold — by construction), med 6.1,
max 152.8. FLOAT ratios 1.1–2.4. FIXED≠guaranteed: raw T up to ~10⁴ occurs among
ratio-fixed solutions, so a conservative ratio gate alone does not certify agreement;
the characterization-only scale S (not certified) is the backstop, not the ratio.

## 19. Performance

Per-run wall (single worker class): 30m mean 0.6s, 1h 0.5s, 2h 0.6s, 24h 1.5–1.6s
(max 2s). Full 210-run matrix: PAR=1 wall 131s vs PAR=2 wall 66s (CPU ≈122s both;
speedup 1.98×). Peak RSS 87MB (24h run incl. SP3+obs+ANTEX). **Recommend bounded
concurrency PAR=2** (4 unjustified; each worker re-reads the 2.36MB ANTEX subset —
trivial duplication). Timing records are deterministic (per-worker files merged
sorted). 32MiB cap untouched (not applicable to the CLI harness).

## 20. ANTEX bound

Subset 2,362,293 bytes vs full `igs20.atx` 60,295,761 bytes (~25×). All needed rcv
types + GPS sats present; parse/memory cost negligible (see §19); per-worker
duplication trivial; byte-identical subset-vs-full check from stage 1 retained.
**Retain the subset bound; full ANTEX unjustified.**

## 21. Certified scope

**No certified scope.** S=17.2 is characterization only (evidence-only prior:
descriptively plausible FIT-matched + VAL-matched medians, exceedance rates
underpowered at n=30 total). Characterized but NOT calibrated: 1h STAR (matched
n=18/12), 30m/2h/24h (matched n=14/6/6 — no per-duration claim), broadcast
(bias/repeatability delta only), legs beyond loop use, loops (n=5, blocker-proven).
No absolute vectors. No TBC fit. No cross-covariance.

## 22. Acceptance self-check (A–U mapping to frozen gates)

A disjoint repeats processed (210/210, no sliding windows) ✓ · B FIX rate reported
(§7: 98.1%) ✓ · C T by length, matched (§10) ✓ · D ≥10 loops BLOCKER-PROVEN
(5 max, §12) ✗-as-blocker · E FIT/VAL frozen (124–126/127–128), matched within cell ✓ ·
F held-out done, no refitting (§15) ✓ · G no TBC fit ✓ ·
H bias separated, not absorbed (§17) ✓ · I graph tested on 4 independent windows,
verdict returned (§16) ✓ · J ANTEX bound retained (§20) ✓ · K direct ingest off ✓ ·
L no adjustment/math changes (no `src/` diff) ✓ · M broadcast comparison bounded,
same-window (§10) ✓ · N dependence measured (§11); matched-pair PARTIAL — within-baseline no-reuse,
cross-baseline sessions share anchor obs (correlated, characterization only),
§10–11 PARTIAL · O length dependence raw-first,
CL rejected with reason (§13–14) ✓ · P ratio gate assessed, FIXED≠guaranteed (§18) ✓ ·
Q performance measured, PAR=2 recommended (§19) ✓ · R licenses + DOIs recorded (§4) ✓ ·
S antenna type-mean proof (§5) ✓ · T completeness + DOY127 blocker documented (§6) ✓ ·
U no certified scope; S=17.2 characterization only (§21) ✓.

## 23. Decisions

- Model: **REVIEW_ONLY** — scalar S=17.2 for 1h medium baselines is an
evidence-only prior (matched n=30 total underpowered; VAL loop n=2 record-only).
  MEDIUM_MODEL_VALIDATED rejected: independence-aware effective n (≈18 FIT / 12 VAL)
  plus 5 blocker-capped loops cannot establish it. MORE_DATA specified: ≥10 days
  (or ≥6 disjoint windows/day) for ≥10 independent loops + CL/ppm identification
  and duration-specific scales.
- SESSION_GRAPH: **SPANNING_TREE_SUFFICIENT_INITIAL** (survives 4-window
  independent-data check; DOY126 gap documented).
- ANTEX: **retain 2.36MB subset bound**.
- DIRECT_INGEST: **NO** (evidence stays offline; no production ingest path touched).
