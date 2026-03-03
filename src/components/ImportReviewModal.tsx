import React from 'react';
import type { ImportedTraceEntry } from '../engine/importers';
import type { ImportReviewGroup, ImportReviewItem, ImportReviewModel } from '../engine/importReview';

interface ImportReviewModalProps {
  sourceName: string;
  title: string;
  detailLines: string[];
  reviewModel: ImportReviewModel;
  excludedItemIds: Set<string>;
  groupComments: Record<string, string>;
  onToggleExclude: (_itemId: string) => void;
  onCommentChange: (_groupKey: string, _value: string) => void;
  onCancel: () => void;
  onImport: () => void;
}

const traceLineLabel = (entry: ImportedTraceEntry): string => {
  const parts: string[] = [];
  if (entry.sourceLine != null) parts.push(`line ${entry.sourceLine}`);
  if (entry.sourceCode) parts.push(`[${entry.sourceCode}]`);
  return parts.join(' ');
};

const rowSourceLabel = (item: ImportReviewItem): string =>
  item.sourceLine != null
    ? `${item.sourceLine}${item.sourceCode ? ` [${item.sourceCode}]` : ''}`
    : item.sourceCode ?? '-';

const ImportReviewModal: React.FC<ImportReviewModalProps> = ({
  sourceName,
  title,
  detailLines,
  reviewModel,
  excludedItemIds,
  groupComments,
  onToggleExclude,
  onCommentChange,
  onCancel,
  onImport,
}) => {
  const itemLookup = React.useMemo(
    () => new Map(reviewModel.items.map((item) => [item.id, item])),
    [reviewModel.items],
  );
  const includedCount = reviewModel.items.filter((item) => !excludedItemIds.has(item.id)).length;

  const renderGroup = (group: ImportReviewGroup) => {
    const items = group.itemIds
      .map((itemId) => itemLookup.get(itemId))
      .filter((item): item is ImportReviewItem => Boolean(item));
    if (items.length === 0) return null;

    return (
      <section key={group.key} className="border border-slate-600 bg-slate-900/70">
        <div className="border-b border-slate-700 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-100">{group.label}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                {items.length} imported row{items.length === 1 ? '' : 's'}
              </div>
            </div>
            <label className="flex min-w-[280px] flex-col text-[11px] uppercase tracking-wide text-slate-400">
              Comment Line
              <input
                type="text"
                value={groupComments[group.key] ?? group.defaultComment}
                onChange={(event) => onCommentChange(group.key, event.target.value)}
                className="mt-1 border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                placeholder="Optional group comment"
              />
            </label>
          </div>
        </div>

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
                <th className="border-b border-slate-700 px-3 py-2 text-center font-semibold">
                  Exclude
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const excluded = excludedItemIds.has(item.id);
                return (
                  <tr key={item.id} className={excluded ? 'bg-slate-950/40 text-slate-500' : ''}>
                    <td className="border-b border-slate-800 px-3 py-2 font-mono text-[11px] text-slate-100">
                      {item.importedData}
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                      {item.sourceType}
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                      {rowSourceLabel(item)}
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={excluded}
                        onChange={() => onToggleExclude(item.id)}
                        className="accent-amber-400"
                        title={excluded ? 'Excluded from final import' : 'Include in final import'}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden border border-slate-500 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Import Review
              </div>
              <div className="mt-1 text-lg font-semibold text-white">{title}</div>
              <div className="mt-1 text-xs text-slate-400">{sourceName}</div>
            </div>
            <div className="text-right text-xs text-slate-300">
              <div>{includedCount} row{includedCount === 1 ? '' : 's'} selected for import</div>
              <div>{reviewModel.warnings.length} warnings, {reviewModel.errors.length} errors</div>
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
