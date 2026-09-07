import { defineConfig } from 'vitest/config';

import { AGENT_EXCLUDED_TESTS } from './scripts/testTiers';
import { webnetVitestBase } from './vitest.shared';

/**
 * AGENT tier: broad everyday regression suite — the full suite minus the
 * intentionally expensive release/evidence and real-WASM integration tests
 * listed in scripts/testTiers.ts. Must not trigger WASM rebuilds.
 */
export default defineConfig({
  test: {
    ...webnetVitestBase,
    exclude: [...webnetVitestBase.exclude, ...AGENT_EXCLUDED_TESTS],
  },
});
