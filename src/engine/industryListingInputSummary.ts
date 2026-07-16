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
import type { IndustryListingParseSettings } from './industryListingTypes';
import type { AdjustmentResult, GpsObservation, InputStationSnapshot, Observation } from '../types';

type GpsCovarianceDisplay = {
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
  corrXY: number;
  corrXZ: number;
  corrYZ: number;
};

type AppendIndustryListingInputSummaryOptions = {
  angleUnitToken: string;
  classicTraverseLegacyFactorByStation: Map<
    string,
    { combinedFactor: number }
  >;
  compareObsByInput: (_a: Observation, _b: Observation) => number;
  coordSystemMode: 'local' | 'grid';
  enteredInputStationSnapshots: InputStationSnapshot[];
  fixedStations: number;
  fixedUsedEnteredStationSnapshots: InputStationSnapshot[];
  freeStations: number;
  freeUsedEnteredStationSnapshots: InputStationSnapshot[];
  gpsInputCovarianceDisplay: (_obs: GpsObservation) => GpsCovarianceDisplay;
  gpsObservationRows: GpsObservation[];
  hasStationDescriptions: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  linearUnit: string;
  lines: string[];
  observationsForListing: Observation[];
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  partiallyFixedUsedEnteredStationSnapshots: InputStationSnapshot[];
  pushSettingRow: (_label: string, _value: string) => void;
  res: AdjustmentResult;
  stationDescription: (_stationId: string) => string;
  stationEntriesInputOrder: Array<[string, unknown]>;
  unitScale: number;
  unusedEnteredStationSnapshots: InputStationSnapshot[];
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
};

export type IndustryListingInputSummaryModel = {
  angleUnitToken: string;
  bearingCount: number;
  countByType: (_type: Observation['type']) => number;
  hasStationDescriptions: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  measuredDirectionCount: number;
};

const formatClassicCoord = (value: number): string =>
  (Math.round((value + Number.EPSILON) * 10000) / 10000).toFixed(4);

const appendCompactGnssInputSummary = ({
  enteredInputStationSnapshots,
  fixedUsedEnteredStationSnapshots,
  freeUsedEnteredStationSnapshots,
  gpsInputCovarianceDisplay,
  gpsObservationRows,
  linearUnit,
  lines,
  stationDescription,
  unitScale,
}: Pick<
  AppendIndustryListingInputSummaryOptions,
  | 'enteredInputStationSnapshots'
  | 'fixedUsedEnteredStationSnapshots'
  | 'freeUsedEnteredStationSnapshots'
  | 'gpsInputCovarianceDisplay'
  | 'gpsObservationRows'
  | 'linearUnit'
  | 'lines'
  | 'stationDescription'
  | 'unitScale'
>) => {
  lines.push(
    centerIndustryLine(
      `Number of Entered Stations (${linearUnit}) = ${enteredInputStationSnapshots.length}`,
    ),
  );
  lines.push('');
  const formatClassicStationSummaryRow = (station: InputStationSnapshot) => {
    const north = formatClassicCoord(station.y * unitScale).padStart(12);
    const east = formatClassicCoord(station.x * unitScale).padStart(18);
    const height = formatClassicCoord(station.h * unitScale).padStart(12);
    const description = stationDescription(station.stationId);
    return `${station.stationId.padEnd(20)}${north}${east}${height}${description ? `   ${description}` : ''}`.trimEnd();
  };
  lines.push('Fixed Stations              N                 E          Elev   Description');
  fixedUsedEnteredStationSnapshots.forEach((station) =>
    lines.push(formatClassicStationSummaryRow(station)),
  );
  lines.push('');
  lines.push('Free Stations               N                 E          Elev   Description');
  freeUsedEnteredStationSnapshots.forEach((station) =>
    lines.push(formatClassicStationSummaryRow(station)),
  );
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of GPS Vector Observations (${linearUnit}) = ${gpsObservationRows.length}`,
    ),
  );
  lines.push('');
  lines.push('From                           DeltaX        StdErrX       CorrelXY      HI');
  lines.push('To                             DeltaY        StdErrY       CorrelXZ      HT');
  lines.push('                               DeltaZ        StdErrZ       CorrelYZ');
  gpsObservationRows.forEach((obs) => {
    const display = gpsInputCovarianceDisplay(obs);
    const hi = ((obs.gpsAntennaHiM ?? 0) * unitScale).toFixed(3);
    const ht = ((obs.gpsAntennaHtM ?? 0) * unitScale).toFixed(3);
    lines.push('');
    lines.push(`(${(obs.gpsVectorLabel ?? `${obs.from}-${obs.to}`).trim()})`);
    lines.push(
      `${obs.from.padEnd(20)}${(obs.obs.dE * unitScale).toFixed(4).padStart(12)}${(display.sigmaX * unitScale).toFixed(4).padStart(15)}${display.corrXY.toFixed(4).padStart(15)}${hi.padStart(8)}`,
    );
    lines.push(
      `${obs.to.padEnd(20)}${(obs.obs.dN * unitScale).toFixed(4).padStart(12)}${(display.sigmaY * unitScale).toFixed(4).padStart(15)}${display.corrXZ.toFixed(4).padStart(15)}${ht.padStart(8)}`,
    );
    lines.push(
      `${''.padEnd(20)}${((obs.obs.dU ?? 0) * unitScale).toFixed(4).padStart(12)}${(display.sigmaZ * unitScale).toFixed(4).padStart(15)}${display.corrYZ.toFixed(4).padStart(15)}`,
    );
  });
};

const appendClassicInputSummary = ({
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

const appendStandardInputSummary = ({
  angleUnitToken,
  bearingCount,
  coordSystemMode,
  countByType,
  fixedStations,
  freeStations,
  gpsInputCovarianceDisplay,
  gpsObservationRows,
  hasTraverseStyleAngularFamilies,
  linearUnit,
  lines,
  measuredDirectionCount,
  pushSettingRow,
  stationEntriesInputOrder,
  unitScale,
}: Pick<
  AppendIndustryListingInputSummaryOptions,
  | 'angleUnitToken'
  | 'coordSystemMode'
  | 'fixedStations'
  | 'freeStations'
  | 'gpsInputCovarianceDisplay'
  | 'gpsObservationRows'
  | 'hasTraverseStyleAngularFamilies'
  | 'linearUnit'
  | 'lines'
  | 'pushSettingRow'
  | 'stationEntriesInputOrder'
  | 'unitScale'
> & {
  bearingCount: number;
  countByType: (_type: Observation['type']) => number;
  measuredDirectionCount: number;
}) => {
  pushSettingRow(`Number of Entered Stations (${linearUnit})`, `${stationEntriesInputOrder.length}`);
  pushSettingRow('Fixed Stations', `${fixedStations}`);
  pushSettingRow('Free Stations', `${freeStations}`);
  lines.push('');
  pushSettingRow(`Number of Angle Observations (${angleUnitToken})`, `${countByType('angle')}`);
  pushSettingRow(`Number of Distance Observations (${linearUnit})`, `${countByType('dist')}`);
  pushSettingRow(
    `${hasTraverseStyleAngularFamilies ? 'Number of Measured Direction Observations' : 'Number of Direction Observations'} (${angleUnitToken})`,
    `${measuredDirectionCount}`,
  );
  if (bearingCount > 0) {
    const bearingLabel =
      coordSystemMode === 'grid'
        ? `Number of Grid Azimuth/Bearing Observations (${angleUnitToken})`
        : `Number of Azimuth/Bearing Observations (${angleUnitToken})`;
    pushSettingRow(bearingLabel, `${bearingCount}`);
  }
  if (gpsObservationRows.length === 0) return;
  lines.push('');
  lines.push(`Number of GPS Vector Observations (${linearUnit}) = ${gpsObservationRows.length}`);
  lines.push('');
  lines.push('From                           DeltaX        StdErrX       CorrelXY      HI');
  lines.push('To                             DeltaY        StdErrY       CorrelXZ      HT');
  lines.push('                               DeltaZ        StdErrZ       CorrelYZ');
  gpsObservationRows.forEach((obs) => {
    const display = gpsInputCovarianceDisplay(obs);
    const hi = ((obs.gpsAntennaHiM ?? 0) * unitScale).toFixed(3);
    const ht = ((obs.gpsAntennaHtM ?? 0) * unitScale).toFixed(3);
    lines.push('');
    lines.push(`(${(obs.gpsVectorLabel ?? `${obs.from}-${obs.to}`).trim()})`);
    lines.push(
      `${obs.from.padEnd(28)}${(obs.obs.dE * unitScale).toFixed(4).padStart(12)}${(display.sigmaX * unitScale).toFixed(4).padStart(15)}${display.corrXY.toFixed(4).padStart(15)}${hi.padStart(8)}`,
    );
    lines.push(
      `${obs.to.padEnd(28)}${(obs.obs.dN * unitScale).toFixed(4).padStart(12)}${(display.sigmaY * unitScale).toFixed(4).padStart(15)}${display.corrXZ.toFixed(4).padStart(15)}${ht.padStart(8)}`,
    );
    if (!Number.isFinite(obs.obs.dU ?? Number.NaN)) return;
    lines.push(
      `${''.padEnd(28)}${((obs.obs.dU as number) * unitScale).toFixed(4).padStart(12)}${(display.sigmaZ * unitScale).toFixed(4).padStart(15)}${display.corrYZ.toFixed(4).padStart(15)}`,
    );
  });
};

export const appendIndustryListingInputSummary = (
  options: AppendIndustryListingInputSummaryOptions,
): IndustryListingInputSummaryModel => {
  const countByType = (type: Observation['type']) =>
    options.observationsForListing.filter((obs) => obs.type === type).length;
  const measuredDirectionCount = countByType('direction') + countByType('dir');
  const bearingCount = countByType('bearing');

  if (options.usesCompactGnssParityLayout) {
    appendCompactGnssInputSummary({
      ...options,
      gpsObservationRows: [...options.gpsObservationRows].sort(options.compareObsByInput),
    });
  } else if (options.usesClassicParityLayout) {
    appendClassicInputSummary({
      ...options,
      bearingCount,
      countByType,
      measuredDirectionCount,
    });
  } else {
    appendStandardInputSummary({
      ...options,
      bearingCount,
      countByType,
      gpsObservationRows: [...options.gpsObservationRows].sort(options.compareObsByInput),
      measuredDirectionCount,
    });
  }

  return {
    angleUnitToken: options.angleUnitToken,
    bearingCount,
    countByType,
    hasStationDescriptions: options.hasStationDescriptions,
    hasTraverseStyleAngularFamilies: options.hasTraverseStyleAngularFamilies,
    measuredDirectionCount,
  };
};
