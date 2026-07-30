import type { AdjustmentResult, Station } from '../types';
import { appendGeodeticPositionSummary } from './industryListingGeodeticCoordinateSections';
import type { AppendAdjustedCoordinateSectionsOptions } from './industryListingCoordinateSections.types';

const summarizeControlComponentStatus = (
  station: Station,
  coordMode: '2D' | '3D',
): string | null => {
  const parts: string[] = [];
  const pushPart = (label: string, mode?: Station['constraintModeX']) => {
    if (!mode || mode === 'approximate') return;
    parts.push(`${label}=${mode.toUpperCase()}`);
  };
  pushPart('N', station.constraintModeY);
  pushPart('E', station.constraintModeX);
  if (coordMode === '3D') {
    pushPart('H', station.constraintModeH);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};

const shouldShowControlComponentStatus = (station: Station, coordMode: '2D' | '3D'): boolean => {
  const componentModes = [station.constraintModeY, station.constraintModeX];
  if (coordMode === '3D') {
    componentModes.push(station.constraintModeH);
  }
  const explicitModes = componentModes.filter(
    (mode): mode is NonNullable<typeof mode> => mode != null && mode !== 'approximate',
  );
  if (explicitModes.length === 0) return false;
  const distinctModes = new Set(explicitModes);
  return distinctModes.size > 1 || explicitModes.some((mode) => mode === 'weighted');
};

const appendClassicGridCoordinates = ({
  classicTraverseStationOrder,
  lines,
  res,
  stationDescription,
  stationEntriesForListing,
  unitScale,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  | 'classicTraverseStationOrder'
  | 'lines'
  | 'res'
  | 'stationDescription'
  | 'stationEntriesForListing'
  | 'unitScale'
>) => {
  lines.push('Station                   N              E          Elev   Description');
  const classicCoordinateStationEntries =
    classicTraverseStationOrder.length > 0
      ? classicTraverseStationOrder
          .map((stationId) => [stationId, res.stations[stationId]] as const)
          .filter((entry): entry is [string, Station] => entry[1] != null)
      : stationEntriesForListing;
  classicCoordinateStationEntries.forEach(([id, st]) => {
    const northing = (st.y * unitScale).toFixed(4);
    const easting = (st.x * unitScale).toFixed(4);
    const elevation = (st.h * unitScale).toFixed(4);
    const description = stationDescription(id);
    lines.push(
      `${id.padEnd(18)}${northing.padStart(15)}${easting.padStart(15)}${elevation.padStart(12)}${description ? `   ${description}` : ''}`,
    );
  });
};

const appendCoordinateRows = ({
  hasStationDescriptions,
  isGnssOnlyListing,
  lines,
  parseSettings,
  parseState,
  renderTextTable,
  stationDescription,
  stationEntriesForListing,
  unitScale,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  | 'hasStationDescriptions'
  | 'isGnssOnlyListing'
  | 'lines'
  | 'parseSettings'
  | 'parseState'
  | 'renderTextTable'
  | 'stationDescription'
  | 'stationEntriesForListing'
  | 'unitScale'
>) => {
  const coordMode = parseState?.coordMode ?? parseSettings.coordMode;
  if (isGnssOnlyListing && !hasStationDescriptions) {
    if (coordMode === '3D') {
      lines.push('Station                   N              E          Elev');
      stationEntriesForListing.forEach(([id, st]) => {
        lines.push(
          `${id.padEnd(18)}${(st.y * unitScale).toFixed(4).padStart(15)}${(st.x * unitScale).toFixed(4).padStart(15)}${(st.h * unitScale).toFixed(4).padStart(12)}`,
        );
      });
    } else {
      lines.push('Station                   N              E');
      stationEntriesForListing.forEach(([id, st]) => {
        lines.push(
          `${id.padEnd(18)}${(st.y * unitScale).toFixed(4).padStart(15)}${(st.x * unitScale).toFixed(4).padStart(15)}`,
        );
      });
    }
    return;
  }

  const coordRows = stationEntriesForListing.map(([id, st]) =>
    coordMode === '3D'
      ? [
          id,
          stationDescription(id) || '-',
          (st.y * unitScale).toFixed(4),
          (st.x * unitScale).toFixed(4),
          (st.h * unitScale).toFixed(4),
        ]
      : [id, stationDescription(id) || '-', (st.y * unitScale).toFixed(4), (st.x * unitScale).toFixed(4)],
  );
  renderTextTable(
    coordMode === '3D'
      ? ['Station', 'Description', 'N', 'E', 'Elev']
      : ['Station', 'Description', 'N', 'E'],
    coordRows,
    coordMode === '3D' ? [2, 3, 4] : [2, 3],
  );
};

const appendControlComponentStatus = ({
  addCenteredHeading,
  lines,
  parseSettings,
  parseState,
  renderTextTable,
  stationDescription,
  stationEntriesForListing,
}: Pick<
  AppendAdjustedCoordinateSectionsOptions,
  | 'addCenteredHeading'
  | 'lines'
  | 'parseSettings'
  | 'parseState'
  | 'renderTextTable'
  | 'stationDescription'
  | 'stationEntriesForListing'
>) => {
  const coordMode = parseState?.coordMode ?? parseSettings.coordMode;
  const anyMixedControlComponentStatus = stationEntriesForListing.some(([, st]) =>
    shouldShowControlComponentStatus(st, coordMode),
  );
  const controlStatusRows = anyMixedControlComponentStatus
    ? stationEntriesForListing
        .map(([id, st]) => [
          id,
          stationDescription(id) || '-',
          summarizeControlComponentStatus(st, coordMode),
        ] as const)
        .filter(([, , summary]) => summary != null)
        .map(([id, description, summary]) => [id, description, summary ?? '-'])
    : [];
  if (controlStatusRows.length === 0) return;
  lines.push('');
  addCenteredHeading('Control Component Status');
  lines.push('');
  renderTextTable(['Station', 'Description', 'Components'], controlStatusRows);
};

export const appendAdjustedCoordinateSections = (options: AppendAdjustedCoordinateSectionsOptions) => {
  const {
    addCenteredHeading,
    classicTraverseStationOrder,
    coordSystemMode,
    hasStationDescriptions,
    isGnssOnlyListing,
    linearUnit,
    lines,
    renderTextTable,
    settings,
    stationEntriesForListing,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
  } = options;

  if (!settings.listingShowCoordinates || useClassicPreanalysisListing) return;
  lines.push('');
  if (!usesClassicParityLayout) {
    addCenteredHeading('Adjusted Station Information');
    lines.push('');
  }
  addCenteredHeading(`Adjusted Coordinates (${linearUnit})`);
  lines.push('');
  if (usesClassicParityLayout && coordSystemMode === 'grid') {
    appendClassicGridCoordinates(options);
  } else {
    appendCoordinateRows({
      ...options,
      hasStationDescriptions,
      isGnssOnlyListing,
      renderTextTable,
      stationEntriesForListing,
    });
  }
  appendControlComponentStatus(options);

  if (coordSystemMode === 'grid') {
    appendGeodeticPositionSummary({ ...options, classicTraverseStationOrder });
  }
};
