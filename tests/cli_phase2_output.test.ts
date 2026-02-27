import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TSX_CLI = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const WEBNET_CLI = path.resolve(ROOT, 'src', 'cli.ts');

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [TSX_CLI, WEBNET_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });

const writeStableInput = (): string => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-input-'));
  const inputPath = path.join(outDir, 'stable.dat');
  const input = [
    '.2D',
    'C A 0 0 0 ! !',
    'C B 100 0 0 ! !',
    'C P 30 40 0',
    'D A-P 50.0000 0.002',
    'D B-P 80.6226 0.002',
    'B A-P 036-52-12.0 1.0',
  ].join('\n');
  writeFileSync(inputPath, input, 'utf-8');
  return inputPath;
};

describe('CLI phase 2 output modes', () => {
  it('emits machine-readable JSON payloads', () => {
    const inputPath = writeStableInput();
    const res = runCli(['--input', inputPath, '--output', 'json']);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.converged).toBe(true);
    expect(payload.stationCount).toBeGreaterThan(0);
    expect(payload.observationCount).toBeGreaterThan(0);
  });

  it('writes industry-style listing output to file', () => {
    const inputPath = writeStableInput();
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-'));
    const outPath = path.join(outDir, 'listing.txt');
    const res = runCli([
      '--input',
      inputPath,
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
});
