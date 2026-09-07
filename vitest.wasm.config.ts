import { defineConfig } from 'vitest/config';

import { WASM_INTEGRATION_TESTS } from './scripts/testTiers';
import { webnetVitestBase } from './vitest.shared';

/**
 * WASM tier: only the explicit real-WASM / worker / native integration
 * tests from scripts/testTiers.ts. Requires the real cpp/build-wasm
 * artifact when the test contract demands it (missing artifact fails
 * loudly — never a silent skip).
 */
export default defineConfig({
  test: {
    ...webnetVitestBase,
    include: [...WASM_INTEGRATION_TESTS],
  },
});
