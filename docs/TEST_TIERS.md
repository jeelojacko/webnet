# Test Tiers

WebNet's Vitest tests run in five explicit tiers. Classification is
**semantic** (what a test proves), never runtime-based. Tier membership lives in
one authoritative manifest, `scripts/testTiers.ts` — do not duplicate the lists
in configs, scripts, or CI. `tests/test_tier_manifest.test.ts` enforces the
policy: symmetry (every non-full tier has a non-empty manifest and a config
selecting exactly it; the evidence manifest is exactly the
`tests/evidence/` suite on disk), disjointness (evidence/release/wasm never
overlap; `AGENT_EXCLUDED_TESTS` is exactly their union), and naming (every
manifest entry is a `tests/**` test path, every evidence entry lives under
`tests/evidence/`, campaign-like names — stress/benchmark/soak/calibration —
live under `tests/evidence/` or in the explicit `EVIDENCE_NAME_EXCEPTIONS`
policy list, no browser tests in Node manifests).

## Tiers

| Tier | Command | Config | Contents |
| --- | --- | --- | --- |
| **full** | `npm run test:full` (== `npm run test:run`) | `vitest.config.ts` | Every Vitest test. The authoritative monolithic local suite. |
| **agent** | `npm run test:agent` | `vitest.agent.config.ts` | Full suite **minus** the evidence, release, and real-WASM integration tests. The broad everyday AI-agent regression gate (~1 min). |
| **wasm** | `npm run test:wasm` | `vitest.wasm.config.ts` | Only the explicit real-WASM / worker / native integration tests. |
| **release** | `npm run test:release` | `vitest.release.config.ts` | Only the fast automatic release-certification gates (the Phase 8B.1 and Phase 9A verdicts over committed reports — no workers, no WASM artifact required). |
| **evidence** | `npm run test:evidence [-- <suite>]` | `vitest.evidence.config.ts` via `scripts/runEvidence.mjs` | Only the intentionally expensive long numerical campaigns under `tests/evidence/`. Expected to be very slow; manual-only, never runs in CI. Suites: `all` (default), `phase8b1`, `phase8a6`, `phase8a5`, `phase9a` (all three Phase 9A shards), `phase9a-scaling`, `phase9a-faults`, `phase9a-corpus`; unknown names fail fast. |

`npm run test:certify` runs the automatic CI-equivalent partition locally
(`test:agent` + `test:wasm` + `test:release`).

The three non-full selection tiers (evidence/release/wasm) are **disjoint
file sets**; `full` is their union plus everything else (including the agent
tier). All configs share `vitest.shared.ts` (environment, globals,
setupFiles, pool, excludes) to avoid drift.

## Current membership

Excluded from the agent tier (see `scripts/testTiers.ts` for the authoritative
lists):

- **Evidence** (`tests/evidence/phase8b1_preanalysis_release.test.ts`,
  `tests/evidence/phase8a6_session_evidence.test.ts`,
  `tests/evidence/phase8a5_preanalysis_safety_evidence.test.ts`,
  `tests/evidence/phase9a_evidence_scaling.test.ts`,
  `tests/evidence/phase9a_evidence_faults.test.ts`,
  `tests/evidence/phase9a_evidence_corpus.test.ts`): large repeated
  numerical campaigns. Manual-only via `npm run test:evidence` or the
  Evidence workflow. The Phase 9A shards share helpers via
  `tests/evidence/phase9aEvidenceShared.ts`, run independently with no
  duplicate execution, and write one atomic raw fragment each to
  `artifacts/evidence/phase9a/` (gitignored); report assembly from
  fragments into `reports/phase9a/` is a separate pure step
  (`scripts/phase9a/phase9aReport.ts`, `npm run phase9a:assemble-report`),
  never part of evidence execution.
- **Release** (`tests/phase8b1_release_verdict.test.ts`,
  `tests/phase9a_release_verdict.test.ts`): the fast,
  focused, worker-free verdicts over the committed `reports/phase8b1/` and
  `reports/phase9a/` evidence legs. Stays automatic — they run in
  CI numerical certification via `npm run test:release`.
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

Slow ≠ release. A test belongs in the evidence or wasm tier because its
**purpose** is stress, certification, repeated real-WASM session evidence,
clean-runner proof, or long real-WASM calibration — not because it takes 10–20
seconds.

## Rules for future tests

- A new test expected to take more than ~10 s because it performs stress,
  evidence, repeated real-WASM sessions, browser certification, or performance
  campaigns **must** be added to `scripts/testTiers.ts` (WASM or EVIDENCE —
  long campaigns go under `tests/evidence/`) instead of silently joining the
  agent tier.
- Never add runtime-based CI gates (e.g. fail if agent tier > N seconds);
  machines and runners vary. Tier membership is the hard contract; wall time is
  observational.
- Profile with `npm run test:profile` (full tier), `npm run test:profile -- agent`,
  `npm run test:profile -- wasm`, `npm run test:profile -- release`, or
  `npm run test:profile -- evidence`. Output (raw JSON + summary) goes to
  `/tmp/webnet-test-profile/` by default and must not be committed.

## WASM artifact policy

- `test:agent` and `test:release` never invoke `npm run wasm:build` and do not
  require WASM artifacts.
- `test:wasm` / `test:evidence` keep the existing artifact behavior: if the
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
worker, C++, test-infrastructure, `tests/evidence/`, and workflow changes
require numerical certification. Numerical-sensitive pull requests build WASM
once, run CTest, `npm run test:wasm`, and `npm run test:release` (the fast
verdict gate). Safe-only pull requests keep the numerical job as a successful
no-op so its check remains present.

`test:full` and `test:evidence` never run in CI — by design, not by omission.
The evidence campaigns run only via the manual `Evidence` workflow
(`.github/workflows/evidence.yml`, `workflow_dispatch`), which builds the
WASM artifact and runs `npm run test:evidence`.

Pushes to `main` and manual CI runs always require numerical certification,
regardless of changed files. `test:full` remains unchanged and is the
authoritative complete local command; `test:certify` is the automatic
agent+WASM+release partition. The Phase 8B.1 clean-runner test remains covered
by `WASM_INTEGRATION_TESTS`; its duplicate dedicated CI job was removed.

## Handoff

Phase 9A evidence execution is separated from release checks: the Evidence
workflow runs the `phase9a*` shards, uploads raw fragments
(`artifacts/evidence/phase9a/`) separately from reports, and assembles
`reports/phase9a/` in a dedicated step. Phase 9A SHAs resolve explicit env
(`PHASE9A_BASELINE_SHA` / `PHASE9A_HEAD_SHA`, the workflow passes
`github.sha` plus an optional `baseline_sha` input) > reliable CI >
`git rev-parse --verify HEAD` only > null, with no origin fetch.
