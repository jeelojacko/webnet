import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';

export const webnetProjectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Shared base for every WebNet Vitest tier config (full/agent/wasm/release).
 * Keep this small; tier configs only add include/exclude on top of it.
 */
export const webnetVitestBase = {
  environment: 'node',
  globals: true,
  setupFiles: ['./tests/vitest.setup.ts'],
  pool: process.platform === 'win32' ? 'threads' : 'forks',
  exclude: [...configDefaults.exclude, 'tests-browser/**', 'emsdk-cache/**'],
};
