import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG } from '../src/engine/angles';
import { LSAEngine } from '../src/engine/adjust';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
} from '../src/engine/precisionPropagation';
import {
  getRelativeCovarianceRows,
  getIndustryReportedIterationCount,
  getRelativePrecisionRows,
  getStationPrecision,
  INDUSTRY_CONFIDENCE_95_SCALE,
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
  errorPropagationSummary: {
    stationSigmaNorthingMax: number;
    stationSigmaEastingMax: number;
    stationEllipseSemiMajorMax: number;
    stationEllipseSemiMinorMax: number;
    stationEllipseAzimuthDegMax: number;
    relativeConfidenceAzimuth95SecMax: number;
    relativeConfidenceDistance95MMax: number;
    relativeConfidencePpm95Max: number;
    relativeEllipseSemiMajorMax: number;
    relativeEllipseSemiMinorMax: number;
    relativeEllipseAzimuthDegMax: number;
  };
};

const INDUSTRY_REFERENCE_LINEAR_EPSILON = 1e-10;
const INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON = 1e-8;
const INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON = 1e-6;
const INDUSTRY_REFERENCE_PPM_EPSILON = 1e-8;

const expectWithinBaseline = (actual: number, baseline: number, epsilon = 0): void => {
  expect(actual).toBeLessThanOrEqual(baseline + epsilon);
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

  const covarianceRow =
    getRelativeCovarianceRows(result, mode).find((row) => row.from === from && row.to === to) ??
    getRelativeCovarianceRows(result, mode).find((row) => row.from === to && row.to === from);
  if (covarianceRow) {
    const ellipse =
      covarianceRow.ellipse ??
      buildHorizontalErrorEllipse(covarianceRow.cEE, covarianceRow.cNN, covarianceRow.cEN).ellipse;
    return {
      sigmaDist:
        covarianceRow.sigmaDist ??
        buildDistanceAzimuthPrecision(
          (result.stations[to]?.x ?? 0) - (result.stations[from]?.x ?? 0),
          (result.stations[to]?.y ?? 0) - (result.stations[from]?.y ?? 0),
          covarianceRow,
        ).sigmaDist,
      sigmaAz:
        covarianceRow.sigmaAz ??
        buildDistanceAzimuthPrecision(
          (result.stations[to]?.x ?? 0) - (result.stations[from]?.x ?? 0),
          (result.stations[to]?.y ?? 0) - (result.stations[from]?.y ?? 0),
          covarianceRow,
        ).sigmaAz,
      ellipse: {
        semiMajor: ellipse.semiMajor,
        semiMinor: ellipse.semiMinor,
        theta: ellipse.theta,
      },
    };
  }

  const fromStation = result.stations[from];
  const toStation = result.stations[to];
  if (!fromStation || !toStation) return undefined;

  const fromPrecision = getStationPrecision(result, from, mode);
  const toPrecision = getStationPrecision(result, to, mode);
  const varE = (toPrecision.sigmaE ?? toStation.sE ?? 0) ** 2 + (fromPrecision.sigmaE ?? fromStation.sE ?? 0) ** 2;
  const varN = (toPrecision.sigmaN ?? toStation.sN ?? 0) ** 2 + (fromPrecision.sigmaN ?? fromStation.sN ?? 0) ** 2;
  const covEN = 0;
  const ellipse = buildHorizontalErrorEllipse(varE, varN, covEN).ellipse;
  const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(
    toStation.x - fromStation.x,
    toStation.y - fromStation.y,
    { cEE: varE, cNN: varN, cEN: covEN },
  );
  return {
    sigmaDist,
    sigmaAz,
    ellipse: { semiMajor: ellipse.semiMajor, semiMinor: ellipse.semiMinor, theta: ellipse.theta },
  };
};

const angleDiff = (actual: number, expected: number, modulo: number): number => {
  const raw = Math.abs(actual - expected) % modulo;
  return Math.min(raw, modulo - raw);
};

const reportedEllipseAzimuthDeg = (
  ellipse:
    | {
        semiMajor?: number;
        semiMinor?: number;
        theta?: number;
      }
    | undefined,
): number => {
  if (!ellipse) return 0;
  if (Math.max(Math.abs(ellipse.semiMajor ?? 0), Math.abs(ellipse.semiMinor ?? 0)) <= 1e-12) {
    return 0;
  }
  return toSurveyEllipseAzimuthDeg(ellipse.theta) ?? 0;
};

const buildIndustryReferenceSnapshot = (
  result: AdjustmentResult,
  expected: IndustryReferenceExpected,
  mode: PrecisionReportingMode = 'industry-standard',
): IndustryReferenceSnapshot => {
  const confidence95Scale = INDUSTRY_CONFIDENCE_95_SCALE;

  return {
    summary: {
      iterations: getIndustryReportedIterationCount(result),
    },
    coordinates: Object.fromEntries(
      Object.keys(expected.coordinates).map((stationId) => [
        stationId,
        {
          northing: result.stations[stationId]?.y ?? Number.NaN,
          easting: result.stations[stationId]?.x ?? Number.NaN,
        },
      ]),
    ),
    angleStdErrsSec: Object.fromEntries(
      Object.keys(expected.angleStdErrsSec).map((key) => [
        key,
        requireFinite(firstAngleByLabel(result, key)?.weightingStdDev, `${key} sigma`) * RAD_TO_DEG * 3600,
      ]),
    ),
    distanceStdErrsM: Object.fromEntries(
      Object.keys(expected.distanceStdErrsM).map((key) => [
        key,
        requireFinite(firstDistanceByLabel(result, key)?.weightingStdDev, `${key} sigma`),
      ]),
    ),
    stationSigmasM: Object.fromEntries(
      Object.keys(expected.stationSigmasM).map((stationId) => {
        const station = result.stations[stationId];
        const precision = getStationPrecision(result, stationId, mode);
        return [
          stationId,
          {
            northing: requireFinite(precision.sigmaN ?? station?.sN ?? 0, `station ${stationId} sigmaN`),
            easting: requireFinite(precision.sigmaE ?? station?.sE ?? 0, `station ${stationId} sigmaE`),
          },
        ];
      }),
    ),
    stationEllipses95M: Object.fromEntries(
      Object.keys(expected.stationEllipses95M).map((stationId) => {
        const ellipse = getStationPrecision(result, stationId, mode).ellipse;
        return [
          stationId,
          {
            semiMajor: requireFinite(ellipse?.semiMajor ?? 0, `station ${stationId} ellipse semiMajor`) * confidence95Scale,
            semiMinor: requireFinite(ellipse?.semiMinor ?? 0, `station ${stationId} ellipse semiMinor`) * confidence95Scale,
            azimuthDeg: requireFinite(reportedEllipseAzimuthDeg(ellipse), `station ${stationId} ellipse azimuth`),
          },
        ];
      }),
    ),
    relativeConfidence95: Object.fromEntries(
      Object.entries(expected.relativeConfidence95).map(([key, reference]) => {
        const { from, to } = reference;
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
      Object.entries(expected.relativeEllipses95M).map(([key, reference]) => {
        const { from, to } = reference;
        const relative = relativePairStatsFor(result, mode, from, to);
        return [
          key,
          {
            from,
            to,
            semiMajor: requireFinite(relative?.ellipse?.semiMajor ?? 0, `${from}-${to} ellipse semiMajor`) * confidence95Scale,
            semiMinor: requireFinite(relative?.ellipse?.semiMinor ?? 0, `${from}-${to} ellipse semiMinor`) * confidence95Scale,
            azimuthDeg: requireFinite(reportedEllipseAzimuthDeg(relative?.ellipse), `${from}-${to} ellipse azimuth`),
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
  errorPropagationSummary: {
    stationSigmaNorthingMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationSigmasM[stationId].northing - row.northing),
          ]),
        ),
      ),
    ),
    stationSigmaEastingMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationSigmasM[stationId].easting - row.easting),
          ]),
        ),
      ),
    ),
    stationEllipseSemiMajorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationEllipses95M[stationId].semiMajor - row.semiMajor),
          ]),
        ),
      ),
    ),
    stationEllipseSemiMinorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationEllipses95M[stationId].semiMinor - row.semiMinor),
          ]),
        ),
      ),
    ),
    stationEllipseAzimuthDegMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            angleDiff(actual.stationEllipses95M[stationId].azimuthDeg, row.azimuthDeg, 180),
          ]),
        ),
      ),
    ),
    relativeConfidenceAzimuth95SecMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].azimuth95Sec - row.azimuth95Sec),
          ]),
        ),
      ),
    ),
    relativeConfidenceDistance95MMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].distance95M - row.distance95M),
          ]),
        ),
      ),
    ),
    relativeConfidencePpm95Max: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].ppm95 - row.ppm95),
          ]),
        ),
      ),
    ),
    relativeEllipseSemiMajorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            Math.abs(actual.relativeEllipses95M[key].semiMajor - row.semiMajor),
          ]),
        ),
      ),
    ),
    relativeEllipseSemiMinorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            Math.abs(actual.relativeEllipses95M[key].semiMinor - row.semiMinor),
          ]),
        ),
      ),
    ),
    relativeEllipseAzimuthDegMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            angleDiff(actual.relativeEllipses95M[key].azimuthDeg, row.azimuthDeg, 180),
          ]),
        ),
      ),
    ),
  },
});

const assertIndustryReferenceDeviationWithinBaseline = (
  deviation: IndustryReferenceDeviation,
  baseline: IndustryReferenceDeviation,
): void => {
  expect(deviation.summary.iterations).toBeLessThanOrEqual(baseline.summary.iterations);
  Object.entries(deviation.coordinates).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.northing,
      baseline.coordinates[stationId].northing,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.easting,
      baseline.coordinates[stationId].easting,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.angleStdErrsSec).forEach(([key, value]) => {
    expectWithinBaseline(
      value,
      baseline.angleStdErrsSec[key],
      INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
    );
  });
  Object.entries(deviation.distanceStdErrsM).forEach(([key, value]) => {
    expectWithinBaseline(
      value,
      baseline.distanceStdErrsM[key],
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.stationSigmasM).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.northing,
      baseline.stationSigmasM[stationId].northing,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.easting,
      baseline.stationSigmasM[stationId].easting,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.stationEllipses95M).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.semiMajor,
      baseline.stationEllipses95M[stationId].semiMajor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.semiMinor,
      baseline.stationEllipses95M[stationId].semiMinor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.stationEllipses95M[stationId].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
  });
  Object.entries(deviation.relativeConfidence95).forEach(([key, row]) => {
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.relativeConfidence95[key].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
    expectWithinBaseline(
      row.distanceM,
      baseline.relativeConfidence95[key].distanceM,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuth95Sec,
      baseline.relativeConfidence95[key].azimuth95Sec,
      INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
    );
    expectWithinBaseline(
      row.distance95M,
      baseline.relativeConfidence95[key].distance95M,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.ppm95,
      baseline.relativeConfidence95[key].ppm95,
      INDUSTRY_REFERENCE_PPM_EPSILON,
    );
  });
  Object.entries(deviation.relativeEllipses95M).forEach(([key, row]) => {
    expectWithinBaseline(
      row.semiMajor,
      baseline.relativeEllipses95M[key].semiMajor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.semiMinor,
      baseline.relativeEllipses95M[key].semiMinor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.relativeEllipses95M[key].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
  });
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationSigmaNorthingMax,
    baseline.errorPropagationSummary.stationSigmaNorthingMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationSigmaEastingMax,
    baseline.errorPropagationSummary.stationSigmaEastingMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseSemiMajorMax,
    baseline.errorPropagationSummary.stationEllipseSemiMajorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseSemiMinorMax,
    baseline.errorPropagationSummary.stationEllipseSemiMinorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseAzimuthDegMax,
    baseline.errorPropagationSummary.stationEllipseAzimuthDegMax,
    INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidenceAzimuth95SecMax,
    baseline.errorPropagationSummary.relativeConfidenceAzimuth95SecMax,
    INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidenceDistance95MMax,
    baseline.errorPropagationSummary.relativeConfidenceDistance95MMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidencePpm95Max,
    baseline.errorPropagationSummary.relativeConfidencePpm95Max,
    INDUSTRY_REFERENCE_PPM_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseSemiMajorMax,
    baseline.errorPropagationSummary.relativeEllipseSemiMajorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseSemiMinorMax,
    baseline.errorPropagationSummary.relativeEllipseSemiMinorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseAzimuthDegMax,
    baseline.errorPropagationSummary.relativeEllipseAzimuthDegMax,
    INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
  );
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

        const actual = buildIndustryReferenceSnapshot(result, expected);
        const deviation = buildIndustryReferenceDeviation(actual, expected);
        assertIndustryReferenceDeviationWithinBaseline(deviation, baseline);
      });
    }
  });
});
