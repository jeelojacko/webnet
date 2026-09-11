/**
 * Regression test for the test-tier manifest (scripts/testTiers.ts).
 * Cheap by design — must run in the everyday agent tier.
 *
 * Policy enforced here:
 * - symmetry: every non-full tier (evidence/release/wasm) has a non-empty
 *   manifest list in TIER_MANIFESTS, and each tier config selects exactly
 *   its manifest;
 * - disjointness: evidence, release, and wasm manifests never overlap, and
 *   AGENT_EXCLUDED_TESTS is exactly their union;
 * - naming: every manifest path is a tests/** .test.ts path, every
 *   evidence path lives under tests/evidence/, and no browser tests appear
 *   in Node tier manifests.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AGENT_EXCLUDED_TESTS,
  AGENT_REQUIRED_TESTS,
  EVIDENCE_NAME_EXCEPTIONS,
  EVIDENCE_TESTS,
  RELEASE_TESTS,
  TIER_MANIFESTS,
  WASM_INTEGRATION_TESTS,
} from '../scripts/testTiers';
import agentConfig from '../vitest.agent.config';
import evidenceConfig from '../vitest.evidence.config';
import releaseConfig from '../vitest.release.config';
import wasmConfig from '../vitest.wasm.config';

const here = path.dirname(fileURLToPath(import.meta.url));

const isRepoTestPath = (p: string): boolean =>
  /^tests\/[\w./-]+\.(test|spec)\.tsx?$/.test(p);

const duplicates = (list: readonly string[]): string[] =>
  list.filter((p, i) => list.indexOf(p) !== i);

/** Recursively collect every *.test.ts(x) file under a dir, as posix repo paths. */
const collectTestFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs).sort()) {
      const full = path.join(abs, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(test|spec)\.tsx?$/.test(entry)) {
        out.push(path.relative(path.join(here, '..'), full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return out;
};

const SUSPICIOUS_NAME = /stress|benchmark|soak|calibration/i;

const tierLists = {
  evidence: EVIDENCE_TESTS,
  release: RELEASE_TESTS,
  wasm: WASM_INTEGRATION_TESTS,
} as const;

const tierConfigIncludes = {
  evidence: (evidenceConfig.test as { include?: string[] } | undefined)?.include ?? [],
  release: (releaseConfig.test as { include?: string[] } | undefined)?.include ?? [],
  wasm: (wasmConfig.test as { include?: string[] } | undefined)?.include ?? [],
} as const;

const agentExcludes = new Set(
  (agentConfig.test as { exclude?: string[] } | undefined)?.exclude ?? []
);

describe('test tier manifest', () => {
  it('tier manifests are symmetric, non-empty, and duplicate-free', () => {
    expect(Object.keys(TIER_MANIFESTS).sort()).toEqual(['evidence', 'release', 'wasm']);
    for (const [name, list] of Object.entries(tierLists)) {
      expect(list.length, `${name} tier manifest is empty`).toBeGreaterThan(0);
      expect(duplicates(list), `${name} tier has duplicates`).toEqual([]);
    }
  });

  it('every manifest entry is a valid existing repo test path', () => {
    for (const [name, list] of Object.entries(tierLists)) {
      for (const p of list) {
        expect(isRepoTestPath(p), `${name}: not a tests/*.test.ts path: ${p}`).toBe(true);
        expect(existsSync(path.join(here, '..', p)), `${name}: missing file: ${p}`).toBe(true);
      }
    }
  });

  it('evidence tests live under tests/evidence/', () => {
    expect(EVIDENCE_TESTS.length).toBeGreaterThan(0);
    for (const p of EVIDENCE_TESTS) {
      expect(p.startsWith('tests/evidence/'), `evidence test outside tests/evidence/: ${p}`).toBe(true);
    }
    for (const p of [...RELEASE_TESTS, ...WASM_INTEGRATION_TESTS]) {
      expect(p.startsWith('tests/evidence/'), `non-evidence test under tests/evidence/: ${p}`).toBe(false);
    }
  });

  it('evidence manifest is exactly the tests/evidence/ suite (reverse symmetry)', () => {
    const onDisk = collectTestFiles(path.join(here, 'evidence'));
    expect(onDisk.length).toBeGreaterThan(0);
    expect([...EVIDENCE_TESTS].sort()).toEqual(onDisk.sort());
  });

  it('suspicious campaign-like names live under evidence or in exceptions', () => {
    const exceptions = new Set<string>([...EVIDENCE_NAME_EXCEPTIONS]);
    expect(duplicates(EVIDENCE_NAME_EXCEPTIONS)).toEqual([]);
    for (const p of EVIDENCE_NAME_EXCEPTIONS) {
      expect(p.startsWith('tests/evidence/'), `exception must not be under evidence/: ${p}`).toBe(false);
      expect(SUSPICIOUS_NAME.test(path.basename(p)), `exception without suspicious name: ${p}`).toBe(true);
      expect(existsSync(path.join(here, '..', p)), `missing exception file: ${p}`).toBe(true);
    }
    for (const p of collectTestFiles(path.join(here))) {
      if (!SUSPICIOUS_NAME.test(path.basename(p))) continue;
      if (p.startsWith('tests/evidence/')) {
        expect(EVIDENCE_TESTS.includes(p as (typeof EVIDENCE_TESTS)[number]),
          `evidence-named file missing from EVIDENCE_TESTS: ${p}`).toBe(true);
      } else {
        expect(exceptions.has(p), `suspicious campaign-like name outside tests/evidence/: ${p}`).toBe(true);
      }
    }
    for (const p of collectTestFiles(path.join(here, '..', 'study-desktop', 'tests'))) {
      if (!SUSPICIOUS_NAME.test(path.basename(p))) continue;
      expect(exceptions.has(p), `suspicious campaign-like name in study-desktop/tests: ${p}`).toBe(true);
    }
  });

  it('non-full tier manifests are mutually disjoint', () => {
    const names = Object.keys(tierLists) as (keyof typeof tierLists)[];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const overlap = tierLists[names[i]].filter((p) =>
          (tierLists[names[j]] as readonly string[]).includes(p)
        );
        expect(overlap, `${names[i]} overlaps ${names[j]}`).toEqual([]);
      }
    }
  });

  it('AGENT_EXCLUDED_TESTS is exactly the union of evidence + release + wasm', () => {
    expect([...AGENT_EXCLUDED_TESTS].sort()).toEqual(
      [...EVIDENCE_TESTS, ...RELEASE_TESTS, ...WASM_INTEGRATION_TESTS].sort()
    );
  });

  it('each tier config selects exactly its manifest', () => {
    for (const [name, list] of Object.entries(tierLists)) {
      expect([...tierConfigIncludes[name as keyof typeof tierConfigIncludes]].sort()).toEqual(
        [...list].sort()
      );
    }
  });

  it('agent config excludes every non-full tier test', () => {
    for (const p of AGENT_EXCLUDED_TESTS) {
      expect(agentExcludes.has(p), `agent config does not exclude ${p}`).toBe(true);
    }
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
