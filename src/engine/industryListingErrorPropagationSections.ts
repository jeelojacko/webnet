import { RAD_TO_DEG } from './angles';
import { getStationPrecision } from './resultPrecision';
import type { AdjustmentResult, Station } from '../types';
import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';
import type { DisplayFactors, PositionalToleranceRow, RelationshipRow, RenderTextTable } from './industryListingSectionTypes';
import { ONE_DIMENSIONAL_CONFIDENCE_95_SCALE } from './industryListingSectionTypes';

export interface AppendErrorPropagationSectionsArgs {
  lines: string[];
  res: AdjustmentResult;
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  stationEntriesForListing: Array<[string, Station]>;
  classicTraverseStationOrder: string[];
  relationshipRows: RelationshipRow[];
  selectedEllipseStationIds: Set<string>;
  gpsDirectFixedLinkedStations: Set<string>;
  positionalToleranceRows: PositionalToleranceRow[];
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  isGnssOnlyListing: boolean;
  hasStationDescriptions: boolean;
  isPreanalysis: boolean;
  useClassicPreanalysisListing: boolean;
  coordMode: string;
  linearUnit: string;
  unitScale: number;
  coordSystemMode: string;
  precisionReportingMode: NonNullable<IndustryListingSettings['precisionReportingMode']>;
  confidence95Scale: number;
  positionalToleranceEnabled: boolean;
  positionalToleranceConfidencePercent: number;
  positionalToleranceConstantMm: number;
  positionalTolerancePpm: number;
  addCenteredHeading: (_title: string) => void;
  renderTextTable: RenderTextTable;
  stationDescription: (_stationId: string) => string;
  formatEllipseAzDm: (
    _thetaDeg?: number,
    _semiMajor?: number,
    _semiMinor?: number,
    _convergenceCorrectionDeg?: number,
  ) => string;
  displayFactorsForStation: (_stationId: string, _station: Station) => DisplayFactors;
}

export const appendErrorPropagationSections = ({
  lines,
  res,
  settings,
  parseSettings,
  parseState,
  stationEntriesForListing,
  classicTraverseStationOrder,
  relationshipRows,
  selectedEllipseStationIds,
  gpsDirectFixedLinkedStations,
  positionalToleranceRows,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  isGnssOnlyListing,
  hasStationDescriptions,
  isPreanalysis,
  useClassicPreanalysisListing,
  coordMode,
  linearUnit,
  unitScale,
  coordSystemMode,
  precisionReportingMode,
  confidence95Scale,
  positionalToleranceEnabled,
  positionalToleranceConfidencePercent,
  positionalToleranceConstantMm,
  positionalTolerancePpm,
  addCenteredHeading,
  renderTextTable,
  stationDescription,
  formatEllipseAzDm,
  displayFactorsForStation,
}: AppendErrorPropagationSectionsArgs) => {
  if (!settings.listingShowErrorPropagation) return;
  lines.push('');
  addCenteredHeading('Error Propagation');
  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Station Coordinate Standard Deviations' : 'Predicted Station Coordinate Standard Deviations'} (${linearUnit})`,
  );
  lines.push('');
  if (useClassicPreanalysisListing) {
    const firstCoordLabel = (parseState?.order ?? parseSettings.order) === 'NE' ? 'N' : 'E';
    const secondCoordLabel = (parseState?.order ?? parseSettings.order) === 'NE' ? 'E' : 'N';
    lines.push(
      coordMode === '3D'
        ? `Station                     ${firstCoordLabel}             ${secondCoordLabel}             Elev`
        : `Station                     ${firstCoordLabel}             ${secondCoordLabel}`,
    );
    const classicPrecisionStationEntries =
      classicTraverseStationOrder.length > 0
        ? classicTraverseStationOrder
            .map((stationId) => [stationId, res.stations[stationId]] as const)
            .filter((entry): entry is [string, Station] => entry[1] != null)
        : stationEntriesForListing;
    classicPrecisionStationEntries.forEach(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const firstSigmaValue =
        (((parseState?.order ?? parseSettings.order) === 'NE' ? precision.sigmaN : precision.sigmaE) ?? 0) * unitScale;
      const secondSigmaValue =
        (((parseState?.order ?? parseSettings.order) === 'NE' ? precision.sigmaE : precision.sigmaN) ?? 0) * unitScale;
      const firstSigma = firstSigmaValue.toFixed(6).padStart(14);
      const secondSigma = secondSigmaValue.toFixed(6).padStart(14);
      const base = `${id.padEnd(18)}${firstSigma}${secondSigma}`;
      lines.push(coordMode === '3D' ? `${base}${((precision.sigmaH ?? 0) * unitScale).toFixed(6).padStart(14)}` : base);
    });
  } else if (isGnssOnlyListing && !hasStationDescriptions) {
    lines.push(coordMode === '3D' ? 'Station                     N             E             Elev' : 'Station                     N             E');
    stationEntriesForListing.forEach(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const base = `${id.padEnd(18)}${((precision.sigmaN ?? 0) * unitScale).toFixed(6).padStart(14)}${((precision.sigmaE ?? 0) * unitScale).toFixed(6).padStart(14)}`;
      lines.push(coordMode === '3D' ? `${base}${((precision.sigmaH ?? 0) * unitScale).toFixed(6).padStart(14)}` : base);
    });
  } else {
    const stdRows = stationEntriesForListing.map(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const row = [id, stationDescription(id) || '-', ((precision.sigmaN ?? 0) * unitScale).toFixed(6), ((precision.sigmaE ?? 0) * unitScale).toFixed(6)];
      if (coordMode === '3D') row.push(((precision.sigmaH ?? 0) * unitScale).toFixed(6));
      return row;
    });
    renderTextTable(
      coordMode === '3D' ? ['Station', 'Description', 'N', 'E', 'Elev'] : ['Station', 'Description', 'N', 'E'],
      stdRows,
      coordMode === '3D' ? [2, 3, 4] : [2, 3],
    );
  }

  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Station Coordinate Error Ellipses' : 'Predicted Station Coordinate Error Ellipses'} (${linearUnit})`,
  );
  lines.push('                            Confidence Region = 95%');
  lines.push('');
  const stationEllipseRows = stationEntriesForListing
    .map(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const station = res.stations[id];
      const hasZeroPrecisionRow =
        station?.fixed &&
        (precision.sigmaN == null || Math.abs(precision.sigmaN) <= 1e-15) &&
        (precision.sigmaE == null || Math.abs(precision.sigmaE) <= 1e-15) &&
        (coordMode !== '3D' || precision.sigmaH == null || Math.abs(precision.sigmaH) <= 1e-15);
      if (selectedEllipseStationIds.size > 0 && !selectedEllipseStationIds.has(id) && !hasZeroPrecisionRow) {
        return null;
      }
      if (!precision.ellipse && !hasZeroPrecisionRow) return null;
      const row = [
        id,
        ((precision.ellipse?.semiMajor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        ((precision.ellipse?.semiMinor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        hasZeroPrecisionRow
          ? '0-00'
          : formatEllipseAzDm(
              precision.ellipse?.theta,
              precision.ellipse?.semiMajor,
              precision.ellipse?.semiMinor,
              usesCompactGnssParityLayout && gpsDirectFixedLinkedStations.has(id)
                ? displayFactorsForStation(id, station ?? res.stations[id]).convergenceAngleRad * RAD_TO_DEG
                : 0,
            ),
      ];
      if (coordMode === '3D') row.push(((precision.sigmaH ?? 0) * ONE_DIMENSIONAL_CONFIDENCE_95_SCALE * unitScale).toFixed(6));
      return row;
    })
    .filter((row): row is string[] => row != null);
  if (stationEllipseRows.length > 0) {
    lines.push(coordMode === '3D' ? 'Station                 Semi-Major    Semi-Minor   Azimuth of       Elev' : 'Station                 Semi-Major    Semi-Minor   Azimuth of');
    lines.push(coordMode === '3D' ? '                            Axis          Axis     Major Axis' : '                            Axis          Axis     Major Axis');
    stationEllipseRows.forEach((row) => {
      const base = `${row[0].padEnd(20)} ${row[1].padStart(13)} ${row[2].padStart(13)} ${row[3].padStart(10)}`;
      lines.push(coordMode === '3D' ? `${base} ${row[4].padStart(14)}` : base);
    });
  } else {
    lines.push('(none)');
  }

  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Relative Error Ellipses' : 'Predicted Relative Error Ellipses'} (${linearUnit})`,
  );
  lines.push('                            Confidence Region = 95%');
  lines.push('');
  const relativeEllipseRows = relationshipRows
    .filter((row) => row.ellipse != null)
    .map((row) => {
      const avgCombined =
        res.stations[row.from] && res.stations[row.to]
          ? ((res.stations[row.from]?.combinedFactor ?? 1) + (res.stations[row.to]?.combinedFactor ?? 1)) / 2
          : 1;
      const ellipseLinearDisplayScale =
        usesClassicParityLayout && coordSystemMode === 'grid' && Number.isFinite(avgCombined) && avgCombined > 0
          ? 1 / avgCombined
          : 1;
      const semiMajor = (row.ellipse?.semiMajor ?? 0) * ellipseLinearDisplayScale;
      const semiMinor = (row.ellipse?.semiMinor ?? 0) * ellipseLinearDisplayScale;
      const semiMajor95Display = semiMajor * confidence95Scale * unitScale;
      const horizontalDistanceDisplay =
        Number.isFinite(Number(row.distance)) ? Number(row.distance) : Number.NaN;
      const rla2d =
        Number.isFinite(horizontalDistanceDisplay) && semiMajor95Display > 0
          ? `1:${(horizontalDistanceDisplay / semiMajor95Display).toLocaleString('en-US', {
              maximumFractionDigits: 0,
            })}`
          : '-';
      const ppm2d =
        Number.isFinite(horizontalDistanceDisplay) && horizontalDistanceDisplay > 0
          ? ((semiMajor95Display / horizontalDistanceDisplay) * 1_000_000).toFixed(2)
          : '-';
      const ellipseAzimuthCorrectionDeg =
        usesCompactGnssParityLayout &&
        ((res.stations[row.from]?.fixed === true && gpsDirectFixedLinkedStations.has(row.to)) ||
          (res.stations[row.to]?.fixed === true && gpsDirectFixedLinkedStations.has(row.from)))
          ? ((displayFactorsForStation(row.from, res.stations[row.from]).convergenceAngleRad +
              displayFactorsForStation(row.to, res.stations[row.to]).convergenceAngleRad) *
              RAD_TO_DEG) /
            2
          : 0;
      return [
        row.from,
        row.to,
        semiMajor95Display.toFixed(6),
        (semiMinor * confidence95Scale * unitScale).toFixed(6),
        formatEllipseAzDm(row.ellipse?.theta, semiMajor, semiMinor, ellipseAzimuthCorrectionDeg),
        row.sigmaH != null ? (row.sigmaH * ONE_DIMENSIONAL_CONFIDENCE_95_SCALE * unitScale).toFixed(6) : '-',
        rla2d,
        ppm2d,
      ];
    });
  if (relativeEllipseRows.length > 0) {
    const includeRelativeVertical = coordMode === '3D' && relativeEllipseRows.some((row) => row[5] !== '-');
    lines.push(
      includeRelativeVertical
        ? 'Stations                Semi-Major    Semi-Minor   Azimuth of     Vertical          RLA(2D)        PPM'
        : 'Stations                Semi-Major    Semi-Minor   Azimuth of          RLA(2D)        PPM',
    );
    lines.push(
      includeRelativeVertical
        ? 'From       To               Axis          Axis     Major Axis                            1:____'
        : 'From       To               Axis          Axis     Major Axis                            1:____',
    );
    relativeEllipseRows.forEach((row) => {
      const base = `${row[0].padEnd(10)} ${row[1].padEnd(9)} ${row[2].padStart(13)} ${row[3].padStart(13)} ${row[4].padStart(10)}`;
      lines.push(
        includeRelativeVertical
          ? `${base} ${row[5].padStart(14)} ${row[6].padStart(15)} ${row[7].padStart(10)}`
          : `${base} ${row[6].padStart(15)} ${row[7].padStart(10)}`,
      );
    });
  } else {
    lines.push('(none)');
  }

  if (positionalToleranceEnabled) {
    lines.push('');
    lines.push(`Positional Tolerance Checks (${linearUnit})`);
    lines.push(`    Tolerance = ${(positionalToleranceConstantMm / 1000 * unitScale).toFixed(6)} ${linearUnit} + ${positionalTolerancePpm.toFixed(3)} PPM`);
    lines.push(`    Confidence Region = ${positionalToleranceConfidencePercent.toFixed(2)}%`);
    lines.push('');
    if (positionalToleranceRows.length > 0) {
      lines.push('Stations                   Distance     Allowable    Check Value   Status');
      lines.push('From       To');
      positionalToleranceRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(9)} ${(row.distanceMeters * unitScale).toFixed(4).padStart(12)} ${(row.toleranceMeters * unitScale).toFixed(6).padStart(13)} ${(row.checkMeters * unitScale).toFixed(6).padStart(13)} ${row.passes ? 'PASS' : 'FAIL'}`,
        );
      });
    } else {
      lines.push('(none)');
    }
  }

  if (isPreanalysis && !useClassicPreanalysisListing && res.weakGeometryDiagnostics) {
    const flaggedStations = res.weakGeometryDiagnostics.stationCues.filter((cue) => cue.severity !== 'ok');
    const flaggedPairs = res.weakGeometryDiagnostics.relativeCues.filter((cue) => cue.severity !== 'ok');
    lines.push('');
    lines.push('Weak Geometry Cues');
    lines.push('');
    lines.push(
      `stationMedian=${(res.weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(6)} ${linearUnit}; pairMedian=${res.weakGeometryDiagnostics.relativeMedianDistance != null ? `${(res.weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(6)} ${linearUnit}` : '-'}`,
    );
    if (flaggedStations.length === 0 && flaggedPairs.length === 0) {
      lines.push('(none)');
    } else {
      flaggedStations.forEach((cue) => {
        lines.push(
          `  Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(cue.horizontalMetric * unitScale).toFixed(6)} ${linearUnit} ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
        );
      });
      flaggedPairs.forEach((cue) => {
        lines.push(
          `  Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${cue.distanceMetric != null ? `${(cue.distanceMetric * unitScale).toFixed(6)} ${linearUnit}` : '-'} ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
        );
      });
    }
  }
};

