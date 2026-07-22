import { DEG_TO_RAD } from './angles';
import type { ImportedDataset, ImportedObservationRecord } from './importers';
import { serializeImportedControlStationRecord } from './importedRecordSerialization';
import type { CoordMode } from '../types';
import type { ImportReviewModel, ImportReviewOutputPreset, ImportReviewRowTypeOverride } from './importReviewTypes';
import {
  serializeObservationForImport,
  serializeObservationPreview,
  serializeTsDirectionSetRecord,
} from './importReviewSerialization';
import { applyFixedTokensToLines } from './importReviewFixedTokens';

const slopeZenithToHorizontalDistance = (slopeDistanceM: number, zenithDeg: number): number => {
  const zenithRad = zenithDeg * DEG_TO_RAD;
  const horizontal = slopeDistanceM * Math.sin(zenithRad);
  return Number.isFinite(horizontal) ? Math.abs(horizontal) : slopeDistanceM;
};

export const convertImportedDatasetSlopeZenithToHd2D = (
  dataset: ImportedDataset,
): ImportedDataset => {
  const controlStations = dataset.controlStations.map((station) => ({
    ...station,
    heightM: undefined,
    sigmaHeightM: undefined,
  }));
  const observations = dataset.observations.flatMap((observation) => {
    if (observation.kind === 'vertical') {
      return [];
    }
    if (
      observation.kind === 'measurement' &&
      observation.verticalMode === 'zenith' &&
      observation.verticalValue != null &&
      Number.isFinite(observation.verticalValue)
    ) {
      const horizontalDistanceM = slopeZenithToHorizontalDistance(
        observation.distanceM,
        observation.verticalValue,
      );
      return [
        {
          ...observation,
          distanceM: horizontalDistanceM,
          verticalMode: undefined,
          verticalValue: undefined,
          hiM: undefined,
          htM: undefined,
          note: observation.note
            ? `${observation.note}; converted SD+zenith -> HD`
            : 'converted SD+zenith -> HD',
        } as ImportedObservationRecord,
      ];
    }
    if (
      observation.kind === 'distance-vertical' &&
      observation.verticalMode === 'zenith' &&
      Number.isFinite(observation.verticalValue)
    ) {
      const horizontalDistanceM = slopeZenithToHorizontalDistance(
        observation.distanceM,
        observation.verticalValue,
      );
      return [
        {
          kind: 'distance',
          fromId: observation.fromId,
          toId: observation.toId,
          distanceM: horizontalDistanceM,
          sourceLine: observation.sourceLine,
          sourceCode: observation.sourceCode,
          description: observation.description,
          sourceMeta: observation.sourceMeta,
          note: observation.note
            ? `${observation.note}; converted SD+zenith -> HD`
            : 'converted SD+zenith -> HD',
        } as ImportedObservationRecord,
      ];
    }
    return [observation];
  });
  return {
    ...dataset,
    controlStations,
    observations,
  };
};

export const buildImportReviewDisplayTextMap = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  preset: ImportReviewOutputPreset,
  coordMode: CoordMode = '3D',
  rowOverrides: Record<string, string> = {},
  force2D = false,
): Record<string, string> => {
  const output: Record<string, string> = {};
  const controlOrder = preset === 'industry-style' ? 'NE' : 'EN';
  model.items.forEach((item) => {
    const override = rowOverrides[item.id];
    if (override != null) {
      output[item.id] = override;
      return;
    }
    if (item.kind === 'comment') {
      output[item.id] = item.defaultText ?? '# COMMENT';
      return;
    }
    if (item.kind === 'control') {
      output[item.id] = serializeImportedControlStationRecord(
        dataset.controlStations[item.index],
        coordMode,
        force2D,
        controlOrder,
      );
      return;
    }
    output[item.id] =
      preset === 'ts-direction-set'
        ? serializeTsDirectionSetRecord(dataset.observations[item.index]).join(' | ')
        : serializeObservationPreview(dataset.observations[item.index], preset);
  });
  return output;
};

export const appendPresetObservationLines = (
  lines: string[],
  observation: ImportedObservationRecord,
  preset: ImportReviewOutputPreset,
  overrideLines: string[] | undefined,
  rowTypeOverride: ImportReviewRowTypeOverride,
  fixed: boolean,
  coordMode: CoordMode,
  state: {
    currentDeltaMode: 'delta-h' | 'zenith' | null;
    currentGpsMode: 'network' | 'sideshot' | null;
  },
) => {
  if (overrideLines && overrideLines.length > 0) {
    applyFixedTokensToLines(overrideLines, fixed, coordMode).forEach((line) => lines.push(line));
    return;
  }
  const serializedLines = applyFixedTokensToLines(
    serializeObservationForImport(observation, preset, rowTypeOverride),
    fixed,
    coordMode,
  );
  serializedLines.forEach((line) => {
    if (line === '.DELTA ON') {
      if (state.currentDeltaMode !== 'delta-h') {
        lines.push(line);
        state.currentDeltaMode = 'delta-h';
      }
      return;
    }
    if (line === '.DELTA OFF') {
      if (state.currentDeltaMode !== 'zenith') {
        lines.push(line);
        state.currentDeltaMode = 'zenith';
      }
      return;
    }
    if (line.startsWith('.GPS ')) {
      const desiredGpsMode = /SIDESHOT/i.test(line) ? 'sideshot' : 'network';
      if (state.currentGpsMode !== desiredGpsMode) {
        lines.push(line);
        state.currentGpsMode = desiredGpsMode;
      }
      return;
    }
    lines.push(line);
  });
};
