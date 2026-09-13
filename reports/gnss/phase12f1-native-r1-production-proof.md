# Phase 12F.1 — Bounded Native Static-GNSS R1 Production Proof

Branch `feat/gnss-native-r1-production-proof`, baseline `origin/main 406296de`
(PR #41 merge). PRODUCTION PROOF but DEFAULT OFF. No math/tolerance/GVX/UI/
RINEX changes, no new C++ API, no R2 routing.

## §1 — What was built

| Piece | Location | Notes |
| --- | --- | --- |
| Engine seam | `src/engine/gnssBaselineAdjust.ts` | Optional `nativeRuntime` (`sparseCorrectionSolver` → existing `solveAdjustmentIteration` seam; `nativeQxxProvider` → replaces dense inversion; throws on any fault). Default absent = bit-identical 12E.3 TS-dense. Provenance widened to `'typescript-dense' \| 'native-sparse-full-qxx'` (+ one log line on the native path). |
| Worker route | `src/workers/gnssBaselineNativeR1Route.ts` | Kill switch (default OFF), eligibility, Tarjan bridge check, capture-decorated native attempt (S3 corrections + inline C1/C2/C3 Qxx), clean-TS fallback. |
| Agent contract | `tests/gnssBaseline/gnssBaselineNativeR1.test.ts` | 24/24, stubs only, no WASM. |

Option-A reuse (§21): TS owns parse/frame/preflight/setup/assembly/
residuals/statistics/loops/reports. Native supplies ONLY sparse corrections
+ full dense Qxx (all-entry `querySelected`, 10I pattern). C1/C2/C3 reuse the
10I verifiers verbatim via `NativeFullQxxCaptureSolver` (inline reject throws
before values reach the engine); S3 reuses `SparseAutoRouteCaptureSolver` +
`verifySparseAutoRouteSystems`. Bridgelessness is stated in repo terms
(cut-edges, F-BRIDGE). `gnssBaseline` is never equated with legacy G/GPS:
non-ECEF frames are rejected with an explicit never-legacy reason, and the
10I/GPS tripwires are untouched.

## §2 — Bounds + rationale

- `GNSS_NATIVE_R1_MAX_PARAMS = 750`: mesh-250 (p=747) proven in 12F.0 with
  margin under the 768 native cap. Boundary-tested: 750 admitted, 753
  rejected (eligibility-only).
- `GNSS_NATIVE_R1_MIN_PARAMS = 150`: perf floor from measured TOTAL-wall-time
  medians (solve-side, real WASM, production seam): 0.87× at p=72 (noise),
  1.29× at p=147, 1.02× at p=297, 1.34× at p=747. Crossover band ~100–150
  confirms the 12F.0 observation; below 150 the route is correct but slower,
  so it stays TS. Eligibility-hold tested at p=21 with the perf-floor reason.

## §3 — §13 gate audit

Gates involved in the stochastic (§13) path: the shared TS-dense Qvv eigen
PSD gate (F-PSD) and bridge behavior (F-BRIDGE). Finding: both are REAL
production behaviors of the shared statistics path (they would trip in
production TS on bridged graphs too — not harness-only), but fixing either
requires tolerance/math changes, which are forbidden in this phase. The fast
F-BRIDGE/F-PSD pins still pass (30/30 with the audit + setup suites), the TS
SEUW pins reproduce exactly (§5), and R1 excludes bridged graphs by
eligibility (fail-closed, tested). **Recorded unchanged; no fix, no
regression needed.**

## §4 — Parity maxima (real WASM, forced-ON via test-only bounds seam)

| Case | coords | Qxx rel | SEUW |
| --- | --- | --- | --- |
| Dataset B (50v/8st, B0) | 0 | 6.9e-15 | 1.965038 both arms |
| Dataset A A0 | 0 | 4.5e-15 | 2.100053 = pin |
| Dataset A AC | 0 | 8.0e-14 | 1.297104 = pin |
| Dataset A AH | 0 | 6.9e-15 | 1.988831 = pin |
| Dataset A A | 0 | 1.8e-12 | 1.102511 = pin |

Agent-tier stub parity (ring-52 p=153, setup A0/AC/AH/A-style,
repeated-edge): whole-structure bitwise except provenance tag + log line;
condition metadata rel < 1e-12 (diagnostics-only packed-vs-dense estimate).
Trace identity holds on every native leg (< 1e-9).

## §5 — Fallback matrix (each → clean-TS restart, whole-structure bit-identical)

WASM-missing, correction throw, NaN correction, NaN Qxx, short Qxx, damped
Qxx — all agent-tested: route `typescript`, provenance `typescript-dense`,
`JSON.stringify` equal to feature-disabled TS. Non-convergence/non-finite/
provenance/count gates covered in code; worker-thread smoke re-proves
forced-fail → TS and kill-off → TS with real WASM.

## §6 — Boundaries / exclusions / isolation

Kill-off, non-worker, WASM-unavailable, p < 150 (floor), p > 750 (cap),
bridged graphs, non-ECEF frames, invalid 3x3 — each rejected with a fixed-
order reason (tested). Multi-component meshes admitted with trace identity
(no single-component restriction — packed rows are component-agnostic).
Route isolation: GNSS R1 toggle independent of the 10I switch; TS-dense
default untouched; 2D sparse / 3D full-Qxx / GPS-cov routes unchanged.
Default-OFF proof: kill switch false → bundle loader never called (tested);
browser page load issues zero `webnet_core` requests (Chromium smoke).

## §7 — Crossover / memory

Verified-route totals ≈ TS (solve win 1.29–1.34× above ~150 params is
consumed by the S3+C1/C2/C3 verification tax: 2.4 ms @147, 53 ms @297,
334 ms @747) — the same verification-dominated shape as 10M. Per-run heap
deltas are GC-noise-dominated (±65 MB swings on repeat runs); analytic
dense-Qxx cost is p²·8 B (0.2/0.7/4.3 MB @147/297/747) and R1 materializes
it by design, same as TS. mesh-250 completes; 12F.0 §19 ceilings stand
(1000 R2-only, 2000 OOMs in TS dense assembly).

## §8 — Decision: NO-GO on enable (proof complete, stays default-OFF)

- Safety proof COMPLETE: bitwise solve parity, Qxx rel ≤ 1.8e-12, full
  fallback matrix, bridgeless cohort, real-WASM Dataset A/B + worker smoke.
- NO-GO on default-ON: the fully-verified route buys no wall-time win
  (verification tax erases the 1.3× solve speedup). Same conclusion as 10M.
- Bounds STAND (150/750) for any future enablement; lowering the floor
  would only admit slower jobs. R2 (block-sparse Qxx, no dense
  materialization) or a cheaper verification argument is the perf path —
  not this phase.

## §9 — Validation + HEAD

- `npm run lint`: 0 errors (2 pre-existing warnings in unrelated files).
- `npm run typecheck`: clean.
- New suite 24/24; gnssBaseline + audit + setup neighbors green.
- `npm run test:agent`: broad pass + 3 pre-existing Study calibration
  failures (re-proven via stash).
- `npm run build`: clean. HEAD: `feat/gnss-native-r1-production-proof`
  (pushed, no PR).
