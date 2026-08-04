import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const ROOT = process.cwd();
const TSX_CLI = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const WEBNET_CLI = path.resolve(ROOT, 'src', 'cli.ts');

export const STABLE_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'cli_smoke.dat');
export const PREANALYSIS_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'preanalysis_cli.dat');
export const GEOID_GTX_INPUT = path.resolve(ROOT, 'tests', 'fixtures', 'mock_geoid.gtx');
export const CLI_TEST_TIMEOUT_MS = 15000;

export const runCli = (args: string[], timeout = CLI_TEST_TIMEOUT_MS) =>
  spawnSync(process.execPath, [TSX_CLI, WEBNET_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout,
  });

export const normalizePath = (value: string): string => value.replace(/\\/g, '/');
