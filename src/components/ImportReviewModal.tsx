import React from 'react';
import type { ImportedTraceEntry } from '../engine/importers';
import { buildImportReviewComparisonKeyForItem } from '../engine/importReview';
import type { ImportConflict, ImportResolution } from '../engine/importConflictReview';
import type {
  ImportReviewComparisonMode,
  ImportReviewComparisonSummary,
  ImportReviewGroup,
  ImportReviewItem,
  ImportReviewModel,
  ImportReviewOutputPreset,
  ImportReviewRowTypeOverride,
} from '../engine/importReview';

interface ImportReviewModalProps {
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
  onImport: () => void;
}

const PRESET_OPTIONS: { value: ImportReviewOutputPreset; label: string; description: string }[] = [
  {
    value: 'clean-webnet',
    label: 'Clean WebNet',
    description: 'Preserve direct WebNet-style imported rows with clean grouping comments.',
  },
  {
    value: 'field-grouped',
    label: 'Field Grouped',
    description: 'Keep grouped setup comments while leaving row formats close to the raw import.',
  },
  {
    value: 'ts-direction-set',
    label: 'TS Direction Set',
    description:
      'Shape angle/measurement groups into DB/DN/DM/DE-style setup blocks where possible.',
  },
];

const traceLineLabel = (entry: ImportedTraceEntry): string => {
  const parts: string[] = [];
  if (entry.sourceLine != null) parts.push(`line ${entry.sourceLine}`);
  if (entry.sourceCode) parts.push(`[${entry.sourceCode}]`);
  return parts.join(' ');
};

const rowSourceLabel = (item: ImportReviewItem): string =>
  item.sourceLine != null ? String(item.sourceLine) : '-';

const getConflictResolutionOptions = (
  conflict: ImportConflict,
): Array<{ value: ImportResolution; label: string }> =>
  conflict.resolutionKey.startsWith('control:')
    ? [
        { value: 'keep-existing', label: 'Keep Existing' },
        { value: 'replace-with-incoming', label: 'Replace With Incoming' },
        { value: 'rename-incoming', label: 'Rename Incoming' },
        { value: 'keep-both', label: 'Keep Both' },
      ]
    : [
        { value: 'keep-existing', label: 'Keep Existing' },
        { value: 'replace-with-incoming', label: 'Replace With Incoming' },
        { value: 'keep-both', label: 'Keep Both' },
      ];

const rowTypeOptionsForItem = (
  item: ImportReviewItem,
): Array<{ value: ImportReviewRowTypeOverride; label: string }> => {
  if (item.kind !== 'observation') return [];

  const options: Array<{ value: ImportReviewRowTypeOverride; label: string }> = [
    { value: 'auto', label: 'Auto' },
  ];

  switch (item.sourceObservationKind) {
    case 'measurement':
      options.push({ value: 'measurement', label: 'M' });
      options.push({ value: 'distance', label: 'D' });
      options.push({ value: 'distance-vertical', label: 'DV' });
      options.push({ value: 'angle', label: 'A' });
      options.push({ value: 'vertical', label: 'V' });
      if (item.setupId && item.backsightId) {
        options.push({ value: 'direction-angle', label: 'DN' });
        options.push({ value: 'direction-measurement', label: 'DM' });
      }
      return options;
    case 'angle':
      options.push({ value: 'angle', label: 'A' });
      if (item.setupId && item.backsightId) {
        options.push({ value: 'direction-angle', label: 'DN' });
      }
      return options;
    case 'distance-vertical':
      options.push({ value: 'distance', label: 'D' });
      options.push({ value: 'distance-vertical', label: 'DV' });
      options.push({ value: 'vertical', label: 'V' });
      return options;
    case 'distance':
      options.push({ value: 'distance', label: 'D' });
      return options;
    case 'vertical':
      options.push({ value: 'vertical', label: 'V' });
      return options;
    case 'bearing':
      options.push({ value: 'bearing', label: 'B' });
      return options;
    default:
      return options;
  }
};

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
  const conflictItemIds = React.useMemo(() => {
    const ids = new Set<string>();
    conflicts.forEach((conflict) => {
      conflict.relatedItems.forEach((itemRef) => {
        reviewModel.items
          .filter((item) => item.kind === itemRef.kind && item.index === itemRef.index)
          .forEach((item) => ids.add(item.id));
      });
    });
    return ids;
  }, [conflicts, reviewModel.items]);

  const renderGroup = (group: ImportReviewGroup) => {
    const items = group.itemIds
      .map((itemId) => itemLookup.get(itemId))
      .filter((item): item is ImportReviewItem => Boolean(item));
    const observableItems = items.filter((item) => item.kind === 'observation');
    const excludeGroupChecked =
      observableItems.length > 0 && observableItems.every((item) => excludedItemIds.has(item.id));

    return (
      <section key={group.key} className="border border-slate-600 bg-slate-900/70">
        <div className="border-b border-slate-700 bg-slate-800/80 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid gap-2">
              <label className="flex min-w-[260px] flex-col text-[11px] uppercase tracking-wide text-slate-400">
                Setup Label
                <input
                  type="text"
                  value={groupLabels[group.key] ?? group.label}
                  onChange={(event) => onGroupLabelChange(group.key, event.target.value)}
                  className="mt-1 border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  placeholder="Optional setup label"
                />
              </label>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                {items.length} imported row{items.length === 1 ? '' : 's'}
              </div>
              {group.kind !== 'control' && (
                <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300">
                  <input
                    type="checkbox"
                    checked={excludeGroupChecked}
                    disabled={observableItems.length === 0}
                    onChange={(event) => onSetGroupExcluded(group.key, event.target.checked)}
                    className="accent-amber-400"
                  />
                  Exclude Setup
                </label>
              )}
            </div>
            <div className="flex flex-col gap-2 lg:items-end">
              <label className="flex min-w-[320px] flex-col text-[11px] uppercase tracking-wide text-slate-400">
                Comment Line
                <input
                  type="text"
                  value={groupComments[group.key] ?? group.defaultComment}
                  onChange={(event) => onCommentChange(group.key, event.target.value)}
                  className="mt-1 border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  placeholder="Optional group comment"
                />
              </label>
              {group.synthetic && items.length === 0 && (
                <button
                  type="button"
                  onClick={() => onRemoveGroup(group.key)}
                  className="border border-rose-800 bg-rose-950/40 px-2 py-1 text-[11px] uppercase tracking-wide text-rose-200 hover:border-rose-500"
                >
                  Remove Empty Group
                </button>
              )}
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-400">
            Empty setup group. Use the row move controls to place imported rows here before final
            import.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-slate-950/80 text-slate-300">
                <tr>
                  <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                    Imported Data
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                    Source Type
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                    Source Line
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                    Type
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-center font-semibold">
                    Fixed
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-center font-semibold">
                    Exclude
                  </th>
                  <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const excluded = excludedItemIds.has(item.id);
                  const fixed = fixedItemIds.has(item.id);
                  const canMove = item.groupKey !== 'control' && moveTargetGroups.length > 1;
                  const comparisonKey = buildImportReviewComparisonKeyForItem(item, comparisonMode);
                  const hasComparisonDiff =
                    comparisonKey != null && comparisonDiffKeys.has(comparisonKey);
                  const hasConflict = conflictItemIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={
                        excluded
                          ? 'bg-slate-950/40 text-slate-500'
                          : hasConflict
                            ? 'bg-rose-950/20'
                          : hasComparisonDiff
                            ? 'bg-amber-950/20'
                            : ''
                      }
                    >
                      <td className="border-b border-slate-800 px-3 py-2 align-top">
                        <textarea
                          value={displayedRows[item.id] ?? ''}
                          onChange={(event) => onRowTextChange(item.id, event.target.value)}
                          className={`min-h-[54px] w-full resize-y border bg-slate-950 px-2 py-1 font-mono text-[11px] focus:outline-none ${
                            excluded
                              ? 'border-slate-800 text-slate-500'
                              : hasConflict
                                ? 'border-rose-700/70 text-slate-100 focus:border-rose-400'
                              : hasComparisonDiff
                                ? 'border-amber-700/70 text-slate-100 focus:border-amber-400'
                                : 'border-slate-700 text-slate-100 focus:border-cyan-400'
                          }`}
                          spellCheck={false}
                        />
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 text-slate-300 align-top">
                        {item.sourceType}
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 text-slate-300 align-top">
                        {rowSourceLabel(item)}
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 align-top">
                        {item.kind === 'observation' ? (
                          <select
                            value={rowTypeOverrides[item.id] ?? 'auto'}
                            onChange={(event) =>
                              onRowTypeChange(
                                item.id,
                                event.target.value as ImportReviewRowTypeOverride,
                              )
                            }
                            className="w-full border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 focus:border-cyan-400 focus:outline-none"
                          >
                            {rowTypeOptionsForItem(item).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 text-center align-top">
                        <input
                          type="checkbox"
                          checked={fixed}
                          onChange={() => onToggleFixed(item.id)}
                          className="accent-cyan-400"
                          title={fixed ? 'Import with fixed ! token' : 'Import normally'}
                        />
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 text-center align-top">
                        <input
                          type="checkbox"
                          checked={excluded}
                          onChange={() => onToggleExclude(item.id)}
                          className="accent-amber-400"
                          title={
                            excluded ? 'Excluded from final import' : 'Include in final import'
                          }
                        />
                      </td>
                      <td className="border-b border-slate-800 px-3 py-2 align-top">
                        <div className="flex min-w-[220px] flex-col gap-2">
                          {hasConflict && (
                            <div className="text-[10px] uppercase tracking-wide text-rose-300">
                              Reconcile conflict
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {item.kind !== 'comment' && (
                              <button
                                type="button"
                                onClick={() => onDuplicateRow(item.id)}
                                className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                              >
                                Duplicate
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onInsertCommentBelow(item.id)}
                              className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                            >
                              Comment Below
                            </button>
                            <button
                              type="button"
                              onClick={() => onReorderRow(item.id, 'up')}
                              className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                            >
                              Move Up
                            </button>
                            <button
                              type="button"
                              onClick={() => onReorderRow(item.id, 'down')}
                              className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                            >
                              Move Down
                            </button>
                            {item.groupKey !== 'control' && (
                              <button
                                type="button"
                                onClick={() => onCreateSetupGroup(item.id)}
                                className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                              >
                                New Setup
                              </button>
                            )}
                            {item.synthetic && (
                              <button
                                type="button"
                                onClick={() => onRemoveRow(item.id)}
                                className="border border-rose-800 bg-rose-950/40 px-2 py-1 text-[11px] uppercase tracking-wide text-rose-200 hover:border-rose-500"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          {canMove && (
                            <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-400">
                              Move To
                              <select
                                value={item.groupKey}
                                onChange={(event) => onMoveRow(item.id, event.target.value)}
                                className="mt-1 border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 focus:border-cyan-400 focus:outline-none"
                              >
                                {moveTargetGroups.map((target) => (
                                  <option key={target.key} value={target.key}>
                                    {target.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden border border-slate-500 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Import Review
              </div>
              <div className="mt-1 text-lg font-semibold text-white">{title}</div>
              <div className="mt-1 text-xs text-slate-400">{sourceName}</div>
            </div>
            <div className="grid gap-3 text-xs text-slate-300 lg:min-w-[340px]">
              <div className="text-right">
                <div>
                  {includedCount} row{includedCount === 1 ? '' : 's'} selected for import
                </div>
                <div>
                  {reviewModel.warnings.length} warnings, {reviewModel.errors.length} errors
                </div>
              </div>
              <label className="flex flex-col text-left text-[11px] uppercase tracking-wide text-slate-400">
                Output Style
                <select
                  value={preset}
                  onChange={(event) =>
                    onPresetChange(event.target.value as ImportReviewOutputPreset)
                  }
                  className="mt-1 border border-slate-600 bg-slate-950 px-2 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 normal-case tracking-normal text-slate-400">
                  {PRESET_OPTIONS.find((option) => option.value === preset)?.description}
                </span>
              </label>
              <button
                type="button"
                onClick={onCreateEmptySetupGroup}
                className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
              >
                Add Empty Setup
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCompareFile}
                  className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                >
                  Compare File
                </button>
                {comparisonSummary && (
                  <button
                    type="button"
                    onClick={onClearComparison}
                    className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                  >
                    Clear Compare
                  </button>
                )}
              </div>
              <div className="grid gap-2 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excludeMtaChecked}
                    disabled={mtaItems.length === 0}
                    onChange={(event) => onSetBulkExcludeMta(event.target.checked)}
                    className="accent-amber-400"
                  />
                  <span>Exclude MTA Obs ({mtaItems.length})</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excludeRawChecked}
                    disabled={rawItems.length === 0}
                    onChange={(event) => onSetBulkExcludeRaw(event.target.checked)}
                    className="accent-amber-400"
                  />
                  <span>Exclude Raw Obs ({rawItems.length})</span>
                </label>
                <button
                  type="button"
                  onClick={onConvertSlopeZenithToHd2D}
                  className="border border-slate-600 bg-slate-950 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
                >
                  Convert SD+Zenith to HD (2D)
                </button>
              </div>
              {comparisonSummary && (
                <div className="grid gap-2 text-left">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Compare Preset
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onComparisonModeChange('non-mta-only')}
                      className={`border px-3 py-2 text-[11px] uppercase tracking-wide ${
                        comparisonMode === 'non-mta-only'
                          ? 'border-cyan-400 bg-cyan-900 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-cyan-400'
                      }`}
                    >
                      Non-MTA Only
                    </button>
                    <button
                      type="button"
                      onClick={() => onComparisonModeChange('all-raw')}
                      className={`border px-3 py-2 text-[11px] uppercase tracking-wide ${
                        comparisonMode === 'all-raw'
                          ? 'border-cyan-400 bg-cyan-900 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-cyan-400'
                      }`}
                    >
                      All Raw Rows
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {detailLines.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-slate-300">
              {detailLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-950 px-5 py-4">
          {conflicts.length > 0 && (
            <section className="border border-rose-800/60 bg-rose-950/20">
              <div className="border-b border-rose-800/60 bg-rose-950/40 px-4 py-3">
                <div className="text-sm font-semibold text-rose-100">Reconciliation Conflicts</div>
                <div className="text-[11px] uppercase tracking-wide text-rose-200/80">
                  Conflicts were detected between the current editor content and the incoming import.
                </div>
                {resolutionValidationMessage && (
                  <div className="mt-2 text-xs text-rose-100">{resolutionValidationMessage}</div>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-slate-950/80 text-slate-300">
                    <tr>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Type
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Target
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Existing
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Incoming
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Source Line
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Resolution
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map((conflict) => {
                      const resolution =
                        conflictResolutions[conflict.resolutionKey] ?? 'keep-existing';
                      const renameValue = conflictRenameValues[conflict.resolutionKey] ?? '';
                      return (
                      <tr key={conflict.id}>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                          <div className="font-semibold text-rose-100">{conflict.title}</div>
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                          {conflict.targetLabel}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                          {conflict.existingSummary}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                          {conflict.incomingSummary}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                          <div>{conflict.sourceLine != null ? conflict.sourceLine : '-'}</div>
                          {conflict.existingSourceLines && conflict.existingSourceLines.length > 0 && (
                            <div className="mt-1 text-[10px] text-slate-500">
                              Existing: {conflict.existingSourceLines.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-200 align-top">
                          <div className="flex min-w-[220px] flex-col gap-2">
                            <select
                              value={resolution}
                              onChange={(event) =>
                                onConflictResolutionChange(
                                  conflict.resolutionKey,
                                  event.target.value as ImportResolution,
                                )
                              }
                              className="border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 focus:border-cyan-400 focus:outline-none"
                            >
                              {getConflictResolutionOptions(conflict).map((option) => (
                                <option key={`${conflict.id}:${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {resolution === 'rename-incoming' && (
                              <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-400">
                                New Station ID
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(event) =>
                                    onConflictRenameValueChange(
                                      conflict.resolutionKey,
                                      event.target.value,
                                    )
                                  }
                                  className="mt-1 border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 focus:border-cyan-400 focus:outline-none"
                                  placeholder="Enter replacement station ID"
                                />
                              </label>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {comparisonSummary && (
            <section className="border border-cyan-800/60 bg-cyan-950/20">
              <div className="border-b border-cyan-800/60 bg-cyan-950/40 px-4 py-3">
                <div className="text-sm font-semibold text-cyan-100">Compare / Reconcile</div>
                <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">
                  {comparisonMode === 'non-mta-only'
                    ? 'Comparing non-MTA observations only so report exports and raw XML can be checked side by side'
                    : 'Comparing all raw imported observations, including JobXML MTA rows'}
                </div>
              </div>
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
                <div className="border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-200">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Primary</div>
                  <div className="mt-1 font-semibold text-white">
                    {comparisonSummary.primarySourceName}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div>Importer: {comparisonSummary.primaryImporterId}</div>
                    <div>Points: {comparisonSummary.primaryTotals.controlStations}</div>
                    <div>Raw Obs: {comparisonSummary.primaryTotals.observations}</div>
                    <div>Compared Obs: {comparisonSummary.primaryTotals.comparedObservations}</div>
                  </div>
                </div>
                <div className="border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-200">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Comparison
                  </div>
                  <div className="mt-1 font-semibold text-white">
                    {comparisonSummary.comparisonSourceName}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div>Importer: {comparisonSummary.comparisonImporterId}</div>
                    <div>Points: {comparisonSummary.comparisonTotals.controlStations}</div>
                    <div>Raw Obs: {comparisonSummary.comparisonTotals.observations}</div>
                    <div>
                      Compared Obs: {comparisonSummary.comparisonTotals.comparedObservations}
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t border-cyan-800/40 px-4 py-3 text-xs text-slate-300">
                Compared delta:{' '}
                {comparisonSummary.primaryTotals.comparedObservations -
                  comparisonSummary.comparisonTotals.comparedObservations}
                <div className="mt-1 text-[11px] text-amber-200/80">
                  Highlighted staged rows belong to setup/target/family buckets that differ between
                  the two files.
                </div>
              </div>
              {comparisonSummary.rows.length > 0 && (
                <div className="max-h-72 overflow-y-auto border-t border-cyan-800/40">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-slate-950/80 text-slate-300">
                      <tr>
                        <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                          Setup
                        </th>
                        <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                          Target
                        </th>
                        <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                          Family
                        </th>
                        <th className="border-b border-slate-700 px-3 py-2 text-right font-semibold">
                          {comparisonSummary.primarySourceName}
                        </th>
                        <th className="border-b border-slate-700 px-3 py-2 text-right font-semibold">
                          {comparisonSummary.comparisonSourceName}
                        </th>
                        <th className="border-b border-slate-700 px-3 py-2 text-right font-semibold">
                          Delta
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonSummary.rows.slice(0, 80).map((row) => (
                        <tr key={row.key}>
                          <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                            {row.setupLabel}
                          </td>
                          <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                            {row.targetLabel}
                          </td>
                          <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                            {row.family}
                          </td>
                          <td className="border-b border-slate-800 px-3 py-2 text-right text-slate-200">
                            {row.primaryCount}
                          </td>
                          <td className="border-b border-slate-800 px-3 py-2 text-right text-slate-200">
                            {row.comparisonCount}
                          </td>
                          <td
                            className={`border-b border-slate-800 px-3 py-2 text-right ${
                              row.delta === 0
                                ? 'text-slate-300'
                                : row.delta > 0
                                  ? 'text-amber-300'
                                  : 'text-cyan-300'
                            }`}
                          >
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {reviewModel.groups.map(renderGroup)}

          {(reviewModel.warnings.length > 0 || reviewModel.errors.length > 0) && (
            <section className="border border-amber-700/60 bg-amber-950/20">
              <div className="border-b border-amber-700/60 bg-amber-950/40 px-4 py-3">
                <div className="text-sm font-semibold text-amber-200">Import Diagnostics</div>
                <div className="text-[11px] uppercase tracking-wide text-amber-300/80">
                  Warnings and errors were not added to the final import text
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-slate-950/80 text-slate-300">
                    <tr>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Level
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Source
                      </th>
                      <th className="border-b border-slate-700 px-3 py-2 text-left font-semibold">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...reviewModel.errors, ...reviewModel.warnings].map((entry, index) => (
                      <tr key={`${entry.level}-${entry.sourceLine ?? 'na'}-${index}`}>
                        <td className="border-b border-slate-800 px-3 py-2 uppercase text-slate-200">
                          {entry.level}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                          {traceLineLabel(entry) || '-'}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2 text-slate-200">
                          {entry.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-700 bg-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImport}
            className="border border-cyan-400 bg-cyan-900 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800"
          >
            Import Selected Rows
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportReviewModal;
