# Phase 8B.1 release-closure audit (2026-09-06)

Scope: release **evidence only**. The production preanalysis sparse route
(`src/workers/preanalysisSparseAutoRoute.ts`, default-OFF kill switch) and
all algorithms, C1/C2/C3 sentinels, k = 16 verification columns, caps
(128 unknowns / 64 planning systems / 512 capture bound), cohort policy,
and adjustment behavior are **frozen** — nothing in this phase changes them.

## Existing route (as built by Phase 8A.7 / hardened by Phase 8B)

- Entry: `adjustmentWorker.ts` dispatches `runMode === 'preanalysis'`
  requests through `runWithPreanalysisSparseAutoRoute`; adjustment requests
  keep the Phase 7C route. Injected worker-local runtime bypasses both.
- Kill switch `setPreanalysisSparseAutoRouteEnabled` defaults **false**;
  disabled short-circuits to TypeScript with zero WASM init (no loader call).
- Static eligibility: preanalysis + 2D + plain (no robust / TS-corr /
  auto-adjust / cluster dual-pass / inline `.AUTOADJUST` / GPS covariance) +
  unknowns <= 128. Reasons are fixed-order and byte-identical.
- Runtime pre-dispatch gates (`PreanalysisGatedCorrectionSolver` /
  `PreanalysisGatedCovarianceCapture`) refuse over-cap systems with a typed
  `PreanalysisSparseCapError` **before** native delegation; covariance must
  pair with a started correction system.
- Post-run judgment: C1 (dense-N-once, selected-column TS reference at every
  queried entry), C2 (captured native values on complete columns + bounded
  deterministic complete-column re-verification, hard k = 16), C3 hybrid,
  physical validity, damping/fallback/NaN/non-finite/empty-capture checks.
  Any failure discards the mixed outcome and restarts the original immutable
  request in TypeScript **exactly once**. Condition is warn-only.
- Exact-production-route Node proof exists (`tests/phase8b_preanalysis_realwasm.test.ts`
  via `scripts/phase8bPreanalysisWorkerBridge.ts`): real `cpp/build-wasm`
  bundle, counting delegates, no Phase 8A bridge, no fake bundle, no injected
  runtime. Deterministic report under `reports/phase8b/`.

## Gaps this phase must close (8B.1)

1. **No long-horizon reuse proof.** Phase 8B ran 3-session interleaves only.
   Missing: >= 100 sequential mixed sessions on one reused worker with a
   single bundle init, per-session route classification, and bit-identical
   repeats.
2. **Single accepted shape.** Only the trivial small anchor
   (`preanalysis_cli.dat`, 16 correction + 32 covariance native calls) was
   proven accepted end-to-end. Missing: more accepted real-WASM cases.
3. **No cross-mode interleave.** Preanalysis and adjustment sessions never
   shared one worker in the evidence, so Phase 7C/8B route coexistence on a
   reused bundle is unproven.
4. **No memory evidence** on the exact production route (worker RSS/heap
   across a long session run; bundle-cache stability).
5. **No cancellation evidence** on the exact production route (cancel →
   `cancelled` → worker stays healthy).
6. **No bundle retry on a reused worker lineage** (init-failure fallback was
   proven on fresh workers only) and no per-session retry/reuse counters.
7. **No browser production proof** for the preanalysis route: no run through
   a real module worker with real dist `webnet_core` assets, neither at root
   nor under `BASE_URL=/webnet/`, and no adjustment non-root regression
   beside it.
8. **No clean-runner / real-artifact prerequisite gate**: the Phase 8B suite
   fails when the artifact is absent (good), but there is no documented gate
   or CI wiring decision for the release proof.
9. **No release-closure verdict artifact**: `reports/phase8b/` records gates
   but never renders a default-off/enable decision with blockers.

## Method constraints (binding for 8B.1)

- Real WASM only: the actual `cpp/build-wasm/webnet_core.js` (+ `.wasm`)
  bundle. No fake bundle, no runtime injection, no Phase 8A bridge.
- Test-only seams only: `scripts/phase8bPreanalysisWorkerBridge.ts` and the
  existing route test hooks may be extended; production files stay untouched.
- Deterministic reports: counts, routes, reasons, contract maxima only — no
  wall-clock timings (prior timing churn in `reports/` must be restored, not
  committed).
- Browser proof enables the route **only inside the proof harness**
  (dev-server in-page enablement of the same modules); the shipped bundle
  keeps default-OFF with no UI or persisted switch.
- If any required proof cannot be done, record the exact blocker and leave
  Phase 8B.1 **NO-GO**. Do not commit.

## Closure outcome (2026-09-06, verdict GO)

- `stress-evidence.json` (via `npm run phase8b1:release-proof`): 120
  sequential mixed sessions on one reused worker (45 preanalysis sparse
  accepts + 15 native 7C adjustment accepts, 60 fail-closed
  fallbacks/reference), single bundle init, contract maxCoordDiff 0,
  cancel/retry/restart proven, zero evidence failures. Cancel attempt counts
  and memory bytes are recorded informational only (volatile run to run).
- `browser-proof.json` (via `npm run phase8b1:browser-proof`): root +
  `/webnet/` with the real module worker and real dist assets — default-OFF
  control (anchor/adjust bit-identical cross-engine; camp core maxAbs
  2.1e-11 with 2/522 advisory cue lines flipped at a last-ulp threshold
  boundary) PLUS enabled sparse acceptance through the test-only wrapper
  (`scripts/phase8b1ProofWorker.ts`: real production worker module +
  harness-only switch, esbuild-bundled per base with only
  `import.meta.env.BASE_URL` defined; no production/default/protocol
  change): anchor core maxAbs 3.6e-15 with same-V8 native-path divergence
  (a TS fallback would be bit-identical), camp fallback bit-identical.
  First attempt exposed a real fail-closed path: without the BASE_URL
  define the wrapper's WASM init throws and the route restarts clean in TS.
- `phase8b1_clean_runner_gate.test.ts` + CI job
  `phase8b1-clean-runner-gate` (wasm:build precedes the focused 5-test
  gate; missing artifacts fail, never skip). The 10-minute stress and the
  browser proof stay local-only for runtime reasons.
- `preanalysis-release-closure.json/.md` (via `npm run phase8b1:verdict`):
  explicit `browserEnabledSparseAcceptance: true` /
  `cleanRunnerCI: true`, verdict GO, blockers none. Reviewer timer-cleanup
  finding fixed in `tests/helpers/phase8b1WorkerHarness.ts` (waiter timers
  cleared + unrefd on settle/drop).
