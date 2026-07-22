import { useCallback, type ChangeEvent, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { appendImportReviewSource, buildImportReviewModel, isImportReviewMtaItem } from '../engine/importReview';
import { buildImportConflictResolutionDefaults, type ImportConflict } from '../engine/importConflictReview';
import type { ImportedDataset, ImportedInputNotice } from '../engine/importers';
import type { FaceNormalizationMode } from '../types';
import { buildDefaultConflictRenameValues, buildImportReviewComparisonSummaryForSources, buildReducedAngleRowTypeOverrides, buildWorkspaceFromSources, createImportReviewSource, mergeConflictRenameValues, mergeConflictResolutionDefaults, requiresImportAngleModePrompt, type FilePickerMode, type ImportAnglePromptChoice, type ImportFacePromptChoice, type ImportReviewState, type ImportStyleChoice, type PendingAnglePromptFile } from './useImportReviewWorkflowTypes';

type Args = { fileInputRef: RefObject<HTMLInputElement | null>; settingsFileInputRef?: RefObject<HTMLInputElement | null>; filePickerModeRef: MutableRefObject<FilePickerMode>; faceNormalizationMode: FaceNormalizationMode; importProjectSourceFiles?: (_files: File[]) => Promise<boolean>; applyImportedInput: (_nextInput: string, _notice: ImportedInputNotice | null, _nextIncludeFiles?: Record<string,string>) => void; buildImportConflicts: (_dataset: ImportedDataset) => ImportConflict[]; setImportReviewState: Dispatch<SetStateAction<ImportReviewState | null>>; setPendingAnglePromptFile: Dispatch<SetStateAction<PendingAnglePromptFile | null>>; };

export const useImportReviewFileSelection = ({ fileInputRef, settingsFileInputRef, filePickerModeRef, faceNormalizationMode, importProjectSourceFiles, applyImportedInput, buildImportConflicts, setImportReviewState, setPendingAnglePromptFile }: Args) => {
  const processImportedFileSelection = useCallback(
    (
      file: File,
      pickerMode: FilePickerMode,
      angleMode?: ImportAnglePromptChoice,
      faceMode?: ImportFacePromptChoice,
      importStyle: ImportStyleChoice = 'generic',
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
            const useIndustryStylePreset =
              imported.dataset?.importerId === 'jobxml' && importStyle === 'industry-style';
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
              excludedItemIds: useIndustryStylePreset
                ? new Set(
                    workspace.reviewModel.items
                      .filter((item) => isImportReviewMtaItem(item))
                      .map((item) => item.id),
                  )
                : new Set(),
              fixedItemIds: new Set(),
              groupLabels,
              groupComments,
              rowOverrides: {},
              rowTypeOverrides,
              preset: useIndustryStylePreset
                ? 'industry-style'
                : useDirectionSetPreset
                  ? 'ts-direction-set'
                  : 'clean-webnet',
              importFaceNormalizationMode: selectedFaceMode,
              importAngleMode: angleMode,
              importStyle,
              stagedAssociatedSettings: null,
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
    [applyImportedInput, buildImportConflicts, faceNormalizationMode, setImportReviewState],
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
          importStyle: 'generic',
        });
        return;
      }
      processImportedFileSelection(file, pickerMode);
    },
    [faceNormalizationMode, filePickerModeRef, importProjectSourceFiles, processImportedFileSelection, setPendingAnglePromptFile],
  );

  const triggerFileSelect = useCallback(
    (mode: FilePickerMode = 'replace') => {
      filePickerModeRef.current = mode;
      fileInputRef.current?.click();
    },
    [fileInputRef, filePickerModeRef],
  );

  const triggerImportReviewSettingsFileSelect = useCallback(() => {
    settingsFileInputRef?.current?.click();
  }, [settingsFileInputRef]);

  const handleImportAnglePromptSetAngleMode = useCallback((choice: ImportAnglePromptChoice) => {
    setPendingAnglePromptFile((prev) => (prev ? { ...prev, angleMode: choice } : prev));
  }, [setPendingAnglePromptFile]);

  const handleImportAnglePromptSetFaceMode = useCallback((choice: ImportFacePromptChoice) => {
    setPendingAnglePromptFile((prev) => (prev ? { ...prev, faceMode: choice } : prev));
  }, [setPendingAnglePromptFile]);

  const handleImportAnglePromptSetImportStyle = useCallback((choice: ImportStyleChoice) => {
    setPendingAnglePromptFile((prev) => (prev ? { ...prev, importStyle: choice } : prev));
  }, [setPendingAnglePromptFile]);

  const handleImportAnglePromptAccept = useCallback(() => {
    setPendingAnglePromptFile((prev) => {
      if (!prev) return prev;
      processImportedFileSelection(
        prev.file,
        prev.pickerMode,
        prev.angleMode,
        prev.faceMode,
        prev.importStyle,
      );
      return null;
    });
  }, [processImportedFileSelection, setPendingAnglePromptFile]);

  const handleImportAnglePromptCancel = useCallback(() => {
    setPendingAnglePromptFile(null);
  }, [setPendingAnglePromptFile]);

  return { triggerFileSelect, triggerImportReviewSettingsFileSelect, handleFileChange, handleImportAnglePromptSetAngleMode, handleImportAnglePromptSetFaceMode, handleImportAnglePromptSetImportStyle, handleImportAnglePromptAccept, handleImportAnglePromptCancel };
};
