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

const derivedPrecisionModelCache = new WeakMap<
  AdjustmentResult,
  Partial<Record<PrecisionReportingMode, ResultPrecisionModel>>
>();

// Exact sqrt(chi-square(2 dof, 95%)) used by industry-style 95% ellipse/confidence sections.
export const INDUSTRY_CONFIDENCE_95_SCALE = 2.447746830680816;

const scaleEllipse = (
  ellipse: StationErrorEllipse | undefined,
  linearScale: number,
): StationErrorEllipse | undefined =>
  ellipse
    ? {
        semiMajor: ellipse.semiMajor * linearScale,
        semiMinor: ellipse.semiMinor * linearScale,
        theta: ellipse.theta,
      }
    : undefined;

export const scaleStationCovarianceRows = (
  rows: StationCovarianceBlock[] | undefined,
  scaleSq: number,
): StationCovarianceBlock[] => {
  if (!rows?.length) return [];
  const linearScale = Math.sqrt(Math.max(scaleSq, 0));
  return rows.map((row) => ({
    ...row,
    cEE: row.cEE * scaleSq,
    cEN: row.cEN * scaleSq,
    cEH: row.cEH != null ? row.cEH * scaleSq : undefined,
    cNN: row.cNN * scaleSq,
    cNH: row.cNH != null ? row.cNH * scaleSq : undefined,
    cHH: row.cHH != null ? row.cHH * scaleSq : undefined,
    sigmaE: row.sigmaE * linearScale,
    sigmaN: row.sigmaN * linearScale,
    sigmaH: row.sigmaH != null ? row.sigmaH * linearScale : undefined,
    ellipse: scaleEllipse(row.ellipse, linearScale),
  }));
};

export const scaleRelativeCovarianceRows = (
  rows: RelativeCovarianceBlock[] | undefined,
  scaleSq: number,
): RelativeCovarianceBlock[] => {
  if (!rows?.length) return [];
  const linearScale = Math.sqrt(Math.max(scaleSq, 0));
  return rows.map((row) => ({
    ...row,
    cEE: row.cEE * scaleSq,
    cEN: row.cEN * scaleSq,
    cEH: row.cEH != null ? row.cEH * scaleSq : undefined,
    cNN: row.cNN * scaleSq,
    cNH: row.cNH != null ? row.cNH * scaleSq : undefined,
    cHH: row.cHH != null ? row.cHH * scaleSq : undefined,
    sigmaE: row.sigmaE * linearScale,
    sigmaN: row.sigmaN * linearScale,
    sigmaH: row.sigmaH != null ? row.sigmaH * linearScale : undefined,
    sigmaDist: row.sigmaDist != null ? row.sigmaDist * linearScale : undefined,
    sigmaAz: row.sigmaAz != null ? row.sigmaAz * linearScale : undefined,
    ellipse: scaleEllipse(row.ellipse, linearScale),
  }));
};

export const scaleRelativePrecisionRows = (
  rows: NonNullable<AdjustmentResult['relativePrecision']> | undefined,
  scaleSq: number,
): NonNullable<AdjustmentResult['relativePrecision']> => {
  if (!rows?.length) return [];
  const linearScale = Math.sqrt(Math.max(scaleSq, 0));
  return rows.map((row) => ({
    ...row,
    sigmaE: row.sigmaE * linearScale,
    sigmaN: row.sigmaN * linearScale,
    sigmaDist: row.sigmaDist != null ? row.sigmaDist * linearScale : undefined,
    sigmaAz: row.sigmaAz != null ? row.sigmaAz * linearScale : undefined,
    ellipse: scaleEllipse(row.ellipse, linearScale),
  }));
};

const resolvePosteriorScaleSq = (result: AdjustmentResult): number =>
  result.dof > 0 && Number.isFinite(result.seuw) && result.seuw > 0 ? result.seuw * result.seuw : 1;

export const resolvePrecisionModel = (
  result: AdjustmentResult,
  mode: PrecisionReportingMode,
): ResultPrecisionModel => {
  const cached = derivedPrecisionModelCache.get(result)?.[mode];
  if (cached) return cached;

  const baseModel = result.precisionModels?.[mode];
  const industryBase: ResultPrecisionModel =
    result.precisionModels?.['industry-standard'] ?? {
      stationCovariances: result.stationCovariances ?? [],
      relativeCovariances: result.relativeCovariances ?? [],
      relativePrecision: result.relativePrecision ?? [],
    };

  let resolved: ResultPrecisionModel;
  if (mode === 'industry-standard') {
    resolved = baseModel ?? industryBase;
  } else if (baseModel) {
    resolved = baseModel;
  } else {
    const scaleSq = resolvePosteriorScaleSq(result);
    resolved = {};
    resolved.stationCovariances = scaleStationCovarianceRows(industryBase.stationCovariances, scaleSq);
    resolved.relativeCovariances = scaleRelativeCovarianceRows(
      industryBase.relativeCovariances,
      scaleSq,
    );
    resolved.relativePrecision = scaleRelativePrecisionRows(industryBase.relativePrecision, scaleSq);
  }

  if (mode === 'posterior-scaled') {
    const scaleSq = resolvePosteriorScaleSq(result);
    resolved = {
      stationCovariances:
        resolved.stationCovariances ??
        scaleStationCovarianceRows(industryBase.stationCovariances, scaleSq),
      relativeCovariances:
        resolved.relativeCovariances ??
        scaleRelativeCovarianceRows(industryBase.relativeCovariances, scaleSq),
      relativePrecision:
        resolved.relativePrecision ??
        scaleRelativePrecisionRows(industryBase.relativePrecision, scaleSq),
    };
  }

  if (
    !resolved.stationCovariances &&
    !resolved.relativeCovariances &&
    !resolved.relativePrecision
  ) {
    resolved = emptyPrecisionModel;
  }

  const nextCache = derivedPrecisionModelCache.get(result) ?? {};
  nextCache[mode] = resolved;
  derivedPrecisionModelCache.set(result, nextCache);
  return resolved;
};

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
