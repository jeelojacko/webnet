import type { GpsCovariance, GpsSolveVector } from './adjustTypes';
import type { GpsObservation, Observation } from '../types';

type GpsWeight = {
  wEE: number;
  wNN: number;
  wEN: number;
  wUU?: number;
  wEU?: number;
  wNU?: number;
};

export const captureObservationWeightingStdDevs = (
  observations: Observation[],
  options: {
    effectiveStdDev: (_obs: Observation) => number;
    getObservedHorizontalDistanceIn2D: (_obs: Observation & { type: 'dist' }) => {
      sigmaDistance: number;
    };
    gpsCovariance: (_obs: Observation) => GpsCovariance;
  },
): void => {
  observations.forEach((obs) => {
    if (obs.type === 'gps') {
      const cov = options.gpsCovariance(obs);
      obs.weightingStdDev = undefined;
      obs.weightingStdDevE = Math.sqrt(Math.max(cov.cEE, 0));
      obs.weightingStdDevN = Math.sqrt(Math.max(cov.cNN, 0));
      return;
    }
    if (obs.type === 'dist') {
      obs.weightingStdDev = options.getObservedHorizontalDistanceIn2D(obs).sigmaDistance;
      obs.weightingStdDevE = undefined;
      obs.weightingStdDevN = undefined;
      return;
    }
    obs.weightingStdDev = options.effectiveStdDev(obs);
    obs.weightingStdDevE = undefined;
    obs.weightingStdDevN = undefined;
  });
};

export const gpsCovariance = (
  obs: Observation,
  options: {
    gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
    transformGpsCovarianceToSolveFrame: (_obs: GpsObservation) => GpsCovariance | null;
  },
): GpsCovariance => {
  if (obs.type !== 'gps') {
    const s = Math.max(obs.stdDev || 0, 1e-12);
    return { cEE: s * s, cNN: s * s, cEN: 0, cUU: s * s, cEU: 0, cNU: 0 };
  }
  const transformed = options.transformGpsCovarianceToSolveFrame(obs);
  if (transformed) return transformed;
  const vector = options.gpsObservedVector(obs);
  const varianceScale = Math.max(vector.scale * vector.scale, 1e-12);
  const sE = Math.max(obs.stdDevE ?? obs.stdDev ?? 0, 1e-12);
  const sN = Math.max(obs.stdDevN ?? obs.stdDev ?? 0, 1e-12);
  const sU = Math.max(obs.stdDevU ?? obs.stdDev ?? 0, 1e-12);
  const corrEN = Math.max(-0.999, Math.min(0.999, obs.corrEN ?? 0));
  const corrEU = Math.max(-0.999, Math.min(0.999, obs.corrEU ?? 0));
  const corrNU = Math.max(-0.999, Math.min(0.999, obs.corrNU ?? 0));
  return {
    cEE: sE * sE * varianceScale,
    cNN: sN * sN * varianceScale,
    cEN: corrEN * sE * sN * varianceScale,
    cUU: sU * sU * varianceScale,
    cEU: corrEU * sE * sU * varianceScale,
    cNU: corrNU * sN * sU * varianceScale,
  };
};

export const gpsWeight = (
  obs: Observation,
  options: {
    gpsCovariance: (_obs: Observation) => GpsCovariance;
    is2D: boolean;
  },
): GpsWeight => {
  const cov = options.gpsCovariance(obs);
  const hasVertical =
    !options.is2D &&
    Number.isFinite(cov.cUU ?? Number.NaN) &&
    Number.isFinite(cov.cEU ?? Number.NaN) &&
    Number.isFinite(cov.cNU ?? Number.NaN);
  if (hasVertical) {
    const matrix = [
      [cov.cEE, cov.cEN, cov.cEU ?? 0],
      [cov.cEN, cov.cNN, cov.cNU ?? 0],
      [cov.cEU ?? 0, cov.cNU ?? 0, cov.cUU ?? 0],
    ];
    const det =
      matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
      matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
      matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
    if (Number.isFinite(det) && Math.abs(det) > 1e-24) {
      const inv = [
        [
          (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
          (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
          (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det,
        ],
        [
          (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
          (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
          (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det,
        ],
        [
          (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
          (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
          (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det,
        ],
      ];
      return {
        wEE: inv[0][0],
        wNN: inv[1][1],
        wEN: inv[0][1],
        wUU: inv[2][2],
        wEU: inv[0][2],
        wNU: inv[1][2],
      };
    }
  }
  const det = cov.cEE * cov.cNN - cov.cEN * cov.cEN;
  if (!Number.isFinite(det) || det <= 1e-24) {
    return {
      wEE: 1 / Math.max(cov.cEE, 1e-24),
      wNN: 1 / Math.max(cov.cNN, 1e-24),
      wEN: 0,
    };
  }
  return {
    wEE: cov.cNN / det,
    wNN: cov.cEE / det,
    wEN: -cov.cEN / det,
  };
};
