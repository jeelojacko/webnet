import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { convertImportedDatasetSlopeZenithToHd2D, createEmptyImportReviewGroup, createImportReviewGroupFromItem, duplicateImportReviewItem, insertImportReviewCommentRow, isImportReviewMtaItem, isImportReviewRawMeasurementItem, moveImportReviewItem, reorderImportReviewItemWithinGroup, removeImportReviewGroup, removeImportReviewItem, type ImportReviewComparisonMode, type ImportReviewOutputPreset, type ImportReviewRowTypeOverride } from '../engine/importReview';
import type { ImportConflict, ImportResolution } from '../engine/importConflictReview';
import type { ImportedDataset } from '../engine/importers';
import { buildImportReviewComparisonSummaryForSources, buildWorkspaceFromSources, mergeConflictRenameValues, mergeConflictResolutionDefaults, type ImportReviewState } from './useImportReviewWorkflowTypes';

type Args = { setImportReviewState: Dispatch<SetStateAction<ImportReviewState | null>>; buildImportConflicts: (_dataset: ImportedDataset) => ImportConflict[]; };
export const useImportReviewEditActions = ({ setImportReviewState, buildImportConflicts }: Args) => {
  const handleImportReviewToggleExclude = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextExcluded = new Set(prev.excludedItemIds);
      if (nextExcluded.has(itemId)) nextExcluded.delete(itemId);
      else nextExcluded.add(itemId);
      return { ...prev, excludedItemIds: nextExcluded };
    });
  }, [setImportReviewState]);

  const handleImportReviewToggleFixed = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextFixed = new Set(prev.fixedItemIds);
      if (nextFixed.has(itemId)) nextFixed.delete(itemId);
      else nextFixed.add(itemId);
      return { ...prev, fixedItemIds: nextFixed };
    });
  }, [setImportReviewState]);

  const handleImportReviewSetBulkExcludeMta = useCallback((excluded: boolean) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextExcluded = new Set(prev.excludedItemIds);
      prev.reviewModel.items
        .filter((item) => isImportReviewMtaItem(item))
        .forEach((item) => {
          if (excluded) nextExcluded.add(item.id);
          else nextExcluded.delete(item.id);
        });
      return { ...prev, excludedItemIds: nextExcluded };
    });
  }, [setImportReviewState]);

  const handleImportReviewSetBulkExcludeRaw = useCallback((excluded: boolean) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextExcluded = new Set(prev.excludedItemIds);
      prev.reviewModel.items
        .filter((item) => isImportReviewRawMeasurementItem(item))
        .forEach((item) => {
          if (excluded) nextExcluded.add(item.id);
          else nextExcluded.delete(item.id);
        });
      return { ...prev, excludedItemIds: nextExcluded };
    });
  }, [setImportReviewState]);

  const handleImportReviewConvertSlopeZenithToHd2D = useCallback(() => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextSources = prev.sources.map((source) => ({
        ...source,
        dataset: convertImportedDatasetSlopeZenithToHd2D(source.dataset),
      }));
      const nextWorkspace = buildWorkspaceFromSources(nextSources);
      const itemIds = new Set(nextWorkspace.reviewModel.items.map((item) => item.id));
      const nextExcludedItemIds = new Set(
        [...prev.excludedItemIds].filter((itemId) => itemIds.has(itemId)),
      );
      const nextFixedItemIds = new Set(
        [...prev.fixedItemIds].filter((itemId) => itemIds.has(itemId)),
      );
      const nextGroupLabels = Object.fromEntries(
        nextWorkspace.reviewModel.groups.map((group) => [
          group.key,
          prev.groupLabels[group.key] ?? group.label,
        ]),
      );
      const nextGroupComments = Object.fromEntries(
        nextWorkspace.reviewModel.groups.map((group) => [
          group.key,
          prev.groupComments[group.key] ?? group.defaultComment,
        ]),
      );
      const nextConflicts = buildImportConflicts(nextWorkspace.dataset);
      return {
        ...prev,
        sources: nextSources,
        dataset: nextWorkspace.dataset,
        reviewModel: nextWorkspace.reviewModel,
        groupLabels: nextGroupLabels,
        groupComments: nextGroupComments,
        excludedItemIds: nextExcludedItemIds,
        fixedItemIds: nextFixedItemIds,
        rowOverrides: {},
        rowTypeOverrides: {},
        comparisonSummary: buildImportReviewComparisonSummaryForSources(
          nextSources,
          prev.comparisonMode,
        ),
        force2DOutput: true,
        conflicts: nextConflicts,
        conflictResolutions: mergeConflictResolutionDefaults(
          nextConflicts,
          prev.conflictResolutions,
        ),
        conflictRenameValues: mergeConflictRenameValues(
          nextConflicts,
          prev.conflictRenameValues,
        ),
        resolutionValidationMessage: null,
      };
    });
  }, [buildImportConflicts, setImportReviewState]);

  const handleImportConflictResolutionChange = useCallback(
    (resolutionKey: string, resolution: ImportResolution) => {
      setImportReviewState((prev) =>
        prev
          ? {
              ...prev,
              conflictResolutions: {
                ...prev.conflictResolutions,
                [resolutionKey]: resolution,
              },
              resolutionValidationMessage: null,
            }
          : prev,
      );
    },
    [setImportReviewState],
  );

  const handleImportConflictRenameValueChange = useCallback((resolutionKey: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            conflictRenameValues: {
              ...prev.conflictRenameValues,
              [resolutionKey]: value,
            },
            resolutionValidationMessage: null,
          }
        : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewSetGroupExcluded = useCallback((groupKey: string, excluded: boolean) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const group = prev.reviewModel.groups.find((entry) => entry.key === groupKey);
      if (!group) return prev;
      const itemLookup = new Map(prev.reviewModel.items.map((item) => [item.id, item]));
      const nextExcluded = new Set(prev.excludedItemIds);
      group.itemIds
        .map((itemId) => itemLookup.get(itemId))
        .filter((item): item is Exclude<typeof item, undefined> => Boolean(item))
        .filter((item) => item.kind === 'observation')
        .forEach((item) => {
          if (excluded) nextExcluded.add(item.id);
          else nextExcluded.delete(item.id);
        });
      return { ...prev, excludedItemIds: nextExcluded };
    });
  }, [setImportReviewState]);

  const handleImportReviewCommentChange = useCallback((groupKey: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            groupComments: { ...prev.groupComments, [groupKey]: value },
          }
        : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewGroupLabelChange = useCallback((groupKey: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            groupLabels: { ...prev.groupLabels, [groupKey]: value },
          }
        : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewRowTextChange = useCallback((itemId: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            rowOverrides: { ...prev.rowOverrides, [itemId]: value },
          }
        : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewRowTypeChange = useCallback(
    (itemId: string, value: ImportReviewRowTypeOverride) => {
      setImportReviewState((prev) =>
        prev
          ? {
              ...prev,
              rowTypeOverrides: { ...prev.rowTypeOverrides, [itemId]: value },
            }
          : prev,
      );
    },
    [setImportReviewState],
  );

  const handleImportReviewPresetChange = useCallback((preset: ImportReviewOutputPreset) => {
    setImportReviewState((prev) => (prev ? { ...prev, preset } : prev));
  }, [setImportReviewState]);

  const handleImportReviewComparisonModeChange = useCallback((mode: ImportReviewComparisonMode) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        comparisonMode: mode,
        comparisonSummary: buildImportReviewComparisonSummaryForSources(prev.sources, mode),
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewDuplicateRow = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextId = `synthetic:${prev.nextSyntheticId}`;
      const sourceOverride = prev.rowOverrides[itemId];
      const sourceRowTypeOverride = prev.rowTypeOverrides[itemId];
      const nextFixed = new Set(prev.fixedItemIds);
      if (nextFixed.has(itemId)) nextFixed.add(nextId);
      return {
        ...prev,
        reviewModel: duplicateImportReviewItem(prev.reviewModel, itemId, nextId),
        fixedItemIds: nextFixed,
        rowOverrides:
          sourceOverride != null ? { ...prev.rowOverrides, [nextId]: sourceOverride } : prev.rowOverrides,
        rowTypeOverrides:
          sourceRowTypeOverride != null
            ? { ...prev.rowTypeOverrides, [nextId]: sourceRowTypeOverride }
            : prev.rowTypeOverrides,
        nextSyntheticId: prev.nextSyntheticId + 1,
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewInsertCommentBelow = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextId = `synthetic:${prev.nextSyntheticId}`;
      return {
        ...prev,
        reviewModel: insertImportReviewCommentRow(prev.reviewModel, itemId, nextId),
        rowOverrides: { ...prev.rowOverrides, [nextId]: '# COMMENT' },
        nextSyntheticId: prev.nextSyntheticId + 1,
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewCreateSetupGroup = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const sourceItem = prev.reviewModel.items.find((item) => item.id === itemId);
      if (!sourceItem) return prev;
      const suffix = prev.nextSyntheticId;
      const setupToken = sourceItem.setupId ? ` ${sourceItem.setupId}` : '';
      const label = `Custom Setup${setupToken} ${suffix}`;
      const defaultComment = `CUSTOM SETUP${setupToken} ${suffix}`.toUpperCase();
      const groupKey = `synthetic-group:${suffix}`;
      return {
        ...prev,
        reviewModel: createImportReviewGroupFromItem(
          prev.reviewModel,
          itemId,
          groupKey,
          label,
          defaultComment,
        ),
        groupLabels: { ...prev.groupLabels, [groupKey]: label },
        groupComments: { ...prev.groupComments, [groupKey]: defaultComment },
        nextSyntheticId: prev.nextSyntheticId + 1,
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewCreateEmptySetupGroup = useCallback(() => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const suffix = prev.nextSyntheticId;
      const groupKey = `synthetic-group:${suffix}`;
      const label = `Custom Setup ${suffix}`;
      const defaultComment = `CUSTOM SETUP ${suffix}`;
      const lastNonControlGroup =
        [...prev.reviewModel.groups].reverse().find((group) => group.kind !== 'control')?.key ??
        'control';
      return {
        ...prev,
        reviewModel: createEmptyImportReviewGroup(
          prev.reviewModel,
          groupKey,
          label,
          defaultComment,
          lastNonControlGroup,
        ),
        groupLabels: { ...prev.groupLabels, [groupKey]: label },
        groupComments: { ...prev.groupComments, [groupKey]: defaultComment },
        nextSyntheticId: prev.nextSyntheticId + 1,
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewMoveRow = useCallback((itemId: string, groupKey: string) => {
    setImportReviewState((prev) =>
      prev ? { ...prev, reviewModel: moveImportReviewItem(prev.reviewModel, itemId, groupKey) } : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewReorderRow = useCallback((itemId: string, direction: 'up' | 'down') => {
    setImportReviewState((prev) =>
      prev
        ? { ...prev, reviewModel: reorderImportReviewItemWithinGroup(prev.reviewModel, itemId, direction) }
        : prev,
    );
  }, [setImportReviewState]);

  const handleImportReviewRemoveRow = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextExcluded = new Set(prev.excludedItemIds);
      nextExcluded.delete(itemId);
      const nextFixed = new Set(prev.fixedItemIds);
      nextFixed.delete(itemId);
      const nextRowOverrides = { ...prev.rowOverrides };
      const nextRowTypeOverrides = { ...prev.rowTypeOverrides };
      delete nextRowOverrides[itemId];
      delete nextRowTypeOverrides[itemId];
      return {
        ...prev,
        reviewModel: removeImportReviewItem(prev.reviewModel, itemId),
        excludedItemIds: nextExcluded,
        fixedItemIds: nextFixed,
        rowOverrides: nextRowOverrides,
        rowTypeOverrides: nextRowTypeOverrides,
      };
    });
  }, [setImportReviewState]);

  const handleImportReviewRemoveGroup = useCallback((groupKey: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextGroupLabels = { ...prev.groupLabels };
      const nextGroupComments = { ...prev.groupComments };
      delete nextGroupLabels[groupKey];
      delete nextGroupComments[groupKey];
      return {
        ...prev,
        reviewModel: removeImportReviewGroup(prev.reviewModel, groupKey),
        groupLabels: nextGroupLabels,
        groupComments: nextGroupComments,
      };
    });
  }, [setImportReviewState]);

  return { handleImportReviewToggleExclude, handleImportReviewToggleFixed, handleImportReviewSetBulkExcludeMta, handleImportReviewSetBulkExcludeRaw, handleImportReviewConvertSlopeZenithToHd2D, handleImportConflictResolutionChange, handleImportConflictRenameValueChange, handleImportReviewSetGroupExcluded, handleImportReviewCommentChange, handleImportReviewGroupLabelChange, handleImportReviewRowTextChange, handleImportReviewRowTypeChange, handleImportReviewPresetChange, handleImportReviewComparisonModeChange, handleImportReviewDuplicateRow, handleImportReviewInsertCommentBelow, handleImportReviewCreateSetupGroup, handleImportReviewCreateEmptySetupGroup, handleImportReviewMoveRow, handleImportReviewReorderRow, handleImportReviewRemoveRow, handleImportReviewRemoveGroup };
};
