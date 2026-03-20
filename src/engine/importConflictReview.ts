import { parseInput } from './parse';
import {
  buildImportReviewText,
  type ImportReviewModel,
  type ImportReviewOutputPreset,
  type ImportReviewRowTypeOverride,
} from './importReview';
import type { ParseSettings } from '../appStateTypes';
import type { InstrumentLibrary, Observation, ParseOptions, ParseResult, StationMap } from '../types';
import type {
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedDistanceObservationRecord,
  ImportedObservationRecord,
} from './importers';

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
  resolutionKey: string;
  title: string;
  targetLabel: string;
  existingSummary: string;
  incomingSummary: string;
  incomingSourceName?: string;
  sourceLine?: number;
  existingSourceLines?: number[];
  relatedItems: ImportConflictItemRef[];
}

export interface BuildResolvedImportTextArgs {
  currentInput: string;
  currentIncludeFiles: Record<string, string>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  importedDataset: ImportedDataset;
  reviewModel: ImportReviewModel;
  includedItemIds: Set<string>;
  groupComments?: Record<string, string>;
  rowOverrides?: Record<string, string>;
  rowTypeOverrides?: Record<string, ImportReviewRowTypeOverride>;
  fixedItemIds?: Set<string>;
  preset?: ImportReviewOutputPreset;
  faceNormalizationMode?: ParseSettings['faceNormalizationMode'];
  coordMode: ParseSettings['coordMode'];
  force2D: boolean;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
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

const CONTROL_RECORD_CODES = new Set(['C', 'P', 'PH', 'CH', 'EH', 'E']);

const buildCurrentInputLines = (input: string): string[] => input.split(/\r?\n/);

const findExistingControlSourceLines = (input: string, stationId: string): number[] =>
  buildCurrentInputLines(input)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      const code = trimmed.split(/\s+/)[0]?.toUpperCase();
      if (!code || !CONTROL_RECORD_CODES.has(code)) return false;
      const tokens = trimmed.split(/\s+/);
      return normalizeId(tokens[1]) === normalizeId(stationId);
    })
    .map(({ lineNumber }) => lineNumber);

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
    default:
      return 'OBS';
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
      resolutionKey: `control:${index}`,
      title: 'Station ID already exists in editor',
      targetLabel: station.stationId,
      existingSummary: formatExistingStationSummary(station.stationId, existingStation, existingDescription),
      incomingSummary: formatIncomingStationSummary(station),
      incomingSourceName: station.importSourceName,
      sourceLine: station.sourceLine,
      existingSourceLines: findExistingControlSourceLines(currentInput, station.stationId),
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
        resolutionKey: `control:${index}`,
        title: 'Coordinate values differ for the same station',
        targetLabel: station.stationId,
        existingSummary: formatExistingStationSummary(station.stationId, existingStation, existingDescription),
        incomingSummary: formatIncomingStationSummary(station),
        incomingSourceName: station.importSourceName,
        sourceLine: station.sourceLine,
        existingSourceLines: findExistingControlSourceLines(currentInput, station.stationId),
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
        resolutionKey: `control:${index}`,
        title: 'Description text differs for the same station',
        targetLabel: station.stationId,
        existingSummary: existingDescription,
        incomingSummary: station.description,
        incomingSourceName: station.importSourceName,
        sourceLine: station.sourceLine,
        existingSourceLines: findExistingControlSourceLines(currentInput, station.stationId),
        relatedItems: [{ kind: 'control', index }],
      });
    }

    const existingControlState = inferExistingControlState(existingStation, parseSettings.coordMode);
    const incomingControlState = inferImportedControlState(station, parseSettings.coordMode);
    if (existingControlState !== incomingControlState) {
      conflicts.push({
        id: `control-state-conflict:${stationId}:${index}`,
        type: 'control-state-conflict',
        resolutionKey: `control:${index}`,
        title: 'Control weighting/fixity state differs for the same station',
        targetLabel: station.stationId,
        existingSummary: existingControlState,
        incomingSummary: incomingControlState,
        incomingSourceName: station.importSourceName,
        sourceLine: station.sourceLine,
        existingSourceLines: findExistingControlSourceLines(currentInput, station.stationId),
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
      resolutionKey: `observation:${index}`,
      title: 'Observation family already exists in editor for the same endpoints',
      targetLabel: key.split('|').slice(1).join(' -> '),
      existingSummary: `${existingCount} existing matching row${existingCount === 1 ? '' : 's'}`,
      incomingSummary: formatImportedObservationSummary(observation),
      incomingSourceName: observation.importSourceName,
      sourceLine: observation.sourceLine,
      existingSourceLines: parsed.observations
        .filter((candidate) => buildExistingObservationConflictKey(candidate) === key)
        .map((candidate) => candidate.sourceLine)
        .filter((line): line is number => Number.isFinite(line)),
      relatedItems: [{ kind: 'observation', index }],
    });
  });

  return conflicts;
};

export const buildImportConflictResolutionDefaults = (
  conflicts: ImportConflict[],
): Record<string, ImportResolution> =>
  Object.fromEntries(
    [...new Set(conflicts.map((conflict) => conflict.resolutionKey))].map((key) => [key, 'keep-existing']),
  );

const remapStationId = (value: string | undefined, renameMap: Record<string, string>): string | undefined =>
  value == null ? value : renameMap[normalizeId(value)] ?? value;

const cloneRenamedDataset = (
  dataset: ImportedDataset,
  renameMap: Record<string, string>,
): ImportedDataset => ({
  ...dataset,
  controlStations: dataset.controlStations.map((station) => ({
    ...station,
    stationId: remapStationId(station.stationId, renameMap) ?? station.stationId,
  })),
  observations: dataset.observations.map((observation) => {
    switch (observation.kind) {
      case 'measurement':
        return {
          ...observation,
          atId: remapStationId(observation.atId, renameMap) ?? observation.atId,
          fromId: remapStationId(observation.fromId, renameMap) ?? observation.fromId,
          toId: remapStationId(observation.toId, renameMap) ?? observation.toId,
        };
      case 'angle':
        return {
          ...observation,
          atId: remapStationId(observation.atId, renameMap) ?? observation.atId,
          fromId: remapStationId(observation.fromId, renameMap) ?? observation.fromId,
          toId: remapStationId(observation.toId, renameMap) ?? observation.toId,
        };
      default:
        return {
          ...observation,
          fromId: remapStationId((observation as ImportedDistanceObservationRecord).fromId, renameMap) ??
            (observation as ImportedDistanceObservationRecord).fromId,
          toId: remapStationId((observation as ImportedDistanceObservationRecord).toId, renameMap) ??
            (observation as ImportedDistanceObservationRecord).toId,
        };
    }
  }),
});

const cloneRenamedReviewModel = (
  model: ImportReviewModel,
  renameMap: Record<string, string>,
): ImportReviewModel => ({
  ...model,
  groups: model.groups.map((group) => ({
    ...group,
    setupId: remapStationId(group.setupId, renameMap),
    backsightId: remapStationId(group.backsightId, renameMap),
  })),
  items: model.items.map((item) => ({
    ...item,
    setupId: remapStationId(item.setupId, renameMap),
    backsightId: remapStationId(item.backsightId, renameMap),
    targetId: remapStationId(item.targetId, renameMap),
    stationId: remapStationId(item.stationId, renameMap),
  })),
});

const buildRenamedObservationConflictKey = (
  observation: ImportedObservationRecord,
  renameMap: Record<string, string>,
): string => {
  const remappedDataset = cloneRenamedDataset(
    {
      importerId: 'synthetic',
      formatLabel: 'synthetic',
      summary: 'synthetic',
      notice: { title: 'synthetic', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [observation],
      trace: [],
    },
    renameMap,
  );
  return buildImportedObservationConflictKey(remappedDataset.observations[0]);
};

const buildKeepBothComment = (conflict: ImportConflict): string =>
  `# KEEP BOTH: imported ${conflict.title.toLowerCase()} for ${conflict.targetLabel}`;

export const buildResolvedImportText = ({
  currentInput,
  currentIncludeFiles,
  parseSettings,
  projectInstruments,
  importedDataset,
  reviewModel,
  includedItemIds,
  groupComments,
  rowOverrides,
  rowTypeOverrides,
  fixedItemIds,
  preset,
  faceNormalizationMode,
  coordMode,
  force2D,
  conflicts,
  conflictResolutions,
  conflictRenameValues,
}: BuildResolvedImportTextArgs): { text: string; missingRenameKeys: string[] } => {
  const conflictsByKey = new Map<string, ImportConflict[]>();
  conflicts.forEach((conflict) => {
    const bucket = conflictsByKey.get(conflict.resolutionKey) ?? [];
    bucket.push(conflict);
    conflictsByKey.set(conflict.resolutionKey, bucket);
  });

  const renameMap: Record<string, string> = {};
  const missingRenameKeys: string[] = [];
  Object.entries(conflictResolutions).forEach(([resolutionKey, resolution]) => {
    if (resolution !== 'rename-incoming' || !resolutionKey.startsWith('control:')) return;
    const index = Number.parseInt(resolutionKey.slice('control:'.length), 10);
    const sourceStation = importedDataset.controlStations[index];
    if (!sourceStation) return;
    const renameValue = conflictRenameValues[resolutionKey]?.trim();
    if (!renameValue) {
      missingRenameKeys.push(resolutionKey);
      return;
    }
    renameMap[normalizeId(sourceStation.stationId)] = renameValue;
  });

  const renamedDataset = cloneRenamedDataset(importedDataset, renameMap);
  const renamedReviewModel = cloneRenamedReviewModel(reviewModel, renameMap);
  const currentObservationCounts = buildExistingObservationCounts(
    parseExistingInput({
      currentInput,
      currentIncludeFiles,
      parseSettings,
      projectInstruments,
    }),
  );

  const nextIncludedItemIds = new Set(includedItemIds);
  const removeExistingSourceLines = new Set<number>();
  const itemCommentLines: Record<string, string[]> = {};

  renamedReviewModel.items.forEach((item) => {
    const resolutionKey = `${item.kind}:${item.index}`;
    const itemConflicts = conflictsByKey.get(resolutionKey) ?? [];
    if (itemConflicts.length === 0) return;
    const resolution = conflictResolutions[resolutionKey] ?? 'keep-existing';

    if (resolution === 'replace-with-incoming') {
      itemConflicts.forEach((conflict) =>
        (conflict.existingSourceLines ?? []).forEach((line) => removeExistingSourceLines.add(line)),
      );
      return;
    }

    if (resolution === 'keep-both') {
      itemCommentLines[item.id] = [buildKeepBothComment(itemConflicts[0])];
      return;
    }

    if (resolution === 'rename-incoming') {
      return;
    }

    if (item.kind === 'observation') {
      const renamedObservation = renamedDataset.observations[item.index];
      const renamedKey = buildRenamedObservationConflictKey(renamedObservation, {});
      if ((currentObservationCounts.get(renamedKey) ?? 0) === 0) return;
    }
    nextIncludedItemIds.delete(item.id);
  });

  const importedText = buildImportReviewText(renamedDataset, renamedReviewModel, {
    includedItemIds: nextIncludedItemIds,
    groupComments,
    rowOverrides,
    rowTypeOverrides,
    fixedItemIds,
    preset,
    faceNormalizationMode,
    emitDirectionFaceHints: true,
    emitSourceHeaders: true,
    coordMode,
    force2D,
    itemCommentLines,
  }).trim();

  const existingText = buildCurrentInputLines(currentInput)
    .filter((_, index) => !removeExistingSourceLines.has(index + 1))
    .join('\n')
    .trim();

  if (!existingText) {
    return { text: importedText ? `${importedText}\n` : '', missingRenameKeys };
  }
  if (!importedText) {
    return { text: `${existingText}\n`, missingRenameKeys };
  }
  return { text: `${existingText}\n\n${importedText}\n`, missingRenameKeys };
};
