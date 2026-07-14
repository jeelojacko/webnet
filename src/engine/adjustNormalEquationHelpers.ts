import {
  ARCSEC_TO_RAD,
  FLOAT_ZENITH_COVARIANCE_SIGMA_SEC,
} from './adjustConstants';
import {
  invertSPDFromCholesky,
  choleskyDecomposeWithDamping,
  solveSPDFromCholesky,
} from './matrix';
import {
  matrixIsFinite,
  recoverUndampedInverse,
  scaleNormalMatrix,
  scaleNormalRhs,
  unscaleNormalInverse,
  unscaleNormalSolution,
} from './adjustNormalMatrixHelpers';
import type {
  DistanceObservation,
  Observation,
  ZenithObservation,
} from '../types';

type LogFn = (_message: string) => void;

export const solveNormalEquations = (
  normal: number[][],
  rhs: number[][],
  options: {
    log: LogFn;
    recoverCovariance?: boolean;
  },
): { correction: number[][]; qxx?: number[][] } => {
  const scaled = scaleNormalMatrix(normal);
  const scaledU = scaleNormalRhs(rhs, scaled.scale);
  const factorization = choleskyDecomposeWithDamping(scaled.scaled);
  if (factorization.damping > 0) {
    options.log(
      `Warning: normal-equation factorization required diagonal damping (lambda=${factorization.damping.toExponential(
        3,
      )}, attempts=${factorization.attempts}).`,
    );
  }
  const scaledCorrection = solveSPDFromCholesky(factorization.factor, scaledU);
  if (!matrixIsFinite(scaledCorrection)) {
    throw new Error(
      'Normal matrix remained singular after diagonal damping; scaled correction contains non-finite values.',
    );
  }
  const correction = unscaleNormalSolution(scaledCorrection, scaled.scale);
  if (!matrixIsFinite(correction)) {
    throw new Error(
      'Normal matrix remained singular or numerically unstable after diagonal damping; correction contains non-finite values.',
    );
  }
  if (!options.recoverCovariance) {
    return { correction };
  }
  const scaledQxx = invertSPDFromCholesky(factorization.factor);
  if (!matrixIsFinite(scaledQxx)) {
    throw new Error(
      'Normal matrix remained singular after diagonal damping; damped covariance contains non-finite values.',
    );
  }
  const qxx =
    factorization.damping > 0
      ? recoverUndampedInverse(
          scaled.scaled,
          scaled.scale,
          scaledQxx,
          'Normal-equation covariance recovery',
          options.log,
        )
      : unscaleNormalInverse(scaledQxx, scaled.scale);
  if (!matrixIsFinite(qxx)) {
    throw new Error(
      'Normal matrix remained singular or numerically unstable after diagonal damping; covariance contains non-finite values.',
    );
  }
  return {
    correction,
    qxx,
  };
};

export const invertNormalMatrixForStats = (
  normal: number[][],
  log: LogFn,
): number[][] => {
  const scaled = scaleNormalMatrix(normal);
  const factorization = choleskyDecomposeWithDamping(scaled.scaled);
  if (factorization.damping > 0) {
    log(
      `Warning: covariance factorization required diagonal damping (lambda=${factorization.damping.toExponential(
        3,
      )}, attempts=${factorization.attempts}).`,
    );
  }
  const scaledQxx = invertSPDFromCholesky(factorization.factor);
  const qxx =
    factorization.damping > 0
      ? recoverUndampedInverse(
          scaled.scaled,
          scaled.scale,
          scaledQxx,
          'Standardized-residual covariance recovery',
          log,
        )
      : unscaleNormalInverse(scaledQxx, scaled.scale);
  if (!matrixIsFinite(qxx)) {
    throw new Error('Non-finite covariance values encountered after regularization.');
  }
  return qxx;
};

export const augmentCovarianceObservations = (
  activeObservations: Observation[],
  options: {
    is2D: boolean;
    log: LogFn;
  },
): Observation[] => {
  if (options.is2D) return activeObservations;
  const existingZenithKeys = new Set(
    activeObservations
      .filter((observation): observation is ZenithObservation => observation.type === 'zenith')
      .map(
        (observation) =>
          `${observation.from}|${observation.to}|${observation.sourceLine ?? -1}|${observation.setId ?? ''}`,
      ),
  );
  const synthetic: ZenithObservation[] = [];
  let syntheticId = -1;
  activeObservations.forEach((observation) => {
    const distanceObservation = observation as DistanceObservation;
    if (
      distanceObservation.type !== 'dist' ||
      distanceObservation.mode !== 'slope' ||
      !Number.isFinite(distanceObservation.bootstrapZenithObs ?? Number.NaN)
    ) {
      return;
    }
    const key = `${distanceObservation.from}|${distanceObservation.to}|${distanceObservation.sourceLine ?? -1}|${distanceObservation.setId ?? ''}`;
    if (existingZenithKeys.has(key)) return;
    synthetic.push({
      id: syntheticId--,
      type: 'zenith',
      instCode: distanceObservation.instCode,
      setId: distanceObservation.setId,
      from: distanceObservation.from,
      to: distanceObservation.to,
      obs: distanceObservation.bootstrapZenithObs as number,
      sourceLine: distanceObservation.sourceLine,
      sourceFile: distanceObservation.sourceFile,
      stdDev: FLOAT_ZENITH_COVARIANCE_SIGMA_SEC * ARCSEC_TO_RAD,
      sigmaSource: 'float',
      hi: distanceObservation.hi,
      ht: distanceObservation.ht,
    });
  });
  if (!synthetic.length) return activeObservations;
  options.log(
    `Covariance-only float zenith augmentation: ${synthetic.length} synthetic row(s) added for weak vertical geometry.`,
  );
  return [...activeObservations, ...synthetic];
};
