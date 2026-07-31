import { expect } from 'vitest';

import { RAD_TO_DEG } from '../../src/engine/angles';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
} from '../../src/engine/precisionPropagation';
import {
  getIndustryReportedIterationCount,
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationPrecision,
  INDUSTRY_CONFIDENCE_95_SCALE,
  toSurveyEllipseAzimuthDeg,
} from '../../src/engine/resultPrecision';
import type { AdjustmentResult, Observation, PrecisionReportingMode } from '../../src/types';
import type { IndustryReferenceExpected, IndustryReferenceSnapshot } from './computationalParityTypes';
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

export const buildIndustryReferenceSnapshot = (
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
