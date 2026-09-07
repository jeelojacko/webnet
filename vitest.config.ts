import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'tests-browser/**', 'emsdk-cache/**'],
    pool: process.platform === 'win32' ? 'threads' : 'forks',
  },
});
