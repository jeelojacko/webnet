# Sparse pre-analysis post-merge safety hotfix

- **Baseline main SHA:** `57e44957d97675ca287c1d5b1b22706e5be69984`
- **Hotfix SHA:** `56ebf8cff20ff9c332f32617ee7c573c200b8ae5`
- **Branch:** `hotfix/sparse-preanalysis-safety` (5 ahead, 0 behind `origin/main`)
- **Initial default:** OFF (safety commit)
- **Final default:** ON (separate re-enable commit)

## Findings closed

- **A:** `resolveEffectiveProjectParse` / `parseEffectiveProjectInput` is shared with the session solver and wires `includeFiles` plus `projectRunFiles`. Include GPS covariance, enabled AUTOADJUST, project-run-file unsupported content, and effective unknown inflation are gated; clean main-only and clean include cases remain eligible.
- **B:** Old C1 used `max(1, abs(expected))`. New C1 uses `allowed = max(ABSOLUTE_FLOOR, tolerance * abs(expected))` and relative denominator `max(abs(expected), ABSOLUTE_FLOOR)`. `1e-8` vs `9e-7` is rejected; exact tiny values, relative-tolerance, and floor cases are covered.
- **C:** Full packed inputs were formerly retained for every planning system. Each system is now verified immediately and only a compact verdict is retained. Instrumented maximum retained packed systems: **1**. Atomic whole-session fallback and restart equality pass.
- **D:** `verifyCovarianceSystem` is decomposed into seven named helpers: header, normal accumulation, production C2, bounded native C2, selected C1, C3, and physical checks.

## Bounds and regressions

Parameter cap remains **128**; planning-system cap remains **64**; C2 column budget remains **k = 16**. No full Qxx, dense P, sentinel-only n² query, C++ algorithm, adjustment Phase 7C/7D route, or tolerance constants changed. Condition remains warn-only and correction remains non-authoritative.

The real-WASM 120-session release closure passed: small/plain GPS/direction/medium acceptance cases, camp and coldstream fallbacks, adjustment interleave, cancellation, worker restart, and init-failure retry. False sparse authorities: **0**. Browser proof passed at `/` and `/webnet/`. Industry parity: **25/25**. Focused hotfix/evidence subset: **40 tests passed**; worker-reported full suite: **2666 passed, 1 skipped** with route default OFF.

## Validation status

Lint, typecheck, build, C++ tests (7/7), sparse smoke/parity/behavior, browser smoke, Phase 7C dist smoke, Phase 8B.1 CI gate, browser proof, and release verdict passed. Independent reviewer verdict: **APPROVE**.

`npm run wasm:build` could not run because `emcmake` is unavailable (`ENOENT`); existing WASM artifacts were used by the passing proofs. GitHub CI was not run. The final default-ON full `npm run test:run` was not completed within the available command timeout, although the 120-session release closure and Phase 8 evidence subset passed.

## Decision

**POST-MERGE SPARSE PREANALYSIS HOTFIX: NO-GO**

**ROUTE RE-ENABLED:** yes

**READY TO MERGE:** no

Blockers: install/use Emscripten and run `npm run wasm:build`, obtain green GitHub CI, and complete the final default-ON full suite.
