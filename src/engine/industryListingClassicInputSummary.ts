import { RAD_TO_DEG } from './angles';
import {
  centerIndustryLine,
  formatClassicTraverseArcSeconds,
  formatClassicTraverseCombinedFactor,
  formatClassicTraverseDirectionSigmaArcSec,
  formatClassicTraverseZenithSigmaArcSec,
  formatDmsHundredths,
  formatQuadrantBearing,
} from './industryListingFormatters';
import type { AppendIndustryListingInputSummaryOptions } from './industryListingInputSummary.types';
import type { InputStationSnapshot, Observation } from '../types';

const formatClassicCoord = (value: number): string =>
  (Math.round((value + Number.EPSILON) * 10000) / 10000).toFixed(4);

export const appendClassicInputSummary = ({
  angleUnitToken,
  bearingCount,
  classicTraverseLegacyFactorByStation,
  compareObsByInput,
  coordSystemMode,
  countByType,
  enteredInputStationSnapshots,
  fixedUsedEnteredStationSnapshots,
  freeUsedEnteredStationSnapshots,
  linearUnit,
  lines,
  measuredDirectionCount,
  observationsForListing,
  parseSettings,
  parseState,
  partiallyFixedUsedEnteredStationSnapshots,
  res,
  stationDescription,
  unitScale,
  unusedEnteredStationSnapshots,
  usesClassicParityLayout,
}: Pick<
  AppendIndustryListingInputSummaryOptions,
  | 'angleUnitToken'
  | 'classicTraverseLegacyFactorByStation'
  | 'compareObsByInput'
  | 'coordSystemMode'
  | 'enteredInputStationSnapshots'
  | 'fixedUsedEnteredStationSnapshots'
  | 'freeUsedEnteredStationSnapshots'
  | 'linearUnit'
  | 'lines'
  | 'observationsForListing'
  | 'parseSettings'
  | 'parseState'
  | 'partiallyFixedUsedEnteredStationSnapshots'
  | 'res'
  | 'stationDescription'
  | 'unitScale'
  | 'unusedEnteredStationSnapshots'
  | 'usesClassicParityLayout'
> & {
  bearingCount: number;
  countByType: (_type: Observation['type']) => number;
  measuredDirectionCount: number;
}) => {
  lines.push(
    centerIndustryLine(
      `Number of Entered Stations (${linearUnit}) = ${enteredInputStationSnapshots.length}`,
    ),
  );
  lines.push('');
  const classicOrder = parseState?.order ?? parseSettings.order;
  const formatClassicStationSummaryRow = (station: InputStationSnapshot) => {
    const first = formatClassicCoord((classicOrder === 'NE' ? station.y : station.x) * unitScale);
    const second = formatClassicCoord((classicOrder === 'NE' ? station.x : station.y) * unitScale);
    const height = formatClassicCoord(station.h * unitScale);
    const description = stationDescription(station.stationId);
    return `${station.stationId.padEnd(22)}${first}${second.padStart(17)}${height.padStart(12)}${description ? `   ${description}` : ''}`.trimEnd();
  };
  const formatClassicStationConstraintStdErrRow = (stationId: string) => {
    const station = res.stations[stationId];
    if (!station) return '';
    const firstSigma =
      classicOrder === 'NE'
        ? station.sy != null
          ? (station.sy * unitScale).toFixed(4)
          : station.constraintModeY === 'fixed'
            ? 'FIXED'
            : '-'
        : station.sx != null
          ? (station.sx * unitScale).toFixed(4)
          : station.constraintModeX === 'fixed'
            ? 'FIXED'
            : '-';
    const secondSigma =
      classicOrder === 'NE'
        ? station.sx != null
          ? (station.sx * unitScale).toFixed(4)
          : station.constraintModeX === 'fixed'
            ? 'FIXED'
            : '-'
        : station.sy != null
          ? (station.sy * unitScale).toFixed(4)
          : station.constraintModeY === 'fixed'
            ? 'FIXED'
            : '-';
    const heightSigma =
      station.sh != null
        ? (station.sh * unitScale).toFixed(4)
        : station.constraintModeH === 'fixed'
          ? 'FIXED'
          : '-';
    return `${''.padEnd(22)}${firstSigma.padStart(11)}${secondSigma.padStart(17)}${heightSigma.padStart(12)}`;
  };
  const firstCoordLabel = classicOrder === 'NE' ? 'N' : 'E';
  const secondCoordLabel = classicOrder === 'NE' ? 'E' : 'N';
  lines.push(
    `Fixed Stations              ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
  );
  fixedUsedEnteredStationSnapshots.forEach((station) =>
    lines.push(formatClassicStationSummaryRow(station)),
  );
  lines.push('');
  lines.push(
    `Partially Fixed             ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
  );
  lines.push(
    `${''.padEnd(22)}${'StdErr'.padStart(11)}${'StdErr'.padStart(17)}${'StdErr'.padStart(12)}`,
  );
  partiallyFixedUsedEnteredStationSnapshots.forEach((station) => {
    lines.push(formatClassicStationSummaryRow(station));
    lines.push(formatClassicStationConstraintStdErrRow(station.stationId));
  });
  lines.push('');
  lines.push(
    `Free Stations               ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
  );
  freeUsedEnteredStationSnapshots.forEach((station) =>
    lines.push(formatClassicStationSummaryRow(station)),
  );
  lines.push('');
  lines.push('Unused Stations');
  unusedEnteredStationSnapshots.forEach((station) => lines.push(station.stationId));
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Measured Distance Observations (${linearUnit}) = ${countByType('dist')}`,
    ),
  );
  lines.push('');
  lines.push('From       To            Distance   StdErr      HI      HT  Comb Grid  Type');
  [...observationsForListing]
    .filter((obs): obs is Observation & { type: 'dist' } => obs.type === 'dist')
    .sort(compareObsByInput)
    .forEach((obs) => {
      const from = res.stations[obs.from];
      const to = res.stations[obs.to];
      const combinedFactor =
        usesClassicParityLayout && coordSystemMode === 'grid'
          ? (() => {
              const fromDisplay = classicTraverseLegacyFactorByStation.get(obs.from);
              const toDisplay = classicTraverseLegacyFactorByStation.get(obs.to);
              if (fromDisplay && toDisplay) {
                return (fromDisplay.combinedFactor + toDisplay.combinedFactor) / 2;
              }
              return (
                parseState?.rawDistanceCombinedFactorByObsId?.[obs.id] ??
                (from && to ? ((from.combinedFactor ?? 1) + (to.combinedFactor ?? 1)) / 2 : 1)
              );
            })()
          : parseState?.rawDistanceCombinedFactorByObsId?.[obs.id] ??
            (from && to ? ((from.combinedFactor ?? 1) + (to.combinedFactor ?? 1)) / 2 : 1);
      const sigma = (obs.weightingStdDev ?? obs.stdDev) * unitScale;
      lines.push(
        `${obs.from.padEnd(11)}${obs.to.padEnd(12)}${(obs.obs * unitScale).toFixed(4).padStart(10)}${sigma.toFixed(4).padStart(9)}${((obs.hi ?? 0) * unitScale).toFixed(3).padStart(8)}${((obs.ht ?? 0) * unitScale).toFixed(3).padStart(8)}${formatClassicTraverseCombinedFactor(combinedFactor).padStart(11)}   ${(obs.mode ?? 'slope') === 'horiz' ? 'H' : 'S'}`,
      );
    });
  lines.push('');
  lines.push(
    centerIndustryLine(`Number of Zenith Observations (${angleUnitToken}) = ${countByType('zenith')}`),
  );
  lines.push('');
  lines.push('From       To              Zenith      StdErr      HI      HT');
  [...observationsForListing]
    .filter((obs): obs is Observation & { type: 'zenith' } => obs.type === 'zenith')
    .sort(compareObsByInput)
    .forEach((obs) => {
      const sigmaArcSec = (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600;
      lines.push(
        `${obs.from.padEnd(11)}${obs.to.padEnd(11)}${formatDmsHundredths(obs.obs).padStart(13)}${formatClassicTraverseZenithSigmaArcSec(sigmaArcSec).padStart(10)}${((obs.hi ?? 0) * unitScale).toFixed(3).padStart(8)}${((obs.ht ?? 0) * unitScale).toFixed(3).padStart(8)}`,
      );
    });
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Measured Direction Observations (${angleUnitToken}) = ${measuredDirectionCount}`,
    ),
  );
  lines.push('');
  lines.push('From       To            Direction      StdErr     t-T');
  const groupedDirections = new Map<string, Array<Observation & { type: 'direction' }>>();
  [...observationsForListing]
    .filter((obs): obs is Observation & { type: 'direction' } => obs.type === 'direction')
    .sort(compareObsByInput)
    .forEach((obs) => {
      const key = String(obs.setId ?? 'UNKNOWN');
      const group = groupedDirections.get(key) ?? [];
      group.push(obs);
      groupedDirections.set(key, group);
    });
  let rawDirectionSetNumber = 1;
  groupedDirections.forEach((group) => {
    lines.push('');
    lines.push(`Set ${rawDirectionSetNumber}`);
    rawDirectionSetNumber += 1;
    group.forEach((obs) => {
      const sigmaArcSec = (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600;
      const ttArcSec =
        (parseState?.rawDirectionSetCorrectionByObsId?.[obs.id] ?? 0) * RAD_TO_DEG * 3600;
      lines.push(
        `${obs.at.padEnd(11)}${obs.to.padEnd(10)}${formatDmsHundredths(obs.obs).padStart(14)}${formatClassicTraverseDirectionSigmaArcSec(sigmaArcSec).padStart(11)}${formatClassicTraverseArcSeconds(ttArcSec).padStart(8)}`,
      );
    });
  });
  if (bearingCount <= 0) return;
  lines.push('');
  lines.push(
    centerIndustryLine(
      `${
        coordSystemMode === 'grid'
          ? 'Number of Grid Azimuth/Bearing Observations'
          : 'Number of Azimuth/Bearing Observations'
      } (${angleUnitToken}) = ${bearingCount}`,
    ),
  );
  lines.push('');
  lines.push('From       To            Bearing       StdErr');
  [...observationsForListing]
    .filter((obs): obs is Observation & { type: 'bearing' } => obs.type === 'bearing')
    .sort(compareObsByInput)
    .forEach((obs) => {
      const stdErr =
        obs.sigmaSource === 'fixed'
          ? 'FIXED'
          : ((obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600).toFixed(2);
      lines.push(
        `${obs.from.padEnd(11)}${obs.to.padEnd(11)}${formatQuadrantBearing(obs.obs).padStart(13)}${stdErr.padStart(10)}`,
      );
    });
};
