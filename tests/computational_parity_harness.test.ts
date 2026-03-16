import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import type { AdjustmentResult, InstrumentLibrary } from '../src/types';

type ParityFixtureSpec = {
  id: string;
  inputPath: string;
  profile: 'webnet' | 'industry-parity';
  summary: {
    converged: boolean;
    iterations: number;
    dof: number;
    seuw: number;
    seuwTolerance: number;
  };
  coordinates?: Record<string, { x: number; y: number; tol: number }>;
  residual?: { maxStdRes: number; tol: number };
};

const INDUSTRY_FALLBACK_LIBRARY: InstrumentLibrary = {
  __INDUSTRY_DEFAULT__: {
    code: '__INDUSTRY_DEFAULT__',
    desc: 'Industry Standard default instrument',
    edm_const: 0.001,
    edm_ppm: 1,
    hzPrecision_sec: 0.5,
    dirPrecision_sec: 0.5,
    azBearingPrecision_sec: 0.5,
    vaPrecision_sec: 0.5,
    instCentr_m: 0.0005,
    tgtCentr_m: 0,
    vertCentr_m: 0,
    elevDiff_const_m: 0,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
};

const paritySuite = JSON.parse(
  readFileSync('tests/fixtures/computational_parity_suite.json', 'utf-8'),
) as { fixtures: ParityFixtureSpec[] };

const solveCache = new Map<string, AdjustmentResult>();

const solveFixture = (spec: ParityFixtureSpec): AdjustmentResult => {
  const cached = solveCache.get(spec.id);
  if (cached) return cached;

  const input = readFileSync(spec.inputPath, 'utf-8');
  const result =
    spec.profile === 'industry-parity'
      ? new LSAEngine({
          input,
          maxIterations: 15,
          instrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
          parseOptions: {
            currentInstrument: '__INDUSTRY_DEFAULT__',
            directionSetMode: 'raw',
            robustMode: 'none',
            tsCorrelationEnabled: false,
          },
        }).solve()
      : new LSAEngine({
          input,
          maxIterations: 15,
        }).solve();

  solveCache.set(spec.id, result);
  return result;
};

const maxStdRes = (result: AdjustmentResult): number =>
  result.observations
    .filter((obs) => Number.isFinite(obs.stdRes))
    .reduce((acc, obs) => Math.max(acc, Math.abs(obs.stdRes ?? 0)), 0);

describe('computational parity harness', () => {
  describe('tier 1: summary tolerance gates', () => {
    for (const fixture of paritySuite.fixtures) {
      it(`summary parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        expect(result.converged).toBe(fixture.summary.converged);
        expect(result.iterations).toBe(fixture.summary.iterations);
        expect(result.dof).toBe(fixture.summary.dof);
        expect(Math.abs(result.seuw - fixture.summary.seuw)).toBeLessThanOrEqual(
          fixture.summary.seuwTolerance,
        );
      });
    }
  });

  describe('tier 2: coordinate tolerance gates', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.coordinates)) {
      it(`coordinate parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        Object.entries(fixture.coordinates ?? {}).forEach(([stationId, expected]) => {
          const station = result.stations[stationId];
          expect(station).toBeDefined();
          expect(Math.abs(station.x - expected.x)).toBeLessThanOrEqual(expected.tol);
          expect(Math.abs(station.y - expected.y)).toBeLessThanOrEqual(expected.tol);
        });
      });
    }
  });

  describe('tier 3: residual tolerance gates', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.residual)) {
      it(`residual parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        const expected = fixture.residual!;
        expect(Math.abs(maxStdRes(result) - expected.maxStdRes)).toBeLessThanOrEqual(expected.tol);
      });
    }
  });
});
