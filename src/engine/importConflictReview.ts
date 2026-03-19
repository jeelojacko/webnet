import { parseInput } from './parse';
import type { ParseSettings } from '../appStateTypes';
import type { InstrumentLibrary, Observation, ParseOptions, ParseResult, StationMap } from '../types';
import type { ImportedControlStationRecord, ImportedDataset, ImportedObservationRecord } from './importers';

export type ImportConflictType =
  | 'station-id-collision'
  | 'coordinate-conflict'
  | 'description-conflict'
  | 'control-state-conflict'
  | 'duplicate-observation-family';

export type ImportResolution = 'keep-existing' | 'replace-with-incoming' | 'rename-incoming' | 'keep-both';

export type ImportConflictItemRef = {
  kind: 'control' | 'observation';
  index: number;
};

export interface ImportConflict {
  id: string;
  type: ImportConflictType;
  title: string;
  targetLabel: string;
  existingSummary: string;
  incomingSummary: string;
  sourceLine?: number;
  relatedItems: ImportConflictItemRef[];
}

interface BuildImportConflictSummaryArgs {
  currentInput: string;
  currentIncludeFiles: Record<string, string>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  importedDataset: ImportedDataset;
}

const STATION_COORD_TOLERANCE_M = 1e-4;
const HEIGHT_TOLERANCE_M = 1e-4;
const ANGLE_COORD_TOLERANCE_DEG = 1e-9;

const normalizeId = (value: string | undefined): string => value?.trim().toUpperCase() ?? '';

const normalizeDescription = (value: string | undefined): string =>
  value?.trim().replace(/\s+/g, ' ').toUpperCase() ?? '';

const formatMeters = (value: number | undefined): string => (value == null ? '-' : value.toFixed(4));

const formatDegrees = (value: number | undefined): string => (value == null ? '-' : value.toFixed(9));

const hasMeaningfulDifference = (
  left: number | undefined,
  right: number | undefined,
  tolerance: number,
): boolean => {
  if (left == null || right == null) return false;
  return Math.abs(left - right) > tolerance;
};

const inferExistingControlState = (
  station: StationMap[string] | undefined,
  coordMode: ParseSettings['coordMode'],
): 'fixed' | 'weighted' | 'approximate' => {
  if (!station) return 'approximate';
  const fixed = [station.fixedX, station.fixedY, coordMode === '3D' ? station.fixedH : false].some(Boolean);
  if (fixed) return 'fixed';
  const weighted = [
    station.constraintModeX === 'weighted',
    station.constraintModeY === 'weighted',
    coordMode === '3D' ? station.constraintModeH === 'weighted' : false,
  ].some(Boolean);
  if (weighted) return 'weighted';
  return 'approximate';
};

const inferImportedControlState = (
  station: ImportedControlStationRecord,
  coordMode: ParseSettings['coordMode'],
): 'fixed' | 'weighted' | 'approximate' => {
  const sigmaValues =
    station.coordinateMode === 'geodetic'
      ? [station.sigmaNorthM, station.sigmaEastM, coordMode === '3D' ? station.sigmaHeightM : undefined]
      : [station.sigmaEastM, station.sigmaNorthM, coordMode === '3D' ? station.sigmaHeightM : undefined];
  return sigmaValues.some((value) => (value ?? 0) > 0) ? 'weighted' : 'approximate';
};

const buildParseOptions = (
  parseSettings: ParseSettings,
  currentIncludeFiles: Record<string, string>,
): Partial<ParseOptions> => ({
  ...(parseSettings as unknown as Partial<ParseOptions>),
  includeFiles: currentIncludeFiles,
});

const parseExistingInput = ({
  currentInput,
  currentIncludeFiles,
  parseSettings,
  projectInstruments,
}: Omit<BuildImportConflictSummaryArgs, 'importedDataset'>): ParseResult | null => {
  if (!currentInput.trim()) return null;
  try {
    return parseInput(
      currentInput,
      projectInstruments,
      buildParseOptions(parseSettings, currentIncludeFiles),
    );
  } catch {
    return null;
  }
};

const buildImportedObservationConflictKey = (observation: ImportedObservationRecord): string => {
  switch (observation.kind) {
    case 'measurement':
      return `M|${normalizeId(observation.atId)}|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'angle':
      return `A|${normalizeId(observation.atId)}|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'distance':
      return `D|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'distance-vertical':
      return `DV|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'vertical':
      return `${observation.verticalMode === 'delta-h' ? 'L' : 'V'}|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'bearing':
      return `B|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
    case 'gnss-vector':
      return `G|${normalizeId(observation.fromId)}|${normalizeId(observation.toId)}`;
  }
};

const buildExistingObservationConflictKey = (observation: Observation): string | null => {
  switch (observation.type) {
    case 'dist':
      return `D|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    case 'angle':
      return `A|${normalizeId(observation.at)}|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    case 'bearing':
    case 'dir':
      return `B|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    case 'gps':
      return `G|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    case 'lev':
      return `L|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    case 'zenith':
      return `V|${normalizeId(observation.from)}|${normalizeId(observation.to)}`;
    default:
      return null;
  }
};

const formatExistingStationSummary = (
  stationId: string,
  station: StationMap[string],
  description: string | undefined,
): string => {
  const parts = [
    `ID ${stationId}`,
    `E=${formatMeters(station.x)}`,
    `N=${formatMeters(station.y)}`,
  ];
  if (station.h != null) parts.push(`H=${formatMeters(station.h)}`);
  if (description) parts.push(`Desc="${description}"`);
  return parts.join('; ');
};

const formatIncomingStationSummary = (station: ImportedControlStationRecord): string => {
  if (station.coordinateMode === 'geodetic') {
    const parts = [
      `ID ${station.stationId}`,
      `Lat=${formatDegrees(station.latitudeDeg)}`,
      `Lon=${formatDegrees(station.longitudeDeg)}`,
    ];
    if (station.heightM != null) parts.push(`H=${formatMeters(station.heightM)}`);
    if (station.description) parts.push(`Desc="${station.description}"`);
    return parts.join('; ');
  }
  const parts = [
    `ID ${station.stationId}`,
    `E=${formatMeters(station.eastM)}`,
    `N=${formatMeters(station.northM)}`,
  ];
  if (station.heightM != null) parts.push(`H=${formatMeters(station.heightM)}`);
  if (station.description) parts.push(`Desc="${station.description}"`);
  return parts.join('; ');
};

const formatImportedObservationSummary = (observation: ImportedObservationRecord): string => {
  switch (observation.kind) {
    case 'measurement':
      return `M ${observation.atId}-${observation.fromId}-${observation.toId}`;
    case 'angle':
      return `A ${observation.atId}-${observation.fromId}-${observation.toId}`;
    case 'distance':
      return `D ${observation.fromId}-${observation.toId}`;
    case 'distance-vertical':
      return `DV ${observation.fromId}-${observation.toId}`;
    case 'vertical':
      return `${observation.verticalMode === 'delta-h' ? 'L' : 'V'} ${observation.fromId}-${observation.toId}`;
    case 'bearing':
      return `B ${observation.fromId}-${observation.toId}`;
    case 'gnss-vector':
      return `G ${observation.fromId}-${observation.toId}`;
    default:
      return 'Observation';
  }
};

const buildExistingObservationCounts = (parsed: ParseResult | null): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!parsed) return counts;
  parsed.observations.forEach((observation) => {
    const key = buildExistingObservationConflictKey(observation);
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

const buildExistingDescriptionMap = (parsed: ParseResult | null): Record<string, string> =>
  parsed?.parseState.reconciledDescriptions ?? {};

export const buildImportConflictSummary = ({
  currentInput,
  currentIncludeFiles,
  parseSettings,
  projectInstruments,
  importedDataset,
}: BuildImportConflictSummaryArgs): ImportConflict[] => {
  const parsed = parseExistingInput({
    currentInput,
    currentIncludeFiles,
    parseSettings,
    projectInstruments,
  });
  if (!parsed) return [];

  const conflicts: ImportConflict[] = [];
  const existingDescriptions = buildExistingDescriptionMap(parsed);
  const existingObservationCounts = buildExistingObservationCounts(parsed);

  importedDataset.controlStations.forEach((station, index) => {
    const stationId = normalizeId(station.stationId);
    const existingStation = parsed.stations[station.stationId] ?? parsed.stations[stationId];
    if (!existingStation) return;

    const existingDescription =
      existingDescriptions[station.stationId] ?? existingDescriptions[stationId] ?? undefined;

    conflicts.push({
      id: `station-id-collision:${stationId}:${index}`,
      type: 'station-id-collision',
      title: 'Station ID already exists in editor',
      targetLabel: station.stationId,
      existingSummary: formatExistingStationSummary(station.stationId, existingStation, existingDescription),
      incomingSummary: formatIncomingStationSummary(station),
      sourceLine: station.sourceLine,
      relatedItems: [{ kind: 'control', index }],
    });

    const hasCoordinateConflict =
      station.coordinateMode === 'geodetic'
        ? hasMeaningfulDifference(existingStation.latDeg, station.latitudeDeg, ANGLE_COORD_TOLERANCE_DEG) ||
          hasMeaningfulDifference(existingStation.lonDeg, station.longitudeDeg, ANGLE_COORD_TOLERANCE_DEG) ||
          hasMeaningfulDifference(existingStation.h, station.heightM, HEIGHT_TOLERANCE_M)
        : hasMeaningfulDifference(existingStation.x, station.eastM, STATION_COORD_TOLERANCE_M) ||
          hasMeaningfulDifference(existingStation.y, station.northM, STATION_COORD_TOLERANCE_M) ||
          hasMeaningfulDifference(existingStation.h, station.heightM, HEIGHT_TOLERANCE_M);

    if (hasCoordinateConflict) {
      conflicts.push({
        id: `coordinate-conflict:${stationId}:${index}`,
        type: 'coordinate-conflict',
        title: 'Coordinate values differ for the same station',
        targetLabel: station.stationId,
        existingSummary: formatExistingStationSummary(station.stationId, existingStation, existingDescription),
        incomingSummary: formatIncomingStationSummary(station),
        sourceLine: station.sourceLine,
        relatedItems: [{ kind: 'control', index }],
      });
    }

    if (
      existingDescription &&
      station.description &&
      normalizeDescription(existingDescription) !== normalizeDescription(station.description)
    ) {
      conflicts.push({
        id: `description-conflict:${stationId}:${index}`,
        type: 'description-conflict',
        title: 'Description text differs for the same station',
        targetLabel: station.stationId,
        existingSummary: existingDescription,
        incomingSummary: station.description,
        sourceLine: station.sourceLine,
        relatedItems: [{ kind: 'control', index }],
      });
    }

    const existingControlState = inferExistingControlState(existingStation, parseSettings.coordMode);
    const incomingControlState = inferImportedControlState(station, parseSettings.coordMode);
    if (existingControlState !== incomingControlState) {
      conflicts.push({
        id: `control-state-conflict:${stationId}:${index}`,
        type: 'control-state-conflict',
        title: 'Control weighting/fixity state differs for the same station',
        targetLabel: station.stationId,
        existingSummary: existingControlState,
        incomingSummary: incomingControlState,
        sourceLine: station.sourceLine,
        relatedItems: [{ kind: 'control', index }],
      });
    }
  });

  importedDataset.observations.forEach((observation, index) => {
    const key = buildImportedObservationConflictKey(observation);
    const existingCount = existingObservationCounts.get(key) ?? 0;
    if (existingCount <= 0) return;
    conflicts.push({
      id: `duplicate-observation-family:${key}:${index}`,
      type: 'duplicate-observation-family',
      title: 'Observation family already exists in editor for the same endpoints',
      targetLabel: key.split('|').slice(1).join(' -> '),
      existingSummary: `${existingCount} existing matching row${existingCount === 1 ? '' : 's'}`,
      incomingSummary: formatImportedObservationSummary(observation),
      sourceLine: observation.sourceLine,
      relatedItems: [{ kind: 'observation', index }],
    });
  });

  return conflicts;
};
