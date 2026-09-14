# Phase 12J.6 — Modern Wettzell GNSS Covariance Calibration

Branch `feat/gnss-raw-modern-covariance-calibration`, baseline `origin/main f6ac0390` (PR #58 merge).
HEAD: see PR. EVIDENCE ONLY — no production ingest, no math changes, no TBC fitting.

Public modern RINEX evidence downloaded locally: YES (~/Downloads/webnet-gnss-modern/wettzell/, never committed).
Production direct ingest added: NO. TBC-fitted covariance: NO. Adjustment/R2B/free-network math changed: NO.

## 0. Baseline (§0)

- `src/workers/gnssRawWorker.ts` (isolated, never touches solve state), `src/engine/gnssStochasticEvidence.ts`
  (`normalizedDifferenceT`, `loopClosureT`, F/S/EnuFloor/CL), `src/engine/gnssRawSession.ts`
  (REVIEW_ONLY, dependency groups), `gnssRawRnx2rtkp.ts` (output `FORMAL_UNCALIBRATED`) — all verified.
- `lint` 0 errors; `typecheck` clean on tracked code (4 errors confined to untracked pre-existing phase9l dirt);
  `test:agent` 3495 pass / 11 pre-existing fails (6 phase9l-parallel + 1 evidence-tier + 1 tier-manifest + 3 study-desktop),
  none GNSS-related. Focused suites: `gnssRawSession` + `gnssStochasticEvidence` 27/27,
  `gnssRawRnx2rtkpWorker` + injection + `tests/gnssRaw/` 59/59.
- No direct-ingest path exists; session surfaces `FORMAL_UNCALIBRATED`.

## 1. Station metadata — HARD GATE CLEAN ×4, interval KEPT (§§1–2)

Window 2025-09-01..05 (DOY 244–248). Sources: IGS station logs + live EPN siteinfo cross-check.

| Station | DOMES / monument | Receiver in window | Antenna+radome in window | Calib class | Bracketing dates |
|---|---|---|---|---|---|
| WTZR00DEU | 14201M010, pillar 1202, concrete tower (1995) | LEICA GR50 SN1831551 FW 4.50/7.710 | LEIAR25.R3 LEIT SN10020031, H 0.0710 | absolute (indiv ROBOT 2010 + IGS type-mean) | Rx 2021-05-18→open; Ant 2010-06-30→open |
| WTZA00DEU | 14201M013, pillar 1204 (1997) | SEPT POLARX2 SN1219 FW 2.6.0 GPS-only | ASH700936C_M SNOW SN12118, H 0.0450 | IGS type-mean | Rx 2017-08-03→2025-10-24; Ant-mount 2021-06-08→open |
| WTZZ00DEU | 14201M014, pillar 1205 (1998) | JAVAD TRE_3 DELTA SN02911 FW 4.1.03 | LEIAR25.R3 LEIT SN10240011, H 0.2840 | absolute dual indiv (ROBOT 2010-08-11 + Bonn chamber 2010-12-03) | Rx 2021-09-01→open; Ant-ecc 2015-07-13→open |
| WTZS00DEU | 14201M015, steel mast 7.5 m (2005) | SEPT POLARX5TR SN3022895 FW 5.6.0 | LEIAR25.R3 LEIT SN10020020, H 0.0560 | absolute dual indiv (ROBOT 2010-04-28 + Bonn 2010-05-25) | FW step 2025-04-14 (before window); Ant 2021-09-21→open |

No receiver/antenna/radome swap, monument event, displacement, or discontinuity inside the window on any
station. Nearest changes (WTZS FW 2025-04-14; WTZA Rx 2025-10-24) are outside. **Gate: CLEAN — keep 2025-09-01..05.**
Four distinct DOMES proven (distinct pillars/foundations + mutual non-zero §5 tie vectors, sign-consistent).

HOFJ00DEU (neighbour, §37): DOMES 14289M001, JAVAD TRE_3S DELTA SN03021 FW 4.5.00 (installed 2025-05-26,
removed 2026-03-11 — window inside), LEIAR25.R4 LEIT SN725266 (since 2020-02-26), CC-BY-4.0. **Gate: CLEAN.**

## 2. Corpus — 2/4 open, CDDIS auth-walled; +HOFJ (§3)

- WTZR: BKG `IGS/obs/2025/244–248` daily 30 s MO.crx.gz + MN.rnx.gz. WTZS: BKG `EUREF/obs/2025/244–248` same.
  HOFJ00DEU: BKG `EUREF/obs/2025/244–248` same (RINEX 3.05).
- WTZA/WTZZ daily absent from BKG IGS+EUREF, EPN-CB, `files.igs.org` (20 direct probes → 404; IGN host
  unreachable/timeout; CDDIS → 302 to Earthdata login, no credentials invented). Structural absence, not a
  5-day gap — no earlier interval would fix it. EPN reports recent data for A/Z, so they publish via
  restricted channels only.
- Runnable corpus: WTZR–WTZS (69 m) + HOFJ–WTZR / HOFJ–WTZS (148.7 km). HOFJ exceeds the §37 1–50 km
  preference (149 km, still far below the 300 km pathology) — documented as the available longer leg.
- Products: IGS final `IGS0OPSFIN` week **2382** (not 2432) ORB 15 min + CLK 5 min, all 5 days; broadcast
  MN per station + supplementary BRDC MN. ANTEX: `igs20.atx` 60,295,761 B, sha256
  `8715268e…f5cffb26de2` (full value in MANIFEST.json).
- Manifest: `wettzell/MANIFEST.json` + `.md` (filename, source URL, SHA256, sizes, station, day).
  Solutions: `solutions/fullday.json` (32), `solutions/subsess_duration.json` (200), all
  `FORMAL_UNCALIBRATED` with obs/nav hashes, options, dependency/window tags.

## 3. RINEX validation (§5)

All 15 obs RINEX 3.04/3.05 Hatanaka `.crx.gz`, parsed 15/15 ( Sleeping Bear: GSI CRX2RNX 4.2.0 binary;
`parseRinexObs` err=null 10/10 on first batch). GPS L1+L2 on all; 30 s cadence; markers/DOMES/antennas/SNs
match logs (WTZR …31, WTZS …20, HOFJ 725266); positions finite.
Gaps: **WTZR DOY 245 ends 14:01:30** (partial file, 1684/2879 epochs); consequently WTZS–WTZR 245-h18 has
no data (NODATA, counted not silently dropped). WTZS headers lack LAST-OBS but sizes are full-day-consistent.

## 4. Antenna calibration — EXACT at type+radome (§§6–7)

Authoritative `igs20.atx` (hash above), exact string matches, no fuzzy logic:

| Endpoint | Entry | Calibration | DAZI | Frequencies |
|---|---|---|---|---|
| WTZR/WTZS LEIAR25.R3 LEIT | exact | ROBOT Geo++ 09-JUN-19, absolute | 5.0 (azimuth-dependent) | 25 |
| HOFJ LEIAR25.R4 LEIT | exact | ROBOT Geo++ 09-JUN-19, absolute | 5.0 | 25 |
| WTZA ASH700936C_M SNOW (for provenance) | exact | ROBOT Geo++ 29-JAN-17, absolute | 5.0 | 4 |

Per-serial individual cals exist via EPN (WTZR/WTZZ/WTZS/HOFJ links recorded) but igs20.atx is type-mean;
the RTKLIB path consumes the exact type+radome entries above. Satellite PCO/PCV: 116 BLOCK-II*/IIR/IIF/III
entries present and consumed (`file-satantfile` set — without it rnx2rtkp fails closed with
`no sat ant pcv`, verified). Receiver and satellite provenance recorded separately in fullday.json.

§10 cleanup (done here): `phase12j2-antenna.md:14` igs14 SHA had 63 hex chars (`d59a41977668af9…`,
`e` dropped). Independently recomputed `sha256sum` of the pinned-tree file → corrected to the 64-char
`d59a419776e68af9…1f685d9e`. igs20 value reverified exact, untouched.

## 5. ANTEX worker feasibility — ANTEX_READY_WITH_SIZE_BOUND (§§8–9, 44–45)

- Worker staging cap 32 MiB (`GNSS_RAW_MAX_INPUT_BYTES`, `DEFAULT_MAX_FILE_BYTES`); full igs20.atx 57.5 MiB
  → full-file staging is NO_GO. Full igs14.atx 17.6 MiB fits but consumes >50% of MEMFS.
- Deterministic subset extraction (bounded read, keep header + wanted TYPE/SERIAL blocks + all satellite
  blocks): **123 blocks, 1,582,058 B, sha256 `4631dcbc…2cc594e7083abb`** — ~5% of cap. Used for every run below.
- Production architecture: main-thread extracts + stages only the subset; never raise global raw-input caps.
  A→B→A determinism proven (identical solution-body SHA256 across reruns; only `%` header paths differ).
  Verdict: **ANTEX_READY_WITH_SIZE_BOUND**. (Worker concurrency/pooling not benchmarked — rate-limited
  environment; single persistent read-only ANTEX cache recommended.)

## 6. Processing policy (frozen, §§11–12)

Static, GPS L1+L2 only, 10° mask, marker via header H/E/N deltas in conf (E/N all zero),
AUTO/common interval, FIXED required for primary corpus. Canonical rnx2rtkp (pinned tree 62d4677):
`-p 3 -f 2 -m 10 -v 3.0 -ti 30 -e -t -sys G [-k conf] [-ts DATE TIME -te DATE TIME (two-arg form)] -r baseXYZ`.
Both ephemerides run for every leg (broadcast MN / IGS-final SP3+CLK); no per-baseline tuning.
Toolchain caveat found: `-ts/-te` take **two** args each; a single quoted datetime is silently ignored
(full-file processing, rc=0). All window runs below use the two-arg form (spot-verified 121 epochs/1 h).
(The 12J.1 cohort scripts use the single-arg form — flagged for 12J.7 to re-check, not relitigated here.)

## 7. Full-day solutions (§§13–14)

3 pairs × 5 days × {broadcast, precise+ANTEX} = 30 + 2 no-ANTEX samples = **32/32 FIXED**
(RS 2876/2879 epochs; HOFJ fixed fractions lower — see §8).

| Pair | L | brdc mean (ECEF m) | prec mean | brdc−prec | ENU scatter brdc/prec (mm) | formal (mm) |
|---|---|---|---|---|---|---|
| WTZS–WTZR | 69 m | (−45.3660,−31.4685,+40.8804) | identical to 0.1 mm | ~0 | (0.34,0.24,0.20)/(0.36,0.23,0.20) | 0.3 |
| HOFJ–WTZR | 148.8 km | (−81409.15…,−91904.99…,+83993.23…) | Δ ~1–2 mm | ~1–2 mm | (83,26,49)/(74,26,53) | 0.4 |
| HOFJ–WTZS | 148.7 km | (−81363.79…,−91873.49…,+83952.36…) | Δ ~1–6 mm | ~mm | (30,31,53)/(29,30,56) | 0.4 |

Reference vectors: full-day precise+ANTEX means (documented in §11 oracle comparison instead of any
single session as truth). Five samples/baseline — pooled only under explicit models below.

## 8. Subsession corpus (§§15–17)

Disjoint 1 h windows 00/06/12/18 UTC × 5 days × 3 pairs × 2 eph = **120 runs, 120 processable, 50 FIXED**
(245-h18 NODATA counted). FIX rates: **RS 95% (19/20)** brdc and prec; HOFJ–WTZR 25%/10%;
HOFJ–WTZS 10%/15%. FLOAT runs recorded separately (ratioMed RS ~260–500 vs HOFJ ~3 — strong QC predictor).
Duration extras (§23): 30 min (RS 100%, HOFJ 20%/0%) and 2 h (RS 100%, HOFJ 30%/20%).

## 9. Formal-covariance repeat test (§§20–22)

Independent disjoint pairs, `T = d′(Ci+Cj)⁻¹d ~ χ²(3)` (repo implementation semantics mirrored;
thresholds 7.815/11.345, median 2.366). Fit/val split predeclared **FIT 244–246 / VAL 247–248** before fitting
(pooled medians were visible during processing, no parameters touched before the split).

| Scope | FIT med / exc95 | VAL med / exc95 |
|---|---|---|
| RS 1 h, F raw | 5.84 / 0.40 | 7.25 / 0.48 |
| RS 1 h, S=1.57 (fit on FIT) | 2.37 / 0.16 | 2.94 / 0.20 |
| RS 30 min F | 2.19 / 0.18 (pooled) | — |
| RS 2 h F | 2.07 / 0.16 (pooled) | — |
| RS 24 h F | 1.43–2.11 / 0.067 (pooled) | — |
| HOFJ 1 h F | ~40 000 / 1.00 | ~40 000 / 1.00 |
| All pairs pooled F | 5.84 / 0.41 | 8.61 / 0.51 |
| All pairs S=14.1 (pooled fit) | 2.37 / 0.18 | med 0.19–3.49 / 0.44 — rejects single scalar |

ENU (§22): RS 1 h FIT scatter vs formal (mm) E 1.35/0.52, N 0.62/0.62, U 1.02/1.21 — optimism is
mild and E-heavy, not isotropic-catastrophic. HOFJ: 20–130 mm observed vs 0.3–2.2 mm formal in all components.

## 10. ANTEX effect (§24)

RS 244 ant vs no-ANTEX: **0.00 mm** vector shift, identical covariance/ratio (both eph). Expected: on a
69 m baseline PCV cancels nearly completely. Modern exact-ANTEX effect is therefore bounded here, unlike
legacy Dataset B (which was blocked, not measured). No evidence for or against cm-level ANTEX effects on
longer baselines from this corpus.

## 11. Broadcast vs precise (§25)

RS: vectors identical to 0.1 mm, T distributions identical (med 5.85/5.85). HOFJ: means differ 1–6 mm,
both equally scattered. **Precise products do not materially improve these short static baselines** with
this configuration. Ephemeris policy for calibration: broadcast (simpler); precise kept as diagnostic.

## 12. Dependence (§§26–27, 40–41)

- Same-session triangles (4 available, diagnostic only): closure RMS **9.9 mm** — all-pairs are NOT
  independent observations; exporting them as such stays prohibited.
- Shared-station error correlation (U, brdc): RS×RH r=0.53–0.61 (n=5–20, scales 0.2–2 mm vs 50–273 mm) —
  materially detectable common-epoch correlation; confounded by scale mismatch, reported as-is.
- Independent-time loops (§§28–29, predeclared rotation): **0 complete** — HOFJ 1 h FIX rate too low to
  close a single disjoint triangle. Full-day star-vs-chain (HOFJ via WTZR direct vs via WTZS): **35.8 mm**
  — tree choice matters at that level for 149 km. Deterministic spanning-tree/operator-selected graph
  policy retained; all-pairs default export stays OFF.

## 13. Models (§§30–36)

- F raw: RS short-baseline near-calibrated (24 h exc95 6.7%; 30 min/2 h Tmed ~2.1); HOFJ rejected (10⁴×).
- S=1.57 (RS FIT median-matched): VAL med 2.94, exc95 **0.20**, exc99 0.10 — improved 48%→20% but still
  4× nominal tails. Not accepted as calibrated.
- ENU floors from RS FIT: E ~1.2 mm, N/U ~0 — consistent with S finding; same VAL limitation.
- CL closed-form (RS fixes c, HOFJ fixes ppm): cH≈0.1–0.6 mm, **ppmH≈260–420, ppmV≈85** — physically
  uninterpretable (true error is dm-level vector scatter, not ppm growth); adopted CL collapses T→0.03
  (vacuous overcoverage). **Rejected.**
- EMP: not introduced (existing forms already diagnose the structure).
- Scope note (§31, enforced): Wettzell-internal baselines are 69 m; the only longer leg is 149 km with
  non-survey-grade vectors. **No ppm coefficient is identified**; nothing extrapolates to 5–20 km, let alone 20 km.

## 14. Longer-baseline search (§37)

HOFJ (149 km) doubles as the available longer leg; KUNZ00CZE (~70 km listings confirmed at BKG, not
downloaded) and GOPE00CZE are the named next candidates. Remaining requirement for any broader model:
a 1–50 km exact-ANTEX dual-frequency repeated-days stable-monument corpus (KUNZ first), plus a
long-baseline processing configuration whose *vectors* (not just covariances) validate.

## 15. External coordinate oracle (§§18–19)

EPN C2400 (ETRF2000) propagated to 2025.667 vs full-day precise+ANTEX means:

| Baseline | Coordinate-derived | RTKLIB | |Δ| |
|---|---|---|---|
| WTZS–WTZR | (−45.3619,−31.4678,+40.8855) | (−45.3660,−31.4685,+40.8803) | **6.7 mm** |
| HOFJ–WTZR | (−81409.2679,−91905.0284,+83993.3141) | (−81409.1518,−91904.9974,+83993.2323) | **~146 mm** |

Repeatability validation and absolute validation agree: RS vectors are survey-grade (mm), HOFJ 149 km
vectors with this configuration are not (~1 ppm absolute bias + dm scatter). Frame caveat: ETRF2000 vs
IGb20/WGS84 differ, but common-mode over 69 m; the 146 mm HOFJ gap exceeds any frame explanation.

## 16. Resources (§§42–43)

Sequential CLI batch: 32 full-day + 200 sub-daily runs completed in minutes on a workstation
(~1–3 s per 1 h run, full-day runs similarly fast for these small networks; IGS-final SP3 ingest is
trivial). Peak RSS not instrumented (CLI, not browser) — browser/Node WASM memory, multi-worker pools,
and the ~60 MB ANTEX copy problem were NOT measured here; worker-concurrency comparison deferred to a
browser-harness phase. Standing recommendation: single persistent read-only subset cache (1.58 MB,
§5 provenance), never one full-ANTEX copy per job.

## 17. Acceptance A–W (§49)

A distinct DOMES proven §1. B stable 5-day interval proven §1 (+HOFJ). C corpus downloaded+hashed §2
(2/4 open + HOFJ; A/Z documented miss). D GPS dual-frequency proven §3. E exact ANTEX proven §4.
F RTKLIB ANTEX/satellite use proven §4 (fail-closed without). G full-day repeats 32/32 §7.
H disjoint-window repeats 120 + 80 §8. I normalized-T tests executed §9. J ENU analyzed §9.
K ANTEX effect measured (0.00 mm RS) §10. L brdc/prec measured (immaterial) §11.
M same-session dependence measured §12. N independent loops attempted, 0 closable + full-day
star-chain 35.8 mm §12. O split frozen before fitting §9. P fitted on FIT only §13.
Q held-out VAL completed §9/§13. R short-baseline limitation enforced §13. S longer search done §14.
T spanning-tree policy retained §12. U batch resources recorded (CLI-level) §16.
V no direct ingest (verified absent) §0. W no adjustment/math/tolerance changes (git: docs+TODO only).

## 18. Decisions (§50)

- Covariance: **REVIEW-ONLY**. No candidate meets §35 on held-out (S=1.57 VAL exc95 0.20; CL vacuous;
  pooled scalar rejected; HOFJ vectors themselves not survey-grade). Strongest sub-results, kept as
  evidence-only priors for 12J.7: 24 h/69 m F-raw (exc95 6.7%) and sub-daily RS S≈1.5–1.6.
- ANTEX: **ANTEX_READY_WITH_SIZE_BOUND** (deterministic 1.58 MB subset; full-file worker staging NO_GO).
- DIRECT_INGEST: **NO**.

## 19. Recommended 12J.7

1. Fetch KUNZ00CZE (~70 km? verify actual) + GOPE for a true 1–50 km leg; re-run this exact matrix.
2. Re-check 12J.1 cohort `-ts/-te` single-arg windows (§6 caveat).
3. Improve 149 km processing (longer sessions, network adjustment) until *vectors* validate, then revisit CL.
4. Browser-harness batch/concurrency + WASM memory measurements (§16 gaps).
5. Confirm RS S≈1.5–1.6 on fresh days before any production-weighting proposal (production covariance stays
   `FORMAL_UNCALIBRATED`).

Then STOP. Direct adjustment ingestion stays OFF.
