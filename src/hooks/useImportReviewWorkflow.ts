import { useCallback, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  appendImportReviewSource,
  buildImportReviewComparisonSummary,
  buildImportReviewDisplayTextMap,
  buildImportReviewModel,
  convertImportedDatasetSlopeZenithToHd2D,
  createEmptyImportReviewGroup,
  createImportReviewGroupFromItem,
  duplicateImportReviewItem,
  insertImportReviewCommentRow,
  isImportReviewMtaItem,
  isImportReviewRawMeasurementItem,
  moveImportReviewItem,
  reorderImportReviewItemWithinGroup,
  removeImportReviewGroup,
  removeImportReviewItem,
  type ImportReviewComparisonMode,
  type ImportReviewComparisonSummary,
  type ImportReviewModel,
  type ImportReviewOutputPreset,
  type ImportReviewRowTypeOverride,
  type ImportReviewWorkspaceSource,
} from '../engine/importReview';
import {
  buildImportConflictSummary,
  buildImportConflictResolutionDefaults,
  buildResolvedImportText,
  type ImportConflict,
  type ImportResolution,
} from '../engine/importConflictReview';
import {
  type ExternalImportAngleMode,
  type ImportedDataset,
  type ImportedInputNotice,
} from '../engine/importers';
import type { ImportReviewDraftSnapshot, ParseSettings } from '../appStateTypes';
import type { CoordMode, FaceNormalizationMode, InstrumentLibrary } from '../types';

type FilePickerMode = 'replace' | 'compare';
type ImportAnglePromptChoice = ExternalImportAngleMode;
export type ImportFacePromptChoice = Extract<FaceNormalizationMode, 'on' | 'off'>;

export type PendingAnglePromptFile = {
  file: File;
  pickerMode: FilePickerMode;
  angleMode: ImportAnglePromptChoice;
  faceMode: ImportFacePromptChoice;
};

export type ImportReviewState = {
  sourceName: string;
  notice: ImportedInputNotice;
  sources: ImportReviewWorkspaceSource[];
  dataset: ImportedDataset;
  reviewModel: ImportReviewModel;
  comparisonSummary?: ImportReviewComparisonSummary | null;
  comparisonMode: ImportReviewComparisonMode;
  excludedItemIds: Set<string>;
  fixedItemIds: Set<string>;
  groupLabels: Record<string, string>;
  groupComments: Record<string, string>;
  rowOverrides: Record<string, string>;
  rowTypeOverrides: Record<string, ImportReviewRowTypeOverride>;
  preset: ImportReviewOutputPreset;
  importFaceNormalizationMode: ImportFacePromptChoice;
  importAngleMode?: ImportAnglePromptChoice;
  force2DOutput: boolean;
  nextSyntheticId: number;
  nextSourceId: number;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
  resolutionValidationMessage: string | null;
};

const IMPORT_ANGLE_PROMPT_FILE_RE = /\.(jxl|jobxml|htm|html)$/i;

const requiresImportAngleModePrompt = (fileName: string): boolean =>
  IMPORT_ANGLE_PROMPT_FILE_RE.test(fileName.trim());

const buildReducedAngleRowTypeOverrides = (
  reviewModel: ImportReviewModel,
): Record<string, ImportReviewRowTypeOverride> => {
  const overrides: Record<string, ImportReviewRowTypeOverride> = {};
  reviewModel.items.forEach((item) => {
    if (item.kind !== 'observation') return;
    if (!item.setupId || !item.backsightId) return;
    if (item.sourceObservationKind === 'measurement') {
      overrides[item.id] = 'direction-measurement';
      return;
    }
    if (item.sourceObservationKind === 'angle') {
      overrides[item.id] = 'direction-angle';
    }
  });
  return overrides;
};

const buildDefaultConflictRenameValues = (conflicts: ImportConflict[]): Record<string, string> => {
  const renameValues: Record<string, string> = {};
  conflicts.forEach((conflict) => {
    if (!conflict.resolutionKey.startsWith('control:')) return;
    if (renameValues[conflict.resolutionKey]) return;
    const token = conflict.targetLabel.trim();
    renameValues[conflict.resolutionKey] = token ? `${token}_IMP` : 'IMPORTED_STATION';
  });
  return renameValues;
};

const mergeConflictResolutionDefaults = (
  conflicts: ImportConflict[],
  previousResolutions?: Record<string, ImportResolution>,
): Record<string, ImportResolution> => {
  const defaults = buildImportConflictResolutionDefaults(conflicts);
  if (!previousResolutions) return defaults;
  Object.keys(defaults).forEach((key) => {
    if (previousResolutions[key]) defaults[key] = previousResolutions[key];
  });
  return defaults;
};

const mergeConflictRenameValues = (
  conflicts: ImportConflict[],
  previousRenameValues?: Record<string, string>,
): Record<string, string> => {
  const defaults = buildDefaultConflictRenameValues(conflicts);
  if (!previousRenameValues) return defaults;
  Object.keys(defaults).forEach((key) => {
    if (previousRenameValues[key] != null) defaults[key] = previousRenameValues[key];
  });
  return defaults;
};

const buildImportReviewComparisonSummaryForSources = (
  sources: ImportReviewWorkspaceSource[],
  mode: ImportReviewComparisonMode,
): ImportReviewComparisonSummary | null =>
  sources.length > 1 ? buildImportReviewComparisonSummary(sources, mode) : null;

const createImportReviewSource = (
  key: string,
  sourceName: string,
  notice: ImportedInputNotice,
  dataset: ImportedDataset,
  isPrimary: boolean,
): ImportReviewWorkspaceSource => ({
  key,
  sourceName,
  notice,
  dataset,
  isPrimary,
});

const buildWorkspaceFromSources = (
  sources: ImportReviewWorkspaceSource[],
): { dataset: ImportedDataset; reviewModel: ImportReviewModel } => {
  const emptyDataset: ImportedDataset = {
    importerId: sources[0]?.dataset.importerId ?? 'workspace',
    formatLabel: sources[0]?.dataset.formatLabel ?? 'Workspace',
    summary: sources[0]?.dataset.summary ?? 'workspace',
    notice: sources[0]?.dataset.notice ?? { title: 'Workspace', detailLines: [] },
    comments: [],
    controlStations: [],
    observations: [],
    trace: [],
  };
  const emptyModel: ImportReviewModel = {
    groups: [],
    items: [],
    warnings: [],
    errors: [],
  };

  return sources.reduce(
    (workspace, source) =>
      appendImportReviewSource(workspace.dataset, workspace.reviewModel, source),
    { dataset: emptyDataset, reviewModel: emptyModel },
  );
};

interface UseImportReviewWorkflowArgs {
  coordMode: CoordMode;
  currentInput: string;
  currentIncludeFiles: Record<string, string>;
  faceNormalizationMode: FaceNormalizationMode;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importProjectSourceFiles?: (_files: File[]) => Promise<boolean>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>;
  resetWorkspaceForImportedInput: () => void;
}

export const useImportReviewWorkflow = ({
  coordMode,
  currentInput,
  currentIncludeFiles,
  faceNormalizationMode,
  fileInputRef,
  importProjectSourceFiles,
  parseSettings,
  projectInstruments,
  setInput,
  setProjectIncludeFiles,
  setImportNotice,
  resetWorkspaceForImportedInput,
}: UseImportReviewWorkflowArgs) => {
  const [importReviewState, setImportReviewState] = useState<ImportReviewState | null>(null);
  const [pendingAnglePromptFile, setPendingAnglePromptFile] =
    useState<PendingAnglePromptFile | null>(null);
  const filePickerModeRef = useRef<FilePickerMode>('replace');

  const buildImportConflicts = useCallback(
    (dataset: ImportedDataset) =>
      buildImportConflictSummary({
        currentInput,
        currentIncludeFiles,
        parseSettings,
        projectInstruments,
        importedDataset: dataset,
      }),
    [currentIncludeFiles, currentInput, parseSettings, projectInstruments],
  );

  const resetImportReviewWorkflow = useCallback(() => {
    setImportReviewState(null);
    setPendingAnglePromptFile(null);
    filePickerModeRef.current = 'replace';
  }, []);

  const applyImportedInput = useCallback(
    (
      nextInput: string,
      notice: ImportedInputNotice | null,
      nextIncludeFiles: Record<string, string> = {},
    ) => {
      setInput(nextInput);
      setProjectIncludeFiles(nextIncludeFiles);
      setImportNotice(notice);
      resetWorkspaceForImportedInput();
      setImportReviewState(null);
      setPendingAnglePromptFile(null);
      filePickerModeRef.current = 'replace';
    },
    [resetWorkspaceForImportedInput, setImportNotice, setInput, setProjectIncludeFiles],
  );

  const processImportedFileSelection = useCallback(
    (
      file: File,
      pickerMode: FilePickerMode,
      angleMode?: ImportAnglePromptChoice,
      faceMode?: ImportFacePromptChoice,
    ) => {
      const reader = new FileReader();
      reader.onload = () => {
        void (async () => {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const { importExternalInput } = await import('../engine/importers');
          const imported = importExternalInput(
            text,
            file.name,
            angleMode != null ? { angleMode } : {},
          );
          if (pickerMode === 'compare') {
            if (imported.detected && imported.dataset && imported.notice) {
              setImportReviewState((prev) =>
                prev
                  ? (() => {
                      const nextSource = createImportReviewSource(
                        `source:${prev.nextSourceId}`,
                        file.name,
                        imported.notice!,
                        imported.dataset!,
                        false,
                      );
                      const nextSources = [...prev.sources, nextSource];
                      const nextWorkspace = appendImportReviewSource(
                        prev.dataset,
                        prev.reviewModel,
                        nextSource,
                      );
                      const nextSourceModel = buildImportReviewModel(nextSource.dataset);
                      const nextGroupLabels = { ...prev.groupLabels };
                      const nextGroupComments = { ...prev.groupComments };
                      nextSourceModel.groups.forEach((group) => {
                        nextGroupLabels[`${nextSource.key}:${group.key}`] = group.label;
                        nextGroupComments[`${nextSource.key}:${group.key}`] = group.defaultComment;
                      });
                      const nextConflicts = buildImportConflicts(nextWorkspace.dataset);
                      return {
                        ...prev,
                        sources: nextSources,
                        dataset: nextWorkspace.dataset,
                        reviewModel: nextWorkspace.reviewModel,
                        groupLabels: nextGroupLabels,
                        groupComments: nextGroupComments,
                        comparisonSummary: buildImportReviewComparisonSummaryForSources(
                          nextSources,
                          prev.comparisonMode,
                        ),
                        nextSourceId: prev.nextSourceId + 1,
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
                    })()
                  : prev,
              );
            }
            return;
          }

          if (imported.detected && imported.dataset && imported.notice) {
            const primarySource = createImportReviewSource(
              'source:0',
              file.name,
              imported.notice!,
              imported.dataset!,
              true,
            );
            const workspace = buildWorkspaceFromSources([primarySource]);
            const conflicts = buildImportConflicts(workspace.dataset);
            const importedPromptedFile = requiresImportAngleModePrompt(file.name);
            const useReducedDirectionPreset = importedPromptedFile && angleMode === 'reduced';
            const useDirectionSetPreset =
              importedPromptedFile && (angleMode === 'reduced' || faceMode != null);
            const rowTypeOverrides = useReducedDirectionPreset
              ? buildReducedAngleRowTypeOverrides(workspace.reviewModel)
              : {};
            const selectedFaceMode: ImportFacePromptChoice =
              faceMode ?? (faceNormalizationMode === 'off' ? 'off' : 'on');
            const groupComments = Object.fromEntries(
              workspace.reviewModel.groups.map((group) => [group.key, group.defaultComment]),
            );
            const groupLabels = Object.fromEntries(
              workspace.reviewModel.groups.map((group) => [group.key, group.label]),
            );
            setImportReviewState({
              sourceName: file.name,
              notice: imported.notice,
              sources: [primarySource],
              dataset: workspace.dataset,
              reviewModel: workspace.reviewModel,
              comparisonSummary: null,
              comparisonMode: 'non-mta-only',
              excludedItemIds: new Set(),
              fixedItemIds: new Set(),
              groupLabels,
              groupComments,
              rowOverrides: {},
              rowTypeOverrides,
              preset: useDirectionSetPreset ? 'ts-direction-set' : 'clean-webnet',
              importFaceNormalizationMode: selectedFaceMode,
              importAngleMode: angleMode,
              force2DOutput: false,
              nextSyntheticId: 1,
              nextSourceId: 1,
              conflicts,
              conflictResolutions: buildImportConflictResolutionDefaults(conflicts),
              conflictRenameValues: buildDefaultConflictRenameValues(conflicts),
              resolutionValidationMessage: null,
            });
            return;
          }

          applyImportedInput(imported.text, imported.notice ?? null);
        })();
      };
      reader.readAsText(file);
    },
    [applyImportedInput, buildImportConflicts, faceNormalizationMode],
  );

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const file = files[0];
      if (!file) return;
      const pickerMode = filePickerModeRef.current;
      filePickerModeRef.current = 'replace';
      e.target.value = '';
      if (
        pickerMode === 'replace' &&
        importProjectSourceFiles &&
        files.every((entry) => /\.dat$/i.test(entry.name))
      ) {
        const handled = await importProjectSourceFiles(files);
        if (handled) return;
      }
      if (requiresImportAngleModePrompt(file.name)) {
        setPendingAnglePromptFile({
          file,
          pickerMode,
          angleMode: 'reduced',
          faceMode: faceNormalizationMode === 'off' ? 'off' : 'on',
        });
        return;
      }
      processImportedFileSelection(file, pickerMode);
    },
    [faceNormalizationMode, importProjectSourceFiles, processImportedFileSelection],
  );

  const triggerFileSelect = useCallback(
    (mode: FilePickerMode = 'replace') => {
      filePickerModeRef.current = mode;
      fileInputRef.current?.click();
    },
    [fileInputRef],
  );

  const handleImportAnglePromptSetAngleMode = useCallback((choice: ImportAnglePromptChoice) => {
    setPendingAnglePromptFile((prev) => (prev ? { ...prev, angleMode: choice } : prev));
  }, []);

  const handleImportAnglePromptSetFaceMode = useCallback((choice: ImportFacePromptChoice) => {
    setPendingAnglePromptFile((prev) => (prev ? { ...prev, faceMode: choice } : prev));
  }, []);

  const handleImportAnglePromptAccept = useCallback(() => {
    setPendingAnglePromptFile((prev) => {
      if (!prev) return prev;
      processImportedFileSelection(prev.file, prev.pickerMode, prev.angleMode, prev.faceMode);
      return null;
    });
  }, [processImportedFileSelection]);

  const handleImportAnglePromptCancel = useCallback(() => {
    setPendingAnglePromptFile(null);
  }, []);

  const handleImportReviewToggleExclude = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextExcluded = new Set(prev.excludedItemIds);
      if (nextExcluded.has(itemId)) nextExcluded.delete(itemId);
      else nextExcluded.add(itemId);
      return { ...prev, excludedItemIds: nextExcluded };
    });
  }, []);

  const handleImportReviewToggleFixed = useCallback((itemId: string) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const nextFixed = new Set(prev.fixedItemIds);
      if (nextFixed.has(itemId)) nextFixed.delete(itemId);
      else nextFixed.add(itemId);
      return { ...prev, fixedItemIds: nextFixed };
    });
  }, []);

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
  }, []);

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
  }, []);

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
  }, [buildImportConflicts]);

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
    [],
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
  }, []);

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
  }, []);

  const handleImportReviewCommentChange = useCallback((groupKey: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            groupComments: { ...prev.groupComments, [groupKey]: value },
          }
        : prev,
    );
  }, []);

  const handleImportReviewGroupLabelChange = useCallback((groupKey: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            groupLabels: { ...prev.groupLabels, [groupKey]: value },
          }
        : prev,
    );
  }, []);

  const handleImportReviewRowTextChange = useCallback((itemId: string, value: string) => {
    setImportReviewState((prev) =>
      prev
        ? {
            ...prev,
            rowOverrides: { ...prev.rowOverrides, [itemId]: value },
          }
        : prev,
    );
  }, []);

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
    [],
  );

  const handleImportReviewPresetChange = useCallback((preset: ImportReviewOutputPreset) => {
    setImportReviewState((prev) => (prev ? { ...prev, preset } : prev));
  }, []);

  const handleImportReviewComparisonModeChange = useCallback((mode: ImportReviewComparisonMode) => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        comparisonMode: mode,
        comparisonSummary: buildImportReviewComparisonSummaryForSources(prev.sources, mode),
      };
    });
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

  const handleImportReviewMoveRow = useCallback((itemId: string, groupKey: string) => {
    setImportReviewState((prev) =>
      prev ? { ...prev, reviewModel: moveImportReviewItem(prev.reviewModel, itemId, groupKey) } : prev,
    );
  }, []);

  const handleImportReviewReorderRow = useCallback((itemId: string, direction: 'up' | 'down') => {
    setImportReviewState((prev) =>
      prev
        ? { ...prev, reviewModel: reorderImportReviewItemWithinGroup(prev.reviewModel, itemId, direction) }
        : prev,
    );
  }, []);

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
  }, []);

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
  }, []);

  const handleCancelImportReview = useCallback(() => {
    setImportReviewState(null);
  }, []);

  const handleImportReviewCompareFile = useCallback(() => {
    triggerFileSelect('compare');
  }, [triggerFileSelect]);

  const handleImportReviewClearComparison = useCallback(() => {
    setImportReviewState((prev) => {
      if (!prev) return prev;
      const primarySources = prev.sources.filter((source) => source.isPrimary);
      const nextWorkspace = buildWorkspaceFromSources(primarySources);
      const nextItemIds = new Set(nextWorkspace.reviewModel.items.map((item) => item.id));
      const nextExcludedItemIds = new Set(
        [...prev.excludedItemIds].filter((itemId) => nextItemIds.has(itemId)),
      );
      const nextFixedItemIds = new Set(
        [...prev.fixedItemIds].filter((itemId) => nextItemIds.has(itemId)),
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
        sources: primarySources,
        dataset: nextWorkspace.dataset,
        reviewModel: nextWorkspace.reviewModel,
        excludedItemIds: nextExcludedItemIds,
        fixedItemIds: nextFixedItemIds,
        groupLabels: nextGroupLabels,
        groupComments: nextGroupComments,
        comparisonSummary: null,
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
  }, [buildImportConflicts]);

  const importReviewSnapshot = useMemo<ImportReviewDraftSnapshot | null>(() => {
    if (!importReviewState) return null;
    return {
      sourceName: importReviewState.sourceName,
      notice: importReviewState.notice,
      sources: importReviewState.sources,
      dataset: importReviewState.dataset,
      reviewModel: importReviewState.reviewModel,
      comparisonMode: importReviewState.comparisonMode,
      excludedItemIds: [...importReviewState.excludedItemIds],
      fixedItemIds: [...importReviewState.fixedItemIds],
      groupLabels: { ...importReviewState.groupLabels },
      groupComments: { ...importReviewState.groupComments },
      rowOverrides: { ...importReviewState.rowOverrides },
      rowTypeOverrides: { ...importReviewState.rowTypeOverrides },
      preset: importReviewState.preset,
      importFaceNormalizationMode: importReviewState.importFaceNormalizationMode,
      importAngleMode: importReviewState.importAngleMode,
      force2DOutput: importReviewState.force2DOutput,
      nextSyntheticId: importReviewState.nextSyntheticId,
      nextSourceId: importReviewState.nextSourceId,
      conflicts: importReviewState.conflicts,
      conflictResolutions: { ...importReviewState.conflictResolutions },
      conflictRenameValues: { ...importReviewState.conflictRenameValues },
    };
  }, [importReviewState]);

  const restoreImportReviewWorkflow = useCallback((snapshot: ImportReviewDraftSnapshot | null) => {
    if (!snapshot) {
      setImportReviewState(null);
      setPendingAnglePromptFile(null);
      filePickerModeRef.current = 'replace';
      return;
    }
    const legacySnapshot = snapshot as ImportReviewDraftSnapshot & {
      comparisonSourceName?: string;
      comparisonNotice?: ImportedInputNotice;
      comparisonDataset?: ImportedDataset;
      sources?: ImportReviewWorkspaceSource[];
      nextSourceId?: number;
    };
    const restoredSources =
      legacySnapshot.sources && legacySnapshot.sources.length > 0
        ? legacySnapshot.sources
        : [
            createImportReviewSource(
              'source:0',
              snapshot.sourceName,
              snapshot.notice,
              snapshot.dataset,
              true,
            ),
            ...(legacySnapshot.comparisonDataset && legacySnapshot.comparisonSourceName
              ? [
                  createImportReviewSource(
                    'source:1',
                    legacySnapshot.comparisonSourceName,
                    legacySnapshot.comparisonNotice ?? legacySnapshot.comparisonDataset.notice,
                    legacySnapshot.comparisonDataset,
                    false,
                  ),
                ]
              : []),
          ];
    setImportReviewState({
      sourceName: snapshot.sourceName,
      notice: snapshot.notice,
      sources: restoredSources,
      dataset: snapshot.dataset,
      reviewModel: snapshot.reviewModel,
      comparisonSummary: buildImportReviewComparisonSummaryForSources(
        restoredSources,
        snapshot.comparisonMode,
      ),
      comparisonMode: snapshot.comparisonMode,
      excludedItemIds: new Set(snapshot.excludedItemIds),
      fixedItemIds: new Set(snapshot.fixedItemIds),
      groupLabels: { ...snapshot.groupLabels },
      groupComments: { ...snapshot.groupComments },
      rowOverrides: { ...snapshot.rowOverrides },
      rowTypeOverrides: { ...snapshot.rowTypeOverrides },
      preset: snapshot.preset,
      importFaceNormalizationMode: snapshot.importFaceNormalizationMode,
      importAngleMode: snapshot.importAngleMode,
      force2DOutput: snapshot.force2DOutput,
      nextSyntheticId: snapshot.nextSyntheticId,
      nextSourceId: legacySnapshot.nextSourceId ?? restoredSources.length,
      conflicts: snapshot.conflicts,
      conflictResolutions: mergeConflictResolutionDefaults(
        snapshot.conflicts,
        snapshot.conflictResolutions,
      ),
      conflictRenameValues: mergeConflictRenameValues(
        snapshot.conflicts,
        snapshot.conflictRenameValues,
      ),
      resolutionValidationMessage: null,
    });
    setPendingAnglePromptFile(null);
    filePickerModeRef.current = 'replace';
  }, []);

  const handleApplyImportReview = useCallback(() => {
    if (!importReviewState) return;
    const includedItemIds = new Set(
      importReviewState.reviewModel.items
        .filter((item) => !importReviewState.excludedItemIds.has(item.id))
        .map((item) => item.id),
    );
    const { text, missingRenameKeys } = buildResolvedImportText({
      currentInput,
      currentIncludeFiles,
      parseSettings,
      projectInstruments,
      importedDataset: importReviewState.dataset,
      reviewModel: importReviewState.reviewModel,
      includedItemIds,
      groupComments: importReviewState.groupComments,
      rowOverrides: importReviewState.rowOverrides,
      rowTypeOverrides: importReviewState.rowTypeOverrides,
      fixedItemIds: importReviewState.fixedItemIds,
      preset: importReviewState.preset,
      faceNormalizationMode: importReviewState.importFaceNormalizationMode,
      coordMode: importReviewState.force2DOutput ? '2D' : coordMode,
      force2D: importReviewState.force2DOutput,
      conflicts: importReviewState.conflicts,
      conflictResolutions: importReviewState.conflictResolutions,
      conflictRenameValues: importReviewState.conflictRenameValues,
    });
    if (missingRenameKeys.length > 0) {
      setImportReviewState((prev) =>
        prev
          ? {
              ...prev,
              resolutionValidationMessage:
                'Enter a replacement station ID for every conflict set to Rename Incoming before importing.',
            }
          : prev,
      );
      return;
    }
    applyImportedInput(text, importReviewState.notice, currentIncludeFiles);
  }, [
    applyImportedInput,
    coordMode,
    currentIncludeFiles,
    currentInput,
    importReviewState,
    parseSettings,
    projectInstruments,
  ]);

  const importReviewDisplayedRows = useMemo(() => {
    if (!importReviewState) return {};
    return buildImportReviewDisplayTextMap(
      importReviewState.dataset,
      importReviewState.reviewModel,
      importReviewState.preset,
      importReviewState.force2DOutput ? '2D' : coordMode,
      importReviewState.rowOverrides,
      importReviewState.force2DOutput,
    );
  }, [coordMode, importReviewState]);

  const importReviewMoveTargetGroups = useMemo(() => {
    if (!importReviewState) return [];
    return importReviewState.reviewModel.groups
      .filter((group) => group.kind !== 'control')
      .map((group) => ({
        key: group.key,
        label: importReviewState.groupLabels[group.key] ?? group.label,
      }));
  }, [importReviewState]);

  return {
    importReviewState,
    pendingAnglePromptFile,
    triggerFileSelect,
    handleFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptAccept,
    handleImportAnglePromptCancel,
    handleImportReviewToggleExclude,
    handleImportReviewToggleFixed,
    handleImportReviewSetBulkExcludeMta,
    handleImportReviewSetBulkExcludeRaw,
    handleImportReviewConvertSlopeZenithToHd2D,
    handleImportReviewSetGroupExcluded,
    handleImportReviewCommentChange,
    handleImportReviewGroupLabelChange,
    handleImportReviewRowTextChange,
    handleImportReviewRowTypeChange,
    handleImportReviewPresetChange,
    handleImportReviewComparisonModeChange,
    handleImportConflictResolutionChange,
    handleImportConflictRenameValueChange,
    handleImportReviewDuplicateRow,
    handleImportReviewInsertCommentBelow,
    handleImportReviewCreateSetupGroup,
    handleImportReviewCreateEmptySetupGroup,
    handleImportReviewMoveRow,
    handleImportReviewReorderRow,
    handleImportReviewRemoveRow,
    handleImportReviewRemoveGroup,
    handleCancelImportReview,
    handleImportReviewCompareFile,
    handleImportReviewClearComparison,
    handleApplyImportReview,
    importReviewDisplayedRows,
    importReviewMoveTargetGroups,
    importReviewSnapshot,
    restoreImportReviewWorkflow,
    resetImportReviewWorkflow,
  };
};
