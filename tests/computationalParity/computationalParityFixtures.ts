import { readFileSync } from 'node:fs';

import { LSAEngine } from '../../src/engine/adjust';
import type { AdjustmentResult, InstrumentLibrary } from '../../src/types';
import type { ParityFixtureSpec } from './computationalParityTypes';
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

export const paritySuite = JSON.parse(
  readFileSync('tests/fixtures/computational_parity_suite.json', 'utf-8'),
) as { fixtures: ParityFixtureSpec[] };

const solveCache = new Map<string, AdjustmentResult>();

export const solveFixture = (spec: ParityFixtureSpec): AdjustmentResult => {
  const cached = solveCache.get(spec.id);
  if (cached) return cached;

  const input = readFileSync(spec.inputPath, 'utf-8');
  const result =
    spec.profile === 'industry-parity'
      ? new LSAEngine({
          input,
          maxIterations: 15,
          convergenceThreshold: 0.001,
          instrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
          parseOptions: {
            currentInstrument: '__INDUSTRY_DEFAULT__',
            directionSetMode: 'raw',
            robustMode: 'none',
            tsCorrelationEnabled: false,
            clusterDetectionEnabled: false,
            geometryDependentSigmaReference: 'initial',
          },
        }).solve()
      : new LSAEngine({
          input,
          maxIterations: 15,
        }).solve();

  solveCache.set(spec.id, result);
  return result;
};

export const maxStdRes = (result: AdjustmentResult): number =>
  result.observations
    .filter((obs) => Number.isFinite(obs.stdRes))
    .reduce((acc, obs) => Math.max(acc, Math.abs(obs.stdRes ?? 0)), 0);
