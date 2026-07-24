import type { ImportReviewModel } from '../../engine/importReview';
import { traceLineLabel } from './ImportReviewModal.utils';

interface ImportReviewDiagnosticsSectionProps {
  reviewModel: ImportReviewModel;
}

const ImportReviewDiagnosticsSection = ({ reviewModel }: ImportReviewDiagnosticsSectionProps) => {
  if (reviewModel.warnings.length === 0 && reviewModel.errors.length === 0) return null;

  return (
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
  );
};

export default ImportReviewDiagnosticsSection;
