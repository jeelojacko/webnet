import { useCallback, useMemo, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { buildImportReviewDisplayTextMap, type ImportReviewWorkspaceSource } from '../engine/importReview';
import { buildResolvedImportText, type ImportConflict } from '../engine/importConflictReview';
import type { ImportedDataset, ImportedInputNotice } from '../engine/importers';
import type { ImportReviewDraftSnapshot, ParseSettings } from '../appStateTypes';
import type { CoordMode, InstrumentLibrary } from '../types';
import type { PreparedAssociatedProjectSettingsImport } from './useProjectFileWorkflow';
import { buildImportReviewComparisonSummaryForSources, buildWorkspaceFromSources, createImportReviewSource, mergeConflictRenameValues, mergeConflictResolutionDefaults, type FilePickerMode, type ImportReviewState, type PendingAnglePromptFile } from './useImportReviewWorkflowTypes';

type Args = { importReviewState: ImportReviewState | null; setImportReviewState: Dispatch<SetStateAction<ImportReviewState | null>>; setPendingAnglePromptFile: Dispatch<SetStateAction<PendingAnglePromptFile | null>>; filePickerModeRef: MutableRefObject<FilePickerMode>; triggerFileSelect: (_mode?: FilePickerMode) => void; buildImportConflicts: (_dataset: ImportedDataset) => ImportConflict[]; currentInput: string; currentIncludeFiles: Record<string,string>; parseSettings: ParseSettings; projectInstruments: InstrumentLibrary; coordMode: CoordMode; setInput: Dispatch<SetStateAction<string>>; setProjectIncludeFiles: Dispatch<SetStateAction<Record<string,string>>>; setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>; resetWorkspaceForImportedInput: () => void; importGeneratedProjectSourceFile?: (_params: { sourceName: string; text: string }) => Promise<boolean>; prepareAssociatedProjectSettingsImport?: (_file: File) => Promise<PreparedAssociatedProjectSettingsImport | null>; applyPreparedAssociatedProjectSettings?: (_prepared: PreparedAssociatedProjectSettingsImport, _options?: { successTitle?: string; failureTitle?: string; successDetailPrefix?: string[]; failureDetailPrefix?: string[] }) => Promise<boolean>; };

export const useImportReviewApplyActions = ({ importReviewState, setImportReviewState, setPendingAnglePromptFile, filePickerModeRef, triggerFileSelect, buildImportConflicts, currentInput, currentIncludeFiles, parseSettings, projectInstruments, coordMode, setInput, setProjectIncludeFiles, setImportNotice, resetWorkspaceForImportedInput, importGeneratedProjectSourceFile, prepareAssociatedProjectSettingsImport, applyPreparedAssociatedProjectSettings }: Args) => {
  const handleCancelImportReview = useCallback(() => {
    setImportReviewState(null);
  }, [setImportReviewState]);

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
  }, [buildImportConflicts, setImportReviewState]);

  const finalizeAppliedImportReview = useCallback(() => {
    setImportReviewState(null);
    setPendingAnglePromptFile(null);
    filePickerModeRef.current = 'replace';
    resetWorkspaceForImportedInput();
  }, [filePickerModeRef, resetWorkspaceForImportedInput, setImportReviewState, setPendingAnglePromptFile]);

  const buildResolvedImportReview = useCallback(() => {
    if (!importReviewState) return null;
    const includedItemIds = new Set(
      importReviewState.reviewModel.items
        .filter((item) => !importReviewState.excludedItemIds.has(item.id))
        .map((item) => item.id),
    );
    return buildResolvedImportText({
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
  }, [
    coordMode,
    currentIncludeFiles,
    currentInput,
    importReviewState,
    parseSettings,
    projectInstruments,
  ]);

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
      importStyle: importReviewState.importStyle,
      stagedAssociatedSettings: importReviewState.stagedAssociatedSettings ?? null,
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
      importStyle: snapshot.importStyle ?? 'generic',
      stagedAssociatedSettings: snapshot.stagedAssociatedSettings ?? null,
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
  }, [filePickerModeRef, setImportReviewState, setPendingAnglePromptFile]);

  const handleApplyImportReview = useCallback(() => {
    if (!importReviewState) return;
    const resolved = buildResolvedImportReview();
    if (!resolved) return;
    const { text, missingRenameKeys } = resolved;
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
    setInput(text);
    setProjectIncludeFiles(currentIncludeFiles);
    resetWorkspaceForImportedInput();
    const stagedSettings = importReviewState.stagedAssociatedSettings;
    if (!stagedSettings || !applyPreparedAssociatedProjectSettings) {
      setImportNotice(importReviewState.notice);
      finalizeAppliedImportReview();
      return;
    }
    void (async () => {
      const applied = await applyPreparedAssociatedProjectSettings(stagedSettings, {
        successTitle: 'Imported rows and applied settings',
        successDetailPrefix: ['Imported reviewed rows into the current editor workspace.'],
        failureDetailPrefix: ['Imported reviewed rows into the current editor workspace.'],
      });
      if (applied) finalizeAppliedImportReview();
    })();
  }, [
    applyPreparedAssociatedProjectSettings,
    buildResolvedImportReview,
    currentIncludeFiles,
    finalizeAppliedImportReview,
    importReviewState,
    resetWorkspaceForImportedInput,
    setImportNotice,
    setInput,
    setProjectIncludeFiles,
    setImportReviewState,
  ]);

  const handleApplyImportReviewAsNewFile = useCallback(async () => {
    if (!importReviewState || !importGeneratedProjectSourceFile) return;
    const resolved = buildResolvedImportReview();
    if (!resolved) return;
    const { text, missingRenameKeys } = resolved;
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
    const handled = await importGeneratedProjectSourceFile({
      sourceName: importReviewState.sourceName,
      text,
    });
    if (!handled) return;
    const stagedSettings = importReviewState.stagedAssociatedSettings;
    if (!stagedSettings || !applyPreparedAssociatedProjectSettings) {
      finalizeAppliedImportReview();
      return;
    }
    const applied = await applyPreparedAssociatedProjectSettings(stagedSettings, {
      successTitle: 'Project source file added and settings applied',
      successDetailPrefix: ['Added imported review output to the current project workspace.'],
      failureDetailPrefix: ['Imported review output was added to the current project workspace.'],
    });
    if (applied) finalizeAppliedImportReview();
  }, [
    applyPreparedAssociatedProjectSettings,
    buildResolvedImportReview,
    finalizeAppliedImportReview,
    importGeneratedProjectSourceFile,
    importReviewState,
    setImportReviewState,
  ]);

  const handleImportReviewSettingsFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !prepareAssociatedProjectSettingsImport) return;
      e.target.value = '';
      const prepared = await prepareAssociatedProjectSettingsImport(file);
      if (!prepared) return;
      setImportReviewState((prev) =>
        prev
          ? {
              ...prev,
              stagedAssociatedSettings: prepared,
            }
          : prev,
      );
    },
    [prepareAssociatedProjectSettingsImport, setImportReviewState],
  );

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

  return { handleCancelImportReview, handleImportReviewCompareFile, handleImportReviewClearComparison, handleApplyImportReview, handleApplyImportReviewAsNewFile, handleImportReviewSettingsFileChange, importReviewDisplayedRows, importReviewMoveTargetGroups, importReviewSnapshot, restoreImportReviewWorkflow };
};
