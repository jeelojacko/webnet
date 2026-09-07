# Test Tiers

WebNet's Vitest tests run in four explicit tiers. Classification is
**semantic** (what a test proves), never runtime-based. Tier membership lives in
one authoritative manifest, `scripts/testTiers.ts` — do not duplicate the lists
in configs, scripts, or CI.

## Tiers

| Tier | Command | Config | Contents |
| --- | --- | --- | --- |
| **full** | `npm run test:full` (== `npm run test:run`) | `vitest.config.ts` | Every Vitest test. The authoritative monolithic local suite. |
| **agent** | `npm run test:agent` | `vitest.agent.config.ts` | Full suite **minus** the release/evidence and real-WASM integration tests. The broad everyday AI-agent regression gate (~1 min). |
| **wasm** | `npm run test:wasm` | `vitest.wasm.config.ts` | Only the explicit real-WASM / worker / native integration tests. |
| **release** | `npm run test:release` | `vitest.release.config.ts` | Only the intentionally expensive certification / evidence / stress campaigns. Expected to be very slow; run explicitly, never as everyday feedback. |

The three non-full tiers are **disjoint file sets**; `full` is their union plus
everything else. All configs share `vitest.shared.ts` (environment, globals,
setupFiles, pool, excludes) to avoid drift.

## Current membership

Excluded from the agent tier (see `scripts/testTiers.ts` for the authoritative
lists):

- **Release evidence** (`tests/phase8b1_preanalysis_release.test.ts`,
  `tests/phase8a6_session_evidence.test.ts`,
  `tests/phase8a5_preanalysis_safety_evidence.test.ts`): large repeated
  numerical campaigns / release closure / safety calibration.
- **WASM integration** (`tests/phase8b_preanalysis_realwasm.test.ts`,
  `tests/phase8b1_clean_runner_gate.test.ts`,
  `tests/phase8a7_preanalysis_production.test.ts`,
  `tests/phase8a_preanalysis_sparse_evidence.test.ts`,
  `tests/phase7b7_worker_corpus.test.ts`,
  `tests/phase7b5_candidate_corpus.test.ts`,
  `tests/phase7b_worker_sparse_proof.test.ts`): real worker / real-bundle /
  native-integration proofs. The two `phase7b*` files fail (not skip) when
  the WASM artifact is absent, so they must not run in the artifact-free
  agent tier.

Deliberately **kept in the agent tier** even though they are slower:
`tests/run_session.test.ts` (core session behavior), the cheap sparse-safety
tests (`phase7c_sparse_auto_route`, `phase7d_release_hardening`,
`phase8b2_sparse_preanalysis_safety_hotfix`, `phase8a6_covariance_sentinel`,
`computational_parity_harness`, …). `tests/test_tier_manifest.test.ts` asserts
this set stays in the agent tier.

Slow ≠ release. A test belongs in the release or wasm tier because its
**purpose** is stress, certification, repeated real-WASM session evidence,
clean-runner proof, or long real-WASM calibration — not because it takes 10–20
seconds.

## Rules for future tests

- A new test expected to take more than ~10 s because it performs stress,
  evidence, repeated real-WASM sessions, browser certification, or performance
  campaigns **must** be added to `scripts/testTiers.ts` (WASM or release)
  instead of silently joining the agent tier.
- Never add runtime-based CI gates (e.g. fail if agent tier > N seconds);
  machines and runners vary. Tier membership is the hard contract; wall time is
  observational.
- Profile with `npm run test:profile` (full tier), `npm run test:profile -- agent`,
  `npm run test:profile -- wasm`, or `npm run test:profile -- release`. Output
  (raw JSON + summary) goes to `/tmp/webnet-test-profile/` by default and must
  not be committed.

## WASM artifact policy

- `test:agent` never invokes `npm run wasm:build` and does not require WASM
  artifacts.
- `test:wasm` / `test:release` keep the existing artifact behavior: if the
  real `cpp/build-wasm` bundle is absent and the test contract requires real
  WASM, the tests **fail clearly** — never a silent skip.
- C++/WASM build-glue changes require `npm run wasm:build` + `npm run cpp:test`
  before `npm run test:wasm`.

## CI

GitHub CI (`.github/workflows/ci.yml`) has stable `classify`, `core`, and
`numerical` jobs. Every pull request runs the core validation through
`npm run test:agent`, plus the harness, industry parity, build, CLI smoke, and
legacy corpus gates. The classifier is fail-closed: docs/components/study-only
changes are the explicitly recognized safe-only paths; unknown, mixed, engine,
worker, C++, test-infrastructure, and workflow changes require numerical
certification. Numerical-sensitive pull requests build WASM once, run CTest,
`npm run test:wasm`, and `npm run test:release`. Safe-only pull requests keep
the numerical job as a successful no-op so its check remains present.

Pushes to `main` and manual workflow runs always require numerical
certification, regardless of changed files. `test:full` remains unchanged and
is the authoritative complete local command; CI executes the equivalent
agent+WASM+release partition. The Phase 8B.1 clean-runner test remains covered
by `WASM_INTEGRATION_TESTS`; its duplicate dedicated CI job was removed.

## Handoff

When the Phase 9A cap-widening branch lands on main, add
`tests/phase9a_cap_widening_evidence.test.ts` to `RELEASE_EVIDENCE_TESTS` in
`scripts/testTiers.ts`.
