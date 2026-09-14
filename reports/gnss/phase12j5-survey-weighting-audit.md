# Phase 12J.5 — Raw-GNSS Survey Weighting + Session-Dependence Audit

EVIDENCE / ARCHITECTURE ONLY. No automatic adjustment ingestion, no empirical
TBC-fitting, no adjustment/R2B/free-network/Phase12D math changes, no multi-GNSS
production, no silent antenna substitution.

Branch `feat/gnss-raw-survey-weighting-audit`, baseline `origin/main f0307938`
(PR #57 merge). Baseline validation: raw tests 38/38, worker/injection 21/21,
`lint` 0 errors, `typecheck` clean except pre-existing untracked phase9l dirt
(`runSessionAsync.ts` etc. — untouched, out of scope); S32/S31 smokes are
local-only vendor runs (never committed), cited from 12J.1–12J.3. No production
raw result is adjustment-active (isolation guard retained, 12J.4).

---

## 1. TWO PRECISION CONCEPTS (FROZEN)

A. **PROCESSOR FORMAL COVARIANCE** — produced by RTKLIB (post-fix conditional
filter covariance, ECEF, base exact, no rescaling; 12J.1 source audit). Metadata:
`model: RTKLIB_FORMAL`, `calibration: UNCALIBRATED`,
`status: FORMAL_UNCALIBRATED`. Represents conditional precision under RTKLIB's
internal stochastic model. Nothing more.

B. **SURVEY-NETWORK COVARIANCE** — covariance suitable for weighting a processed
baseline as an observation in WebNet's network adjustment. NOT automatically the
same as (A). Determining a valid mapping is the purpose of this phase.

## 2. TBC IS A COMPARATOR, NOT TRUTH

TBC covariance is session-estimated (12J.3 §16: same physical baseline appears
3× with different SD/correlation structure) — it is a commercial estimator's
output, not physical truth. Goal is a stochastic model validated from repeats,
closures, known geometry, independent solutions, and documented measurement
models. No covariance was fitted to TBC in this phase (`git diff origin/main
--stat -- src/` contains only new evidence-only files; zero modifications).

---

## 3. MODERN VALIDATION CORPUS (RECOMMENDED, NOT YET FETCHED)

Live-source inventory (licenses verified by fetch, no bulk download per mission):

| # | Corpus | License | Both-end ANTEX? | Repeats | Triangle? | Verdict |
|---|--------|---------|-----------------|---------|-----------|---------|
| 1 | IGS co-located cluster (Wettzell WTZR/WTZZ, Onsala ONSA/ONS1, Zimmerwald ZIMM/ZIM2/ZIM3) | IGS Terms of Use: open, no restriction, attribution required | YES (LEIAR25/TRM59800-class + sitelogs) | 3–7 consecutive daily sessions | YES (tens-of-metres triangle) | FETCH FIRST |
| 2 | NOAA CORS triangle via AWS (3 stations, 5–20 km) | US public domain | YES (verify per sitelog) | Unlimited daily | YES (hand-picked) | RUNNER-UP / US-only mandate |
| 3 | EarthScope NOTA (P041/P043-class) | Open w/ mandatory citation; bulk-redistribution terms portal-specific | YES (verify) | Continuous | Sometimes | SECOND SOURCE |
| 4 | RTKLIB bundled test/data | BSD-2 | NO (no heights/metadata) | NO | NO | parser smoke only |

First-fetch recipe: 3 stations × 5 consecutive days daily 30 s RINEX + IGS `brdc`
NAV + `igs20.atx` (once) + 3 sitelogs (once) ≈ 15–75 MB → 15 solutions +
5 triangle closures. Keep raw files out of git; vendor only derived
vectors/closures/config + `SOURCES.md` (URLs, DOIs, sitelog dates, IGS citation).
Verify cluster membership in `network.igs.org` before fetch (WTZS is VGOS).

## 4. PRIOR CORPUS AUDIT

- Repo-local: only synthetic fixtures (`tests/fixtures/gnssRaw/`, <100 KB,
  `SYN-GENX00 NONE`, zero heights) — parser/preflight gates only, never
  stochastic evidence.
- No RTKLIB sample obs corpus vendored (`third_party/rtklib/` = source + PIN +
  license only).
- Legacy Dataset B: rover TRM60158.00 NONE absent from every product (12J.3) —
  cannot serve as antenna/stochastic oracle. Retained only as a secondary
  comparator (§29).
- No third-party data committed in this phase. No vendor bytes in the tree.

## 5. FIELD-CORPUS SPEC (FALLBACK)

3 stable marks in a triangle (50 m–10 km sides); ≥3 sessions on 2 different days,
≥2 h each (prefer 4 h), re-setup between sessions; 1 s or 5 s static, 10° mask,
GPS L1/L2 minimum; both endpoints IGS-calibrated models present in `igs20.atx`
(e.g. LEIAR25.R4, TRM59800.00), ARP height taped twice + photographed, same
radome state; publish markers/heights/RINEX/config; validate by per-session loop
closure + day-to-day repeatability.

---

## 6. ANTENNA CALIBRATION PRODUCTION PATH (AUDIT)

Vendored-source facts (`third_party/rtklib/src/options.c:168-180,190-191`,
`postpos.c:881,903-911,964-982`, `rtkcmn.c:2536+`):

- `-k` conf keys exist: `file-rcvantfile`, `file-satantfile`, `ant1-anttype`,
  `ant2-anttype`, `ant1/2-antdel{e,n,u}`. `*` = adopt RINEX station descriptor;
  empty = uncorrected; lookup is `searchpcv` exact-match — **no fuzzy
  substitution in the engine** (unmatched → `no receiver antenna pcv` trace +
  type cleared, correction silently off for that endpoint).
- Production Worker today has NO ANTEX path: only `-k` content is
  `pos1-sateph=precise` (`gnssRawRnx2rtkp.ts:275-292`); antenna status is
  unconditionally `CALIBRATION_UNAVAILABLE`/`NONE` (preflight notes calibrated
  statuses unreachable; MVP doc records deferral with reason).

Blockers to production ANTEX:

1. `igs20.atx` (60 MB) exceeds both the 32 MiB per-file stage cap and comfortable
   WASM heap (`INITIAL_MEMORY=128MB`) — a per-job trimmed ANTEX subset
   (exact records needed + satellite block) must be extracted evidence-side.
2. Endpoint-specific `ant1/ant2-anttype` must come from the RINEX header's exact
   model+radome string with `*` semantics verified, or explicit operator mapping
   (EXPLICIT_MAPPING state) — never guess.
3. Satellite PCV (`file-satantfile`) on/off changes the solution datum content;
   12J.3 §29 measured sat-PCV share ≈ 0.1 mm on S32 (negligible) but the
   receiver-PCO ARP→APC re-basing moves vectors ~101 mm (12J.3 §10) — any ANTEX
   enablement must re-run the marker-reduction consistency check.
4. Provenance: ANTEX bytes hash + source identity must enter `provenance`
   (schema slot reserved, §31).

## 7. ANTEX RESULT STATES (RETAINED FROM 12J.4)

Per endpoint EXACT / EXPLICIT_MAPPING / UNAVAILABLE / UNKNOWN; whole baseline
COMPLETE / PARTIAL / NONE. PARTIAL is never called calibrated. Type contract
already carries these states (`gnssRawTypes.ts`).

## 8. MODERN EXACT-CALIBRATION ORACLE (NOT RUN — NO CORPUS YET)

Matrix A–E (no-ANTEX / receiver / receiver+satellite / broadcast / precise) is
specified and the harness hooks exist (SP3 path proven, `-k` conf path proven),
but there is no modern dual-calibrated corpus in-tree to run it on. First run is
queued behind the §3 fetch. Legacy rover rungs C–E remain unrunnable (12J.3 §14).

## 9. SP3 PRODUCTION VALIDATION (AUDIT, CITED)

Worker behavior (scout-verified): precise requires BOTH `options.precise` and
`job.sp3` (`ephemerisUsed: PRECISE` iff both); SP3-staged-but-broadcast →
ignored + warning; precise-without-SP3 → preflight `PRECISE_PRODUCT_MISSING`
fail-closed (driver alone would report requested-PRECISE/used-BROADCAST, so
preflight is the load-bearing guard). Only CLI path to precise is the `-k`
`pos1-sateph=precise` conf (SP3-as-input alone stays broadcast — 12J.2 ladder).
Frame label: SP3 header token or `PRODUCT_FRAME_UNKNOWN`; broadcast:
`WGS84(G1150)-class/broadcast`. CLI↔WASM parity exact incl. SP3 legs (12J.1,
12J.3 §25). Broadcast-vs-precise delta on S32 ≈ 1.7 mm (12J.2 ladder — cited,
not re-run). Repeated-run determinism: byte-identical reruns (12J.0/12J.1).

---

## 10–15. REPEATABILITY / NORMALIZED-T / CLOSURE METHODOLOGY (READY, NO DATA)

New pure module `src/engine/gnssStochasticEvidence.ts` (354 lines, zero solver
imports) + `tests/gnssBaseline/gnssStochasticEvidence.test.ts` (14/14):

- `meanBaseline`, `empiricalCovariance` (1/(n−1)), `averageFormalCovariance`,
  `scaleRatioDiagnostics` (per-component xx/yy/zz, trace, per-axis sigma).
- `ecefToEnuRotation` + `rotateCovariance` (C_enu = R C R^T) for ENU-component
  analysis. Limitation (disclosed): rotation uses geocentric latitude, not
  geodetic — ≤0.2° error, fine for diagnostics, must be fixed before any
  production weighting use.
- `normalizedDifferenceT` (T = dᵀ C_d⁻¹ d, closed-form 3×3 inverse, throws on
  non-SPD; χ²-3DOF expectation documented) + `loopClosureT` (ΣΔ, ΣC, T_loop) +
  `chi2Cdf3`/`chi2PValue3` (closed form).
- Candidate models F (identity), S (scalar s²), ENU-floor (local H/V floors,
  rotate back), CL (constant+ppm in ENU, rotate back). Positive-definite by
  construction (additive PSD terms); smooth in length (CL); no per-dataset
  constants fitted.

No ratios are turned into production factors. No modern repeats exist in-tree,
so §§10–11/14–15 report NO observed numbers; the machinery is validated on
hand-computed synthetic goldens and stands ready for the §3 fetch. TBC legacy
vectors are deliberately NOT used as a repeatability oracle (single-processor
commercial output, §2).

## 16–17. SESSION CORRELATION / ALL-PAIRS VERDICT

Architecture finding (reasoning, no new data needed):

- Baselines from the same simultaneous session share observations, satellite
  errors, atmosphere, common base, and ambiguity resolution — they are NOT
  independent. All-pairs processing (A-B, A-C, B-C from the same epochs) is
  algebraically dependent (B-C = (A-C) − (A-B) up to processing noise).
- VERDICT: **all-pairs independence is REJECTED.** Three RTKLIB covariance
  matrices from one session must never enter the adjustment as three independent
  3×3 blocks. Cross-covariance is not delivered by rnx2rtkp, so Option B
  (derive cross-covariance) is not available without a multi-baseline engine.

## 18. SESSION NETWORK REPRESENTATION (RECOMMENDATION)

- OPTION A (spanning tree) — RECOMMENDED for any future production: process one
  deterministic star/set per session, ingest at most n−1 baselines per n-receiver
  session (exact for star-shaped sessions; the evidence shortlist keeps one
  winner per unique `to`, so non-star inputs need a connectivity check before
  any production use). No fake independence, no new engine.
- OPTION B (cross-covariance) — not available from single-baseline rnx2rtkp;
  deferred to a future multi-baseline engine.
- OPTION C (session normal equations) — correct but a new engine; out of scope.
- OPTION D (independent sessions) — valid where true independence exists
  (non-overlapping occupations); recommended as the repeatability-evidence
  design (§§10–12 run on D, never within-session).

## 19. BASELINE SELECTION POLICY (FOR SPANNING TREE)

Deterministic star: most-frequent `from` marker as hub (lexicographic tie-break);
one member per unique `to` preferring FIXED > FLOAT, then higher ratio, then
lexicographic. Never optimize purely for smallest sigma (that selects the most
optimistic formal, i.e. the worst weight). Implemented evidence-side in
`src/engine/gnssRawSession.ts` (`selectSpanningTree`); operator override remains
a future UI slot.

## 20. BASE INVARIANCE (DESIGN)

Different hub choices must agree after alignment/closure; star-topology
systematics are tested by reprocessing the same session under different hubs and
comparing closures — queued behind the §3 fetch. The deterministic policy (§19)
makes this test repeatable.

## 21–23. DURATION / LENGTH / GEOMETRY EFFECTS (PARTIAL EVIDENCE)

- Dataset-B legs show ratio spread 4.9–47.4 across five occupations of one
  baseline family (12J.3 §11) — ratio varies session-to-session, so no single
  ratio threshold can certify accuracy (§25).
- Truncation ladder (10/20/30/60 min), length ladder (1/5/10/20+ km), and
  PDOP/geometry-vs-repeatability analysis all require the §3 corpus — specified,
  not run. No extrapolation outside evidence. No black-box ML.

## 24–25. FIXED VS FLOAT / RATIO AS QC

MVP rule retained: FIXED only for survey consideration, FLOAT diagnostic-only
(enforced in export policy + worker). RTKLIB fixed solutions CAN be wrong
(low-ratio FIXED legs exist in the legacy cohort: S31 ratio 4.9, S39 5.6 vs S32
47.4 on comparable geometry) — a future auto-ingest gate needs a conservative
minimum ratio PLUS closure/repeat agreement, not the processor flag alone. No
threshold is set in this phase (needs §3 data).

## 26–28. CANDIDATE MODELS / INTERPRETABILITY / CROSS-VALIDATION

Candidates FORMAL / scalar / ENU-floor / constant+ppm / empirical / REVIEW-only
are implemented as pure functions (§§10–15) with physically interpretable,
positive-definite forms. Fitting + held-out validation are explicitly queued
behind the §3 fetch (fit on subset, validate on held-out; single-corpus fits
rejected). No model is calibrated in this phase.

## 29. TBC COMPARISON (SECONDARY, CITED)

Independently of any future calibration: RTKLIB formals are ~45× too strong in
variance (~6.7× SEUW) relative to TBC-weight consistency on the 4-net, shifting
adjusted stations ~22 mm (12J.3 §30). A future calibrated model will be reported
as tighter/similar/looser than TBC — never fitted to it.

## 30. DEFAULT-SE CAUSAL EXPERIMENT (NOT EXECUTED)

Operator-blocked in 12J.3; remains blocked. Classification stays
EXCLUDED-for-processed-vectors by evidence (session-estimated forensics, §2),
fallback role UNKNOWN. The experiment spec stands; it is useful but NOT required
if modern empirical data (§3) is stronger.

---

## 31. RAW REVIEW JSON VERSIONING (AUDIT)

`webnet-raw-static-baseline/1` (`gnssRawExport.ts` + `gnssRawTypes.ts`,
scout-verified field list): adding `surveyCovariance`, `surveyCovarianceModel`,
`calibrationEvidence`, `sessionId`, `dependencyGroup` is BACKWARD-COMPATIBLE —
all new fields live either inside `result` as optional additions (v1 readers
ignore unknowns; round-trip test pins the required set) or, preferably, on a
session-member wrapper OUTSIDE the v1 object so v1 bytes never change.
Recommendation: wrapper placement (proven by `gnssRawSession.ts` test asserting
`JSON.stringify(result)` is unchanged by composition). No version bump in this
phase (no schema change made).

## 32. DEPENDENCY-GROUP METADATA (DESIGNED + EVIDENCE-BUILT)

`sessionId` (operator/session label) + `dependencyGroup` (deterministic FNV-1a
over sorted input content-hashes; baselines sharing any input file share a
group) are implemented evidence-side in `src/engine/gnssRawSession.ts`:
`assignDependencyGroup`, `composeSession` (shared-group/FLOAT/antenna/formal
warnings; empty-safe), `selectSpanningTree`, `sessionReviewTable`. Review-only
results thus preserve lineage before any batch processing exists.

## 33. SESSION COMPOSITION EVIDENCE (BUILT)

`composeSession` (multiple ProcessedRawGnssBaseline + hashes → review set)
preserves source session, shared-file dependencies, antenna/stochastic status —
and never touches the solver (zero adjustment imports; v1-compat test). No
adjustment ingestion path added.

## 34. REVIEW-SET UX (DESIGN ONLY)

Future `Raw Session Review` table columns: baseline, FIX/FLOAT, ratio, duration,
satellites, antenna status, formal precision, survey-covariance status,
dependency group; actions export-selected / export-all; NO ingest action. No UI
built in this phase (evidence-only per mission).

## 35. PRODUCTION ANTEX DECISION

**ANTEX_REVIEW_ONLY.** RTKLIB-side semantics support exact-match local ANTEX
(§6), but the Worker/WASM path (trimmed-subset staging, `*` descriptor adoption,
satellite-PCV policy, provenance hashing, marker-reduction re-check) is
audited-not-proven. Exact-match policy is NOT weakened. Full `igs20.atx` cannot
stage under current caps by design (subset extraction required, not a cap raise
without memory analysis).

## 36. SURVEY COVARIANCE DECISION

**REVIEW_ONLY.** Formal covariance is deterministic and mathematically valid but
~45× over-weighted vs TBC-consistent weighting with no stable mapping proven;
no modern repeats/closures exist in-tree to calibrate F/S/ENU/CL candidates.
NO_VALID_MODEL is not claimed (formals are not misleading as *processor*
precision — only uncalibrated as *survey* weights); FORMAL_WITH_INFLATION is not
claimed (no inflation factor passes independent validation yet).

## 37. DIRECT INGESTION GATE (12J.6)

Direct/automatic adjustment ingestion stays PROHIBITED. It may be recommended
only when ALL hold: validated covariance model, acceptable antenna status,
explicit frame, FIXED, safe dependency semantics (spanning-tree, no fake
independence), defined QC gates (ratio + closure + repeat). None hold today.

---

## 38. MODERN CORPUS RESULT MATRIX

Empty — no modern corpus fetched in this phase (deferred bulk download per
mission §4). Matrix shell (per session/baseline: receivers, antennas,
calibration, duration, length, sats, ratio, broadcast/precise, vector, formal
cov, repeat/reference Δ, T, closure contribution, survey candidate) is defined
by §§10–15 helpers + §32 review rows and will be filled on the §3 fetch.

## 39–40. PERFORMANCE / BROWSER RESOURCE ARCHITECTURE

Assessment (reasoning from 12J.4 WASM costs, no new runs): per-job cost is one
fresh WASM instance + file staging; jobs are independent → bounded worker pool
(2–4 concurrent, sequential queue overflow) with fresh instance per job (state
isolation proven) is the recommended future batch architecture. Full-ANTEX
staging would dominate memory — another reason for trimmed subsets (§6). No
production batch implementation (mission-deferred). Concurrency bound 5/10/25/50
benchmarks queued behind a real batch workload.

---

## 41. REPORT

This file is the §41 deliverable.

## 42. ACCEPTANCE

| ID | Item | Verdict |
|----|------|---------|
| A | Formal vs survey distinction frozen | PASS (§1) |
| B | Modern corpus found or field spec completed | PASS (ranked inventory + fetch recipe + field spec, §§3–5; fetch deferred per mission) |
| C | Antenna path tested where data permits | PASS (audit to source-code level, §6; no modern data permits more) |
| D | Production ANTEX assessed | PASS (REVIEW_ONLY, §35) |
| E | Repeatability analysis where data permits | PASS (machinery + goldens; no data permits runs, §§10–15) |
| F | Normalized covariance tests implemented | PASS (`normalizedDifferenceT` + χ², 14/14) |
| G | Closure tests where data permits | PASS (`loopClosureT`; no loop data yet) |
| H | Same-session dependence addressed | PASS (§16) |
| I | All-pairs independence rejected or proven | PASS (REJECTED, §17) |
| J | Candidate models evaluated | PASS (F/S/ENU/CL pure + unfitted, §§26–28) |
| K | No empirical TBC-fitting | PASS (src diff: only new evidence files) |
| L | Held-out validation if sample size permits | PASS (no sample; rule recorded, §28) |
| M | Ambiguity/QC relationship assessed | PASS (§§24–25, no threshold set) |
| N | Dependency-group metadata designed | PASS (§32, built evidence-side) |
| O | Batch architecture assessed | PASS (§§39–40) |
| P | Direct-ingest gate decided | PASS (prohibited, §37) |
| Q | No production auto-ingest added | PASS (solver untouched) |
| R | No adjustment/tolerance changes | PASS (solver untouched) |

## 43. DECISION

**MORE-FIELD-EVIDENCE** (primary) + **NO-GO-DIRECT-INGEST** (retained guard).

- Not GO-SURVEY-COVARIANCE (no calibrated model).
- GO-BATCH-REVIEW is *architecturally* supported (session composer +
  dependency groups + review-table design exist evidence-side,
  `gnssRawSession.ts` + 13/13 tests, v1-compat pinned) but remains
  evidence-only: no Worker batch path and no review UI are built in this
  phase, so batch review is a 12J.6 build item, not a present capability.
- The single next action is the §3 fetch (IGS triangle, 5 days) followed by:
  oracle matrix (§8) → repeats/normalized-T/closures (§§10–15) → fit + held-out
  validate one interpretable candidate (§§26–28) → re-decide.

## 44. PR CONTRACT

- Production raw worker changed: NO (evidence-only additions)
- Automatic adjustment ingestion added: NO
- Survey covariance empirically fitted to TBC: NO
- Session dependency analyzed: YES
- Modern antenna calibration evidence: NO (corpus-gated; audit YES)
- GNSS adjustment math changed: NO
- R2B changed: NO
- Free-network changed: NO
- Vendor data committed: NO
- Tolerance changes: NO

No auto-merge.
