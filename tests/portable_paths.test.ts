/**
 * Portable-path validator contracts (in-memory strings only, no disk writes).
 *
 * Guards the cross-platform filename policy enforced by
 * `npm run check:portable-paths`: no Windows reserved device basenames
 * (extension does not exempt), no forbidden characters, no trailing
 * space/period, no case-only-distinct paths.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePortablePaths } from '../scripts/checkPortablePaths.mjs';

const CHECKER = fileURLToPath(new URL('../scripts/checkPortablePaths.mjs', import.meta.url));

describe('portable paths', () => {
  it('accepts ordinary portable paths', () => {
    expect(
      validatePortablePaths([
        'src/components/AppShell.tsx',
        'tests/fixtures/gnssRaw/station_aux.06o',
        'foo/bar.txt',
        'MixedCase/NormalFile.ts',
      ])
    ).toEqual([]);
  });

  it.each([
    ['aux.06o'],
    ['AUX.txt'],
    ['con'],
    ['nul.csv'],
    ['COM1.log'],
    ['lpt9.dat'],
    ['foo/bar/AUX'],
  ])('rejects reserved device basename %s', (path) => {
    expect(validatePortablePaths([path]).length).toBeGreaterThan(0);
  });

  it.each([['foo.'], ['bar ']])('rejects trailing space/period %s', (path) => {
    expect(validatePortablePaths([path]).length).toBeGreaterThan(0);
  });

  it.each([['bad:name.txt'], ['bad?.txt'], ['bad|name']])(
    'rejects forbidden character in %s',
    (path) => {
      expect(validatePortablePaths([path]).length).toBeGreaterThan(0);
    }
  );

  it('rejects case-insensitive collisions', () => {
    expect(validatePortablePaths(['Foo.ts', 'foo.ts']).length).toBeGreaterThan(0);
  });

  describe('checker CLI (git integration)', () => {
    const gitAvailable = (() => {
      try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    const itIfGit = gitAvailable ? it : it.skip;

    function initRepo(files: Record<string, string>): string {
      const dir = mkdtempSync(join(tmpdir(), 'webnet-portable-paths-'));
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(dir, name), content);
      }
      execFileSync('git', ['add', '-A'], { cwd: dir });
      return dir;
    }

    function runChecker(cwd: string): { exit: number; output: string } {
      try {
        const output = execFileSync('node', [CHECKER], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { exit: 0, output: String(output) };
      } catch (error) {
        const err = error as { status?: number; stdout?: unknown; stderr?: unknown };
        return {
          exit: err.status ?? 1,
          output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
        };
      }
    }

    itIfGit('exits 0 in a clean repo', () => {
      const dir = initRepo({ 'good.txt': 'x\n' });
      expect(runChecker(dir).exit).toBe(0);
    });

    itIfGit('detects a tracked trailing-space name end to end', () => {
      const dir = initRepo({ 'bad ': 'x\n' });
      const result = runChecker(dir);
      expect(result.exit).not.toBe(0);
      expect(result.output).toContain('bad ');
    });
  });
});
