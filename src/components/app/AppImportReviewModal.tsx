import React from 'react';
import { confirmActionGuard } from '../../engine/actionGuards';
import { buildStagedSourceSummary, type StagedSourceSummary } from '../../engine/importReviewModel';
import { ImportReviewModal } from '../../app/AppLazyViews';
import type { useAppProjectImportWorkspace } from '../../hooks/useAppProjectImportWorkspace';

type ImportReviewModalProps = React.ComponentProps<typeof ImportReviewModal>;
type ImportWorkspaceState = ReturnType<typeof useAppProjectImportWorkspace>;
type ImportReviewState = NonNullable<ImportWorkspaceState['importReviewState']>;

export type AppImportReviewModalProps = {
  importReviewState: ImportReviewState | null;
  displayedRows: ImportReviewModalProps['displayedRows'];
  moveTargetGroups: ImportReviewModalProps['moveTargetGroups'];
  onCompareFile: ImportReviewModalProps['onCompareFile'];
  onClearComparison: ImportReviewModalProps['onClearComparison'];
  onComparisonModeChange: ImportReviewModalProps['onComparisonModeChange'];
  onPresetChange: ImportReviewModalProps['onPresetChange'];
  onSetBulkExcludeMta: ImportReviewModalProps['onSetBulkExcludeMta'];
  onSetBulkExcludeRaw: ImportReviewModalProps['onSetBulkExcludeRaw'];
  onConvertSlopeZenithToHd2D: ImportReviewModalProps['onConvertSlopeZenithToHd2D'];
  onSetGroupExcluded: ImportReviewModalProps['onSetGroupExcluded'];
  onConflictResolutionChange: ImportReviewModalProps['onConflictResolutionChange'];
  onConflictRenameValueChange: ImportReviewModalProps['onConflictRenameValueChange'];
  onToggleExclude: ImportReviewModalProps['onToggleExclude'];
  onToggleFixed: ImportReviewModalProps['onToggleFixed'];
  onCreateEmptySetupGroup: ImportReviewModalProps['onCreateEmptySetupGroup'];
  onGroupLabelChange: ImportReviewModalProps['onGroupLabelChange'];
  onCommentChange: ImportReviewModalProps['onCommentChange'];
  onRowTextChange: ImportReviewModalProps['onRowTextChange'];
  onRowTypeChange: ImportReviewModalProps['onRowTypeChange'];
  onDuplicateRow: ImportReviewModalProps['onDuplicateRow'];
  onInsertCommentBelow: ImportReviewModalProps['onInsertCommentBelow'];
  onCreateSetupGroup: ImportReviewModalProps['onCreateSetupGroup'];
  onMoveRow: ImportReviewModalProps['onMoveRow'];
  onReorderRow: ImportReviewModalProps['onReorderRow'];
  onRemoveGroup: ImportReviewModalProps['onRemoveGroup'];
  onRemoveRow: ImportReviewModalProps['onRemoveRow'];
  onCancel: ImportReviewModalProps['onCancel'];
  onConfirmSourceUnits: NonNullable<ImportReviewModalProps['onConfirmSourceUnits']>;
  onImportAssociatedProjectSettings: ImportReviewModalProps['onImportAssociatedProjectSettings'];
  onApplyImportReviewAsNewFile: () => void | Promise<void>;
  onApplyImportReview: () => void | Promise<void>;
};

const buildAssociatedSettingsSummary = (importReviewState: ImportReviewState): string | null =>
  importReviewState.stagedAssociatedSettings
    ? [
        importReviewState.stagedAssociatedSettings.appliedDomains.length > 0
          ? `Applied: ${importReviewState.stagedAssociatedSettings.appliedDomains.join(', ')}.`
          : null,
        importReviewState.stagedAssociatedSettings.ignoredDomains.length > 0
          ? `Ignored: ${importReviewState.stagedAssociatedSettings.ignoredDomains.join(', ')}.`
          : null,
      ]
        .filter(Boolean)
        .join(' ')
    : null;

const confirmImport = ({
  importReviewState,
  action,
  detail,
}: {
  importReviewState: ImportReviewState;
  action: 'import-new-file' | 'import-apply';
  detail: string;
}) => {
  const selectedCount =
    importReviewState.reviewModel.items.length - importReviewState.excludedItemIds.size;
  return confirmActionGuard({
    action,
    scope: `${selectedCount} selected row(s) from ${importReviewState.sourceName}`,
    detail,
  });
};

const AppImportReviewModal = ({
  importReviewState,
  displayedRows,
  moveTargetGroups,
  onApplyImportReviewAsNewFile,
  onApplyImportReview,
  onConfirmSourceUnits,
  ...modalHandlers
}: AppImportReviewModalProps) => {
  if (!importReviewState) return null;

  // Phase 17C — per staged source rows + BLOCKING commit gate. Relation is
  // filename-based: same name + same fingerprint is an exact duplicate
  // (BLOCKING), same name + different fingerprint a possible revision.
  const stagedSources: StagedSourceSummary[] = importReviewState.sources.map((source) => {
    const sibling = importReviewState.sources.find(
      (other) => other.key !== source.key && other.sourceName === source.sourceName,
    );
    const relationNote = sibling
      ? sibling.dataset.contentFingerprint != null &&
        sibling.dataset.contentFingerprint === source.dataset.contentFingerprint
        ? `Exact duplicate of ${sibling.sourceName}`
        : `Possible revision of ${sibling.sourceName}`
      : undefined;
    return buildStagedSourceSummary(source.dataset, {
      sourceKey: source.key,
      sourceName: source.sourceName,
      relationNote,
    });
  });
  const unconfirmed = stagedSources.find((summary) => summary.unitConfirmationRequired);
  const exactDuplicate = stagedSources.find((summary) =>
    summary.warnings.some((warning) => warning.sourceCode === 'SOURCE_ALREADY_IMPORTED') ||
    (summary.relationNote?.startsWith('Exact duplicate') ?? false),
  );
  const commitBlockedReason = unconfirmed
    ? `Units unconfirmed for ${unconfirmed.sourceName ?? 'source'} — select a unit to enable commit.`
    : exactDuplicate
      ? `Exact duplicate staged (${exactDuplicate.sourceName ?? 'source'}) — cancel or replace it before commit.`
      : null;

  return (
    <React.Suspense fallback={null}>
      <ImportReviewModal
        sourceName={importReviewState.sourceName}
        title={importReviewState.notice.title}
        detailLines={importReviewState.notice.detailLines}
        reviewModel={importReviewState.reviewModel}
        comparisonSummary={importReviewState.comparisonSummary ?? null}
        comparisonMode={importReviewState.comparisonMode}
        displayedRows={displayedRows}
        excludedItemIds={importReviewState.excludedItemIds}
        fixedItemIds={importReviewState.fixedItemIds}
        groupLabels={importReviewState.groupLabels}
        groupComments={importReviewState.groupComments}
        rowTypeOverrides={importReviewState.rowTypeOverrides}
        preset={importReviewState.preset}
        conflicts={importReviewState.conflicts}
        conflictResolutions={importReviewState.conflictResolutions}
        conflictRenameValues={importReviewState.conflictRenameValues}
        resolutionValidationMessage={importReviewState.resolutionValidationMessage}
        moveTargetGroups={moveTargetGroups}
        stagedSources={stagedSources}
        onConfirmSourceUnits={onConfirmSourceUnits}
        commitBlockedReason={commitBlockedReason}
        {...modalHandlers}
        pendingAssociatedSettingsSourceName={
          importReviewState.stagedAssociatedSettings?.sourceName ?? null
        }
        pendingAssociatedSettingsSummary={buildAssociatedSettingsSummary(importReviewState)}
        onImportAsNewFile={() => {
          const confirmed = confirmImport({
            importReviewState,
            action: 'import-new-file',
            detail:
              'This keeps current editor text and appends reviewed rows as a new project source file.',
          });
          if (!confirmed) return;
          void onApplyImportReviewAsNewFile();
        }}
        onImport={() => {
          const confirmed = confirmImport({
            importReviewState,
            action: 'import-apply',
            detail:
              'This replaces current editor/import target text with the reviewed import output.',
          });
          if (!confirmed) return;
          void onApplyImportReview();
        }}
      />
    </React.Suspense>
  );
};

export default AppImportReviewModal;
