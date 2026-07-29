import {
  buildImportReviewText,
  type ImportReviewModel,
  type ImportReviewOutputPreset,
  type ImportReviewRowTypeOverride,
} from './importReview';
import {
  buildCurrentInputLines,
  buildExistingObservationCounts,
  buildImportedObservationConflictKey,
  normalizeId,
  parseExistingInput,
} from './importConflictAnalysis';
import type { ParseSettings } from '../appStateTypes';
import type { InstrumentLibrary } from '../types';
import type {
  ImportedDataset,
  ImportedDistanceObservationRecord,
  ImportedObservationRecord,
} from './importers';

export { buildImportConflictSummary } from './importConflictAnalysis';

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

export interface BuildImportConflictSummaryArgs {
  currentInput: string;
  currentIncludeFiles: Record<string, string>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  importedDataset: ImportedDataset;
}

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

const buildRenameMap = ({
  conflictRenameValues,
  conflictResolutions,
  importedDataset,
}: BuildResolvedImportTextArgs): {
  renameMap: Record<string, string>;
  missingRenameKeys: string[];
} => {
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
  return { renameMap, missingRenameKeys };
};

const applyConflictResolutionSelections = ({
  conflicts,
  conflictResolutions,
  currentObservationCounts,
  includedItemIds,
  renamedDataset,
  renamedReviewModel,
}: {
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  currentObservationCounts: Map<string, number>;
  includedItemIds: Set<string>;
  renamedDataset: ImportedDataset;
  renamedReviewModel: ImportReviewModel;
}): {
  nextIncludedItemIds: Set<string>;
  removeExistingSourceLines: Set<number>;
  itemCommentLines: Record<string, string[]>;
} => {
  const conflictsByKey = new Map<string, ImportConflict[]>();
  conflicts.forEach((conflict) => {
    const bucket = conflictsByKey.get(conflict.resolutionKey) ?? [];
    bucket.push(conflict);
    conflictsByKey.set(conflict.resolutionKey, bucket);
  });

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
    if (resolution === 'rename-incoming') return;
    if (item.kind === 'observation') {
      const renamedObservation = renamedDataset.observations[item.index];
      const renamedKey = buildRenamedObservationConflictKey(renamedObservation, {});
      if ((currentObservationCounts.get(renamedKey) ?? 0) === 0) return;
    }
    nextIncludedItemIds.delete(item.id);
  });

  return { nextIncludedItemIds, removeExistingSourceLines, itemCommentLines };
};

export const buildResolvedImportText = (args: BuildResolvedImportTextArgs): { text: string; missingRenameKeys: string[] } => {
  const { renameMap, missingRenameKeys } = buildRenameMap(args);
  const renamedDataset = cloneRenamedDataset(args.importedDataset, renameMap);
  const renamedReviewModel = cloneRenamedReviewModel(args.reviewModel, renameMap);
  const currentObservationCounts = buildExistingObservationCounts(
    parseExistingInput({
      currentInput: args.currentInput,
      currentIncludeFiles: args.currentIncludeFiles,
      parseSettings: args.parseSettings,
      projectInstruments: args.projectInstruments,
    }),
  );
  const { nextIncludedItemIds, removeExistingSourceLines, itemCommentLines } =
    applyConflictResolutionSelections({
      conflicts: args.conflicts,
      conflictResolutions: args.conflictResolutions,
      currentObservationCounts,
      includedItemIds: args.includedItemIds,
      renamedDataset,
      renamedReviewModel,
    });

  const importedText = buildImportReviewText(renamedDataset, renamedReviewModel, {
    includedItemIds: nextIncludedItemIds,
    groupComments: args.groupComments,
    rowOverrides: args.rowOverrides,
    rowTypeOverrides: args.rowTypeOverrides,
    fixedItemIds: args.fixedItemIds,
    preset: args.preset,
    faceNormalizationMode: args.faceNormalizationMode,
    emitDirectionFaceHints: true,
    emitSourceHeaders: true,
    coordMode: args.coordMode,
    force2D: args.force2D,
    itemCommentLines,
  }).trim();

  const existingText = buildCurrentInputLines(args.currentInput)
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
