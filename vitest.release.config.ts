import { defineConfig } from 'vitest/config';

import { RELEASE_TESTS } from './scripts/testTiers';
import { webnetVitestBase } from './vitest.shared';

/**
 * RELEASE tier: only the fast automatic release-certification gate from
 * scripts/testTiers.ts (the Phase 8B.1 verdict over committed reports —
 * no workers, no WASM artifact required). Runs in CI numerical
 * certification; the slow evidence campaigns live in the manual-only
 * evidence tier instead.
 */
export default defineConfig({
  test: {
    ...webnetVitestBase,
    include: [...RELEASE_TESTS],
  },
});
