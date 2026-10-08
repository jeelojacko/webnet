/**
 * CAD best-fit line: orthogonal total-least-squares (PCA) in 2D.
 *
 * Deterministic and translation/scale invariant. Outputs are framework-free
 * result objects; Worker B projects them into an open two-vertex polyline
 * (never a CadLineEntity, which would require faked station ids).
 */
import {
  CAD_BEST_FIT_FLOOR,
  cadBestFitMaxAbs,
  cadBestFitMeanSquared,
  cadBestFitNormalizeAngleDeg,
  cadBestFitSymmetricEigen2,
  cadPrepareBestFitPoints,
  type CadBestFitPoint,
} from './cadBestFitCommon';

export type BestFitLineInput = CadBestFitPoint;

export interface BestFitLineResult {
  centroidX: number;
  centroidY: number;
  tangentX: number;
  tangentY: number;
  normalX: number;
  normalY: number;
  rms: number;
  maxAbs: number;
  residuals: number[];
  closestPoints: BestFitLineInput[];
  endP0: BestFitLineInput;
  endP1: BestFitLineInput;
  spanLength: number;
  azimuthDeg: number;
}

/** Principal eigenvector is indeterminate when the eigenvalue gap vanishes. */
const BEST_FIT_LINE_ISOTROPIC_RATIO = 1e-9;
/** Below this the X component is treated as machine-zero for sign choice. */
const BEST_FIT_LINE_SIGN_FLOOR = 1e-12;

interface LineCovariance {
  xx: number;
  xy: number;
  yy: number;
}

const lineCovariance = (
  points: readonly CadBestFitPoint[],
  centroid: CadBestFitPoint,
  inverseSpan: number,
): LineCovariance => {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = (point.x - centroid.x) * inverseSpan;
    const dy = (point.y - centroid.y) * inverseSpan;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  return { xx, xy, yy };
};

const resolveTangentSign = (x: number, y: number): CadBestFitPoint => {
  if (x < -BEST_FIT_LINE_SIGN_FLOOR) return { x: -x, y: -y };
  if (Math.abs(x) <= BEST_FIT_LINE_SIGN_FLOOR && y < 0) return { x: -x, y: -y };
  return { x, y };
};

const lineAzimuthDeg = (tangent: CadBestFitPoint): number =>
  cadBestFitNormalizeAngleDeg((Math.atan2(tangent.x, tangent.y) * 180) / Math.PI);

interface LineProjection {
  sample: CadBestFitPoint;
  tangentT: number;
  closest: CadBestFitPoint;
  residual: number;
}

const projectSample = (
  sample: CadBestFitPoint,
  centroid: CadBestFitPoint,
  tangent: CadBestFitPoint,
  normal: CadBestFitPoint,
): LineProjection => {
  const dx = sample.x - centroid.x;
  const dy = sample.y - centroid.y;
  const tangentT = dx * tangent.x + dy * tangent.y;
  return {
    sample,
    tangentT,
    closest: {
      x: centroid.x + tangentT * tangent.x,
      y: centroid.y + tangentT * tangent.y,
    },
    residual: dx * normal.x + dy * normal.y,
  };
};

export const cadBestFitLine = (
  points: readonly BestFitLineInput[],
): BestFitLineResult | null => {
  const prepared = cadPrepareBestFitPoints(points);
  if (prepared.distinct.length < 2) return null;
  if (!Number.isFinite(prepared.span) || prepared.span <= CAD_BEST_FIT_FLOOR) {
    return null;
  }
  const covariance = lineCovariance(prepared.distinct, prepared.centroid, 1 / prepared.span);
  const eigen = cadBestFitSymmetricEigen2(covariance.xx, covariance.xy, covariance.yy);
  if (!eigen || !Number.isFinite(eigen.majorValue) || eigen.majorValue <= CAD_BEST_FIT_FLOOR) {
    return null;
  }
  if (eigen.majorValue - eigen.minorValue <= eigen.majorValue * BEST_FIT_LINE_ISOTROPIC_RATIO) {
    return null;
  }
  const tangent = resolveTangentSign(eigen.majorX, eigen.majorY);
  const normal: CadBestFitPoint = { x: -tangent.y, y: tangent.x };
  const projections = prepared.finite.map((sample) =>
    projectSample(sample, prepared.centroid, tangent, normal),
  );
  const residuals = projections.map((projection) => projection.residual);
  const tangentValues = projections.map((projection) => projection.tangentT);
  const minT = Math.min(...tangentValues);
  const maxT = Math.max(...tangentValues);
  const endP0: CadBestFitPoint = {
    x: prepared.centroid.x + minT * tangent.x,
    y: prepared.centroid.y + minT * tangent.y,
  };
  const endP1: CadBestFitPoint = {
    x: prepared.centroid.x + maxT * tangent.x,
    y: prepared.centroid.y + maxT * tangent.y,
  };
  return {
    centroidX: prepared.centroid.x,
    centroidY: prepared.centroid.y,
    tangentX: tangent.x,
    tangentY: tangent.y,
    normalX: normal.x,
    normalY: normal.y,
    rms: Math.sqrt(cadBestFitMeanSquared(residuals)),
    maxAbs: cadBestFitMaxAbs(residuals),
    residuals,
    closestPoints: projections.map((projection) => projection.closest),
    endP0,
    endP1,
    spanLength: maxT - minT,
    azimuthDeg: lineAzimuthDeg(tangent),
  };
};
