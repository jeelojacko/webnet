import { defineConfig } from 'vitest/config';

import { RELEASE_EVIDENCE_TESTS } from './scripts/testTiers';
import { webnetVitestBase } from './vitest.shared';

/**
 * RELEASE tier: only the intentionally expensive certification / evidence /
 * stress campaigns from scripts/testTiers.ts. Expected to be slow; run it
 * explicitly, never as everyday feedback.
 */
export default defineConfig({
  test: {
    ...webnetVitestBase,
    include: [...RELEASE_EVIDENCE_TESTS],
  },
});
