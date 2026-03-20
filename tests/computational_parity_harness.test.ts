import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG } from '../src/engine/angles';
import { LSAEngine } from '../src/engine/adjust';
import {
  getIndustryReportedIterationCount,
  getRelativePrecisionRows,
  getStationPrecision,
  toSurveyEllipseAzimuthDeg,
} from '../src/engine/resultPrecision';
import type {
  AdjustmentResult,
  InstrumentLibrary,
  Observation,
  PrecisionReportingMode,
} from '../src/types';

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
  detailedReference?: {
    expectedPath: string;
    deviationBaselinePath: string;
  };
};

type IndustryReferenceExpected = {
  summary: {
    iterations: number;
  };
  coordinates: Record<string, { northing: number; easting: number }>;
  angleStdErrsSec: Record<string, number>;
  distanceStdErrsM: Record<string, number>;
  stationSigmasM: Record<string, { northing: number; easting: number }>;
  stationEllipses95M: Record<
    string,
    { semiMajor: number; semiMinor: number; azimuthDeg: number }
  >;
  relativeConfidence95: Record<
    string,
    {
      from: string;
      to: string;
      azimuthDeg: number;
      distanceM: number;
      azimuth95Sec: number;
      distance95M: number;
      ppm95: number;
    }
  >;
  relativeEllipses95M: Record<
    string,
    { from: string; to: string; semiMajor: number; semiMinor: number; azimuthDeg: number }
  >;
};

type IndustryReferenceSnapshot = IndustryReferenceExpected;

type IndustryReferenceDeviation = {
  summary: {
    iterations: number;
  };
  coordinates: Record<string, { northing: number; easting: number }>;
  angleStdErrsSec: Record<string, number>;
  distanceStdErrsM: Record<string, number>;
  stationSigmasM: Record<string, { northing: number; easting: number }>;
  stationEllipses95M: Record<string, { semiMajor: number; semiMinor: number; azimuthDeg: number }>;
  relativeConfidence95: Record<
    string,
    { azimuthDeg: number; distanceM: number; azimuth95Sec: number; distance95M: number; ppm95: number }
  >;
  relativeEllipses95M: Record<string, { semiMajor: number; semiMinor: number; azimuthDeg: number }>;
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
          convergenceThreshold: 0.001,
          instrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
          parseOptions: {
            currentInstrument: '__INDUSTRY_DEFAULT__',
            directionSetMode: 'raw',
            robustMode: 'none',
            tsCorrelationEnabled: false,
            clusterDetectionEnabled: false,
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

const angleLabel = (obs: Observation): string | null =>
  obs.type === 'angle' ? `${obs.at}-${obs.from}-${obs.to}` : null;

const distanceLabel = (obs: Observation): string | null =>
  obs.type === 'dist' ? `${obs.from}-${obs.to}` : null;

const firstAngleByLabel = (result: AdjustmentResult, label: string): Observation | undefined =>
  result.observations.find((obs) => angleLabel(obs) === label);

const firstDistanceByLabel = (result: AdjustmentResult, label: string): Observation | undefined =>
  result.observations.find((obs) => distanceLabel(obs) === label);

const requireFinite = (value: number | undefined, label: string): number => {
  expect(Number.isFinite(value), `${label} should be finite`).toBe(true);
  return value ?? Number.NaN;
};

const azimuthDeg = (result: AdjustmentResult, from: string, to: string): number => {
  const a = result.stations[from];
  const b = result.stations[to];
  expect(a, `missing station ${from}`).toBeDefined();
  expect(b, `missing station ${to}`).toBeDefined();
  const azimuthRad = Math.atan2((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
  return ((azimuthRad * RAD_TO_DEG) % 360 + 360) % 360;
};

const distanceM = (result: AdjustmentResult, from: string, to: string): number => {
  const a = result.stations[from];
  const b = result.stations[to];
  expect(a, `missing station ${from}`).toBeDefined();
  expect(b, `missing station ${to}`).toBeDefined();
  return Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
};

const relativePairStatsFor = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
  from: string,
  to: string,
):
  | {
      sigmaDist?: number;
      sigmaAz?: number;
      ellipse?: { semiMajor: number; semiMinor: number; theta: number };
    }
  | undefined => {
  const direct =
    getRelativePrecisionRows(result, mode).find((row) => row.from === from && row.to === to) ??
    getRelativePrecisionRows(result, mode).find((row) => row.from === to && row.to === from);
  if (direct) {
    return {
      sigmaDist: direct.sigmaDist,
      sigmaAz: direct.sigmaAz,
      ellipse: direct.ellipse
        ? {
            semiMajor: direct.ellipse.semiMajor,
            semiMinor: direct.ellipse.semiMinor,
            theta: direct.ellipse.theta,
          }
        : undefined,
    };
  }

  const stationCovariance = (stationId: string) => {
    const station = result.stations[stationId];
    if (!station) return undefined;
    const precision = getStationPrecision(result, stationId, mode);
    if (precision.ellipse) {
      const theta = precision.ellipse.theta / RAD_TO_DEG;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const a2 = precision.ellipse.semiMajor * precision.ellipse.semiMajor;
      const b2 = precision.ellipse.semiMinor * precision.ellipse.semiMinor;
      return {
        varE: a2 * c * c + b2 * s * s,
        varN: a2 * s * s + b2 * c * c,
        covEN: (a2 - b2) * s * c,
      };
    }
    return {
      varE: (precision.sigmaE ?? station.sE ?? 0) ** 2,
      varN: (precision.sigmaN ?? station.sN ?? 0) ** 2,
      covEN: 0,
    };
  };

  const fromPrecision = stationCovariance(from);
  const toPrecision = stationCovariance(to);
  if (!fromPrecision || !toPrecision) return undefined;

  const fromStation = result.stations[from];
  const toStation = result.stations[to];
  if (!fromStation || !toStation) return undefined;

  const dE = toStation.x - fromStation.x;
  const dN = toStation.y - fromStation.y;
  const dist = Math.hypot(dE, dN);
  const varE = toPrecision.varE + fromPrecision.varE;
  const varN = toPrecision.varN + fromPrecision.varN;
  const covEN = toPrecision.covEN + fromPrecision.covEN;
  const term1 = (varE + varN) / 2;
  const term2 = Math.sqrt(Math.max(0, ((varE - varN) / 2) ** 2 + covEN * covEN));
  const semiMajor = Math.sqrt(Math.max(0, term1 + term2));
  const semiMinor = Math.sqrt(Math.max(0, term1 - term2));
  const theta = (0.5 * Math.atan2(2 * covEN, varE - varN) * RAD_TO_DEG + 360) % 360;
  let sigmaDist: number | undefined;
  let sigmaAz: number | undefined;
  if (dist > 0) {
    const inv = 1 / (dist * dist);
    const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covEN);
    sigmaDist = Math.sqrt(Math.max(0, varDist));
    const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covEN) * inv * inv;
    sigmaAz = Math.sqrt(Math.max(0, varAz));
  }
  return {
    sigmaDist,
    sigmaAz,
    ellipse: { semiMajor, semiMinor, theta },
  };
};

const angleDiff = (actual: number, expected: number, modulo: number): number => {
  const raw = Math.abs(actual - expected) % modulo;
  return Math.min(raw, modulo - raw);
};

const buildIndustryReferenceSnapshot = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode = 'industry-standard',
): IndustryReferenceSnapshot => {
  const confidence95Scale = 2.4477;
  const relativeConfidencePairs = [
    ['1-2', '1', '2'],
    ['1-1000', '1', '1000'],
    ['2-2000', '2', '2000'],
    ['3-4', '3', '4'],
    ['10-9', '10', '9'],
    ['200-3', '200', '3'],
    ['2000-3', '2000', '3'],
  ] as const;

  const relativeEllipsePairs = [
    ['1-2', '1', '2'],
    ['1-1000', '1', '1000'],
    ['2-2000', '2', '2000'],
    ['3-4', '3', '4'],
    ['10-9', '10', '9'],
    ['200-3', '200', '3'],
    ['2000-3', '2000', '3'],
  ] as const;

  return {
    summary: {
      iterations: getIndustryReportedIterationCount(result),
    },
    coordinates: {
      '1000': { northing: result.stations['1000']?.y ?? Number.NaN, easting: result.stations['1000']?.x ?? Number.NaN },
      '1': { northing: result.stations['1']?.y ?? Number.NaN, easting: result.stations['1']?.x ?? Number.NaN },
      '9': { northing: result.stations['9']?.y ?? Number.NaN, easting: result.stations['9']?.x ?? Number.NaN },
    },
    angleStdErrsSec: {
      '1000-235-1':
        requireFinite(firstAngleByLabel(result, '1000-235-1')?.weightingStdDev, '1000-235-1 sigma') *
        RAD_TO_DEG *
        3600,
      '2-1-200':
        requireFinite(firstAngleByLabel(result, '2-1-200')?.weightingStdDev, '2-1-200 sigma') *
        RAD_TO_DEG *
        3600,
      '2-1-2000':
        requireFinite(firstAngleByLabel(result, '2-1-2000')?.weightingStdDev, '2-1-2000 sigma') *
        RAD_TO_DEG *
        3600,
      '3-4-200':
        requireFinite(firstAngleByLabel(result, '3-4-200')?.weightingStdDev, '3-4-200 sigma') *
        RAD_TO_DEG *
        3600,
      '3-4-2000':
        requireFinite(firstAngleByLabel(result, '3-4-2000')?.weightingStdDev, '3-4-2000 sigma') *
        RAD_TO_DEG *
        3600,
      '3-4-5':
        requireFinite(firstAngleByLabel(result, '3-4-5')?.weightingStdDev, '3-4-5 sigma') *
        RAD_TO_DEG *
        3600,
      '9-8-10':
        requireFinite(firstAngleByLabel(result, '9-8-10')?.weightingStdDev, '9-8-10 sigma') *
        RAD_TO_DEG *
        3600,
      '10-9-11':
        requireFinite(firstAngleByLabel(result, '10-9-11')?.weightingStdDev, '10-9-11 sigma') *
        RAD_TO_DEG *
        3600,
    },
    distanceStdErrsM: {
      '1000-235': requireFinite(firstDistanceByLabel(result, '1000-235')?.weightingStdDev, '1000-235 sigma'),
      '1-1000': requireFinite(firstDistanceByLabel(result, '1-1000')?.weightingStdDev, '1-1000 sigma'),
      '2-2000': requireFinite(firstDistanceByLabel(result, '2-2000')?.weightingStdDev, '2-2000 sigma'),
      '3-4': requireFinite(firstDistanceByLabel(result, '3-4')?.weightingStdDev, '3-4 sigma'),
      '10-9': requireFinite(firstDistanceByLabel(result, '10-9')?.weightingStdDev, '10-9 sigma'),
    },
    stationSigmasM: {
      '1': {
        northing: requireFinite(getStationPrecision(result, '1', mode).sigmaN, 'station 1 sigmaN'),
        easting: requireFinite(getStationPrecision(result, '1', mode).sigmaE, 'station 1 sigmaE'),
      },
      '2': {
        northing: requireFinite(getStationPrecision(result, '2', mode).sigmaN, 'station 2 sigmaN'),
        easting: requireFinite(getStationPrecision(result, '2', mode).sigmaE, 'station 2 sigmaE'),
      },
      '2000': {
        northing: requireFinite(
          getStationPrecision(result, '2000', mode).sigmaN,
          'station 2000 sigmaN',
        ),
        easting: requireFinite(
          getStationPrecision(result, '2000', mode).sigmaE,
          'station 2000 sigmaE',
        ),
      },
    },
    stationEllipses95M: {
      '1': {
        semiMajor:
          requireFinite(
            getStationPrecision(result, '1', mode).ellipse?.semiMajor,
            'station 1 ellipse semiMajor',
          ) * confidence95Scale,
        semiMinor:
          requireFinite(
            getStationPrecision(result, '1', mode).ellipse?.semiMinor,
            'station 1 ellipse semiMinor',
          ) * confidence95Scale,
        azimuthDeg: requireFinite(
          toSurveyEllipseAzimuthDeg(getStationPrecision(result, '1', mode).ellipse?.theta),
          'station 1 ellipse azimuth',
        ),
      },
      '2': {
        semiMajor:
          requireFinite(
            getStationPrecision(result, '2', mode).ellipse?.semiMajor,
            'station 2 ellipse semiMajor',
          ) * confidence95Scale,
        semiMinor:
          requireFinite(
            getStationPrecision(result, '2', mode).ellipse?.semiMinor,
            'station 2 ellipse semiMinor',
          ) * confidence95Scale,
        azimuthDeg: requireFinite(
          toSurveyEllipseAzimuthDeg(getStationPrecision(result, '2', mode).ellipse?.theta),
          'station 2 ellipse azimuth',
        ),
      },
      '2000': {
        semiMajor:
          requireFinite(
            getStationPrecision(result, '2000', mode).ellipse?.semiMajor,
            'station 2000 ellipse semiMajor',
          ) * confidence95Scale,
        semiMinor:
          requireFinite(
            getStationPrecision(result, '2000', mode).ellipse?.semiMinor,
            'station 2000 ellipse semiMinor',
          ) * confidence95Scale,
        azimuthDeg: requireFinite(
          toSurveyEllipseAzimuthDeg(getStationPrecision(result, '2000', mode).ellipse?.theta),
          'station 2000 ellipse azimuth',
        ),
      },
    },
    relativeConfidence95: Object.fromEntries(
      relativeConfidencePairs.map(([key, from, to]) => {
        const relative = relativePairStatsFor(result, mode, from, to);
        expect(relative, `missing relative precision for ${from}-${to}`).toBeDefined();
        const dist = distanceM(result, from, to);
        return [
          key,
          {
            from,
            to,
            azimuthDeg: azimuthDeg(result, from, to),
            distanceM: dist,
            azimuth95Sec:
              requireFinite(relative?.sigmaAz, `${from}-${to} sigmaAz`) * RAD_TO_DEG * 3600 * confidence95Scale,
            distance95M:
              requireFinite(relative?.sigmaDist, `${from}-${to} sigmaDist`) * confidence95Scale,
            ppm95:
              (requireFinite(relative?.sigmaDist, `${from}-${to} sigmaDist ppm`) *
                confidence95Scale *
                1_000_000) /
              Math.max(dist, 1e-12),
          },
        ];
      }),
    ),
    relativeEllipses95M: Object.fromEntries(
      relativeEllipsePairs.map(([key, from, to]) => {
        const relative = relativePairStatsFor(result, mode, from, to);
        expect(relative?.ellipse, `missing relative ellipse for ${from}-${to}`).toBeDefined();
        return [
          key,
          {
            from,
            to,
            semiMajor:
              requireFinite(relative?.ellipse?.semiMajor, `${from}-${to} ellipse semiMajor`) *
              confidence95Scale,
            semiMinor:
              requireFinite(relative?.ellipse?.semiMinor, `${from}-${to} ellipse semiMinor`) *
              confidence95Scale,
            azimuthDeg: requireFinite(
              toSurveyEllipseAzimuthDeg(relative?.ellipse?.theta),
              `${from}-${to} ellipse azimuth`,
            ),
          },
        ];
      }),
    ),
  };
};

const buildIndustryReferenceDeviation = (
  actual: IndustryReferenceSnapshot,
  expected: IndustryReferenceExpected,
): IndustryReferenceDeviation => ({
  summary: {
    iterations: Math.abs(actual.summary.iterations - expected.summary.iterations),
  },
  coordinates: Object.fromEntries(
    Object.entries(expected.coordinates).map(([stationId, row]) => [
      stationId,
      {
        northing: Math.abs(actual.coordinates[stationId].northing - row.northing),
        easting: Math.abs(actual.coordinates[stationId].easting - row.easting),
      },
    ]),
  ),
  angleStdErrsSec: Object.fromEntries(
    Object.entries(expected.angleStdErrsSec).map(([key, value]) => [
      key,
      Math.abs(actual.angleStdErrsSec[key] - value),
    ]),
  ),
  distanceStdErrsM: Object.fromEntries(
    Object.entries(expected.distanceStdErrsM).map(([key, value]) => [
      key,
      Math.abs(actual.distanceStdErrsM[key] - value),
    ]),
  ),
  stationSigmasM: Object.fromEntries(
    Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
      stationId,
      {
        northing: Math.abs(actual.stationSigmasM[stationId].northing - row.northing),
        easting: Math.abs(actual.stationSigmasM[stationId].easting - row.easting),
      },
    ]),
  ),
  stationEllipses95M: Object.fromEntries(
    Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
      stationId,
      {
        semiMajor: Math.abs(actual.stationEllipses95M[stationId].semiMajor - row.semiMajor),
        semiMinor: Math.abs(actual.stationEllipses95M[stationId].semiMinor - row.semiMinor),
        azimuthDeg: angleDiff(actual.stationEllipses95M[stationId].azimuthDeg, row.azimuthDeg, 180),
      },
    ]),
  ),
  relativeConfidence95: Object.fromEntries(
    Object.entries(expected.relativeConfidence95).map(([key, row]) => [
      key,
      {
        azimuthDeg: angleDiff(actual.relativeConfidence95[key].azimuthDeg, row.azimuthDeg, 360),
        distanceM: Math.abs(actual.relativeConfidence95[key].distanceM - row.distanceM),
        azimuth95Sec: Math.abs(actual.relativeConfidence95[key].azimuth95Sec - row.azimuth95Sec),
        distance95M: Math.abs(actual.relativeConfidence95[key].distance95M - row.distance95M),
        ppm95: Math.abs(actual.relativeConfidence95[key].ppm95 - row.ppm95),
      },
    ]),
  ),
  relativeEllipses95M: Object.fromEntries(
    Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
      key,
      {
        semiMajor: Math.abs(actual.relativeEllipses95M[key].semiMajor - row.semiMajor),
        semiMinor: Math.abs(actual.relativeEllipses95M[key].semiMinor - row.semiMinor),
        azimuthDeg: angleDiff(actual.relativeEllipses95M[key].azimuthDeg, row.azimuthDeg, 180),
      },
    ]),
  ),
});

const assertIndustryReferenceDeviationWithinBaseline = (
  deviation: IndustryReferenceDeviation,
  baseline: IndustryReferenceDeviation,
): void => {
  expect(deviation.summary.iterations).toBeLessThanOrEqual(baseline.summary.iterations);
  Object.entries(deviation.coordinates).forEach(([stationId, row]) => {
    expect(row.northing).toBeLessThanOrEqual(baseline.coordinates[stationId].northing);
    expect(row.easting).toBeLessThanOrEqual(baseline.coordinates[stationId].easting);
  });
  Object.entries(deviation.angleStdErrsSec).forEach(([key, value]) => {
    expect(value).toBeLessThanOrEqual(baseline.angleStdErrsSec[key]);
  });
  Object.entries(deviation.distanceStdErrsM).forEach(([key, value]) => {
    expect(value).toBeLessThanOrEqual(baseline.distanceStdErrsM[key]);
  });
  Object.entries(deviation.stationSigmasM).forEach(([stationId, row]) => {
    expect(row.northing).toBeLessThanOrEqual(baseline.stationSigmasM[stationId].northing);
    expect(row.easting).toBeLessThanOrEqual(baseline.stationSigmasM[stationId].easting);
  });
  Object.entries(deviation.stationEllipses95M).forEach(([stationId, row]) => {
    expect(row.semiMajor).toBeLessThanOrEqual(baseline.stationEllipses95M[stationId].semiMajor);
    expect(row.semiMinor).toBeLessThanOrEqual(baseline.stationEllipses95M[stationId].semiMinor);
    expect(row.azimuthDeg).toBeLessThanOrEqual(baseline.stationEllipses95M[stationId].azimuthDeg);
  });
  Object.entries(deviation.relativeConfidence95).forEach(([key, row]) => {
    expect(row.azimuthDeg).toBeLessThanOrEqual(baseline.relativeConfidence95[key].azimuthDeg);
    expect(row.distanceM).toBeLessThanOrEqual(baseline.relativeConfidence95[key].distanceM);
    expect(row.azimuth95Sec).toBeLessThanOrEqual(baseline.relativeConfidence95[key].azimuth95Sec);
    expect(row.distance95M).toBeLessThanOrEqual(baseline.relativeConfidence95[key].distance95M);
    expect(row.ppm95).toBeLessThanOrEqual(baseline.relativeConfidence95[key].ppm95);
  });
  Object.entries(deviation.relativeEllipses95M).forEach(([key, row]) => {
    expect(row.semiMajor).toBeLessThanOrEqual(baseline.relativeEllipses95M[key].semiMajor);
    expect(row.semiMinor).toBeLessThanOrEqual(baseline.relativeEllipses95M[key].semiMinor);
    expect(row.azimuthDeg).toBeLessThanOrEqual(baseline.relativeEllipses95M[key].azimuthDeg);
  });
};

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

  describe('tier 4: industry-standard reference diff gate', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.detailedReference)) {
      it(`industry standard reference deviation stays within baseline for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        const expected = JSON.parse(
          readFileSync(fixture.detailedReference!.expectedPath, 'utf-8'),
        ) as IndustryReferenceExpected;
        const baseline = JSON.parse(
          readFileSync(fixture.detailedReference!.deviationBaselinePath, 'utf-8'),
        ) as IndustryReferenceDeviation;

        const actual = buildIndustryReferenceSnapshot(result);
        const deviation = buildIndustryReferenceDeviation(actual, expected);
        assertIndustryReferenceDeviationWithinBaseline(deviation, baseline);
      });
    }
  });
});
