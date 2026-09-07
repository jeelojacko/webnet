/**
 * Regression test for the test-tier manifest (scripts/testTiers.ts).
 * Cheap by design — must run in the everyday agent tier.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AGENT_EXCLUDED_TESTS,
  AGENT_REQUIRED_TESTS,
  RELEASE_EVIDENCE_TESTS,
  WASM_INTEGRATION_TESTS,
} from '../scripts/testTiers';

const here = path.dirname(fileURLToPath(import.meta.url));

const isRepoTestPath = (p: string): boolean =>
  /^tests\/[\w./-]+\.(test|spec)\.tsx?$/.test(p);

const duplicates = (list: readonly string[]): string[] =>
  list.filter((p, i) => list.indexOf(p) !== i);

describe('test tier manifest', () => {
  it('release evidence tests: no duplicates, all valid existing test paths', () => {
    expect(duplicates(RELEASE_EVIDENCE_TESTS)).toEqual([]);
    for (const p of RELEASE_EVIDENCE_TESTS) {
      expect(isRepoTestPath(p), `not a tests/*.test.ts path: ${p}`).toBe(true);
      expect(existsSync(path.join(here, '..', p)), `missing file: ${p}`).toBe(true);
    }
  });

  it('wasm integration tests: no duplicates, all valid existing test paths', () => {
    expect(duplicates(WASM_INTEGRATION_TESTS)).toEqual([]);
    for (const p of WASM_INTEGRATION_TESTS) {
      expect(isRepoTestPath(p), `not a tests/*.test.ts path: ${p}`).toBe(true);
      expect(existsSync(path.join(here, '..', p)), `missing file: ${p}`).toBe(true);
    }
  });

  it('release and wasm lists do not overlap', () => {
    const overlap = RELEASE_EVIDENCE_TESTS.filter((p) =>
      WASM_INTEGRATION_TESTS.includes(p as (typeof WASM_INTEGRATION_TESTS)[number])
    );
    expect(overlap).toEqual([]);
  });

  it('AGENT_EXCLUDED_TESTS is exactly the union of release + wasm', () => {
    expect([...AGENT_EXCLUDED_TESTS].sort()).toEqual(
      [...RELEASE_EVIDENCE_TESTS, ...WASM_INTEGRATION_TESTS].sort()
    );
  });

  it('no browser tests appear in Node tier manifests', () => {
    for (const p of [...AGENT_EXCLUDED_TESTS, ...AGENT_REQUIRED_TESTS]) {
      expect(p.startsWith('tests-browser/'), `browser test in Node manifest: ${p}`).toBe(false);
    }
  });

  it('required cheap numerical tests stay in the agent tier', () => {
    for (const p of AGENT_REQUIRED_TESTS) {
      expect(existsSync(path.join(here, '..', p)), `missing required test: ${p}`).toBe(true);
      expect(AGENT_EXCLUDED_TESTS.includes(p as (typeof AGENT_EXCLUDED_TESTS)[number]),
        `${p} must stay in the agent tier`).toBe(false);
    }
  });
});
