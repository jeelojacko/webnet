import type { ImportedDataset, ImportedInputNotice, ImportedTraceEntry } from './importers';
import { serializeImportedControlStationRecord } from './importedRecordSerialization';
import type { CoordMode } from '../types';
import type {
  BuildImportReviewTextOptions,
  ImportReviewItem,
  ImportReviewModel,
} from './importReviewTypes';
import { splitOverrideLines } from './importReviewFormatters';
import {
  appendFixedTokensToLine,
  applyFixedTokensToLines,
} from './importReviewFixedTokens';
import { appendPresetObservationLines } from './importReviewOutputText';
import {
  buildFaceAwareDirectionSetLines,
  buildIndustryStyleDirectionSetLines,
  isDirectionSetRowType,
  orderFieldGroupedItems,
  resolveFieldGroupedSection,
} from './importReviewDirectionSets';

export {
  buildImportReviewDisplayTextMap,
  convertImportedDatasetSlopeZenithToHd2D,
} from './importReviewOutputText';
export {
  appendImportReviewSource,
  buildImportReviewModel,
} from './importReviewModel';
export {
  buildImportReviewComparisonKeyForItem,
  buildImportReviewComparisonSummary,
} from './importReviewComparison';
export {
  createEmptyImportReviewGroup,
  createImportReviewGroupFromItem,
  duplicateImportReviewItem,
  insertImportReviewCommentRow,
  moveImportReviewItem,
  removeImportReviewGroup,
  removeImportReviewItem,
  reorderImportReviewItemWithinGroup,
} from './importReviewModelEditing';

export type {
  BuildImportReviewTextOptions,
  ImportReviewComparisonMode,
  ImportReviewComparisonRow,
  ImportReviewComparisonSourceSummary,
  ImportReviewComparisonSummary,
  ImportReviewComparisonTotals,
  ImportReviewGroup,
  ImportReviewGroupKind,
  ImportReviewItem,
  ImportReviewItemKind,
  ImportReviewModel,
  ImportReviewOutputPreset,
  ImportReviewRowTypeOverride,
  ImportReviewWorkspaceSource,
} from './importReviewTypes';

export const isImportReviewMtaItem = (item: ImportReviewItem): boolean =>
  item.kind === 'observation' && item.sourceMethod === 'MEANTURNEDANGLE';

export const isImportReviewRawMeasurementItem = (item: ImportReviewItem): boolean =>
  item.kind === 'observation' &&
  Boolean(item.sourceMethod) &&
  item.sourceMethod !== 'MEANTURNEDANGLE';

export const buildImportReviewText = (
  dataset: ImportedDataset,
  model: ImportReviewModel,
  options: BuildImportReviewTextOptions,
): string => {
  const lines: string[] = [];
  const itemLookup = new Map(model.items.map((item) => [item.id, item]));
  const preset = options.preset ?? 'clean-webnet';
  const includedGroups = model.groups.filter((group) =>
    group.itemIds.some((itemId) => options.includedItemIds.has(itemId)),
  );
  const uniqueSourceKeys = new Set(
    includedGroups.map((group) => group.sourceKey).filter((value): value is string => Boolean(value)),
  );
  const coordMode: CoordMode =
    options.force2D === true
      ? '2D'
      : (options.coordMode ?? (preset === 'ts-direction-set' ? '2D' : '3D'));
  const controlOrder = preset === 'industry-style' ? 'NE' : 'EN';
  const state = {
    currentDeltaMode: null as 'delta-h' | 'zenith' | null,
    currentGpsMode: null as 'network' | 'sideshot' | null,
  };
  let lastSourceKey: string | null = null;

  if (coordMode === '2D') {
    lines.push('.2D');
  }
  lines.push('.UNITS M');
  lines.push(`.ORDER ${controlOrder}`);

  model.groups.forEach((group) => {
    const includedItems = group.itemIds
      .map((itemId) => itemLookup.get(itemId))
      .filter((item): item is ImportReviewItem => Boolean(item))
      .filter((item) => options.includedItemIds.has(item.id));

    if (includedItems.length === 0) return;

    const comment = options.groupComments?.[group.key]?.trim() ?? group.defaultComment;
    if (lines.length > 0) lines.push('');
    if (
      options.emitSourceHeaders === true &&
      uniqueSourceKeys.size > 1 &&
      group.sourceKey &&
      group.sourceName &&
      group.sourceKey !== lastSourceKey
    ) {
      lines.push(`# SOURCE ${group.sourceName}`);
      lastSourceKey = group.sourceKey;
    }
    if (comment) lines.push(`# ${comment}`);

    const isDirectionSetGroup =
      Boolean(group.backsightId) &&
      includedItems.some((item) => item.kind === 'observation') &&
      (((preset === 'ts-direction-set' || preset === 'industry-style') &&
        (group.kind === 'resection' || group.kind === 'setup')) ||
        includedItems.some((item) =>
          isDirectionSetRowType(options.rowTypeOverrides?.[item.id] ?? 'auto'),
        ));
    const syntheticBacksightMode = options.syntheticDirectionBacksightMode ?? 'auto';

    const orderedItems =
      (preset === 'field-grouped' || preset === 'ts-direction-set') && group.kind !== 'control'
        ? orderFieldGroupedItems(includedItems, group)
        : includedItems;

    if (preset === 'industry-style' && isDirectionSetGroup) {
      const industryStyleLines = buildIndustryStyleDirectionSetLines(
        dataset,
        includedItems,
        group,
        options.rowOverrides,
        options.fixedItemIds,
        coordMode,
      );
      if (industryStyleLines) {
        industryStyleLines.forEach((line) => lines.push(line));
        return;
      }
    }

    if (isDirectionSetGroup) {
      const faceAwareLines = buildFaceAwareDirectionSetLines(
        dataset,
        orderedItems,
        group,
        preset,
        options.rowOverrides,
        options.rowTypeOverrides,
        options.fixedItemIds,
        coordMode,
        options.faceNormalizationMode,
        syntheticBacksightMode,
        options.emitDirectionFaceHints ?? false,
      );
      if (faceAwareLines) {
        faceAwareLines.forEach((line) => lines.push(line));
        return;
      }
    }

    const hasExplicitBacksightPointing =
      Boolean(group.backsightId) &&
      includedItems.some(
        (item) =>
          item.kind === 'observation' &&
          item.targetId === group.backsightId &&
          item.sourceClassification === 'BackSight',
      );
    const emitSyntheticBacksightDn =
      isDirectionSetGroup &&
      group.backsightId &&
      (syntheticBacksightMode === 'always' ||
        (syntheticBacksightMode === 'auto' && !hasExplicitBacksightPointing));

    if (isDirectionSetGroup) {
      lines.push(`DB ${group.setupId ?? includedItems[0]?.setupId ?? ''}`.trimEnd());
      if (emitSyntheticBacksightDn) {
        lines.push(`DN ${group.backsightId} 000-00-00`);
      }
    }
    const distinctFieldSections =
      preset === 'field-grouped'
        ? new Set(
            orderedItems
              .map((item) => resolveFieldGroupedSection(item, group))
              .filter((value): value is string => Boolean(value)),
          )
        : new Set<string>();
    let lastFieldSection: string | null = null;

    orderedItems.forEach((item) => {
      const itemCommentLines = options.itemCommentLines?.[item.id] ?? [];
      itemCommentLines.forEach((line) => lines.push(line));

      if (item.kind === 'comment') {
        const override = options.rowOverrides?.[item.id];
        const commentLines = splitOverrideLines(override ?? item.defaultText ?? '# COMMENT');
        commentLines.forEach((line) => lines.push(line));
        return;
      }

      if (
        preset === 'field-grouped' &&
        group.kind !== 'control' &&
        distinctFieldSections.size > 1
      ) {
        const nextSection = resolveFieldGroupedSection(item, group);
        if (nextSection && nextSection !== lastFieldSection) {
          lines.push(`# ${nextSection}`);
          lastFieldSection = nextSection;
        }
      }

      if (item.kind === 'control') {
        const override = options.rowOverrides?.[item.id];
        if (override?.trim()) {
          applyFixedTokensToLines(
            splitOverrideLines(override),
            options.fixedItemIds?.has(item.id) ?? false,
            coordMode,
          ).forEach((line) => lines.push(line));
        } else {
          const controlLine = serializeImportedControlStationRecord(
            dataset.controlStations[item.index],
            coordMode,
            options.force2D === true,
            controlOrder,
          );
          lines.push(
            options.fixedItemIds?.has(item.id)
              ? appendFixedTokensToLine(controlLine, coordMode)
              : controlLine,
          );
        }
        return;
      }
      appendPresetObservationLines(
        lines,
        dataset.observations[item.index],
        preset,
        splitOverrideLines(options.rowOverrides?.[item.id]),
        options.rowTypeOverrides?.[item.id] ?? 'auto',
        options.fixedItemIds?.has(item.id) ?? false,
        coordMode,
        state,
      );
    });

    if (isDirectionSetGroup) {
      lines.push('DE');
    }
  });

  lines.push('');
  return lines.join('\n');
};
