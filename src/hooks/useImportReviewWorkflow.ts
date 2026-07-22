import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { buildImportConflictSummary } from '../engine/importConflictReview';
import { type ImportedDataset, type ImportedInputNotice } from '../engine/importers';
import type { ParseSettings } from '../appStateTypes';
import type { CoordMode, FaceNormalizationMode, InstrumentLibrary } from '../types';
import type { PreparedAssociatedProjectSettingsImport } from './useProjectFileWorkflow';
import { useImportReviewFileSelection } from './useImportReviewFileSelection';
import { useImportReviewEditActions } from './useImportReviewEditActions';
import { useImportReviewApplyActions } from './useImportReviewApplyActions';
import { type FilePickerMode, type ImportReviewState, type PendingAnglePromptFile } from './useImportReviewWorkflowTypes';
export type { ImportFacePromptChoice, PendingAnglePromptFile } from './useImportReviewWorkflowTypes';

interface UseImportReviewWorkflowArgs {
  coordMode: CoordMode;
  currentInput: string;
  currentIncludeFiles: Record<string, string>;
  faceNormalizationMode: FaceNormalizationMode;
  fileInputRef: RefObject<HTMLInputElement | null>;
  settingsFileInputRef?: RefObject<HTMLInputElement | null>;
  importProjectSourceFiles?: (_files: File[]) => Promise<boolean>;
  importGeneratedProjectSourceFile?: (_params: { sourceName: string; text: string }) => Promise<boolean>;
  prepareAssociatedProjectSettingsImport?: (
    _file: File,
  ) => Promise<PreparedAssociatedProjectSettingsImport | null>;
  applyPreparedAssociatedProjectSettings?: (
    _prepared: PreparedAssociatedProjectSettingsImport,
    _options?: {
      successTitle?: string;
      failureTitle?: string;
      successDetailPrefix?: string[];
      failureDetailPrefix?: string[];
    },
  ) => Promise<boolean>;
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
  settingsFileInputRef,
  importProjectSourceFiles,
  importGeneratedProjectSourceFile,
  prepareAssociatedProjectSettingsImport,
  applyPreparedAssociatedProjectSettings,
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

  const {
    triggerFileSelect,
    triggerImportReviewSettingsFileSelect,
    handleFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptSetImportStyle,
    handleImportAnglePromptAccept,
    handleImportAnglePromptCancel,
  } = useImportReviewFileSelection({
    fileInputRef, settingsFileInputRef, filePickerModeRef, faceNormalizationMode,
    importProjectSourceFiles, applyImportedInput, buildImportConflicts,
    setImportReviewState, setPendingAnglePromptFile,
  });

  const { handleImportReviewToggleExclude, handleImportReviewToggleFixed, handleImportReviewSetBulkExcludeMta, handleImportReviewSetBulkExcludeRaw, handleImportReviewConvertSlopeZenithToHd2D, handleImportConflictResolutionChange, handleImportConflictRenameValueChange, handleImportReviewSetGroupExcluded, handleImportReviewCommentChange, handleImportReviewGroupLabelChange, handleImportReviewRowTextChange, handleImportReviewRowTypeChange, handleImportReviewPresetChange, handleImportReviewComparisonModeChange, handleImportReviewDuplicateRow, handleImportReviewInsertCommentBelow, handleImportReviewCreateSetupGroup, handleImportReviewCreateEmptySetupGroup, handleImportReviewMoveRow, handleImportReviewReorderRow, handleImportReviewRemoveRow, handleImportReviewRemoveGroup } = useImportReviewEditActions({
    setImportReviewState,
    buildImportConflicts,
  });

  const { handleCancelImportReview, handleImportReviewCompareFile, handleImportReviewClearComparison, handleApplyImportReview, handleApplyImportReviewAsNewFile, handleImportReviewSettingsFileChange, importReviewDisplayedRows, importReviewMoveTargetGroups, importReviewSnapshot, restoreImportReviewWorkflow } = useImportReviewApplyActions({
    importReviewState, setImportReviewState, setPendingAnglePromptFile, filePickerModeRef,
    triggerFileSelect, buildImportConflicts, currentInput, currentIncludeFiles, parseSettings,
    projectInstruments, coordMode, setInput, setProjectIncludeFiles, setImportNotice,
    resetWorkspaceForImportedInput, importGeneratedProjectSourceFile,
    prepareAssociatedProjectSettingsImport, applyPreparedAssociatedProjectSettings,
  });

  return {
    importReviewState,
    pendingAnglePromptFile,
    triggerFileSelect,
    triggerImportReviewSettingsFileSelect,
    handleFileChange,
    handleImportReviewSettingsFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptSetImportStyle,
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
    handleApplyImportReviewAsNewFile,
    importReviewDisplayedRows,
    importReviewMoveTargetGroups,
    importReviewSnapshot,
    restoreImportReviewWorkflow,
    resetImportReviewWorkflow,
  };
};
