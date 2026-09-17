import type { StagedSourceSummary } from '../../engine/importReviewModel';
import type { LinearUnit } from '../../engine/importUnitProvenance';

const UNIT_OPTIONS: LinearUnit[] = ['m', 'ft', 'us-ft', 'mm', 'cm'];

interface ImportReviewSourceSummaryProps {
  sources: StagedSourceSummary[];
  onConfirmSourceUnits?: (_sourceKey: string | undefined, _unit: LinearUnit) => void;
}

const consequenceFor = (summary: StagedSourceSummary): string | null => {
  const codes = new Set(summary.warnings.map((warning) => warning.sourceCode));
  if (codes.has('SOURCE_ALREADY_IMPORTED')) {
    return 'Exact duplicate: Cancel (default) discards it; Import replaces current text; Import As New File adds a copy.';
  }
  if (codes.has('SOURCE_REVISION_DETECTED') || summary.relationNote) {
    return 'Possible revision: Import replaces the previous source and results go stale (re-run required); exclusions may clear.';
  }
  return null;
};

const ImportReviewSourceSummary = ({ sources, onConfirmSourceUnits }: ImportReviewSourceSummaryProps) => {
  if (sources.length === 0) return null;
  return (
    <section aria-label="Staged sources" className="border border-slate-700 bg-slate-900 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
        Staged sources ({sources.length})
      </h3>
      <ul className="mt-2 space-y-2">
        {sources.map((summary, index) => {
          const consequence = consequenceFor(summary);
          return (
            <li key={summary.sourceKey ?? index} className="border border-slate-800 px-3 py-2 text-xs text-slate-200">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-100">{summary.sourceName ?? 'source'}</span>
                <span className="text-slate-400">{summary.formatLabel}</span>
                <span className="text-slate-300">{summary.unitsLabel}</span>
                {summary.unitConfirmationRequired && (
                  <span className="border border-red-400 px-1 text-red-300">confirmation required</span>
                )}
                <span className="text-slate-400">
                  {summary.controlCount} control · {summary.observationCount} obs · {summary.warningCount} warnings
                </span>
              </div>
              {summary.relationNote && (
                <div className="mt-1 text-amber-300">{summary.relationNote}</div>
              )}
              {summary.unitConfirmationRequired && onConfirmSourceUnits && (
                <label className="mt-1 flex items-center gap-2 text-slate-200">
                  Source unit:
                  <select
                    aria-label={`Source unit for ${summary.sourceName ?? 'source'}`}
                    className="border border-slate-500 bg-slate-800 px-2 py-1"
                    defaultValue=""
                    onChange={(event) => {
                      const unit = event.target.value as LinearUnit;
                      if (unit) onConfirmSourceUnits(summary.sourceKey, unit);
                    }}
                  >
                    <option value="" disabled>Select unit…</option>
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
              )}
              {summary.warnings.slice(0, 3).map((warning, warningIndex) => (
                <div key={warningIndex} className="mt-1 text-slate-400">{warning.message}</div>
              ))}
              {summary.warnings.length > 3 && (
                <div className="mt-1 text-slate-500">+{summary.warnings.length - 3} more warnings</div>
              )}
              {consequence && <div className="mt-1 text-amber-200">{consequence}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ImportReviewSourceSummary;
