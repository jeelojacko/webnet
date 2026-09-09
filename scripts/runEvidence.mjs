#!/usr/bin/env node

/**
 * Selected evidence-suite runner.
 *
 * Usage: node scripts/runEvidence.mjs [suite]
 *
 * Suites: all (default), phase8a5, phase8a6, phase8b1, phase9a (all three
 * Phase 9A shards), phase9a-scaling, phase9a-faults, phase9a-corpus, phase9d,
 * phase9e-audit, phase9e-fastpath, phase9h.
 * Unknown suite names fail fast with a clear error — never a silent
 * full-campaign run.
 * Execution always goes through the evidence tier config
 * (vitest.evidence.config.ts); the suite argument only narrows the file
 * selection. `npm run test:evidence [-- <suite>]` is the package entry.
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
