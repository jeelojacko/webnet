import type { ImportedDataset, ImportedMeasurementObservationRecord, ImportedObservationRecord } from './importers';
import type { CoordMode, FaceNormalizationMode } from '../types';
import type { ImportReviewGroup, ImportReviewItem, ImportReviewOutputPreset, ImportReviewRowTypeOverride } from './importReviewTypes';
import {
  appendDirectionLineFaceHint,
  compareImportTokens,
  formatAngleDms,
  inferDirectionFaceFromZenithDeg,
  normalizeDirectionFace,
  normalizeDirectionLineFace2ToFace1,
  parseDirectionLineTarget,
  splitOverrideLines,
  type DirectionFaceBucket,
} from './importReviewFormatters';
import {
  isIndustryStyleMeasurement,
  meanIndustryStyleDirectionAngleDeg,
  serializeIndustryStyleMeasurement,
  serializeObservationForImport,
} from './importReviewSerialization';
import { applyFixedTokensToLines } from './importReviewFixedTokens';

export const isDirectionSetRowType = (value: ImportReviewRowTypeOverride): boolean =>
  value === 'direction-angle' || value === 'direction-measurement';

const isDirectionSetObservationItem = (
  observation: ImportedObservationRecord,
  rowTypeOverride: ImportReviewRowTypeOverride,
  preset: ImportReviewOutputPreset,
  group: ImportReviewGroup,
): boolean => {
  if (observation.kind !== 'measurement' && observation.kind !== 'angle') return false;
  if (rowTypeOverride === 'direction-angle' || rowTypeOverride === 'direction-measurement') {
    return true;
  }
  if (rowTypeOverride !== 'auto') return false;
  return preset === 'ts-direction-set' && (group.kind === 'resection' || group.kind === 'setup');
};

export const buildIndustryStyleDirectionSetLines = (
  dataset: ImportedDataset,
  items: ImportReviewItem[],
  group: ImportReviewGroup,
  rowOverrides: Record<string, string> | undefined,
  fixedItemIds: Set<string> | undefined,
  coordMode: CoordMode,
): string[] | null => {
  type IndustryStyleEntry = {
    observation: ImportedMeasurementObservationRecord;
    line: string;
  };
  type IndustryStyleSegment = {
    directionSetId: string;
    entries: IndustryStyleEntry[];
    carryOrientationToNext: boolean;
  };
  const prefixLines: string[] = [];
  const segments: IndustryStyleSegment[] = [];
  let currentSegment: IndustryStyleSegment | null = null;

  for (const item of items) {
    const overrideLines = splitOverrideLines(rowOverrides?.[item.id]);
    if (item.kind === 'comment') {
      prefixLines.push(
        ...(overrideLines.length > 0 ? overrideLines : [item.defaultText ?? '# COMMENT']),
      );
      continue;
    }
    if (item.kind !== 'observation') continue;

    const observation = dataset.observations[item.index];
    if (!isIndustryStyleMeasurement(observation)) continue;

    const serializedLines = applyFixedTokensToLines(
      overrideLines.length > 0 ? overrideLines : [serializeIndustryStyleMeasurement(observation)],
      fixedItemIds?.has(item.id) ?? false,
      coordMode,
    );
    const dataLine = serializedLines.find(
      (line) => line.trim().length > 0 && !line.startsWith('#') && !line.startsWith('.'),
    );
    if (!dataLine) continue;

    const directionSetId =
      observation.jobXml?.directionSetId ??
      `${group.setupId ?? observation.atId}::${observation.jobXml?.round ?? 0}`;
    if (!currentSegment || currentSegment.directionSetId !== directionSetId) {
      currentSegment = {
        directionSetId,
        entries: [],
        carryOrientationToNext: false,
      };
      segments.push(currentSegment);
    }
    currentSegment.entries.push({
      observation,
      line: dataLine,
    });
  }

  if (segments.length === 0) return null;

  const isBacksightEntry = (entry: IndustryStyleEntry): boolean =>
    entry.observation.jobXml?.isBacksight === true || entry.observation.toId === group.backsightId;

  const findLeadingBacksightEntries = (entries: IndustryStyleEntry[]): IndustryStyleEntry[] => {
    const leading: IndustryStyleEntry[] = [];
    for (const entry of entries) {
      if (!isBacksightEntry(entry)) break;
      leading.push(entry);
    }
    return leading;
  };

  segments.forEach((segment) => {
    segment.entries.sort(
      (left, right) =>
        (left.observation.jobXml?.observationOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.observation.jobXml?.observationOrder ?? Number.MAX_SAFE_INTEGER),
    );
  });

  const omittedSegments = new Set<number>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const leadingBacksightEntries = findLeadingBacksightEntries(segment.entries);
    const backsightOnly =
      segment.entries.length > 0 && leadingBacksightEntries.length === segment.entries.length;
    if (!backsightOnly) continue;
    const hasPreviousProduction = segments
      .slice(0, index)
      .some((candidate) => findLeadingBacksightEntries(candidate.entries).length < candidate.entries.length);
    const nextProductionIndex = segments.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        findLeadingBacksightEntries(candidate.entries).length < candidate.entries.length,
    );
    if (hasPreviousProduction && nextProductionIndex > index) {
      segments[nextProductionIndex]!.carryOrientationToNext = true;
      omittedSegments.add(index);
      continue;
    }
    omittedSegments.add(index);
  }

  const lines = [...prefixLines];
  let emittedBlockCount = 0;
  segments.forEach((segment, index) => {
    if (omittedSegments.has(index)) return;
    const leadingBacksightEntries = findLeadingBacksightEntries(segment.entries);
    const emitDn =
      segment.carryOrientationToNext &&
      Boolean(group.backsightId) &&
      leadingBacksightEntries.length > 0 &&
      leadingBacksightEntries.length < segment.entries.length;
    const dnAngleDeg = emitDn
      ? meanIndustryStyleDirectionAngleDeg(
          leadingBacksightEntries.map((entry) => entry.observation),
        )
      : undefined;
    const emitEntries =
      emitDn && dnAngleDeg != null ? segment.entries.slice(leadingBacksightEntries.length) : segment.entries;
    if (emitEntries.length === 0 && dnAngleDeg == null) return;
    if (emittedBlockCount > 0) lines.push('');
    lines.push(`DB ${group.setupId ?? ''}`.trimEnd());
    if (emitDn && dnAngleDeg != null && group.backsightId) {
      lines.push(`DN ${group.backsightId} ${formatAngleDms(dnAngleDeg)}`);
    }
    emitEntries.forEach((entry) => lines.push(entry.line));
    lines.push('DE');
    emittedBlockCount += 1;
  });
  return emittedBlockCount > 0 ? lines : null;
};

const resolveDirectionFaceBucket = (
  observation: ImportedObservationRecord,
  zenithWindowDeg = 45,
): DirectionFaceBucket => {
  const metadataFace = normalizeDirectionFace(observation.sourceMeta?.face);
  if (metadataFace !== 'unresolved') return metadataFace;
  if (observation.kind !== 'measurement' || observation.verticalMode !== 'zenith') {
    return 'unresolved';
  }
  return inferDirectionFaceFromZenithDeg(observation.verticalValue, zenithWindowDeg);
};

const shouldEmitSyntheticBacksightDnForDirectionBlock = (
  mode: 'auto' | 'always' | 'never',
  backsightId: string | undefined,
  lines: string[],
): boolean => {
  if (!backsightId) return false;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return !lines.some((line) => parseDirectionLineTarget(line) === backsightId);
};

export const buildFaceAwareDirectionSetLines = (
  dataset: ImportedDataset,
  orderedItems: ImportReviewItem[],
  group: ImportReviewGroup,
  preset: ImportReviewOutputPreset,
  rowOverrides: Record<string, string> | undefined,
  rowTypeOverrides: Record<string, ImportReviewRowTypeOverride> | undefined,
  fixedItemIds: Set<string> | undefined,
  coordMode: CoordMode,
  faceNormalizationMode: FaceNormalizationMode | undefined,
  syntheticDirectionBacksightMode: 'auto' | 'always' | 'never',
  emitDirectionFaceHints: boolean,
): string[] | null => {
  const serializedEntries: Array<{ line: string; face: DirectionFaceBucket }> = [];
  const commentLines: string[] = [];
  const zenithWindowDeg = 45;

  for (const item of orderedItems) {
    if (item.kind === 'comment') {
      const commentOverride = rowOverrides?.[item.id];
      splitOverrideLines(commentOverride ?? item.defaultText ?? '# COMMENT').forEach((line) =>
        commentLines.push(line),
      );
      continue;
    }
    if (item.kind !== 'observation') {
      return null;
    }
    const observation = dataset.observations[item.index];
    const rowTypeOverride = rowTypeOverrides?.[item.id] ?? 'auto';
    if (!isDirectionSetObservationItem(observation, rowTypeOverride, preset, group)) {
      return null;
    }
    const overrideLines = splitOverrideLines(rowOverrides?.[item.id]);
    const serializedLines = applyFixedTokensToLines(
      overrideLines.length > 0
        ? overrideLines
        : serializeObservationForImport(observation, preset, rowTypeOverride),
      fixedItemIds?.has(item.id) ?? false,
      coordMode,
    );
    const faceBucket = resolveDirectionFaceBucket(observation, zenithWindowDeg);

    for (const rawLine of serializedLines) {
      if (!rawLine.trim() || rawLine.startsWith('#')) {
        if (rawLine.trim()) commentLines.push(rawLine);
        continue;
      }
      if (rawLine.startsWith('.')) return null;
      if (!parseDirectionLineTarget(rawLine)) return null;
      serializedEntries.push({ line: rawLine, face: faceBucket });
    }
  }

  if (serializedEntries.length === 0) return null;

  const mode = faceNormalizationMode ?? 'on';
  const splitByFace = mode === 'off';
  const normalizeFace2 = mode !== 'off';
  const nextLines: string[] = [...commentLines];
  const setupId = group.setupId ?? '';
  const backsightId = group.backsightId;

  if (!splitByFace) {
    const normalizedLines = serializedEntries.map((entry) => {
      const normalizedLine =
        normalizeFace2 && entry.face === 'face2'
          ? normalizeDirectionLineFace2ToFace1(entry.line) ?? entry.line
          : entry.line;
      if (!emitDirectionFaceHints) return normalizedLine;
      const effectiveFace: DirectionFaceBucket = entry.face === 'unresolved' ? 'unresolved' : 'face1';
      return appendDirectionLineFaceHint(normalizedLine, effectiveFace);
    });
    nextLines.push(`DB ${setupId}`.trimEnd());
    if (
      shouldEmitSyntheticBacksightDnForDirectionBlock(
        syntheticDirectionBacksightMode,
        backsightId,
        normalizedLines,
      )
    ) {
      nextLines.push(`DN ${backsightId} 000-00-00`);
    }
    normalizedLines.forEach((line) => nextLines.push(line));
    nextLines.push('DE');
    return nextLines;
  }

  const decorateSplitLine = (line: string, face: DirectionFaceBucket): string =>
    emitDirectionFaceHints ? appendDirectionLineFaceHint(line, face) : line;
  const face1Lines = serializedEntries
    .filter((entry) => entry.face === 'face1')
    .map((entry) => decorateSplitLine(entry.line, 'face1'));
  const face2Lines = serializedEntries
    .filter((entry) => entry.face === 'face2')
    .map((entry) => decorateSplitLine(entry.line, 'face2'));
  const unresolvedLines = serializedEntries
    .filter((entry) => entry.face === 'unresolved')
    .map((entry) => decorateSplitLine(entry.line, 'unresolved'));
  const blocks = [
    { label: '# FACE 1', lines: face1Lines },
    { label: '# FACE 2', lines: face2Lines },
    { label: '# FACE UNRESOLVED', lines: unresolvedLines },
  ].filter((block) => block.lines.length > 0);
  const useFaceLabels = blocks.length > 1;

  blocks.forEach((block, index) => {
    if (index > 0) nextLines.push('');
    if (useFaceLabels) nextLines.push(block.label);
    nextLines.push(`DB ${setupId}`.trimEnd());
    if (
      shouldEmitSyntheticBacksightDnForDirectionBlock(
        syntheticDirectionBacksightMode,
        backsightId,
        block.lines,
      )
    ) {
      nextLines.push(`DN ${backsightId} 000-00-00`);
    }
    block.lines.forEach((line) => nextLines.push(line));
    nextLines.push('DE');
  });

  return nextLines;
};

const isBacksightTargetItem = (item: ImportReviewItem, group: ImportReviewGroup): boolean =>
  item.kind === 'observation' &&
  Boolean(group.backsightId) &&
  Boolean(item.targetId) &&
  item.targetId === group.backsightId;

const getFieldGroupedOrderRank = (item: ImportReviewItem, group: ImportReviewGroup): number => {
  if (item.kind !== 'observation') return 99;
  if (isBacksightTargetItem(item, group)) {
    if (item.sourceClassification === 'BackSight') return 0;
    if (item.sourceClassification === 'Check') return 1;
    if (item.sourceMethod === 'MEANTURNEDANGLE') return 2;
    return 3;
  }
  if (item.sourceMethod === 'MEANTURNEDANGLE') return 2;
  if (item.sourceClassification === 'Check') return 1;
  return 0;
};

export const orderFieldGroupedItems = (
  items: ImportReviewItem[],
  group: ImportReviewGroup,
): ImportReviewItem[] => {
  if (group.manualOrder || items.some((item) => item.kind === 'comment' || item.synthetic))
    return items;
  return [...items].sort((left, right) => {
    if (left.kind === 'comment' || right.kind === 'comment') return 0;
    const leftBacksight = isBacksightTargetItem(left, group) ? 0 : 1;
    const rightBacksight = isBacksightTargetItem(right, group) ? 0 : 1;
    if (leftBacksight !== rightBacksight) return leftBacksight - rightBacksight;
    const targetCompare = compareImportTokens(left.targetId, right.targetId);
    if (targetCompare !== 0) return targetCompare;
    const leftRank = getFieldGroupedOrderRank(left, group);
    const rightRank = getFieldGroupedOrderRank(right, group);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const sourceLineCompare =
      (left.sourceLine ?? Number.MAX_SAFE_INTEGER) - (right.sourceLine ?? Number.MAX_SAFE_INTEGER);
    if (sourceLineCompare !== 0) return sourceLineCompare;
    return compareImportTokens(left.id, right.id);
  });
};

export const resolveFieldGroupedSection = (
  item: ImportReviewItem,
  group: ImportReviewGroup,
): string | null => {
  if (item.kind !== 'observation') return null;
  if (isBacksightTargetItem(item, group) && group.backsightId) {
    return `BACKSIGHT ${group.backsightId}`;
  }
  if (item.targetId) {
    return `${group.kind === 'resection' ? 'RESECTION TARGET' : 'TARGET'} ${item.targetId}`;
  }
  if (item.sourceClassification === 'Check') return 'CHECK OBS';
  if (item.sourceMethod === 'MEANTURNEDANGLE') return 'MTA OBS';
  if (item.sourceMethod) return 'RAW OBS';
  return null;
};
