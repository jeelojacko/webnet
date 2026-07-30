import { centerIndustryLine } from './industryListingFormatters';
import { appendClassicInputSummary } from './industryListingClassicInputSummary';
import type {
  AppendIndustryListingInputSummaryOptions,
  IndustryListingInputSummaryModel,
} from './industryListingInputSummary.types';
import type { InputStationSnapshot, Observation } from '../types';

export type { IndustryListingInputSummaryModel } from './industryListingInputSummary.types';

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
