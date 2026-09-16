/**
 * Phase 15E: solve-local residual-covariance row-product reuse (dense path).
 *
 * The memo skips exact recomputation of ordered-pair dots with identical
 * accumulation order, so OFF vs ON must be bit-identical full-result
 * parity. Telemetry (counters) is module-local only — never in results.
 */
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import { buildObservationsResidualsCsvText } from '../src/engine/browserObservationResidualsCsv';
import type { ScenarioRunRequest } from '../src/engine/scenarioRunModels';
import type { ReliabilityPolicy } from '../src/engine/reliabilityPolicy';
import {
  createDenseRowProductCache,
  getLastDenseRowProductCounters,
  isStatisticsDenseRowProductReuseEnabled,
  setStatisticsDenseRowProductReuseEnabled,
} from '../src/engine/statisticsDenseRowProductCache';

const DIST_EXACT = '64.0312423743285';
const ANGLE_EXACT = '102-40-49.380570552';

const SCALAR_2D = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  `A P-A-B ${ANGLE_EXACT} 0.001`,
].join('\n');

const GPS_2D = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.00001 0.00001',
  'G GPS1 B P -50.0 40.0 0.00001 0.00001',
  `D A-P ${DIST_EXACT} 0.00001`,
].join('\n');

const ORIENTATION_2D = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  'DB P',
  'DN A 231-20-24.690285276 0.001',
  'DN B 128-39-35.309714724 0.001',
  'DE',
].join('\n');


const GPS_3D = [
  '.3D',
  'C A 0 0 100 ! ! !',
  'C B 100 0 100 ! ! !',
  'C P 50 40 101',
  'G GPS1 A P 50.0 40.0 1.0 0.00001 0.00001 0.00001',
  'G GPS1 B P -50.0 40.0 1.0 0.00001 0.00001 0.00001',
  'D A-P 64.0390505863415 0.00001',
].join('\n');

const withFreshSwitch = (enabled: boolean, fn: () => void): void => {
  const before = isStatisticsDenseRowProductReuseEnabled();
  setStatisticsDenseRowProductReuseEnabled(enabled);
  try {
    fn();
  } finally {
    setStatisticsDenseRowProductReuseEnabled(before);
  }
};

/** Stable result JSON: strip wall-clock timing and telemetry-free logs. */
const stableJson = (result: ReturnType<typeof solveEngine>): string => {
  const logs = result.logs.filter((l) => !l.startsWith('Solve timing (ms):'));
  const { solveTimingProfile: _v, logs: _l, ...stable } = result;
  return JSON.stringify({ ...stable, logs });
};

const TSCORR_PARSE = {
  tsCorrelationEnabled: true,
  tsCorrelationRho: 0.5,
  tsCorrelationScope: 'set',
} as const;

const solveBoth = (
  input: string,
  extraParseOptions: Record<string, unknown> = {},
): { off: string; on: string } => {
  const build = (): ScenarioRunRequest => ({
    input,
    maxIterations: 8,
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      ...extraParseOptions,
    },
  });
  let off = '';
  let on = '';
  withFreshSwitch(false, () => {
    off = stableJson(solveEngine(build()));
  });
  withFreshSwitch(true, () => {
    on = stableJson(solveEngine(build()));
  });
  return { off, on };
};

describe('Phase 15E dense row-product reuse', () => {
  it('kill switch defaults ON with identical numerics either way', () => {
    expect(isStatisticsDenseRowProductReuseEnabled()).toBe(true);
    const B = [
      [1, 2],
      [3, 4],
    ];
    const rows = [
      [{ index: 0, value: 1 }, { index: 1, value: 0.5 }],
      [{ index: 1, value: 2 }],
    ];
    let onQuad = 0;
    let offQuad = 0;
    withFreshSwitch(true, () => {
      onQuad = createDenseRowProductCache(B, rows).quadratic(0) as number;
    });
    withFreshSwitch(false, () => {
      offQuad = createDenseRowProductCache(B, rows).quadratic(0) as number;
    });
    // dotRow(0,0) = B[0][0]*1 + B[0][1]*0.5 = 1 + 2*0.5 = 2.
    expect(onQuad).toBe(offQuad);
    expect(onQuad).toBe(2);
  });

  it('memoizes ordered pairs and counts computations honestly', () => {
    const B = [
      [1, 0.5],
      [0.25, 2],
    ];
    const rows = [[{ index: 0, value: 2 }], [{ index: 0, value: 1 }, { index: 1, value: 3 }]];
    withFreshSwitch(true, () => {
      const cache = createDenseRowProductCache(B, rows);
      const first = cache.cross(0, 1);
      const second = cache.cross(0, 1);
      const reversed = cache.cross(1, 0);
      expect(second).toBe(first);
      // Ordered pairs: (1,0) re-dots row 0's entries, generally different.
      expect(reversed).not.toBe(first);
      expect(cache.counters.crossTermRequests).toBe(3);
      expect(cache.counters.computations).toBe(2);
      expect(cache.counters.cacheHits).toBe(1);
      expect(cache.counters.uniquePairsComputed).toBe(2);
    });
    withFreshSwitch(false, () => {
      const cache = createDenseRowProductCache(B, rows);
      const first = cache.cross(0, 1);
      const second = cache.cross(0, 1);
      expect(second).toBe(first);
      expect(cache.counters.computations).toBe(2);
      expect(cache.counters.cacheHits).toBe(0);
    });
  });

  it('fails closed on missing B rows and degenerate shapes', () => {
    const cache = createDenseRowProductCache([[]], [[{ index: 0, value: 1 }]]);
    // Empty B row 0 is falsy-length but present: dot yields 0, not a throw.
    expect(cache.quadratic(0)).toBe(0);
    const missing = createDenseRowProductCache([], [[{ index: 0, value: 1 }]]);
    expect(missing.quadratic(0)).toBeUndefined();
    expect(missing.cross(0, 0)).toBeUndefined();
    const empty = createDenseRowProductCache([], []);
    expect(empty.cross(0, 0)).toBeUndefined();
  });

  it('scalar diagonal parity OFF vs ON (bit-identical)', () => {
    const { off, on } = solveBoth(SCALAR_2D);
    expect(on).toBe(off);
  });

  it('GPS 2D block parity OFF vs ON (bit-identical)', () => {
    const { off, on } = solveBoth(GPS_2D);
    expect(on).toBe(off);
  });

  it('orientation-unknown parity OFF vs ON (bit-identical)', () => {
    const { off, on } = solveBoth(ORIENTATION_2D);
    expect(on).toBe(off);
  });

  it('correlated-TS parity OFF vs ON (bit-identical)', () => {
    const { off, on } = solveBoth(SCALAR_2D, { ...TSCORR_PARSE });
    expect(on).toBe(off);
  });

  it('GPS 3D parity OFF vs ON (bit-identical)', () => {
    const request: ScenarioRunRequest = {
      input: GPS_3D,
      maxIterations: 8,
      parseOptions: { coordMode: '3D', units: 'm' },
    };
    let off = '';
    let on = '';
    withFreshSwitch(false, () => {
      off = stableJson(solveEngine(request));
    });
    withFreshSwitch(true, () => {
      on = stableJson(solveEngine(request));
    });
    expect(on).toBe(off);
  });

  it('statistical reliability model parity OFF vs ON (bit-identical)', () => {
    const { off, on } = solveBoth(GPS_2D, {
      reliabilityPolicy: { model: 'statistical' } as ReliabilityPolicy,
    });
    expect(on).toBe(off);
  });

  it('residual CSV export parity OFF vs ON (bit-identical)', () => {
    const build = (): ScenarioRunRequest => ({
      input: GPS_2D,
      maxIterations: 8,
      parseOptions: { coordMode: '2D', units: 'm' },
    });
    let off = '';
    let on = '';
    withFreshSwitch(false, () => {
      off = buildObservationsResidualsCsvText({ result: solveEngine(build()), units: 'm' });
    });
    withFreshSwitch(true, () => {
      on = buildObservationsResidualsCsvText({ result: solveEngine(build()), units: 'm' });
    });
    expect(on).toBe(off);
  });

  it('telemetry records reuse without touching results', () => {
    withFreshSwitch(true, () => {
      const result = solveEngine({
        input: GPS_2D,
        maxIterations: 8,
        parseOptions: { coordMode: '2D', units: 'm' },
      });
      expect(result.observations.length).toBeGreaterThan(0);
      const counters = getLastDenseRowProductCounters();
      expect(counters).not.toBeNull();
      // GPS blocks + sensitivity + stochastic re-dot the same ordered
      // pairs, so some requests must be memo hits on a GPS network.
      expect((counters?.rowProductRequests ?? 0)).toBeGreaterThan(0);
      expect((counters?.computations ?? 0)).toBeGreaterThan(0);
      expect((counters?.cacheHits ?? 0)).toBeGreaterThan(0);
      expect(
        (counters?.quadraticFormRequests ?? 0) + (counters?.crossTermRequests ?? 0),
      ).toBe(counters?.rowProductRequests ?? -1);
    });
  });
});
