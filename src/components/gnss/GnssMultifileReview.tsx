/**
 * Phase 13F B2 — multi-file review section (UI only, no math).
 *
 * Source-file filter (review-only, never affects the solve), composition
 * warnings/notes display, and the per-station source trace. Rendered by the
 * shared GnssResultsPanel when multifile review context is present —
 * there is no second results renderer.
 */
import React from 'react';
import type { GnssMultifileReviewInfo } from './GnssMultifileReview.utils';

interface GnssMultifileReviewSectionProps {
  readonly review: GnssMultifileReviewInfo;
  readonly sourceFilter: string | null;
  readonly onSourceFilter: (_sourceId: string | null) => void;
}

export const GnssMultifileReviewSection: React.FC<GnssMultifileReviewSectionProps> = ({
  review,
  sourceFilter,
  onSourceFilter,
}) => {
  const stationIds = Object.keys(review.stationTrace).sort();
  return (
    <>
      <section aria-label="Multifile review filter" className="border border-slate-700 rounded p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="gnss-review-source-filter" className="font-medium">
            Baseline source filter (review only)
          </label>
          <select
            id="gnss-review-source-filter"
            value={sourceFilter ?? ''}
            onChange={(event) => onSourceFilter(event.target.value === '' ? null : event.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            <option value="">All sources</option>
            {review.enabledSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <span className="text-slate-500">Filtering never affects the solve — it only narrows the table below.</span>
        </div>
        {review.warnings.length > 0 && (
          <ul className="mt-2 text-amber-300 list-disc ml-4">
            {review.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {review.mergeNotes.length > 0 && (
          <ul className="mt-1 text-slate-400 list-disc ml-4">
            {review.mergeNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {review.controlBySource.length > 0 && (
          <p className="mt-1 text-slate-400">Control: {review.controlBySource.join('; ')}</p>
        )}
      </section>
      <section aria-label="Station source trace" className="border border-slate-700 rounded p-3 text-xs">
        <details>
          <summary className="cursor-pointer font-medium">Station source trace ({stationIds.length} stations)</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {stationIds.map((id) => {
              const declarations = review.stationTrace[id] ?? [];
              const files = declarations.map((declaration) => declaration.fileName).join(', ');
              const declared = declarations
                .map((declaration) => `${declaration.control} in '${declaration.fileName}'`)
                .join('; ');
              return (
                <li key={id}>
                  {id}: files=[{files}] declared {declared} → composed {review.composedControl[id] ?? 'FREE'}
                </li>
              );
            })}
          </ul>
        </details>
      </section>
    </>
  );
};
