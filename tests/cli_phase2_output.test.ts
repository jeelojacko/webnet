import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TSX_CLI = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const WEBNET_CLI = path.resolve(ROOT, 'src', 'cli.ts');
const STABLE_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'cli_smoke.dat');

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [TSX_CLI, WEBNET_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });

describe('CLI phase 2 output modes', () => {
  it('emits machine-readable JSON payloads', () => {
    const res = runCli(['--input', STABLE_INPUT, '--output', 'json']);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.converged).toBe(true);
    expect(payload.stationCount).toBeGreaterThan(0);
    expect(payload.observationCount).toBeGreaterThan(0);
  });

  it('writes industry-style listing output to file', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-'));
    const outPath = path.join(outDir, 'listing.txt');
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'listing',
      '--out',
      outPath,
    ]);
    expect(res.status).toBe(0);
    const text = readFileSync(outPath, 'utf-8');
    expect(text).toContain('INDUSTRY-STANDARD-STYLE Listing');
    expect(text).toContain('Adjusted Coordinates');
  });

  it('returns deterministic usage error code for missing input files', () => {
    const res = runCli(['--input', 'tests/fixtures/does_not_exist.dat']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Failed to read input file');
  });

  it('applies auto-adjust flags into parse-state output', () => {
    const res = runCli([
      '--input',
      STABLE_INPUT,
      '--output',
      'json',
      '--autoadjust',
      'on',
      '--autoadjust-threshold',
      '3.5',
      '--autoadjust-cycles',
      '2',
      '--autoadjust-max-removals',
      '2',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.parseState?.autoAdjustEnabled).toBe(true);
    expect(payload.parseState?.autoAdjustStdResThreshold).toBeCloseTo(3.5, 8);
    expect(payload.parseState?.autoAdjustMaxCycles).toBe(2);
    expect(payload.parseState?.autoAdjustMaxRemovalsPerCycle).toBe(2);
  });
});
