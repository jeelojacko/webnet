#!/usr/bin/env node

/**
 * Selected evidence-suite runner.
 *
 * Usage: node scripts/runEvidence.mjs [suite]
 *
 * Suites: all (default), phase8a5, phase8a6, phase8b1, phase9a (all three
 * Phase 9A shards), phase9a-scaling, phase9a-faults, phase9a-corpus, phase9d,
 * phase9e-audit, phase9e-fastpath, phase9h, phase9i, phase9j, phase10a,
 * phase10b, phase10c, phase10d, phase10e, phase10f, phase10g, phase10h,
 * phase10i, phase10j, phase10k, phase10l, phase10m, phase10n.
 * Unknown suite names fail fast with a clear error — never a silent
 * full-campaign run.
 * Execution always goes through the evidence tier config
 * (vitest.evidence.config.ts); the suite argument only narrows the file
 * selection. `npm run test:evidence [-- <suite>]` is the package entry.
 *
 * phase10a runs the normal 3D adjustment profile.
 *
 * Phase 9A shards write atomic raw fragments to
 * artifacts/evidence/phase9a/<shard>.json (gitignored). Report assembly
 * from fragments into reports/phase9a/ is a separate step owned by
 * scripts/phase9a/phase9aReport.ts — never part of evidence execution.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const PHASE9A_SHARDS = [
  'tests/evidence/phase9a_cap_widening_scaling.test.ts',
  'tests/evidence/phase9a_cap_widening_faults.test.ts',
  'tests/evidence/phase9a_cap_widening_corpus.test.ts',
];

const SUITES = {
  phase8a5: ['tests/evidence/phase8a5_preanalysis_safety_evidence.test.ts'],
  phase8a6: ['tests/evidence/phase8a6_session_evidence.test.ts'],
  phase8b1: ['tests/evidence/phase8b1_preanalysis_release.test.ts'],
  phase9a: [...PHASE9A_SHARDS],
  'phase9a-scaling': ['tests/evidence/phase9a_cap_widening_scaling.test.ts'],
  'phase9a-faults': ['tests/evidence/phase9a_cap_widening_faults.test.ts'],
  'phase9a-corpus': ['tests/evidence/phase9a_cap_widening_corpus.test.ts'],
  phase9d: ['tests/evidence/phase9d_solve_audit_timing.test.ts'],
  'phase9e-audit': ['tests/evidence/phase9e_scenario_audit.test.ts'],
  'phase9e-fastpath': ['tests/evidence/phase9e_preanalysis_correction_fastpath.test.ts'],
  phase9h: ['tests/evidence/phase9h_serial_profile.test.ts'],
  phase9i: ['tests/evidence/phase9i_metric_reuse_profile.test.ts'],
  phase9j: ['tests/evidence/phase9j_path_priority_profile.test.ts'],
  phase10a: ['tests/evidence/phase10a_3d_adjustment_profile.test.ts'],
  phase10b: ['tests/evidence/phase10b_native_correction_evidence.test.ts'],
  phase10c: ['tests/evidence/phase10c_covariance_statistics_evidence.test.ts'],
  phase10d: ['tests/evidence/phase10d_qxx_reuse_evidence.test.ts'],
  phase10e: ['tests/evidence/phase10e_production_qxx_reuse.test.ts'],
  phase10f: ['tests/evidence/phase10f_post_reuse_profile.test.ts'],
  phase10g: ['tests/evidence/phase10g_final_covariance_architecture.test.ts'],
  phase10h: ['tests/evidence/phase10h_native_qxx_fair_evidence.test.ts'],
  phase10i: ['tests/evidence/phase10i_native_route_evidence.test.ts'],
  phase10j: ['tests/evidence/phase10j_3d_native_performance_decomposition.test.ts'],
  phase10k: ['tests/evidence/phase10k_native_verification_boundary.test.ts'],
  phase10l: ['tests/evidence/phase10l_verification_reuse_performance.test.ts'],
  phase10m: ['tests/evidence/phase10m_correction_stage_audit.test.ts', 'tests/evidence/phase10m_fallback_gap.test.ts', 'tests/evidence/phase10m_node_measurement.test.ts', 'tests/evidence/phase10m_toggle_smoke.test.ts'],
  phase10n: ['tests/evidence/phase10n_native_correction_evidence.test.ts'],
  phase10o: ['tests/evidence/phase10o_factorization_lifecycle.test.ts'],
};

const suite = process.argv[2] ?? 'all';
if (suite !== 'all' && !Object.hasOwn(SUITES, suite)) {
  console.error(
    `Unknown evidence suite "${suite}". Expected one of: all, ${Object.keys(SUITES).join(', ')}`
  );
  process.exit(2);
}

const files = suite === 'all' ? [] : SUITES[suite];
if (suite.startsWith('phase9a')) {
  const fragmentNames = suite === 'phase9a'
    ? ['scaling', 'faults', 'corpus']
    : [suite.slice('phase9a-'.length)];
  for (const name of fragmentNames) {
    fs.rmSync(path.join(process.cwd(), 'artifacts/evidence/phase9a', `${name}.json`), { force: true });
  }
}
const result = spawnSync(
  process.execPath,
  [path.join(here, 'runVitest.mjs'), 'run', '--config', 'vitest.evidence.config.ts', ...files],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
