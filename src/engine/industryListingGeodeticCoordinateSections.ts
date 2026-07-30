import { RAD_TO_DEG } from './angles';
import {
  centerIndustryLine,
  formatClassicTraverseConvergenceAngle,
  formatSignedDmsMicros,
  formatSignedDmsMicrosCompact,
} from './industryListingFormatters';
import type { AppendAdjustedCoordinateSectionsOptions } from './industryListingCoordinateSections.types';
import type { Station } from '../types';

export const appendGeodeticPositionSummary = (options: AppendAdjustedCoordinateSectionsOptions) => {
  const {
    addCenteredHeading,
    averageGeoidHeight,
    classicTraverseLegacyFactorByStation,
    classicTraverseStationOrder,
    commonElevation,
    displayFactorsForStation,
    linearUnit,
    lines,
    parseState,
    renderTextTable,
    res,
    stationEntriesForListing,
    unitScale,
    usesClassicParityLayout,
    usesLegacyNbDisplayFactors,
  } = options;

  const longitudeSignMultiplier =
    (parseState?.lonSign ?? 'west-negative') === 'west-positive' ? -1 : 1;
  const geodeticRows = stationEntriesForListing.map(([id, st]) => {
    if (usesLegacyNbDisplayFactors && !usesClassicParityLayout) {
      return [
        id,
        formatSignedDmsMicrosCompact(st.latDeg),
        formatSignedDmsMicrosCompact(st.lonDeg, longitudeSignMultiplier),
        (st.h * unitScale).toFixed(4),
      ];
    }
    return [
      id,
      formatSignedDmsMicros(st.latDeg),
      formatSignedDmsMicros(st.lonDeg, longitudeSignMultiplier),
      (st.h * unitScale).toFixed(4),
      st.heightType === 'orthometric' ? 'ORTHO' : 'ELLIP',
    ];
  });
  lines.push('');
  addCenteredHeading(
    usesLegacyNbDisplayFactors && !usesClassicParityLayout
      ? `Adjusted Positions and Ellipsoid Heights (${linearUnit})`
      : 'Geodetic Position Summary',
  );
  lines.push('');
  if (usesLegacyNbDisplayFactors && !usesClassicParityLayout) {
    lines.push(`(Average Geoid Height = ${(averageGeoidHeight * unitScale).toFixed(3)} ${linearUnit})`);
    lines.push('');
    renderTextTable(['Station', 'Latitude', 'Longitude', 'Ellip Ht'], geodeticRows, [3]);
  } else {
    renderTextTable(
      ['Station', 'Latitude (DMS)', 'Longitude (DMS)', `Height (${linearUnit})`, 'HeightType'],
      geodeticRows,
      [3],
    );
  }

  if (usesClassicParityLayout) {
    appendClassicFactorSummary({
      classicTraverseLegacyFactorByStation,
      classicTraverseStationOrder,
      commonElevation,
      lines,
      res,
      unitScale,
    });
  } else if (usesLegacyNbDisplayFactors) {
    appendLegacyNbFactorSummary({
      addCenteredHeading,
      averageGeoidHeight,
      displayFactorsForStation,
      lines,
      stationEntriesForListing,
      unitScale,
    });
  } else {
    appendGenericFactorDiagnostics({ addCenteredHeading, lines, renderTextTable, stationEntriesForListing });
  }
};

const appendClassicFactorSummary = ({
  classicTraverseLegacyFactorByStation,
  classicTraverseStationOrder,
  commonElevation,
  lines,
  res,
  unitScale,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  | 'classicTraverseLegacyFactorByStation'
  | 'classicTraverseStationOrder'
  | 'commonElevation'
  | 'lines'
  | 'res'
  | 'unitScale'
>) => {
  const classicTraverseFactorEntries = classicTraverseStationOrder
    .map((stationId) => {
      const station = res.stations[stationId];
      if (!station) return null;
      const displayFactors = classicTraverseLegacyFactorByStation.get(stationId);
      return [
        stationId,
        displayFactors
          ? {
              ...station,
              convergenceAngleRad: displayFactors.convergenceAngleRad,
              gridScaleFactor: displayFactors.gridScaleFactor,
              elevationFactor: displayFactors.elevationFactor,
              combinedFactor: displayFactors.combinedFactor,
            }
          : station,
      ] as const;
    })
    .filter((entry): entry is [string, Station] => entry != null);
  lines.push('');
  lines.push(centerIndustryLine('Convergence Angles (DMS) and Grid Factors at Stations'));
  lines.push(centerIndustryLine('(Grid Azimuth = Geodetic Azimuth - Convergence)'));
  lines.push(
    centerIndustryLine(
      `(Elevation Factor Includes a ${(commonElevation * unitScale).toFixed(2)} Meter Geoid Height Correction)`,
    ),
  );
  lines.push('');
  lines.push('                    Convergence            ------- Factors -------');
  lines.push('Station                Angle            Scale  x  Elevation  =   Combined');
  classicTraverseFactorEntries.forEach(([id, st]) => {
    lines.push(
      `${id.padEnd(20)}${formatClassicTraverseConvergenceAngle(st.convergenceAngleRad).padStart(12)}${(st.gridScaleFactor ?? 1).toFixed(8).padStart(14)}${(st.elevationFactor ?? 1).toFixed(8).padStart(14)}${(st.combinedFactor ?? 1).toFixed(8).padStart(14)}`,
    );
  });
  if (classicTraverseFactorEntries.length === 0) return;
  const avgConvergence =
    classicTraverseFactorEntries.reduce((sum, [, st]) => sum + (st.convergenceAngleRad ?? 0), 0) /
    classicTraverseFactorEntries.length;
  const avgGridScale =
    classicTraverseFactorEntries.reduce((sum, [, st]) => sum + (st.gridScaleFactor ?? 1), 0) /
    classicTraverseFactorEntries.length;
  const avgElevation =
    classicTraverseFactorEntries.reduce((sum, [, st]) => sum + (st.elevationFactor ?? 1), 0) /
    classicTraverseFactorEntries.length;
  const avgCombined =
    classicTraverseFactorEntries.reduce((sum, [, st]) => sum + (st.combinedFactor ?? 1), 0) /
    classicTraverseFactorEntries.length;
  lines.push(
    `${'Project Averages:'.padEnd(20)}${formatClassicTraverseConvergenceAngle(avgConvergence).padStart(12)}${avgGridScale.toFixed(8).padStart(14)}${avgElevation.toFixed(8).padStart(14)}${avgCombined.toFixed(8).padStart(14)}`,
  );
};

const appendLegacyNbFactorSummary = ({
  addCenteredHeading,
  averageGeoidHeight,
  displayFactorsForStation,
  lines,
  stationEntriesForListing,
  unitScale,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  | 'addCenteredHeading'
  | 'averageGeoidHeight'
  | 'displayFactorsForStation'
  | 'lines'
  | 'stationEntriesForListing'
  | 'unitScale'
>) => {
  const factorEntries = stationEntriesForListing.map(([id, station]) => [
    id,
    displayFactorsForStation(id, station),
  ] as const);
  const avgConvergence =
    factorEntries.reduce((sum, [, station]) => sum + station.convergenceAngleRad, 0) /
    Math.max(1, factorEntries.length);
  const avgGridScale =
    factorEntries.reduce((sum, [, station]) => sum + station.gridScaleFactor, 0) /
    Math.max(1, factorEntries.length);
  const avgElevation =
    factorEntries.reduce((sum, [, station]) => sum + station.elevationFactor, 0) /
    Math.max(1, factorEntries.length);
  const avgCombined =
    factorEntries.reduce((sum, [, station]) => sum + station.combinedFactor, 0) /
    Math.max(1, factorEntries.length);
  lines.push('');
  addCenteredHeading('Convergence Angles (DMS) and Grid Factors at Stations');
  lines.push('(Grid Azimuth = Geodetic Azimuth - Convergence)');
  lines.push(
    `(Elevation Factor Includes a ${(averageGeoidHeight * unitScale).toFixed(2)} Meter Geoid Height Correction)`,
  );
  lines.push('');
  lines.push('                    Convergence            ------- Factors -------');
  lines.push('Station                Angle            Scale  x  Elevation  =   Combined');
  factorEntries.forEach(([id, station]) => {
    lines.push(
      `${id.padEnd(20)}${formatClassicTraverseConvergenceAngle(station.convergenceAngleRad).padStart(12)}${station.gridScaleFactor.toFixed(8).padStart(14)}${station.elevationFactor.toFixed(8).padStart(14)}${station.combinedFactor.toFixed(8).padStart(14)}`,
    );
  });
  lines.push(
    `${'Project Averages:'.padEnd(20)}${formatClassicTraverseConvergenceAngle(avgConvergence).padStart(12)}${avgGridScale.toFixed(8).padStart(14)}${avgElevation.toFixed(8).padStart(14)}${avgCombined.toFixed(8).padStart(14)}`,
  );
};

const appendGenericFactorDiagnostics = ({
  addCenteredHeading,
  lines,
  renderTextTable,
  stationEntriesForListing,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  'addCenteredHeading' | 'lines' | 'renderTextTable' | 'stationEntriesForListing'
>) => {
  const factorRows = stationEntriesForListing.map(([id, st]) => [
    id,
    ((st.convergenceAngleRad ?? 0) * RAD_TO_DEG).toFixed(8),
    (st.gridScaleFactor ?? 1).toFixed(8),
    (st.elevationFactor ?? 1).toFixed(8),
    (st.combinedFactor ?? 1).toFixed(8),
    (st.factorComputationSource ?? 'projection-formula').toUpperCase(),
  ]);
  lines.push('');
  addCenteredHeading('Grid/Combined Factor Diagnostics');
  lines.push('');
  renderTextTable(
    ['Station', 'Convergence (deg)', 'GridScale', 'ElevFactor', 'CombinedFactor', 'Source'],
    factorRows,
    [1, 2, 3, 4],
  );
};
