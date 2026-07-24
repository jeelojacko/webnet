import React from 'react';
import type { ImportReviewItem } from '../engine/importReview';
import ImportReviewComparisonSection from './importReviewModal/ImportReviewComparisonSection';
import ImportReviewConflictSection from './importReviewModal/ImportReviewConflictSection';
import ImportReviewDiagnosticsSection from './importReviewModal/ImportReviewDiagnosticsSection';
import ImportReviewGroupSection from './importReviewModal/ImportReviewGroupSection';
import ImportReviewModalFooter from './importReviewModal/ImportReviewModalFooter';
import ImportReviewModalHeader from './importReviewModal/ImportReviewModalHeader';
import type { ImportReviewModalProps } from './importReviewModal/ImportReviewModal.types';

const ImportReviewModal: React.FC<ImportReviewModalProps> = ({
  sourceName,
  title,
  detailLines,
  reviewModel,
  comparisonSummary = null,
  comparisonMode,
  displayedRows,
  excludedItemIds,
  fixedItemIds,
  groupLabels,
  groupComments,
  rowTypeOverrides,
  preset,
  conflicts,
  conflictResolutions,
  conflictRenameValues,
  resolutionValidationMessage = null,
  moveTargetGroups,
  onCompareFile,
  onClearComparison,
  onComparisonModeChange,
  onPresetChange,
  onSetBulkExcludeMta,
  onSetBulkExcludeRaw,
  onConvertSlopeZenithToHd2D,
  onSetGroupExcluded,
  onConflictResolutionChange,
  onConflictRenameValueChange,
  onToggleExclude,
  onToggleFixed,
  onCreateEmptySetupGroup,
  onGroupLabelChange,
  onCommentChange,
  onRowTextChange,
  onRowTypeChange,
  onDuplicateRow,
  onInsertCommentBelow,
  onCreateSetupGroup,
  onMoveRow,
  onReorderRow,
  onRemoveGroup,
  onRemoveRow,
  onCancel,
  onImportAsNewFile,
  onImportAssociatedProjectSettings,
  pendingAssociatedSettingsSourceName,
  pendingAssociatedSettingsSummary,
  onImport,
}) => {
  const itemLookup = React.useMemo(
    () => new Map(reviewModel.items.map((item) => [item.id, item])),
    [reviewModel.items],
  );
  const includedCount = reviewModel.items.filter((item) => !excludedItemIds.has(item.id)).length;
  const mtaItems = reviewModel.items.filter(
    (item) => item.kind === 'observation' && item.sourceMethod === 'MEANTURNEDANGLE',
  );
  const rawItems = reviewModel.items.filter(
    (item) =>
      item.kind === 'observation' &&
      Boolean(item.sourceMethod) &&
      item.sourceMethod !== 'MEANTURNEDANGLE',
  );
  const excludeMtaChecked =
    mtaItems.length > 0 && mtaItems.every((item) => excludedItemIds.has(item.id));
  const excludeRawChecked =
    rawItems.length > 0 && rawItems.every((item) => excludedItemIds.has(item.id));
  const comparisonDiffKeys = React.useMemo(
    () => new Set((comparisonSummary?.rows ?? []).map((row) => row.key)),
    [comparisonSummary],
  );
  const conflictItemIds = React.useMemo(
    () => buildConflictItemIds(conflicts, reviewModel.items),
    [conflicts, reviewModel.items],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden border border-slate-500 bg-slate-900 shadow-2xl">
        <ImportReviewModalHeader
          sourceName={sourceName}
          title={title}
          detailLines={detailLines}
          includedCount={includedCount}
          warningCount={reviewModel.warnings.length}
          errorCount={reviewModel.errors.length}
          mtaItems={mtaItems}
          rawItems={rawItems}
          excludeMtaChecked={excludeMtaChecked}
          excludeRawChecked={excludeRawChecked}
          comparisonSummary={comparisonSummary}
          preset={preset}
          comparisonMode={comparisonMode}
          pendingAssociatedSettingsSourceName={pendingAssociatedSettingsSourceName}
          pendingAssociatedSettingsSummary={pendingAssociatedSettingsSummary}
          onPresetChange={onPresetChange}
          onCreateEmptySetupGroup={onCreateEmptySetupGroup}
          onCompareFile={onCompareFile}
          onClearComparison={onClearComparison}
          onImportAssociatedProjectSettings={onImportAssociatedProjectSettings}
          onSetBulkExcludeMta={onSetBulkExcludeMta}
          onSetBulkExcludeRaw={onSetBulkExcludeRaw}
          onConvertSlopeZenithToHd2D={onConvertSlopeZenithToHd2D}
          onComparisonModeChange={onComparisonModeChange}
        />

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-950 px-5 py-4">
          <ImportReviewConflictSection
            conflicts={conflicts}
            conflictResolutions={conflictResolutions}
            conflictRenameValues={conflictRenameValues}
            resolutionValidationMessage={resolutionValidationMessage}
            onConflictResolutionChange={onConflictResolutionChange}
            onConflictRenameValueChange={onConflictRenameValueChange}
          />
          <ImportReviewComparisonSection
            comparisonSummary={comparisonSummary}
            comparisonMode={comparisonMode}
          />
          {reviewModel.groups.map((group) => (
            <ImportReviewGroupSection
              key={group.key}
              group={group}
              itemLookup={itemLookup}
              comparisonMode={comparisonMode}
              comparisonDiffKeys={comparisonDiffKeys}
              conflictItemIds={conflictItemIds}
              displayedRows={displayedRows}
              excludedItemIds={excludedItemIds}
              fixedItemIds={fixedItemIds}
              groupLabels={groupLabels}
              groupComments={groupComments}
              rowTypeOverrides={rowTypeOverrides}
              moveTargetGroups={moveTargetGroups}
              onSetGroupExcluded={onSetGroupExcluded}
              onGroupLabelChange={onGroupLabelChange}
              onCommentChange={onCommentChange}
              onRowTextChange={onRowTextChange}
              onRowTypeChange={onRowTypeChange}
              onToggleFixed={onToggleFixed}
              onToggleExclude={onToggleExclude}
              onDuplicateRow={onDuplicateRow}
              onInsertCommentBelow={onInsertCommentBelow}
              onReorderRow={onReorderRow}
              onCreateSetupGroup={onCreateSetupGroup}
              onRemoveRow={onRemoveRow}
              onMoveRow={onMoveRow}
              onRemoveGroup={onRemoveGroup}
            />
          ))}
          <ImportReviewDiagnosticsSection reviewModel={reviewModel} />
        </div>

        <ImportReviewModalFooter
          onCancel={onCancel}
          onImport={onImport}
          onImportAsNewFile={onImportAsNewFile}
        />
      </div>
    </div>
  );
};

const buildConflictItemIds = (
  conflicts: ImportReviewModalProps['conflicts'],
  items: ImportReviewItem[],
): Set<string> => {
  const ids = new Set<string>();
  conflicts.forEach((conflict) => {
    conflict.relatedItems.forEach((itemRef) => {
      items
        .filter((item) => item.kind === itemRef.kind && item.index === itemRef.index)
        .forEach((item) => ids.add(item.id));
    });
  });
  return ids;
};

export default ImportReviewModal;
