import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLI_TEST_TIMEOUT_MS,
  normalizePath,
  runCli,
} from './cliPhase2OutputTestSupport';

describe('CLI phase 2 include output modes', () => {
  it('hard-fails runs when include files are missing', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-'));
    const inputPath = path.join(outDir, 'main.dat');
    writeFileSync(inputPath, ['.INCLUDE missing/child.dat', 'C A 0 0 0 ! !'].join('\n'), 'utf-8');

    const res = runCli(['--input', inputPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);
    expect(payload.parseState?.includeErrors?.length).toBeGreaterThan(0);
    expect(payload.parseState?.includeErrors?.[0]?.code).toBe('include-not-found');
  }, CLI_TEST_TIMEOUT_MS);

  it('resolves nested include relative paths and keeps deterministic include order in CLI mode', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-rel-'));
    const mainPath = path.join(outDir, 'main.dat');
    const sectionDir = path.join(outDir, 'section');
    const nestedDir = path.join(sectionDir, 'nested');
    const sharedDir = path.join(outDir, 'shared');

    mkdirSync(sectionDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    writeFileSync(
      mainPath,
      ['.INCLUDE section/first.dat', '.INCLUDE section/second.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sectionDir, 'first.dat'),
      ['C F1 0 10 0 ! !', '.INCLUDE ../shared/grand.dat', 'C F2 10 10 0', 'D F1-F2 10'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sharedDir, 'grand.dat'),
      ['C G1 0 20 0 ! !', 'C G2 10 20 0', 'D G1-G2 10'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      path.join(sectionDir, 'second.dat'),
      ['C S1 0 30 0 ! !', 'C S2 10 30 0', 'D S1-S2 10'].join('\n'),
      'utf-8',
    );

    const res = runCli([
      '--input',
      mainPath,
      '--output',
      'json',
      '--run-mode',
      'data-check',
      '--coord-mode',
      '2D',
    ]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    const trace = payload.parseState?.includeTrace as
      | Array<{ parentSourceFile?: string; sourceFile: string; line: number }>
      | undefined;
    expect(trace).toEqual([
      {
        parentSourceFile: normalizePath(mainPath),
        sourceFile: normalizePath(path.join(sectionDir, 'first.dat')),
        line: 1,
      },
      {
        parentSourceFile: normalizePath(path.join(sectionDir, 'first.dat')),
        sourceFile: normalizePath(path.join(sharedDir, 'grand.dat')),
        line: 2,
      },
      {
        parentSourceFile: normalizePath(mainPath),
        sourceFile: normalizePath(path.join(sectionDir, 'second.dat')),
        line: 2,
      },
    ]);
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when include cycles are detected', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-cycle-'));
    const mainPath = path.join(outDir, 'main.dat');
    const aPath = path.join(outDir, 'a.dat');
    const bPath = path.join(outDir, 'b.dat');

    writeFileSync(mainPath, '.INCLUDE a.dat\nC ROOT 0 0 0 ! !', 'utf-8');
    writeFileSync(aPath, '.INCLUDE b.dat\nC A 0 10 0 ! !', 'utf-8');
    writeFileSync(bPath, '.INCLUDE a.dat\nC B 10 10 0 ! !', 'utf-8');

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const cycleDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string }) => entry.code === 'include-cycle',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
          stack?: string[];
        }
      | undefined;
    expect(cycleDiag).toBeDefined();
    expect(cycleDiag?.sourceFile).toBe(normalizePath(bPath));
    expect(cycleDiag?.line).toBe(1);
    expect(cycleDiag?.includePath).toBe('a.dat');
    expect(cycleDiag?.stack).toEqual([
      normalizePath(mainPath),
      normalizePath(aPath),
      normalizePath(bPath),
      normalizePath(aPath),
    ]);
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when include depth is exceeded', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-depth-'));
    const mainPath = path.join(outDir, 'main.dat');
    writeFileSync(mainPath, '.INCLUDE f0.dat\nC ROOT 0 0 0 ! !', 'utf-8');

    for (let i = 0; i < 16; i += 1) {
      const filePath = path.join(outDir, `f${i}.dat`);
      if (i < 15) {
        writeFileSync(filePath, `.INCLUDE f${i + 1}.dat\nC P${i} ${i} ${i} 0 ! !`, 'utf-8');
      } else {
        writeFileSync(filePath, '.INCLUDE f16.dat\nC P15 15 15 0 ! !', 'utf-8');
      }
    }
    writeFileSync(path.join(outDir, 'f16.dat'), 'C P16 16 16 0 ! !', 'utf-8');

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const depthDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string }) => entry.code === 'include-depth-exceeded',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
          message?: string;
        }
      | undefined;
    expect(depthDiag).toBeDefined();
    expect(depthDiag?.sourceFile).toBe(normalizePath(path.join(outDir, 'f14.dat')));
    expect(depthDiag?.line).toBe(1);
    expect(depthDiag?.includePath).toBe('f15.dat');
    expect(depthDiag?.message).toContain('limit=16');
  }, CLI_TEST_TIMEOUT_MS);

  it('hard-fails runs when child-relative include paths cannot be resolved', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'webnet-cli-include-rel-missing-'));
    const mainPath = path.join(outDir, 'main.dat');
    const sectionDir = path.join(outDir, 'section');
    mkdirSync(sectionDir, { recursive: true });

    writeFileSync(mainPath, '.INCLUDE section/first.dat\nC ROOT 0 0 0 ! !', 'utf-8');
    writeFileSync(
      path.join(sectionDir, 'first.dat'),
      ['C F1 0 10 0 ! !', '.INCLUDE ../shared/missing.dat', 'C F2 10 10 0', 'D F1-F2 10'].join(
        '\n',
      ),
      'utf-8',
    );

    const res = runCli(['--input', mainPath, '--output', 'json']);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);

    const missingDiag = (payload.parseState?.includeErrors ?? []).find(
      (entry: { code?: string; includePath?: string }) =>
        entry.code === 'include-not-found' && entry.includePath === '../shared/missing.dat',
    ) as
      | {
          code: string;
          sourceFile?: string;
          includePath?: string;
          line?: number;
        }
      | undefined;
    expect(missingDiag).toBeDefined();
    expect(missingDiag?.sourceFile).toBe(normalizePath(path.join(sectionDir, 'first.dat')));
    expect(missingDiag?.line).toBe(2);
  }, CLI_TEST_TIMEOUT_MS);
});
