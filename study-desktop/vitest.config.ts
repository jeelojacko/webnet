import { defineConfig } from 'vitest/config';

/**
 * Standalone Study test boundary: runs the one test source under ./tests
 * with study-desktop's own deps (single React copy). Mirrors the root
 * shared base. No setupFiles: the root jsdom localStorage setup is a
 * proven no-op here (study tests/sources never touch localStorage).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: process.platform === 'win32' ? 'threads' : 'forks',
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
