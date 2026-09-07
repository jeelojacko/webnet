# Sparse pre-analysis post-merge safety hotfix

- **Baseline main SHA:** `57e44957d97675ca287c1d5b1b22706e5be69984`
- **Hotfix SHA:** `56ebf8cff20ff9c332f32617ee7c573c200b8ae5`
- **Branch tip SHA:** `4481072185e5e70c35fa40ca6bec1d58f28df7d8`
- **Branch:** `hotfix/sparse-preanalysis-safety` (6 ahead, 0 behind `origin/main`)
- **Initial default:** OFF (safety commit)
- **Final default:** ON (separate re-enable commit)
- **Final validation date:** 2026-09-07

## Findings closed

- **A:** `resolveEffectiveProjectParse` / `parseEffectiveProjectInput` is shared with the session solver and wires `includeFiles` plus `projectRunFiles`. GPS covariance inside an `.INCLUDE`, AUTOADJUST enabled by parser semantics (main input or project run files), and unsupported project-run-file content are gated; effective unknown count stays gated at 128 (127/128/129 boundary proven). Clean main-only and clean include projects remain eligible. Focused regressions passed.
- **B:** Old C1 used `max(1, abs(expected))`. New C1 uses `allowed = max(1e-12, tolerance * abs(expected))` with relative denominator `max(abs(expected), 1e-12)`. Expected `1e-8` vs actual `9e-7` → **C1 FAIL** (rejected); exact-tiny agreement, unit-scale relative tolerance, and absolute-floor cases pass.
- **C:** Full packed inputs were formerly retained for every planning system. Each system is now verified immediately and only a compact verdict is retained. Instrumented maximum retained packed systems: **1** (no packed calls array retained). Real-WASM 120-session closure and atomic whole-session fallback with restart equality pass.
- **D:** `verifyCovarianceSystem` is decomposed into seven named helpers: `checkSystemHeader`, `accumulateGateNormal`, `judgeProductionC2`, `runBoundedVerification`, `judgeSelectedC1`, `judgeHybridC3`, `judgePhysical` (`preanalysisSparseCovarianceGate.ts`, 414 lines; all functions within repository size rules).

## Bounds and regressions

Parameter cap remains **128**; planning-system cap remains **64**; C2 column budget remains **k = 16**. No full Qxx, dense P, sentinel-only n² query, C++ algorithm, adjustment Phase 7C/7D route, or tolerance constants changed. Adjustment sparse cohort, cap, S3, kill switch, condition handling, and fallback behavior are unchanged. Condition remains warn-only and correction remains non-authoritative.

## Final validation record

- **Fresh WASM build:** `rm -rf cpp/build-wasm` then `npm run wasm:build` — PASS; `webnet_core.js` + `webnet_core.wasm` regenerated. Emscripten: `emcc`/`emcmake` at `/home/jacko/emsdk/upstream/emscripten/`, emcc **6.0.9** (`4e42238`).
- **Native CTest:** 7/7 passed.
- **WASM smoke suites:** all 9 passed (smoke, solver smoke, solver parity, sparse smoke, sparse covariance smoke, sparse adjustment parity, sparse behavior parity, sparse bundle worker proof, sparse worker stress).
- **Full default-ON suite (`npm run test:run`):** **2667 passed, 1 skipped, 0 failed** (448 test files, 677 s). Baseline was ~2666 passed / 1 skipped; the +1 reflects route-default-ON suite state.
- **Lint / typecheck / build:** all passed. (Local note: the locally installed Emscripten SDK was moved from `./emsdk` to `/home/jacko/emsdk` so repo lint/vitest globs do not scan the vendor tree; pointer file left at repo root. No project code changed for this.)
- **Industry parity:** **25/25**.
- **Focused hotfix regressions:** phase8b2 + phase8a7 **28/28** passed (A, B, C, D, adjustment regression, production corruption restart-identical); phase8b real-WASM **11/11** passed (corrupted native covariance → atomic TypeScript restart identical, bundle reused).
- **Production corruption fallback:** real WASM backend with the corruption decorator: corrupted small covariance entry → C1 rejects → entire sparse session discarded → clean TypeScript restart **identical** to forced TypeScript.
- **Phase 8B.1 release proof (real-WASM 120-session closure):** **PASS** — 120 sessions, **60 sparse accepts**, **60 fallbacks**, **0 unexpected failures**, **false sparse authorities = 0**, **bundle initialization count = 1** (reuse proven). CI gate 5/5, verdict 1/1.
- **Browser proofs:** `wasm:browser:smoke` PASS; `smoke:phase7c:dist` PASS; `phase8b1:browser-proof` PASS at **`/`** and **`/webnet/`** with the route naturally default ON (no test-only wrapper): eligible sparse accept, camp generic fallback identical to forced TypeScript, adjustment bit-identical. Unsupported `.INCLUDE` content → direct TypeScript is proven by the static eligibility regressions (no WASM init) and the default-OFF gates.
- **GitHub CI (run `34129594906`, commit `4481072…`):** `build` **success** (17m38s); `phase8b1-clean-runner-gate` **success** (1m13s). Re-checked after local validation.
- **Independent reviewer verdict:** **APPROVE**.

## Decision

**POST-MERGE SPARSE PREANALYSIS HOTFIX: GO**

**ROUTE ENABLED:** yes

**READY TO MERGE:** yes (do not merge automatically)

Blockers: none.
