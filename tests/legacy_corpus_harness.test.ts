import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findSilentDirectiveDrops,
  type LegacyCorpusManifest,
  type UnknownInlineDirectiveCandidate,
} from '../src/legacyCorpusHarness';
import type { ParseCompatibilityDiagnostic } from '../src/types';

const ROOT = process.cwd();
const TSX_CLI = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const HARNESS_CLI = path.resolve(ROOT, 'src', 'legacyCorpusHarness.ts');

const runHarness = (args: string[] = []) =>
  spawnSync(process.execPath, [TSX_CLI, HARNESS_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });

describe('legacy corpus harness', () => {
  it('passes against the curated phase-1 corpus manifest', () => {
    const result = runHarness();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Legacy compatibility corpus harness');
    expect(result.stdout).toContain('Legacy corpus harness summary: passed=');
    expect(result.stdout).toContain('failed=0');
  });

  it('fails with deterministic mismatch diagnostics when expectations are wrong', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-corpus-harness-'));
    const manifestPath = path.join(outDir, 'legacy_manifest_fail.json');
    const manifest: LegacyCorpusManifest = {
      version: 1,
      description: 'intentional failing manifest for harness regression test',
      projects: [
        {
          id: 'intentional_mismatch',
          inputPath: 'tests/fixtures/cli_smoke.dat',
          profile: 'webnet',
          parseMode: 'legacy',
          runMode: 'adjustment',
          expected: {
            parseSuccess: true,
            runSuccess: false,
          },
        },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const result = runHarness(['--manifest', manifestPath]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL intentional_mismatch');
    expect(result.stdout).toContain('run-success mismatch');
    expect(result.stdout).toContain('Legacy corpus harness summary: passed=0 failed=1');
  });

  it('flags unknown or ambiguous directives as silent drops when parser diagnostics are missing', () => {
    const candidates: UnknownInlineDirectiveCandidate[] = [
      {
        sourceFile: 'tests/fixtures/sample.dat',
        line: 4,
        token: '.ZZZZ',
        reason: 'unknown',
      },
    ];
    const diagnostics: ParseCompatibilityDiagnostic[] = [];
    const silentDrops = findSilentDirectiveDrops(candidates, diagnostics);
    expect(silentDrops).toHaveLength(1);

    const matchedDiagnostics: ParseCompatibilityDiagnostic[] = [
      {
        code: 'STRICT_REJECTED',
        line: 4,
        sourceFile: 'tests/fixtures/sample.dat',
        recordType: 'INLINE',
        mode: 'legacy',
        severity: 'warning',
        message: 'unknown inline option ".ZZZZ"',
        fallbackApplied: false,
      },
    ];
    const noSilentDrops = findSilentDirectiveDrops(candidates, matchedDiagnostics);
    expect(noSilentDrops).toHaveLength(0);
  });
});
