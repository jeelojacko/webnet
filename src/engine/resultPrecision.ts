import type {
  AdjustmentResult,
  PrecisionReportingMode,
  RelativeCovarianceBlock,
  ResultPrecisionModel,
  Station,
  StationCovarianceBlock,
  StationErrorEllipse,
} from '../types';

const emptyPrecisionModel: ResultPrecisionModel = {
  stationCovariances: [],
  relativeCovariances: [],
  relativePrecision: [],
};

// Exact sqrt(chi-square(2 dof, 95%)) used by industry-style 95% ellipse/confidence sections.
export const INDUSTRY_CONFIDENCE_95_SCALE = 2.447746830680816;

export const resolvePrecisionModel = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
): ResultPrecisionModel => result.precisionModels?.[mode] ?? emptyPrecisionModel;

export const getStationPrecision = (
  result: AdjustmentResult,
  stationId: string,
  mode: PrecisionReportingMode,
): {
  sigmaN?: number;
  sigmaE?: number;
  sigmaH?: number;
  ellipse?: StationErrorEllipse;
  stationCovariance?: StationCovarianceBlock;
} => {
  const station = result.stations[stationId];
  const stationCovariance = (resolvePrecisionModel(result, mode).stationCovariances ?? []).find(
    (row) => row.stationId === stationId,
  );
  return {
    sigmaN: stationCovariance?.sigmaN ?? station?.sN,
    sigmaE: stationCovariance?.sigmaE ?? station?.sE,
    sigmaH: stationCovariance?.sigmaH ?? station?.sH,
    ellipse: stationCovariance?.ellipse ?? station?.errorEllipse,
    stationCovariance,
  };
};

export const getRelativePrecisionRows = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
): NonNullable<AdjustmentResult['relativePrecision']> =>
  resolvePrecisionModel(result, mode).relativePrecision ?? result.relativePrecision ?? [];

export const getRelativeCovarianceRows = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
): RelativeCovarianceBlock[] =>
  resolvePrecisionModel(result, mode).relativeCovariances ?? result.relativeCovariances ?? [];

export const getStationCovarianceRows = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
): StationCovarianceBlock[] =>
  resolvePrecisionModel(result, mode).stationCovariances ?? result.stationCovariances ?? [];

export const toSurveyEllipseAzimuthDeg = (thetaDeg: number | undefined): number | undefined => {
  if (thetaDeg == null || !Number.isFinite(thetaDeg)) return undefined;
  return ((90 - thetaDeg) % 180 + 180) % 180;
};

export const getIndustryReportedIterationCount = (
  result: Pick<AdjustmentResult, 'converged' | 'iterations'>,
): number =>
  result.converged && result.iterations > 1 ? result.iterations - 1 : result.iterations;

export const stationWithPrecision = (
  station: Station,
  precision: ReturnType<typeof getStationPrecision>,
): Station => ({
  ...station,
  sN: precision.sigmaN ?? station.sN,
  sE: precision.sigmaE ?? station.sE,
  sH: precision.sigmaH ?? station.sH,
  errorEllipse: precision.ellipse ?? station.errorEllipse,
});
