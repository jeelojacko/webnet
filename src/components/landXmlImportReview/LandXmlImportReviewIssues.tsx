import React from 'react';
import type { LandXmlImportPreview } from '../../engine/landxmlImport';
import { buildLandXmlUnsupportedRows } from './landXmlImportReview.format';

/**
 * Section 3 of the LandXML Import Review: the unsupported breakdown (always
 * visible — spiral/GRID/profile/section never hidden) and the warning stream.
 */
export const LandXmlImportReviewIssues = ({
  preview,
}: {
  preview: LandXmlImportPreview;
}): React.JSX.Element => {
  const unsupported = buildLandXmlUnsupportedRows(preview);
  const present = unsupported.filter((row) => row.count > 0);
  const warnings = preview.warnings;
  const duplicates = preview.duplicates;
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <section aria-label="Unsupported LandXML content" className="rounded border border-slate-700 p-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Unsupported / not imported</h3>
        {present.length === 0 ? (
          <p className="mt-1 text-[12px] text-slate-500" data-landxml-unsupported-none>
            No unsupported content detected.
          </p>
        ) : (
          <ul className="mt-1 text-[12px] text-orange-200" data-landxml-unsupported>
            {present.map((row) => (
              <li key={row.label} className="flex justify-between gap-2">
                <span>{row.label}</span>
                <span className="tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="LandXML import warnings" className="rounded border border-slate-700 p-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Warnings</h3>
        {warnings.length === 0 ? (
          <p className="mt-1 text-[12px] text-slate-500">No warnings.</p>
        ) : (
          <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5 text-[12px] text-amber-200" data-landxml-warnings>
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        )}
        {duplicates.length > 0 ? (
          <p className="mt-1 text-[11px] text-amber-300" data-landxml-duplicates>
            {`Duplicate IDs renamed: ${duplicates.join(', ')}`}
          </p>
        ) : null}
      </section>
    </div>
  );
};
