import type { ImportResolution } from '../../engine/importConflictReview';
import type { ImportReviewModalProps } from './ImportReviewModal.types';
import { getConflictResolutionOptions } from './ImportReviewModal.utils';

interface ImportReviewConflictSectionProps {
  conflicts: ImportReviewModalProps['conflicts'];
  conflictResolutions: ImportReviewModalProps['conflictResolutions'];
  conflictRenameValues: ImportReviewModalProps['conflictRenameValues'];
  resolutionValidationMessage: ImportReviewModalProps['resolutionValidationMessage'];
  onConflictResolutionChange: ImportReviewModalProps['onConflictResolutionChange'];
  onConflictRenameValueChange: ImportReviewModalProps['onConflictRenameValueChange'];
}

const ImportReviewConflictSection = ({
  conflicts,
  conflictResolutions,
  conflictRenameValues,
  resolutionValidationMessage,
  onConflictResolutionChange,
  onConflictRenameValueChange,
}: ImportReviewConflictSectionProps) => {
  if (conflicts.length === 0) return null;

  return (
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
              const resolution = conflictResolutions[conflict.resolutionKey] ?? 'keep-existing';
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
                    {conflict.incomingSourceName && (
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-cyan-200/80">
                        {conflict.incomingSourceName}
                      </div>
                    )}
                    <div>{conflict.sourceLine != null ? conflict.sourceLine : '-'}</div>
                    {conflict.existingSourceLines && conflict.existingSourceLines.length > 0 && (
                      <div className="mt-1 text-[10px] text-slate-500">
                        Existing: {conflict.existingSourceLines.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-slate-800 px-3 py-2 text-slate-200 align-top">
                    <div className="flex min-w-0 flex-col gap-2">
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
  );
};

export default ImportReviewConflictSection;
