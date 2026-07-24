import type { ImportConflict, ImportResolution } from '../../engine/importConflictReview';
import type {
  ImportReviewComparisonMode,
  ImportReviewComparisonSummary,
  ImportReviewModel,
  ImportReviewOutputPreset,
  ImportReviewRowTypeOverride,
} from '../../engine/importReview';

export interface ImportReviewModalProps {
  sourceName: string;
  title: string;
  detailLines: string[];
  reviewModel: ImportReviewModel;
  comparisonSummary?: ImportReviewComparisonSummary | null;
  comparisonMode: ImportReviewComparisonMode;
  displayedRows: Record<string, string>;
  excludedItemIds: Set<string>;
  fixedItemIds: Set<string>;
  groupLabels: Record<string, string>;
  groupComments: Record<string, string>;
  rowTypeOverrides: Record<string, ImportReviewRowTypeOverride>;
  preset: ImportReviewOutputPreset;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
  resolutionValidationMessage?: string | null;
  moveTargetGroups: Array<{ key: string; label: string }>;
  onCompareFile: () => void;
  onClearComparison: () => void;
  onComparisonModeChange: (_mode: ImportReviewComparisonMode) => void;
  onPresetChange: (_preset: ImportReviewOutputPreset) => void;
  onSetBulkExcludeMta: (_excluded: boolean) => void;
  onSetBulkExcludeRaw: (_excluded: boolean) => void;
  onConvertSlopeZenithToHd2D: () => void;
  onSetGroupExcluded: (_groupKey: string, _excluded: boolean) => void;
  onConflictResolutionChange: (_resolutionKey: string, _resolution: ImportResolution) => void;
  onConflictRenameValueChange: (_resolutionKey: string, _value: string) => void;
  onToggleExclude: (_itemId: string) => void;
  onToggleFixed: (_itemId: string) => void;
  onCreateEmptySetupGroup: () => void;
  onGroupLabelChange: (_groupKey: string, _value: string) => void;
  onCommentChange: (_groupKey: string, _value: string) => void;
  onRowTextChange: (_itemId: string, _value: string) => void;
  onRowTypeChange: (_itemId: string, _value: ImportReviewRowTypeOverride) => void;
  onDuplicateRow: (_itemId: string) => void;
  onInsertCommentBelow: (_itemId: string) => void;
  onCreateSetupGroup: (_itemId: string) => void;
  onMoveRow: (_itemId: string, _groupKey: string) => void;
  onReorderRow: (_itemId: string, _direction: 'up' | 'down') => void;
  onRemoveGroup: (_groupKey: string) => void;
  onRemoveRow: (_itemId: string) => void;
  onCancel: () => void;
  onImportAsNewFile: () => void;
  onImportAssociatedProjectSettings: () => void;
  pendingAssociatedSettingsSourceName?: string | null;
  pendingAssociatedSettingsSummary?: string | null;
  onImport: () => void;
}
