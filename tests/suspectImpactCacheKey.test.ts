import { describe, expect, it } from 'vitest';

import { buildSuspectImpactCacheKey } from '../src/engine/suspectImpactShared';

const BASE_KEY = {
  baseFingerprint: 'fnv1a:abc123',
  obsId: 7,
  exclusions: new Set([1, 2]),
  overrides: { 3: { stdDev: 0.25 } },
  solveSettings: { robustMode: 'none', maxIterations: 30 },
  clusterMerges: [{ aliasId: 'P2', canonicalId: 'P1' }],
};

describe('suspectImpactCacheKey', () => {
  it('is stable for identical inputs regardless of ordering', () => {
    const reordered = {
      ...BASE_KEY,
      exclusions: new Set([2, 1]),
      overrides: { 3: { stdDev: 0.25 } },
    };
    expect(buildSuspectImpactCacheKey(reordered)).toBe(buildSuspectImpactCacheKey(BASE_KEY));
  });

  it('invalidates when exclusions change', () => {
    expect(buildSuspectImpactCacheKey({ ...BASE_KEY, exclusions: new Set([1, 2, 7]) })).not.toBe(
      buildSuspectImpactCacheKey(BASE_KEY),
    );
  });

  it('invalidates when overrides or solve settings change', () => {
    expect(
      buildSuspectImpactCacheKey({ ...BASE_KEY, overrides: { 3: { stdDev: 0.5 } } }),
    ).not.toBe(buildSuspectImpactCacheKey(BASE_KEY));
    expect(
      buildSuspectImpactCacheKey({ ...BASE_KEY, solveSettings: { robustMode: 'huber', maxIterations: 30 } }),
    ).not.toBe(buildSuspectImpactCacheKey(BASE_KEY));
  });

  it('invalidates when cluster merges, obsId, or the base fingerprint change', () => {
    expect(buildSuspectImpactCacheKey({ ...BASE_KEY, clusterMerges: [] })).not.toBe(
      buildSuspectImpactCacheKey(BASE_KEY),
    );
    expect(buildSuspectImpactCacheKey({ ...BASE_KEY, obsId: 8 })).not.toBe(
      buildSuspectImpactCacheKey(BASE_KEY),
    );
    expect(buildSuspectImpactCacheKey({ ...BASE_KEY, baseFingerprint: 'fnv1a:def456' })).not.toBe(
      buildSuspectImpactCacheKey(BASE_KEY),
    );
  });
});
