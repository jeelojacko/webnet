#!/usr/bin/env node

/**
 * Selected evidence-suite runner.
 *
 * Usage: node scripts/runEvidence.mjs [suite]
 *
 * Suites: all (default), phase8a5, phase8a6, phase8b1. Unknown suite names
 * fail fast with a clear error — never a silent full-campaign run.
 * Execution always goes through the evidence tier config
 * (vitest.evidence.config.ts); the suite argument only narrows the file
 * selection. `npm run test:evidence [-- <suite>]` is the package entry.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITES = {
  phase8a5: ['tests/evidence/phase8a5_preanalysis_safety_evidence.test.ts'],
  phase8a6: ['tests/evidence/phase8a6_session_evidence.test.ts'],
  phase8b1: ['tests/evidence/phase8b1_preanalysis_release.test.ts'],
};

const suite = process.argv[2] ?? 'all';
if (suite !== 'all' && !Object.hasOwn(SUITES, suite)) {
  console.error(
    `Unknown evidence suite "${suite}". Expected one of: all, ${Object.keys(SUITES).join(', ')}`
  );
  process.exit(2);
}

const files = suite === 'all' ? [] : SUITES[suite];
const result = spawnSync(
  process.execPath,
  [path.join(here, 'runVitest.mjs'), 'run', '--config', 'vitest.evidence.config.ts', ...files],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
