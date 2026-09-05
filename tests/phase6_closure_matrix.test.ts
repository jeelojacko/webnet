import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Test-only documentation consistency gate for the Phase 6 closure batch:
// the production-readiness matrix and explicit Phase 7 recommendation must
// stay present in docs/CPP_WASM_ENGINE.md. No production behavior covered.
const doc = readFileSync('docs/CPP_WASM_ENGINE.md', 'utf8');

describe('phase 6 closure matrix documentation', () => {
  it('contains the closure readiness section without starting Phase 7', () => {
    expect(doc).toContain('Phase 6 closure — production-readiness matrix');
    expect(doc).toContain('Phase 7 recommendation (explicit; Phase 7 is NOT started');
    expect(doc).toContain('Production remains TypeScript-only');
  });

  it('covers every required capability row and marks unmeasured items honestly', () => {
    for (const capability of [
      'Sparse correction solve',
      'Structured weights',
      'Huber robust iterations',
      'GPS correlation blocks',
      'TS setup/set correlation',
      'Standardized residuals (row products)',
      'Selected covariance',
      '2D networks (small/medium)',
      '3D networks',
      'Large networks (1000+ unknowns)',
      'Worker deployment plus determinism',
      'Damping fallback',
      'Legacy all-pairs',
      'Condition diagnostic',
      'Observation-model migration to C++',
      'SIMD / threads',
    ]) {
      expect(doc).toContain(capability);
    }
    expect(doc).toContain('Unmeasured');
  });
});
