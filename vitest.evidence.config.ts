import { defineConfig } from 'vitest/config';

import { EVIDENCE_TESTS } from './scripts/testTiers';
import { webnetVitestBase } from './vitest.shared';

/**
 * EVIDENCE tier: only the intentionally expensive long numerical campaigns
 * under tests/evidence/ from scripts/testTiers.ts. Manual-only — never
 * runs in CI (see .github/workflows/evidence.yml). Requires the real
 * cpp/build-wasm artifact when the test contract demands it (missing
 * artifact fails loudly — never a silent skip).
 */
export default defineConfig({
  test: {
    ...webnetVitestBase,
    include: [...EVIDENCE_TESTS],
  },
});
