/**
 * Authoritative WebNet Vitest test-tier classification.
 *
 * Tiers (all driven by this file — do NOT duplicate these lists elsewhere):
 *
 * - FULL: default vitest.config.ts; every test. `npm run test:run` / `test:full`.
 * - RELEASE: intentionally expensive certification / evidence / stress
 *   campaigns. `npm run test:release` (vitest.release.config.ts).
 * - WASM: focused real-WASM / worker / native integration tests.
 *   `npm run test:wasm` (vitest.wasm.config.ts).
 * - AGENT: FULL minus RELEASE and WASM. The broad everyday agent
 *   regression suite. `npm run test:agent` (vitest.agent.config.ts).
 *
 * Classification is SEMANTIC (purpose), never runtime-based:
 * release/evidence tests are excluded because they run large repeated
 * numerical campaigns; slow core behavior tests (e.g. run_session) stay
 * in the agent tier.
 *
 * Rule for future tests: a new test expected to take more than ~10 s
 * because it performs stress, evidence, repeated real-WASM sessions,
 * browser certification, or performance campaigns MUST be added here
 * (WASM or release) instead of silently joining the agent tier.
 *
 * Handoff: when the Phase 9A cap-widening branch lands on main, add
 * 'tests/phase9a_cap_widening_evidence.test.ts' to RELEASE_EVIDENCE_TESTS.
 */

/** Intentionally expensive certification / evidence / stress campaigns. */
export const RELEASE_EVIDENCE_TESTS = [
  'tests/phase8b1_preanalysis_release.test.ts',
  'tests/phase8a6_session_evidence.test.ts',
  'tests/phase8a5_preanalysis_safety_evidence.test.ts',
] as const;

/** Focused real-WASM / worker / native integration tests. */
export const WASM_INTEGRATION_TESTS = [
  'tests/phase8b_preanalysis_realwasm.test.ts',
  'tests/phase8b1_clean_runner_gate.test.ts',
  'tests/phase8a7_preanalysis_production.test.ts',
  'tests/phase8a_preanalysis_sparse_evidence.test.ts',
  'tests/phase7b7_worker_corpus.test.ts',
  'tests/phase7b5_candidate_corpus.test.ts',
  'tests/phase7b_worker_sparse_proof.test.ts',
] as const;

/** Tests excluded from the everyday agent tier (intentionally disjoint sets). */
export const AGENT_EXCLUDED_TESTS = [
  ...RELEASE_EVIDENCE_TESTS,
  ...WASM_INTEGRATION_TESTS,
] as const;

/**
 * Cheap, high-value numerical regression tests that MUST remain in the
 * agent tier. Verified by tests/test_tier_manifest.test.ts.
 */
export const AGENT_REQUIRED_TESTS = [
  'tests/computational_parity_harness.test.ts',
  'tests/phase7c_sparse_auto_route.test.ts',
  'tests/phase7d_release_hardening.test.ts',
  'tests/phase8b2_sparse_preanalysis_safety_hotfix.test.ts',
  'tests/phase8a6_covariance_sentinel.test.ts',
] as const;
