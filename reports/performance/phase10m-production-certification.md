# Phase 10M 3D native production certification + widening assessment

Evidence-only certification of the Phase 10L verified native full-Qxx route.
No production, routing, cap, kill-switch, tolerance, or numerical changes in this batch.

## Provenance

- Baseline SHA: `94cbfb1f` (origin/main after PR #28 merge).
- Branch: `perf/3d-native-production-certification`.
- Environment: node v26.8.1, linux/x64; Chromium 148.0.7778.96; Firefox 150.0.2 (Playwright).
- Production contract held throughout: worker-only, 3D single-solve, no robust,
  no TS correlation, no orientation, unchanged weighting eligibility, <=384 params,
  full dense native Qxx, cached inline C1/C2/C3 evidence, clean TS fallback,
  kill switch default OFF.

## 1. Reproducibility — headline SURVIVES 5/5 fresh processes

Method: 5 independent fresh processes, real WASM fresh init + explicit warm-up,
deterministic fixtures, 1 warm-up + 5 measured runs per arm. Median/p25/p75 per
process per fixture; raw runs retained in `artifacts/evidence/phase10m/`.

gps-3d-128 TS vs native medians per process (ms):

| process | TS | native | ratio |
|---|---|---|---|
| p1 | 205.4 | 153.9 | 0.75 |
| p2 | 213.7 | 162.0 | 0.76 |
| p3 | 218.6 | 161.2 | 0.74 |
| p4 | 207.5 | 157.4 | 0.76 |
| p5 | 202.6 | 160.1 | 0.79 |

- Between-process: TS std 5.8 ms (range 202.6-218.6), native std 3.0 ms (153.9-162.0).
- Across-process medians: TS 207.5, native 160.1, ratio 0.77.
- Claimed 209 -> 155 reproduces as ~208 -> 159. Native faster in EVERY process.
- Smaller fixtures reproduce: cov-08 ~5.8/7.1, 32 ~12.4/14.7, 64 ~38.9/37.4.

## 2. Browser / worker performance (real production worker, real browsers)

Method: fresh `dist/` build; TS arm = unmodified built worker chunk (kill switch off);
native arm = esbuild bundle of the unmodified production route + real WASM loader with
only the existing test-only kill-switch setter flipped (Node 10I/10J/10L methodology).
Fresh worker per fixture+arm (fresh WASM init), 1 warm-up + 5 measured runs,
page round-trip wall medians. Re-runnable driver: `scripts/phase10mBrowserEvidence.mjs`.

| browser | fixture | TS | native | ratio |
|---|---|---|---|---|
| Chromium | 32 | 20.0 | 23.8 | 1.19 |
| Chromium | 64 | 48.4 | 52.1 | 1.08 |
| Chromium | 128 | 219.9 | 183.4 | 0.83 |
| Firefox | 32 | 23.0 | 28.0 | 1.22 |
| Firefox | 64 | 92.0 | 83.0 | 0.90 |
| Firefox | 128 | 467.0 | 352.0 | 0.75 |

- TS<->native full-result parity exact (maxDiff 0) on all 6 cells; route proven
  `native-full-qxx` with C1/C2/C3 accepted on every native run.
- Noise: ACCEPTABLE but visible, max CV ~20% (small-fixture native cells); first
  post-warm-up run still elevated (JIT). Medians robust; raw spreads retained.
  Do not certify on browser medians alone — they corroborate Node, not replace it.

## 3. Realistic corpus — 7/7 measured pass, 1 excluded with reason

Deterministic non-GPS-only 3D cases, currently-eligible observation types only.
No eligibility change. Pass = result+Qxx+C1/C2/C3 parity, no damping/fallback/truncation.

- PASS: mixed terrestrial+GPS, GPS+distance+height (no bearings), terrestrial-only
  (D+B+V), weak-but-valid long chain, low-redundancy, uneven connectivity, compact.
- EXCLUDED (not a route rejection): distance+height-only — route eligibility PASSED,
  but the TS baseline itself does not converge (azimuth-unconstrained without
  bearings/GPS), so parity is untestable.
- Excluded-shape probes correctly ineligible with reasons: 2D, robust, >384 cap.

Parity failures: 0. Verification failures: 0. Fallbacks: 0.

## 4-5. Parameter-size ladder + crossover (Node, real WASM, deterministic)

| params | TS ms | native ms | ratio | class | delta ms |
|---|---|---|---|---|---|
| 24 | 5.6 | 4.5 | 0.80 | native-faster (noise-scale) | -1.1 |
| 48 | 5.0 | 6.5 | 1.30 | TS-faster (noise-scale) | +1.5 |
| 96 | 11.9 | 14.2 | 1.20 | TS-faster | +2.3 |
| 144 | 24.1 | 24.4 | 1.01 | parity | +0.3 |
| 192 | 39.5 | 38.6 | 0.98 | parity | -0.9 |
| 255 | 73.2 | 61.8 | 0.84 | native-faster | -11.4 |
| 321 | 127.4 | 97.5 | 0.76 | native-faster | -30.0 |
| 384 | 196.5 | 158.1 | 0.80 | native-faster | -38.5 |

- First clear native win: **255 params** (0.84). Parity region: **144-192**.
- Below ~192 params everything is within +/-3 ms noise; the 24-param 0.80 is a
  -1.1 ms absolute effect, not a real win.
- No production heuristic implemented — evidence first, per mission.

## 6. Large-case proof (480-768, diagnostic-engine-only, above cap)

Route eligibility correctly FAILS CLOSED above 384 (`parameter count exceeds cap`).

| params | TS ms | native ms | ratio | delta ms | parity | damping | fallback | trunc |
|---|---|---|---|---|---|---|---|---|
| 480 | 368.0 | 202.3 | 0.55 | -165.7 | <1e-6 | 0 | 0 | no |
| 576 | 607.2 | 295.7 | 0.49 | -311.4 | <1e-6 | 0 | 0 | no |
| 672 | 915.6 | 423.1 | 0.46 | -492.6 | <1e-6 | 0 | 0 | no |
| 768 | 1312.8 | 594.0 | 0.45 | -718.8 | <1e-6 | 0 | 0 | no |

Full dense Qxx (n^2 x 8 bytes): 384 -> 1.1 MB; 512 -> 2.0 MB; 640 -> 3.1 MB;
768 -> 4.5 MB. Measured multi-iteration totals: 480 -> 5.5 MB, 576 -> 8.0 MB,
672 -> 10.8 MB, 768 -> 14.2 MB. Memory is MB-scale — NOT the practical limit;
computation scaling dominates the cap decision.

## 7. Cap assessment — KEEP 384

| candidate | verdict |
|---|---|
| 384 | CERTIFIED (this report) |
| 512 / 640 / 768 | NO-GO without a dedicated widening campaign |

Full route evidence (verification + fallback + browser proof) stops at 384 params.
>384 evidence is engine-timing only: no verified-route runs, no fallback matrix,
no browser proof. Do NOT widen on timing ratios alone.

## 8. Kill-switch assessment — GO DEFAULT ON for <=384 (PROPOSED, not implemented)

- Verdict A at 384 in 5/5 processes (0.74-0.79) + Chromium 0.83 + Firefox 0.75.
- Exact parity (0.0e+0) all sizes; fallback 6/6 with clean TS restart on every fault
  (init failure, solver throw, C1/C2/damped/non-finite/truncated/malformed,
  non-converged/non-finite results — the last two newly test-covered, test-only).
- Full numerical corpus green (C++ 7/7, WASM 41/41, parity 25/25, 10I/10J/10L,
  browser + sparse smokes). 10K trips only its known 2 ms ordering gate (Section 13).
- Small-job cost quantified: +1-4 ms at <=96 params — imperceptible.
- Caveat: single-machine evidence; confirm multi-machine before release notes.

Per the strict gate (Section 14), the default is NOT flipped in this batch.

## 9. Realistic workload weighting

- 12 -> 15 ms class: +2-4 ms regression, effectively imperceptible.
- 209 -> 155 ms class: ~-50 ms saved per 384-param solve.
- 768-param class: ~-720 ms (diagnostic only — not producible today).
- A single route is reasonable for the <=384 cohort: below ~192 params the arms are
  within noise, so no size threshold is needed to protect small jobs. A threshold may
  be worth revisiting if the cap ever widens (diagnostic ratios keep improving).

## 10-12. Correction-solve opportunity + solver audit + single factorization

Stage timings at 384 params (ms): TS correction 66.7 (assembly 23.9 / accumulate 8.0 /
factor+solve 34.8), covariance invert 94.5 (now native 1.9), verification 29.5
(scaffolding 19.1 / C1 0.7 / C2 7.1 / C3 2.7), stats 22.4, report 12.0.
**Correction is now the dominant recoverable stage** (from 192 params up).

Audit (with file:line cites in the JSON companion):

- 3D equations: YES — solver is dimension-agnostic (packed rows/weights; 10B proved
  genuine-3D correction). 2D gate is policy-only (`adjustmentSparseAutoRoute.ts:159-160`).
- Same structured weights: YES — 10I cohort admits only diagonal/simple weights
  (TS correlation, 3D GPS covariance, orientations all fail-closed); solver handles
  a superset.
- Correction parity: sufficient for correction, insufficient alone for Qxx
  (S3 vs C1/C2/C3 — a single-factorization route must keep both verifications).
- One factorization for both: architecturally YES, API NO — both WASM entry points
  factorize per call and free; needs a new persistent-factor export
  (`sparse_normal_solver.cpp:243-296` shared pipeline exists).
- Estimated opportunity: ~62-65 ms at 384 (route ~178 -> ~114 ms, ~46% below TS).

Phase 7 verification infra is complete and reused verbatim (capture bounds,
S3 oracle gates, inline-before-engine, 10L differential proofs).

## 13. Numerical / fallback corpus

C++ 7/7, WASM 41/41, industry parity 25/25, 10I contract 13/13, 10I/10J/10L evidence
PASS, browser + sparse smokes PASS, 10M fallback-gap 2/2 PASS, 10M stage-audit PASS.

10K evidence FAILS only its known 2 ms cumulative-ordering assert (E ~3 ms below D
on a ~247 ms base at 128 — same signature 10L documented). Analysis: D and E are
independently-sampled medians estimating the same session+full-verify quantity; no
numerical decision depends on their ordering; C1/C2/C3 decisions, parity, and
collector-identity asserts are unaffected. Verdict: pure performance-order/noise gate,
NOT a safety signal. Recommended: update to a relative noise band (or drop E-vs-D);
file left UNTOUCHED in this batch — numerical safety is not weakened to pass a timer.

## 14. Production change — STRICT GATE (nothing implemented)

This phase began and ends evidence-only. Proposed bounded change:

**Option C — flip default ON only for the existing <=384 cohort**
(cap stays 384; routing, tolerances, numerics unchanged).

STOP. Awaiting explicit approval before any production toggle/cap change.

## 15. Test wiring added (evidence-only)

- `tests/evidence/phase10m_node_measurement.test.ts` (ladder + corpus + large-case)
- `tests/evidence/phase10m_correction_stage_audit.test.ts` (stage timings)
- `tests/evidence/phase10m_fallback_gap.test.ts` (non-converged/non-finite result gates)
- `scripts/testTiers.ts` + `scripts/runEvidence.mjs` (`phase10m` suite)
- Drivers: `scripts/phase10m-summarize.mjs`, `scripts/phase10mBrowserEvidence.mjs`
- Raw machine output: `artifacts/evidence/phase10m/`, `artifacts/evidence/phase10m-browser/`

## 16. PR contract (initial)

Production behavior changed: NO. Numerical contract changed: NO.
Tolerances changed: NO. Routing changed: NO. Cohort changed: NO.
Kill switch changed: NO.
