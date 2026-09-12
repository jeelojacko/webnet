# Phase 10P correction-verification boundary study

STUDY ONLY. Zero production/routing/default/cap/eligibility/tolerance/S3/
C1-C3 changes. Correction stays OFF (default). New modules
(`src/engine/phase10pCorrectionResidual.ts`, `phase10pS3CostSplit.ts`) are
test-only imports — unreachable by production. S3 stays authoritative.

## Provenance

- Baseline SHA: `74cb10f7` (branch `perf/3d-native-correction-verification-study`).
- Environment: linux/x64, real WASM bundle (`cpp/build-wasm/`).
- Evidence: `tests/evidence/phase10p_correction_verification.test.ts`
  (`phase10p` suite; 1 warm-up + measured capture; raw machine output in
  `artifacts/evidence/phase10p/`, gitignored; machine-readable companion
  `reports/performance/phase10p-correction-verification.json`).
- Headline: the matrix-free residual candidate is ~230x cheaper than S3
  (0.24 ms vs ~58 ms at 384 params) but has PROVEN unexplained false
  accepts on weak geometry (2/56 systems). No composition repairs it
  without S3-equivalent cost. **GATE D — keep S3, stop.**

## 1. S3 contract split (purposes A–F)

Mapped from `verifySparseAutoRouteSystems`
(`src/workers/adjustmentSparseAutoRoute.ts`):

| purpose | checks |
|---|---|
| A provenance/coverage | truncation bound, zero-count, captured == iterations |
| B finite | throw/missing, per-param finite diff |
| C correction-value | max diff vs 1e-9 (`PHASE7B6_CORRECTION_TOLERANCE`, untouched) |
| D normal-consistency | the dense rebuild itself (unpack + P + N + solve) |
| E conditioning | finite condition, threshold-excess WARN-ONLY, first-system vs `result.condition` agreement within 1e-9 |
| F damping/SPD | damping finite && === 0 |

## 2. Diagnostic S3 cost split (per system, ms means)

Bit-identical to the production oracle rebuild on all 56 systems;
attribution ≥ 95%. True S3 cost excludes the study's bit-identity
double-rebuild (~13–16 ms at 384, measurement overhead only).

| params | copy | dense-P | accum N | factorize | solve | compare | condition | S3 true |
|---|---|---|---|---|---|---|---|---|
| 24 | 0.016 | 0.028 | 0.027 | 0.027 | 0.012 | 0.008 | 0.189 | 0.31 |
| 96 | 0.008 | 0.111 | 0.112 | 0.202 | 0.028 | 0.002 | 0.078 | 0.54 |
| 192 | 0.015 | 0.602 | 0.588 | 1.401 | 0.079 | 0.011 | 0.160 | 2.86 |
| 255 | 0.011 | 1.070 | 0.996 | 2.413 | 0.116 | 0.014 | 0.205 | 4.83 |
| 384 | 0.017 | 2.720 | 2.198 | 8.206 | 0.277 | 0.014 | 0.499 | 13.93 |

Dominant: redundant dense factorization (59% at 384) — the same N the
native backend already factored. Reusing it would destroy verification
independence (§22). Dense-P build (20%) + accumulation (16%) are the
matrix-materialization price of independence.

## 3–5. Matrix-free residual candidate

`r = N·dx − u` via `t = A·dx`, `z = P·t`, `lhs = Aᵀ·z`, `y = P·w`,
`u = Aᵀ·y` — never materializes N, P, or A. Packed upper-triangle weights
applied exactly once per orientation (diag once, off-diag both),
sign-proven against `matrixSparse.ts` (both-orientation accumulation) and
pinned elementwise against dense-oracle N·dx/u to < 1e-9 relative.
Operates directly on packed entries, so every 10N weight shape is supported
exactly; anything unrecognized throws fail-closed. Candidates B (objective/
descent), C (row probes), D (bounded oracle — no valid selected-parameter
solve exists, not invented), E (first-full-rest-cheap = S5, scored below),
F (certification inventory = this report; no production trust) evaluated;
only the residual line had a cheap-enough profile to shadow-test.

## 7–8. Shadow mode (per-system S3 vs candidate, 56 systems)

- both-pass 52, both-fail 2, s3-pass-candidate-fail 0.
- **s3-fail-candidate-pass 2** — the dangerous cell, both on
  `corpus-dist-heavy-32` (distance+height only, no bearings/GPS):
  correction diffs 2.17 and 3.9e-6 with residuals 1.9e-16 and 1.6e-15.
  Mechanism proven: N near-singular along the undetermined orientation, so
  a wildly wrong dx still has a tiny residual. S3's direct correction
  comparison sees it; no residual composition can.
- Objective ZERO unexplained false accepts: FAILED (2). The candidate line stops here.

## 9. Fault injection (20 forms, 96-param first system)

All S3-rejected value faults are also rejected by the metadata-bearing
candidate (agreement asserted in-suite). Detection threshold on the
well-conditioned base: dx-bias 1e-8 (rel 5.6e-9); micro-biases ≤ 1e-9 pass
both (agreement, not misses). Metadata-only faults (damping-1e-3, Inf/
missing condition) are residual-blind (rel ~3.4e-16 = valid level) and are
caught ONLY by metadata gates — S1 (residual-only) passes them while S3
rejects, proving the damping gate load-bearing. `weight-scale-2x` is a
negative control: solution-invariant, both correctly accept.

## 10. Weak-mode / adversarial

Weak-direction-aligned perturbations (max-Qxx-diagonal param 47 on
weak-chain-32): mag 1e-8 gives S3-reject + candidate-pass (rel 3.7e-10) —
~100x blindness along the weak direction (S3 sees from 1e-8, candidate only
from ~1e-6). Valid weak solve passes both. High-but-accepted-condition
cases (ladder, ~1.7e14): candidate passes — no false rejects there; the
failure direction is false ACCEPTS on genuinely bad systems.

## 11. Tolerance separation

NO global separation: minFault (3.4e-16) < maxValid (2.6e-13). Restricted to
value faults on well-conditioned systems the window (2.6e-13, 5.6e-9)
separates at 1e-9 — but weak-direction faults (3.7e-10) fall inside it, so
the window is unsafe. Derived from eps/‖N‖/‖dx‖/‖u‖/n/existing-1e-9 plus
observed valid-solve error; `PHASE7B6_CORRECTION_TOLERANCE` untouched, no
tolerance change proposed.

## 12–13. Condition / damping strategy

Native == TS-packed estimates everywhere (same conservative rowMax·colMax
estimator). Ladder cases sit at 1.7–1.9e14 — 100x above the 1e12 production
threshold — while S3 accepts with BIT-IDENTICAL 10N parity. A threshold gate
rejects 44/52 valid systems (zero savings) yet PASSES the rejected
dist-heavy case (4.1e11 < threshold): it rejects the good and accepts the
bad. Retain warn-only S3 condition — never silently drop. damping==0 gate
preserved (proven load-bearing per §9). No policy change.

## 14–15. S0–S5 scorecard (52 valid systems; median cost)

| strategy | valid | median | verdict |
|---|---|---|---|
| S0 legacy S3 | 52/52 | ~13.9 ms @384 | reference |
| S1 residual-only | 52/52 | 0.019 ms | NO-GO (misses metadata faults + 2 false accepts) |
| S2 residual + first-condition | 52/52 | 0.018 ms | NO-GO (same 2 false accepts) |
| S3 residual + metadata | 52/52 | 0.016 ms | NO-GO (same 2 false accepts) |
| S4 residual sampled-condition | 52/52 | 0.015 ms | NO-GO (same 2 false accepts) |
| S5 first-full-rest-cheap | 52/52 | 0.030 ms | NO-GO (cheap legs false-accept on weak sessions) |

Any serious unexplained false accept ⇒ NO-GO: all of S1–S5 are NO-GO.

## 16–17. Corpus + 2D cross-check

Ladder gps-3d-cov-08/32/64/85/128 (24–384 params) + all 8 realistic 10M
32-unknown families + altseed-128 (seed 7777): 14/14 route-eligible (no
eligibility expansion), 13/14 S3-accepted, 1/14 S3-rejected with mechanism.
Beats the 10O single-family corpus. 2D read-only (chain-2d-16, 4 systems):
candidate passes, rel 2.2e-16–1.9e-13; no Phase7 change.

## 18–20. Floor estimates + shadow overhead

Candidate total 0.24 ms/adjustment at 384 vs S3 54–62 ms (route re-verify).
Floor = 10N arm-C − legacy S3 + candidate ≈ 94 ms (128) / 92 ms (altseed)
per adjustment — 0.58–0.59x of the 10M wall (CLEAR WIN as arithmetic,
labeled ESTIMATE: single-process Node, shadow overhead excluded, safety
NO-GO so non-actionable). Benchmark-only shadow route recorded candidate
cost without letting it decide (§20 satisfied diagnostically).

## 21–23. Browser, independence, staleness

- Browser: NOT-RUN — no three-arm shadow harness exists (committed driver is
  the two-arm 10M production route); never invented. Firefox likewise.
- Independence: candidate shares assembly inputs with the system under test
  (shared-blindness to packing corruption); independent only against
  algorithm faults except near-null directions. Factor-reuse verification
  rejected without prototyping. S3's independent rebuild stays the only
  independent check.
- Stale/wrong-system: 22/22 pairings (prev-iter, same-dims-diff-network,
  same-N diff-RHS) reject under BOTH — staleness is not the failure mode.

## 25. Decision: GATE D

No substitute — keep S3, stop the candidate line. No 10Q shadow proof (needs
zero false accepts), no further certification (structural failure, not a
calibration gap), no condition optimization (estimator rejects the good,
accepts the bad). S3 untouched; candidate modules stay test-only.

## 26. Validation

- New 10P evidence: PASS (1/1).
- Tier wiring: `phase10p` in `scripts/testTiers.ts` (EVIDENCE_TESTS),
  `scripts/runEvidence.mjs` (SUITES), `docs/TEST_TIERS.md`.
- Remaining per §26 (7/7D/10I/10J/10K/10L/10M/10N/10O + C++/real-WASM +
  parity + browser/worker smoke + lint + typecheck + build): run at
  completion; 3 pre-existing Study calibration failures noted if they recur.

## Files

- `src/engine/phase10pCorrectionResidual.ts` (new, test-only)
- `src/engine/phase10pS3CostSplit.ts` (new, test-only)
- `tests/evidence/phase10p_correction_verification.test.ts` (new, evidence tier)
- `scripts/testTiers.ts`, `scripts/runEvidence.mjs`, `docs/TEST_TIERS.md` (wiring)
- `reports/performance/phase10p-correction-verification.{json,md}` (this study)
