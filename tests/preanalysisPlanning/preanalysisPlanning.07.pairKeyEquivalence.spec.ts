/**
 * Phase 9J pair-key equivalence (agent tier, fast).
 *
 * The direct two-element key ordering must equal the legacy
 * `[from, to].sort(cmp).join('|')` for every pair shape: numeric,
 * mixed alphanumeric, equal, and reversed. Verified through the
 * observable `prioritizedPairKeys` of a summary built over a battery
 * of weak cues covering the full ordered product (reversal included),
 * plus rebuild determinism. No production API added.
 */
import { describe, expect, it } from 'vitest';

import type { AdjustmentResult } from '../../src/types';
import { buildPathPrioritySummary } from '../../src/engine/preanalysisPathPriority';

/** Pre-9J key construction, kept as the test-local oracle. */
const legacyPairKey = (from: string, to: string): string =>
  [from, to]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .join('|');

const BATTERY_IDS = [
  '2',
  '9',
  '10',
  '100',
  '104',
  '104A',
  '10A',
  'A10',
  'A',
  'a',
  'FM1',
  'GATE',
  'GPS2',
  'GPS10',
  '102',
  '',
];

const buildBatteryResult = (): AdjustmentResult =>
  ({
    stations: Object.fromEntries(BATTERY_IDS.map((id) => [id, { x: 0, y: 0, h: 0 }])),
    observations: [],
    stationCovariances: [],
    relativeCovariances: [],
    weakGeometryDiagnostics: {
      enabled: true,
      stationMedianHorizontal: 1,
      relativeMedianDistance: 1,
      stationCues: [],
      relativeCues: BATTERY_IDS.flatMap((from) =>
        BATTERY_IDS.map((to) => ({ from, to, distanceMetric: 1, severity: 'weak' as const, note: 'battery' })),
      ),
    },
  }) as unknown as AdjustmentResult;

describe('phase 9J pair-key equivalence', () => {
  it('matches the legacy array-sort key on the full ordered battery', () => {
    const result = buildBatteryResult();
    const summary = buildPathPrioritySummary(result);
    const expected = new Set<string>();
    for (const from of BATTERY_IDS) {
      for (const to of BATTERY_IDS) {
        // Equal, reversed, numeric, and mixed pairs all covered here.
        expected.add(legacyPairKey(from, to));
      }
    }
    for (const key of expected) {
      expect(summary.prioritizedPairKeys.has(key), `missing key ${key}`).toBe(true);
    }
    expect(summary.prioritizedPairKeys.size).toBe(expected.size);
  });

  it('orders numeric ids numerically, not lexicographically', () => {
    const summary = buildPathPrioritySummary(buildBatteryResult());
    // '10' sorts after '9' under numeric collation in both constructions.
    expect(summary.prioritizedPairKeys.has(legacyPairKey('9', '10'))).toBe(true);
    expect(legacyPairKey('10', '9')).toBe(legacyPairKey('9', '10'));
    expect(legacyPairKey('GPS10', 'GPS2')).toBe(legacyPairKey('GPS2', 'GPS10'));
  });

  it('rebuilds the battery summary deterministically', () => {
    const first = buildPathPrioritySummary(buildBatteryResult());
    const second = buildPathPrioritySummary(buildBatteryResult());
    expect(second.stationOrder).toEqual(first.stationOrder);
    expect([...second.prioritizedPairKeys].sort()).toEqual([...first.prioritizedPairKeys].sort());
    expect(second.prioritizedPairs).toEqual(first.prioritizedPairs);
  });
});
