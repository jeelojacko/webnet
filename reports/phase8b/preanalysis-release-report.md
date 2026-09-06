# Phase 8B preanalysis release report (real-WASM, default-OFF)

- Default route: TypeScript (kill switch OFF).
- WASM artifact: cpp/build-wasm/webnet_core.js (+ .wasm).
- Verification: bounded deterministic complete columns, hard k = 16 (no n^2 re-query, no full inverse/Qxx).
- In-process default-OFF: {"route":"typescript","initCalls":0}
- In-process small anchor (real bundle): {"route":"sparse","contractPass":true,"maxCoordDiff":0,"maxCovarianceDiff":4.336808689942018e-19}
- In-process camp cap fallback: {"route":"typescript","reasonSample":"system 1: parameterCount 170 exceeds cap 128 (fail-closed; not delegated)","restartIdentical":true}
- In-process corrupt restart: {"route":"typescript","restartIdentical":true}
- In-process boundaries: {"staticUnknownHook129Eligible":false,"forcedC2Fallback":true}
- Worker default-OFF: {"initCalls":0,"deepEqualTypeScript":true}
- Worker anchor (native calls): {"correctionCalls":16,"covarianceCalls":32,"contractPass":true,"maxCoordDiff":0,"maxCovarianceDiff":4.336808689942018e-19}
- Worker camp fallback: {"restartIdentical":true}
- Worker init-failure fallback: {"restartIdentical":true}
- Worker interleave/cache: {"bitIdenticalRepeat":true,"bundleInitCount":1}
- Worker restart after terminate: {"cleanAfterTerminate":true}

Release posture: default stays OFF. Enabling requires every gate above to pass with the real bundle; any failure restarts the original request clean in TypeScript exactly once.

