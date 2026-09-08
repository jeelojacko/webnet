# Phase 9B production runtime parameter cap 256 rollout

- Baseline main: `abee9387381d1aba43a16b6f1ef62db7326255c2`.
- Selected rollout: runtime per-system parameter cap **256**.
- Phase 9A validated both 256 and 512. 256 resolves the immediate orientation/runtime-parameter headroom constraint while keeping the static station envelope at 128 and minimizing staged rollout change. 512 remains validated future headroom and is not enabled in Phase 9B.

## Current policy

| Control | Before | After |
| --- | ---: | ---: |
| Static station-unknown cap | 128 | 128 |
| Runtime per-system parameter cap | 128 | 256 |
| Planning-system cap | 64 | 64 |
| Verification columns (`k`) | 16 | 16 |
| Verification query backstop | 16384 | 16384 |
| Captured-call backstop | 512 | 512 |

Static boundary: 127/128 pass, 129 reject. Runtime boundary: 255/256 pass, 257 reject. Planning boundary: 63/64 pass, 65 reject.

## Historical Phase 9A basis

`reports/phase9a/cap-widening-evidence.json` remains historical: production parameter cap 128 at that time, `PARAMETER CAP 256: GO`, `PARAMETER CAP 512: GO`, recommended station cap 128, and recommended runtime parameter cap 256. Its JSON SHA-256 is `f8d2d43373f909eb4541a646ed1fd2e9758f49e78cfd12981f2f298a17522e88`; the committed Phase 9A reports are byte-untouched.

## Automatic validation

- Focused Phase 9B agent boundaries: PASS.
- Exact-256 real-WASM proof and over-cap 257 restart proof: PASS.
- Tier manifest: PASS.
- `lint`, `typecheck`, and build: PASS.
- `test:agent`: 441 files, 2653 passed, 1 skipped.
- `test:wasm`: 8 files, 41 passed.
- `test:release`: 3 files, 4 passed.
- Industry parity: 25/25.
- Phase 9A evidence and `test:full` were not run.
- Independent reviewer verdict: **APPROVE**.

## Behavior and scope

Production routing/backend behavior changes for systems with 129–256 parameters. The mathematical contract, tolerances, C++ implementation, supported feature set, station cap, planning cap, verification `k`, query backstop, and captured-call cap do not change. No 512 production rollout is enabled.

Verdict: **RUNTIME PARAMETER CAP 256: SHIPPED (station 128 unchanged)**.
