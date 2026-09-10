# Phase 10I — Bounded Native Full-Qxx Worker Route + Real-WASM Evidence

Branch: `perf/3d-native-full-qxx-production-proof`
Evidence: `npm run test:evidence -- phase10i` (`tests/evidence/phase10i_native_route_evidence.test.ts`)
Machine artifacts (gitignored): `artifacts/evidence/phase10i/phase10i-evidence.{json,md}`

Production behavior changed: **YES (bounded, default-OFF)** — worker-only 3D route exists but ships disabled
Mathematical contract changed: **NO**
Public result contract changed: **NO**
Worker protocol changed: **NO**

## Scope (not broadened)

Worker-only native full-Qxx auto-route (`src/workers/adjustmentNativeFullQxxAutoRoute.ts`):

- Eligible cohort only: single-solve 3D adjustment, robust none, `numParams <= 384`, clean geometry preflight.
- Final covariance ONLY via native all-entry dense Qxx (contract preserved). Correction stays TypeScript; no row-products solver, no selected store, no selected mode.
- Verified provenance: `allowVerifiedNativeDenseQxxReuse` (threaded EngineOptions → AdjustmentRuntime → statistics context → 10E gate) admits the native-derived dense Qxx to Phase 10E statistics reuse. In-process defaults never set it.
- Verification before accept (reused production sentinel math): per captured packed system — dimension/finite/damping metadata gates, native phase-timing metadata gate, dense all-entry query-coverage proof, C1 sampled-column agreement vs an independent TS oracle (bounded k = 16 columns, no full inverse), C2 inverse residuals on the captured native values, C3 physical validation over the full native set. Verification runs INLINE in the capture decorator (rejected values never reach the engine; the engine's dense fallback engages with the C1/C2 detail in its log) AND post-hoc at the route (dimension/provenance vs the eligible session). Outcome parity alone never accepts a native result.
- Fail-closed: kill switch (default OFF), bundle init failure, covariance fallback, verification reject, non-converged/non-finite result, and every ineligible shape (2D, preanalysis, robust, multi-solve) rerun clean TypeScript.
- Dispatch (`src/workers/adjustmentWorker.ts`): injected runtime bypasses all routes (unchanged); preanalysis keeps its route; 3D adjustment goes to the native attempt (native or clean-TS outcome, never double-solved); 2D keeps the Phase 7C route. 3D never reaches 7C, 2D never reaches native, and eligibility guards both sides independently.

## Measured evidence (real WASM bundle, 1 warm-up + 5 runs per arm)

| Fixture | P | TS median ms | Native median ms | result max abs diff | Qxx max abs diff | stats reuse | C1 max diff | C2 max residual | verified cols | native calls |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| gps-3d-32 | 96 | 13.44 | 24.74 | 0.000e+0 | 1.398e-20 | reused-final-dense-qxx | 9.741e-21 | 2.220e-15 | 16 | 7 |
| gps-3d-64 | 192 | 41.21 | 81.05 | 0.000e+0 | 1.652e-20 | reused-final-dense-qxx | 1.482e-20 | 5.329e-15 | 16 | 7 |
| gps-3d-128 | 384 | 209.73 | 351.45 | 0.000e+0 | 8.301e-20 | reused-final-dense-qxx | 5.633e-20 | 1.243e-14 | 16 | 7 |

Native phase medians at gps-3d-128 (per-call backend metadata): assembly 0.05 / equilibration 0.02 / analyze 0.06 / factorize 0.02 / solve 1.76 ms — the WASM backend itself is fast; the route-level wall is dominated by TS-side verification (dense factor + 16 column solves + full-set physical loop with index maps at 147,456 entries).

## Fallback / semantic matrix (gps-3d-32, measured)

| Case | route | TS rerun | first reason |
|---|---|---|---|
| 2D preserved | typescript | TS-success | dimension '2D' not cleared for native full-Qxx (2D preserved) |
| preanalysis preserved | typescript | TS-success | unsupported runMode 'preanalysis': native full-Qxx requires 'adjustment' |
| robust fail-closed | typescript | TS-success | robust reweighting not cleared for native full-Qxx |
| kill-switch fail-closed | typescript | TS-success | native full-Qxx route disabled by kill switch |
| corrupted native fail-closed (real backend) | typescript | TS-success | sparse selected-covariance fallbacks=1 (fail-closed) |
| damped native fail-closed (real backend) | typescript | TS-success | sparse selected-covariance fallbacks=1 (fail-closed) |

Both real-backend fault injections are caught TWICE: inline verification throws before the corrupted Qxx reaches the engine (C1 diff 1.00e+0 / C2 residual 2.17e+6 recorded in the engine fallback detail), the engine takes its dense fallback, and the route then fails closed to a clean TypeScript rerun.

## Coverage and policy notes

- `industry_demo` remains weak/non-convergent and is not counted.
- Orientation-heavy, TSCORR-native, REL/PTOL-native, augmentation, and excluded-observation legs were not run — fail-closed by gate construction, not measured.
- Agent contract `tests/phase10i_native_fullqxx_route.test.ts` (13/13, fake dense-backed bundle): eligibility, 2D/preanalysis preservation, kill switch, verified-provenance parity at 1e-6, covariance-only injection, bundle/solver fallback, no bundle load when ineligible, verification faults (corrupted C1/C2, damping, non-finite, truncated dimension, empty-capture/truncation/coverage/dimension units). Also fixed a latent `countingCovarianceSolver` stub bug (`Int32Array.map` truncated fractional covariances to int32 zeros).

## Decision

- Parity/verification/fail-closed: **GO** (bit-exact results at 1e-6 rounding, Qxx ~1e-20, verifier catches real-backend corruption and damping, every ineligible shape reruns clean TS).
- Performance: **NO-GO as an optimization** — native medians are ~1.7–2.1x SLOWER than dense TS on this ladder (verification-dominated, not backend-dominated).
- Routing: ship **default-OFF** (kill switch retains the proven-safe route for opt-in and future work). Do not enable by default until verification cost is addressed (e.g., cheaper C2-only fast path, single shared index map, or trust-once-per-session with damping-metadata gating). No cohort or cap widening on this evidence.
