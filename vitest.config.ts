import { defineConfig } from 'vitest/config';

import { webnetProjectRoot, webnetVitestBase } from './vitest.shared';

/**
 * FULL authoritative configuration: every Vitest test file.
 * Tier configs (agent/wasm/release) are derived from the same base.
 */
export default defineConfig({
  root: webnetProjectRoot,
  test: webnetVitestBase,
});
