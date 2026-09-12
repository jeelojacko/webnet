/**
 * Authoritative WebNet Vitest test-tier classification.
 *
 * Five explicit tiers (all driven by this file — do NOT duplicate these
 * lists elsewhere):
 *
 * - FULL: default vitest.config.ts; every test. `npm run test:run` / `test:full`.
 * - AGENT: FULL minus EVIDENCE, RELEASE, and WASM. The broad everyday agent
 *   regression suite. `npm run test:agent` (vitest.agent.config.ts).
 * - WASM: focused real-WASM / worker / native integration tests.
 *   `npm run test:wasm` (vitest.wasm.config.ts).
 * - RELEASE: fast automatic release-certification gate (the Phase 8B.1
 *   verdict over committed reports). `npm run test:release`
 *   (vitest.release.config.ts). Runs in CI numerical certification.
 * - EVIDENCE: intentionally expensive long numerical campaigns under
 *   tests/evidence/. `npm run test:evidence` (vitest.evidence.config.ts).
 *   Manual-only: never runs in CI (see .github/workflows/evidence.yml).
 *
 * Classification is SEMANTIC (purpose), never runtime-based:
 * evidence tests are excluded from agent/release/wasm/CI because they run
 * large repeated numerical campaigns; slow core behavior tests
 * (e.g. run_session) stay in the agent tier.
 *
 * Rule for future tests: a new test expected to take more than ~10 s
 * because it performs stress, evidence, repeated real-WASM sessions,
 * browser certification, or performance campaigns MUST be added here
 * (WASM or EVIDENCE) instead of silently joining the agent tier.
 *
 */

/**
 * Intentionally expensive long numerical campaigns (manual-only).
 * Name policy: every entry MUST live under tests/evidence/.
 */
export const EVIDENCE_TESTS = [
  'tests/evidence/phase8b1_preanalysis_release.test.ts',
  'tests/evidence/phase8a6_session_evidence.test.ts',
  'tests/evidence/phase8a5_preanalysis_safety_evidence.test.ts',
  'tests/evidence/phase9a_cap_widening_scaling.test.ts',
  'tests/evidence/phase9a_cap_widening_faults.test.ts',
  'tests/evidence/phase9a_cap_widening_corpus.test.ts',
  'tests/evidence/phase9d_solve_audit_timing.test.ts',
  'tests/evidence/phase9e_scenario_audit.test.ts',
  'tests/evidence/phase9e_preanalysis_correction_fastpath.test.ts',
  'tests/evidence/phase9h_serial_profile.test.ts',
  'tests/evidence/phase9i_metric_reuse_profile.test.ts',
  'tests/evidence/phase9j_path_priority_profile.test.ts',
  'tests/evidence/phase10a_3d_adjustment_profile.test.ts',
  'tests/evidence/phase10b_native_correction_evidence.test.ts',
  'tests/evidence/phase10c_covariance_statistics_evidence.test.ts',
  'tests/evidence/phase10d_qxx_reuse_evidence.test.ts',
  'tests/evidence/phase10e_production_qxx_reuse.test.ts',
  'tests/evidence/phase10f_post_reuse_profile.test.ts',
  'tests/evidence/phase10g_final_covariance_architecture.test.ts',
  'tests/evidence/phase10h_native_qxx_fair_evidence.test.ts',
  'tests/evidence/phase10i_native_route_evidence.test.ts',
  'tests/evidence/phase10j_3d_native_performance_decomposition.test.ts',
  'tests/evidence/phase10k_native_verification_boundary.test.ts',
  'tests/evidence/phase10l_verification_reuse_performance.test.ts',
  'tests/evidence/phase10m_correction_stage_audit.test.ts',
  'tests/evidence/phase10m_fallback_gap.test.ts',
  'tests/evidence/phase10m_node_measurement.test.ts',
  'tests/evidence/phase10m_toggle_smoke.test.ts',
  'tests/evidence/phase10n_native_correction_evidence.test.ts',
  'tests/evidence/phase10o_factorization_lifecycle.test.ts',
] as const;

/** Fast automatic release-certification gate (committed-report verdict). */
export const RELEASE_TESTS = [
  'tests/phase8b1_release_verdict.test.ts',
  'tests/phase9a_release_verdict.test.ts',
  'tests/phase9b_release_verdict.test.ts',
] as const;

/** Focused real-WASM / worker / native integration tests. */
export const WASM_INTEGRATION_TESTS = [
  'tests/phase8b_preanalysis_realwasm.test.ts',
  'tests/phase9b_preanalysis_parameter_cap_realwasm.test.ts',
  'tests/phase8b1_clean_runner_gate.test.ts',
  'tests/phase8a7_preanalysis_production.test.ts',
  'tests/phase8a_preanalysis_sparse_evidence.test.ts',
  'tests/phase7b7_worker_corpus.test.ts',
  'tests/phase7b5_candidate_corpus.test.ts',
  'tests/phase7b_worker_sparse_proof.test.ts',
] as const;

/** Tests excluded from the everyday agent tier (intentionally disjoint sets). */
export const AGENT_EXCLUDED_TESTS = [
  ...EVIDENCE_TESTS,
  ...RELEASE_TESTS,
  ...WASM_INTEGRATION_TESTS,
] as const;

/**
 * Cheap, high-value numerical regression tests that MUST remain in the
 * agent tier. Verified by tests/test_tier_manifest.test.ts.
 */
export const AGENT_REQUIRED_TESTS = [
  'tests/computational_parity_harness.test.ts',
  'tests/phase9b_preanalysis_parameter_cap.test.ts',
  'tests/phase7c_sparse_auto_route.test.ts',
  'tests/phase7d_release_hardening.test.ts',
  'tests/phase8b2_sparse_preanalysis_safety_hotfix.test.ts',
  'tests/phase8a6_covariance_sentinel.test.ts',
  'tests/phase10e_production_qxx_reuse.test.ts',
  'tests/phase10i_native_fullqxx_route.test.ts',
] as const;

/**
 * Suspicious-name exceptions: test files whose basename suggests a long
 * campaign (stress/benchmark/soak/calibration) but that are classified
 * OUTSIDE the evidence tier by design because they are fast, unit-scope
 * checks — not repeated numerical campaigns. The manifest test enforces
 * this: any new suspiciously named test must live under tests/evidence/
 * (and be listed in EVIDENCE_TESTS) or be deliberately added here.
 */
export const EVIDENCE_NAME_EXCEPTIONS = [
  'tests/benchmark_adjustment.test.ts',
  'tests/browser_large_project_benchmark.test.tsx',
  'tests/phase5_benchmark_networks.test.ts',
  'tests/phase6_sparse_large_benchmark.test.ts',
  'tests/phase7b7_safety_benchmark.test.ts',
  'study-desktop/tests/study_ai_unit_calibration.test.ts',
  'study-desktop/tests/study_ai_unit_calibration_audit.test.ts',
  'study-desktop/tests/study_ai_unit_calibration_compare.test.ts',
  'study-desktop/tests/study_ai_unit_calibration_v5.test.ts',
  'study-desktop/tests/study_ai_unit_validation_calibration.test.ts',
] as const;

/**
 * Symmetric tier-selection map: every non-full tier name resolves to its
 * manifest list. Tier configs and tests/test_tier_manifest.test.ts consume
 * this so structure stays symmetric as tiers evolve.
 */
export const TIER_MANIFESTS = {
  evidence: EVIDENCE_TESTS,
  release: RELEASE_TESTS,
  wasm: WASM_INTEGRATION_TESTS,
} as const;

export type NonFullTierName = keyof typeof TIER_MANIFESTS;
