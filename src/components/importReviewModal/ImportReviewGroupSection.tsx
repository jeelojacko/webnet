import { buildImportReviewComparisonKeyForItem } from '../../engine/importReview';
import type { ReactNode } from 'react';
import type {
  ImportReviewComparisonMode,
  ImportReviewGroup,
  ImportReviewItem,
  ImportReviewRowTypeOverride,
} from '../../engine/importReview';
import type { ImportReviewModalProps } from './ImportReviewModal.types';
import { rowSourceLabel, rowTypeOptionsForItem } from './ImportReviewModal.utils';

interface ImportReviewGroupSectionProps {
  group: ImportReviewGroup;
  itemLookup: Map<string, ImportReviewItem>;
  comparisonMode: ImportReviewComparisonMode;
  comparisonDiffKeys: Set<string>;
  conflictItemIds: Set<string>;
  displayedRows: ImportReviewModalProps['displayedRows'];
  excludedItemIds: ImportReviewModalProps['excludedItemIds'];
  fixedItemIds: ImportReviewModalProps['fixedItemIds'];
  groupLabels: ImportReviewModalProps['groupLabels'];
  groupComments: ImportReviewModalProps['groupComments'];
  rowTypeOverrides: ImportReviewModalProps['rowTypeOverrides'];
  moveTargetGroups: ImportReviewModalProps['moveTargetGroups'];
  onSetGroupExcluded: ImportReviewModalProps['onSetGroupExcluded'];
  onGroupLabelChange: ImportReviewModalProps['onGroupLabelChange'];
  onCommentChange: ImportReviewModalProps['onCommentChange'];
  onRowTextChange: ImportReviewModalProps['onRowTextChange'];
  onRowTypeChange: ImportReviewModalProps['onRowTypeChange'];
  onToggleFixed: ImportReviewModalProps['onToggleFixed'];
  onToggleExclude: ImportReviewModalProps['onToggleExclude'];
  onDuplicateRow: ImportReviewModalProps['onDuplicateRow'];
  onInsertCommentBelow: ImportReviewModalProps['onInsertCommentBelow'];
  onReorderRow: ImportReviewModalProps['onReorderRow'];
  onCreateSetupGroup: ImportReviewModalProps['onCreateSetupGroup'];
  onRemoveRow: ImportReviewModalProps['onRemoveRow'];
  onMoveRow: ImportReviewModalProps['onMoveRow'];
  onRemoveGroup: ImportReviewModalProps['onRemoveGroup'];
}

const ImportReviewGroupSection = ({
  group,
  itemLookup,
  comparisonMode,
  comparisonDiffKeys,
  conflictItemIds,
  displayedRows,
  excludedItemIds,
  fixedItemIds,
  groupLabels,
  groupComments,
  rowTypeOverrides,
  moveTargetGroups,
  onSetGroupExcluded,
  onGroupLabelChange,
  onCommentChange,
  onRowTextChange,
  onRowTypeChange,
  onToggleFixed,
  onToggleExclude,
  onDuplicateRow,
  onInsertCommentBelow,
  onReorderRow,
  onCreateSetupGroup,
  onRemoveRow,
  onMoveRow,
  onRemoveGroup,
}: ImportReviewGroupSectionProps) => {
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
            <label className="flex min-w-0 flex-col text-[11px] uppercase tracking-wide text-slate-400">
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
            <label className="flex min-w-0 flex-col text-[11px] uppercase tracking-wide text-slate-400">
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
                  Source File
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
                  <tr key={item.id} className={rowClass(excluded, hasConflict, hasComparisonDiff)}>
                    <td className="border-b border-slate-800 px-3 py-2 align-top">
                      <textarea
                        value={displayedRows[item.id] ?? ''}
                        onChange={(event) => onRowTextChange(item.id, event.target.value)}
                        className={`min-h-[54px] w-full resize-y border bg-slate-950 px-2 py-1 font-mono text-[11px] focus:outline-none ${rowTextClass(
                          excluded,
                          hasConflict,
                          hasComparisonDiff,
                        )}`}
                        spellCheck={false}
                      />
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-slate-300 align-top">
                      {item.sourceName ?? '-'}
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
                        title={excluded ? 'Excluded from final import' : 'Include in final import'}
                      />
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 align-top">
                      <RowActions
                        item={item}
                        hasConflict={hasConflict}
                        canMove={canMove}
                        moveTargetGroups={moveTargetGroups}
                        onDuplicateRow={onDuplicateRow}
                        onInsertCommentBelow={onInsertCommentBelow}
                        onReorderRow={onReorderRow}
                        onCreateSetupGroup={onCreateSetupGroup}
                        onRemoveRow={onRemoveRow}
                        onMoveRow={onMoveRow}
                      />
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

interface RowActionsProps {
  item: ImportReviewItem;
  hasConflict: boolean;
  canMove: boolean;
  moveTargetGroups: ImportReviewModalProps['moveTargetGroups'];
  onDuplicateRow: ImportReviewModalProps['onDuplicateRow'];
  onInsertCommentBelow: ImportReviewModalProps['onInsertCommentBelow'];
  onReorderRow: ImportReviewModalProps['onReorderRow'];
  onCreateSetupGroup: ImportReviewModalProps['onCreateSetupGroup'];
  onRemoveRow: ImportReviewModalProps['onRemoveRow'];
  onMoveRow: ImportReviewModalProps['onMoveRow'];
}

const RowActions = ({
  item,
  hasConflict,
  canMove,
  moveTargetGroups,
  onDuplicateRow,
  onInsertCommentBelow,
  onReorderRow,
  onCreateSetupGroup,
  onRemoveRow,
  onMoveRow,
}: RowActionsProps) => (
  <div className="flex min-w-0 flex-col gap-2">
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
      <RowButton onClick={() => onInsertCommentBelow(item.id)}>Comment Below</RowButton>
      <RowButton onClick={() => onReorderRow(item.id, 'up')}>Move Up</RowButton>
      <RowButton onClick={() => onReorderRow(item.id, 'down')}>Move Down</RowButton>
      {item.groupKey !== 'control' && (
        <RowButton onClick={() => onCreateSetupGroup(item.id)}>New Setup</RowButton>
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
);

const RowButton = ({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400"
  >
    {children}
  </button>
);

const rowClass = (excluded: boolean, hasConflict: boolean, hasComparisonDiff: boolean): string => {
  if (excluded) return 'bg-slate-950/40 text-slate-500';
  if (hasConflict) return 'bg-rose-950/20';
  if (hasComparisonDiff) return 'bg-amber-950/20';
  return '';
};

const rowTextClass = (
  excluded: boolean,
  hasConflict: boolean,
  hasComparisonDiff: boolean,
): string => {
  if (excluded) return 'border-slate-800 text-slate-500';
  if (hasConflict) return 'border-rose-700/70 text-slate-100 focus:border-rose-400';
  if (hasComparisonDiff) return 'border-amber-700/70 text-slate-100 focus:border-amber-400';
  return 'border-slate-700 text-slate-100 focus:border-cyan-400';
};

export default ImportReviewGroupSection;
