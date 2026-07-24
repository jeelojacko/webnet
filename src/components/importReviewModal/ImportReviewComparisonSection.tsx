import type { ImportReviewComparisonMode, ImportReviewComparisonSummary } from '../../engine/importReview';

interface ImportReviewComparisonSectionProps {
  comparisonSummary: ImportReviewComparisonSummary | null;
  comparisonMode: ImportReviewComparisonMode;
}

const ImportReviewComparisonSection = ({
  comparisonSummary,
  comparisonMode,
}: ImportReviewComparisonSectionProps) => {
  if (!comparisonSummary) return null;

  return (
    <section className="border border-cyan-800/60 bg-cyan-950/20">
      <div className="border-b border-cyan-800/60 bg-cyan-950/40 px-4 py-3">
        <div className="text-sm font-semibold text-cyan-100">Multi-Source Reconcile</div>
        <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">
          {comparisonMode === 'non-mta-only'
            ? 'Comparing non-MTA observations only so imported field files can be reconciled side by side'
            : 'Comparing all raw imported observations, including JobXML MTA rows'}
        </div>
      </div>
      <div
        className={`grid gap-4 px-4 py-4 ${
          comparisonSummary.sources.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        {comparisonSummary.sources.map((source) => (
          <div
            key={source.key}
            className="border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-200"
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              {source.isPrimary ? 'Primary Source' : 'Reconcile Source'}
            </div>
            <div className="mt-1 font-semibold text-white">{source.sourceName}</div>
            <div className="mt-2 space-y-1">
              <div>Importer: {source.importerId}</div>
              <div>Points: {source.totals.controlStations}</div>
              <div>Raw Obs: {source.totals.observations}</div>
              <div>Compared Obs: {source.totals.comparedObservations}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-cyan-800/40 px-4 py-3 text-xs text-slate-300">
        Source mismatch buckets: {comparisonSummary.rows.length}
        <div className="mt-1 text-[11px] text-amber-200/80">
          Highlighted staged rows belong to setup/target/family buckets that differ across the
          loaded source files.
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
                {comparisonSummary.sources.map((source) => (
                  <th
                    key={`reconcile-source:${source.key}`}
                    className="border-b border-slate-700 px-3 py-2 text-right font-semibold"
                  >
                    {source.sourceName}
                  </th>
                ))}
                <th className="border-b border-slate-700 px-3 py-2 text-right font-semibold">
                  Spread
                </th>
                <th className="border-b border-slate-700 px-3 py-2 text-right font-semibold">
                  Present In
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
                  {row.countsBySource.map((count, index) => (
                    <td
                      key={`${row.key}:${comparisonSummary.sources[index]?.key ?? index}`}
                      className="border-b border-slate-800 px-3 py-2 text-right text-slate-200"
                    >
                      {count}
                    </td>
                  ))}
                  <td
                    className={`border-b border-slate-800 px-3 py-2 text-right ${
                      row.spread === 0 ? 'text-slate-300' : 'text-amber-300'
                    }`}
                  >
                    {row.spread}
                  </td>
                  <td className="border-b border-slate-800 px-3 py-2 text-right text-cyan-200">
                    {row.sourcePresenceCount}/{comparisonSummary.sources.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ImportReviewComparisonSection;
