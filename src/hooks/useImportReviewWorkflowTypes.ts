import { appendImportReviewSource, buildImportReviewComparisonSummary, type ImportReviewComparisonMode, type ImportReviewComparisonSummary, type ImportReviewModel, type ImportReviewOutputPreset, type ImportReviewRowTypeOverride, type ImportReviewWorkspaceSource } from '../engine/importReview';
import { buildImportConflictResolutionDefaults, type ImportConflict, type ImportResolution } from '../engine/importConflictReview';
import { type ExternalImportAngleMode, type ImportedDataset, type ImportedInputNotice } from '../engine/importers';
import type { FaceNormalizationMode } from '../types';
import type { PreparedAssociatedProjectSettingsImport } from './useProjectFileWorkflow';

export type FilePickerMode = 'replace' | 'compare';
export type ImportAnglePromptChoice = ExternalImportAngleMode;
export type ImportStyleChoice = 'generic' | 'industry-style';
export type ImportFacePromptChoice = Extract<FaceNormalizationMode, 'on' | 'off'>;

export type PendingAnglePromptFile = {
  file: File;
  pickerMode: FilePickerMode;
  angleMode: ImportAnglePromptChoice;
  faceMode: ImportFacePromptChoice;
  importStyle: ImportStyleChoice;
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
  importStyle: ImportStyleChoice;
  stagedAssociatedSettings?: PreparedAssociatedProjectSettingsImport | null;
  force2DOutput: boolean;
  nextSyntheticId: number;
  nextSourceId: number;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
  resolutionValidationMessage: string | null;
};

const IMPORT_ANGLE_PROMPT_FILE_RE = /\.(jxl|jobxml|htm|html)$/i;

export const requiresImportAngleModePrompt = (fileName: string): boolean =>
  IMPORT_ANGLE_PROMPT_FILE_RE.test(fileName.trim());

export const buildReducedAngleRowTypeOverrides = (
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

export const buildDefaultConflictRenameValues = (conflicts: ImportConflict[]): Record<string, string> => {
  const renameValues: Record<string, string> = {};
  conflicts.forEach((conflict) => {
    if (!conflict.resolutionKey.startsWith('control:')) return;
    if (renameValues[conflict.resolutionKey]) return;
    const token = conflict.targetLabel.trim();
    renameValues[conflict.resolutionKey] = token ? `${token}_IMP` : 'IMPORTED_STATION';
  });
  return renameValues;
};

export const mergeConflictResolutionDefaults = (
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

export const mergeConflictRenameValues = (
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

export const buildImportReviewComparisonSummaryForSources = (
  sources: ImportReviewWorkspaceSource[],
  mode: ImportReviewComparisonMode,
): ImportReviewComparisonSummary | null =>
  sources.length > 1 ? buildImportReviewComparisonSummary(sources, mode) : null;

export const createImportReviewSource = (
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

export const buildWorkspaceFromSources = (
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
