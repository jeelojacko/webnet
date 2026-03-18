import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareSummaryProjectsToBaseline,
  findSilentDirectiveDrops,
  type LegacyCorpusProjectSnapshot,
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
    expect(result.stdout).toContain('Legacy corpus harness summary: projectFailures=0');
    expect(result.stdout).toContain('baselineMismatches=0');
    expect(result.stdout).toContain('gateFailed=false');
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
    expect(result.stdout).toContain('Legacy corpus harness summary: projectFailures=1');
    expect(result.stdout).toContain('gateFailed=true');
  });

  it(
    'writes summary artifacts and passes baseline comparison in a single-project corpus',
    () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-corpus-harness-'));
    const manifestPath = path.join(outDir, 'legacy_manifest_single.json');
    const baselinePath = path.join(outDir, 'legacy_baseline.json');
    const summaryJsonPath = path.join(outDir, 'summary.json');
    const summaryTextPath = path.join(outDir, 'summary.txt');
    const manifest: LegacyCorpusManifest = {
      version: 1,
      description: 'single project harness integration fixture',
      projects: [
        {
          id: 'single_project',
          inputPath: 'tests/fixtures/cli_smoke.dat',
          profile: 'webnet',
          parseMode: 'legacy',
          runMode: 'adjustment',
          expected: {
            parseSuccess: true,
            runSuccess: true,
          },
        },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const writeBaseline = runHarness([
      '--manifest',
      manifestPath,
      '--write-baseline',
      baselinePath,
      '--summary-json',
      summaryJsonPath,
      '--summary-text',
      summaryTextPath,
    ]);
    expect(writeBaseline.status).toBe(0);

    const compare = runHarness([
      '--manifest',
      manifestPath,
      '--baseline',
      baselinePath,
      '--summary-json',
      summaryJsonPath,
      '--summary-text',
      summaryTextPath,
    ]);
    expect(compare.status).toBe(0);
    const summaryJson = JSON.parse(readFileSync(summaryJsonPath, 'utf-8'));
    expect(summaryJson.gateFailed).toBe(false);
    expect(summaryJson.baselineComparison?.mismatchCount).toBe(0);
    const summaryText = readFileSync(summaryTextPath, 'utf-8');
    expect(summaryText).toContain('Baseline compare: PASS');
    },
    20000,
  );

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

  it('detects deterministic baseline mismatches from project snapshots', () => {
    const baseline: LegacyCorpusProjectSnapshot[] = [
      {
        id: 'p1',
        profile: 'webnet',
        parseMode: 'legacy',
        runMode: 'adjustment',
        expectedParseSuccess: true,
        expectedRunSuccess: true,
        parseSuccess: true,
        runSuccess: true,
        stationCount: 3,
        observationCount: 5,
        includeErrorCount: 0,
        parseErrorDiagnosticCount: 0,
        strictRejectCount: 0,
        rewriteSuggestionCount: 0,
        ambiguousCount: 0,
        legacyFallbackCount: 0,
        runModeDiagnosticCodes: [],
        silentDirectiveDropCount: 0,
      },
    ];
    const current = baseline.map((row) => ({ ...row, stationCount: 4 }));
    const mismatches = compareSummaryProjectsToBaseline(current, baseline);
    expect(mismatches.some((line) => line.includes('p1.stationCount'))).toBe(true);
  });
});
