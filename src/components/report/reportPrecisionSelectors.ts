import type {
  AdjustmentResult,
  Observation,
  RelativeCovarianceBlock,
  Station,
  StationCovarianceBlock,
} from '../../types';
import { stationWithPrecision } from '../../engine/resultPrecision';
import { isLockedPreanalysisObservation } from '../../engine/preanalysis';

type ReportQueryMatcher = (..._parts: Array<string | number | null | undefined>) => boolean;

export interface ReportPrecisionSelectorModel {
  filteredStationRows: Array<[string, Station]>;
  filteredStationCovariances: StationCovarianceBlock[];
  filteredRelativeCovariances: RelativeCovarianceBlock[];
  filteredRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
  lockedPreanalysisObservations: Observation[];
  flaggedStationCues: NonNullable<AdjustmentResult['weakGeometryDiagnostics']>['stationCues'];
  flaggedRelativeCues: NonNullable<AdjustmentResult['weakGeometryDiagnostics']>['relativeCues'];
}

export const buildReportPrecisionSelectorModel = (input: {
  result: Pick<
    AdjustmentResult,
    'stations' | 'observations' | 'relativePrecision' | 'weakGeometryDiagnostics'
  >;
  reconciledDescriptions: Record<string, string>;
  matchesReportQuery: ReportQueryMatcher;
  stationCovariances: StationCovarianceBlock[];
  relativeCovariances: RelativeCovarianceBlock[];
  relativePrecisionRows: NonNullable<AdjustmentResult['relativePrecision']>;
  isPreanalysis: boolean;
}): ReportPrecisionSelectorModel => {
  const stationPrecisionById = new Map(
    input.stationCovariances.map((row) => [row.stationId, row] as const),
  );

  const filteredStationRows = Object.entries(input.result.stations)
    .map(([stationId, station]) => {
      const precision = stationPrecisionById.get(stationId);
      return [
        stationId,
        stationWithPrecision(station, {
          sigmaN: precision?.sigmaN ?? station.sN,
          sigmaE: precision?.sigmaE ?? station.sE,
          sigmaH: precision?.sigmaH ?? station.sH,
          ellipse: precision?.ellipse ?? station.errorEllipse,
          stationCovariance: precision,
        }),
      ] as [string, Station];
    })
    .filter(([stationId, station]) =>
      input.matchesReportQuery(
        stationId,
        input.reconciledDescriptions[stationId],
        station.fixed ? 'fixed' : 'adjusted',
        station.x,
        station.y,
        station.h,
      ),
    );

  const filteredStationCovariances = input.stationCovariances.filter((block) =>
    input.matchesReportQuery(
      block.stationId,
      input.reconciledDescriptions[block.stationId],
      block.cEE,
      block.cEN,
      block.cNN,
      block.cHH,
    ),
  );

  const filteredRelativeCovariances = input.relativeCovariances.filter((rel) =>
    input.matchesReportQuery(
      rel.from,
      rel.to,
      rel.connectionTypes.join(' '),
      rel.sigmaDist,
      rel.sigmaAz,
    ),
  );

  const filteredRelativePrecision = input.relativePrecisionRows.filter((rel) =>
    input.matchesReportQuery(rel.from, rel.to, rel.sigmaDist, rel.sigmaAz),
  );

  const weakGeometryDiagnostics = input.result.weakGeometryDiagnostics;
  const lockedPreanalysisObservations = input.isPreanalysis
    ? input.result.observations.filter(isLockedPreanalysisObservation)
    : [];
  const flaggedStationCues = (weakGeometryDiagnostics?.stationCues ?? []).filter(
    (cue) => cue.severity !== 'ok',
  );
  const flaggedRelativeCues = (weakGeometryDiagnostics?.relativeCues ?? []).filter(
    (cue) => cue.severity !== 'ok',
  );

  return {
    filteredStationRows,
    filteredStationCovariances,
    filteredRelativeCovariances,
    filteredRelativePrecision,
    lockedPreanalysisObservations,
    flaggedStationCues,
    flaggedRelativeCues,
  };
};
